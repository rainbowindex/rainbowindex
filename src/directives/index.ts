/**
 * Directive tokenizer and facade exports.
 * Shared directive types and low-level parsing helpers live in foundation.ts.
 */

import type { DirectiveType, ParsedDirective } from "./foundation.js";
import { DIRECTIVE_TYPE_NAMES, findClosingBrace } from "./foundation.js";
import { scanAtRules } from "./activation.js";
export type {
	CustomUtility,
	CustomVariant,
	DirectiveType,
	LayerConfig,
	ParsedDirective,
	PreflightConfig,
	PropertyRegistration,
	ResolvedTheme,
	SourceDirective,
	WritableTheme,
} from "./foundation.js";

export {
	APPLY_ALIASES,
	APPLY_LIKE_MATCH_RE,
	hasApplyLikeDirective,
} from "./apply-aliases.js";

// Activation detection lives in activation.ts — a pure leaf module the
// `rainbowindex/editor` entry and browser bundles can import without pulling
// the directive resolver (whose graph reaches Node-only font machinery) into
// their module graph. Re-exported here so existing importers keep working.
export {
	DIRECTIVE_NAMES_SET,
	directiveAtRulePattern,
	hasRIActivation,
	hasRIDirectiveName,
	isAtRuleNameChar,
	RI_IMPORT_SPECIFIER_ALTERNATION,
	RI_IMPORT_SPECIFIERS,
	scanAtRules,
} from "./activation.js";

/** Precompiled whitespace regex for whitespace-skipping loops in directive parsing. */
const WS_RE = /\s/;

const CC_NEWLINE = 10;

// ---------------------------------------------------------------------------
// Tokenizer — extract directives from CSS source
// ---------------------------------------------------------------------------

/**
 * Extract all directives from CSS source text.
 *
 * Handles:
 * - `@color { ... }`
 * - `@font { sans: "Inter" from google; }`
 * - `@preflight;`
 * - `@preflight off;`
 * - `@rounded squircle { ... }` (any corner-shape keyword)
 * - `@rounded superellipse(2.0) { ... }`
 * - `@rounded bevel;`
 */
/** Standard CSS at-rules that should not be treated as RI directives. */
const STANDARD_AT_RULES = new Set([
	"import",
	"media",
	"supports",
	"keyframes",
	"property",
	"container",
	"charset",
	"namespace",
	"page",
	"font-face",
	"counter-style",
]);

/** The raw-extractable names (apply-like PostCSS-only directives excluded) —
 *  derived straight from the DirectiveType source list in foundation.ts.
 *  Exported for css/strip.ts, which strips exactly this set from authored CSS. */
export const EXTRACTABLE_DIRECTIVE_NAMES: ReadonlySet<string> = new Set(DIRECTIVE_TYPE_NAMES);
const DIRECTIVE_TYPES = EXTRACTABLE_DIRECTIVE_NAMES;

/** Maximum source size for raw directive extraction (5 MB). */
export const MAX_DIRECTIVE_INPUT_SIZE = 5_242_880;

/**
 * Optional side-channel for extractDirectives — position data for editor
 * tooling, kept off the ParsedDirective shape so existing consumers (and
 * exact-shape test assertions) are untouched.
 */
export interface DirectiveCapture {
	/** Parallel to the returned array: [start, end) span of each directive. */
	directiveSpans?: Array<readonly [number, number]>;
	/** First-seen [start, end) span per warning message. */
	warningSpans?: Map<string, readonly [number, number]>;
}

