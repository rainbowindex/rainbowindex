/**
 * Shadow-family utilities — shadow, inset-shadow, ring, inset-ring,
 * text-shadow — plus the shared scaled-shadow template the drop-shadow
 * filter also composes.
 */

import type { ResolvedTheme } from "../../directives/foundation.js";
import { type UtilityResult, single, multi, extractArbitrary, INTEGER_RE } from "../helpers.js";
import { resolveColor, isBracketedColor } from "../color.js";

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

// Shared template for the color-parameterized shadow scales (inset-shadow,
// text-shadow, drop-shadow): `none` and scale names go through the same
// family-specific `wrap` as a color/arbitrary tail, so the three families
// can't drift in how they treat the scale.
export function resolveScaledShadowFamily(
	name: string,
	scale: Readonly<Record<string, string>>,
	noneValue: string,
	colorVar: string,
	theme: ResolvedTheme,
	dataType: string | null | undefined,
	wrap: (value: string) => UtilityResult,
): UtilityResult | null {
	if (name === "none") return wrap(noneValue);
	if (Object.hasOwn(scale, name)) return wrap(scale[name]);
	return resolveColorOrArbitrary(name, colorVar, theme, dataType, wrap);
}

export function resolveShadow(
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
	// A color value sets the family's color var; a non-color arbitrary or
	// custom property sets the composed shadow slot.
	return resolveColorOrArbitrary(name, "--ri-shadow-color", theme, dataType, (arb) =>
		composedShadow("--ri-shadow", arb),
	);
}

function resolveInsetShadow(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	return resolveScaledShadowFamily(
		full.slice(13), // "inset-shadow-".length
		INSET_SHADOWS,
		"inset 0 0 #0000",
		"--ri-inset-shadow-color",
		theme,
		dataType,
		(value) => composedShadow("--ri-inset-shadow", value),
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

export function resolveRing(
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
export function resolveInset(
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

export function resolveTextShadow(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	return resolveScaledShadowFamily(
		full.slice(12), // "text-shadow-".length
		TEXT_SHADOWS,
		"none",
		"--ri-text-shadow-color",
		theme,
		dataType,
		(value) => single("text-shadow", value),
	);
}
