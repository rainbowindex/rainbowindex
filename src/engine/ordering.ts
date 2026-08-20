/**
 * Cascade ordering — deterministic sort keys for CSS output.
 *
 * sortKey = variantWeight * 1000 + propertyGroup
 *
 * Key invariant: shorthands appear before their longhands,
 * so `p-4 pt-8` resolves correctly in the cascade.
 */

import { devWarn, IS_DEV } from "../runtime.js";
import { codepointCompare } from "../shared.js";
import { FIXED_VARIANT_WEIGHTS } from "./variants.js";

// ---------------------------------------------------------------------------
// Property Groups
// ---------------------------------------------------------------------------

/**
 * Every CSS property maps to a numeric group. Shorthands have lower numbers
 * than their longhands within each family, ensuring correct cascade order.
 *
 * Physical CSS properties share group numbers with their logical equivalents,
 * so both `m-4 mt-8` and `m-4 mbs-8` resolve correctly.
 *
 * Null prototype: keys come from user input (arbitrary properties, variant
 * names), so a plain object would resolve names like "constructor" through
 * the prototype chain to a non-numeric "group" and corrupt the sort key.
 */
export const PROPERTY_GROUPS: Record<string, number> = Object.assign(Object.create(null), {
	// Container
	"container-type": 1,
	"container-name": 2,

	// Anchor positioning
	"anchor-name": 3,

	// Position
	position: 4,
	"z-index": 5,
	order: 6,
	"position-anchor": 7,
	"position-area": 8,
	"anchor-scope": 9,

	// Inset (shorthand → longhand ordering)
	inset: 10,
	"inset-inline": 11,
	"inset-block": 12,
	"inset-inline-start": 13,
	"inset-inline-end": 14,
	"inset-block-start": 15,
	"inset-block-end": 16,
	// Physical aliases
	top: 15,
	right: 14,
	bottom: 16,
	left: 13,

	// Visibility / Display
	visibility: 20,
	float: 21,
	clear: 22,
	display: 40,

	// Margin (shorthand → longhand)
	margin: 30,
	"margin-inline": 31,
	"margin-block": 32,
	"margin-inline-start": 33,
	"margin-inline-end": 34,
	"margin-block-start": 35,
	"margin-block-end": 36,
	// Physical aliases
	"margin-top": 35,
	"margin-right": 34,
	"margin-bottom": 36,
	"margin-left": 33,

	// Flex / Grid container
	"flex-direction": 41,
	"flex-wrap": 42,
	flex: 43,
	"flex-grow": 44,
	"flex-shrink": 45,
	"flex-basis": 46,
	"grid-template-columns": 47,
	"grid-template-rows": 48,
	"grid-auto-flow": 49,
	"grid-auto-columns": 49,
	"grid-auto-rows": 49,
	"grid-column": 49,
	"grid-column-start": 50,
	"grid-column-end": 50,
	"grid-row": 49,
	"grid-row-start": 50,
	"grid-row-end": 50,

	// Sizing
	width: 51,
	"min-width": 52,
	"max-width": 53,
	height: 54,
	"min-height": 55,
	"max-height": 56,
	// Logical sizing — share weights with their physical equivalents.
	"inline-size": 51,
	"min-inline-size": 52,
	"max-inline-size": 53,
	"block-size": 54,
	"min-block-size": 55,
	"max-block-size": 56,

	// Alignment
	"place-items": 59,
	"place-content": 59,
	"place-self": 59,
	"align-items": 60,
	"align-self": 61,
	"align-content": 62,
	"justify-content": 63,
	"justify-items": 64,
	"justify-self": 65,
	gap: 66,
	"column-gap": 67,
	"row-gap": 68,

	// Aspect ratio
	"aspect-ratio": 70,
	columns: 71,

	// Object
	"object-fit": 72,
	"object-position": 73,

	// Border radius (shorthand → longhand)
	"border-radius": 80,
	"border-start-start-radius": 81,
	"border-start-end-radius": 81,
	"border-end-start-radius": 81,
	"border-end-end-radius": 81,
	// Physical aliases
	"border-top-left-radius": 81,
	"border-top-right-radius": 81,
	"border-bottom-left-radius": 81,
	"border-bottom-right-radius": 81,

	// Border width (shorthand → longhand)
	"border-width": 83,
	"border-style": 84,
	"border-inline-width": 85,
	"border-block-width": 86,
	"border-inline-start-width": 87,
	"border-inline-end-width": 87,
	"border-block-start-width": 87,
	"border-block-end-width": 87,
	// Physical aliases
	"border-top-width": 87,
	"border-right-width": 87,
	"border-bottom-width": 87,
	"border-left-width": 87,

	// Border color
	"border-color": 89,
	"border-inline-color": 89,
	"border-block-color": 89,
	"border-inline-start-color": 90,
	"border-inline-end-color": 90,
	"border-block-start-color": 90,
	"border-block-end-color": 90,

	// Background / Gradients
	"background-image": 93,
	"--ri-gradient-position": 93,
	"--ri-gradient-from": 93,
	"--ri-gradient-to": 93,
	"--ri-gradient-stops": 93,
	"--ri-gradient-from-position": 93,
	"--ri-gradient-to-position": 93,
	// via-* must cascade after from-*/to-* so its 3-stop --ri-gradient-stops wins
	"--ri-gradient-via": 94,
	"--ri-gradient-via-position": 94,
	"background-position": 94,
	"background-size": 94,
	background: 95,
	"background-color": 96,
	"background-repeat": 97,
	"background-attachment": 97,
	"background-clip": 97,
	"background-origin": 97,
	"background-blend-mode": 98,

	// Padding (shorthand → longhand)
	padding: 100,
	"padding-inline": 101,
	"padding-block": 102,
	"padding-inline-start": 103,
	"padding-inline-end": 104,
	"padding-block-start": 105,
	"padding-block-end": 106,
	// Physical aliases
	"padding-top": 105,
	"padding-right": 104,
	"padding-bottom": 106,
	"padding-left": 103,

	// Typography
	"font-family": 110,
	"font-size": 111,
	"font-weight": 112,
	color: 113,
	"line-height": 114,
	"letter-spacing": 115,
	"text-align": 116,
	"text-indent": 116,
	"text-transform": 117,
	"text-wrap": 118,
	"white-space": 119,
	"text-decoration": 120,
	"text-decoration-line": 120,
	"text-decoration-color": 121,
	"text-decoration-style": 122,
	"text-decoration-thickness": 123,
	"text-overflow": 124,
	"vertical-align": 124,
	"font-style": 125,
	"font-feature-settings": 126,
	"font-variation-settings": 127,
	"-webkit-font-smoothing": 128,

	"list-style-type": 128,
	"list-style-position": 129,

	// Content
	content: 130,

	// Overflow
	overflow: 131,
	"overflow-x": 132,
	"overflow-y": 133,

	// Overscroll (shorthand before longhands, mirroring overflow)
	"overscroll-behavior": 134,
	"overscroll-behavior-x": 135,
	"overscroll-behavior-y": 136,

	// Effects — composable box-shadow slot vars + color vars share the box-shadow
	// group (read at use-time, so intra-rule order is for determinism only).
	opacity: 140,
	"box-shadow": 141,
	"--ri-shadow": 141,
	"--ri-inset-shadow": 141,
	"--ri-ring-shadow": 141,
	"--ri-inset-ring-shadow": 141,
	"--ri-ring-offset-shadow": 141,
	"--ri-shadow-color": 141,
	"--ri-inset-shadow-color": 141,
	"--ri-ring-color": 141,
	"--ri-inset-ring-color": 141,
	"text-shadow": 141,
	"--ri-text-shadow-color": 141,
	outline: 142,
	"outline-style": 142,
	"outline-width": 143,
	"outline-color": 144,
	"outline-offset": 145,

	// Filter
	filter: 150,
	"--ri-blur": 150,
	"--ri-brightness": 150,
	"--ri-contrast": 150,
	"--ri-saturate": 150,
	"--ri-grayscale": 150,
	"--ri-invert": 150,
	"--ri-sepia": 150,
	"--ri-hue-rotate": 150,
	"--ri-drop-shadow": 150,
	"--ri-drop-shadow-color": 150,
	"backdrop-filter": 151,
	"--ri-backdrop-blur": 151,
	"--ri-backdrop-brightness": 151,
	"--ri-backdrop-contrast": 151,
	"--ri-backdrop-saturate": 151,
	"--ri-backdrop-grayscale": 151,
	"--ri-backdrop-invert": 151,
	"--ri-backdrop-sepia": 151,
	"--ri-backdrop-opacity": 151,
	"--ri-backdrop-hue-rotate": 151,

	// Mask — composable stop vars (154) cascade before the image (155); the
	// standalone longhands (156) follow. Vars share a group like --ri-gradient-*.
	"--ri-mask-linear-from": 154,
	"--ri-mask-linear-to": 154,
	"--ri-mask-linear-from-position": 154,
	"--ri-mask-linear-to-position": 154,
	"--ri-mask-linear-position": 154,
	"--ri-mask-top-from": 154,
	"--ri-mask-top-to": 154,
	"--ri-mask-top-from-position": 154,
	"--ri-mask-top-to-position": 154,
	"--ri-mask-right-from": 154,
	"--ri-mask-right-to": 154,
	"--ri-mask-right-from-position": 154,
	"--ri-mask-right-to-position": 154,
	"--ri-mask-bottom-from": 154,
	"--ri-mask-bottom-to": 154,
	"--ri-mask-bottom-from-position": 154,
	"--ri-mask-bottom-to-position": 154,
	"--ri-mask-left-from": 154,
	"--ri-mask-left-to": 154,
	"--ri-mask-left-from-position": 154,
	"--ri-mask-left-to-position": 154,
	"--ri-mask-radial-from": 154,
	"--ri-mask-radial-to": 154,
	"--ri-mask-radial-from-position": 154,
	"--ri-mask-radial-to-position": 154,
	"--ri-mask-radial-shape": 154,
	"--ri-mask-radial-size": 154,
	"--ri-mask-radial-position": 154,
	"--ri-mask-conic-from": 154,
	"--ri-mask-conic-to": 154,
	"--ri-mask-conic-from-position": 154,
	"--ri-mask-conic-to-position": 154,
	"--ri-mask-conic-position": 154,
	"mask-image": 155,
	"mask-clip": 156,
	"mask-composite": 156,
	"mask-mode": 156,
	"mask-origin": 156,
	"mask-position": 156,
	"mask-repeat": 156,
	"mask-size": 156,
	"mask-type": 156,

	// Transforms
	transform: 160,
	"--ri-rotate-x": 160,
	"--ri-rotate-y": 160,
	"--ri-rotate-z": 160,
	"--ri-skew-x": 160,
	"--ri-skew-y": 160,
	translate: 161,
	"--ri-translate-x": 161,
	"--ri-translate-y": 161,
	"--ri-translate-z": 161,
	rotate: 162,
	scale: 163,
	"--ri-scale-x": 163,
	"--ri-scale-y": 163,
	"--ri-scale-z": 163,
	zoom: 164,

	// Transition / Animation
	transition: 170,
	"transition-property": 171,
	"transition-duration": 172,
	"transition-timing-function": 173,
	"transition-delay": 174,
	"transition-behavior": 175,
	animation: 180,
	"animation-name": 181,
	"animation-duration": 182,
	"animation-timing-function": 183,
	"animation-delay": 184,
	"animation-iteration-count": 185,
	"animation-fill-mode": 186,
	"animation-direction": 186,
	"animation-play-state": 187,
	"--ri-enter-opacity": 180,
	"--ri-exit-opacity": 180,
	"--ri-enter-scale": 180,
	"--ri-exit-scale": 180,
	"--ri-enter-rotate": 180,
	"--ri-exit-rotate": 180,
	"--ri-enter-translate-x": 180,
	"--ri-enter-translate-y": 180,
	"--ri-exit-translate-x": 180,
	"--ri-exit-translate-y": 180,
	"--ri-enter-blur": 180,
	"--ri-exit-blur": 180,

	// Interactivity
	cursor: 190,
	"user-select": 191,
	"pointer-events": 192,
	resize: 193,
	"touch-action": 194,
	appearance: 195,
	"accent-color": 196,
	"caret-color": 197,
	fill: 198,
	stroke: 199,
	"stroke-width": 199,
	"stroke-dasharray": 199,
	"stroke-dashoffset": 199,
	"stroke-linecap": 199,
	"stroke-linejoin": 199,
	"stroke-miterlimit": 199,
	"stroke-opacity": 199,
	"paint-order": 199,
	"vector-effect": 199,

	// Scroll margin/padding
	"scroll-margin": 200,
	"scroll-margin-inline": 201,
	"scroll-margin-block": 202,
	"scroll-margin-inline-start": 203,
	"scroll-margin-inline-end": 203,
	"scroll-margin-block-start": 203,
	"scroll-margin-block-end": 203,
	"scroll-padding": 204,
	"scroll-padding-inline": 205,
	"scroll-padding-block": 206,
	"scroll-padding-inline-start": 207,
	"scroll-padding-inline-end": 207,
	"scroll-padding-block-start": 207,
	"scroll-padding-block-end": 207,

	// Break
	"break-before": 210,
	"break-after": 211,
	"break-inside": 212,

	// Misc
	"overflow-wrap": 220,
	"word-break": 221,
	"will-change": 225,
	"scroll-behavior": 226,
	"border-collapse": 227,
	"--ri-border-spacing-x": 228,
	"--ri-border-spacing-y": 228,
	"border-spacing": 228,
	isolation: 228,
	"mix-blend-mode": 229,
	"corner-shape": 230,
	"color-scheme": 231,
	"interpolate-size": 232,
	"scrollbar-width": 233,
	"--ri-scrollbar-thumb": 233,
	"--ri-scrollbar-track": 233,
	"scrollbar-color": 233,
	"scrollbar-gutter": 234,
});
Object.freeze(PROPERTY_GROUPS);

