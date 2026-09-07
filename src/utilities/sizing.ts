/**
 * Sizing utilities — width, height, min/max dimensions, size.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import {
	type UtilityResult,
	fractionValue,
	single,
	multi,
	spacingLookup,
	extractArbitrary,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Named size values
// ---------------------------------------------------------------------------

const NAMED_SIZES: Readonly<Record<string, string>> = Object.freeze({
	auto: "auto",
	full: "100%",
	screen: "100vw",
	svw: "100svw",
	lvw: "100lvw",
	dvw: "100dvw",
	svh: "100svh",
	lvh: "100lvh",
	dvh: "100dvh",
	min: "min-content",
	max: "max-content",
	fit: "fit-content",
});

const HEIGHT_NAMED: Readonly<Record<string, string>> = Object.freeze({
	...NAMED_SIZES,
	screen: "100vh",
	lh: "1lh",
});

// All six viewport-relative units, shared by the constrained-size scales so
// min-w/max-w/min-h/max-h each accept the full set (e.g. min-w-dvh, max-h-dvw).
const VIEWPORT_SIZES: Readonly<Record<string, string>> = Object.freeze({
	svw: "100svw",
	lvw: "100lvw",
	dvw: "100dvw",
	svh: "100svh",
	lvh: "100lvh",
	dvh: "100dvh",
});

// Intentionally includes redundant fractions (e.g. 2/4 = 1/2 = 50%) for
// Tailwind compatibility — users expect w-2/4 to work alongside w-1/2.
function resolveSizeValue(
	val: string,
	named: Record<string, string>,
	negative: boolean,
): string | null {
	// Arbitrary
	const arb = extractArbitrary(val);
	if (arb !== null) return negative ? `calc(${arb} * -1)` : arb;
	// Named
	if (Object.hasOwn(named, val)) return named[val];
	// Fractional
	const fraction = fractionValue(val);
	if (fraction !== null) return fraction;
	// Spacing scale
	return spacingLookup(val, negative);
}

// ---------------------------------------------------------------------------
// Max-width named values
// ---------------------------------------------------------------------------

/**
 * The named container-width rem ladder, 3xs–7xl.
 *
 * One table, read by every family upstream feeds from `--container-*`: `w-`,
 * `min-w-`, `max-w-`, `basis-`, and `columns-`. It used to start at `xs`, with
 * `columns-*` keeping its own copy that added the two sub-`xs` steps — so
 * `columns-3xs` resolved and `max-w-3xs` did not, for no reason a reader could
 * find.
 */
export const CONTAINER_WIDTHS: Readonly<Record<string, string>> = Object.freeze({
	"3xs": "16rem",
	"2xs": "18rem",
	xs: "20rem",
	sm: "24rem",
	md: "28rem",
	lg: "32rem",
	xl: "36rem",
	"2xl": "42rem",
	"3xl": "48rem",
	"4xl": "56rem",
	"5xl": "64rem",
	"6xl": "72rem",
	"7xl": "80rem",
});

const MAX_W_NAMED: Readonly<Record<string, string>> = Object.freeze({
	none: "none",
	...CONTAINER_WIDTHS,
	full: "100%",
	min: "min-content",
	max: "max-content",
	fit: "fit-content",
	prose: "65ch",
	screen: "100vw",
	...VIEWPORT_SIZES,
});

// ---------------------------------------------------------------------------
// Constrained sizing (min-w, max-w, min-h, max-h) — table-driven
// ---------------------------------------------------------------------------

const MIN_W_NAMED: Readonly<Record<string, string>> = Object.freeze({
	// `auto` is a min-* value only: `max-width: auto` is not valid CSS, and
	// Tailwind registers no `max-w-auto` either.
	auto: "auto",
	"0": "0px",
	...CONTAINER_WIDTHS,
	full: "100%",
	min: "min-content",
	max: "max-content",
	fit: "fit-content",
	screen: "100vw",
	...VIEWPORT_SIZES,
});

const MIN_H_NAMED: Readonly<Record<string, string>> = Object.freeze({
	auto: "auto",
	"0": "0px",
	full: "100%",
	min: "min-content",
	max: "max-content",
	fit: "fit-content",
	lh: "1lh",
	screen: "100vh",
	...VIEWPORT_SIZES,
});

const MAX_H_NAMED: Readonly<Record<string, string>> = Object.freeze({
	none: "none",
	full: "100%",
	min: "min-content",
	max: "max-content",
	fit: "fit-content",
	lh: "1lh",
	screen: "100vh",
	...VIEWPORT_SIZES,
});

