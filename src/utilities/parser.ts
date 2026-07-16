/**
 * Parses utility class strings into structured tokens.
 *
 * "hover:bg-red-500"  → { variants: ["hover"], utility: "bg", value: "red-500" }
 * "sm:p-4"            → { variants: ["sm"], utility: "p", value: "4" }
 * "text-center!"      → { variants: [], utility: "text-center", value: null, important: true }
 * "p-[13px]"          → { variants: [], utility: "p", value: "[13px]", arbitrary: true }
 * "@md:flex"           → { variants: ["@md"], utility: "flex", value: null }
 * "pl-physical-4"     → { variants: [], utility: "pl", value: "4", physical: true }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedUtility {
	/** Original class string before parsing */
	raw: string;
	/** Variant prefixes in order, e.g. ["hover"], ["sm", "hover"] */
	variants: string[];
	/** The utility name (everything before the value separator), e.g. "bg", "p", "text" */
	utility: string;
	/** The value part after the last `-`, or null for valueless utilities like "flex" */
	value: string | null;
	/** Whether the value is an arbitrary bracket expression like [13px] */
	arbitrary: boolean;
	/** Whether !important is applied */
	important: boolean;
	/** Whether the -physical- infix is present */
	physical: boolean;
	/** Whether the utility is negative (prefixed with -) */
	negative: boolean;
	/** When the class is an arbitrary property like [color:red] */
	arbitraryProperty: { property: string; value: string } | null;
	/**
	 * Explicit type hint extracted from an arbitrary value, e.g. the `length`
	 * in `border-[length:1rem]` or `border-(color:--my-color)`. When set, it
	 * forces a specific dispatch path in generators — see `borderGenerator`,
	 * `colorGenerator`, etc. Null when no hint was provided.
	 */
	dataType: string | null;
}

/**
 * Recognized arbitrary-value type hints (mirrors Tailwind v4). Single source
 * for the hint validator, the sanitizer's hint-strip pass, and color.ts's
 * non-color-hint rejection.
 */
export const ARBITRARY_TYPE_HINTS: readonly string[] = Object.freeze([
	"length",
	"color",
	"url",
	"image",
	"number",
	"percentage",
	"angle",
	"time",
	"position",
	"family-name",
	"line-width",
	"any",
]);
const TYPE_HINT_ALTERNATION = ARBITRARY_TYPE_HINTS.join("|");
const VALID_TYPE_HINT_RE = new RegExp(`^(?:${TYPE_HINT_ALTERNATION})$`);
const TYPE_HINT_STRIP_RE = new RegExp(`^(?:${TYPE_HINT_ALTERNATION}):`);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Precompiled regex for -physical- infix detection (avoids per-call allocation). */
const PHYSICAL_RE = /^(.+)-physical-(.+)$/;

/**
 * Static utilities that are complete names with no value part.
 * These are matched whole — "flex" is a utility, not prefix "fle" + value "x".
 *
 * Shared utility metadata is centralized in utilities/metadata.ts so parser and
 * merge runtime drift less during refactors.
 */
import { STATIC_UTILITIES, MULTI_SEGMENT_PREFIXES } from "./metadata.js";
import { buildFirstSegmentMap } from "../merge/props.js";
import { addWhitespaceAroundMathOperators } from "./math-operators.js";
export {
	STATIC_UTILITIES,
	PARSER_ONLY_STATICS,
	MULTI_SEGMENT_PREFIXES,
} from "./metadata.js";

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Single construction site for ParsedUtility so every parse result shares one
 * object shape — parseUtility runs per class and its result feeds megamorphic
 * dispatch; mixed shapes would make those sites polymorphic.
 */
function makeParsed(
	raw: string,
	variants: string[],
	utility: string,
	value: string | null,
	arbitrary: boolean,
	important: boolean,
	physical: boolean,
	negative: boolean,
	arbitraryProperty: { property: string; value: string } | null = null,
	dataType: string | null = null,
): ParsedUtility {
	return {
		raw,
		variants,
		utility,
		value,
		arbitrary,
		important,
		physical,
		negative,
		arbitraryProperty,
		dataType,
	};
}

/**
 * Parse a single utility class string into its structural components.
 */
