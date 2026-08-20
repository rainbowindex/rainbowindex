/**
 * Shared filesystem-scanning compile entry for the CLI and PostCSS surfaces.
 *
 * Owns the analyze → validate-globs → collectProjectClasses →
 * finalizeProjectCompilation orchestration so identical input produces
 * byte-identical output on both surfaces. Scan order is part of that
 * contract: user @source patterns first, surface patterns (CLI globs /
 * plugin `sources`) next, auto-discovered dep safelists last.
 *
 * The only genuinely surface-specific behavior — how an invalid glob is
 * reported (CLI: immediate RI-1404 console.error; PostCSS: RI-1015 into the
 * warning stream) — is injected via `onInvalidPattern`.
 *
 * compileProject (project/index.ts) stays separate: it is the headless
 * in-memory variant with no filesystem scan.
 */

import type { SourceDirective } from "../directives/foundation.js";
import { resolveGoogleFonts } from "../integrations/font-providers/index.js";
import { collectProjectClasses } from "../scanner/sources.js";
import { validateGlobPattern } from "../scanner/glob-utils.js";
import { pushWarningsDeduped } from "../warnings.js";
import {
	analyzeProjectCSS,
	finalizeProjectCompilation,
	type FinalizeProjectResult,
	type FontResolver,
} from "./pipeline.js";

export interface CompileScannedProjectOptions {
	css: string;
	cwd: string;
	/** Surface-provided glob patterns (CLI positional globs, plugin `sources`). */
	surfacePatterns?: readonly string[];
	/**
	 * Called for each invalid surface pattern with the validation error.
	 * Return a warning string to push into the deduped warning stream
	 * (PostCSS), or undefined when the surface reports out-of-band (CLI).
	 */
	onInvalidPattern: (error: string) => string | undefined;
	resolveFonts?: FontResolver;
}

export async function compileScannedProject(
	options: CompileScannedProjectOptions,
): Promise<{ compiled: FinalizeProjectResult; warningSeen: Set<string> }> {
	const analysis = analyzeProjectCSS(options.css);

	// Kick off the font-metadata fetch (network, up to a 10s timeout) before the
	// filesystem scan — its only input is the pre-scan theme, so cold builds pay
	// max(scan, fetch) instead of scan + fetch. The pre-await catch only silences
	// the no-unhandled-rejection guard; finalizeProjectCompilation still awaits
	// the same promise, so a rejection surfaces at the identical point as before.
	// Default resolver: same fetch-timeout + RI-1213 policy as compileProject, so
	// all surfaces emit identical bytes on slow networks (honors RI_OFFLINE /
	// RI_FETCH_FONTS).
	const resolveFonts = options.resolveFonts ?? resolveGoogleFonts;
	const fontsReady = Promise.resolve(resolveFonts(analysis.theme.fonts));
	fontsReady.catch(() => {});

	// Validation-time warning pushes keep the PostCSS ordering: invalid-pattern
	// entries land before the discovery/scan warnings collectProjectClasses adds.
	const surfaceSources: SourceDirective[] = [];
	for (const pattern of options.surfacePatterns ?? []) {
		const error = validateGlobPattern(pattern);
		if (error) {
			const warning = options.onInvalidPattern(error);
			if (warning !== undefined) {
				pushWarningsDeduped(analysis.warnings, [warning], analysis.warningSeen);
			}
			continue;
		}
		surfaceSources.push({ pattern, negated: false, inline: false });
	}

	const classNames = await collectProjectClasses(
		analysis.theme.sources,
		surfaceSources,
		options.cwd,
		analysis.warnings,
		analysis.warningSeen,
	);

	const compiled = await finalizeProjectCompilation({
		css: options.css,
		classNames,
		analysis,
		resolveFonts: () => fontsReady,
	});

	// Wrapper object, never a spread of `compiled` — its `css` is a lazy getter
	// that spreading would force, paying the join PostCSS deliberately avoids.
	return { compiled, warningSeen: analysis.warningSeen };
}
