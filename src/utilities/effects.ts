/**
 * Effects utilities — shadow, opacity, blur, transitions,
 * transforms, filters, masks.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import {
	type UtilityResult,
	single,
	multi,
	fullName,
	extractArbitrary,
	INTEGER_RE,
	DECIMAL_RE,
	deepFreezeUtilityMap,
	normalizeDecimalToken,
	spacingLookup,
} from "./index.js";
import { resolveColor, isBracketedColor } from "./color.js";
import { isMaskRadialSizeValue } from "../merge/props.js";

// ---------------------------------------------------------------------------
// Composable filter / backdrop-filter via CSS variables
// ---------------------------------------------------------------------------

const FILTER_COMPOSED =
	"var(--ri-blur, ) var(--ri-brightness, ) var(--ri-contrast, ) var(--ri-grayscale, ) var(--ri-hue-rotate, ) var(--ri-invert, ) var(--ri-saturate, ) var(--ri-sepia, ) var(--ri-drop-shadow, )";

const BACKDROP_FILTER_COMPOSED =
	"var(--ri-backdrop-blur, ) var(--ri-backdrop-brightness, ) var(--ri-backdrop-contrast, ) var(--ri-backdrop-grayscale, ) var(--ri-backdrop-hue-rotate, ) var(--ri-backdrop-invert, ) var(--ri-backdrop-saturate, ) var(--ri-backdrop-sepia, ) var(--ri-backdrop-opacity, )";

// Composable `transform` (rotate-x/y/z + skew-x/y). Each utility sets its slot
// var and emits this; per-function identity fallbacks keep it valid when unset.
const TRANSFORM_COMPOSED =
	"var(--ri-rotate-x, rotateX(0)) var(--ri-rotate-y, rotateY(0)) var(--ri-rotate-z, rotateZ(0)) var(--ri-skew-x, skewX(0)) var(--ri-skew-y, skewY(0))";

// ---------------------------------------------------------------------------
// Static utilities
// ---------------------------------------------------------------------------

const STATIC_EFFECTS: Readonly<Record<string, UtilityResult>> = {
	// Transition
	transition: multi(
		[
			"transition-property",
			"color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --ri-gradient-from, --ri-gradient-via, --ri-gradient-to, opacity, box-shadow, transform, translate, scale, rotate, filter, -webkit-backdrop-filter, backdrop-filter, display, content-visibility, overlay, pointer-events",
		],
		["transition-timing-function", "cubic-bezier(0.4, 0, 0.2, 1)"],
		["transition-duration", "150ms"],
	),
	"transition-all": multi(
		["transition-property", "all"],
		["transition-timing-function", "cubic-bezier(0.4, 0, 0.2, 1)"],
		["transition-duration", "150ms"],
	),
	"transition-colors": multi(
		[
			"transition-property",
			"color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --ri-gradient-from, --ri-gradient-via, --ri-gradient-to",
		],
		["transition-timing-function", "cubic-bezier(0.4, 0, 0.2, 1)"],
		["transition-duration", "150ms"],
	),
	"transition-opacity": multi(
		["transition-property", "opacity"],
		["transition-timing-function", "cubic-bezier(0.4, 0, 0.2, 1)"],
		["transition-duration", "150ms"],
	),
	"transition-shadow": multi(
		["transition-property", "box-shadow"],
		["transition-timing-function", "cubic-bezier(0.4, 0, 0.2, 1)"],
		["transition-duration", "150ms"],
	),
	"transition-transform": multi(
		["transition-property", "transform, translate, scale, rotate"],
		["transition-timing-function", "cubic-bezier(0.4, 0, 0.2, 1)"],
		["transition-duration", "150ms"],
	),
	"transition-none": single("transition-property", "none"),
	"transition-normal": single("transition-behavior", "normal"),
	"transition-discrete": single("transition-behavior", "allow-discrete"),

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

	// Mix blend mode
	"mix-blend-normal": single("mix-blend-mode", "normal"),
	"mix-blend-multiply": single("mix-blend-mode", "multiply"),
	"mix-blend-screen": single("mix-blend-mode", "screen"),
	"mix-blend-overlay": single("mix-blend-mode", "overlay"),
	"mix-blend-darken": single("mix-blend-mode", "darken"),
	"mix-blend-lighten": single("mix-blend-mode", "lighten"),
	"mix-blend-color-dodge": single("mix-blend-mode", "color-dodge"),
	"mix-blend-color-burn": single("mix-blend-mode", "color-burn"),
	"mix-blend-hard-light": single("mix-blend-mode", "hard-light"),
	"mix-blend-soft-light": single("mix-blend-mode", "soft-light"),
	"mix-blend-difference": single("mix-blend-mode", "difference"),
	"mix-blend-exclusion": single("mix-blend-mode", "exclusion"),
	"mix-blend-hue": single("mix-blend-mode", "hue"),
	"mix-blend-saturation": single("mix-blend-mode", "saturation"),
	"mix-blend-color": single("mix-blend-mode", "color"),
	"mix-blend-luminosity": single("mix-blend-mode", "luminosity"),
	"mix-blend-plus-darker": single("mix-blend-mode", "plus-darker"),
	"mix-blend-plus-lighter": single("mix-blend-mode", "plus-lighter"),

	// Filter — grayscale/invert/sepia (bare + numeric) are handled dynamically via
	// FILTER_TABLE (bare100); only the literal `filter-none` reset is static here.
	"filter-none": single("filter", "none"),

	// Background none (image only — v4; not the `background` shorthand)
	"bg-none": single("background-image", "none"),

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

	// Backdrop filter
	"backdrop-blur-none": single("backdrop-filter", "none"),
};
deepFreezeUtilityMap(STATIC_EFFECTS);

// ---------------------------------------------------------------------------
// Background static utilities (separated for clarity)
// ---------------------------------------------------------------------------

const STATIC_BACKGROUND: Readonly<Record<string, UtilityResult>> = {
	"bg-cover": single("background-size", "cover"),
	"bg-contain": single("background-size", "contain"),
	"bg-auto": single("background-size", "auto"),
	"bg-center": single("background-position", "center"),
	"bg-top": single("background-position", "top"),
	"bg-top-left": single("background-position", "top left"),
	"bg-top-right": single("background-position", "top right"),
	"bg-bottom": single("background-position", "bottom"),
	"bg-bottom-left": single("background-position", "bottom left"),
	"bg-bottom-right": single("background-position", "bottom right"),
	"bg-left": single("background-position", "left"),
	"bg-right": single("background-position", "right"),
	"bg-repeat": single("background-repeat", "repeat"),
	"bg-no-repeat": single("background-repeat", "no-repeat"),
	"bg-repeat-x": single("background-repeat", "repeat-x"),
	"bg-repeat-y": single("background-repeat", "repeat-y"),
	"bg-repeat-round": single("background-repeat", "round"),
	"bg-repeat-space": single("background-repeat", "space"),
	"bg-fixed": single("background-attachment", "fixed"),
	"bg-local": single("background-attachment", "local"),
	"bg-scroll": single("background-attachment", "scroll"),
	"bg-clip-border": single("background-clip", "border-box"),
	"bg-clip-padding": single("background-clip", "padding-box"),
	"bg-clip-content": single("background-clip", "content-box"),
	"bg-clip-text": single("background-clip", "text"),
	"bg-origin-border": single("background-origin", "border-box"),
	"bg-origin-padding": single("background-origin", "padding-box"),
	"bg-origin-content": single("background-origin", "content-box"),

	"bg-blend-normal": single("background-blend-mode", "normal"),
	"bg-blend-multiply": single("background-blend-mode", "multiply"),
	"bg-blend-screen": single("background-blend-mode", "screen"),
	"bg-blend-overlay": single("background-blend-mode", "overlay"),
	"bg-blend-darken": single("background-blend-mode", "darken"),
	"bg-blend-lighten": single("background-blend-mode", "lighten"),
	"bg-blend-color-dodge": single("background-blend-mode", "color-dodge"),
	"bg-blend-color-burn": single("background-blend-mode", "color-burn"),
	"bg-blend-hard-light": single("background-blend-mode", "hard-light"),
	"bg-blend-soft-light": single("background-blend-mode", "soft-light"),
	"bg-blend-difference": single("background-blend-mode", "difference"),
	"bg-blend-exclusion": single("background-blend-mode", "exclusion"),
	"bg-blend-hue": single("background-blend-mode", "hue"),
	"bg-blend-saturation": single("background-blend-mode", "saturation"),
	"bg-blend-color": single("background-blend-mode", "color"),
	"bg-blend-luminosity": single("background-blend-mode", "luminosity"),
};
deepFreezeUtilityMap(STATIC_BACKGROUND);

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
// Sub-generators
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Composable box-shadow (shadow · inset-shadow · ring · inset-ring)
//
// Every shadow/ring utility writes its own slot var AND emits one shared
// `box-shadow` composing all slots, so a ring and a shadow layer instead of
// clobbering each other (the merge survival rule keeps distinct slot vars).
// Unset slots fall back to the `0 0 #0000` no-op via inline fallbacks, so no
// @property registration is needed (box-shadow isn't a registerable syntax).
// ---------------------------------------------------------------------------

const SHADOW_COMPOSITION =
	"var(--ri-inset-shadow, 0 0 #0000), var(--ri-inset-ring-shadow, 0 0 #0000), var(--ri-ring-offset-shadow, 0 0 #0000), var(--ri-ring-shadow, 0 0 #0000), var(--ri-shadow, 0 0 #0000)";

function composedShadow(slot: string, value: string): UtilityResult {
	return multi([slot, value], ["box-shadow", SHADOW_COMPOSITION]);
}

// inset-shadow scale — self-contained values that bake in --ri-inset-shadow-color
// (so inset-shadow-{color} recolors them) with a light-dark default. Unlike the
// bespoke `shadow-*` depth scale, this new scale is color-parameterized.
const INSET_SHADOW_COLOR =
	"var(--ri-inset-shadow-color, light-dark(oklch(0 0 0 / 0.05), oklch(0 0 0 / 0.2)))";
const INSET_SHADOWS: Readonly<Record<string, string>> = Object.freeze({
	px: `inset 0 0 0 1px ${INSET_SHADOW_COLOR}`,
	"2xs": `inset 0 1px ${INSET_SHADOW_COLOR}`,
	xs: `inset 0 1px 1px ${INSET_SHADOW_COLOR}`,
	sm: `inset 0 2px 4px ${INSET_SHADOW_COLOR}`,
	md: `inset 0 4px 6px ${INSET_SHADOW_COLOR}`,
	lg: `inset 0 8px 10px ${INSET_SHADOW_COLOR}`,
	xl: `inset 0 12px 16px ${INSET_SHADOW_COLOR}`,
	"2xl": `inset 0 16px 24px ${INSET_SHADOW_COLOR}`,
});

// Shared color-or-arbitrary tail for the shadow / ring / text-shadow / drop-shadow
// families: a bracketed/themed color sets `colorVar`; a non-color arbitrary or
// custom property is handed to `onArbitrary` to build the family-specific slot.
function resolveColorOrArbitrary(
	name: string,
	colorVar: string,
	theme: ResolvedTheme,
	dataType: string | null | undefined,
	onArbitrary: (arb: string) => UtilityResult | null,
): UtilityResult | null {
	const isBracketed = name.startsWith("[") && name.endsWith("]");
	const explicitColor = dataType === "color";
	const explicitNonColor = dataType != null && dataType !== "color";
	if (isBracketed && (explicitColor || (!dataType && isBracketedColor(name)))) {
		const color = resolveColor(name, theme, dataType);
		if (color) return single(colorVar, color);
	}
	if (isBracketed && !explicitColor) {
		const arb = extractArbitrary(name);
		if (arb !== null) return onArbitrary(arb);
	}
	if (!explicitNonColor) {
		const themedColor = resolveColor(name, theme, dataType);
		if (themedColor) return single(colorVar, themedColor);
	}
	return null;
}

// shadow & inset-shadow: a color value sets the family's color var; a non-color
// arbitrary/custom-property sets the composed shadow slot.
function resolveShadowArbitrary(
	name: string,
	slot: string,
	colorVar: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	return resolveColorOrArbitrary(name, colorVar, theme, dataType, (arb) =>
		composedShadow(slot, arb),
	);
}

function resolveShadow(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	const name =
		full === "shadow"
			? Object.hasOwn(theme.shadows, "DEFAULT")
				? "DEFAULT"
				: Object.hasOwn(theme.shadows, "md")
					? "md"
					: ""
			: full.slice(7);
	if (name === "none") return composedShadow("--ri-shadow", "0 0 #0000");
	if (Object.hasOwn(theme.shadows, name))
		return composedShadow("--ri-shadow", `var(--shadow-${name})`);
	return resolveShadowArbitrary(name, "--ri-shadow", "--ri-shadow-color", theme, dataType);
}

function resolveInsetShadow(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	const name = full.slice(13); // "inset-shadow-".length
	if (name === "none") return composedShadow("--ri-inset-shadow", "inset 0 0 #0000");
	if (Object.hasOwn(INSET_SHADOWS, name))
		return composedShadow("--ri-inset-shadow", INSET_SHADOWS[name]);
	return resolveShadowArbitrary(
		name,
		"--ri-inset-shadow",
		"--ri-inset-shadow-color",
		theme,
		dataType,
	);
}

// ring / inset-ring: width forms build a ring shadow `[inset ]0 0 0 <w>
// var(--ri-*-ring-color, currentColor)`; color forms set the ring color var.
function resolveRingFamily(
	name: string,
	slot: string,
	colorVar: string,
	insetPrefix: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	const ring = (width: string) =>
		composedShadow(slot, `${insetPrefix}0 0 0 ${width} var(${colorVar}, currentColor)`);
	if (name === "") return ring("1px");
	if (INTEGER_RE.test(name)) return ring(`${name}px`);
	return resolveColorOrArbitrary(name, colorVar, theme, dataType, (arb) => ring(arb));
}

function resolveRing(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	return resolveRingFamily(
		full === "ring" ? "" : full.slice(5),
		"--ri-ring-shadow",
		"--ri-ring-color",
		"",
		theme,
		dataType,
	);
}

function resolveInsetRing(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	return resolveRingFamily(
		full === "inset-ring" ? "" : full.slice(11),
		"--ri-inset-ring-shadow",
		"--ri-inset-ring-color",
		"inset ",
		theme,
		dataType,
	);
}

// First-segment "inset" routes to the inset-shadow / inset-ring families;
// anything else (inset positioning) falls through to the spacing generator.
function resolveInset(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	if (full.startsWith("inset-shadow")) return resolveInsetShadow(full, theme, dataType);
	if (full === "inset-ring" || full.startsWith("inset-ring-"))
		return resolveInsetRing(full, theme, dataType);
	return null;
}

// text-shadow — independent of box-shadow; color uses its own
// --ri-text-shadow-color so it never collides with shadow-{color} in the merger.
// Scale values bake in that var (with a light-dark default) so text-shadow-{color}
// recolors them.
const TEXT_SHADOW_COLOR =
	"var(--ri-text-shadow-color, light-dark(oklch(0 0 0 / 0.12), oklch(0 0 0 / 0.45)))";
const TEXT_SHADOWS: Readonly<Record<string, string>> = Object.freeze({
	"2xs": `0 1px 1px ${TEXT_SHADOW_COLOR}`,
	xs: `0 1px 2px ${TEXT_SHADOW_COLOR}`,
	sm: `0 1px 3px ${TEXT_SHADOW_COLOR}, 0 1px 2px ${TEXT_SHADOW_COLOR}`,
	md: `0 1px 2px ${TEXT_SHADOW_COLOR}, 0 2px 4px ${TEXT_SHADOW_COLOR}`,
	lg: `0 2px 4px ${TEXT_SHADOW_COLOR}, 0 4px 8px ${TEXT_SHADOW_COLOR}`,
});

function resolveTextShadow(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	const name = full.slice(12); // "text-shadow-".length
	if (name === "none") return single("text-shadow", "none");
	if (Object.hasOwn(TEXT_SHADOWS, name)) return single("text-shadow", TEXT_SHADOWS[name]);
	return resolveColorOrArbitrary(name, "--ri-text-shadow-color", theme, dataType, (arb) =>
		single("text-shadow", arb),
	);
}

function resolveOpacity(full: string, theme: ResolvedTheme): UtilityResult | null {
	const val = full.slice(8);
	if (Object.hasOwn(theme.opacity, val)) return single("opacity", theme.opacity[val]);
	if (INTEGER_RE.test(val)) return single("opacity", `${val}%`);
	const arb = extractArbitrary(val);
	if (arb !== null) return single("opacity", arb);
	return null;
}

function resolveBlur(full: string, theme: ResolvedTheme): UtilityResult | null {
	const name = full === "blur" ? "DEFAULT" : full.slice(5);
	if (name === "none") return multi(["--ri-blur", "blur(0)"], ["filter", FILTER_COMPOSED]);
	if (Object.hasOwn(theme.blur, name))
		return multi(["--ri-blur", `blur(${theme.blur[name]})`], ["filter", FILTER_COMPOSED]);
	const arb = extractArbitrary(name);
	if (arb !== null) return multi(["--ri-blur", `blur(${arb})`], ["filter", FILTER_COMPOSED]);
	return null;
}

function resolveTimeValue(val: string, themeMap?: Readonly<Record<string, string>>): string | null {
	if (themeMap && Object.hasOwn(themeMap, val)) return themeMap[val];
	if (INTEGER_RE.test(val)) return `${val}ms`;
	return extractArbitrary(val);
}

function resolveDuration(full: string, theme: ResolvedTheme): UtilityResult | null {
	const val = full.slice(9);
	if (val === "initial")
		return multi(["transition-duration", "initial"], ["animation-duration", "initial"]);
	const resolved = resolveTimeValue(val, theme.duration);
	if (resolved) return multi(["transition-duration", resolved], ["animation-duration", resolved]);
	return null;
}

function resolveDelay(full: string): UtilityResult | null {
	const resolved = resolveTimeValue(full.slice(6));
	if (resolved) return multi(["transition-delay", resolved], ["animation-delay", resolved]);
	return null;
}

function resolveEase(full: string, theme: ResolvedTheme): UtilityResult | null {
	const val = full.slice(5);
	if (Object.hasOwn(theme.easing, val))
		return single("transition-timing-function", theme.easing[val]);
	if (val === "linear" || val === "initial") return single("transition-timing-function", val);
	const arb = extractArbitrary(val);
	if (arb !== null) return single("transition-timing-function", arb);
	return null;
}

function resolveTransition(full: string): UtilityResult | null {
	const val = full.slice(11); // "transition-".length === 11
	const arb = extractArbitrary(val);
	if (arb !== null)
		return multi(
			["transition-property", arb],
			["transition-timing-function", "cubic-bezier(0.4, 0, 0.2, 1)"],
			["transition-duration", "150ms"],
		);
	return null;
}

function resolveTranslate(full: string, negative: boolean): UtilityResult | null {
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

function resolveRotate(full: string, negative: boolean): UtilityResult | null {
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
function resolveScale(full: string, negative: boolean): UtilityResult | null {
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

function resolvePerspective(full: string): UtilityResult | null {
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
function resolveTransformBase(full: string): UtilityResult | null {
	const arb = extractArbitrary(full.slice(10)); // "transform-".length
	if (arb !== null) return single("transform", arb);
	return null;
}

function resolveZoom(full: string): UtilityResult | null {
	const rest = full.slice(5); // "zoom-".length
	const arb = extractArbitrary(rest);
	if (arb !== null) return single("zoom", arb);
	if (INTEGER_RE.test(rest)) return single("zoom", `${rest}%`);
	return null;
}

function resolveOrigin(full: string): UtilityResult | null {
	if (!full.startsWith("origin-")) return null;
	const rest = full.slice(7);
	const arb = extractArbitrary(rest);
	if (arb !== null) return single("transform-origin", arb);
	return null;
}

function resolveWillChange(full: string): UtilityResult | null {
	if (!full.startsWith("will-change-")) return null;
	const rest = full.slice(12);
	const arb = extractArbitrary(rest);
	if (arb !== null) return single("will-change", arb);
	return null;
}

function resolveSkew(full: string, negative: boolean): UtilityResult | null {
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

const FILTER_TABLE: ReadonlyArray<{
	prefix: string;
	fn: string;
	bare100?: boolean;
	negative?: boolean;
}> = [
	{ prefix: "brightness-", fn: "brightness" },
	{ prefix: "contrast-", fn: "contrast" },
	{ prefix: "saturate-", fn: "saturate" },
	{ prefix: "grayscale-", fn: "grayscale", bare100: true },
	{ prefix: "invert-", fn: "invert", bare100: true },
	{ prefix: "sepia-", fn: "sepia", bare100: true },
	{ prefix: "hue-rotate-", fn: "hue-rotate", negative: true },
];

// drop-shadow scale — inline, color-parameterized via --ri-drop-shadow-color (so
// drop-shadow-{color} recolors it) with a light-dark default. Mirrors inset-shadow.
const DROP_SHADOW_COLOR =
	"var(--ri-drop-shadow-color, light-dark(oklch(0 0 0 / 0.1), oklch(0 0 0 / 0.4)))";
const DROP_SHADOWS: Readonly<Record<string, string>> = Object.freeze({
	xs: `0 1px 1px ${DROP_SHADOW_COLOR}`,
	sm: `0 1px 2px ${DROP_SHADOW_COLOR}`,
	md: `0 3px 3px ${DROP_SHADOW_COLOR}`,
	lg: `0 4px 4px ${DROP_SHADOW_COLOR}`,
	xl: `0 9px 7px ${DROP_SHADOW_COLOR}`,
	"2xl": `0 25px 25px ${DROP_SHADOW_COLOR}`,
});

interface FilterTableEntry {
	prefix: string;
	fn: string;
	bare100?: boolean;
	negative?: boolean;
}

/**
 * Resolve one filter-table entry against a utility name. Shared by the
 * filter and backdrop-filter walks — they differ only in slot-var prefix and
 * composed declaration. Returns `undefined` when the entry doesn't match the
 * name at all (caller continues the table walk), `null` when it matches but
 * the value is invalid (walk stops — prefixes are mutually exclusive).
 */
