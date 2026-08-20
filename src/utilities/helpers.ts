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

export function extractArbitrary(value: string | null): string | null {
	if (!value) return null;
	return value.startsWith("[") && value.endsWith("]")
		? decodeArbitraryValue(value.slice(1, -1))
		: null;
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

export function deepFreezeUtilityMap<T extends Record<string, UtilityResult>>(map: T): Readonly<T> {
	for (const value of Object.values(map)) {
		Object.freeze(value.declarations);
		Object.freeze(value);
	}
	return Object.freeze(map);
}
