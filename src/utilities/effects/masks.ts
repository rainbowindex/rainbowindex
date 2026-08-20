/**
 * Mask utilities — the mask-* keyword statics plus the composable gradient
 * mask-image families (linear/radial/conic, edges, axes).
 */

import type { ResolvedTheme } from "../../directives/foundation.js";
import {
	type UtilityResult,
	single,
	multi,
	extractArbitrary,
	INTEGER_RE,
	DECIMAL_RE,
	deepFreezeUtilityMap,
	normalizeDecimalToken,
} from "../helpers.js";
import { resolveColor, isBracketedColor } from "../color.js";
import { isMaskRadialSizeValue } from "../../merge/props.js";

export const MASK_STATICS: Readonly<Record<string, UtilityResult>> = {
	// Mask (basic)
	"mask-none": single("mask-image", "none"),

	// Mask compositing — how multiple mask layers combine
	"mask-add": single("mask-composite", "add"),
	"mask-subtract": single("mask-composite", "subtract"),
	"mask-intersect": single("mask-composite", "intersect"),
	"mask-exclude": single("mask-composite", "exclude"),

	// Mask clip
	"mask-clip-border": single("mask-clip", "border-box"),
	"mask-clip-padding": single("mask-clip", "padding-box"),
	"mask-clip-content": single("mask-clip", "content-box"),
	"mask-clip-fill": single("mask-clip", "fill-box"),
	"mask-clip-stroke": single("mask-clip", "stroke-box"),
	"mask-clip-view": single("mask-clip", "view-box"),
	"mask-no-clip": single("mask-clip", "no-clip"),

	// Mask mode
	"mask-alpha": single("mask-mode", "alpha"),
	"mask-luminance": single("mask-mode", "luminance"),
	"mask-match": single("mask-mode", "match-source"),

	// Mask origin
	"mask-origin-border": single("mask-origin", "border-box"),
	"mask-origin-padding": single("mask-origin", "padding-box"),
	"mask-origin-content": single("mask-origin", "content-box"),
	"mask-origin-fill": single("mask-origin", "fill-box"),
	"mask-origin-stroke": single("mask-origin", "stroke-box"),
	"mask-origin-view": single("mask-origin", "view-box"),

	// Mask position (keywords)
	"mask-top-left": single("mask-position", "top left"),
	"mask-top": single("mask-position", "top"),
	"mask-top-right": single("mask-position", "top right"),
	"mask-left": single("mask-position", "left"),
	"mask-center": single("mask-position", "center"),
	"mask-right": single("mask-position", "right"),
	"mask-bottom-left": single("mask-position", "bottom left"),
	"mask-bottom": single("mask-position", "bottom"),
	"mask-bottom-right": single("mask-position", "bottom right"),

	// Mask repeat
	"mask-repeat": single("mask-repeat", "repeat"),
	"mask-no-repeat": single("mask-repeat", "no-repeat"),
	"mask-repeat-x": single("mask-repeat", "repeat-x"),
	"mask-repeat-y": single("mask-repeat", "repeat-y"),
	"mask-repeat-space": single("mask-repeat", "space"),
	"mask-repeat-round": single("mask-repeat", "round"),

	// Mask size
	"mask-auto": single("mask-size", "auto"),
	"mask-cover": single("mask-size", "cover"),
	"mask-contain": single("mask-size", "contain"),

	// Mask type
	"mask-type-alpha": single("mask-type", "alpha"),
	"mask-type-luminance": single("mask-type", "luminance"),

	// Mask radial shape
	"mask-circle": single("--ri-mask-radial-shape", "circle"),
	"mask-ellipse": single("--ri-mask-radial-shape", "ellipse"),

	// Mask radial size (keywords)
	"mask-radial-closest-corner": single("--ri-mask-radial-size", "closest-corner"),
	"mask-radial-closest-side": single("--ri-mask-radial-size", "closest-side"),
	"mask-radial-farthest-corner": single("--ri-mask-radial-size", "farthest-corner"),
	"mask-radial-farthest-side": single("--ri-mask-radial-size", "farthest-side"),

	// Mask radial position
	"mask-radial-at-top-left": single("--ri-mask-radial-position", "top left"),
	"mask-radial-at-top": single("--ri-mask-radial-position", "top"),
	"mask-radial-at-top-right": single("--ri-mask-radial-position", "top right"),
	"mask-radial-at-left": single("--ri-mask-radial-position", "left"),
	"mask-radial-at-center": single("--ri-mask-radial-position", "center"),
	"mask-radial-at-right": single("--ri-mask-radial-position", "right"),
	"mask-radial-at-bottom-left": single("--ri-mask-radial-position", "bottom left"),
	"mask-radial-at-bottom": single("--ri-mask-radial-position", "bottom"),
	"mask-radial-at-bottom-right": single("--ri-mask-radial-position", "bottom right"),
};
deepFreezeUtilityMap(MASK_STATICS);

