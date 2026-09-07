/**
 * Variant resolution — maps variant names to CSS wrappers.
 *
 * Handles pseudo-classes, pseudo-elements, media queries, responsive breakpoints,
 * container queries, data/aria attributes, :has()/:not(), arbitrary variants,
 * and custom variants.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import type { DarkVariantStrategy } from "../theme/colors.js";
import { decodeArbitraryValue } from "../utilities/parser.js";
import { CSS_CUSTOM_IDENT_RE } from "../shared.js";
import { escapeSelector } from "../css/escape.js";
import { RELATIONAL_NAME_RE } from "../utilities/markers.js";

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
	/**
	 * This variant's form in the *media* world — see {@link applyVariantWrappers}.
	 *
	 * Some conditions cannot be written as one rule. `dark:` under the
	 * `appearance` strategy applies when `html[data-appearance="dark"]` is set,
	 * and *separately* when the OS prefers dark and no attribute has overridden
	 * it — a selector and a media query, which no single selector can join. This
	 * field holds the second of those; `selectorSuffix`/`atRule` hold the first.
	 *
	 * It is NOT an alternative that multiplies out. Every wrapper in a stack is
	 * in the same world, so a stack emits two branches whether it carries one
	 * such variant or six.
	 */
	alternate?: VariantWrapper;
}

// ---------------------------------------------------------------------------
// Variant maps
// ---------------------------------------------------------------------------

/**
 * A selector suffix paired with its cascade weight. Weights use the tier
 * encoding documented above VARIANT_WEIGHTS in engine/ordering.ts (the
 * hundreds digit is the tier). Keeping each variant's weight next to its
 * selector means a variant added here is weighted by construction instead of
 * silently falling into ordering.ts' unknown-variant tier (900).
 */
interface WeightedSuffix {
	suffix: string;
	weight: number;
}

/** A full VariantWrapper paired with its cascade weight (same tier encoding). */
interface WeightedWrapper {
	wrapper: VariantWrapper;
	weight: number;
}

const PSEUDO_CLASSES: Readonly<Record<string, WeightedSuffix>> = Object.freeze({
	hover: { suffix: ":hover", weight: 420 },
	focus: { suffix: ":focus", weight: 421 },
	"focus-visible": { suffix: ":focus-visible", weight: 424 },
	"focus-within": { suffix: ":focus-within", weight: 425 },
	active: { suffix: ":active", weight: 422 },
	visited: { suffix: ":visited", weight: 423 },
	disabled: { suffix: ":disabled", weight: 550 },
	enabled: { suffix: ":enabled", weight: 551 },
	checked: { suffix: ":checked", weight: 552 },
	indeterminate: { suffix: ":indeterminate", weight: 553 },
	required: { suffix: ":required", weight: 554 },
	valid: { suffix: ":valid", weight: 556 },
	invalid: { suffix: ":invalid", weight: 555 },
	empty: { suffix: ":empty", weight: 667 },
	first: { suffix: ":first-child", weight: 660 },
	last: { suffix: ":last-child", weight: 661 },
	odd: { suffix: ":nth-child(odd)", weight: 662 },
	even: { suffix: ":nth-child(even)", weight: 663 },
	only: { suffix: ":only-child", weight: 666 },
	"first-of-type": { suffix: ":first-of-type", weight: 664 },
	"last-of-type": { suffix: ":last-of-type", weight: 665 },
	"only-of-type": { suffix: ":only-of-type", weight: 668 },
	target: { suffix: ":target", weight: 436 },
	default: { suffix: ":default", weight: 557 },
	optional: { suffix: ":optional", weight: 558 },
	"user-valid": { suffix: ":user-valid", weight: 559 },
	"user-invalid": { suffix: ":user-invalid", weight: 560 },
	"in-range": { suffix: ":in-range", weight: 561 },
	"out-of-range": { suffix: ":out-of-range", weight: 562 },
	"placeholder-shown": { suffix: ":placeholder-shown", weight: 563 },
	"details-content": { suffix: ":details-content", weight: 669 },
	autofill: { suffix: ":autofill", weight: 564 },
	"read-only": { suffix: ":read-only", weight: 565 },
});

