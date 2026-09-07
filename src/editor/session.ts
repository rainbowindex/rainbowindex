/**
 * Editor session — the façade that ties the editor toolkit together.
 *
 * An editor host holds one session per workspace, calls `setCss()` whenever
 * the project's CSS entry changes, and everything else per keystroke. The
 * session owns the caching story: theme analysis, the class inspector, the
 * enumeration, token introspection, and the merge snapshot are computed
 * lazily and invalidated together when the CSS changes — callers never
 * juggle per-theme cache keys themselves. Every capability is also exported
 * à la carte from `rainbowindex/editor` for hosts that want finer control.
 *
 * Pure computation, no IO: the host reads the CSS file (see
 * CSS_ENTRY_CANDIDATES / hasRIActivation for locating it) and passes text.
 */

import { stripRIDirectives } from "../css/strip.js";
import { diagnosticFromWarning, type Diagnostic } from "../diagnostics.js";
import type { ResolvedTheme } from "../directives/foundation.js";
import { createClassInspector, type ClassInspector } from "../engine/inspector.js";
import { createThemeSnapshot } from "../engine/index.js";
import { analyzeMerge, type MergeAnalysis } from "../merge/analyze.js";
import type { CompilationSnapshot } from "../merge/context.js";
import { analyzeProjectCSS, type ProjectAnalysis } from "../project/analyze.js";
import { inlineDirectiveImports, type ImportResolver } from "../project/imports.js";
import { extractClassCandidates, type ClassCandidate } from "../scanner/class-extraction.js";
import {
	listThemeTokens,
	resolveColorSwatch,
	type ColorSwatch,
	type ThemeTokens,
} from "../theme/swatch.js";
import { enumerateClassNames, type ClassEnumeration } from "../utilities/enumerate.js";
import {
	renderStylesheet,
	type RenderedStylesheet,
	type RenderStylesheetOptions,
} from "./render.js";
import { sortClassesWithInspector } from "./sort.js";

export interface EditorSession {
	/** The CSS input the session is currently analyzing. */
	readonly css: string;
	/** Swap the CSS input; all theme-derived caches invalidate together.
	 *  A no-op when the text is unchanged. */
	setCss(css: string): void;
	readonly theme: ResolvedTheme;
	/** Positioned diagnostics for the CSS input (see ProjectAnalysis). */
	readonly diagnostics: readonly Diagnostic[];
	/** Single-class validation/explanation, cached per theme. */
	readonly inspector: ClassInspector;
	/** The finite completion universe + templates, cached per theme. */
	enumerate(): ClassEnumeration;
	/** Render-ready token namespaces, cached per theme. */
	tokens(): ThemeTokens;
	/** The merge snapshot for this theme, cached. */
	snapshot(): CompilationSnapshot;
	/** analyzeMerge bound to this theme's snapshot. */
	analyzeMerge(classes: readonly string[]): MergeAnalysis;
	/** Position-aware class extraction for a source document. */
	extractCandidates(content: string, path?: string): ClassCandidate[];
	/**
	 * Files pulled in by `@import`, in first-visit order, or empty when no
	 * resolver was supplied. A host watches these: editing an imported token
	 * file must invalidate the session just as editing the entry does.
	 */
	readonly importedFiles: readonly string[];
	/** Light/dark swatch for a theme color (+ stop), or null. */
	swatch(name: string, stop?: number): ColorSwatch | null;
	/**
	 * Compile `classNames` against this session's theme and assemble the
	 * stylesheet, the way a build would.
	 *
	 * `userCSS` defaults to this session's own CSS entry with the directives
	 * stripped — imports already inlined — so `session.render(classes)` on its
	 * own reproduces the project's sheet. Pass `userCSS: ""` for the generated
	 * output alone. See `renderStylesheet` for what a pure render leaves out.
	 */
	render(classNames: Iterable<string>, options?: RenderStylesheetOptions): RenderedStylesheet;
	/**
	 * Order a class list the way the generated stylesheet orders its rules,
	 * through this session's cached inspector. See `sortClasses` — in
	 * particular, do not sort a list that reaches `ri()`.
	 */
	sortClasses(classNames: readonly string[]): string[];
}

