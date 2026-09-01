/**
 * Test fixture scales — the breakpoint, weight, easing, blur, animation, and
 * fluid values that shipped as defaults before the package stopped shipping
 * any named scale.
 *
 * They live here (not in `src/`) because the machinery around them — the
 * responsive and container variants, variant ordering, the filter composition
 * chain, keyframe emission, fluid clamp interpolation — still needs realistic
 * values to exercise. Definitions are byte-for-byte the former defaults, so a
 * test that swaps a shipped lookup for a fixture one keeps every assertion
 * valid.
 */

import type { ResolvedTheme } from "../../src/directives/foundation.js";
import { resolveDirectives } from "../../src/directives/index.js";
import type { AnimationDefinition, FluidConfig } from "../../src/theme/index.js";

export const FIXTURE_BREAKPOINTS: Record<string, string> = {
	sm: "40rem",
	md: "48rem",
	lg: "64rem",
	xl: "80rem",
};

export const FIXTURE_WEIGHTS: Record<string, number> = {
	thin: 100,
	extralight: 200,
	light: 300,
	normal: 400,
	medium: 500,
	semibold: 600,
	bold: 700,
	extrabold: 800,
	black: 900,
};

export const FIXTURE_EASING: Record<string, string> = {
	in: "cubic-bezier(0.4, 0, 1, 1)",
	out: "cubic-bezier(0, 0, 0.2, 1)",
	"in-out": "cubic-bezier(0.4, 0, 0.2, 1)",
	linear: "linear",
};

export const FIXTURE_BLUR: Record<string, string> = {
	xs: "2px",
	sm: "4px",
	DEFAULT: "8px",
	md: "12px",
	lg: "16px",
	xl: "24px",
	"2xl": "40px",
	"3xl": "64px",
	none: "0",
};

export const FIXTURE_ANIMATIONS: Record<string, AnimationDefinition> = {
	spin: {
		shorthand: "spin 1s linear infinite",
		keyframes: `from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }`,
	},
	pulse: {
		shorthand: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
		keyframes: `0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }`,
	},
	bounce: {
		shorthand: "bounce 1s infinite",
		keyframes: `0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8, 0, 1, 1); }
  50% { transform: translateY(0); animation-timing-function: cubic-bezier(0, 0, 0.2, 1); }`,
	},
	ping: {
		shorthand: "ping 1s cubic-bezier(0, 0, 0.2, 1) infinite",
		keyframes: "75%, 100% { transform: scale(2); opacity: 0; }",
	},
};

export const FIXTURE_FLUID: FluidConfig = {
	min: "20rem",
	max: "80rem",
};

/**
 * A resolved theme carrying the fixture scales. Drop-in replacement for
 * `resolveDirectives([])` in tests that reference a former default token
 * (`sm:`, `font-bold`, `ease-in`, `blur-md`, `animate-spin`, `p-fluid-4`).
 * Pass `base` to layer the scales onto an already-resolved theme. A scale the
 * base defines wins, so a test's own directive override is never masked.
 */
export function scalesTheme(base: ResolvedTheme = resolveDirectives([])): ResolvedTheme {
	return {
		...base,
		breakpoints: { ...FIXTURE_BREAKPOINTS, ...base.breakpoints },
		weights: { ...FIXTURE_WEIGHTS, ...base.weights },
		easing: { ...FIXTURE_EASING, ...base.easing },
		blur: { ...FIXTURE_BLUR, ...base.blur },
		animations: { ...FIXTURE_ANIMATIONS, ...base.animations },
		fluid: { ...FIXTURE_FLUID, ...base.fluid },
	};
}

/** The same scales written as directive source, for tests that compile CSS
 *  rather than resolve a utility against a theme object. */
export const FIXTURE_SCALES_CSS = `@breakpoint { ${Object.entries(FIXTURE_BREAKPOINTS)
	.map(([k, v]) => `${k}: ${v};`)
	.join(" ")} }
@weight { ${Object.entries(FIXTURE_WEIGHTS)
	.map(([k, v]) => `${k}: ${v};`)
	.join(" ")} }
@ease { ${Object.entries(FIXTURE_EASING)
	.map(([k, v]) => `${k}: ${v};`)
	.join(" ")} }
@blur { ${Object.entries(FIXTURE_BLUR)
	.map(([k, v]) => `${k}: ${v};`)
	.join(" ")} }
@animate { ${Object.entries(FIXTURE_ANIMATIONS)
	.map(([k, v]) => `${k}: ${v.shorthand} { ${v.keyframes} }`)
	.join("\n")} }
@fluid { min: ${FIXTURE_FLUID.min}; max: ${FIXTURE_FLUID.max}; }`;
