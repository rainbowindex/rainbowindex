/**
 * Directive tokenizer and facade exports.
 * Shared directive types and low-level parsing helpers live in foundation.ts.
 */

import type { DirectiveType, ParsedDirective } from "./foundation.js";
import { DIRECTIVE_TYPE_NAMES, findClosingBrace } from "./foundation.js";
import { isAtRuleBoundary } from "../shared.js";
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

/**
 * Single source of truth for all RI directive names.
 * Used by the PostCSS plugin, CLI, and Vite plugin for activation detection.
 *
 * NOTE: This set includes "apply" and "slot" which are NOT in the DirectiveType
 * union above. `@apply` is expanded by the PostCSS plugin's walkAtRules pass;
 * `@slot` is only meaningful inside a `@custom` body (consumed during directive
 * parsing), and a standalone `@slot` is flagged with RI-1037 by that same pass.
 * Both are kept here so hasRIActivation() still detects files that use them.
 */
export {
	APPLY_ALIASES,
	APPLY_LIKE_MATCH_RE,
	hasApplyLikeDirective,
} from "./apply-aliases.js";

import { APPLY_ALIASES } from "./apply-aliases.js";

export const DIRECTIVE_NAMES_SET = new Set<string>([
	...DIRECTIVE_TYPE_NAMES,
	"apply",
	...APPLY_ALIASES,
	"slot",
]);

/**
 * Build a regex fragment that matches a directive at-rule token.
 *
 * Matches the exact directive name only and excludes hyphenated standard
 * at-rules that share a prefix — `@custom` not `@custom-media`, `@font` not
 * `@font-face` — via the trailing `(?!-)` negative lookahead.
 */
export function directiveAtRulePattern(name: string): string {
	return `@${name}(?!-)\\b`;
}

/** Check if a character code is a valid at-rule name character ([\w-]).
 *  Uses direct charCode range checks instead of regex for hot-loop performance
 *  in scanAtRuleTokens and extractDirectives. */
export function isAtRuleNameChar(code: number): boolean {
	// a-z: 97-122 (most common), A-Z: 65-90, 0-9: 48-57, _: 95, -: 45
	return (
		(code >= 97 && code <= 122) ||
		(code >= 65 && code <= 90) ||
		(code >= 48 && code <= 57) ||
		code === 95 ||
		code === 45
	);
}
// isAtRuleBoundary is imported from shared.ts — single source of truth.
/** Precompiled whitespace regex for whitespace-skipping loops in directive parsing. */
const WS_RE = /\s/;

const CC_NEWLINE = 10;
const CC_QUOTE_DOUBLE = 34;
const CC_QUOTE_SINGLE = 39;
const CC_PAREN_OPEN = 40;
const CC_PAREN_CLOSE = 41;
const CC_STAR = 42;
const CC_SLASH = 47;
const CC_AT = 64;
const CC_BACKSLASH = 92;

/**
 * Shared at-rule scanner: walks `src` outside comments and strings, tracking
 * paren depth so `//` inside `url(...)` is content rather than a line comment
 * (line comments are skipped only at depth 0, matching extractDirectives).
 * One charCodeAt read per position — this runs over entire stylesheets.
 *
 * `onAtRule` fires for each `@name` token found at a valid at-rule boundary.
 * Return `true` to stop the scan (the scan result becomes true), a number to
 * continue from that index (e.g. past a consumed directive body), or
 * `undefined` to continue from the end of the name.
 */
function scanAtRules(
	src: string,
	onAtRule: (name: string, atPos: number, nameEnd: number) => number | boolean | undefined,
	onLineComment?: (pos: number) => void,
): boolean {
	const len = src.length;
	let i = 0;
	let parenDepth = 0;
	while (i < len) {
		const c = src.charCodeAt(i);
		if (c === CC_SLASH) {
			const next = src.charCodeAt(i + 1);
			if (next === CC_STAR) {
				const end = src.indexOf("*/", i + 2);
				i = end === -1 ? len : end + 2;
				continue;
			}
			if (next === CC_SLASH && parenDepth === 0) {
				onLineComment?.(i);
				const end = src.indexOf("\n", i + 2);
				i = end === -1 ? len : end + 1;
				continue;
			}
			i++;
			continue;
		}
		if (c === CC_QUOTE_DOUBLE || c === CC_QUOTE_SINGLE) {
			i++;
			while (i < len && src.charCodeAt(i) !== c) {
				if (src.charCodeAt(i) === CC_BACKSLASH && i + 1 < len) i++;
				i++;
			}
			if (i < len) i++;
			continue;
		}
		if (c === CC_PAREN_OPEN) {
			parenDepth++;
			i++;
			continue;
		}
		if (c === CC_PAREN_CLOSE) {
			// Clamped at 0 so a stray `)` cannot poison the rest of the scan.
			if (parenDepth > 0) parenDepth--;
			i++;
			continue;
		}
		if (c !== CC_AT) {
			i++;
			continue;
		}
		// Escaped or embedded `@` (e.g. the selector `.\@color\:red`) is not an at-rule.
		if (!isAtRuleBoundary(src, i)) {
			i++;
			continue;
		}

		let nameEnd = i + 1;
		while (nameEnd < len && isAtRuleNameChar(src.charCodeAt(nameEnd))) nameEnd++;
		if (nameEnd === i + 1) {
			i++;
			continue;
		}
		const result = onAtRule(src.slice(i + 1, nameEnd), i, nameEnd);
		if (result === true) return true;
		i = typeof result === "number" ? result : nameEnd;
	}
	return false;
}

/**
 * Scan at-rule tokens in source outside comments/strings.
 * Returns true when `predicate(name, nameEnd)` matches any discovered at-rule
 * name; `nameEnd` is the index just past the name, for prelude inspection.
 */