function resolveFilterTableEntry(
	entry: FilterTableEntry,
	full: string,
	negative: boolean,
	varPrefix: string,
	composedProp: string,
	composedValue: string,
): UtilityResult | null | undefined {
	// Bare form (e.g. `grayscale` → grayscale(100%)).
	if (entry.bare100 && full === entry.prefix.slice(0, -1))
		return multi([`${varPrefix}${entry.fn}`, `${entry.fn}(100%)`], [composedProp, composedValue]);
	if (!full.startsWith(entry.prefix)) return undefined;
	const val = full.slice(entry.prefix.length);
	const cssVar = `${varPrefix}${entry.fn}`;
	if (entry.negative) {
		if (INTEGER_RE.test(val))
			return multi(
				[cssVar, `${entry.fn}(${negative ? -Number(val) : Number(val)}deg)`],
				[composedProp, composedValue],
			);
		const arb = extractArbitrary(val);
		if (arb !== null)
			return multi(
				[cssVar, `${entry.fn}(${negative ? `calc(${arb} * -1)` : arb})`],
				[composedProp, composedValue],
			);
	} else {
		if (INTEGER_RE.test(val))
			return multi([cssVar, `${entry.fn}(${val}%)`], [composedProp, composedValue]);
		const arb = extractArbitrary(val);
		if (arb !== null) return multi([cssVar, `${entry.fn}(${arb})`], [composedProp, composedValue]);
	}
	return null;
}

