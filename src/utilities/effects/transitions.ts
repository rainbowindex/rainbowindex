/**
 * Transition & timing utilities — the transition-* statics plus dynamic
 * opacity, duration, delay, ease, and arbitrary transition-property forms.
 */

import type { ResolvedTheme } from "../../directives/foundation.js";
import {
	type UtilityResult,
	single,
	multi,
	extractArbitrary,
	INTEGER_RE,
	deepFreezeUtilityMap,
} from "../helpers.js";

export const TRANSITION_STATICS: Readonly<Record<string, UtilityResult>> = {
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
};
deepFreezeUtilityMap(TRANSITION_STATICS);

export function resolveOpacity(full: string, theme: ResolvedTheme): UtilityResult | null {
	const val = full.slice(8);
	if (Object.hasOwn(theme.opacity, val)) return single("opacity", theme.opacity[val]);
	if (INTEGER_RE.test(val)) return single("opacity", `${val}%`);
	const arb = extractArbitrary(val);
	if (arb !== null) return single("opacity", arb);
	return null;
}

function resolveTimeValue(val: string, themeMap?: Readonly<Record<string, string>>): string | null {
	if (themeMap && Object.hasOwn(themeMap, val)) return themeMap[val];
	if (INTEGER_RE.test(val)) return `${val}ms`;
	return extractArbitrary(val);
}

export function resolveDuration(full: string, theme: ResolvedTheme): UtilityResult | null {
	const val = full.slice(9);
	if (val === "initial")
		return multi(["transition-duration", "initial"], ["animation-duration", "initial"]);
	const resolved = resolveTimeValue(val, theme.duration);
	if (resolved) return multi(["transition-duration", resolved], ["animation-duration", resolved]);
	return null;
}

export function resolveDelay(full: string): UtilityResult | null {
	const resolved = resolveTimeValue(full.slice(6));
	if (resolved) return multi(["transition-delay", resolved], ["animation-delay", resolved]);
	return null;
}

export function resolveEase(full: string, theme: ResolvedTheme): UtilityResult | null {
	const val = full.slice(5);
	if (Object.hasOwn(theme.easing, val))
		return single("transition-timing-function", theme.easing[val]);
	if (val === "linear" || val === "initial") return single("transition-timing-function", val);
	const arb = extractArbitrary(val);
	if (arb !== null) return single("transition-timing-function", arb);
	return null;
}

export function resolveTransition(full: string): UtilityResult | null {
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