// ---------------------------------------------------------------------------
// Variant Weights
// ---------------------------------------------------------------------------

/**
 * Variant weight tiers — collision-free hierarchical encoding.
 *
 * Each variant belongs to a tier (cascade priority band). Tiers use
 * non-overlapping weight ranges so that multi-variant combinations
 * never collide with single-variant weights:
 *
 *   Tier 0: dark mode (0)           — base offset 0
 *   Tier 1: responsive (1-4)        — base offset 100
 *   Tier 2: container queries (6-9) — base offset 200
 *   Tier 3: media queries (10-14)   — base offset 300
 *   Tier 4: state pseudo (20-25)    — base offset 400
 *   Tier 5: form states (50-56)     — base offset 500
 *   Tier 6: structural (60-67)      — base offset 600
 *   Tier 7: entry transitions (70)  — base offset 700
 *   Tier 8: pseudo-elements (90-95) — base offset 800
 *   Custom/unknown variants:          base offset 900
 *
 * Multi-variant weights are computed by summing per-tier maxima.
 * Within a tier, the highest-weighted variant wins (max, not sum).
 * Between tiers, contributions are additive. This guarantees:
 *   - sm:hover = 100 + 400 = 500 (tier 1 + tier 4)
 *   - focus    = 401             (tier 4 only)
 *   - No collision possible between different tier combinations.
 *
 * Fixed-variant weights are defined next to their selectors in
 * engine/variants.ts (FIXED_VARIANT_WEIGHTS) so name and weight can never
 * drift; only the theme-default breakpoint statics (mirrored by
 * buildBreakpointWeights below) and the group-/peer- relational composites
 * live here.
 *
 * Null prototype for the same reason as PROPERTY_GROUPS: variant names are
 * user input, and a prototype-chain hit would yield a non-numeric weight.
 */