function scanAtRuleTokens(
	src: string,
	predicate: (name: string, nameEnd: number) => boolean,
): boolean {
	return scanAtRules(src, (name, _atPos, nameEnd) => (predicate(name, nameEnd) ? true : undefined));
}

function readQuotedImportTarget(
	src: string,
	start: number,
): { target: string | null; nextIndex: number } {
	const quote = src[start];
	if (quote !== '"' && quote !== "'") return { target: null, nextIndex: start };
	let i = start + 1;
	let target = "";
	while (i < src.length) {
		const ch = src[i];
		if (ch === "\\") {
			if (i + 1 < src.length) {
				target += src[i + 1];
				i += 2;
				continue;
			}
			break;
		}
		if (ch === quote) {
			return { target, nextIndex: i + 1 };
		}
		target += ch;
		i++;
	}
	return { target: null, nextIndex: i };
}

function readURLImportTarget(
	src: string,
	start: number,
): { target: string | null; nextIndex: number } {
	if (
		!src
			.slice(start, start + 3)
			.toLowerCase()
			.startsWith("url")
	) {
		return { target: null, nextIndex: start };
	}
	let i = start + 3;
	while (i < src.length && WS_RE.test(src[i])) i++;
	if (src[i] !== "(") return { target: null, nextIndex: i };
	i++;
	while (i < src.length && WS_RE.test(src[i])) i++;
	if (src[i] === '"' || src[i] === "'") {
		const quoted = readQuotedImportTarget(src, i);
		i = quoted.nextIndex;
		while (i < src.length && WS_RE.test(src[i])) i++;
		if (src[i] === ")") i++;
		return { target: quoted.target, nextIndex: i };
	}
	const targetStart = i;
	while (i < src.length && src[i] !== ")") i++;
	const target = src.slice(targetStart, i).trim();
	if (src[i] === ")") i++;
	return { target: target || null, nextIndex: i };
}

function scanImportTarget(src: string, paramsStart: number): string | null {
	let i = paramsStart;
	while (i < src.length && WS_RE.test(src[i])) i++;
	if (i >= src.length) return null;
	if (src[i] === '"' || src[i] === "'") {
		return readQuotedImportTarget(src, i).target;
	}
	return readURLImportTarget(src, i).target;
}

/** Import specifiers that activate RainbowIndex. Single source for the
 *  activation scan here, the PostCSS import matcher, and the strip regex. */
export const RI_IMPORT_SPECIFIERS: readonly string[] = Object.freeze([
	"rainbowindex",
	"rainbowindex/index.css",
]);

/** Regex-escaped alternation of RI_IMPORT_SPECIFIERS for embedding in patterns. */
export const RI_IMPORT_SPECIFIER_ALTERNATION = RI_IMPORT_SPECIFIERS.map((s) =>
	s.replace(/[/\\^$.*+?()[\]{}|]/g, "\\$&"),
).join("|");

const RI_IMPORT_TARGETS = new Set(RI_IMPORT_SPECIFIERS);

/**
 * Detect whether source activates RainbowIndex: any RI directive token
 * (including PostCSS-only `@apply` and `@slot`) or an `@import` of the
 * package CSS, outside comments/strings. One fused scan covers both.
 */
export function hasRIActivation(src: string): boolean {
	return scanAtRuleTokens(src, (fullName, nameEnd) => {
		if (DIRECTIVE_NAMES_SET.has(fullName)) return true;
		if (fullName !== "import") return false;
		const target = scanImportTarget(src, nameEnd);
		return target !== null && RI_IMPORT_TARGETS.has(target);
	});
}

/**
 * Detect whether a specific RI at-rule name exists outside comments/strings.
 * Exact-name match only (e.g. "apply" matches `@apply`).
 */
export function hasRIDirectiveName(src: string, name: string): boolean {
	return scanAtRuleTokens(src, (fullName) => fullName === name);
}

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

export function extractDirectives(src: string, warnings?: string[]): ParsedDirective[] {
	if (src.length > MAX_DIRECTIVE_INPUT_SIZE) {
		warnings?.push(
			`[RI-1019] CSS input exceeds ${MAX_DIRECTIVE_INPUT_SIZE / 1_048_576} MB limit (${(src.length / 1_048_576).toFixed(1)} MB). Skipping directive extraction.`,
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
				warnings?.push(
					`[RI-1202] @${fullName} is no longer supported — configure fonts inside a single @font { ${fullName.slice(5)}: … } block.`,
				);
				return undefined;
			}

			if (DIRECTIVE_TYPES.has(fullName)) {
				const directive = parseGenericDirective(src, nameEnd, fullName as DirectiveType);
				if (directive) {
					if (warnings) {
						const enclosing = standardBlockRanges.find((r) => atPos > r.start && atPos < r.end);
						if (enclosing) {
							warnings.push(
								`[RI-1036] @${fullName} at line ${lineNum(atPos)} is nested inside @${enclosing.name} — RI directives are resolved globally at build time, so the @${enclosing.name} condition is ignored. Move the directive to the top level of the stylesheet.`,
							);
						}
					}
					directives.push(directive.directive);
					return directive.end;
				}
				warnings?.push(
					`[RI-1012] @${fullName} directive at line ${lineNum(atPos)} could not be parsed (possible unmatched brace or missing semicolon). The directive was skipped.`,
				);
			}

			return undefined;
		},
		warnings
			? (pos) => {
					// CSS does not have single-line comments. We skip them as a
					// convenience for users, but warn since this is non-standard.
					warnings.push(
						`[RI-1011] Line ${lineNum(pos)}: Single-line comment (//) detected. CSS only supports /* */ comments — the rest of this line is skipped. Use /* … */ instead.`,
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
