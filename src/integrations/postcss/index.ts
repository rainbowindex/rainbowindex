import postcss, {
	type AtRule,
	type Declaration,
	type Plugin,
	type PluginCreator,
	type Result,
	type Root,
} from "postcss";
import {
	APPLY_ALIASES,
	DIRECTIVE_NAMES_SET,
	hasRIActivation,
	MAX_DIRECTIVE_INPUT_SIZE,
	RI_IMPORT_SPECIFIER_ALTERNATION,
} from "../../directives/index.js";
import type { ResolvedTheme } from "../../directives/foundation.js";
import { compileCSSFunctions, hasCSSFunctions } from "../../engine/index.js";
import { pushWarningsDeduped } from "../../warnings.js";
import { isAbsolute } from "node:path";
import { processApply } from "./apply.js";
import { compileScannedProject } from "../../project/scan.js";

export interface RainbowIndexOptions {
	sources?: string[];
	cwd?: string;
}

// Derived from the shared specifier list so the three activation surfaces
// (scan, PostCSS, strip) can never drift.
const RI_IMPORT_PARAMS_RE = new RegExp(
	`^(?:url\\(\\s*)?["'](?:${RI_IMPORT_SPECIFIER_ALTERNATION})["']\\s*\\)?(?:\\s+.+)?$`,
	"i",
);

function isRainbowIndexImport(atRule: AtRule): boolean {
	if (atRule.name !== "import") return false;
	return RI_IMPORT_PARAMS_RE.test(atRule.params.trim());
}

function stripRIDirectiveNodes(root: Root): void {
	const toRemove: AtRule[] = [];

	for (const node of root.nodes ?? []) {
		if (node.type === "atrule") {
			const atRule = node as AtRule;
			const isApplyLike =
				atRule.name === "apply" || atRule.name === "slot" || APPLY_ALIASES.includes(atRule.name);
			if (isRainbowIndexImport(atRule) || (DIRECTIVE_NAMES_SET.has(atRule.name) && !isApplyLike)) {
				toRemove.push(atRule);
			}
		}
	}

	for (const node of toRemove) {
		node.remove();
	}
}

/**
 * `@slot` is only meaningful inside a `@custom` variant body, where it marks the
 * applied-rule insertion point and is consumed during directive parsing — its
 * `@custom` parent is stripped from the AST (stripRIDirectiveNodes) before this
 * runs, so a nested `@slot;` never reaches this walk. Any `@slot` that survives is
 * therefore a standalone misuse: warn with an actionable RI-1037 and drop it so it
 * cannot leak into the output as an invalid at-rule.
 */
function warnStandaloneSlots(root: Root, warnings: string[]): void {
	root.walkAtRules("slot", (atRule: AtRule) => {
		warnings.push(
			'[RI-1037] @slot is only valid inside @custom (e.g. `@custom hocus { &:hover { @slot; } }`). To style a slotted element directly, write `[data-slot="name"] { … }`.',
		);
		atRule.remove();
	});
}

function processCSSFunctions(root: Root, theme: ResolvedTheme, warnings: string[]): void {
	root.walkDecls((decl: Declaration) => {
		if (hasCSSFunctions(decl.value)) {
			decl.value = compileCSSFunctions(decl.value, theme, warnings);
		}
	});
}

