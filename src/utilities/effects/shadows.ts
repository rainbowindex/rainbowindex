/**
 * Shadow-family utilities — shadow, inset-shadow, ring, inset-ring,
 * text-shadow — plus the shared family template the drop-shadow filter
 * also composes.
 */

import type { ResolvedTheme } from "../../directives/foundation.js";
import { isBracketedColor, resolveColor } from "../color.js";
import { extractArbitrary, INTEGER_RE, multi, single, type UtilityResult } from "../helpers.js";
import { withShadowColorSlotLayers } from "../../css/shadow-color.js";

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

/** Everything that distinguishes one shadow family from another. */
export interface ShadowFamily {
	/** The family's `none` reset. Not a shadow anyone can colour, so it bypasses
	 *  the slot — `0 0 #0000` would otherwise gain a fallback nothing can use. */
	readonly none: string;
	readonly colorVar: string;
	/**
	 * Whether `<family>-initial` is a spelling this family has.
	 *
	 * It unsets the family's colour var so the shadow value's own baked-in
	 * colour applies again — used under a variant, as in `shadow-red-500
	 * dark:shadow-initial`. Tailwind registers it for box, inset and text
	 * shadows and not for drop-shadow, which shares this resolver.
	 */
	readonly initial: boolean;
	/**
	 * Layers, not one string: `drop-shadow()` takes exactly one shadow, so a
	 * two-layer value has to become two space-separated calls rather than one
	 * call with two arguments. Each family joins them as its property needs.
	 */
	readonly wrap: (layers: readonly string[]) => UtilityResult;
}

// Shared template for every shadow family: each accepts `none`, maybe
// `initial`, a colour, or an arbitrary value, and routes all of them through
// the family's own `wrap`.
export function resolveShadowFamily(
	name: string,
	theme: ResolvedTheme,
	dataType: string | null | undefined,
	family: ShadowFamily,
): UtilityResult | null {
	if (name === "none") return family.wrap([family.none]);
	if (family.initial && name === "initial") return single(family.colorVar, "initial");
	return resolveColorOrArbitrary(name, family.colorVar, theme, dataType, (arb) =>
		family.wrap(withShadowColorSlotLayers(arb, family.colorVar)),
	);
}

/** `shadow-*`. Its theme lookup is the one thing the shared template lacks. */
const BOX_SHADOW: ShadowFamily = {
	none: "0 0 #0000",
	colorVar: "--ri-shadow-color",
	initial: true,
	wrap: (layers) => composedShadow("--ri-shadow", layers.join(", ")),
};

const INSET_SHADOW: ShadowFamily = {
	none: "inset 0 0 #0000",
	colorVar: "--ri-inset-shadow-color",
	initial: true,
	wrap: (layers) => composedShadow("--ri-inset-shadow", layers.join(", ")),
};

const TEXT_SHADOW: ShadowFamily = {
	none: "none",
	colorVar: "--ri-text-shadow-color",
	initial: true,
	wrap: (layers) => single("text-shadow", layers.join(", ")),
};

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
	//
	// The token's value is INLINED rather than referenced as `var(--shadow-md)`,
	// because the colour slot has to sit inside the value and a slot written into
	// a `:root` token resolves against `:root` — see css/shadow-color.ts. The
	// cost is that `--shadow-md` is no longer referenced, so token pruning stops
	// emitting it unless the project's own CSS names it. Tailwind makes exactly
	// the same trade for exactly the same reason.
	if (Object.hasOwn(theme.shadows, name)) {
		return BOX_SHADOW.wrap(withShadowColorSlotLayers(theme.shadows[name], BOX_SHADOW.colorVar));
	}
	// `none`, `initial`, a colour, an arbitrary value — all of it is the shared
	// template, which the theme lookup above is the only thing to precede.
	return resolveShadowFamily(name, theme, dataType, BOX_SHADOW);
}

function resolveInsetShadow(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	return resolveShadowFamily(full.slice(13) /* "inset-shadow-" */, theme, dataType, INSET_SHADOW);
}

// The outer ring carries two pieces of state its `inset-ring` sibling does
// not. `ring-inset` flips it inward through `--ri-ring-inset`, and
// `ring-offset-*` widens it through `--ri-ring-offset-width`. Both are read at
// use time by a rule that may have been emitted before either class was
// written, so a plain `ring-2` has to leave room for them unconditionally —
// hence the empty flag fallback (an unset var contributes nothing) and the
// `0px` width fallback. Tailwind reaches the same defaults through @property
// registration; the slot vars here are deliberately unregistered (box-shadow
// is not a registerable syntax), so the fallbacks carry them instead.
// Trailing space, mirroring the literal `"inset "` the sibling family passes:
// both stand in the same slot, and an unset flag then leaves a harmless leading
// space rather than gluing itself to the first offset.
const RING_INSET_FLAG = "var(--ri-ring-inset, ) ";
const RING_OFFSET_WIDTH = "var(--ri-ring-offset-width, 0px)";

