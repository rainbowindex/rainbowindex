/**
 * Variant resolution — maps variant names to CSS wrappers.
 *
 * Handles pseudo-classes, pseudo-elements, media queries, responsive breakpoints,
 * container queries, data/aria attributes, :has()/:not(), arbitrary variants,
 * and custom variants.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import { decodeArbitraryValue } from "../utilities/parser.js";
import { CSS_CUSTOM_IDENT_RE } from "../shared.js";

/** Maximum length for custom variant selectors to prevent CSS output explosion. */
const MAX_CUSTOM_VARIANT_SELECTOR_LENGTH = 500;

/** Validates that a breakpoint value looks like a CSS length (e.g. "640px", "40rem", "0.5em").
 *  Prevents injection of arbitrary CSS via user-provided breakpoint values. */
const SAFE_CSS_LENGTH_RE = /^\d+(\.\d+)?(px|em|rem|ch|vw|vh|svw|svh|dvw|dvh|cqw|cqh)$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VariantWrapper {
	/** Selector modifier (e.g. ":hover", "[data-state=open]"). */
	selectorSuffix?: string;
	/** At-rule wrapping (e.g. "@media (min-width: 640px)"). */
	atRule?: string;
	/** Nested starting-style. */
	startingStyle?: boolean;
	/** Replace `&` in selectorSuffix with the current selector. */
	replaceAmpersand?: boolean;
}

// ---------------------------------------------------------------------------
// Variant maps
// ---------------------------------------------------------------------------

const PSEUDO_CLASSES: Readonly<Record<string, string>> = Object.freeze({
	hover: ":hover",
	focus: ":focus",
	"focus-visible": ":focus-visible",
	"focus-within": ":focus-within",
	active: ":active",
	visited: ":visited",
	disabled: ":disabled",
	enabled: ":enabled",
	checked: ":checked",
	indeterminate: ":indeterminate",
	required: ":required",
	valid: ":valid",
	invalid: ":invalid",
	empty: ":empty",
	first: ":first-child",
	last: ":last-child",
	odd: ":nth-child(odd)",
	even: ":nth-child(even)",
	only: ":only-child",
	"first-of-type": ":first-of-type",
	"last-of-type": ":last-of-type",
	"only-of-type": ":only-of-type",
	target: ":target",
	default: ":default",
	optional: ":optional",
	"user-valid": ":user-valid",
	"user-invalid": ":user-invalid",
	"in-range": ":in-range",
	"out-of-range": ":out-of-range",
	"placeholder-shown": ":placeholder-shown",
	"details-content": ":details-content",
	autofill: ":autofill",
	"read-only": ":read-only",
});

const PSEUDO_ELEMENTS: Readonly<Record<string, string>> = Object.freeze({
	before: "::before",
	after: "::after",
	placeholder: "::placeholder",
	file: "::file-selector-button",
	marker: "::marker",
	selection: "::selection",
	"first-line": "::first-line",
	"first-letter": "::first-letter",
	backdrop: "::backdrop",
});

/** Build frozen singleton wrappers so resolveVariant returns shared objects for
 *  static lookups instead of allocating per call (same pattern as MEDIA_VARIANTS). */
function freezeSuffixWrappers(
	source: Readonly<Record<string, string>>,
): Readonly<Record<string, VariantWrapper>> {
	const out: Record<string, VariantWrapper> = {};
	for (const [name, selectorSuffix] of Object.entries(source)) {
		out[name] = Object.freeze({ selectorSuffix });
	}
	return Object.freeze(out);
}

const PSEUDO_CLASS_WRAPPERS = freezeSuffixWrappers(PSEUDO_CLASSES);
const PSEUDO_ELEMENT_WRAPPERS = freezeSuffixWrappers(PSEUDO_ELEMENTS);

