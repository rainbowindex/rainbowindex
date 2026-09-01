/**
 * Shadow-family utilities — shadow, inset-shadow, ring, inset-ring,
 * text-shadow — plus the shared family template the drop-shadow filter
 * also composes.
 */

import type { ResolvedTheme } from "../../directives/foundation.js";
import { isBracketedColor, resolveColor } from "../color.js";
import { extractArbitrary, INTEGER_RE, multi, single, type UtilityResult } from "../helpers.js";

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

// Shared template for the scale-less shadow families (inset-shadow,
// text-shadow, drop-shadow): each accepts `none`, a color, or an arbitrary
// value, and routes all three through the same family-specific `wrap`.
export function resolveShadowFamily(
	name: string,
	noneValue: string,
	colorVar: string,
	theme: ResolvedTheme,
	dataType: string | null | undefined,
	wrap: (value: string) => UtilityResult,
): UtilityResult | null {
	if (name === "none") return wrap(noneValue);
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
	// Theme first: `@shadow { none: … }` replaces the built-in reset instead of
	// being silently dropped. RI-1124 warns at definition time.
	if (Object.hasOwn(theme.shadows, name))
		return composedShadow("--ri-shadow", `var(--shadow-${name})`);
	if (name === "none") return composedShadow("--ri-shadow", "0 0 #0000");
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
	return resolveShadowFamily(
		full.slice(13), // "inset-shadow-".length
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
export function resolveTextShadow(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	return resolveShadowFamily(
		full.slice(12), // "text-shadow-".length
		"none",
		"--ri-text-shadow-color",
		theme,
		dataType,
		(value) => single("text-shadow", value),
	);
}
