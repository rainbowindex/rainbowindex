/**
 * Background keyword statics — bg-* utilities whose values are fixed keywords
 * (size, position, repeat, attachment, clip, origin, blend mode, image reset).
 *
 * Dynamic bg-* handling (background colors, gradients, arbitrary
 * image/position/size values) lives in color.ts. `resolveStaticBackground`
 * deliberately runs LAST in colorGenerator, so theme colors named like these
 * keywords (e.g. a color literally called "fixed") keep today's precedence.
 */

import { type UtilityResult, single, deepFreezeUtilityMap } from "./helpers.js";

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

	// Background none (image only — v4; not the `background` shorthand)
	"bg-none": single("background-image", "none"),
};
deepFreezeUtilityMap(STATIC_BACKGROUND);
// Key list export for editor enumeration — the map itself stays private.
export const BACKGROUND_STATIC_NAMES: readonly string[] = Object.freeze(
	Object.keys(STATIC_BACKGROUND),
);

/** Look up a bg-* keyword static; null when the name isn't one. */
export function resolveStaticBackground(full: string): UtilityResult | null {
	return Object.hasOwn(STATIC_BACKGROUND, full) ? STATIC_BACKGROUND[full] : null;
}