export function parseUtility(raw: string): ParsedUtility {
	const input = raw;
	let important = false;
	let negative = false;

	// Extract variants — split by ":" but respect brackets and @-prefixed variants
	const variants: string[] = [];
	let remaining = input;

	for (;;) {
		const colonIdx = findVariantColon(remaining);
		if (colonIdx === -1) break;

		const variant = remaining.slice(0, colonIdx);
		if (!variant) break;

		variants.push(variant);
		remaining = remaining.slice(colonIdx + 1);
	}

	// Handle !important suffix (e.g. p-4!, hover:bg-red-500!)
	if (remaining.endsWith("!")) {
		important = true;
		remaining = remaining.slice(0, -1);
	}

	// Arbitrary property: [color:red], [-webkit-box-decoration-break:clone], [--my-var:value]
	if (remaining.startsWith("[") && remaining.endsWith("]")) {
		const inner = remaining.slice(1, -1);
		// Find the first colon at depth 0 (skip nested brackets/parens)
		const colonIdx = findArbitraryPropertyColon(inner);
		if (colonIdx !== -1) {
			const property = inner.slice(0, colonIdx);
			const rawValue = inner.slice(colonIdx + 1);
			if (property && rawValue && ARBITRARY_PROPERTY_RE.test(property)) {
				// Reject values with top-level dangerous characters outright
				if (DANGEROUS_CHARS_RE.test(rawValue))
					return makeParsed(raw, variants, remaining, null, false, important, false, false);
				// Sanitize value using existing sanitization chain
				const sanitized = sanitizeArbitraryValue(`[${rawValue}]`);
				if (sanitized !== null) {
					const decodedValue = decodeArbitraryValue(sanitized.slice(1, -1));
					return makeParsed(raw, variants, `[${property}]`, null, false, important, false, false, {
						property,
						value: decodedValue,
					});
				}
			}
		}
	}

	// Handle negative prefix (after variants). Only treat as negative when a
	// lowercase letter follows the dash (mirrors resolvePropsWith in merge).
	if (remaining.charCodeAt(0) === 45 /* '-' */ && remaining.length > 1) {
		const next = remaining.charCodeAt(1);
		if (next >= 97 && next <= 122 && !remaining.startsWith("-physical-")) {
			negative = true;
			remaining = remaining.slice(1);
		}
	}

	let physical = false;
	// Check for -physical- infix only when there is no arbitrary bracket value.
	// Bracket content may legitimately contain "-physical-" substrings (e.g. URLs),
	// and must not be rewritten.
	if (!remaining.includes("[")) {
		const physicalMatch = remaining.match(PHYSICAL_RE);
		if (physicalMatch) {
			physical = true;
			remaining = `${physicalMatch[1]}-${physicalMatch[2]}`;
		}
	}

	// Check for static utility (whole match)
	if (STATIC_UTILITIES.has(remaining)) {
		return makeParsed(raw, variants, remaining, null, false, important, physical, negative);
	}

	// Check for arbitrary value: look for [...] at the end
	// Skip if preceded by `/` — that's a modifier like bg-error-500/[50%], not a value.
	const bracketStart = remaining.indexOf("[");
	if (bracketStart !== -1 && (bracketStart === 0 || remaining[bracketStart - 1] !== "/")) {
		const bracketEnd = findMatchingBracket(remaining, bracketStart);
		if (bracketEnd === remaining.length - 1) {
			let utility = remaining.slice(0, bracketStart);
			if (utility.endsWith("-")) utility = utility.slice(0, -1);
			// Support arbitrary values with the -physical- infix, e.g. p-physical-[2rem].
			if (utility.endsWith("-physical")) {
				physical = true;
				utility = utility.slice(0, -"-physical".length);
			}
			// Extract a leading type hint (`length:`, `color:`, …) before sanitizing.
			// sanitizeArbitraryValue also strips recognized hints as defense-in-depth,
			// but we need the hint itself — generators use it to force dispatch
			// (e.g. border-[color:var(--x)] → border-color even when var() is ambiguous).
			let dataType: string | null = null;
			let innerValue = remaining.slice(bracketStart + 1, bracketEnd);
			const hintColonIdx = innerValue.indexOf(":");
			if (hintColonIdx > 0) {
				const maybeHint = innerValue.slice(0, hintColonIdx);
				if (VALID_TYPE_HINT_RE.test(maybeHint)) {
					dataType = maybeHint;
					innerValue = innerValue.slice(hintColonIdx + 1);
				}
			}
			const value = sanitizeArbitraryValue(`[${innerValue}]`);
			if (value !== null) {
				return makeParsed(
					raw,
					variants,
					utility || remaining,
					value,
					true,
					important,
					physical,
					negative,
					null,
					dataType,
				);
			}
		}
	}

	// CSS variable shorthand: bg-(--my-color) or bg-(color:--my-color)
	const parenVarIdx = remaining.indexOf("-(");
	if (parenVarIdx !== -1 && remaining.endsWith(")")) {
		let inner = remaining.slice(parenVarIdx + 2, -1);
		let utility = remaining.slice(0, parenVarIdx);
		// Support -physical- infix: p-physical-(--var)
		if (utility.endsWith("-physical")) {
			physical = true;
			utility = utility.slice(0, -"-physical".length);
		}
		// Extract type hint: "color:--my-var" → dataType "color", inner "--my-var"
		let dataType: string | null = null;
		const typeHintIdx = inner.indexOf(":");
		if (typeHintIdx !== -1 && inner.slice(typeHintIdx + 1).startsWith("--")) {
			const maybeHint = inner.slice(0, typeHintIdx);
			if (VALID_TYPE_HINT_RE.test(maybeHint)) {
				dataType = maybeHint;
			}
			inner = inner.slice(typeHintIdx + 1);
		}
		// Validate CSS variable name
		if (VAR_SHORTHAND_RE.test(inner)) {
			// Allow fallback values: --var,fallback
			const commaIdx = inner.indexOf(",");
			const varExpr =
				commaIdx === -1
					? `var(${inner})`
					: `var(${inner.slice(0, commaIdx)},${decodeArbitraryValue(inner.slice(commaIdx + 1))})`;
			const value = `[${varExpr}]`;
			return makeParsed(
				raw,
				variants,
				utility || remaining,
				value,
				true,
				important,
				physical,
				negative,
				null,
				dataType,
			);
		}
	}

	// Dynamic utility: split at the last dash to find utility prefix + value
	const { utility, value } = splitUtilityValue(remaining);

	return makeParsed(raw, variants, utility, value, false, important, physical, negative);
}