export const VARIANT_WEIGHTS: Record<string, number> = Object.assign(
	Object.create(null),
	FIXED_VARIANT_WEIGHTS,
	{
		// Tier 1: Responsive (base 100) — theme-default breakpoint statics
		sm: 101,
		md: 102,
		lg: 103,
		xl: 104,

		// Tier 2: Container query variants (base 200)
		"@sm": 206,
		"@md": 207,
		"@lg": 208,
		"@xl": 209,

		// Tier 4: State pseudo-classes (base 400) — group-*/peer-* relational
		// composites: a deliberately weighted 5-name subset of the open family.
		// All other group-{pseudo}/peer-{pseudo} forms intentionally fall to the
		// custom tier (900).
		"group-hover": 426,
		"group-focus": 427,
		"group-active": 428,
		"group-focus-visible": 429,
		"group-focus-within": 430,
		"peer-hover": 431,
		"peer-focus": 432,
		"peer-active": 433,
		"peer-focus-visible": 434,
		"peer-focus-within": 435,
	},
);
Object.freeze(VARIANT_WEIGHTS);

/**
 * Extract the tier (base offset ÷ 100) from a variant weight.
 * Weights encode tier as the hundreds digit: tier = floor(weight / 100).
 */
function variantTier(weight: number): number {
	return Math.floor(weight / 100);
}