const PSEUDO_ELEMENTS: Readonly<Record<string, WeightedSuffix>> = Object.freeze({
	before: { suffix: "::before", weight: 895 },
	after: { suffix: "::after", weight: 896 },
	placeholder: { suffix: "::placeholder", weight: 889 },
	file: { suffix: "::file-selector-button", weight: 891 },
	marker: { suffix: "::marker", weight: 894 },
	selection: { suffix: "::selection", weight: 890 },
	"first-line": { suffix: "::first-line", weight: 892 },
	"first-letter": { suffix: "::first-letter", weight: 893 },
	backdrop: { suffix: "::backdrop", weight: 897 },
});

/** Build frozen singleton wrappers so resolveVariant returns shared objects for
 *  static lookups instead of allocating per call (same pattern as MEDIA_VARIANTS). */
function freezeSuffixWrappers(
	source: Readonly<Record<string, WeightedSuffix>>,
): Readonly<Record<string, VariantWrapper>> {
	const out: Record<string, VariantWrapper> = {};
	for (const [name, { suffix }] of Object.entries(source)) {
		out[name] = Object.freeze({ selectorSuffix: suffix });
	}
	return Object.freeze(out);
}

const PSEUDO_CLASS_WRAPPERS = freezeSuffixWrappers(PSEUDO_CLASSES);
const PSEUDO_ELEMENT_WRAPPERS = freezeSuffixWrappers(PSEUDO_ELEMENTS);

/** Pair a frozen singleton wrapper with its cascade weight — the freeze keeps
 *  the shared-object contract resolveVariant's static lookups rely on. */
function weighted(wrapper: VariantWrapper, weight: number): WeightedWrapper {
	return { wrapper: Object.freeze(wrapper), weight };
}

const MEDIA_VARIANTS: Readonly<Record<string, WeightedWrapper>> = Object.freeze({
	dark: weighted({ atRule: "@media (prefers-color-scheme: dark)" }, 0),
	portrait: weighted({ atRule: "@media (orientation: portrait)" }, 310),
	landscape: weighted({ atRule: "@media (orientation: landscape)" }, 311),
	print: weighted({ atRule: "@media print" }, 314),
	"motion-safe": weighted({ atRule: "@media (prefers-reduced-motion: no-preference)" }, 312),
	"motion-reduce": weighted({ atRule: "@media (prefers-reduced-motion: reduce)" }, 313),
	light: weighted({ atRule: "@media (prefers-color-scheme: light)" }, 315),
	"contrast-more": weighted({ atRule: "@media (prefers-contrast: more)" }, 316),
	"contrast-less": weighted({ atRule: "@media (prefers-contrast: less)" }, 317),
	"forced-colors": weighted({ atRule: "@media (forced-colors: active)" }, 318),
	"inverted-colors": weighted({ atRule: "@media (inverted-colors: inverted)" }, 319),
	"pointer-fine": weighted({ atRule: "@media (pointer: fine)" }, 320),
	"pointer-coarse": weighted({ atRule: "@media (pointer: coarse)" }, 321),
	"pointer-none": weighted({ atRule: "@media (pointer: none)" }, 322),
	"any-pointer-fine": weighted({ atRule: "@media (any-pointer: fine)" }, 323),
	"any-pointer-coarse": weighted({ atRule: "@media (any-pointer: coarse)" }, 324),
	"any-pointer-none": weighted({ atRule: "@media (any-pointer: none)" }, 325),
	noscript: weighted({ atRule: "@media (scripting: none)" }, 326),
	starting: weighted({ startingStyle: true }, 770),
});

// Special selectors that embed `&` or use complex :is()/:where() forms.
const SPECIAL_SELECTORS: Readonly<Record<string, WeightedWrapper>> = Object.freeze({
	inert: weighted({ selectorSuffix: "&:is([inert], [inert] *)", replaceAmpersand: true }, 670),
	rtl: weighted(
		{ selectorSuffix: '&:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)', replaceAmpersand: true },
		671,
	),
	ltr: weighted(
		{ selectorSuffix: '&:where(:dir(ltr), [dir="ltr"], [dir="ltr"] *)', replaceAmpersand: true },
		672,
	),
	open: weighted(
		{ selectorSuffix: "&:is([open], :popover-open, :open)", replaceAmpersand: true },
		437,
	),
	"*": weighted({ selectorSuffix: ":is(& > *)", replaceAmpersand: true }, 673),
	"**": weighted({ selectorSuffix: ":is(& *)", replaceAmpersand: true }, 674),
});

