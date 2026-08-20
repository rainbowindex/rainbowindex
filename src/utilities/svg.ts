/**
 * SVG utilities — stroke-width, stroke-linecap, stroke-linejoin,
 * stroke-dasharray, stroke-dashoffset, stroke-miterlimit,
 * stroke-opacity, paint-order, vector-effect.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import {
	type UtilityResult,
	single,
	extractArbitrary,
	INTEGER_RE,
	DECIMAL_RE,
	deepFreezeUtilityMap,
	normalizeDecimalToken,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Static utilities
// ---------------------------------------------------------------------------

const STATIC_SVG: Readonly<Record<string, UtilityResult>> = {
	// Fill: none
	"fill-none": single("fill", "none"),

	// Stroke: none
	"stroke-none": single("stroke", "none"),

	// Stroke linecap
	"stroke-cap-butt": single("stroke-linecap", "butt"),
	"stroke-cap-round": single("stroke-linecap", "round"),
	"stroke-cap-square": single("stroke-linecap", "square"),

	// Stroke linejoin
	"stroke-join-arcs": single("stroke-linejoin", "arcs"),
	"stroke-join-bevel": single("stroke-linejoin", "bevel"),
	"stroke-join-miter": single("stroke-linejoin", "miter"),
	"stroke-join-miter-clip": single("stroke-linejoin", "miter-clip"),
	"stroke-join-round": single("stroke-linejoin", "round"),

	// Stroke dasharray (named patterns)
	"stroke-dash-none": single("stroke-dasharray", "none"),
	"stroke-dash-dotted": single("stroke-dasharray", "1 3"),
	"stroke-dash-dashed": single("stroke-dasharray", "4 4"),
	"stroke-dash-long": single("stroke-dasharray", "8 4"),
	"stroke-dash-dense": single("stroke-dasharray", "2 2"),
	"stroke-dash-loose": single("stroke-dasharray", "6 6"),
	"stroke-dash-dot-dash": single("stroke-dasharray", "8 4 2 4"),

	// Stroke dashoffset (named values)
	"stroke-offset-0": single("stroke-dashoffset", "0"),
	"stroke-offset-1": single("stroke-dashoffset", "1"),
	"stroke-offset-2": single("stroke-dashoffset", "2"),
	"stroke-offset-4": single("stroke-dashoffset", "4"),
	"stroke-offset-8": single("stroke-dashoffset", "8"),

	// Stroke miterlimit (named values)
	"stroke-miter-1": single("stroke-miterlimit", "1"),
	"stroke-miter-2": single("stroke-miterlimit", "2"),
	"stroke-miter-4": single("stroke-miterlimit", "4"),
	"stroke-miter-8": single("stroke-miterlimit", "8"),

	// Paint order
	"paint-normal": single("paint-order", "normal"),
	"paint-stroke": single("paint-order", "stroke"),
	"paint-fill": single("paint-order", "fill"),
	"paint-markers": single("paint-order", "markers"),
	// Two-value combinations
	"paint-stroke-fill": single("paint-order", "stroke fill"),
	"paint-stroke-markers": single("paint-order", "stroke markers"),
	"paint-fill-stroke": single("paint-order", "fill stroke"),
	"paint-fill-markers": single("paint-order", "fill markers"),
	"paint-markers-stroke": single("paint-order", "markers stroke"),
	"paint-markers-fill": single("paint-order", "markers fill"),
	// Three-value combinations
	"paint-stroke-fill-markers": single("paint-order", "stroke fill markers"),
	"paint-stroke-markers-fill": single("paint-order", "stroke markers fill"),
	"paint-fill-stroke-markers": single("paint-order", "fill stroke markers"),
	"paint-fill-markers-stroke": single("paint-order", "fill markers stroke"),
	"paint-markers-stroke-fill": single("paint-order", "markers stroke fill"),
	"paint-markers-fill-stroke": single("paint-order", "markers fill stroke"),

	// Vector effect
	"vector-none": single("vector-effect", "none"),
	"vector-non-scaling-stroke": single("vector-effect", "non-scaling-stroke"),
	"vector-non-scaling-size": single("vector-effect", "non-scaling-size"),
	"vector-non-rotation": single("vector-effect", "non-rotation"),
	"vector-fixed-position": single("vector-effect", "fixed-position"),
};
deepFreezeUtilityMap(STATIC_SVG);
// Key list export for editor enumeration — the map itself stays private.
export const SVG_STATIC_NAMES: readonly string[] = Object.freeze(Object.keys(STATIC_SVG));

// ---------------------------------------------------------------------------
// Sub-generators
// ---------------------------------------------------------------------------

function resolveStrokeWidth(full: string): UtilityResult | null {
	const val = full.slice(7); // strip "stroke-"
	if (!val) return null;

	// Arbitrary: stroke-[3px]
	const arb = extractArbitrary(val);
	if (arb !== null) return single("stroke-width", arb);

	// Numeric: stroke-0, stroke-1.5, stroke-6_4, etc. Accepts both `.` and `_`.
	if (DECIMAL_RE.test(val)) {
		return single("stroke-width", normalizeDecimalToken(val));
	}

	return null;
}

function resolveStrokeDash(full: string): UtilityResult | null {
	const val = full.slice(12); // strip "stroke-dash-"
	if (!val) return null;

	const arb = extractArbitrary(val);
	if (arb !== null) {
		// Underscores were already decoded to spaces by extractArbitrary; `\_` stays literal.
		return single("stroke-dasharray", arb);
	}

	return null;
}

function resolveStrokeOffset(full: string): UtilityResult | null {
	const val = full.slice(14); // strip "stroke-offset-"
	if (!val) return null;

	const arb = extractArbitrary(val);
	if (arb !== null) return single("stroke-dashoffset", arb);

	if (DECIMAL_RE.test(val)) return single("stroke-dashoffset", normalizeDecimalToken(val));

	return null;
}

function resolveStrokeMiter(full: string): UtilityResult | null {
	const val = full.slice(13); // strip "stroke-miter-"
	if (!val) return null;

	const arb = extractArbitrary(val);
	if (arb !== null) return single("stroke-miterlimit", arb);

	if (DECIMAL_RE.test(val)) return single("stroke-miterlimit", normalizeDecimalToken(val));

	return null;
}

function resolveStrokeOpacity(full: string): UtilityResult | null {
	const val = full.slice(15); // strip "stroke-opacity-"
	if (!val) return null;

	// Arbitrary: stroke-opacity-[0.75]
	const arb = extractArbitrary(val);
	if (arb !== null) return single("stroke-opacity", arb);

	// Named numeric: stroke-opacity-50 → 0.5
	if (INTEGER_RE.test(val)) {
		const num = Number(val);
		if (num < 0 || num > 100) return null;
		return single("stroke-opacity", String(num / 100));
	}

	return null;
}

// ---------------------------------------------------------------------------
// Main Generator
// ---------------------------------------------------------------------------

/**
 * Compound prefix dispatch for hyphenated prefixes like "stroke-dash",
 * "stroke-offset", etc. Checked before the bare stroke-width fallthrough.
 */
