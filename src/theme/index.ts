/**
 * Default theme values — the static data that ships if the user writes no directives.
 * `directives.ts` (Phase 5) parses user overrides and merges them with these defaults.
 */
import { DEFAULT_COLORS, type ColorDefinition } from "./colors.js";
export {
	type ColorDarkOverride,
	type ColorDefinition,
	DEFAULT_COLORS,
	isValidColorSuffix,
	lightnessFromSuffix,
} from "./colors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextSize {
	fontSize: string;
	lineHeight: string;
}

export type FluidUnit = "vw" | "vi" | "vmin" | "vmax";

export interface FluidConfig {
	min: string;
	max: string;
	unit?: FluidUnit;
	multiplier?: number;
}

export interface AnimationDefinition {
	shorthand: string;
	keyframes: string;
}

export interface Theme {
	spacing: {
		base: string;
	};
	colors: Record<string, ColorDefinition>;
	text: Record<string, TextSize>;
	breakpoints: Record<string, string>;
	shadows: Record<string, string>;
	weights: Record<string, number>;
	easing: Record<string, string>;
	fluid: FluidConfig;
	animations: Record<string, AnimationDefinition>;
	blur: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Default Typography Scale
// ---------------------------------------------------------------------------

export const DEFAULT_TEXT: Record<string, TextSize> = {
	"2xs": { fontSize: "0.625rem", lineHeight: "1.2" },
	xs: { fontSize: "0.75rem", lineHeight: "1.3" },
	sm: { fontSize: "0.875rem", lineHeight: "1.4" },
	md: { fontSize: "1rem", lineHeight: "1.5" },
	lg: { fontSize: "1.25rem", lineHeight: "1.4" },
	xl: { fontSize: "1.5rem", lineHeight: "1.3" },
	"2xl": { fontSize: "1.875rem", lineHeight: "1.2" },
	"3xl": { fontSize: "2.25rem", lineHeight: "1.15" },
	"4xl": { fontSize: "2.813rem", lineHeight: "1.1" },
	"5xl": { fontSize: "3.5rem", lineHeight: "1.05" },
	"6xl": { fontSize: "4.375rem", lineHeight: "1.05" },
	"7xl": { fontSize: "5.5rem", lineHeight: "1" },
	"8xl": { fontSize: "6.875rem", lineHeight: "1" },
	"9xl": { fontSize: "8.5rem", lineHeight: "1" },
};

// ---------------------------------------------------------------------------
// Default Breakpoints
// ---------------------------------------------------------------------------

export const DEFAULT_BREAKPOINTS: Record<string, string> = {
	sm: "40rem",
	md: "48rem",
	lg: "64rem",
	xl: "80rem",
};

// ---------------------------------------------------------------------------
// Corner Shape
// ---------------------------------------------------------------------------

/**
 * Keyword corner-shape values. `superellipse(N)` is represented separately
 * as `{ superellipse: N }` since the numeric parameter isn't a keyword.
 * Single source for the type, the scale table below, and the @rounded
 * modifier parser (directives/parsers.ts).
 */
export const CORNER_SHAPE_KEYWORDS = [
	"round",
	"scoop",
	"bevel",
	"notch",
	"square",
	"squircle",
] as const;

export type CornerShapeKeyword = (typeof CORNER_SHAPE_KEYWORDS)[number];

export type CornerShape = CornerShapeKeyword | { superellipse: number };

/**
 * Per-shape multiplier applied to `border-radius` inside
 * `@supports (corner-shape: <shape>)`, so that in browsers that render the
 * shape, radii are bumped to match the visual weight a plain round corner
 * would have at the raw radius in non-supporting browsers. (A squircle at
 * equal radius reads smaller/tighter than a round corner — the multiplier
 * compensates.)
 *
 * Defaults: `round`, `square`, `notch` stay at 1 (no compensation — either
 * the default already, or already reads as heavy as an equivalent round).
 * `bevel` uses 0.8 (sharp corners look heavier, so radius shrinks),
 * `scoop` uses 1.2, `squircle` and `superellipse(N)` use 1.6.
 */
export const DEFAULT_CORNER_SCALE: Readonly<Record<CornerShapeKeyword, number>> = {
	round: 1,
	square: 1,
	notch: 1,
	bevel: 0.8,
	scoop: 1.2,
	squircle: 1.6,
};

/** Default scale for `superellipse(N)` — users override via `--corner-scale`. */
export const DEFAULT_SUPERELLIPSE_SCALE = 1.6;

// ---------------------------------------------------------------------------
// Default Shadows
// ---------------------------------------------------------------------------

/**
 * Layered shadow system. Two tiers share this map:
 *
 *   • **Class-facing**: `px`, `2xs`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `none`.
 *     Reachable as `shadow-{name}` utilities — these are the values users compose
 *     with. Each is a layered composition that builds a depth-aware, light-dark
 *     adaptive shadow.
 *
 *   • **Building blocks**: `line`, `drop`, `hi-1..hi-4`, `dark-line`, `ring`,
 *     `layer-1..layer-7`. Referenced by the class-facing values via `var()` chains.
 *     Technically callable as classes (e.g. `shadow-layer-3`), but most are
 *     intended as internal composition primitives — the color-typed ones
 *     (`line`, `drop`, `hi-*`, `dark-line`) emit invalid `box-shadow` when used
 *     directly. Customize via `@shadow line: …;` etc.
 *
 * The assembler in `assembly.ts` walks the `var(--shadow-*)` graph so that
 * referencing a class-facing token transitively pulls in every building block
 * it depends on. Pruning still drops the tokens that nothing references.
 */
export const DEFAULT_SHADOWS: Record<string, string> = {
	// Building blocks: colors
	line: "light-dark(oklch(0 0 0 / 0.06), oklch(1 0 0 / 0.02))",
	drop: "light-dark(oklch(0 0 0 / 0.06), oklch(0 0 0 / 0.18))",
	"hi-1": "light-dark(transparent, oklch(1 0 0 / 0.01))",
	"hi-2": "light-dark(transparent, oklch(1 0 0 / 0.02))",
	"hi-3": "light-dark(transparent, oklch(1 0 0 / 0.04))",
	"hi-4": "light-dark(transparent, oklch(1 0 0 / 0.06))",
	"dark-line": "light-dark(transparent, oklch(0 0 0 / 0.14))",

	// Building blocks: composed shadow layers
	ring: "0 0 0 1px var(--shadow-line)",
	"layer-1": "0 1px 1px -0.5px var(--shadow-drop)",
	"layer-2": "0 3px 3px -1.5px var(--shadow-drop)",
	"layer-3": "0 6px 6px -3px var(--shadow-drop)",
	"layer-4": "0 12px 12px -6px var(--shadow-drop)",
	"layer-5": "0 24px 24px -12px var(--shadow-drop)",
	"layer-6": "0 48px 48px -24px var(--shadow-drop)",
	"layer-7": "0 96px 96px -48px var(--shadow-drop)",

	// Class-facing
	px: "var(--shadow-ring)",
	"2xs": "inset 0 1px 0 0 var(--shadow-hi-1), var(--shadow-ring), var(--shadow-layer-1)",
	xs: "inset 0 1px 0 0 var(--shadow-hi-2), var(--shadow-ring), 0 0 0 1px var(--shadow-dark-line), var(--shadow-layer-1), var(--shadow-layer-2)",
	sm: "inset 0 1px 0 0 var(--shadow-hi-2), var(--shadow-ring), 0 0 0 1px var(--shadow-dark-line), var(--shadow-layer-1), var(--shadow-layer-2), var(--shadow-layer-3)",
	md: "inset 0 1px 0 0 var(--shadow-hi-3), var(--shadow-ring), 0 0 0 1px var(--shadow-dark-line), var(--shadow-layer-1), var(--shadow-layer-2), var(--shadow-layer-3), var(--shadow-layer-4)",
	lg: "inset 0 1px 0 0 var(--shadow-hi-3), var(--shadow-ring), 0 0 0 1px var(--shadow-dark-line), var(--shadow-layer-1), var(--shadow-layer-2), var(--shadow-layer-3), var(--shadow-layer-4), var(--shadow-layer-5)",
	xl: "inset 0 1px 0 0 var(--shadow-hi-4), var(--shadow-ring), 0 0 0 1px var(--shadow-dark-line), var(--shadow-layer-1), var(--shadow-layer-2), var(--shadow-layer-3), var(--shadow-layer-4), var(--shadow-layer-5), var(--shadow-layer-6)",
	"2xl":
		"inset 0 1px 0 0 var(--shadow-hi-4), var(--shadow-ring), 0 0 0 1px var(--shadow-dark-line), var(--shadow-layer-1), var(--shadow-layer-2), var(--shadow-layer-3), var(--shadow-layer-4), var(--shadow-layer-5), var(--shadow-layer-6), var(--shadow-layer-7)",
	none: "0 0 #0000",
};

// ---------------------------------------------------------------------------
// Default Font Weights
// ---------------------------------------------------------------------------

export const DEFAULT_WEIGHTS: Record<string, number> = {
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

// ---------------------------------------------------------------------------
// Default Easing Functions
// ---------------------------------------------------------------------------

export const DEFAULT_EASING: Record<string, string> = {
	in: "cubic-bezier(0.4, 0, 1, 1)",
	out: "cubic-bezier(0, 0, 0.2, 1)",
	"in-out": "cubic-bezier(0.4, 0, 0.2, 1)",
	linear: "linear",
};

// ---------------------------------------------------------------------------
// Default Blur Values
// ---------------------------------------------------------------------------

export const DEFAULT_BLUR: Record<string, string> = {
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

// ---------------------------------------------------------------------------
// Default Animations
// ---------------------------------------------------------------------------

export const DEFAULT_ANIMATIONS: Record<string, AnimationDefinition> = {
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
	// Disclosure animations for the @rainbowindex/ui Accordion + Collapsible
	// primitives. Both expand from 0 → the natural content size published by
	// the package's `useCollapseSize` hook as `--ri-collapsible-content-height`
	// (a single shared variable — the primitives do not emit separate accordion
	// vs collapsible vars). The `auto` fallback keeps the keyframe valid on the
	// first frame before the hook measures.
	"accordion-down": {
		shorthand: "accordion-down 0.2s ease-out",
		keyframes: `from { height: 0; }
  to { height: var(--ri-collapsible-content-height, auto); }`,
	},
	"accordion-up": {
		shorthand: "accordion-up 0.2s ease-out",
		keyframes: `from { height: var(--ri-collapsible-content-height, auto); }
  to { height: 0; }`,
	},
	"collapsible-down": {
		shorthand: "collapsible-down 0.2s ease-out",
		keyframes: `from { height: 0; }
  to { height: var(--ri-collapsible-content-height, auto); }`,
	},
	"collapsible-up": {
		shorthand: "collapsible-up 0.2s ease-out",
		keyframes: `from { height: var(--ri-collapsible-content-height, auto); }
  to { height: 0; }`,
	},
	"caret-blink": {
		shorthand: "caret-blink 1.25s ease-out infinite",
		keyframes: `0%, 70%, 100% { opacity: 1; }
  20%, 50% { opacity: 0; }`,
	},
};

// ---------------------------------------------------------------------------
// Default Fluid Config
// ---------------------------------------------------------------------------

export const DEFAULT_FLUID: FluidConfig = {
	min: "20rem",
	max: "80rem",
};

// ---------------------------------------------------------------------------
// Tracking (Letter Spacing)
// ---------------------------------------------------------------------------

export const DEFAULT_TRACKING: Record<string, string> = {
	tighter: "-0.05em",
	tight: "-0.025em",
	normal: "0em",
	wide: "0.025em",
	wider: "0.05em",
	widest: "0.1em",
};

// ---------------------------------------------------------------------------
// Leading (Line Height)
// ---------------------------------------------------------------------------

export const DEFAULT_LEADING: Record<string, string> = {
	"3": "0.75rem",
	"4": "1rem",
	"5": "1.25rem",
	"6": "1.5rem",
	"7": "1.75rem",
	"8": "2rem",
	"9": "2.25rem",
	"10": "2.5rem",
	none: "1",
	tight: "1.25",
	snug: "1.375",
	normal: "1.5",
	relaxed: "1.625",
	loose: "2",
};

// ---------------------------------------------------------------------------
// Composed Default Theme
// ---------------------------------------------------------------------------

// Frozen (shallow) so consumers cannot mutate the shared default theme that
// every compilation starts from.
export const defaultTheme: Theme = Object.freeze({
	spacing: {
		base: "0.25rem",
	},
	colors: DEFAULT_COLORS,
	text: DEFAULT_TEXT,
	breakpoints: DEFAULT_BREAKPOINTS,
	shadows: DEFAULT_SHADOWS,
	weights: DEFAULT_WEIGHTS,
	easing: DEFAULT_EASING,
	fluid: DEFAULT_FLUID,
	animations: DEFAULT_ANIMATIONS,
	blur: DEFAULT_BLUR,
});