function resolveFilter(
	full: string,
	negative: boolean,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	for (const entry of FILTER_TABLE) {
		const r = resolveFilterTableEntry(entry, full, negative, "--ri-", "filter", FILTER_COMPOSED);
		if (r !== undefined) return r;
	}
	if (full.startsWith("drop-shadow-")) {
		const val = full.slice(12);
		if (val === "none")
			return multi(["--ri-drop-shadow", "drop-shadow(0 0 #0000)"], ["filter", FILTER_COMPOSED]);
		if (Object.hasOwn(DROP_SHADOWS, val))
			return multi(
				["--ri-drop-shadow", `drop-shadow(${DROP_SHADOWS[val]})`],
				["filter", FILTER_COMPOSED],
			);
		return resolveColorOrArbitrary(val, "--ri-drop-shadow-color", theme, dataType, (arb) =>
			multi(["--ri-drop-shadow", `drop-shadow(${arb})`], ["filter", FILTER_COMPOSED]),
		);
	}
	return null;
}

// filter-(--c) / filter-[v]: a literal filter value that overrides the composition.
function resolveFilterBase(full: string): UtilityResult | null {
	const arb = extractArbitrary(full.slice(7)); // "filter-".length
	if (arb !== null) return single("filter", arb);
	return null;
}

