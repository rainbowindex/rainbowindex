/**
 * Transform utilities — translate, rotate, scale, skew, perspective,
 * transform-origin, zoom, will-change — plus the transform-* statics.
 */

import {
	type UtilityResult,
	single,
	multi,
	extractArbitrary,
	INTEGER_RE,
	deepFreezeUtilityMap,
	spacingLookup,
} from "../helpers.js";

// Composable `transform` (rotate-x/y/z + skew-x/y). Each utility sets its slot
// var and emits this; per-function identity fallbacks keep it valid when unset.
const TRANSFORM_COMPOSED =
	"var(--ri-rotate-x, rotateX(0)) var(--ri-rotate-y, rotateY(0)) var(--ri-rotate-z, rotateZ(0)) var(--ri-skew-x, skewX(0)) var(--ri-skew-y, skewY(0))";

export const TRANSFORM_STATICS: Readonly<Record<string, UtilityResult>> = {
	// Transform
	"transform-none": single("transform", "none"),
	"transform-gpu": single("transform", `translateZ(0) ${TRANSFORM_COMPOSED}`),
	"transform-cpu": single("transform", TRANSFORM_COMPOSED),

	// Transform style
	"transform-flat": single("transform-style", "flat"),
	"transform-3d": single("transform-style", "preserve-3d"),

	// Transform box
	"transform-content": single("transform-box", "content-box"),
	"transform-border": single("transform-box", "border-box"),
	"transform-fill": single("transform-box", "fill-box"),
	"transform-stroke": single("transform-box", "stroke-box"),
	"transform-view": single("transform-box", "view-box"),

	// Translate reset
	"translate-none": single("translate", "none"),

	// Rotate reset
	"rotate-none": single("rotate", "none"),

	// Scale reset
	"scale-none": single("scale", "none"),

	// Perspective (static)
	"perspective-none": single("perspective", "none"),

	// Transform origin
	"origin-center": single("transform-origin", "center"),
	"origin-top": single("transform-origin", "top"),
	"origin-top-right": single("transform-origin", "top right"),
	"origin-right": single("transform-origin", "right"),
	"origin-bottom-right": single("transform-origin", "bottom right"),
	"origin-bottom": single("transform-origin", "bottom"),
	"origin-bottom-left": single("transform-origin", "bottom left"),
	"origin-left": single("transform-origin", "left"),
	"origin-top-left": single("transform-origin", "top left"),
};
deepFreezeUtilityMap(TRANSFORM_STATICS);

export function resolveTranslate(full: string, negative: boolean): UtilityResult | null {
	// Axis branches return outright — a failed axis value (`translate-x-bogus`)
	// can never re-resolve through the x/y shorthand below.
	if (full.startsWith("translate-x-")) {
		const val = resolveTransformValue(full.slice(12), negative);
		return val
			? multi(
					["--ri-translate-x", val],
					["translate", "var(--ri-translate-x, 0) var(--ri-translate-y, 0)"],
				)
			: null;
	}
	if (full.startsWith("translate-y-")) {
		const val = resolveTransformValue(full.slice(12), negative);
		return val
			? multi(
					["--ri-translate-y", val],
					["translate", "var(--ri-translate-x, 0) var(--ri-translate-y, 0)"],
				)
			: null;
	}
	// translate-z-{n}: sets only the Z axis
	if (full.startsWith("translate-z-")) {
		const val = resolveTransformValue(full.slice(12), negative);
		return val
			? multi(
					["--ri-translate-z", val],
					[
						"translate",
						"var(--ri-translate-x, 0) var(--ri-translate-y, 0) var(--ri-translate-z, 0)",
					],
				)
			: null;
	}
	// translate-{n}: shorthand sets both x and y
	if (full.startsWith("translate-")) {
		const val = resolveTransformValue(full.slice(10), negative);
		if (val)
			return multi(
				["--ri-translate-x", val],
				["--ri-translate-y", val],
				["translate", "var(--ri-translate-x, 0) var(--ri-translate-y, 0)"],
			);
	}
	return null;
}

