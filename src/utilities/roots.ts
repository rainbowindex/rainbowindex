/**
 * The single registration table for built-in utility roots: each row binds a
 * set of roots to the generators that resolve them (in probe order) AND to the
 * value space editor enumeration tries for them. index.ts derives
 * PREFIX_DISPATCH from the resolver columns; enumerate.ts derives
 * UTILITY_VALUE_SPACES from the spec column — adding a root forces deciding
 * both in one row, so the two can never drift.
 *
 * Value spaces are deliberately GENEROUS (which theme namespaces and keyword
 * families to TRY per functional root): every enumeration candidate is probed
 * through the real utility resolver, which stays the single authority — a
 * spec can over-approximate freely and never emit something `validate()`
 * would reject. `{ kinds: [] }` marks a statics-only root.
 *
 * Ordering is load-bearing twice over: row order fixes PREFIX_DISPATCH key
 * insertion order (which drives cross-root enumeration dedup labels), and
 * per-root resolver order fixes which generator wins a contested root.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import type { UtilityResult } from "./helpers.js";
import { spacingGenerator } from "./spacing.js";
import { sizingGenerator } from "./sizing.js";
import { typographyGenerator } from "./typography.js";
import { colorGenerator } from "./color.js";
import { layoutGenerator } from "./layout.js";
import { borderGenerator } from "./borders.js";
import { effectsGenerator } from "./effects/index.js";
import { animationGenerator } from "./animations.js";
import { svgGenerator } from "./svg.js";

// `full` is the reassembled class name (`utility` when value is null, else
// `utility-value`), computed once by resolveUtility so generators doing
// static-table lookups never rebuild it per probe.
export type UtilityResolver = (
	utility: string,
	value: string | null,
	full: string,
	negative: boolean,
	theme: ResolvedTheme,
	warnings?: string[],
	dataType?: string | null,
) => UtilityResult | null;

export type ValueSpaceKind =
	| "color"
	| "special-color"
	| "spacing"
	| "fraction"
	| "text-size"
	| "fluid-text-size"
	| "font-slot"
	| "weight"
	| "rounded"
	| "rounded-side"
	| "shadow"
	| "z"
	| "ease"
	| "blur"
	| "animation"
	| "leading"
	| "fluid-range"
	| "tracking"
	| "opacity"
	| "duration"
	| "breakpoint"
	| "int"
	| "percent"
	| "keywords";

export interface ValueSpaceSpec {
	kinds: readonly ValueSpaceKind[];
	/** Extra value parts to try verbatim (for "keywords" and beyond). */
	keywords?: readonly string[];
}

/** One registration row: roots sharing both a resolver bucket and a value
 *  space. Roots appearing in several rows get their resolvers/kinds/keywords
 *  unioned by the respective builders, in row order. */
export interface RootGroup {
	roots: readonly string[];
	resolvers: readonly UtilityResolver[];
	spec: ValueSpaceSpec;
}

/** Common spacing-scale steps to enumerate concretely; the space itself is
 *  infinite (`${number}`, underscores for decimals) — see templates. */
export const SPACING_SAMPLES = Object.freeze([
	"0",
	"1",
	"1_5",
	"2",
	"2_5",
	"3",
	"4",
	"5",
	"6",
	"8",
	"10",
	"12",
	"16",
	"20",
	"24",
	"px",
]);

// Shared resolver buckets — sub-rows split from one dispatch family reuse one
// const so per-root probe order stays uniform across the family.
const SPACING = [spacingGenerator];
const SIZING = [sizingGenerator];
const TYPOGRAPHY_COLOR = [typographyGenerator, colorGenerator];
const COLOR_BORDER_EFFECTS_SVG = [colorGenerator, borderGenerator, effectsGenerator, svgGenerator];
const SVG = [svgGenerator];
const LAYOUT = [layoutGenerator];
const BORDER = [borderGenerator];
const COLOR_BORDER = [colorGenerator, borderGenerator];
const EFFECTS = [effectsGenerator];
const ANIMATION_EFFECTS = [animationGenerator, effectsGenerator];

// Shared value-space specs.
const STATICS_ONLY: ValueSpaceSpec = { kinds: [] };
const SHADOW_SPEC: ValueSpaceSpec = { kinds: ["shadow", "color", "special-color"] };
const RING_SPEC: ValueSpaceSpec = { kinds: ["int", "color", "special-color"] };
const ROTATE_SKEW_SPEC: ValueSpaceSpec = {
	kinds: ["keywords"],
	keywords: [
		"0",
		"1",
		"2",
		"3",
		"6",
		"12",
		"45",
		"90",
		"180",
		...["0", "3", "6", "12", "45", "90"].flatMap((v) => [`x-${v}`, `y-${v}`]),
	],
};

