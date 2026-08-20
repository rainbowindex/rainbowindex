/**
 * Sizing utilities — width, height, min/max dimensions, size.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import { type UtilityResult, single, multi, spacingLookup, extractArbitrary } from "./helpers.js";

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
const FRACTIONAL: Readonly<Record<string, string>> = Object.freeze({
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
	if (Object.hasOwn(FRACTIONAL, val)) return FRACTIONAL[val];
	// Spacing scale
	return spacingLookup(val, negative);
}

// ---------------------------------------------------------------------------
// Max-width named values
// ---------------------------------------------------------------------------

/** Named container-width rem ladder (xs–7xl). Single source shared with the
 *  columns-* scale in utilities/layout.ts, which adds the 3xs/2xs steps. */
export const CONTAINER_WIDTHS: Readonly<Record<string, string>> = Object.freeze({
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
	"0": "0px",
	full: "100%",
	min: "min-content",
	max: "max-content",
	fit: "fit-content",
	screen: "100vw",
	...VIEWPORT_SIZES,
});

const MIN_H_NAMED: Readonly<Record<string, string>> = Object.freeze({
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
	if (Object.hasOwn(FRACTIONAL, val)) return single(property, FRACTIONAL[val]);
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