const MEDIA_VARIANTS: Readonly<Record<string, VariantWrapper>> = Object.freeze({
	dark: { atRule: "@media (prefers-color-scheme: dark)" },
	portrait: { atRule: "@media (orientation: portrait)" },
	landscape: { atRule: "@media (orientation: landscape)" },
	print: { atRule: "@media print" },
	"motion-safe": { atRule: "@media (prefers-reduced-motion: no-preference)" },
	"motion-reduce": { atRule: "@media (prefers-reduced-motion: reduce)" },
	light: { atRule: "@media (prefers-color-scheme: light)" },
	"contrast-more": { atRule: "@media (prefers-contrast: more)" },
	"contrast-less": { atRule: "@media (prefers-contrast: less)" },
	"forced-colors": { atRule: "@media (forced-colors: active)" },
	"inverted-colors": { atRule: "@media (inverted-colors: inverted)" },
	"pointer-fine": { atRule: "@media (pointer: fine)" },
	"pointer-coarse": { atRule: "@media (pointer: coarse)" },
	"pointer-none": { atRule: "@media (pointer: none)" },
	"any-pointer-fine": { atRule: "@media (any-pointer: fine)" },
	"any-pointer-coarse": { atRule: "@media (any-pointer: coarse)" },
	"any-pointer-none": { atRule: "@media (any-pointer: none)" },
	noscript: { atRule: "@media (scripting: none)" },
	starting: { startingStyle: true },
});

// Special selectors that embed `&` or use complex :is()/:where() forms.
const SPECIAL_SELECTORS: Readonly<Record<string, VariantWrapper>> = Object.freeze({
	inert: { selectorSuffix: "&:is([inert], [inert] *)", replaceAmpersand: true },
	rtl: { selectorSuffix: '&:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)', replaceAmpersand: true },
	ltr: { selectorSuffix: '&:where(:dir(ltr), [dir="ltr"], [dir="ltr"] *)', replaceAmpersand: true },
	open: { selectorSuffix: "&:is([open], :popover-open, :open)", replaceAmpersand: true },
	"*": { selectorSuffix: ":is(& > *)", replaceAmpersand: true },
	"**": { selectorSuffix: ":is(& *)", replaceAmpersand: true },
});

// nth-* families — checked longest-first so nth-[…] doesn't shadow nth-of-type-[…].
const NTH_VARIANTS: ReadonlyArray<readonly [string, string]> = [
	["nth-last-of-type-[", "nth-last-of-type"],
	["nth-of-type-[", "nth-of-type"],
	["nth-last-[", "nth-last-child"],
	["nth-[", "nth-child"],
];

// ---------------------------------------------------------------------------
// Bracket sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize bracket content used in variant selectors (group-/peer-/in-/data-/
 * aria-/has-/not-[...]). Decodes underscores to spaces (same as plain arbitrary
 * variants, so `has-[.a_.b]` can express `:has(.a .b)`), then strips characters
 * that could break out of the selector context: curly braces, semicolons, and
 * unbalanced parentheses. Returns null if the result is empty.
 */
// Characters that break CSS structure / allow rule injection. The g-flagged
// instance is used with .replace() only (which resets lastIndex).
const STRUCTURE_BREAK_RE = /[{};]/;
const STRUCTURE_BREAK_STRIP_RE = /[{};]/g;

/** Balanced-paren check — unbalanced parens can break out of :has()/:not(). */
function hasBalancedParens(s: string): boolean {
	let depth = 0;
	for (const ch of s) {
		if (ch === "(") depth++;
		else if (ch === ")") depth--;
		if (depth < 0) return false;
	}
	return depth === 0;
}

function sanitizeVariantBracket(inner: string): string | null {
	const decoded = decodeArbitraryValue(inner);
	const cleaned = decoded.replace(STRUCTURE_BREAK_STRIP_RE, "");
	if (!cleaned) return null;
	if (!hasBalancedParens(cleaned)) return null;
	return cleaned;
}

// ---------------------------------------------------------------------------
// Arbitrary variant resolution
// ---------------------------------------------------------------------------