/**
 * name → cascade weight for every fixed variant defined above, folded from the
 * four tables. Consumed only by engine/ordering.ts, which assembles
 * VARIANT_WEIGHTS from this plus the residual entries the tables cannot supply
 * (the conventional breakpoint names and the group-/peer- composites).
 */
export const FIXED_VARIANT_WEIGHTS: Readonly<Record<string, number>> = (() => {
	const out: Record<string, number> = {};
	for (const [name, { weight }] of Object.entries(PSEUDO_CLASSES)) out[name] = weight;
	for (const [name, { weight }] of Object.entries(PSEUDO_ELEMENTS)) out[name] = weight;
	for (const [name, { weight }] of Object.entries(MEDIA_VARIANTS)) out[name] = weight;
	for (const [name, { weight }] of Object.entries(SPECIAL_SELECTORS)) out[name] = weight;
	return Object.freeze(out);
})();

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
 * Split `hover/item` into the state (`hover`) and the anchor (`.group\/item`).
 *
 * Named groups exist so nested markup can address the group it means:
 * `group-hover/item:` matches an ancestor carrying `group/item`, not just any
 * `.group`. The slash is found from the right and only outside brackets, so an
 * arbitrary value containing one (`group-[&[href^="/"]]`) is left intact.
 *
 * `anchor: null` means the text after the slash is not a usable name, which is
 * an error rather than a reason to fall through — silently ignoring the name
 * would style every group on the page.
 */
function splitRelationalName(
	rest: string,
	kind: "group" | "peer",
): { state: string; anchor: string | null } {
	let depth = 0;
	for (let i = rest.length - 1; i >= 0; i--) {
		const ch = rest[i];
		if (ch === "]" || ch === ")") depth++;
		else if (ch === "[" || ch === "(") depth--;
		else if (ch === "/" && depth === 0) {
			const name = rest.slice(i + 1);
			if (!RELATIONAL_NAME_RE.test(name)) return { state: rest, anchor: null };
			return { state: rest.slice(0, i), anchor: `.${escapeSelector(`${kind}/${name}`)}` };
		}
	}
	return { state: rest, anchor: `.${kind}` };
}

/**
 * The length a breakpoint name stands for, or null when the name is not one.
 *
 * Also the injection guard: the value is interpolated into an at-rule
 * unescaped, so a breakpoint whose value is not a plain CSS length resolves to
 * nothing at all rather than to a query it could break out of.
 */
function breakpointValue(name: string, theme: ResolvedTheme): string | null {
	if (!Object.hasOwn(theme.breakpoints, name)) return null;
	const value = theme.breakpoints[name];
	return SAFE_CSS_LENGTH_RE.test(value) ? value : null;
}

/** The width a `min-`/`max-` prefix bounds: a bracketed length, or a breakpoint name. */
function widthBound(rest: string, theme: ResolvedTheme): string | null {
	if (rest.startsWith("[") && rest.endsWith("]")) {
		const v = rest.slice(1, -1);
		return SAFE_CSS_LENGTH_RE.test(v) ? v : null;
	}
	return breakpointValue(rest, theme);
}

/**
 * How deep a variant may nest inside another. Every prefix consumes at least
 * one character, so recursion terminates on its own; this only bounds the
 * pathological `not-not-not-…` case before it costs anything.
 */
const MAX_VARIANT_NESTING = 6;

/**
 * A variant's selector, if it has one and nothing else.
 *
 * `group-<inner>` means "an ancestor `.group` is in state `<inner>`", which is
 * only meaningful when `<inner>` is a state the anchor can be in — a
 * pseudo-class, an attribute, a `:has()`. A variant that resolves to an at-rule
 * describes the viewport or the OS, not the anchor, and one that rewrites `&`
 * describes a position in the tree; neither can be pinned to an ancestor, so
 * both decline here and the caller reports the variant unknown.
 */
