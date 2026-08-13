/**
 * `rainbowindex/editor` — the IO-free toolkit editor integrations build on.
 *
 * Everything exported here is pure computation: strings in, structures out.
 * No filesystem, no network, no module-level mutation — the entry behaves in
 * browser-based editor hosts (vscode.dev) exactly as it does in Node. File
 * access stays with the editor host; this module supplies the semantics:
 * what the scanner extracts (and where), what activates Rainbow Index, and
 * where a project's CSS entry usually lives.
 *
 * Editor integrations load whatever version the workspace has installed, so
 * the surface is feature-detectable: gate on `editorCapabilities` entries,
 * not on `version`, when deciding what the installed copy supports.
 */

declare const __RI_VERSION__: string;

/** Package version — build-time injected; "0.0.0-dev" when run from source. */
export const version: string = typeof __RI_VERSION__ !== "undefined" ? __RI_VERSION__ : "0.0.0-dev";

/** Editor API protocol version — bumped only on breaking changes to this entry. */
export const EDITOR_API_VERSION = 1;

/** Feature-detection roster for this entry. */
export const editorCapabilities: readonly string[] = Object.freeze([
	"class-candidates",
	"css-entry-detection",
	"theme-analysis",
	"class-inspection",
	"variant-list",
	"class-enumeration",
	"merge-analysis",
	"structured-diagnostics",
	"color-swatches",
	"editor-session",
]);

// ---------------------------------------------------------------------------
// Scanner — position-aware class extraction
// ---------------------------------------------------------------------------

export {
	CLASS_HELPER_NAMES,
	VARIANT_HELPER_NAMES,
	expandVariantGroups,
	extractClasses,
	extractClassCandidates,
	extractClassesFromSource,
} from "../scanner/class-extraction.js";
export type {
	CandidateOrigin,
	ClassCandidate,
	SourceExtractionInput,
} from "../scanner/class-extraction.js";
export { isSourceFile } from "../scanner/source-files.js";

// ---------------------------------------------------------------------------
// Project CSS entry detection (host reads the files, these decide)
// ---------------------------------------------------------------------------

export { CSS_ENTRY_CANDIDATES } from "../project/css-entry.js";
export { hasRIActivation, RI_IMPORT_SPECIFIERS } from "../directives/activation.js";

// ---------------------------------------------------------------------------
// Theme analysis — CSS input string → ResolvedTheme, no IO, no fonts
// ---------------------------------------------------------------------------

export { analyzeProjectCSS } from "../project/analyze.js";
export type { ProjectAnalysis } from "../project/analyze.js";
export type { ParsedDirective, ResolvedTheme } from "../directives/foundation.js";
export { defaultTheme } from "../theme/index.js";
export { diagnosticFromWarning, severityForCode, warningCode } from "../diagnostics.js";
export type { Diagnostic, DiagnosticSeverity } from "../diagnostics.js";

// ---------------------------------------------------------------------------
// Class inspection — validate / explain single classes against a theme
// ---------------------------------------------------------------------------

export { createClassInspector } from "../engine/inspector.js";
export type {
	ClassExplanation,
	ClassInspector,
	ClassValidation,
} from "../engine/inspector.js";
export { listVariants } from "../engine/variants.js";
export type { VariantInfo, VariantKind } from "../engine/variants.js";
export { findClosest } from "../engine/suggest.js";
export { parseUtility } from "../utilities/parser.js";
export type { ParsedUtility } from "../utilities/parser.js";

// ---------------------------------------------------------------------------
// Class enumeration — the finite completion universe for a theme
// ---------------------------------------------------------------------------

export { enumerateClassNames, UTILITY_VALUE_SPACES } from "../utilities/enumerate.js";
export type {
	ClassEnumeration,
	ClassTemplate,
	EnumeratedClass,
	ValueSpaceKind,
	ValueSpaceSpec,
} from "../utilities/enumerate.js";

// ---------------------------------------------------------------------------
// Merge analysis — explain ri()'s right-most-wins conflict resolution
// ---------------------------------------------------------------------------

export { analyzeMerge } from "../merge/index.js";
export type { CompilationSnapshot, MergeAnalysis, MergeDrop } from "../merge/index.js";
export { createThemeSnapshot } from "../engine/index.js";

// ---------------------------------------------------------------------------
// Color swatches + theme token introspection
// ---------------------------------------------------------------------------

export {
	CANONICAL_COLOR_STOPS,
	cssColorToHex,
	listThemeTokens,
	oklchToHex,
	resolveColorSwatch,
} from "../theme/swatch.js";
export type { ColorSwatch, SwatchColor, ThemeTokens } from "../theme/swatch.js";
export type { ColorDefinition } from "../theme/colors.js";

// ---------------------------------------------------------------------------
// Session façade — one object per workspace, caches invalidate on setCss()
// ---------------------------------------------------------------------------

export { createEditorSession } from "../editor/session.js";
export type { EditorSession } from "../editor/session.js";