/**
 * Every named value any sizing family accepts, in one list.
 *
 * The enumerator drops a candidate that does not resolve, so a root can be
 * offered the whole union and let its own table decide — which is what keeps
 * completions in step with the resolvers. Listing them per root by hand is what
 * left `min-inline-full`, `min-block-0`, `inline-full` and `block-full`
 * resolvable but unlistable while `min-w-full` was fine.
 */
export const SIZING_KEYWORDS: readonly string[] = Object.freeze([
	...new Set([
		...Object.keys(NAMED_SIZES),
		...Object.keys(MIN_W_NAMED),
		...Object.keys(MAX_W_NAMED),
		...Object.keys(MIN_H_NAMED),
		...Object.keys(MAX_H_NAMED),
	]),
]);

/** Prefix → [prefix string, CSS property, named value table]. Logical min/max
 * families mirror their physical counterparts (min-inline ↔ min-w, etc.). */
const CONSTRAINED_SIZE_TABLE: Array<[string, string, Record<string, string>]> = [
	["min-w-", "min-width", MIN_W_NAMED],
	["max-w-", "max-width", MAX_W_NAMED],
	["min-h-", "min-height", MIN_H_NAMED],
	["max-h-", "max-height", MAX_H_NAMED],
	["min-inline-", "min-inline-size", MIN_W_NAMED],
	["max-inline-", "max-inline-size", MAX_W_NAMED],
	["min-block-", "min-block-size", MIN_H_NAMED],
	["max-block-", "max-block-size", MAX_H_NAMED],
];

function resolveConstrainedSize(
	val: string,
	named: Record<string, string>,
	property: string,
): UtilityResult | null {
	if (Object.hasOwn(named, val)) return single(property, named[val]);
	const fraction = fractionValue(val);
	if (fraction !== null) return single(property, fraction);
	const arb = extractArbitrary(val);
	if (arb !== null) return single(property, arb);
	const spacingVal = spacingLookup(val, false);
	if (spacingVal) return single(property, spacingVal);
	return null;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function sizingGenerator(
	_utility: string,
	_value: string | null,
	full: string,
	negative: boolean,
	_theme: ResolvedTheme,
	_warnings?: string[],
): UtilityResult | null {
	// size-{n}: both width and height
	if (full.startsWith("size-")) {
		const val = full.slice(5);
		const resolvedW = resolveSizeValue(val, NAMED_SIZES, negative);
		if (resolvedW) {
			// The two scales differ only in their named viewport entries (screen →
			// 100vw vs 100vh), so anything else reuses the width resolution as-is.
			const resolvedH = Object.hasOwn(HEIGHT_NAMED, val) ? HEIGHT_NAMED[val] : resolvedW;
			return multi(["width", resolvedW], ["height", resolvedH]);
		}
	}

	// w-{n}: width
	if (full.startsWith("w-")) {
		const val = full.slice(2);
		const resolved = resolveSizeValue(val, NAMED_SIZES, negative);
		if (resolved) return single("width", resolved);
		// The container ladder is read here rather than added to NAMED_SIZES
		// because that table also feeds `size-` and `h-`, and upstream gives
		// `--container-*` to the inline axis only. `inline-` gets it below, since
		// it is documented as taking the values of `w-`.
		if (Object.hasOwn(CONTAINER_WIDTHS, val)) return single("width", CONTAINER_WIDTHS[val]);
	}

	// h-{n}: height
	if (full.startsWith("h-")) {
		const val = full.slice(2);
		const resolved = resolveSizeValue(val, HEIGHT_NAMED, negative);
		if (resolved) return single("height", resolved);
	}

	// inline-{n}: inline-size (logical width). Mirrors w-* — NAMED_SIZES (screen → 100vw).
	// The `inline`/`block` prefixes are shared with the display utilities; bare
	// `inline`/`block` and `inline-block` etc. resolve as display via static match
	// (layout runs before sizing in the dispatch), so only size values land here.
	if (full.startsWith("inline-")) {
		const val = full.slice(7);
		const resolved = resolveSizeValue(val, NAMED_SIZES, negative);
		if (resolved) return single("inline-size", resolved);
		if (Object.hasOwn(CONTAINER_WIDTHS, val)) {
			return single("inline-size", CONTAINER_WIDTHS[val]);
		}
	}

	// block-{n}: block-size (logical height). Mirrors h-* — HEIGHT_NAMED (screen → 100vh).
	if (full.startsWith("block-")) {
		const val = full.slice(6);
		const resolved = resolveSizeValue(val, HEIGHT_NAMED, negative);
		if (resolved) return single("block-size", resolved);
	}

	// min-w, max-w, min-h, max-h — table-driven
	for (const [prefix, property, named] of CONSTRAINED_SIZE_TABLE) {
		if (full.startsWith(prefix)) {
			return resolveConstrainedSize(full.slice(prefix.length), named, property);
		}
	}

	return null;
}