export const ROOT_GROUPS: readonly RootGroup[] = [
	// Spacing family — the scale is shared; sides/axes are distinct roots.
	{
		roots: [
			"p",
			"px",
			"py",
			"pt",
			"pb",
			"pl",
			"pr",
			"ps",
			"pe",
			"pbs",
			"pbe",
			"m",
			"mx",
			"my",
			"mt",
			"mb",
			"ml",
			"mr",
			"ms",
			"me",
			"mbs",
			"mbe",
			"gap",
			"gap-x",
			"gap-y",
			"space",
			"space-x",
			"space-y",
		],
		resolvers: SPACING,
		spec: { kinds: ["spacing"] },
	},
	{
		roots: [
			"inset",
			"inset-x",
			"inset-y",
			"inset-s",
			"inset-e",
			"inset-bs",
			"inset-be",
			"top",
			"bottom",
			"left",
			"right",
			"start",
			"end",
		],
		resolvers: SPACING,
		spec: { kinds: ["spacing", "fraction"], keywords: ["auto", "full"] },
	},
	{
		roots: [
			"scroll",
			"scroll-m",
			"scroll-mx",
			"scroll-my",
			"scroll-mt",
			"scroll-mb",
			"scroll-ml",
			"scroll-mr",
			"scroll-ms",
			"scroll-me",
			"scroll-p",
			"scroll-px",
			"scroll-py",
			"scroll-pt",
			"scroll-pb",
			"scroll-pl",
			"scroll-pr",
			"scroll-ps",
			"scroll-pe",
		],
		resolvers: SPACING,
		spec: { kinds: ["spacing"] },
	},
	// Fluid range scope classes — fluid-<name> from @fluid named ranges.
	{
		roots: ["fluid"],
		resolvers: SPACING,
		spec: { kinds: ["fluid-range"] },
	},
	// Sizing
	{
		roots: ["w", "h", "size", "min", "max", "min-w"],
		resolvers: SIZING,
		spec: { kinds: ["spacing", "fraction"] },
	},
	{
		roots: ["max-w"],
		resolvers: SIZING,
		spec: { kinds: ["spacing", "fraction", "breakpoint"] },
	},
	{
		roots: ["min-h", "max-h"],
		resolvers: SIZING,
		spec: { kinds: ["spacing", "fraction"] },
	},
	// Typography
	{
		roots: ["text"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: { kinds: ["text-size", "fluid-text-size", "color", "special-color"] },
	},
	{
		roots: ["font"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: { kinds: ["font-slot", "weight"] },
	},
	{
		roots: ["leading"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: { kinds: ["leading", "int"] },
	},
	{
		roots: ["tracking"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: { kinds: ["tracking"] },
	},
	{
		roots: ["decoration"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: {
			kinds: ["color", "special-color", "int", "keywords"],
			keywords: ["auto", "from-font", "solid", "double", "dotted", "dashed", "wavy"],
		},
	},
	{
		roots: ["whitespace", "italic", "truncate", "uppercase", "lowercase", "capitalize", "normal"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: STATICS_ONLY,
	},
	{
		roots: ["break"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: {
			kinds: ["keywords"],
			keywords: ["normal", "words", "all", "keep", "after-avoid", "before-avoid", "inside-avoid"],
		},
	},
	{
		roots: ["antialiased", "subpixel", "align", "list", "content"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: STATICS_ONLY,
	},
	{
		roots: ["indent"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: { kinds: ["spacing"] },
	},
	{
		roots: ["tab"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: { kinds: ["int"] },
	},
	{
		roots: ["line"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: {
			kinds: ["keywords"],
			keywords: ["clamp-none", "clamp-1", "clamp-2", "clamp-3", "clamp-4", "clamp-5", "clamp-6"],
		},
	},
	{
		roots: [
			"hyphens",
			"wrap",
			"ordinal",
			"slashed",
			"lining",
			"oldstyle",
			"proportional",
			"tabular",
			"diagonal",
			"stacked",
		],
		resolvers: TYPOGRAPHY_COLOR,
		spec: STATICS_ONLY,
	},
	{
		roots: ["underline"],
		resolvers: TYPOGRAPHY_COLOR,
		spec: {
			kinds: ["keywords"],
			keywords: ["offset-auto", "offset-0", "offset-1", "offset-2", "offset-4", "offset-8"],
		},
	},
	// Color-bearing families
	{
		roots: ["bg"],
		resolvers: COLOR_BORDER_EFFECTS_SVG,
		spec: { kinds: ["color", "special-color"] },
	},
	{
		roots: ["bg-linear"],
		resolvers: COLOR_BORDER_EFFECTS_SVG,
		spec: {
			kinds: ["keywords"],
			keywords: ["to-t", "to-b", "to-l", "to-r", "to-tl", "to-tr", "to-bl", "to-br"],
		},
	},
	{
		roots: ["bg-conic", "bg-radial"],
		resolvers: COLOR_BORDER_EFFECTS_SVG,
		spec: { kinds: ["int"] },
	},
	{
		roots: ["border"],
		resolvers: COLOR_BORDER_EFFECTS_SVG,
		spec: { kinds: ["color", "special-color", "int"] },
	},
	{
		roots: ["accent", "caret", "fill"],
		resolvers: COLOR_BORDER_EFFECTS_SVG,
		spec: { kinds: ["color", "special-color"] },
	},
	{
		roots: ["stroke"],
		resolvers: COLOR_BORDER_EFFECTS_SVG,
		spec: { kinds: ["color", "special-color", "int"] },
	},
	{
		roots: ["from", "via", "to"],
		resolvers: COLOR_BORDER_EFFECTS_SVG,
		spec: { kinds: ["color", "special-color"] },
	},
	{
		roots: ["divide"],
		resolvers: COLOR_BORDER_EFFECTS_SVG,
		spec: { kinds: ["color", "special-color", "int"] },
	},
	// SVG
	{
		roots: ["stroke-cap"],
		resolvers: SVG,
		spec: { kinds: ["keywords"], keywords: ["butt", "round", "square"] },
	},
	{
		roots: ["stroke-join"],
		resolvers: SVG,
		spec: { kinds: ["keywords"], keywords: ["miter", "round", "bevel"] },
	},
	{
		roots: ["stroke-dash", "stroke-offset", "stroke-miter"],
		resolvers: SVG,
		spec: { kinds: ["int"] },
	},
	{
		roots: ["stroke-opacity"],
		resolvers: SVG,
		spec: { kinds: ["opacity", "percent"] },
	},
	{
		roots: ["paint", "vector"],
		resolvers: SVG,
		spec: STATICS_ONLY,
	},
	// Layout — overwhelmingly statics; functional exceptions get their own rows.
	// block/inline's dynamic value space rides the trailing sizing row below.
	{
		roots: ["block", "inline"],
		resolvers: LAYOUT,
		spec: STATICS_ONLY,
	},
	{
		roots: ["flex"],
		resolvers: LAYOUT,
		spec: { kinds: ["int", "keywords"], keywords: ["auto", "initial", "none"] },
	},
	{
		roots: ["grid"],
		resolvers: LAYOUT,
		spec: {
			kinds: ["keywords"],
			keywords: [
				...Array.from({ length: 12 }, (_, i) => `cols-${i + 1}`),
				...Array.from({ length: 6 }, (_, i) => `rows-${i + 1}`),
				"cols-none",
				"rows-none",
				"cols-subgrid",
				"rows-subgrid",
			],
		},
	},
	{
		roots: [
			"contents",
			"hidden",
			"table",
			"flow",
			"static",
			"relative",
			"absolute",
			"fixed",
			"sticky",
		],
		resolvers: LAYOUT,
		spec: STATICS_ONLY,
	},
	{
		roots: ["grow", "shrink"],
		resolvers: LAYOUT,
		spec: { kinds: ["int"] },
	},
	{
		roots: [
			"items",
			"justify",
			"content",
			"self",
			"overflow",
			"overscroll",
			"visible",
			"invisible",
			"collapse",
			"isolate",
			"float",
			"clear",
		],
		resolvers: LAYOUT,
		spec: STATICS_ONLY,
	},
	{
		roots: ["aspect"],
		resolvers: LAYOUT,
		spec: { kinds: ["keywords"], keywords: ["auto", "square", "video"] },
	},
	{
		roots: [
			"object",
			"cursor",
			"pointer",
			"select",
			"touch",
			"resize",
			"scrollbar",
			"snap",
			"place",
		],
		resolvers: LAYOUT,
		spec: STATICS_ONLY,
	},
	{
		roots: ["auto"],
		resolvers: LAYOUT,
		spec: {
			kinds: ["keywords"],
			keywords: [
				"cols-auto",
				"cols-min",
				"cols-max",
				"cols-fr",
				"rows-auto",
				"rows-min",
				"rows-max",
				"rows-fr",
			],
		},
	},
	{
		roots: ["order"],
		resolvers: LAYOUT,
		spec: { kinds: ["int"], keywords: ["first", "last", "none"] },
	},
	{
		roots: ["col", "row"],
		resolvers: LAYOUT,
		spec: {
			kinds: ["keywords"],
			keywords: [
				"auto",
				"span-full",
				...Array.from({ length: 12 }, (_, i) => `span-${i + 1}`),
				...Array.from({ length: 13 }, (_, i) => `start-${i + 1}`),
				...Array.from({ length: 13 }, (_, i) => `end-${i + 1}`),
			],
		},
	},
	{
		roots: ["columns"],
		resolvers: LAYOUT,
		spec: { kinds: ["breakpoint", "int"] },
	},
	{
		roots: ["sr"],
		resolvers: LAYOUT,
		spec: STATICS_ONLY,
	},
	{
		roots: ["z"],
		resolvers: LAYOUT,
		spec: { kinds: ["z", "int"] },
	},
	{
		roots: ["box", "caption", "field"],
		resolvers: LAYOUT,
		spec: STATICS_ONLY,
	},
	{
		roots: ["basis"],
		resolvers: LAYOUT,
		spec: { kinds: ["spacing", "fraction", "breakpoint"] },
	},
	// caret/accent color values are registered on the color-bearing row above.
	{
		roots: ["caret", "accent"],
		resolvers: LAYOUT,
		spec: STATICS_ONLY,
	},
	{
		roots: ["forced", "scheme", "backface"],
		resolvers: LAYOUT,
		spec: STATICS_ONLY,
	},
	{
		roots: ["contain"],
		resolvers: LAYOUT,
		spec: {
			kinds: ["keywords"],
			keywords: ["none", "strict", "content", "size", "inline-size", "layout", "style", "paint"],
		},
	},
	{
		roots: ["@container", "@anchor", "@anchor-to", "position-area", "anchor-scope"],
		resolvers: LAYOUT,
		spec: STATICS_ONLY,
	},
	// inline-/block- also drive logical sizing (inline-size/block-size). Placed
	// after the layout group so display (bare `inline`, `inline-block`, `block`)
	// resolves first; sizing only claims size-shaped values.
	{
		roots: ["inline", "block"],
		resolvers: SIZING,
		spec: { kinds: ["spacing", "fraction"] },
	},
	// Borders
	{
		roots: ["rounded"],
		resolvers: BORDER,
		spec: { kinds: ["rounded", "rounded-side"] },
	},
	{
		roots: ["corner"],
		resolvers: BORDER,
		spec: {
			kinds: ["keywords"],
			keywords: ["round", "scoop", "bevel", "notch", "square", "squircle"],
		},
	},
	{
		roots: ["outline"],
		resolvers: COLOR_BORDER,
		spec: {
			kinds: ["color", "special-color", "int", "keywords"],
			keywords: ["offset-0", "offset-1", "offset-2", "offset-4", "offset-8"],
		},
	},
	// break-* (break-after/before/inside) and border-spacing-* are owned by the
	// layout generator; break/border already belong to other rows above, so
	// these rows append layout to those buckets in today's effective probe order.
	{
		roots: ["break"],
		resolvers: LAYOUT,
		spec: STATICS_ONLY,
	},
	{
		roots: ["border"],
		resolvers: LAYOUT,
		spec: STATICS_ONLY,
	},
	// Effects
	{
		roots: ["shadow", "text-shadow"],
		resolvers: EFFECTS,
		spec: SHADOW_SPEC,
	},
	{
		roots: ["ring"],
		resolvers: EFFECTS,
		spec: RING_SPEC,
	},
	{
		roots: ["inset-shadow"],
		resolvers: EFFECTS,
		spec: SHADOW_SPEC,
	},
	{
		roots: ["inset-ring"],
		resolvers: EFFECTS,
		spec: RING_SPEC,
	},
	{
		roots: ["opacity"],
		resolvers: EFFECTS,
		spec: { kinds: ["opacity", "percent"] },
	},
	{
		roots: ["transition"],
		resolvers: EFFECTS,
		spec: {
			kinds: ["keywords"],
			keywords: ["all", "colors", "opacity", "shadow", "transform", "none"],
		},
	},
	{
		roots: ["duration", "delay"],
		resolvers: EFFECTS,
		spec: { kinds: ["duration", "int"] },
	},
	{
		roots: ["ease"],
		resolvers: EFFECTS,
		// `linear` is the CSS keyword; the named curves come from @ease.
		spec: { kinds: ["ease", "keywords"], keywords: ["linear"] },
	},
	{
		roots: ["transform"],
		resolvers: EFFECTS,
		spec: STATICS_ONLY,
	},
	{
		roots: ["mix"],
		resolvers: EFFECTS,
		spec: {
			kinds: ["keywords"],
			keywords: [
				"blend-normal",
				"blend-multiply",
				"blend-screen",
				"blend-overlay",
				"blend-darken",
				"blend-lighten",
				"blend-color-dodge",
				"blend-color-burn",
				"blend-hard-light",
				"blend-soft-light",
				"blend-difference",
				"blend-exclusion",
				"blend-hue",
				"blend-saturation",
				"blend-color",
				"blend-luminosity",
			],
		},
	},
	{
		roots: ["filter"],
		resolvers: EFFECTS,
		spec: STATICS_ONLY,
	},
	{
		roots: ["grayscale", "invert", "sepia"],
		resolvers: EFFECTS,
		spec: { kinds: ["percent"] },
	},
	// Statics-only registration for the remaining filter roots — their dynamic
	// value spaces (percentages, angles, drop-shadow tokens) are not enumerated.
	{
		roots: ["brightness", "contrast", "saturate", "hue", "drop"],
		resolvers: EFFECTS,
		spec: STATICS_ONLY,
	},
	{
		roots: ["mask"],
		resolvers: EFFECTS,
		spec: STATICS_ONLY,
	},
	{
		roots: ["backdrop"],
		resolvers: EFFECTS,
		spec: { kinds: ["keywords"], keywords: ["blur-none", "grayscale", "invert", "sepia"] },
	},
	{
		roots: ["translate"],
		resolvers: EFFECTS,
		spec: {
			kinds: ["keywords"],
			keywords: [
				...SPACING_SAMPLES.flatMap((s) => [`x-${s}`, `y-${s}`, `z-${s}`]),
				"x-full",
				"y-full",
				"x-1/2",
				"y-1/2",
			],
		},
	},
	{
		roots: ["rotate"],
		resolvers: EFFECTS,
		spec: ROTATE_SKEW_SPEC,
	},
	{
		roots: ["scale"],
		resolvers: EFFECTS,
		spec: {
			kinds: ["keywords"],
			keywords: [
				"0",
				"50",
				"75",
				"90",
				"95",
				"100",
				"105",
				"110",
				"125",
				"150",
				...["0", "50", "75", "90", "95", "100", "105", "110", "125", "150"].flatMap((v) => [
					`x-${v}`,
					`y-${v}`,
				]),
			],
		},
	},
	{
		roots: ["skew"],
		resolvers: EFFECTS,
		spec: ROTATE_SKEW_SPEC,
	},
	{
		roots: ["origin"],
		resolvers: EFFECTS,
		spec: STATICS_ONLY,
	},
	{
		roots: ["will"],
		resolvers: EFFECTS,
		spec: {
			kinds: ["keywords"],
			keywords: ["change-auto", "change-scroll", "change-contents", "change-transform"],
		},
	},
	{
		roots: ["perspective"],
		resolvers: EFFECTS,
		spec: { kinds: ["int"], keywords: ["none", "normal"] },
	},
	// Animation
	{
		roots: ["animate"],
		resolvers: ANIMATION_EFFECTS,
		spec: { kinds: ["animation", "keywords"], keywords: ["none", "in", "out"] },
	},
	{
		roots: ["fade", "zoom"],
		resolvers: ANIMATION_EFFECTS,
		spec: {
			kinds: ["keywords"],
			keywords: [
				"in",
				"out",
				"in-0",
				"in-50",
				"in-75",
				"in-95",
				"out-0",
				"out-50",
				"out-75",
				"out-95",
			],
		},
	},
	{
		roots: ["spin"],
		resolvers: ANIMATION_EFFECTS,
		spec: {
			kinds: ["keywords"],
			keywords: ["in", "out", "in-45", "in-90", "in-180", "out-45", "out-90", "out-180"],
		},
	},
	{
		roots: ["blur"],
		resolvers: ANIMATION_EFFECTS,
		spec: { kinds: ["blur"], keywords: ["none"] },
	},
	{
		roots: ["slide"],
		resolvers: ANIMATION_EFFECTS,
		spec: {
			kinds: ["keywords"],
			keywords: [
				"in-from-top",
				"in-from-bottom",
				"in-from-left",
				"in-from-right",
				"out-to-top",
				"out-to-bottom",
				"out-to-left",
				"out-to-right",
			],
		},
	},
];