export function extractDirectives(
	src: string,
	warnings?: string[],
	capture?: DirectiveCapture,
): ParsedDirective[] {
	const emit = (message: string, start: number, end: number): void => {
		warnings?.push(message);
		if (capture?.warningSpans && !capture.warningSpans.has(message)) {
			capture.warningSpans.set(message, [start, end]);
		}
	};

	if (src.length > MAX_DIRECTIVE_INPUT_SIZE) {
		emit(
			`[RI-1019] CSS input exceeds ${MAX_DIRECTIVE_INPUT_SIZE / 1_048_576} MB limit (${(src.length / 1_048_576).toFixed(1)} MB). Skipping directive extraction.`,
			0,
			src.length,
		);
		return [];
	}

	const directives: ParsedDirective[] = [];
	// Body ranges of block-form standard at-rules (e.g. @media/@supports) seen
	// so far. RI directives are still extracted inside them, but apply globally —
	// RI-1036 tells the author the enclosing condition is ignored.
	const standardBlockRanges: Array<{ start: number; end: number; name: string }> = [];

	// Incremental line counter — avoids O(n) rescan per warning. Positions are
	// visited monotonically, so each call only scans the gap since the last one.
	let currentLine = 1;
	let lastLineCountPos = 0;
	const lineNum = (pos: number) => {
		for (let p = lastLineCountPos; p < pos; p++) {
			if (src.charCodeAt(p) === CC_NEWLINE) currentLine++;
		}
		lastLineCountPos = pos;
		return currentLine;
	};

	scanAtRules(
		src,
		(fullName, atPos, nameEnd) => {
			// Skip standard CSS at-rules — but remember block bodies for RI-1036.
			if (STANDARD_AT_RULES.has(fullName)) {
				const block = findStandardAtRuleBlock(src, nameEnd);
				if (block) standardBlockRanges.push({ ...block, name: fullName });
				return undefined;
			}

			// Per-slot @font-<slot> directives were removed — fonts are configured
			// inside a single @font { … } block. Warn and skip. (@font-face is a
			// standard at-rule, already handled above.)
			if (fullName.startsWith("font-") && fullName.length > 5) {
				emit(
					`[RI-1202] @${fullName} is no longer supported — configure fonts inside a single @font { ${fullName.slice(5)}: … } block.`,
					atPos,
					nameEnd,
				);
				return undefined;
			}

			if (DIRECTIVE_TYPES.has(fullName)) {
				const directive = parseGenericDirective(src, nameEnd, fullName as DirectiveType);
				if (directive) {
					if (warnings || capture) {
						const enclosing = standardBlockRanges.find((r) => atPos > r.start && atPos < r.end);
						if (enclosing) {
							emit(
								`[RI-1036] @${fullName} at line ${lineNum(atPos)} is nested inside @${enclosing.name} — RI directives are resolved globally at build time, so the @${enclosing.name} condition is ignored. Move the directive to the top level of the stylesheet.`,
								atPos,
								nameEnd,
							);
						}
					}
					directives.push(directive.directive);
					capture?.directiveSpans?.push([atPos, directive.end]);
					return directive.end;
				}
				emit(
					`[RI-1012] @${fullName} directive at line ${lineNum(atPos)} could not be parsed (possible unmatched brace or missing semicolon). The directive was skipped.`,
					atPos,
					nameEnd,
				);
			}

			return undefined;
		},
		warnings || capture
			? (pos) => {
					// CSS does not have single-line comments. We skip them as a
					// convenience for users, but warn since this is non-standard.
					emit(
						`[RI-1011] Line ${lineNum(pos)}: Single-line comment (//) detected. CSS only supports /* */ comments — the rest of this line is skipped. Use /* … */ instead.`,
						pos,
						pos + 2,
					);
				}
			: undefined,
	);

	return directives;
}

/**
 * Locate the `{ … }` block of a standard at-rule whose name ends at `pos`.
 * Walks the prelude (skipping strings, comments, and balanced parens) until a
 * top-level `{` or `;`. Returns the block's brace positions, or null for
 * statement-form at-rules (`@import …;`) and unmatched braces.
 */
