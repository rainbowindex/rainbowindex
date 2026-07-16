import type { ResolvedTheme } from "../directives/foundation.js";
import { hasApplyLikeDirective } from "../directives/index.js";
import { resolveGoogleFonts } from "../integrations/font-providers/index.js";
import { analyzeProjectCSS, finalizeProjectCompilation } from "../project/pipeline.js";
import { collectProjectClasses } from "../scanner/index.js";
import { validateGlobPattern } from "../scanner/glob-utils.js";
import type { CLIOptions } from "./args.js";
import { loadProjectCSS } from "./css-file.js";

export interface BuildResult {
	css: string;
	theme: ResolvedTheme;
	cssFile: string | null;
}

export async function buildCSS(opts: CLIOptions, cwd: string): Promise<BuildResult> {
	const { css: cssSource, cssFile } = await loadProjectCSS(opts, cwd);

	const analysis = analyzeProjectCSS(cssSource);
	const { theme, warnings, warningSeen } = analysis;

	const validGlobs: string[] = [];
	for (const g of opts.globs) {
		const err = validateGlobPattern(g);
		if (err) {
			console.error(`[RI-1404] CLI glob pattern rejected: ${err}`);
		} else {
			validGlobs.push(g);
		}
	}
	const cliSources = validGlobs.map((g) => ({ pattern: g, negated: false, inline: false }));

	// Shared with the PostCSS plugin (collectProjectClasses): user @source
	// first, CLI globs next, auto-discovered dep safelists last — same input,
	// same output bytes.
	const scannedClasses = await collectProjectClasses(
		theme.sources,
		cliSources,
		cwd,
		warnings,
		warningSeen,
	);

	// @apply is expanded only by the PostCSS plugin; the CLI runs no PostCSS, so
	// flag it rather than silently dropping the intent.
	const buildWarnings: string[] = [];
	if (hasApplyLikeDirective(cssSource)) {
		buildWarnings.push(
			'[RI-1009] @apply is only supported via the PostCSS plugin. To expand @apply: (1) add `postcss.config.js` with `import rainbowindex from "rainbowindex"; export default { plugins: [rainbowindex()] };`, or (2) use the Vite plugin (`import rainbowindex from "rainbowindex/vite"`), which wires PostCSS automatically. The CLI does not run PostCSS so it cannot expand @apply.',
		);
	}

	// Route through the same pipeline as the PostCSS plugin so identical input
	// produces byte-identical output across the two surfaces. Google font weights
	// resolve via the shared resolver (honoring RI_OFFLINE / RI_FETCH_FONTS).
	const compiled = await finalizeProjectCompilation({
		css: cssSource,
		classNames: scannedClasses,
		analysis,
		resolveFonts: resolveGoogleFonts,
	});

	// Help when a build produces nothing — usually a missing @source / glob arg.
	if (compiled.classNames.length === 0) {
		const hadAnyGlob = opts.globs.length > 0;
		const hadAnySource = theme.sources.length > 0;
		if (!hadAnyGlob && !hadAnySource) {
			buildWarnings.push(
				'[RI-1603] No source files were scanned and no utility classes were compiled. Either pass a glob (`rainbowindex "src/**/*.{ts,tsx}" -o out.css`) or add `@source "src/**/*.{ts,tsx}";` to your CSS input.',
			);
		} else {
			buildWarnings.push(
				`[RI-1603] No utility classes were found in the scanned sources. Verify your glob/@source patterns match files that contain class names${cssFile ? ` (CSS input: ${cssFile})` : ""}.`,
			);
		}
	}

	const emitted = new Set<string>();
	for (const warning of [...compiled.warnings, ...buildWarnings]) {
		if (!emitted.has(warning)) {
			console.error(warning);
			emitted.add(warning);
		}
	}

	return { css: compiled.css, theme: compiled.theme, cssFile };
}