/** Safe at-rule types for arbitrary variant at-rules. */
const SAFE_AT_RULE_RE = /^@(?:media|supports|container|layer)\b/;

/**
 * group-/peer-style relational variants: `{anchor}{pseudo}{combinator}` or the
 * bracket form `{anchor}:is(sel){combinator}`. A failed bracket sanitization
 * returns null (terminate — never fall through to other interpretations);
 * `undefined` means no match and the caller keeps resolving.
 */
function resolveRelationalVariant(
	inner: string,
	anchor: string,
	combinator: string,
): VariantWrapper | null | undefined {
	if (inner.startsWith("[") && inner.endsWith("]")) {
		const sel = sanitizeVariantBracket(inner.slice(1, -1));
		return sel
			? { selectorSuffix: `${anchor}:is(${sel})${combinator}`, replaceAmpersand: true }
			: null;
	}
	if (Object.hasOwn(PSEUDO_CLASSES, inner)) {
		return {
			selectorSuffix: `${anchor}${PSEUDO_CLASSES[inner]}${combinator}`,
			replaceAmpersand: true,
		};
	}
	return undefined;
}

/** Strict attribute-name grammar for the boolean data-/aria- forms. */
const ATTR_NAME_RE = /^[a-z][a-z0-9-]*$/i;

/**
 * data-/aria- attribute variants: bracket form `prefix-[attr=val]` (a failed
 * sanitization terminates — never falls through to the boolean path) or the
 * strict boolean `prefix-{attr}` form. `undefined` means no match.
 */
function resolveAttributeVariant(
	variant: string,
	attrPrefix: string,
	booleanSuffix: string,
): VariantWrapper | null | undefined {
	if (variant.charCodeAt(attrPrefix.length + 1) === 91 /* '[' */ && variant.endsWith("]")) {
		const inner = sanitizeVariantBracket(variant.slice(attrPrefix.length + 2, -1));
		return inner ? { selectorSuffix: `[${attrPrefix}-${inner}]` } : null;
	}
	const attr = variant.slice(attrPrefix.length + 1);
	if (ATTR_NAME_RE.test(attr)) {
		return { selectorSuffix: `[${attrPrefix}-${attr}${booleanSuffix}]` };
	}
	return undefined;
}

/**
 * Resolve an arbitrary variant like `[&_p]`, `[&>*]`, or `[@media(width>=123px)]`.
 */