// ---------------------------------------------------------------------------
// Module-scope constants
// ---------------------------------------------------------------------------

// Composable mask-image strings. Each gradient family reads its stops from
// `--ri-mask-*` custom properties so that `*-from-*` and `*-to-*` utilities
// compose — each sets only its own var plus this byte-identical image. Mirrors
// the `--ri-gradient-*` system in color.ts. The length-percentage position vars
// rely on the @property defaults registered in engine/index.ts (MASK_PROPERTIES);
// color/direction/shape/size vars carry inline fallbacks so a single utility
// renders correctly without @property support.
function maskEdgeImage(direction: string, side: string): string {
	return `linear-gradient(${direction}, var(--ri-mask-${side}-from, black) var(--ri-mask-${side}-from-position), var(--ri-mask-${side}-to, transparent) var(--ri-mask-${side}-to-position))`;
}

const MASK_EDGE_IMAGE = Object.freeze({
	top: maskEdgeImage("to top", "top"),
	right: maskEdgeImage("to right", "right"),
	bottom: maskEdgeImage("to bottom", "bottom"),
	left: maskEdgeImage("to left", "left"),
});

const MASK_LINEAR_IMAGE =
	"linear-gradient(var(--ri-mask-linear-position, 0deg), var(--ri-mask-linear-from, black) var(--ri-mask-linear-from-position), var(--ri-mask-linear-to, transparent) var(--ri-mask-linear-to-position))";

const MASK_RADIAL_IMAGE =
	"radial-gradient(var(--ri-mask-radial-shape, ellipse) var(--ri-mask-radial-size, farthest-corner) at var(--ri-mask-radial-position, center), var(--ri-mask-radial-from, black) var(--ri-mask-radial-from-position), var(--ri-mask-radial-to, transparent) var(--ri-mask-radial-to-position))";

const MASK_CONIC_IMAGE =
	"conic-gradient(from var(--ri-mask-conic-position, 0deg), var(--ri-mask-conic-from, black) var(--ri-mask-conic-from-position), var(--ri-mask-conic-to, transparent) var(--ri-mask-conic-to-position))";

// Axis masks layer two edge gradients combined via `mask-composite: intersect`.
const MASK_X_IMAGE = `${MASK_EDGE_IMAGE.right}, ${MASK_EDGE_IMAGE.left}`;
const MASK_Y_IMAGE = `${MASK_EDGE_IMAGE.top}, ${MASK_EDGE_IMAGE.bottom}`;

/** Edge families: [class key, var namespace]. Direction is baked into MASK_EDGE_IMAGE. */
const MASK_EDGES = [
	["t", "top"],
	["r", "right"],
	["b", "bottom"],
	["l", "left"],
] as const;

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve a mask gradient stop token into a position or a color:
 * - bare number → spacing multiple, percentage / non-color arbitrary → position
 * - otherwise → color (themed name, arbitrary color, custom property)
 * A `color` dataType hint forces the color branch.
 */
function resolveMaskStop(
	token: string,
	theme: ResolvedTheme,
	dataType: string | null | undefined,
): { kind: "position" | "color"; value: string } | null {
	if (dataType !== "color") {
		const position = resolveMaskPosition(token);
		if (position !== null) return { kind: "position", value: position };
	}
	const color = resolveColor(token, theme, dataType);
	if (color) return { kind: "color", value: color };
	return null;
}

function resolveMaskPosition(token: string): string | null {
	if (DECIMAL_RE.test(token)) return `calc(var(--spacing) * ${normalizeDecimalToken(token)})`;
	if (token.endsWith("%")) {
		const n = Number(token.slice(0, -1));
		if (!Number.isNaN(n)) return token;
	}
	if (token.startsWith("[") && token.endsWith("]")) {
		if (isBracketedColor(token)) return null;
		return extractArbitrary(token);
	}
	return null;
}

/** Single-edge / single-family from|to stop → its var plus the family's canonical image. */
function maskStopResult(
	side: string,
	end: "from" | "to",
	token: string,
	theme: ResolvedTheme,
	dataType: string | null | undefined,
	image: string,
): UtilityResult | null {
	const stop = resolveMaskStop(token, theme, dataType);
	if (!stop) return null;
	const prop =
		stop.kind === "position" ? `--ri-mask-${side}-${end}-position` : `--ri-mask-${side}-${end}`;
	return multi([prop, stop.value], ["mask-image", image]);
}