export function createEditorSession(
	options: {
		css?: string;
		/**
		 * Turns an `@import` specifier into text, so directives in imported
		 * files reach the theme. Synchronous by design: the host already has
		 * its open documents in memory, and this entry does no IO of its own.
		 * Without one, imports pass through and their directives stay unread.
		 */
		resolveImport?: ImportResolver;
		/** Identity of the CSS entry — the base for relative specifiers. */
		cssPath?: string;
	} = {},
): EditorSession {
	let css = options.css ?? "";
	let analysis: ProjectAnalysis | null = null;
	let inspector: ClassInspector | null = null;
	let enumeration: ClassEnumeration | null = null;
	let tokens: ThemeTokens | null = null;
	let snapshot: CompilationSnapshot | null = null;
	let importedFiles: readonly string[] = [];
	/** The entry with `@import`s inlined — what the theme was actually read
	 *  from, and so what `render()` appends as the project's own CSS. */
	let effectiveCss = "";

	const ensureAnalysis = (): ProjectAnalysis => {
		if (analysis === null) {
			const resolve = options.resolveImport;
			if (resolve === undefined) {
				importedFiles = [];
				effectiveCss = css;
				analysis = analyzeProjectCSS(css);
			} else {
				const inlined = inlineDirectiveImports(css, { resolve, from: options.cssPath });
				importedFiles = inlined.files;
				effectiveCss = inlined.css;
				analysis = analyzeProjectCSS(inlined.css);
				// Import problems are diagnostics like any other, so a host can
				// underline the offending @import instead of failing silently.
				for (const warning of inlined.warnings) {
					if (analysis.warningSeen.has(warning)) continue;
					analysis.warningSeen.add(warning);
					analysis.warnings.push(warning);
					analysis.diagnostics.push(diagnosticFromWarning(warning, null));
				}
			}
		}
		return analysis;
	};
	const ensureSnapshot = (): CompilationSnapshot => {
		snapshot ??= createThemeSnapshot(ensureAnalysis().theme);
		return snapshot;
	};

	return {
		get css() {
			return css;
		},
		setCss(next: string): void {
			if (next === css) return;
			css = next;
			analysis = null;
			inspector = null;
			enumeration = null;
			tokens = null;
			snapshot = null;
		},
		get theme() {
			return ensureAnalysis().theme;
		},
		get diagnostics() {
			return ensureAnalysis().diagnostics;
		},
		get inspector() {
			inspector ??= createClassInspector(ensureAnalysis().theme);
			return inspector;
		},
		enumerate(): ClassEnumeration {
			enumeration ??= enumerateClassNames(ensureAnalysis().theme);
			return enumeration;
		},
		tokens(): ThemeTokens {
			tokens ??= listThemeTokens(ensureAnalysis().theme);
			return tokens;
		},
		snapshot: ensureSnapshot,
		analyzeMerge(classes: readonly string[]): MergeAnalysis {
			return analyzeMerge(classes, ensureSnapshot());
		},
		get importedFiles() {
			ensureAnalysis();
			return importedFiles;
		},
		extractCandidates(content: string, path?: string): ClassCandidate[] {
			return extractClassCandidates({ content, path });
		},
		swatch(name: string, stop?: number): ColorSwatch | null {
			return resolveColorSwatch(ensureAnalysis().theme, name, stop);
		},
		sortClasses(classNames: readonly string[]): string[] {
			inspector ??= createClassInspector(ensureAnalysis().theme);
			return sortClassesWithInspector(inspector, classNames);
		},
		render(
			classNames: Iterable<string>,
			renderOptions: RenderStylesheetOptions = {},
		): RenderedStylesheet {
			const theme = ensureAnalysis().theme;
			return renderStylesheet(theme, classNames, {
				...renderOptions,
				userCSS: renderOptions.userCSS ?? stripRIDirectives(effectiveCss),
			});
		},
	};
}