/** Signed angle expression shared by rotate and skew: arbitrary values negate
 *  via calc(); bare numbers become ±<n>deg. */
function resolveSignedAngle(val: string, negative: boolean): string | null {
	const arb = extractArbitrary(val);
	if (arb !== null) return negative ? `calc(${arb} * -1)` : arb;
	const n = Number(val);
	return val !== "" && !Number.isNaN(n) ? `${negative ? -n : n}deg` : null;
}

export function resolveRotate(full: string, negative: boolean): UtilityResult | null {
	// Axis-specific rotate: rotate-x-{n}, rotate-y-{n}, rotate-z-{n}
	for (const axis of ["x", "y", "z"] as const) {
		const prefix = `rotate-${axis}-`;
		if (full.startsWith(prefix)) {
			const expr = resolveSignedAngle(full.slice(prefix.length), negative);
			if (expr === null) return null;
			return multi(
				[`--ri-rotate-${axis}`, `rotate${axis.toUpperCase()}(${expr})`],
				["transform", TRANSFORM_COMPOSED],
			);
		}
	}
	const expr = resolveSignedAngle(full.slice(7), negative);
	if (expr === null) return null;
	return single("rotate", expr);
}

// All per-axis classes set their own `--ri-scale-{axis}` var and emit the same
// `scale:` shorthand reading from those vars. Identical shorthand strings mean
// cascade order is irrelevant, and disjoint var keys let the merger (see
// merge/props.ts) keep `scale-x-50 scale-y-75` as two composing classes.
// @property registration in engine/index.ts (TRANSFORM_PROPERTIES) supplies
// the `1` initial value for axes the user didn't touch.
export function resolveScale(full: string, negative: boolean): UtilityResult | null {
	if (full.startsWith("scale-x-")) {
		const s = resolveScaleValue(full.slice(8), negative);
		if (s)
			return multi(["--ri-scale-x", s], ["scale", "var(--ri-scale-x, 1) var(--ri-scale-y, 1)"]);
	} else if (full.startsWith("scale-y-")) {
		const s = resolveScaleValue(full.slice(8), negative);
		if (s)
			return multi(["--ri-scale-y", s], ["scale", "var(--ri-scale-x, 1) var(--ri-scale-y, 1)"]);
	} else if (full.startsWith("scale-z-")) {
		const s = resolveScaleValue(full.slice(8), negative);
		if (s)
			return multi(
				["--ri-scale-z", s],
				["scale", "var(--ri-scale-x, 1) var(--ri-scale-y, 1) var(--ri-scale-z, 1)"],
			);
	} else if (full === "scale-3d") {
		return single("scale", "var(--ri-scale-x, 1) var(--ri-scale-y, 1) var(--ri-scale-z, 1)");
	} else if (full.startsWith("scale-")) {
		const s = resolveScaleValue(full.slice(6), negative);
		if (s)
			return multi(
				["--ri-scale-x", s],
				["--ri-scale-y", s],
				["scale", "var(--ri-scale-x, 1) var(--ri-scale-y, 1)"],
			);
	}
	return null;
}

// Inline perspective scale (consistent with the inset-shadow/drop-shadow scales).
const PERSPECTIVE: Readonly<Record<string, string>> = Object.freeze({
	dramatic: "100px",
	near: "300px",
	normal: "500px",
	midrange: "800px",
	distant: "1200px",
});
const PERSPECTIVE_ORIGINS: Readonly<Record<string, string>> = Object.freeze({
	center: "center",
	top: "top",
	"top-right": "top right",
	right: "right",
	"bottom-right": "bottom right",
	bottom: "bottom",
	"bottom-left": "bottom left",
	left: "left",
	"top-left": "top left",
});

