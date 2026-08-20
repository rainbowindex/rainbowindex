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

import type { Diagnostic } from "../diagnostics.js";
import type { ResolvedTheme } from "../directives/foundation.js";
import { createClassInspector, type ClassInspector } from "../engine/inspector.js";
import { createThemeSnapshot } from "../engine/index.js";
import { analyzeMerge, type MergeAnalysis } from "../merge/analyze.js";
import type { CompilationSnapshot } from "../merge/context.js";
import { analyzeProjectCSS, type ProjectAnalysis } from "../project/analyze.js";
import { extractClassCandidates, type ClassCandidate } from "../scanner/class-extraction.js";
import {
	listThemeTokens,
	resolveColorSwatch,
	type ColorSwatch,
	type ThemeTokens,
} from "../theme/swatch.js";
import { enumerateClassNames, type ClassEnumeration } from "../utilities/enumerate.js";

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
	/** Light/dark swatch for a theme color (+ stop), or null. */
	swatch(name: string, stop?: number): ColorSwatch | null;
}

export function createEditorSession(options: { css?: string } = {}): EditorSession {
	let css = options.css ?? "";
	let analysis: ProjectAnalysis | null = null;
	let inspector: ClassInspector | null = null;
	let enumeration: ClassEnumeration | null = null;
	let tokens: ThemeTokens | null = null;
	let snapshot: CompilationSnapshot | null = null;

	const ensureAnalysis = (): ProjectAnalysis => {
		analysis ??= analyzeProjectCSS(css);
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
		extractCandidates(content: string, path?: string): ClassCandidate[] {
			return extractClassCandidates({ content, path });
		},
		swatch(name: string, stop?: number): ColorSwatch | null {
			return resolveColorSwatch(ensureAnalysis().theme, name, stop);
		},
	};
}