// ---------------------------------------------------------------------------
// Arbitrary value decoding (underscore → space)
// ---------------------------------------------------------------------------

/**
 * Decode underscores in arbitrary values to spaces, matching Tailwind behavior.
 * `\_` (escaped underscore) becomes a literal `_`.
 * Regular `_` becomes a space.
 */
export function decodeArbitraryValue(value: string): string {
	// Fast path: no underscore means nothing to decode (escapes only matter
	// when they precede an underscore).
	if (!value.includes("_")) return addWhitespaceAroundMathOperators(value);
	let output = "";
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === "\\" && value[i + 1] === "_") {
			output += "_";
			i++; // skip the underscore
		} else if (ch === "_") {
			output += " ";
		} else {
			output += ch;
		}
	}
	return addWhitespaceAroundMathOperators(output);
}

/** CSS custom-property name fragment — single source for the arbitrary-property
 *  validator and the `-(--var)` shorthand validator so the two grammars cannot
 *  drift. */
const CSS_VAR_NAME_SRC = "--[a-zA-Z_][a-zA-Z0-9_-]*";

/**
 * Regex for valid CSS property names: standard (`color`), vendor-prefixed
 * (`-webkit-mask-size`), or CSS custom properties (`--my-var`).
 */
const ARBITRARY_PROPERTY_RE = new RegExp(`^(?:${CSS_VAR_NAME_SRC}|-?[a-z][a-z0-9-]*)$`);

/** `-(--var)` shorthand: a custom property name plus an optional `,fallback`. */
const VAR_SHORTHAND_RE = new RegExp(`^${CSS_VAR_NAME_SRC}(?:,[^)]*)?$`);

/** Bare custom-property name (no fallback) — shared with the alpha-modifier
 *  `(--my-opacity)` validator in utilities/color.ts. */
export const CSS_VAR_NAME_RE = new RegExp(`^${CSS_VAR_NAME_SRC}$`);

/** Top-level characters that can break out of a CSS declaration context. */
const DANGEROUS_CHARS_RE = /[;{}]/;

