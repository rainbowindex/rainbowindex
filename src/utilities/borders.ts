/**
 * Border utilities — border-width, border-radius (rounded),
 * divide, outline.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import { BORDER_DIR_PROPS } from "../merge/props.js";
import {
	type UtilityResult,
	single,
	multi,
	extractArbitrary,
	INTEGER_RE,
	DECIMAL_RE,
	deepFreezeUtilityMap,
	normalizeDecimalToken,
} from "./helpers.js";
import { isBracketedColor } from "./color.js";

// ---------------------------------------------------------------------------
// Static utilities
// ---------------------------------------------------------------------------

const STATIC_BORDER: Readonly<Record<string, UtilityResult>> = {
	// Border width
	border: single("border-width", "1px"),
	"border-0": single("border-width", "0px"),
	"border-2": single("border-width", "2px"),
	"border-4": single("border-width", "4px"),
	"border-8": single("border-width", "8px"),

	// Border sides (logical)
	"border-t": single("border-block-start-width", "1px"),
	"border-b": single("border-block-end-width", "1px"),
	"border-l": single("border-inline-start-width", "1px"),
	"border-r": single("border-inline-end-width", "1px"),
	"border-s": single("border-inline-start-width", "1px"),
	"border-e": single("border-inline-end-width", "1px"),
	"border-bs": single("border-block-start-width", "1px"),
	"border-be": single("border-block-end-width", "1px"),
	"border-x": single("border-inline-width", "1px"),
	"border-y": single("border-block-width", "1px"),

	// Border style
	"border-solid": single("border-style", "solid"),
	"border-dashed": single("border-style", "dashed"),
	"border-dotted": single("border-style", "dotted"),
	"border-double": single("border-style", "double"),
	"border-hidden": single("border-style", "hidden"),
	"border-none": single("border-style", "none"),

	// Rounded (bare)
	"rounded-none": single("border-radius", "0px"),
	"rounded-full": single("border-radius", "calc(infinity * 1px)"),

	// Corner shape — these also reset --ri-rounded-scale to 1 so an element
	// that overrides the globally-configured shape doesn't inherit the
	// fallback compensation tuned for a different shape.
	"corner-round": multi(["corner-shape", "round"], ["--ri-rounded-scale", "1"]),
	"corner-scoop": multi(["corner-shape", "scoop"], ["--ri-rounded-scale", "1"]),
	"corner-bevel": multi(["corner-shape", "bevel"], ["--ri-rounded-scale", "1"]),
	"corner-notch": multi(["corner-shape", "notch"], ["--ri-rounded-scale", "1"]),
	"corner-square": multi(["corner-shape", "square"], ["--ri-rounded-scale", "1"]),
	"corner-squircle": multi(["corner-shape", "squircle"], ["--ri-rounded-scale", "1"]),

	// Outline — outline-hidden keeps the transparent-outline accessibility hack
	// (preserves a focus ring in forced-colors mode); outline-none is genuinely
	// "no outline style" (the v4 split). Bare `outline` is a 1px width, like `border`.
	"outline-none": single("outline-style", "none"),
	"outline-hidden": multi(["outline", "2px solid transparent"], ["outline-offset", "2px"]),
	outline: single("outline-width", "1px"),
	"outline-solid": single("outline-style", "solid"),
	"outline-dashed": single("outline-style", "dashed"),
	"outline-dotted": single("outline-style", "dotted"),
	"outline-double": single("outline-style", "double"),
};
deepFreezeUtilityMap(STATIC_BORDER);
// Key list export for editor enumeration — the map itself stays private.
export const BORDER_STATIC_NAMES: readonly string[] = Object.freeze(Object.keys(STATIC_BORDER));

// ---------------------------------------------------------------------------
// Border radius map (logical by default)
// ---------------------------------------------------------------------------

const ROUNDED_SIDE: Readonly<Record<string, string[]>> = Object.freeze({
	t: ["border-start-start-radius", "border-start-end-radius"],
	b: ["border-end-start-radius", "border-end-end-radius"],
	l: ["border-start-start-radius", "border-end-start-radius"],
	r: ["border-start-end-radius", "border-end-end-radius"],
	// Explicit logical aliases
	s: ["border-start-start-radius", "border-end-start-radius"],
	e: ["border-start-end-radius", "border-end-end-radius"],
	bs: ["border-start-start-radius", "border-start-end-radius"],
	be: ["border-end-start-radius", "border-end-end-radius"],
});
const ROUNDED_SIDE_ENTRIES = Object.entries(ROUNDED_SIDE);

const ROUNDED_CORNER: Readonly<Record<string, string>> = Object.freeze({
	tl: "border-start-start-radius",
	tr: "border-start-end-radius",
	bl: "border-end-start-radius",
	br: "border-end-end-radius",
	// Explicit logical aliases
	ss: "border-start-start-radius",
	se: "border-start-end-radius",
	es: "border-end-start-radius",
	ee: "border-end-end-radius",
});
const ROUNDED_CORNER_ENTRIES = Object.entries(ROUNDED_CORNER);

// Key list exports for editor enumeration — the tables stay private.
export const ROUNDED_SIDE_NAMES: readonly string[] = Object.freeze(Object.keys(ROUNDED_SIDE));
export const ROUNDED_CORNER_NAMES: readonly string[] = Object.freeze(Object.keys(ROUNDED_CORNER));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveRadius(name: string): string | null {
	if (name === "none") return "0px";
	if (name === "full") return "calc(infinity * 1px)";
	// Numeric: rounded-4 = calc(var(--spacing) * 4)
	if (DECIMAL_RE.test(name)) {
		const n = Number.parseFloat(normalizeDecimalToken(name));
		if (n === 0) return "0px";
		return `calc(var(--spacing) * ${n} * var(--ri-rounded-scale, 1))`;
	}
	const arb = extractArbitrary(name);
	if (arb !== null) return arb;
	return null;
}

// ---------------------------------------------------------------------------
// Divide helper (shared by divide-x and divide-y)
// ---------------------------------------------------------------------------

// Mirrors space-x/y: every child except the last gets a border on both edges of
// the axis, weighted by --ri-divide-{x,y}-reverse (0 → visible border on the end
// edge; 1, set by divide-*-reverse, → visible border on the start edge).
function resolveDivide(full: string, axis: "x" | "y"): UtilityResult | null {
	const reverseVar = `--ri-divide-${axis}-reverse`;
	const rest = full.slice(8); // after "divide-x" / "divide-y"
	if (rest === "-reverse") {
		return {
			declarations: [{ property: reverseVar, value: "1" }],
			nestedSelector: "& > :not(:last-child)",
		};
	}
	let width: string;
	if (rest === "") {
		width = "1px";
	} else {
		const val = full.slice(9); // after "divide-x-" / "divide-y-"
		const arb = extractArbitrary(val);
		if (arb) {
			width = arb;
		} else if (INTEGER_RE.test(val)) {
			width = `${val}px`;
		} else {
			return null;
		}
	}
	const startProp = axis === "x" ? "border-inline-start-width" : "border-block-start-width";
	const endProp = axis === "x" ? "border-inline-end-width" : "border-block-end-width";
	return {
		declarations: [
			{ property: reverseVar, value: "0" },
			{ property: startProp, value: `calc(${width} * var(${reverseVar}))` },
			{ property: endProp, value: `calc(${width} * calc(1 - var(${reverseVar})))` },
		],
		nestedSelector: "& > :not(:last-child)",
	};
}

// ---------------------------------------------------------------------------
// Directional border-width map
// ---------------------------------------------------------------------------

// Trailing-dash entries derived at module init from the merge's shared map
// (merge/props.ts) so the width property this generator emits and the property
// ri() claims for conflict resolution can never drift apart.
const BORDER_DIR_PROPS_ENTRIES: ReadonlyArray<readonly [string, string]> = Object.entries(
	BORDER_DIR_PROPS,
).map(([prefix, props]) => [`${prefix}-`, props[0]] as const);

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function borderGenerator(
	_utility: string,
	_value: string | null,
	full: string,
	negative: boolean,
	_theme: ResolvedTheme,
	_warnings?: string[],
	dataType?: string | null,
): UtilityResult | null {
	// A `color` hint routes to colorGenerator — this generator handles widths,
	// styles, and radii. Bail early so borderGenerator never emits a width for
	// values the user explicitly marked as a color.
	if (dataType === "color") return null;

	// Static utilities
	if (Object.hasOwn(STATIC_BORDER, full)) return STATIC_BORDER[full];

	// corner-[superellipse(2)] — arbitrary corner-shape value
	if (full.startsWith("corner-")) {
		const arb = extractArbitrary(full.slice(7));
		if (arb !== null) {
			return multi(["corner-shape", arb], ["--ri-rounded-scale", "1"]);
		}
	}

	// rounded-{...}: border-radius
	if (full.startsWith("rounded-")) {
		const rest = full.slice(8);

		// Check for corner: rounded-tl-4, rounded-ss-2, etc.
		// `rest.startsWith(suffix + "-")` via charCode — no per-entry template.
		for (const [suffix, prop] of ROUNDED_CORNER_ENTRIES) {
			if (rest.startsWith(suffix) && rest.charCodeAt(suffix.length) === 45 /* '-' */) {
				const size = rest.slice(suffix.length + 1);
				const r = resolveRadius(size);
				if (r) return single(prop, r);
			}
		}

		// Check for side: rounded-t-4, rounded-s-2, etc.
		for (const [suffix, props] of ROUNDED_SIDE_ENTRIES) {
			if (rest.startsWith(suffix) && rest.charCodeAt(suffix.length) === 45 /* '-' */) {
				const size = rest.slice(suffix.length + 1);
				const r = resolveRadius(size);
				if (r) return multi(...props.map((p) => [p, r] as [string, string]));
			}
		}

		// rounded-scale-*: per-element --ri-rounded-scale override
		if (rest.startsWith("scale-")) {
			const scaleVal = rest.slice(6);
			if (scaleVal === "none") return single("--ri-rounded-scale", "1");
			const arbScale = extractArbitrary(scaleVal);
			if (arbScale !== null) return single("--ri-rounded-scale", arbScale);
			if (DECIMAL_RE.test(scaleVal)) {
				return single("--ri-rounded-scale", normalizeDecimalToken(scaleVal));
			}
			return null;
		}

		// Full border-radius
		const r = resolveRadius(rest);
		if (r) return single("border-radius", r);
	}

	// border-{n}: border-width by number
	if (full.startsWith("border-")) {
		const name = full.slice(7);
		if (INTEGER_RE.test(name)) return single("border-width", `${name}px`);
		// Without a hint, reject color-shaped arbitraries so they fall through
		// to colorGenerator. An explicit non-color hint (length/line-width/etc.)
		// bypasses this so the user's intent wins.
		if (!dataType && name.startsWith("[") && isBracketedColor(name)) return null;
		const arbBorder = extractArbitrary(name);
		if (arbBorder) return single("border-width", arbBorder);
	}

	// Directional border-width: border-t-{n}, border-b-{n}, etc.
	for (const [prefix, prop] of BORDER_DIR_PROPS_ENTRIES) {
		if (full.startsWith(prefix)) {
			const val = full.slice(prefix.length);
			if (INTEGER_RE.test(val)) return single(prop, `${val}px`);
			if (!dataType && val.startsWith("[") && isBracketedColor(val)) return null;
			const arbDir = extractArbitrary(val);
			if (arbDir) return single(prop, arbDir);
		}
	}

	// divide-x, divide-y
	if (full === "divide-x" || full.startsWith("divide-x-")) {
		return resolveDivide(full, "x");
	}
	if (full === "divide-y" || full.startsWith("divide-y-")) {
		return resolveDivide(full, "y");
	}

	// divide-{style}
	if (
		full === "divide-solid" ||
		full === "divide-dashed" ||
		full === "divide-dotted" ||
		full === "divide-double" ||
		full === "divide-hidden" ||
		full === "divide-none"
	) {
		const style = full.slice(7);
		return {
			declarations: [{ property: "border-style", value: style }],
			nestedSelector: "& > :not(:last-child)",
		};
	}

	// outline-offset-{n} (must check before outline-{n})
	if (full.startsWith("outline-offset-")) {
		const name = full.slice(15);
		if (/^-?\d+$/.test(name)) {
			const px = `${name}px`;
			return single("outline-offset", negative ? `calc(${px} * -1)` : px);
		}
		const arbOutOff = extractArbitrary(name);
		if (arbOutOff) return single("outline-offset", arbOutOff);
	}

	// outline-{n}: outline-width
	if (full.startsWith("outline-")) {
		const name = full.slice(8);
		if (INTEGER_RE.test(name)) return single("outline-width", `${name}px`);
		// Color-shaped arbitraries belong to colorGenerator (outline-color)
		// unless the user forced a non-color hint.
		if (!dataType && name.startsWith("[") && isBracketedColor(name)) return null;
		const arbOut = extractArbitrary(name);
		if (arbOut) return single("outline-width", arbOut);
	}

	return null;
}