function resolveArbitraryVariant(variant: string): VariantWrapper | null {
	const inner = variant.slice(1, -1);
	if (!inner || inner.length > MAX_CUSTOM_VARIANT_SELECTOR_LENGTH) return null;

	// Decode underscores to spaces
	const decoded = decodeArbitraryValue(inner);

	// Reject values containing dangerous structure-breaking characters
	if (STRUCTURE_BREAK_RE.test(decoded)) return null;

	if (!hasBalancedParens(decoded)) return null;

	// At-rule variant: [@media(width>=123px)]
	if (decoded.startsWith("@")) {
		if (!SAFE_AT_RULE_RE.test(decoded)) return null;
		return { atRule: decoded };
	}

	// Selector with & — replace & with the base selector
	if (decoded.includes("&")) {
		return { selectorSuffix: decoded, replaceAmpersand: true };
	}

	// Relative combinator: [>div], [+svg], [~span]
	const first = decoded[0];
	if (first === ">" || first === "+" || first === "~") {
		return { selectorSuffix: `& ${decoded}`, replaceAmpersand: true };
	}

	// Plain selector: [p], [.active] — self-match via &:is(...)
	return { selectorSuffix: `:is(${decoded})` };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a variant name to its CSS wrapper.
 *
 * `memo` caches results (including null misses) per variant name. It is only
 * valid for a single (theme, customVariantMap) pair — callers own that
 * invariant; the engine allocates one per compilation.
 */
export function resolveVariant(
	variant: string,
	theme: ResolvedTheme,
	customVariantMap?: ReadonlyMap<string, { name: string; selector: string }>,
	memo?: Map<string, VariantWrapper | null>,
): VariantWrapper | null {
	if (!memo) return resolveVariantUncached(variant, theme, customVariantMap);
	const cached = memo.get(variant);
	if (cached !== undefined) return cached;
	const wrapper = resolveVariantUncached(variant, theme, customVariantMap);
	memo.set(variant, wrapper);
	return wrapper;
}

function resolveVariantUncached(
	variant: string,
	theme: ResolvedTheme,
	customVariantMap?: ReadonlyMap<string, { name: string; selector: string }>,
): VariantWrapper | null {
	// Arbitrary variants: [&_p], [@media(width>=123px)]
	if (variant.startsWith("[") && variant.endsWith("]")) {
		return resolveArbitraryVariant(variant);
	}

	// Responsive breakpoints: sm, md, lg, xl
	if (Object.hasOwn(theme.breakpoints, variant)) {
		const bp = theme.breakpoints[variant];
		if (!SAFE_CSS_LENGTH_RE.test(bp)) return null;
		return { atRule: `@media (min-width: ${bp})` };
	}

	// Arbitrary width ranges: min-[600px], max-[40rem]
	if (variant.startsWith("min-[") && variant.endsWith("]")) {
		const v = variant.slice(5, -1);
		return SAFE_CSS_LENGTH_RE.test(v) ? { atRule: `@media (width >= ${v})` } : null;
	}
	if (variant.startsWith("max-[") && variant.endsWith("]")) {
		const v = variant.slice(5, -1);
		return SAFE_CSS_LENGTH_RE.test(v) ? { atRule: `@media (width < ${v})` } : null;
	}

	// Container query variants: @sm, @md, etc.
	if (variant.startsWith("@")) {
		const rest = variant.slice(1);
		// Named container: @sidebar/sm — validate name to prevent at-rule injection
		const slashIdx = rest.indexOf("/");
		if (slashIdx !== -1) {
			const containerName = rest.slice(0, slashIdx);
			const bp = rest.slice(slashIdx + 1);
			if (Object.hasOwn(theme.breakpoints, bp) && CSS_CUSTOM_IDENT_RE.test(containerName)) {
				const bpVal = theme.breakpoints[bp];
				if (!SAFE_CSS_LENGTH_RE.test(bpVal)) return null;
				return { atRule: `@container ${containerName} (min-width: ${bpVal})` };
			}
		}
		// Unnamed container
		if (Object.hasOwn(theme.breakpoints, rest)) {
			const bpVal = theme.breakpoints[rest];
			if (!SAFE_CSS_LENGTH_RE.test(bpVal)) return null;
			return { atRule: `@container (min-width: ${bpVal})` };
		}
	}

	if (Object.hasOwn(PSEUDO_CLASS_WRAPPERS, variant)) {
		return PSEUDO_CLASS_WRAPPERS[variant];
	}

	// group-{pseudo}/group-[sel]: style descendant when ancestor .group matches.
	if (variant.startsWith("group-")) {
		const r = resolveRelationalVariant(variant.slice(6), ".group", " &");
		if (r !== undefined) return r;
	}

	// peer-{pseudo}/peer-[sel]: style a following sibling when a preceding .peer matches.
	if (variant.startsWith("peer-")) {
		const r = resolveRelationalVariant(variant.slice(5), ".peer", " ~ &");
		if (r !== undefined) return r;
	}

	// in-[sel]: style when nested inside an element matching the selector.
	if (variant.startsWith("in-[") && variant.endsWith("]")) {
		const sel = sanitizeVariantBracket(variant.slice(4, -1));
		return sel ? { selectorSuffix: `:where(${sel}) &`, replaceAmpersand: true } : null;
	}

	if (Object.hasOwn(PSEUDO_ELEMENT_WRAPPERS, variant)) {
		return PSEUDO_ELEMENT_WRAPPERS[variant];
	}

	// Media query variants and starting style — O(1) lookup
	if (Object.hasOwn(MEDIA_VARIANTS, variant)) return MEDIA_VARIANTS[variant];

	// Special selectors: inert, rtl, ltr, open, *, **
	if (Object.hasOwn(SPECIAL_SELECTORS, variant)) return SPECIAL_SELECTORS[variant];

	// supports-[condition]
	if (variant.startsWith("supports-[") && variant.endsWith("]")) {
		const inner = decodeArbitraryValue(variant.slice(10, -1));
		if (!inner || inner.length > MAX_CUSTOM_VARIANT_SELECTOR_LENGTH || /[{}]/.test(inner))
			return null;
		return { atRule: `@supports ${inner.startsWith("(") ? inner : `(${inner})`}` };
	}

	// nth-[An+B] / nth-last-[…] / nth-of-type-[…] / nth-last-of-type-[…]
	for (const [prefix, fn] of NTH_VARIANTS) {
		if (variant.startsWith(prefix) && variant.endsWith("]")) {
			const arg = variant.slice(prefix.length, -1).trim();
			return /^(odd|even|[-+\dn\s]+)$/i.test(arg) ? { selectorSuffix: `:${fn}(${arg})` } : null;
		}
	}

	// data-[attr=val] / data-{attr} (boolean)
	if (variant.startsWith("data-")) {
		const r = resolveAttributeVariant(variant, "data", "");
		if (r !== undefined) return r;
	}

	// aria-[attr=val] / aria-{attr} (true)
	if (variant.startsWith("aria-")) {
		const r = resolveAttributeVariant(variant, "aria", '="true"');
		if (r !== undefined) return r;
	}

	// has-[selector]
	if (variant.startsWith("has-[") && variant.endsWith("]")) {
		const inner = sanitizeVariantBracket(variant.slice(5, -1));
		if (inner) return { selectorSuffix: `:has(${inner})` };
	}

	// not-{pseudo} or not-[selector] — unknown names fall through to the custom
	// variant map and then null (RI-1004) rather than emitting an invalid
	// pseudo-class like :not(:hoover), which would kill the whole rule.
	if (variant.startsWith("not-")) {
		const inner = variant.slice(4);
		if (inner.startsWith("[") && inner.endsWith("]")) {
			const sel = sanitizeVariantBracket(inner.slice(1, -1));
			if (sel) return { selectorSuffix: `:not(${sel})` };
		}
		if (Object.hasOwn(PSEUDO_CLASSES, inner)) {
			return { selectorSuffix: `:not(${PSEUDO_CLASSES[inner]})` };
		}
	}

	// Custom variants from theme (Map lookup for O(1) instead of linear scan)
	const cv = customVariantMap?.get(variant);
	if (cv) {
		// Guard against excessively long custom variant selectors that could
		// produce megabytes of CSS output per utility class.
		if (cv.selector.length > MAX_CUSTOM_VARIANT_SELECTOR_LENGTH) {
			return null;
		}
		// Sanitize: strip characters that could break CSS structure or inject
		// additional rules — same treatment as sanitizeVariantBracket.
		const sanitized = cv.selector.replace(STRUCTURE_BREAK_STRIP_RE, "");
		if (!sanitized) return null;
		// Check if it's an at-rule form (@media, @supports, @container, etc.)
		// Only allow known safe at-rule types to prevent @import/@charset injection.
		if (sanitized.startsWith("@")) {
			if (SAFE_AT_RULE_RE.test(sanitized)) {
				return { atRule: sanitized };
			}
			return null; // reject unknown at-rules (@import, @charset, etc.)
		}
		// If selector contains &, it needs ampersand replacement
		if (sanitized.includes("&")) {
			return { selectorSuffix: sanitized, replaceAmpersand: true };
		}
		return { selectorSuffix: sanitized };
	}

	return null;
}