/** Axis from|to stop (x = right+left, y = top+bottom): two edge vars + intersect composite. */
function maskAxisResult(
	axis: "x" | "y",
	end: "from" | "to",
	token: string,
	theme: ResolvedTheme,
	dataType: string | null | undefined,
): UtilityResult | null {
	const stop = resolveMaskStop(token, theme, dataType);
	if (!stop) return null;
	const sides = axis === "x" ? (["right", "left"] as const) : (["top", "bottom"] as const);
	const pairs: [string, string][] = [];
	for (const side of sides) {
		pairs.push([
			stop.kind === "position" ? `--ri-mask-${side}-${end}-position` : `--ri-mask-${side}-${end}`,
			stop.value,
		]);
	}
	pairs.push(["mask-image", axis === "x" ? MASK_X_IMAGE : MASK_Y_IMAGE]);
	pairs.push(["mask-composite", "intersect"]);
	return multi(...pairs);
}

/** Angle for mask-linear-<n> / mask-conic-<n>, supporting negation and arbitrary values. */
function resolveMaskAngle(token: string, negative: boolean): string | null {
	if (INTEGER_RE.test(token)) {
		const n = Number(token);
		return negative ? `calc(${n}deg * -1)` : `${n}deg`;
	}
	const arb = extractArbitrary(token);
	if (arb !== null) return negative ? `calc(${arb} * -1)` : arb;
	return null;
}

export function resolveMask(
	rest: string,
	negative: boolean,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	// Linear gradient family
	if (rest.startsWith("linear-")) {
		const after = rest.slice(7);
		if (after.startsWith("from-"))
			return maskStopResult("linear", "from", after.slice(5), theme, dataType, MASK_LINEAR_IMAGE);
		if (after.startsWith("to-"))
			return maskStopResult("linear", "to", after.slice(3), theme, dataType, MASK_LINEAR_IMAGE);
		const angle = resolveMaskAngle(after, negative);
		if (angle !== null)
			return multi(["--ri-mask-linear-position", angle], ["mask-image", MASK_LINEAR_IMAGE]);
		return null;
	}

	// Conic gradient family
	if (rest.startsWith("conic-")) {
		const after = rest.slice(6);
		if (after.startsWith("from-"))
			return maskStopResult("conic", "from", after.slice(5), theme, dataType, MASK_CONIC_IMAGE);
		if (after.startsWith("to-"))
			return maskStopResult("conic", "to", after.slice(3), theme, dataType, MASK_CONIC_IMAGE);
		const angle = resolveMaskAngle(after, negative);
		if (angle !== null)
			return multi(["--ri-mask-conic-position", angle], ["mask-image", MASK_CONIC_IMAGE]);
		return null;
	}

	// Radial gradient family
	if (rest.startsWith("radial-")) {
		const after = rest.slice(7);
		if (after.startsWith("from-"))
			return maskStopResult("radial", "from", after.slice(5), theme, dataType, MASK_RADIAL_IMAGE);
		if (after.startsWith("to-"))
			return maskStopResult("radial", "to", after.slice(3), theme, dataType, MASK_RADIAL_IMAGE);
		// mask-radial-[<size>] sets the size var; mask-radial-[<value>] is a full image.
		if (after.startsWith("[") && after.endsWith("]")) {
			const arb = extractArbitrary(after);
			if (arb === null) return null;
			if (isMaskRadialSizeValue(after)) return single("--ri-mask-radial-size", arb);
			return single("mask-image", `radial-gradient(${arb})`);
		}
		return null;
	}

	// Edge families: mask-t/r/b/l-from|to-*
	for (const [key, side] of MASK_EDGES) {
		const fromPfx = `${key}-from-`;
		if (rest.startsWith(fromPfx))
			return maskStopResult(
				side,
				"from",
				rest.slice(fromPfx.length),
				theme,
				dataType,
				MASK_EDGE_IMAGE[side],
			);
		const toPfx = `${key}-to-`;
		if (rest.startsWith(toPfx))
			return maskStopResult(
				side,
				"to",
				rest.slice(toPfx.length),
				theme,
				dataType,
				MASK_EDGE_IMAGE[side],
			);
	}

	// Axis families: mask-x/y-from|to-*
	if (rest.startsWith("x-from-"))
		return maskAxisResult("x", "from", rest.slice(7), theme, dataType);
	if (rest.startsWith("x-to-")) return maskAxisResult("x", "to", rest.slice(5), theme, dataType);
	if (rest.startsWith("y-from-"))
		return maskAxisResult("y", "from", rest.slice(7), theme, dataType);
	if (rest.startsWith("y-to-")) return maskAxisResult("y", "to", rest.slice(5), theme, dataType);

	// mask-position-(<custom-property>) / mask-position-[<value>]
	if (rest.startsWith("position-")) {
		const arb = extractArbitrary(rest.slice(9));
		if (arb !== null) return single("mask-position", arb);
		return null;
	}

	// mask-size-(<custom-property>) / mask-size-[<value>]
	if (rest.startsWith("size-")) {
		const arb = extractArbitrary(rest.slice(5));
		if (arb !== null) return single("mask-size", arb);
		return null;
	}

	// Bare image: mask-[<value>] / mask-(<custom-property>)
	const arb = extractArbitrary(rest);
	if (arb !== null) return single("mask-image", arb);

	return null;
}