// ---------------------------------------------------------------------------
// Theme-derived breakpoint weights
// ---------------------------------------------------------------------------

// First weights mirror the static VARIANT_WEIGHTS entries (sm=101, @sm=206) so
// the derived map reproduces today's numbering for the default theme exactly.
const RESPONSIVE_FIRST_WEIGHT = 101;
const RESPONSIVE_MAX_WEIGHT = 199;
const CONTAINER_FIRST_WEIGHT = 206;
const CONTAINER_MAX_WEIGHT = 299;

const BREAKPOINT_LENGTH_RE = /^(\d+(?:\.\d+)?)(px|em|rem)$/;

/** Parse a breakpoint value to px for ordering (em/rem at 16px). Null = unparseable. */
function parseBreakpointPx(value: string): number | null {
	const m = BREAKPOINT_LENGTH_RE.exec(value.trim());
	if (!m) return null;
	const n = Number(m[1]);
	return m[2] === "px" ? n : n * 16;
}

/**
 * Build the per-theme variant weight map for breakpoints, so user-added
 * breakpoints (2xl, 3xl, …) sort within the responsive/container tiers by
 * min-width instead of falling to the unknown-variant weight 900.
 *
 * Breakpoints are ordered by parsed min-width (unparseable values last, by
 * codepoint), then assigned `name` → responsive-tier and `@name` →
 * container-tier weights, capped within each tier.
 */