const rainbowindex: PluginCreator<RainbowIndexOptions> = (options: RainbowIndexOptions = {}) => {
	const plugin: Plugin = {
		postcssPlugin: "rainbowindex",
		async Once(root: Root, { result }: { result: Result }) {
			try {
				const cwd = options.cwd || process.cwd();
				if (!cwd || typeof cwd !== "string" || cwd.includes("\0")) {
					throw new Error(
						"[RI-0002] options.cwd is invalid (empty, non-string, or contains null bytes).",
					);
				}
				if (!isAbsolute(cwd)) {
					throw new Error(
						`[RI-0002] options.cwd must be an absolute path, got relative path: "${cwd}".`,
					);
				}

				// Use root.toString() to capture the full AST content including
				// any @import-inlined files (e.g. Vite resolves CSS @imports
				// before PostCSS plugins run, so the AST contains imported
				// content that root.source.input.css does not).
				const rawCSS = root.toString();
				if (rawCSS.length > MAX_DIRECTIVE_INPUT_SIZE) {
					result.warn(
						`[RI-1019] CSS input exceeds ${MAX_DIRECTIVE_INPUT_SIZE / 1_048_576} MB limit (${(rawCSS.length / 1_048_576).toFixed(1)} MB). Skipping rainbowindex processing.`,
					);
					return;
				}

				const hasActivation = hasRIActivation(rawCSS);
				if (!hasActivation) {
					return;
				}

				const from =
					root.source?.input?.file ??
					root.source?.input?.id ??
					root.source?.input?.from ??
					"<rainbowindex>";

				const { compiled, warningSeen } = await compileScannedProject({
					css: rawCSS,
					cwd,
					cssPath: from,
					surfacePatterns: options.sources,
					onInvalidPattern: (err) => `[RI-1015] ${err}`,
				});
				// Same array identity the pipeline pushed into — post-finalize warnings
				// dedupe against everything the compile already emitted.
				const compilationWarnings = compiled.warnings;
				// User nodes stay in the AST; `compiled.sections` is generated-only
				// (user CSS is carried separately in compiled.userCSS).
				stripRIDirectiveNodes(root);

				// The @slot/@apply walks run BEFORE the generated sections are
				// prepended: generated CSS can never contain @slot or @apply
				// (custom-utility @apply bodies are pre-expanded at generation
				// time), so walking only the user AST skips full traversals of
				// the largest subtree. Rules expandApply appends at the document
				// root land after user CSS either way, so prepending afterwards
				// yields the identical final order.
				const slotWarnings: string[] = [];
				warnStandaloneSlots(root, slotWarnings);
				pushWarningsDeduped(compilationWarnings, slotWarnings, warningSeen, compiled.suppressed);

				const applyWarnings: string[] = [];
				processApply(root, compiled.theme, applyWarnings, from);
				pushWarningsDeduped(compilationWarnings, applyWarnings, warningSeen, compiled.suppressed);

				if (compiled.sections.length > 0) {
					const generatedRoot = postcss.parse(compiled.sections.join("\n\n"), { from });
					root.prepend(generatedRoot.nodes);
				}

				const cssFnWarnings: string[] = [];
				processCSSFunctions(root, compiled.theme, cssFnWarnings);
				pushWarningsDeduped(compilationWarnings, cssFnWarnings, warningSeen, compiled.suppressed);

				for (const warning of compilationWarnings) {
					result.warn(warning);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (message.startsWith("[RI-")) throw err;
				const sourceFile =
					root.source?.input?.file ??
					root.source?.input?.id ??
					root.source?.input?.from ??
					"<input>";
				// PostCSS CssSyntaxError carries line/column metadata. Surface it so the
				// user sees where the parse failed instead of a generic "failed: ..." line.
				const location =
					err && typeof err === "object" && "line" in err
						? `:${(err as { line?: number }).line}${
								"column" in err ? `:${(err as { column?: number }).column}` : ""
							}`
						: "";
				const hint =
					err &&
					typeof err === "object" &&
					"name" in err &&
					(err as { name?: string }).name === "CssSyntaxError"
						? " (CSS syntax error — check the CSS input near the location above)"
						: /glob|pattern/i.test(message)
							? " (glob/source error — check your @source patterns and the CWD passed to the plugin)"
							: "";
				throw new Error(
					`[RI-0001] rainbowindex PostCSS plugin failed at ${sourceFile}${location}: ${message}${hint}`,
					{ cause: err },
				);
			}
		},
	};

	// Guard against the most common misconfiguration: importing the default
	// (PostCSS) plugin and dropping it into Vite's `plugins: []` array, where it
	// carries no Vite hooks and would otherwise do nothing — no CSS generated, no
	// error, just a baffling silent failure. Vite invokes every plugin's `config`
	// hook during config resolution, so a `config` that throws turns that silent
	// no-op into an actionable signpost pointing at `rainbowindex/vite`.
	//
	// This is safe to carry on a PostCSS plugin object: PostCSS only dispatches
	// visitor keys derived from node names (`Declaration`, `AtRule-<name>`, …) and
	// never a bare lowercase `config`, so the hook is inert under PostCSS and only
	// ever runs when a Vite runtime picks the object up. `name` is likewise ignored
	// by PostCSS (a non-function, non-object value).
	return Object.assign(plugin, {
		name: "rainbowindex",
		config(): never {
			throw new Error(
				'[RI-1606] The default `rainbowindex` export is the PostCSS plugin, but it was placed in Vite\'s `plugins: []` array where it does nothing. Import the Vite plugin instead: `import rainbowindex from "rainbowindex/vite"`. (For a raw PostCSS setup, keep the default import and register it under `css.postcss.plugins` or in postcss.config.*.)',
			);
		},
	});
};

rainbowindex.postcss = true;

export default rainbowindex;
