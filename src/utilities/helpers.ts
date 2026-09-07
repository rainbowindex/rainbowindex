/**
 * Shared leaf helpers for the utility generators — result types, tiny
 * constructors, and value-grammar helpers. Lives below both the generators
 * and the dispatch index (which imports every generator) so that generators
 * never import their own aggregator: generator ↔ index cycles would let
 * modules observe partially initialized exports.
 */

import { decodeArbitraryValue } from "./parser.js";

export interface CSSDeclaration {
	property: string;
	value: string;
}

/**
 * A nested rule block inside a custom @utility body. `selector` is the authored
 * prelude verbatim (a nested selector like `&:focus-visible` or an at-rule like
 * `@media (min-width: 600px)`); both surfaces emit it with native CSS nesting so
 * the browser applies standard nesting semantics.
 */
export interface UtilityNestedBlock {
	selector: string;
	declarations: CSSDeclaration[];
	nested: UtilityNestedBlock[];
}

export interface UtilityResult {
	declarations: CSSDeclaration[];
	nestedSelector?: string;
	/** Nested rule blocks — only produced by custom @utility bodies. */
	nested?: UtilityNestedBlock[];
}

export const INTEGER_RE = /^\d+$/;
export const DECIMAL_RE = /^\d+(?:[._]\d+)?$/;

export function single(property: string, value: string): UtilityResult {
	return { declarations: [{ property, value }] };
}

export function multi(...pairs: Array<[string, string]>): UtilityResult {
	return {
		declarations: pairs.map(([property, value]) => ({ property, value })),
	};
}

/**
 * Whether every bracket, paren and quote in an arbitrary value closes.
 *
 * `p-[--x:(]` decodes to `--x:(`, which is emitted as `padding: --x:(;` — a
 * declaration no CSS parser can read, so the whole stylesheet fails rather than
 * the one bad class. Quoted spans are skipped, because `content-['(']` is
 * balanced and legal.
 */
function hasBalancedDelimiters(value: string): boolean {
	const open: string[] = [];
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === "\\") {
			i++;
		} else if (ch === '"' || ch === "'") {
			const quote = ch;
			i++;
			while (i < value.length && value[i] !== quote) {
				if (value[i] === "\\") i++;
				i++;
			}
			if (i >= value.length) return false;
		} else if (ch === "(" || ch === "[") {
			open.push(ch);
		} else if (ch === ")") {
			if (open.pop() !== "(") return false;
		} else if (ch === "]") {
			if (open.pop() !== "[") return false;
		}
	}
	return open.length === 0;
}

export function extractArbitrary(value: string | null): string | null {
	if (!value) return null;
	if (!value.startsWith("[") || !value.endsWith("]")) return null;
	// An empty bracket is not a value. Without this `p-[]` compiled to the
	// empty declaration `padding: ;` — invalid CSS from a class that is
	// obviously a typo. The scanner drops it too, but `@apply` and `safelist()`
	// reach here directly.
	const inner = value.slice(1, -1);
	if (inner === "") return null;
	const decoded = decodeArbitraryValue(inner);
	// Same reason as the empty bracket, one step further: a value that does not
	// close its own delimiters cannot be written into a declaration.
	return hasBalancedDelimiters(decoded) ? decoded : null;
}

export function normalizeDecimalToken(value: string): string {
	return value.replaceAll("_", ".");
}

export function spacingLookup(value: string, negative = false): string | null {
	if (value === "px") return negative ? "-1px" : "1px";
	if (!DECIMAL_RE.test(value)) return null;
	const normalized = normalizeDecimalToken(value);
	const num = Number(normalized);
	if (!Number.isFinite(num) || num < 0) return null;
	if (num === 0) return "0px";
	const expr = `calc(${normalized} * var(--spacing))`;
	return negative ? `calc(${normalized} * var(--spacing) * -1)` : expr;
}

/**
 * The fractions worth precomputing — Tailwind's own enumerated set, redundant
 * spellings (`2/4`, `3/6`) included, because a class someone writes has to
 * resolve whether or not it reduces.
 *
 * This is a lookup table, not the grammar. `fractionValue` below is the
 * grammar, and it falls through to a `calc()` for anything not listed: the
 * fraction space is infinite and Tailwind accepts all of it, so a table on its
 * own silently rejected `w-7/9`. The listed values are kept precomputed because
 * `50%` is both shorter and easier to read than `calc(1 / 2 * 100%)`.
 */
export const FRACTIONAL: Readonly<Record<string, string>> = Object.freeze({
	"1/2": "50%",
	"1/3": "33.333333%",
	"2/3": "66.666667%",
	"1/4": "25%",
	"2/4": "50%",
	"3/4": "75%",
	"1/5": "20%",
	"2/5": "40%",
	"3/5": "60%",
	"4/5": "80%",
	"1/6": "16.666667%",
	"2/6": "33.333333%",
	"3/6": "50%",
	"4/6": "66.666667%",
	"5/6": "83.333333%",
	"1/12": "8.333333%",
	"2/12": "16.666667%",
	"3/12": "25%",
	"4/12": "33.333333%",
	"5/12": "41.666667%",
	"6/12": "50%",
	"7/12": "58.333333%",
	"8/12": "66.666667%",
	"9/12": "75%",
	"10/12": "83.333333%",
	"11/12": "91.666667%",
});

/**
 * A fraction as a percentage of the element's own size, or null when the name
 * is not a fraction at all.
 *
 * Table first for the common set, then the general case. Every
 * percentage-valued family routes through here so they cannot disagree about
 * what a third is — `w-1/3`, `translate-x-1/3` and `basis-1/3` once emitted
 * `33.333333%`, `33.333333%` and `33.3333%` respectively, and two of the three
 * families rejected `7/9` outright while Tailwind compiled it.
 */
export function fractionValue(name: string): string | null {
	if (Object.hasOwn(FRACTIONAL, name)) return FRACTIONAL[name];
	const slash = name.indexOf("/");
	if (slash === -1) return null;
	const numerator = name.slice(0, slash);
	const denominator = name.slice(slash + 1);
	// Integers only: `1.5/3` and `-1/3` are not fractions Tailwind accepts, and
	// Number() would happily take them.
	if (!INTEGER_RE.test(numerator) || !INTEGER_RE.test(denominator)) return null;
	if (Number(denominator) === 0) return null;
	return `calc(${numerator} / ${denominator} * 100%)`;
}

export function deepFreezeUtilityMap<T extends Record<string, UtilityResult>>(map: T): Readonly<T> {
	for (const value of Object.values(map)) {
		Object.freeze(value.declarations);
		Object.freeze(value);
	}
	return Object.freeze(map);
}