// ---------------------------------------------------------------------------
// Arbitrary value sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize an arbitrary bracket value to prevent CSS injection.
 * Strips characters that could break out of a CSS declaration context
 * (semicolons, curly braces) and legacy CSS expression vectors.
 * The brackets themselves are preserved.
 */
/** Maximum allowed length for arbitrary bracket values to prevent oversized CSS output. */
const MAX_ARBITRARY_VALUE_LENGTH = 500;

export function sanitizeArbitraryValue(value: string): string | null {
	// Extract content between [ and ]
	const inner = value.slice(1, -1);
	// Reject empty brackets — [] has no valid meaning
	if (!inner) return null;
	// Reject excessively long values to prevent oversized CSS output
	if (inner.length > MAX_ARBITRARY_VALUE_LENGTH) return null;
	// Strip characters that break out of declaration context,
	// plus historical expression() and -moz-binding injection vectors
	// (retained defensively — these browsers are EOL but the vectors
	// remain in security scanners and compliance checklists).
	// Also neutralize CSS escape sequences (e.g., \65xpression) that
	// could bypass keyword filters, and javascript:/data: URL schemes.
	//
	// Targeted NFKC: only normalize characters in the injection-sensitive ranges
	// (fullwidth ASCII punctuation U+FF01–FF5E, presentation forms, etc.) to
	// collapse structural confusables (fullwidth parens/semicolons/braces) into
	// their ASCII equivalents where the subsequent sanitization can catch them.
	// This preserves legitimate Unicode (ligatures, CJK, emoji) in CSS content
	// values and font names while still defending against confusable bypasses.
	const targetedNfkc = inner.replace(/[\uff01-\uff5e\ufe10-\ufe6f\u2028\u2029]/g, (ch) =>
		ch === "\u2028" || ch === "\u2029" ? " " : ch.normalize("NFKC"),
	);
	// Strip C0/C1 control characters and any remaining Unicode structural
	// confusables that NFKC did not decompose to ASCII equivalents.
	const deconfused = Array.from(targetedNfkc)
		.filter((ch) => {
			const code = ch.charCodeAt(0);
			if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
				return false;
			}
			return !(
				ch === "\uff1b" ||
				ch === "\uff5b" ||
				ch === "\uff5d" ||
				ch === "\ufe5b" ||
				ch === "\ufe5d" ||
				ch === "\ufe14" ||
				ch === "\ufe54"
			);
		})
		.join("");
	const sanitized = deconfused
		// Strip CSS type hints (e.g., "length:2rem" → "2rem", "color:red" → "red")
		.replace(TYPE_HINT_STRIP_RE, "")
		.replace(/[;{}]/g, "")
		.replace(/\\[0-9a-fA-F]{1,6}\s?/g, "")
		.replace(/expression\s*\(/gi, "")
		.replace(/-moz-binding\s*:/gi, "")
		.replace(/url\s*\(\s*['"]?\s*javascript\s*:/gi, "url(about:")
		.replace(/url\s*\(\s*['"]?\s*data\s*:/gi, "url(about:")
		// Strip at-rule injection vectors (@import, @charset, @namespace, @keyframes)
		.replace(/@(?:import|charset|namespace|keyframes)\b/gi, "");
	// Reject if sanitization stripped all content
	if (!sanitized) return null;
	return `[${sanitized}]`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Find the colon that separates property from value in an arbitrary property
 * like `color:red`. Respects brackets/parens so `color:rgb(1,2,3)` works.
 * Returns -1 if no valid colon is found.
 */
function findArbitraryPropertyColon(inner: string): number {
	let depth = 0;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === "[" || ch === "(") depth++;
		else if (ch === "]" || ch === ")") depth--;
		else if (ch === ":" && depth === 0) return i;
	}
	return -1;
}

/**
 * Find the colon that separates a variant prefix from the rest.
 * Respects brackets so `data-[state=open]:` is one variant, not split at `[`.
 */
function findVariantColon(input: string): number {
	let depth = 0;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		// Skip CSS escape sequences: a backslash followed by 1-6 hex digits
		// (plus an optional trailing space), or a single non-hex character.
		// This prevents escaped brackets like \5d (']') from changing depth.
		if (ch === "\\" && i + 1 < input.length) {
			const next = input[i + 1];
			if (isHexDigit(next)) {
				// Consume up to 6 hex digits + optional trailing whitespace
				let hexLen = 0;
				while (hexLen < 6 && i + 1 + hexLen < input.length && isHexDigit(input[i + 1 + hexLen]))
					hexLen++;
				i += hexLen; // position on last hex digit; loop's i++ advances past it
				// Optional single trailing whitespace after hex escape
				if (i + 1 < input.length && /\s/.test(input[i + 1])) i++;
			} else {
				i++; // skip single escaped character
			}
			continue;
		}
		if (ch === "[" || ch === "(") depth++;
		else if (ch === "]" || ch === ")") depth--;
		else if (ch === ":" && depth === 0) {
			// Verify the part before the colon looks like a variant
			const prefix = input.slice(0, i);
			if (isVariantPrefix(prefix)) return i;
			return -1;
		}
	}
	return -1;
}

/** Inline hex-digit check — faster than regex .test() in the hot findVariantColon loop. */
function isHexDigit(ch: string): boolean {
	const c = ch.charCodeAt(0);
	return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102); // 0-9, A-F, a-f
}
/** Precompiled regex for variant prefix validation (avoids per-call allocation). */
const VARIANT_PREFIX_RE = /^[a-z0-9][a-z0-9-]*(\[[^\]]*\])?$/;

/**
 * Check if a string looks like a variant prefix.
 */
function isVariantPrefix(s: string): boolean {
	if (!s) return false;
	// Arbitrary variants: [&_p], [&>*], [@media(width>=123px)]
	if (s.startsWith("[") && s.endsWith("]")) return true;
	// @ container query variants: @sm, @md, @sidebar/sm
	if (s.startsWith("@")) return true;
	// Child (*) and descendant (**) variants
	if (s === "*" || s === "**") return true;
	// Standard variants: hover, sm, focus, dark, data-[...], aria-[...], has-[...], not-*
	return VARIANT_PREFIX_RE.test(s);
}

/**
 * Find the matching closing bracket for an opening `[` at `start`.
 */
function findMatchingBracket(input: string, start: number): number {
	let depth = 0;
	for (let i = start; i < input.length; i++) {
		const ch = input[i];
		// Skip quoted strings to avoid matching ] inside e.g. url('image[1].png')
		if (ch === "'" || ch === '"') {
			const quote = ch;
			i++;
			while (i < input.length && input[i] !== quote) {
				if (input[i] === "\\" && i + 1 < input.length) i++;
				i++;
			}
			continue;
		}
		if (ch === "[") depth++;
		else if (ch === "]") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * Split a utility string into prefix and value at the last meaningful dash.
 *
 * "bg-red-500"  → { utility: "bg", value: "red-500" }
 * "p-4"         → { utility: "p", value: "4" }
 * "flex"        → { utility: "flex", value: null }
 * "text-2xl"    → { utility: "text", value: "2xl" }
 * "rounded-tl-lg" → { utility: "rounded-tl", value: "lg" }
 */
function splitUtilityValue(input: string): { utility: string; value: string | null } {
	// Single scan for the first dash (doubles as the has-dash check).
	const firstDash = input.indexOf("-");
	if (firstDash === -1) {
		return { utility: input, value: null };
	}

	// Try known multi-segment prefixes first (longest match wins).
	// Uses Map dispatch on first segment for O(1) lookup instead of O(P) linear scan.
	const firstSeg = input.slice(0, firstDash);
	const candidates = MULTI_SEGMENT_PREFIX_MAP.get(firstSeg);
	if (candidates) {
		for (const prefix of candidates) {
			// `input.startsWith(prefix + "-")` without the per-candidate template.
			if (input.startsWith(prefix) && input.charCodeAt(prefix.length) === 45 /* '-' */) {
				const value = input.slice(prefix.length + 1);
				return { utility: prefix, value: value || null };
			}
		}
	}

	// Default: split at first dash.
	const value = input.slice(firstDash + 1);

	return { utility: firstSeg, value: value || null };
}

/**
 * First-segment dispatch over the multi-segment utility prefixes that should
 * not be split at the first dash (longest-first within each bucket).
 *
 * **Derived from PREFIX_PROPS keys** — any multi-segment key (containing "-")
 * in PREFIX_PROPS is automatically included. assertPrefixPropParity()
 * in __tests__/helpers/merge-parity.ts validates the derivation.
 */
const MULTI_SEGMENT_PREFIX_MAP = buildFirstSegmentMap(MULTI_SEGMENT_PREFIXES);
