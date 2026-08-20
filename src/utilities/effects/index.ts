/**
 * Effects utilities — shadow, opacity, blur, transitions, transforms,
 * filters, masks. Each family lives in its own module here; this module
 * merges their statics, assembles the prefix dispatch table, and exposes
 * the generator.
 */

import type { ResolvedTheme } from "../../directives/foundation.js";
import { type UtilityResult, single, deepFreezeUtilityMap } from "../helpers.js";
import { resolveShadow, resolveRing, resolveInset, resolveTextShadow } from "./shadows.js";
import {
	TRANSITION_STATICS,
	resolveOpacity,
	resolveDuration,
	resolveDelay,
	resolveEase,
	resolveTransition,
} from "./transitions.js";
import {
	FILTER_STATICS,
	resolveBlur,
	resolveFilter,
	resolveFilterBase,
	resolveBackdropFilter,
} from "./filters.js";
import {
	TRANSFORM_STATICS,
	resolveTranslate,
	resolveRotate,
	resolveScale,
	resolveSkew,
	resolvePerspective,
	resolveTransformBase,
	resolveZoom,
	resolveOrigin,
	resolveWillChange,
} from "./transforms.js";
import { MASK_STATICS, resolveMask } from "./masks.js";

// mix-blend-mode fits no family module and resolves statics-only, so it
// lives here beside the merged map.
const MIX_BLEND_STATICS: Readonly<Record<string, UtilityResult>> = {
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
};
deepFreezeUtilityMap(MIX_BLEND_STATICS);

// All effects statics, merged from the per-family maps (each already deep-frozen).
const STATIC_EFFECTS: Readonly<Record<string, UtilityResult>> = Object.freeze({
	...TRANSITION_STATICS,
	...TRANSFORM_STATICS,
	...MIX_BLEND_STATICS,
	...FILTER_STATICS,
	...MASK_STATICS,
});
// Key list export for editor enumeration — the map itself stays private.
export const EFFECTS_STATIC_NAMES: readonly string[] = Object.freeze(Object.keys(STATIC_EFFECTS));

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

/** Dispatch-key list export (same pattern as EFFECTS_STATIC_NAMES) so the
 *  registration test can assert every key is reachable via PREFIX_DISPATCH. */
export const EFFECTS_DISPATCH_ROOTS: readonly string[] = Object.freeze([
	...EFFECTS_PREFIX_DISPATCH.keys(),
]);

export function effectsGenerator(
	_utility: string,
	_value: string | null,
	full: string,
	negative: boolean,
	theme: ResolvedTheme,
	_warnings?: string[],
	dataType?: string | null,
): UtilityResult | null {
	// Check static utilities
	if (Object.hasOwn(STATIC_EFFECTS, full)) return STATIC_EFFECTS[full];

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