function findStandardAtRuleBlock(src: string, pos: number): { start: number; end: number } | null {
	let i = pos;
	let depth = 0;
	while (i < src.length) {
		const ch = src[i];
		if (ch === '"' || ch === "'") {
			i++;
			while (i < src.length && src[i] !== ch) {
				if (src[i] === "\\" && i + 1 < src.length) i++;
				i++;
			}
			i++;
			continue;
		}
		if (ch === "/" && src[i + 1] === "*") {
			const end = src.indexOf("*/", i + 2);
			i = end === -1 ? src.length : end + 2;
			continue;
		}
		if (ch === "(") {
			depth++;
		} else if (ch === ")") {
			if (depth > 0) depth--;
		} else if (depth === 0 && ch === ";") {
			return null;
		} else if (depth === 0 && ch === "{") {
			const close = findClosingBrace(src, i);
			return close === -1 ? null : { start: i, end: close };
		}
		i++;
	}
	return null;
}

interface ParseResult {
	directive: ParsedDirective;
	end: number;
}

/**
 * Parse a generic directive (@color, @text, etc.).
 */
function parseGenericDirective(src: string, pos: number, type: DirectiveType): ParseResult | null {
	let i = pos;
	while (i < src.length && WS_RE.test(src[i])) i++;

	if (i >= src.length) return null;

	// Check for bare semicolon (e.g. @preflight;)
	if (src[i] === ";") {
		return {
			directive: { type, body: "" },
			end: i + 1,
		};
	}

	// Check for modifier before brace or semicolon
	// e.g. @preflight off; @rounded squircle { ... } @rounded squircle;
	// e.g. @color dark { ... }
	let modifier: string | undefined;

	// Scan for modifier word(s) before { or ;
	if (src[i] !== "{") {
		// Read until a top-level { or ; — quoted strings, comments, and balanced
		// parens are content, so a brace or semicolon inside them must not
		// terminate the prelude (e.g. @source "src/**/*.{ts,tsx}";).
		let modEnd = i;
		let inParen = 0;
		while (modEnd < src.length) {
			const ch = src[modEnd];
			if (ch === '"' || ch === "'") {
				modEnd++;
				while (modEnd < src.length && src[modEnd] !== ch) {
					if (src[modEnd] === "\\" && modEnd + 1 < src.length) modEnd++;
					modEnd++;
				}
				modEnd++;
				continue;
			}
			if (ch === "/" && src[modEnd + 1] === "*") {
				const close = src.indexOf("*/", modEnd + 2);
				modEnd = close === -1 ? src.length : close + 2;
				continue;
			}
			if (ch === "(") inParen++;
			else if (ch === ")") {
				if (inParen > 0) inParen--;
			} else if (inParen === 0 && (ch === "{" || ch === ";")) break;
			modEnd++;
		}
		const modStr = src.slice(i, modEnd).trim();

		if (src[modEnd] === ";") {
			// Modifier-only directive, e.g. @preflight off; or @rounded bevel;
			return {
				directive: { type, body: "", modifier: modStr || undefined },
				end: modEnd + 1,
			};
		}

		if (src[modEnd] === "{" && modStr) {
			modifier = modStr;
			i = modEnd;
		}
	}

	// Should be at {
	if (src[i] !== "{") return null;

	const closePos = findClosingBrace(src, i);
	if (closePos === -1) return null;

	const body = src.slice(i + 1, closePos).trim();
	return {
		directive: { type, body, modifier },
		end: closePos + 1,
	};
}

export {
	parseKeyValueBody,
	parseColorBody,
	parseTextBody,
	parseSpacingBody,
	parseAnimateBody,
	parseFluidBody,
	parsePreflightDirective,
	parseFontBody,
	parseNestedFontBlock,
	parseUtilityDirective,
	parseGroupedUtilityDirective,
	parseCustomVariantDirective,
	parseSourceDirective,
	parseRoundedModifier,
	parseLayerDirective,
} from "./parsers.js";

export { resolveDirectives } from "./resolver.js";