/**
 * Table of backdrop filter mappings: [prefix, cssFunction, options].
 * `bare100` means the bare name (e.g., "backdrop-grayscale") outputs fn(100%).
 * `negative` means the value supports negation (only hue-rotate).
 */
const BACKDROP_FILTERS: FilterTableEntry[] = [
	{ prefix: "backdrop-brightness-", fn: "brightness" },
	{ prefix: "backdrop-contrast-", fn: "contrast" },
	{ prefix: "backdrop-saturate-", fn: "saturate" },
	{ prefix: "backdrop-grayscale-", fn: "grayscale", bare100: true },
	{ prefix: "backdrop-invert-", fn: "invert", bare100: true },
	{ prefix: "backdrop-sepia-", fn: "sepia", bare100: true },
	{ prefix: "backdrop-opacity-", fn: "opacity" },
	{ prefix: "backdrop-hue-rotate-", fn: "hue-rotate", negative: true },
];

function resolveBackdropFilter(
	full: string,
	theme: ResolvedTheme,
	negative: boolean,
): UtilityResult | null {
	// backdrop-filter base: none / custom-property / arbitrary (literal value).
	if (full.startsWith("backdrop-filter-")) {
		const v = full.slice(16);
		if (v === "none") return single("backdrop-filter", "none");
		const arb = extractArbitrary(v);
		if (arb !== null) return single("backdrop-filter", arb);
		return null;
	}
	// backdrop-blur uses theme.blur for named values
	if (full.startsWith("backdrop-blur-")) {
		const name = full.slice(14);
		if (name === "") return null;
		if (Object.hasOwn(theme.blur, name))
			return multi(
				["--ri-backdrop-blur", `blur(${theme.blur[name]})`],
				["backdrop-filter", BACKDROP_FILTER_COMPOSED],
			);
		const arb = extractArbitrary(name);
		if (arb !== null)
			return multi(
				["--ri-backdrop-blur", `blur(${arb})`],
				["backdrop-filter", BACKDROP_FILTER_COMPOSED],
			);
	}
	if (full === "backdrop-blur") {
		return Object.hasOwn(theme.blur, "DEFAULT")
			? multi(
					["--ri-backdrop-blur", `blur(${theme.blur.DEFAULT})`],
					["backdrop-filter", BACKDROP_FILTER_COMPOSED],
				)
			: null;
	}

	// Single table walk (bare form + value forms per entry) — bare names never
	// collide with another entry's dashed prefix, so one pass suffices.
	for (const entry of BACKDROP_FILTERS) {
		const r = resolveFilterTableEntry(
			entry,
			full,
			negative,
			"--ri-backdrop-",
			"backdrop-filter",
			BACKDROP_FILTER_COMPOSED,
		);
		if (r !== undefined) return r;
	}

	return null;
}

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