/** Everything that distinguishes `ring` from `inset-ring`. */
interface RingFamily {
	readonly slot: string;
	readonly colorVar: string;
	/** What stands where `inset` would: a literal for the always-inset family,
	 *  the toggling var for the one `ring-inset` can flip. */
	readonly insetPrefix: string;
	/** Whether `ring-offset-*` widens this ring. Only the outer one. */
	readonly offsetAware: boolean;
}

/** `ring-*`. `ring-inset` flips it inward and `ring-offset-*` widens it, both
 *  through vars read at use time — hence the fallbacks, not a fixed value. */
const RING: RingFamily = {
	slot: "--ri-ring-shadow",
	colorVar: "--ri-ring-color",
	insetPrefix: RING_INSET_FLAG,
	offsetAware: true,
};

/** `inset-ring-*`: always inset, never offset, so it takes the literal prefix
 *  and the bare width — matching Tailwind v4.3.3 value-for-value. */
const INSET_RING: RingFamily = {
	slot: "--ri-inset-ring-shadow",
	colorVar: "--ri-inset-ring-color",
	insetPrefix: "inset ",
	offsetAware: false,
};

// Width forms build a ring shadow `<flag>0 0 0 <w> var(--ri-*-ring-color,
// currentColor)`; color forms set the ring color var.
function resolveRingFamily(
	name: string,
	theme: ResolvedTheme,
	dataType: string | null | undefined,
	family: RingFamily,
): UtilityResult | null {
	const ring = (width: string) => {
		const w = family.offsetAware ? `calc(${width} + ${RING_OFFSET_WIDTH})` : width;
		return composedShadow(
			family.slot,
			`${family.insetPrefix}0 0 0 ${w} var(${family.colorVar}, currentColor)`,
		);
	};
	if (name === "") return ring("1px");
	if (INTEGER_RE.test(name)) return ring(`${name}px`);
	return resolveColorOrArbitrary(name, family.colorVar, theme, dataType, (arb) => ring(arb));
}

/**
 * `ring-offset-*` — the width form writes the offset width and the offset
 * ring's own shadow layer; the colour form writes only the colour.
 *
 * Neither emits `box-shadow`. The layer joins the chain that a `ring-*` (or any
 * other shadow-family class) already composes, which is exactly what keeps
 * `ri("ring-2 ring-offset-2")` from deleting the ring: a claim on `box-shadow`
 * here would dominate the ring that does the visible work. Tailwind emits the
 * same two declarations and no shorthand, for the same reason.
 */
function resolveRingOffset(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	const name = full.slice(12); // "ring-offset-".length
	const offset = (width: string) =>
		multi(
			["--ri-ring-offset-width", width],
			[
				"--ri-ring-offset-shadow",
				`${RING_INSET_FLAG}0 0 0 ${RING_OFFSET_WIDTH} var(--ri-ring-offset-color, #fff)`,
			],
		);
	if (INTEGER_RE.test(name)) return offset(`${name}px`);
	return resolveColorOrArbitrary(name, "--ri-ring-offset-color", theme, dataType, (arb) =>
		offset(arb),
	);
}

export function resolveRing(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	// `ring-offset-*` gets first refusal, but only that. A theme is free to name
	// a colour `offset-blue`, and then `ring-offset-blue` is a ring colour that
	// happens to start with the longer prefix — so when the offset family cannot
	// make sense of the value, the name falls through to the ring family rather
	// than being rejected. Returning the offset result directly made
	// `ring-offset-blue` an unknown utility under such a theme, which is worse
	// than the ambiguity it was meant to settle.
	const offset = full.startsWith("ring-offset-") ? resolveRingOffset(full, theme, dataType) : null;
	if (offset) return offset;
	const ring = resolveRingFamily(full === "ring" ? "" : full.slice(5), theme, dataType, RING);
	if (ring) return ring;
	// `ring-inset` is the v3 spelling that survives into v4: it sets the flag the
	// ring shadow reads and nothing else. It is answered only after the colour
	// lookup above has declined, so a project that declares `@color { inset: … }`
	// still gets `ring-inset` as that colour — the order the merge layer's
	// RING_DUAL_MODE already assumes.
	if (full === "ring-inset") return single("--ri-ring-inset", "inset");
	return null;
}

function resolveInsetRing(
	full: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	return resolveRingFamily(
		full === "inset-ring" ? "" : full.slice(11),
		theme,
		dataType,
		INSET_RING,
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
	return resolveShadowFamily(full.slice(12) /* "text-shadow-" */, theme, dataType, TEXT_SHADOW);
}