const SVG_COMPOUND_DISPATCH: ReadonlyArray<{
	prefix: string;
	resolver: (full: string) => UtilityResult | null;
}> = [
	{ prefix: "stroke-opacity-", resolver: resolveStrokeOpacity },
	{ prefix: "stroke-offset-", resolver: resolveStrokeOffset },
	{ prefix: "stroke-miter-", resolver: resolveStrokeMiter },
	{ prefix: "stroke-dash-", resolver: resolveStrokeDash },
];

export function svgGenerator(
	_utility: string,
	_value: string | null,
	full: string,
	_negative: boolean,
	_theme: ResolvedTheme,
): UtilityResult | null {
	// Check static utilities first
	if (Object.hasOwn(STATIC_SVG, full)) return STATIC_SVG[full];

	// Check compound prefixes (stroke-dash-*, stroke-offset-*, etc.)
	for (const entry of SVG_COMPOUND_DISPATCH) {
		if (full.startsWith(entry.prefix)) return entry.resolver(full);
	}

	// Everything else in this family is stroke-width shaped.
	const hyphenIdx = full.indexOf("-");
	const prefix = hyphenIdx === -1 ? full : full.slice(0, hyphenIdx);
	if (prefix === "stroke") return resolveStrokeWidth(full);

	return null;
}