export function resolvePerspective(full: string): UtilityResult | null {
	if (!full.startsWith("perspective-")) return null;
	const rest = full.slice(12);
	// perspective-origin-{named | arbitrary | custom-property}
	if (rest.startsWith("origin-")) {
		const o = rest.slice(7);
		if (Object.hasOwn(PERSPECTIVE_ORIGINS, o))
			return single("perspective-origin", PERSPECTIVE_ORIGINS[o]);
		const arb = extractArbitrary(o);
		if (arb !== null) return single("perspective-origin", arb);
		return null;
	}
	// perspective-{named scale}
	if (Object.hasOwn(PERSPECTIVE, rest)) return single("perspective", PERSPECTIVE[rest]);
	// perspective-[arbitrary] / perspective-(--c)
	const arb = extractArbitrary(rest);
	if (arb !== null) return single("perspective", arb);
	// perspective-{n}: numeric → px
	if (INTEGER_RE.test(rest)) return single("perspective", `${rest}px`);
	return null;
}

// transform-(--c) / transform-[v]: a literal transform that overrides the composition.
export function resolveTransformBase(full: string): UtilityResult | null {
	const arb = extractArbitrary(full.slice(10)); // "transform-".length
	if (arb !== null) return single("transform", arb);
	return null;
}

export function resolveZoom(full: string): UtilityResult | null {
	const rest = full.slice(5); // "zoom-".length
	const arb = extractArbitrary(rest);
	if (arb !== null) return single("zoom", arb);
	if (INTEGER_RE.test(rest)) return single("zoom", `${rest}%`);
	return null;
}

export function resolveOrigin(full: string): UtilityResult | null {
	if (!full.startsWith("origin-")) return null;
	const rest = full.slice(7);
	const arb = extractArbitrary(rest);
	if (arb !== null) return single("transform-origin", arb);
	return null;
}

export function resolveWillChange(full: string): UtilityResult | null {
	if (!full.startsWith("will-change-")) return null;
	const rest = full.slice(12);
	const arb = extractArbitrary(rest);
	if (arb !== null) return single("will-change", arb);
	return null;
}

export function resolveSkew(full: string, negative: boolean): UtilityResult | null {
	const isX = full.startsWith("skew-x-");
	const isY = full.startsWith("skew-y-");
	// skew-x-{n}/skew-y-{n} after "skew-x-"; bare skew-{n} after "skew-".
	const rest = isX || isY ? full.slice(7) : full.startsWith("skew-") ? full.slice(5) : null;
	if (rest === null) return null;
	const expr = resolveSignedAngle(rest, negative);
	if (expr === null) return null;
	if (isX) return multi(["--ri-skew-x", `skewX(${expr})`], ["transform", TRANSFORM_COMPOSED]);
	if (isY) return multi(["--ri-skew-y", `skewY(${expr})`], ["transform", TRANSFORM_COMPOSED]);
	return multi(
		["--ri-skew-x", `skewX(${expr})`],
		["--ri-skew-y", `skewY(${expr})`],
		["transform", TRANSFORM_COMPOSED],
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveTransformValue(name: string, negative: boolean): string | null {
	if (name === "full") return negative ? "-100%" : "100%";
	if (name === "1/2") return negative ? "-50%" : "50%";
	const arb = extractArbitrary(name);
	if (arb !== null) return negative ? `calc(${arb} * -1)` : arb;
	// px / 0 / spacing-scale decimals share the canonical spacing grammar.
	return spacingLookup(name, negative);
}

function resolveScaleValue(name: string, negative: boolean): string | null {
	const arb = extractArbitrary(name);
	if (arb !== null) return negative ? `calc(${arb} * -1)` : arb;
	if (name === "") return null;
	const n = Number(name);
	if (!Number.isNaN(n)) {
		return negative ? `calc(${n}% * -1)` : `${n}%`;
	}
	return null;
}
