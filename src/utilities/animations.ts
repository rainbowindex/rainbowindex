/**
 * Animation utilities — compositional enter/exit animations,
 * simple loops (spin, pulse, bounce, ping), timing control.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import {
	type UtilityResult,
	single,
	fullName,
	extractArbitrary,
	INTEGER_RE,
	DECIMAL_RE,
	deepFreezeUtilityMap,
	spacingLookup,
} from "./index.js";

// ---------------------------------------------------------------------------
// Static utilities
// ---------------------------------------------------------------------------

const STATIC_ANIM: Readonly<Record<string, UtilityResult>> = {
	// Built-in simple animations
	"animate-spin": single("animation", "var(--animate-spin)"),
	"animate-pulse": single("animation", "var(--animate-pulse)"),
	"animate-bounce": single("animation", "var(--animate-bounce)"),
	"animate-ping": single("animation", "var(--animate-ping)"),
	"animate-none": single("animation", "none"),

	// Enter/exit triggers
	"animate-in": single(
		"animation",
		"enter var(--ri-anim-duration, 150ms) var(--ri-anim-easing, ease) var(--ri-anim-fill, both)",
	),
	"animate-out": single(
		"animation",
		"exit var(--ri-anim-duration, 150ms) var(--ri-anim-easing, ease) var(--ri-anim-fill, both)",
	),

	// Iteration
	"animate-infinite": single("animation-iteration-count", "infinite"),
	"animate-once": single("animation-iteration-count", "1"),
	"animate-twice": single("animation-iteration-count", "2"),

	// Fill mode
	"animate-fill-none": single("animation-fill-mode", "none"),
	"animate-fill-forwards": single("animation-fill-mode", "forwards"),
	"animate-fill-backwards": single("animation-fill-mode", "backwards"),
	"animate-fill-both": single("animation-fill-mode", "both"),

	// Direction
	"animate-normal": single("animation-direction", "normal"),
	"animate-reverse": single("animation-direction", "reverse"),
	"animate-alternate": single("animation-direction", "alternate"),
	"animate-alternate-reverse": single("animation-direction", "alternate-reverse"),

	// Play state
	"animate-running": single("animation-play-state", "running"),
	"animate-paused": single("animation-play-state", "paused"),

	// Compositional enter effects — set CSS variables
	"fade-in": single("--ri-enter-opacity", "0"),
	"fade-out": single("--ri-exit-opacity", "0"),
	"zoom-in": single("--ri-enter-scale", "0"),
	"zoom-out": single("--ri-exit-scale", "0"),
	"blur-in": single("--ri-enter-blur", "20px"),
	"blur-out": single("--ri-exit-blur", "20px"),
};
deepFreezeUtilityMap(STATIC_ANIM);
// Key list export for editor enumeration — the map itself stays private.
export const ANIMATION_STATIC_NAMES: readonly string[] = Object.freeze(Object.keys(STATIC_ANIM));

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function animationGenerator(
	utility: string,
	value: string | null,
	negative: boolean,
	theme: ResolvedTheme,
): UtilityResult | null {
	const full = fullName(utility, value);

	// Static spin — sign-sensitive, so resolve ahead of the STATIC_ANIM table
	// (which has no notion of the negative prefix). `-spin-in` reverses to -30deg.
	if (full === "spin-in") return single("--ri-enter-rotate", negative ? "-30deg" : "30deg");
	if (full === "spin-out") return single("--ri-exit-rotate", negative ? "-30deg" : "30deg");

	// Static utilities
	if (Object.hasOwn(STATIC_ANIM, full)) return STATIC_ANIM[full];

	// fade-in-{n}, fade-out-{n}: opacity percentage
	if (full.startsWith("fade-in-")) {
		const n = full.slice(8);
		if (INTEGER_RE.test(n)) return single("--ri-enter-opacity", String(Number(n) / 100));
	}
	if (full.startsWith("fade-out-")) {
		const n = full.slice(9);
		if (INTEGER_RE.test(n)) return single("--ri-exit-opacity", String(Number(n) / 100));
	}

	// zoom-in-{n}, zoom-out-{n}: scale percentage (negative prefix mirrors)
	if (full.startsWith("zoom-in-")) {
		const n = full.slice(8);
		if (INTEGER_RE.test(n)) {
			const scale = Number(n) / 100;
			return single("--ri-enter-scale", String(negative ? -scale : scale));
		}
	}
	if (full.startsWith("zoom-out-")) {
		const n = full.slice(9);
		if (INTEGER_RE.test(n)) {
			const scale = Number(n) / 100;
			return single("--ri-exit-scale", String(negative ? -scale : scale));
		}
	}

	// spin-in-{n}, spin-out-{n}: rotation degrees (negative prefix reverses)
	if (full.startsWith("spin-in-")) {
		const n = full.slice(8);
		if (INTEGER_RE.test(n)) return single("--ri-enter-rotate", `${negative ? "-" : ""}${n}deg`);
	}
	if (full.startsWith("spin-out-")) {
		const n = full.slice(9);
		if (INTEGER_RE.test(n)) return single("--ri-exit-rotate", `${negative ? "-" : ""}${n}deg`);
	}

	// blur-in-{n}, blur-out-{n}: blur amount
	if (full.startsWith("blur-in-")) {
		const n = full.slice(8);
		if (INTEGER_RE.test(n)) return single("--ri-enter-blur", `${n}px`);
	}
	if (full.startsWith("blur-out-")) {
		const n = full.slice(9);
		if (INTEGER_RE.test(n)) return single("--ri-exit-blur", `${n}px`);
	}

	// slide-in-from-{dir}-{n}
	if (full.startsWith("slide-in-from-")) {
		return resolveSlide(full.slice(14), "enter");
	}

	// slide-out-to-{dir}-{n}
	if (full.startsWith("slide-out-to-")) {
		return resolveSlide(full.slice(13), "exit");
	}

	// animate-duration-{n}: animation-duration
	if (full.startsWith("animate-duration-")) {
		const n = full.slice(17);
		if (INTEGER_RE.test(n)) return single("animation-duration", `${n}ms`);
		const arbDur = extractArbitrary(n);
		if (arbDur !== null) return single("animation-duration", arbDur);
	}

	// animate-delay-{n}: animation-delay
	if (full.startsWith("animate-delay-")) {
		const n = full.slice(14);
		if (INTEGER_RE.test(n)) return single("animation-delay", `${n}ms`);
		const arbDelay = extractArbitrary(n);
		if (arbDelay !== null) return single("animation-delay", arbDelay);
	}

	// animate-ease-{fn}: animation-timing-function
	if (full.startsWith("animate-ease-")) {
		const name = full.slice(13);
		if (Object.hasOwn(theme.easing, name)) {
			return single("animation-timing-function", theme.easing[name]);
		}
	}

	// Custom animations from @animate directive, or arbitrary shorthand
	if (full.startsWith("animate-")) {
		const name = full.slice(8);
		if (Object.hasOwn(theme.animations, name)) {
			return single("animation", `var(--animate-${name})`);
		}
		const arb = extractArbitrary(name);
		if (arb !== null) return single("animation", arb);
	}

	return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLIDE_DIRS: Readonly<Record<string, readonly [string, number]>> = Object.freeze({
	top: ["translate-y", -1],
	bottom: ["translate-y", 1],
	left: ["translate-x", -1],
	right: ["translate-x", 1],
});
const SLIDE_DIRS_ENTRIES = Object.entries(SLIDE_DIRS);

function resolveSlide(rest: string, mode: "enter" | "exit"): UtilityResult | null {
	const prefix = mode === "enter" ? "--ri-enter" : "--ri-exit";

	for (const [dirName, [axis, sign]] of SLIDE_DIRS_ENTRIES) {
		if (rest === dirName || rest.startsWith(`${dirName}-`)) {
			const amount = rest === dirName ? "full" : rest.slice(dirName.length + 1);
			let val: string;
			// DECIMAL_RE-gated so `px` keeps falling through to the arbitrary
			// branch — spacingLookup owns the calc(n * var(--spacing)) grammar.
			const sp = DECIMAL_RE.test(amount) ? spacingLookup(amount, sign < 0) : null;
			if (amount === "full") {
				val = `${sign * 100}%`;
			} else if (sp !== null) {
				val = sp;
			} else {
				const arb = extractArbitrary(amount);
				if (arb === null) return null;
				val = sign < 0 ? `calc(${arb} * -1)` : arb;
			}
			return single(`${prefix}-${axis}`, val);
		}
	}

	return null;
}