function plainSelectorOf(w: VariantWrapper | null): string | null {
	if (!w?.selectorSuffix) return null;
	if (w.replaceAmpersand || w.atRule || w.startingStyle || w.alternate) return null;
	return w.selectorSuffix;
}

/**
 * group-/peer-style relational variants: `{anchor}{pseudo}{combinator}` or the
 * bracket form `{anchor}:is(sel){combinator}`. A failed bracket sanitization
 * returns null (terminate — never fall through to other interpretations);
 * `undefined` means no match and the caller keeps resolving.
 *
 * Anything else is resolved as a variant in its own right, which is what makes
 * `group-data-[state=open]:` and `peer-has-[:checked]:` work: the inner segment
 * is not a second grammar to maintain, it is the same one.
 */
function resolveRelationalVariant(
	inner: string,
	anchor: string,
	combinator: string,
	resolveInner: (v: string) => VariantWrapper | null,
): VariantWrapper | null | undefined {
	if (inner.startsWith("[") && inner.endsWith("]")) {
		const sel = sanitizeVariantBracket(inner.slice(1, -1));
		if (!sel) return null;
		// `&` inside a relational bracket is the ANCHOR — the `.group` or `.peer`
		// element the selector describes — not the element being styled.
		// Substituting it here rather than leaving it to `applyVariantWrappers`,
		// which replaces `&` with the accumulated base selector: that turned
		// `group-[&.foo]:flex` into `.group:is(.group-\[…\]\:flex.foo) …`, a
		// selector matching an element that is its own ancestor. The trailing
		// combinator keeps its own `&`, which is the one that should become the
		// base.
		if (sel.includes("&")) {
			return {
				selectorSuffix: `${sel.replaceAll("&", anchor)}${combinator}`,
				replaceAmpersand: true,
			};
		}
		return { selectorSuffix: `${anchor}:is(${sel})${combinator}`, replaceAmpersand: true };
	}
	if (Object.hasOwn(PSEUDO_CLASSES, inner)) {
		return {
			selectorSuffix: `${anchor}${PSEUDO_CLASSES[inner].suffix}${combinator}`,
			replaceAmpersand: true,
		};
	}
	const nested = plainSelectorOf(resolveInner(inner));
	if (nested !== null) {
		return { selectorSuffix: `${anchor}${nested}${combinator}`, replaceAmpersand: true };
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
// Variant enumeration (editor tooling)
// ---------------------------------------------------------------------------

export type VariantKind =
	| "pseudo-class"
	| "pseudo-element"
	| "media"
	| "breakpoint"
	| "container"
	| "special"
	| "custom"
	| "pattern";

export interface VariantInfo {
	/** The variant as typed before the `:` — for patterns, the family prefix. */
	name: string;
	kind: VariantKind;
	/** What the variant emits — a selector suffix, an at-rule, or (for
	 *  patterns) a description of the accepted form. */
	wraps: string;
}

/** Open-ended variant families that take a payload rather than a fixed name.
 *  Enumerated for editor completions; resolveVariant is the validator. */
const VARIANT_PATTERNS: readonly VariantInfo[] = Object.freeze([
	{ name: "data-", kind: "pattern", wraps: "data-{attr} or data-[attr=value] → [data-…]" },
	{ name: "aria-", kind: "pattern", wraps: 'aria-{attr} → [aria-…="true"], or aria-[attr=value]' },
	{ name: "group-", kind: "pattern", wraps: "group-{pseudo} or group-[sel] → .group:… &" },
	{ name: "peer-", kind: "pattern", wraps: "peer-{pseudo} or peer-[sel] → .peer:… ~ &" },
	{ name: "in-", kind: "pattern", wraps: "in-[sel] → :where(sel) &" },
	{ name: "has-", kind: "pattern", wraps: "has-[sel] → :has(sel)" },
	{ name: "not-", kind: "pattern", wraps: "not-{pseudo} or not-[sel] → :not(…)" },
	{
		name: "nth-",
		kind: "pattern",
		wraps: "nth-[An+B], nth-last-[…], nth-of-type-[…], nth-last-of-type-[…]",
	},
	{ name: "supports-", kind: "pattern", wraps: "supports-[condition] → @supports (…)" },
	{ name: "min-", kind: "pattern", wraps: "min-[length] → @media (width >= …)" },
	{ name: "max-", kind: "pattern", wraps: "max-[length] → @media (width < …)" },
	{ name: "[…]", kind: "pattern", wraps: "[selector], [&_p], [@media(…)] — arbitrary variant" },
]);

/**
 * Enumerate every concrete variant the given theme resolves, plus the
 * open-ended pattern families. Concrete entries (kind ≠ "pattern") are
 * guaranteed to resolve via resolveVariant — the list mirrors its checks,
 * including the CSS-length guard on breakpoint values.
 */
export function listVariants(theme: ResolvedTheme): VariantInfo[] {
	const out: VariantInfo[] = [];
	for (const [name, value] of Object.entries(theme.breakpoints)) {
		if (!SAFE_CSS_LENGTH_RE.test(value)) continue;
		out.push({ name, kind: "breakpoint", wraps: `@media (min-width: ${value})` });
		out.push({ name: `@${name}`, kind: "container", wraps: `@container (min-width: ${value})` });
	}
	for (const [name, { suffix }] of Object.entries(PSEUDO_CLASSES)) {
		out.push({ name, kind: "pseudo-class", wraps: suffix });
	}
	for (const [name, { suffix }] of Object.entries(PSEUDO_ELEMENTS)) {
		out.push({ name, kind: "pseudo-element", wraps: suffix });
	}
	for (const [name, { wrapper }] of Object.entries(MEDIA_VARIANTS)) {
		out.push({ name, kind: "media", wraps: wrapper.atRule ?? "@starting-style" });
	}
	for (const [name, { wrapper }] of Object.entries(SPECIAL_SELECTORS)) {
		out.push({ name, kind: "special", wraps: wrapper.selectorSuffix ?? "" });
	}
	if (theme.customVariants.length > 0) {
		// The directive parser accepts custom selectors the resolver rejects
		// (its length cap is 2000 vs the resolver's 500, and the resolver also
		// nulls sanitize-to-empty selectors and non-allowlisted at-rules) —
		// only entries that actually resolve keep the "guaranteed" contract.
		const customVariantMap = new Map(theme.customVariants.map((cv) => [cv.name, cv] as const));
		for (const cv of theme.customVariants) {
			if (resolveVariant(cv.name, theme, customVariantMap) === null) continue;
			out.push({ name: cv.name, kind: "custom", wraps: cv.selector });
		}
	}
	out.push(...VARIANT_PATTERNS);
	return out;
}

/**
 * Build the wrapper for `dark:` / `light:` from the theme's chosen strategy.
 *
 * The whole point is that this agrees with when the *tokens* flip. Tokens use
 * `light-dark()`, which follows `color-scheme`, which the shipped preflight
 * drives from `html[data-appearance]` layered over the OS preference — so the
 * `appearance` strategy reproduces exactly that, in two branches:
 *
 *   :where(html[data-appearance="dark"]) &
 *   @media (prefers-color-scheme: dark) { :where(html:not([data-appearance="light"])) & }
 *
 * The first is the explicit choice; the second is the OS preference where the
 * page has not overridden it. `light:` is the mirror image.
 *
 * `:where()` keeps the added specificity at zero, so `dark:bg-white` still loses
 * to a later `bg-black` exactly as the media-query form does.
 */
function appearanceVariant(
	variant: "dark" | "light",
	strategy: DarkVariantStrategy,
): VariantWrapper {
	const media = MEDIA_VARIANTS[variant].wrapper;
	if (strategy.kind === "media") return media;
	if (strategy.kind === "selector") {
		// One branch: a selector strategy ignores the OS preference, as it does
		// in the Tailwind projects it exists for. The other appearance is the
		// negation, so `light:` under `selector(.dark)` means "not .dark".
		const sel = strategy.selector;
		return Object.freeze(
			variant === "dark"
				? { selectorSuffix: `:where(${sel}, ${sel} *) &`, replaceAmpersand: true }
				: { selectorSuffix: `:where(:not(${sel}, ${sel} *)) &`, replaceAmpersand: true },
		);
	}
	const overridden = variant === "dark" ? "light" : "dark";
	return Object.freeze({
		selectorSuffix: `:where(html[data-appearance="${variant}"]) &`,
		replaceAmpersand: true,
		alternate: Object.freeze({
			selectorSuffix: `:where(html:not([data-appearance="${overridden}"])) &`,
			replaceAmpersand: true,
			atRule: media.atRule,
		}),
	});
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
	depth = 0,
): VariantWrapper | null {
	/** Resolve a variant nested inside this one, e.g. the `data-[…]` of `group-data-[…]`. */
	const inner = (v: string): VariantWrapper | null =>
		depth >= MAX_VARIANT_NESTING
			? null
			: resolveVariantUncached(v, theme, customVariantMap, depth + 1);
	// Arbitrary variants: [&_p], [@media(width>=123px)]
	if (variant.startsWith("[") && variant.endsWith("]")) {
		return resolveArbitraryVariant(variant);
	}

	// Responsive breakpoints: sm, md, lg, xl
	{
		const bp = breakpointValue(variant, theme);
		if (bp !== null) return { atRule: `@media (min-width: ${bp})` };
	}

	// Width ranges: min-[600px], max-[40rem], and the named forms min-md, max-sm.
	//
	// A name that is not a breakpoint FALLS THROUGH rather than returning null:
	// `@custom max-touch { … }` is a legal custom variant, and claiming the whole
	// `max-` prefix here would swallow it.
	if (variant.startsWith("min-")) {
		const v = widthBound(variant.slice(4), theme);
		if (v !== null) return { atRule: `@media (width >= ${v})` };
	}
	if (variant.startsWith("max-")) {
		const v = widthBound(variant.slice(4), theme);
		if (v !== null) return { atRule: `@media (width < ${v})` };
	}

	// Container queries: @sm, @max-md, @sidebar/sm, @sidebar/max-md.
	//
	// Sizes here are breakpoint names only, never brackets: an arbitrary
	// container size is spelled `[@container(min-width:600px)]`, which
	// docs/class-syntax.md states, and accepting `@[600px]:` would contradict it
	// silently.
	if (variant.startsWith("@")) {
		const rest = variant.slice(1);
		const slashIdx = rest.indexOf("/");
		// A container name lands in the at-rule unescaped, so it is an ident or
		// this is not a container query at all.
		const named = slashIdx !== -1 && CSS_CUSTOM_IDENT_RE.test(rest.slice(0, slashIdx));
		if (slashIdx === -1 || named) {
			const scope = named ? `${rest.slice(0, slashIdx)} ` : "";
			const size = slashIdx === -1 ? rest : rest.slice(slashIdx + 1);
			const bp = breakpointValue(size, theme);
			if (bp !== null) return { atRule: `@container ${scope}(min-width: ${bp})` };
			if (size.startsWith("min-")) {
				const v = breakpointValue(size.slice(4), theme);
				if (v !== null) return { atRule: `@container ${scope}(width >= ${v})` };
			}
			if (size.startsWith("max-")) {
				const v = breakpointValue(size.slice(4), theme);
				if (v !== null) return { atRule: `@container ${scope}(width < ${v})` };
			}
		}
	}

	if (Object.hasOwn(PSEUDO_CLASS_WRAPPERS, variant)) {
		return PSEUDO_CLASS_WRAPPERS[variant];
	}

	// group-{pseudo}/group-[sel]: style descendant when ancestor .group matches.
	if (variant.startsWith("group-")) {
		const { state, anchor } = splitRelationalName(variant.slice(6), "group");
		if (anchor === null) return null;
		const r = resolveRelationalVariant(state, anchor, " &", inner);
		if (r !== undefined) return r;
	}

	// peer-{pseudo}/peer-[sel]: style a following sibling when a preceding .peer matches.
	if (variant.startsWith("peer-")) {
		const { state, anchor } = splitRelationalName(variant.slice(5), "peer");
		if (anchor === null) return null;
		const r = resolveRelationalVariant(state, anchor, " ~ &", inner);
		if (r !== undefined) return r;
	}

	// in-[sel] / in-{variant}: style when nested inside a matching ancestor.
	if (variant.startsWith("in-[") && variant.endsWith("]")) {
		const sel = sanitizeVariantBracket(variant.slice(4, -1));
		// `&` names nothing here that the rest of the bracket does not already
		// say — the ancestor IS what the selector describes — and emitting it
		// produced `:where(<this class>.foo)`, matching an element inside itself.
		return sel && !sel.includes("&")
			? { selectorSuffix: `:where(${sel}) &`, replaceAmpersand: true }
			: null;
	}
	if (variant.startsWith("in-")) {
		const nested = plainSelectorOf(inner(variant.slice(3)));
		if (nested !== null) {
			return { selectorSuffix: `:where(*${nested}) &`, replaceAmpersand: true };
		}
	}

	if (Object.hasOwn(PSEUDO_ELEMENT_WRAPPERS, variant)) {
		return PSEUDO_ELEMENT_WRAPPERS[variant];
	}

	// `dark:` and `light:` before the static table: which condition they mean is
	// the theme's decision, not a constant.
	if (variant === "dark" || variant === "light") {
		return appearanceVariant(variant, theme.darkConfig.variant);
	}

	// Media query variants and starting style — O(1) lookup
	if (Object.hasOwn(MEDIA_VARIANTS, variant)) return MEDIA_VARIANTS[variant].wrapper;

	// Special selectors: inert, rtl, ltr, open, *, **
	if (Object.hasOwn(SPECIAL_SELECTORS, variant)) return SPECIAL_SELECTORS[variant].wrapper;

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
		// The bare shorthand for a literal position: `nth-3`, `nth-of-type-2`.
		// Digits only — anything else is an An+B expression and belongs in
		// brackets, where it can be validated rather than guessed at.
		// `prefix` ends with the `[`; dropping it leaves the trailing dash.
		const bare = prefix.slice(0, -1);
		if (variant.startsWith(bare)) {
			const arg = variant.slice(bare.length);
			if (/^\d+$/.test(arg)) return { selectorSuffix: `:${fn}(${arg})` };
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
		const sel = sanitizeVariantBracket(variant.slice(5, -1));
		// A bare `&` inside `:has()` is not valid in the flat CSS this emits, and
		// an element cannot contain itself, so there is nothing to translate it
		// to. Rejecting is louder than shipping `:has(&.foo)`.
		if (sel && !sel.includes("&")) return { selectorSuffix: `:has(${sel})` };
	}
	if (variant.startsWith("has-")) {
		const nested = plainSelectorOf(inner(variant.slice(4)));
		if (nested !== null) return { selectorSuffix: `:has(${nested})` };
	}

	// not-{pseudo} or not-[selector] — unknown names fall through to the custom
	// variant map and then null (RI-1004) rather than emitting an invalid
	// pseudo-class like :not(:hoover), which would kill the whole rule.
	if (variant.startsWith("not-")) {
		const rest = variant.slice(4);
		if (rest.startsWith("[") && rest.endsWith("]")) {
			const sel = sanitizeVariantBracket(rest.slice(1, -1));
			// Same as `has-[…]`: `:not(&.foo)` is not valid flat CSS.
			if (sel && !sel.includes("&")) return { selectorSuffix: `:not(${sel})` };
		}
		if (Object.hasOwn(PSEUDO_CLASSES, rest)) {
			return { selectorSuffix: `:not(${PSEUDO_CLASSES[rest].suffix})` };
		}
		const nestedWrapper = inner(rest);
		const nested = plainSelectorOf(nestedWrapper);
		if (nested !== null) return { selectorSuffix: `:not(${nested})` };
		// `@media`/`@supports` carry their own negation, which is the only way to
		// say "not this condition" — a selector cannot.
		const atRule = nestedWrapper?.atRule;
		if (atRule && !nestedWrapper.selectorSuffix && !nestedWrapper.alternate) {
			const spaceIdx = atRule.indexOf(" ");
			if (spaceIdx !== -1) {
				const name = atRule.slice(0, spaceIdx);
				if (name === "@media" || name === "@supports") {
					return { atRule: `${name} not ${atRule.slice(spaceIdx + 1)}` };
				}
			}
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

// ---------------------------------------------------------------------------
// Variant application
// ---------------------------------------------------------------------------

/**
 * Split a selector list on top-level commas (not inside parentheses or brackets).
 */
export function splitSelectorList(selector: string): string[] {
	const results: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < selector.length; i++) {
		const ch = selector[i];
		if (ch === "(" || ch === "[") depth++;
		else if (ch === ")" || ch === "]") depth--;
		else if (ch === "," && depth === 0) {
			results.push(selector.slice(start, i).trim());
			start = i + 1;
		}
	}
	results.push(selector.slice(start).trim());
	return results.filter(Boolean);
}

/** Result of folding a wrapper stack over a base selector. */
export interface AppliedVariants {
	/** The wrapped selector (comma-joined when a wrapper fans out branches). */
	selector: string;
	/** At-rules to nest around the rule, outermost first (wrapper order). */
	atRules: string[];
	/** Whether any wrapper demands an @starting-style block. */
	startingStyle: boolean;
}

/**
 * The world in which a variant's `alternate` form applies — the OS preference
 * where no attribute overrode it. World 0 is the document's own attribute.
 */
const MEDIA_WORLD = 1;

/** Fold one wrapper onto one partially-applied branch, returning a new branch. */
function applyOneWrapper(applied: AppliedVariants, w: VariantWrapper): AppliedVariants {
	let selector = applied.selector;
	if (w.selectorSuffix) {
		const branches = splitSelectorList(selector);
		const suffix = w.selectorSuffix;
		selector = w.replaceAmpersand
			? branches.map((b) => suffix.replace(/&/g, b)).join(", ")
			: branches.map((b) => b + suffix).join(", ");
	}
	return {
		selector,
		atRules: w.atRule ? [...applied.atRules, w.atRule] : applied.atRules,
		startingStyle: applied.startingStyle || w.startingStyle === true,
	};
}

/**
 * Fold a stack of variant wrappers over a base selector — the cascade
 * semantics (suffix application order, `&` replacement, at-rule nesting
 * order, starting-style) shared by the engine's string emitter
 * (compileUtility) and @apply's AST emitter so the two can never drift.
 *
 * Suffixes apply per branch of the accumulated selector: when an earlier
 * wrapper produced a comma-bearing selector (e.g. a custom variant like
 * `(&:hover, &:focus)`), a later suffix lands on every branch rather than
 * only the last one.
 *
 * ## Worlds
 *
 * A wrapper carrying an {@link VariantWrapper.alternate} has two forms because
 * the condition it describes is settled in two different places: by an
 * attribute in the document, or by the OS preference where no attribute
 * overrode it. Those are the two *worlds*, and a stack is evaluated once in
 * each — never per wrapper.
 *
 * That distinction is the whole point. Folding per wrapper cross-products, so
 * `dark:dark:` would emit four rules instead of two; the two extra ask for an
 * `html` nested inside an `html` and match nothing, and the cost is 2^n in the
 * number of such variants a stack contains. Worlds are a property of the page,
 * not of the variant, so every wrapper in one stack reads the same one.
 */
export function applyVariantWrappers(
	baseSelector: string,
	wrappers: readonly VariantWrapper[],
): AppliedVariants[] {
	// The second world exists only if something in the stack distinguishes it,
	// which is the overwhelmingly common case of one branch.
	const worlds = wrappers.some((w) => w.alternate) ? 2 : 1;
	const out: AppliedVariants[] = [];
	for (let world = 0; world < worlds; world++) {
		let branch: AppliedVariants = { selector: baseSelector, atRules: [], startingStyle: false };
		for (const w of wrappers) {
			branch = applyOneWrapper(branch, world === MEDIA_WORLD ? (w.alternate ?? w) : w);
		}
		out.push(branch);
	}
	return out;
}