export function buildBreakpointWeights(
	breakpoints: Readonly<Record<string, string>>,
): ReadonlyMap<string, number> {
	const entries = Object.keys(breakpoints).map((name) => ({
		name,
		px: parseBreakpointPx(breakpoints[name]),
	}));
	entries.sort((a, b) => {
		if (a.px !== null && b.px !== null && a.px !== b.px) return a.px - b.px;
		if (a.px === null && b.px !== null) return 1;
		if (a.px !== null && b.px === null) return -1;
		return codepointCompare(a.name, b.name);
	});
	const map = new Map<string, number>();
	for (let i = 0; i < entries.length; i++) {
		map.set(entries[i].name, Math.min(RESPONSIVE_FIRST_WEIGHT + i, RESPONSIVE_MAX_WEIGHT));
		map.set(`@${entries[i].name}`, Math.min(CONTAINER_FIRST_WEIGHT + i, CONTAINER_MAX_WEIGHT));
	}
	return map;
}

// ---------------------------------------------------------------------------
// Sort Key Computation
// ---------------------------------------------------------------------------

/** Default property group for unknown CSS properties. Placed above all defined
 *  groups (max ~232) so unknown properties sort after known utility properties
 *  but before the variant multiplier boundary. */
const DEFAULT_PROPERTY_GROUP = 500;

