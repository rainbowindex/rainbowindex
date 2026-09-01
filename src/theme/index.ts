/**
 * Default theme values — the static data that ships if the user writes no
 * directives. Only the colour palette and the spacing base ship a value; every
 * named scale starts empty and is filled by its directive.
 */
import { type ColorDefinition, DEFAULT_COLORS } from "./colors.js";

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

/** Viewport units, and the container-query units that track a container
 *  instead. Keep in step with `FLUID_UNITS` in directives/resolver.ts, which
 *  validates the `unit` a `@fluid` block asks for. */
export type FluidUnit = "vw" | "vi" | "vmin" | "vmax" | "cqw" | "cqi" | "cqmin" | "cqmax";

export interface FluidConfig {
	min?: string;
	max?: string;
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
// Composed Default Theme
// ---------------------------------------------------------------------------

// Frozen (shallow) so consumers cannot mutate the shared default theme that
// every compilation starts from.
export const defaultTheme: Theme = Object.freeze({
	spacing: {
		base: "0.25rem",
	},
	colors: DEFAULT_COLORS,
	// Every named scale below ships empty: the tokens come from @text,
	// @breakpoint, @shadow, @weight, @ease, @animate and @blur. @fluid carries
	// no viewport range until one is declared, so fluid utilities stay inert.
	text: {},
	breakpoints: {},
	shadows: {},
	weights: {},
	easing: {},
	fluid: {},
	animations: {},
	blur: {},
});