function resolveMask(
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

// ---------------------------------------------------------------------------
// Main Generator
// ---------------------------------------------------------------------------

/**
 * Prefix dispatch table for dynamic effects utilities. Maps the first
 * segment of the utility name to a resolver function, replacing the
 * previous linear chain of startsWith checks with O(1) dispatch.
 */
type EffectsResolver = (
	full: string,
	theme: ResolvedTheme,
	negative: boolean,
	dataType?: string | null,
) => UtilityResult | null;

/** One resolver instance for all eight filter-function prefixes. */
const filterResolver: EffectsResolver = (full, theme, negative, dataType) =>
	resolveFilter(full, negative, theme, dataType);

const EFFECTS_PREFIX_DISPATCH: ReadonlyMap<string, EffectsResolver> = new Map<
	string,
	EffectsResolver
>([
	["transition", (full) => resolveTransition(full)],
	["shadow", (full, theme, _negative, dataType) => resolveShadow(full, theme, dataType)],
	["ring", (full, theme, _negative, dataType) => resolveRing(full, theme, dataType)],
	["inset", (full, theme, _negative, dataType) => resolveInset(full, theme, dataType)],
	["opacity", (full, theme) => resolveOpacity(full, theme)],
	["blur", (full, theme) => resolveBlur(full, theme)],
	["duration", (full, theme) => resolveDuration(full, theme)],
	["delay", (full) => resolveDelay(full)],
	["ease", (full, theme) => resolveEase(full, theme)],
	["translate", (full, _theme, negative) => resolveTranslate(full, negative)],
	["rotate", (full, _theme, negative) => resolveRotate(full, negative)],
	["scale", (full, _theme, negative) => resolveScale(full, negative)],
	["skew", (full, _theme, negative) => resolveSkew(full, negative)],
	[
		"mask",
		(full, theme, negative, dataType) => resolveMask(full.slice(5), negative, theme, dataType),
	],
	["filter", (full) => resolveFilterBase(full)],
	["brightness", filterResolver],
	["contrast", filterResolver],
	["saturate", filterResolver],
	["grayscale", filterResolver],
	["invert", filterResolver],
	["sepia", filterResolver],
	["hue", filterResolver],
	["drop", filterResolver],
	["backdrop", (full, theme, negative) => resolveBackdropFilter(full, theme, negative)],
	["perspective", (full) => resolvePerspective(full)],
	["transform", (full) => resolveTransformBase(full)],
	["zoom", (full) => resolveZoom(full)],
	["origin", (full) => resolveOrigin(full)],
	["will", (full) => resolveWillChange(full)],
]);

export function effectsGenerator(
	utility: string,
	value: string | null,
	negative: boolean,
	theme: ResolvedTheme,
	_warnings?: string[],
	dataType?: string | null,
): UtilityResult | null {
	const full = fullName(utility, value);

	// Check static utilities
	if (Object.hasOwn(STATIC_EFFECTS, full)) return STATIC_EFFECTS[full];
	if (Object.hasOwn(STATIC_BACKGROUND, full)) return STATIC_BACKGROUND[full];

	// text-shadow shares the "text" first segment with typography, so it's
	// dispatched here explicitly rather than via the first-segment table.
	if (full.startsWith("text-shadow")) return resolveTextShadow(full, theme, dataType);

	// Dispatch by first segment (before the first hyphen)
	const hyphenIdx = full.indexOf("-");
	const prefix = hyphenIdx === -1 ? full : full.slice(0, hyphenIdx);
	const resolver = EFFECTS_PREFIX_DISPATCH.get(prefix);
	if (resolver) return resolver(full, theme, negative, dataType);

	return null;
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