/**
 * Multiplier that separates variant weight from property group in the sort key.
 * Property groups must stay below this value to avoid cross-variant collisions.
 * Currently max property group is ~232, giving substantial headroom.
 *
 * sortKey = variantWeight * VARIANT_MULTIPLIER + propertyGroup
 */
const VARIANT_MULTIPLIER = 1000;

/**
 * Compute the sort key for a CSS rule.
 *
 * @param cssProperty - The primary CSS property being set
 * @param variants - Array of variant names applied to this utility
 * @param breakpointWeights - Per-theme map from buildBreakpointWeights()
 * @returns Numeric sort key for deterministic ordering
 */
export function computeSortKey(
	cssProperty: string,
	variants: string[] = [],
	breakpointWeights?: ReadonlyMap<string, number>,
): number {
	const propertyGroup = PROPERTY_GROUPS[cssProperty] ?? DEFAULT_PROPERTY_GROUP;
	if (IS_DEV && propertyGroup >= VARIANT_MULTIPLIER) {
		devWarn(
			`[RI-DEBUG] Property group ${propertyGroup} for "${cssProperty}" exceeds ${VARIANT_MULTIPLIER - 1} — sort key collisions will occur across variant boundaries.`,
		);
	}
	const variantWeight = computeVariantWeight(variants, breakpointWeights);
	// With tier-based variant weights, max variant weight ≈ 3940 (all tiers active),
	// giving max sort key ≈ 3,940,500 — well within safe integer range.
	return variantWeight * VARIANT_MULTIPLIER + propertyGroup;
}

/** Resolve one variant's weight — theme-derived breakpoint weights win over the
 *  static table so custom breakpoints land in the responsive/container tiers. */
function lookupVariantWeight(v: string, breakpointWeights?: ReadonlyMap<string, number>): number {
	// Named container variants: @sidebar/sm → use @sm weight
	if (v.includes("/")) {
		const after = v.split("/")[1];
		if (!after) return 900;
		return (
			breakpointWeights?.get(`@${after}`) ??
			VARIANT_WEIGHTS[`@${after}`] ??
			breakpointWeights?.get(after) ??
			VARIANT_WEIGHTS[after] ??
			900
		);
	}
	return breakpointWeights?.get(v) ?? VARIANT_WEIGHTS[v] ?? 900;
}

/**
 * Compute the combined weight for a stack of variants.
 *
 * Uses per-tier max aggregation: within each tier (responsive, state, etc.)
 * the highest-weight variant wins; across tiers the contributions are summed.
 * This prevents collisions like `sm:hover` (tier1+tier4) vs `focus` (tier4).
 */
export function computeVariantWeight(
	variants: string[],
	breakpointWeights?: ReadonlyMap<string, number>,
): number {
	if (variants.length === 0) return 0;
	// Fast path: single variant (most common case) — skip Map allocation
	if (variants.length === 1) {
		return lookupVariantWeight(variants[0], breakpointWeights);
	}
	// Track the max weight contributed by each tier using a fixed-size array
	// (tiers 0-9) to avoid Map allocation and reduce GC pressure.
	const tierMax = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
	for (const v of variants) {
		const w = lookupVariantWeight(v, breakpointWeights);
		const tier = variantTier(w);
		if (w > tierMax[tier]) tierMax[tier] = w;
	}
	// Sum across tiers — each tier contributes at most one weight
	let total = 0;
	for (let t = 0; t < 10; t++) {
		total += tierMax[t];
	}
	return total;
}
