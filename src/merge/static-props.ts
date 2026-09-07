/**
 * `ri()` conflict claims for static utilities — the full-class-name table.
 *
 * Split from prefix-props.ts because the two answer different questions:
 * this one is keyed by a whole class name (`flex`, `sr-only`), that one by a
 * prefix a value follows (`p-`, `text-`). Pure frozen data, no side effects.
 */

import {
	BACKDROP_FILTER_SLOTS,
	BORDER_DIR_PROPS,
	FILTER_SLOTS,
} from "../utilities/property-maps.js";

/**
 * Static utility → CSS properties (full class name match).
 * Only includes utilities where two classes could plausibly conflict.
 *
 * Parity with STATIC_UTILITIES in utilities/metadata.ts is enforced by
 * assertStaticUtilityParity() in __tests__/helpers/merge-parity.ts,
 * exercised from __tests__/core/utility-contracts.test.ts and
 * __tests__/merge/merge.test.ts. New entries here propagate automatically
 * via BUILTIN_STATIC_KEYS — no manual sync required.
 *
 * Null prototype: the resolve path indexes these tables with user-derived
 * names, so a single bare lookup must miss for keys like "constructor"
 * instead of resolving through Object.prototype.
 */
const BUILTIN_STATIC_PROPS: Record<string, readonly string[]> = Object.assign(Object.create(null), {
	// Grow/shrink
	grow: ["flex-grow"],
	"grow-0": ["flex-grow"],
	shrink: ["flex-shrink"],
	"shrink-0": ["flex-shrink"],

	// Space-between reverse (scoped so it composes with space-x/space-y)
	"space-x-reverse": ["~space:--ri-space-x-reverse"],
	"space-y-reverse": ["~space:--ri-space-y-reverse"],

	// Text overflow
	"text-clip": ["text-overflow"],
	"text-ellipsis": ["text-overflow"],

	// Font variant numeric
	"normal-nums": ["font-variant-numeric"],
	ordinal: ["--ri-ordinal", "font-variant-numeric"],
	"slashed-zero": ["--ri-slashed-zero", "font-variant-numeric"],
	"lining-nums": ["--ri-numeric-figure", "font-variant-numeric"],
	"oldstyle-nums": ["--ri-numeric-figure", "font-variant-numeric"],
	"proportional-nums": ["--ri-numeric-spacing", "font-variant-numeric"],
	"tabular-nums": ["--ri-numeric-spacing", "font-variant-numeric"],
	"diagonal-fractions": ["--ri-numeric-fraction", "font-variant-numeric"],
	"stacked-fractions": ["--ri-numeric-fraction", "font-variant-numeric"],

	// Font style
	italic: ["font-style"],
	"not-italic": ["font-style"],

	// Font smoothing
	antialiased: ["-webkit-font-smoothing", "-moz-osx-font-smoothing"],
	"subpixel-antialiased": ["-webkit-font-smoothing", "-moz-osx-font-smoothing"],

	// List style position
	"list-inside": ["list-style-position"],
	"list-outside": ["list-style-position"],

	// Decoration thickness keywords
	"decoration-auto": ["text-decoration-thickness"],
	"decoration-from-font": ["text-decoration-thickness"],

	// Isolation
	isolate: ["isolation"],
	"isolation-auto": ["isolation"],

	// Truncate (sets multiple)
	truncate: ["overflow", "text-overflow", "white-space"],

	// Pointer events
	"pointer-events-none": ["pointer-events"],
	"pointer-events-auto": ["pointer-events"],

	// Transition property/behavior one-offs
	"transition-none": ["transition-property"],
	"transition-normal": ["transition-behavior"],
	"transition-discrete": ["transition-behavior"],

	// Transform style
	"transform-flat": ["transform-style"],
	"transform-3d": ["transform-style"],

	// Translate/rotate/scale none
	"translate-none": ["translate"],
	// `translate-3d` only opts into the Z axis; it claims the same property, so
	// a later `translate-none` still wins and two of them dedupe.
	"translate-3d": ["translate"],
	"rotate-none": ["rotate"],
	"scale-none": ["scale"],

	// Perspective
	"perspective-none": ["perspective"],

	// Border width (static, directional — per-side logical props; the bare
	// static forms claim the same properties as the dynamic prefix entries)
	...BORDER_DIR_PROPS,

	// Border collapse
	"border-collapse": ["border-collapse"],
	"border-separate": ["border-collapse"],

	// Outline — bare `outline` is a 1px width (like `border`); outline-hidden sets the
	// outline shorthand + offset (claiming all sub-properties); outline-none just sets style.
	outline: ["outline-width"],
	"outline-hidden": ["outline-style", "outline-width", "outline-color", "outline-offset"],

	// Shadow / ring (static reset + bare ring forms; valued forms via PREFIX_PROPS).
	// Each composable family claims box-shadow (shared) + its own slot var, so
	// shadow/inset-shadow/ring/inset-ring coexist while same-family repeats dedupe.
	// Bare `shadow` is not static: with no default shadow scale it only resolves
	// when the theme defines a `DEFAULT` (or `md`) token via @shadow.
	"shadow-none": ["box-shadow", "--ri-shadow"],
	ring: ["box-shadow", "--ri-ring-shadow"],
	"inset-ring": ["box-shadow", "--ri-inset-ring-shadow"],
	"inset-shadow-none": ["box-shadow", "--ri-inset-shadow"],

	// Box sizing
	"box-border": ["box-sizing"],
	"box-content": ["box-sizing"],

	// Box decoration
	"box-decoration-clone": ["-webkit-box-decoration-break", "box-decoration-break"],
	"box-decoration-slice": ["-webkit-box-decoration-break", "box-decoration-break"],

	// Table layout
	"table-auto": ["table-layout"],
	"table-fixed": ["table-layout"],

	// Caption side
	"caption-top": ["caption-side"],
	"caption-bottom": ["caption-side"],

	// Field sizing
	"field-sizing-content": ["field-sizing"],
	"field-sizing-fixed": ["field-sizing"],

	// Flex basis
	"basis-auto": ["flex-basis"],
	"basis-full": ["flex-basis"],

	// Background reset
	"bg-none": ["background-image"],

	// Divide-between reverse flags (scoped so they compose with divide-x/divide-y)
	"divide-x-reverse": ["~divide:--ri-divide-x-reverse"],
	"divide-y-reverse": ["~divide:--ri-divide-y-reverse"],

	// Backdrop filter (static). `backdrop-blur-none` clears the blur slot and
	// nothing else, so it claims what every other backdrop-blur spelling claims
	// — that is what lets it dedupe against `backdrop-blur-lg` while leaving a
	// `backdrop-invert` beside it alone.
	"backdrop-blur-none": ["--ri-backdrop-blur", "backdrop-filter"],
	// Bare `backdrop-filter` enables the chain without contributing to it, so it
	// claims the shorthand alone and composes with every function to its left.
	"backdrop-filter": ["backdrop-filter"],
	"backdrop-grayscale": ["--ri-backdrop-grayscale", "backdrop-filter"],
	"backdrop-invert": ["--ri-backdrop-invert", "backdrop-filter"],
	"backdrop-sepia": ["--ri-backdrop-sepia", "backdrop-filter"],

	// Filter (static) — filter-none resets all filters
	"filter-none": ["filter", ...FILTER_SLOTS],
	"backdrop-filter-none": ["backdrop-filter", ...BACKDROP_FILTER_SLOTS],
	// Bare `filter`, as above: enables, does not reset.
	filter: ["filter"],
	grayscale: ["--ri-grayscale", "filter"],
	invert: ["--ri-invert", "filter"],
	sepia: ["--ri-sepia", "filter"],

	// Animation play state
	"animate-running": ["animation-play-state"],
	"animate-paused": ["animation-play-state"],

	// Compositional animation effects (static)
	"fade-in": ["--ri-enter-opacity"],
	"fade-out": ["--ri-exit-opacity"],
	"zoom-in": ["--ri-enter-scale"],
	"zoom-out": ["--ri-exit-scale"],
	"spin-in": ["--ri-enter-rotate"],
	"spin-out": ["--ri-exit-rotate"],
	"blur-in": ["--ri-enter-blur"],
	"blur-out": ["--ri-exit-blur"],

	// Mask reset
	"mask-none": ["mask-image"],
	// Mask type
	"mask-type-alpha": ["mask-type"],
	"mask-type-luminance": ["mask-type"],
	// Mask radial shape
	"mask-circle": ["--ri-mask-radial-shape"],
	"mask-ellipse": ["--ri-mask-radial-shape"],

	// Container
	"@container": ["container-type"],
	"@container-normal": ["container-type"],

	// Anchor scope
	"anchor-scope-all": ["anchor-scope"],
	"anchor-scope-none": ["anchor-scope"],

	// SR only (sets position, width, height, padding, margin, overflow, clip, white-space, border-width)
	"sr-only": [
		"position",
		"width",
		"height",
		"padding",
		"margin",
		"overflow",
		"clip-path",
		"white-space",
		"border-width",
	],
	"not-sr-only": [
		"position",
		"width",
		"height",
		"padding",
		"margin",
		"overflow",
		"clip-path",
		"white-space",
		"border-width",
	],

	// Content
	"content-none": ["content"],

	// Accent color
	"accent-auto": ["accent-color"],

	// Caret color keywords
	"caret-transparent": ["caret-color"],
	"caret-current": ["caret-color"],
	"caret-inherit": ["caret-color"],

	// Forced color adjust
	"forced-color-adjust-auto": ["forced-color-adjust"],
	"forced-color-adjust-none": ["forced-color-adjust"],

	// Backface visibility
	"backface-hidden": ["backface-visibility"],
	"backface-visible": ["backface-visibility"],

	// Scroll snap strictness / stop
	"snap-mandatory": ["--ri-snap-strictness"],
	"snap-proximity": ["--ri-snap-strictness"],
	"snap-normal": ["scroll-snap-stop"],
	"snap-always": ["scroll-snap-stop"],

	// Appearance
	"appearance-none": ["appearance"],
	"appearance-auto": ["appearance"],

	// Word break exception — break-words wraps instead of breaking
	"break-words": ["overflow-wrap"],

	// Scroll behavior
	"scroll-auto": ["scroll-behavior"],
	"scroll-smooth": ["scroll-behavior"],

	// SVG
	"fill-none": ["fill"],
	"stroke-none": ["stroke"],
});

/**
 * Register a family of static utilities sharing one frozen props array.
 * Every full utility name stays a literal, greppable string while families
 * (36× cursor, 22× position-area, …) dedupe to a single array instance.
 */
function addAll(names: readonly string[], props: string[]): void {
	const frozen = Object.freeze(props);
	for (const name of names) BUILTIN_STATIC_PROPS[name] = frozen;
}

// Display
addAll(
	[
		"block",
		"inline-block",
		"inline",
		"flex",
		"inline-flex",
		"grid",
		"inline-grid",
		"contents",
		"hidden",
		"table",
		"table-row",
		"table-cell",
		"inline-table",
		"table-caption",
		"table-column",
		"table-column-group",
		"table-footer-group",
		"table-header-group",
		"table-row-group",
		"flow-root",
		"list-item",
	],
	["display"],
);
// Float / Clear
addAll(["float-right", "float-left", "float-start", "float-end", "float-none"], ["float"]);
addAll(
	["clear", "clear-left", "clear-right", "clear-both", "clear-start", "clear-end", "clear-none"],
	["clear"],
);
// Position
addAll(["static", "relative", "absolute", "fixed", "sticky"], ["position"]);
// Flex direction / wrap / sizing (flex-1 and other flex-<number> resolve via the `flex` prefix)
addAll(["flex-row", "flex-row-reverse", "flex-col", "flex-col-reverse"], ["flex-direction"]);
addAll(["flex-wrap", "flex-wrap-reverse", "flex-nowrap"], ["flex-wrap"]);
addAll(["flex-auto", "flex-initial", "flex-none"], ["flex"]);
// Grid flow
addAll(
	[
		"grid-flow-row",
		"grid-flow-col",
		"grid-flow-dense",
		"grid-flow-row-dense",
		"grid-flow-col-dense",
	],
	["grid-auto-flow"],
);
// Alignment
addAll(
	[
		"items-start",
		"items-end",
		"items-end-safe",
		"items-center",
		"items-center-safe",
		"items-baseline",
		"items-baseline-last",
		"items-stretch",
	],
	["align-items"],
);
addAll(
	[
		"justify-normal",
		"justify-start",
		"justify-end",
		"justify-end-safe",
		"justify-center",
		"justify-center-safe",
		"justify-between",
		"justify-around",
		"justify-evenly",
		"justify-stretch",
		"justify-baseline",
	],
	["justify-content"],
);
addAll(
	[
		"self-auto",
		"self-start",
		"self-end",
		"self-end-safe",
		"self-center",
		"self-center-safe",
		"self-stretch",
		"self-baseline",
		"self-baseline-last",
	],
	["align-self"],
);
addAll(
	[
		"justify-items-normal",
		"justify-items-start",
		"justify-items-end",
		"justify-items-end-safe",
		"justify-items-center",
		"justify-items-center-safe",
		"justify-items-stretch",
	],
	["justify-items"],
);
addAll(
	[
		"justify-self-auto",
		"justify-self-start",
		"justify-self-end",
		"justify-self-end-safe",
		"justify-self-center",
		"justify-self-center-safe",
		"justify-self-stretch",
	],
	["justify-self"],
);
addAll(
	[
		"content-normal",
		"content-start",
		"content-end",
		"content-end-safe",
		"content-center",
		"content-center-safe",
		"content-between",
		"content-around",
		"content-evenly",
		"content-baseline",
		"content-stretch",
	],
	["align-content"],
);
addAll(
	[
		"place-content-normal",
		"place-content-start",
		"place-content-end",
		"place-content-end-safe",
		"place-content-center",
		"place-content-center-safe",
		"place-content-between",
		"place-content-around",
		"place-content-evenly",
		"place-content-baseline",
		"place-content-stretch",
	],
	["place-content"],
);
addAll(
	[
		"place-items-start",
		"place-items-end",
		"place-items-end-safe",
		"place-items-center",
		"place-items-center-safe",
		"place-items-baseline",
		"place-items-stretch",
	],
	["place-items"],
);
addAll(
	[
		"place-self-auto",
		"place-self-start",
		"place-self-end",
		"place-self-end-safe",
		"place-self-center",
		"place-self-center-safe",
		"place-self-stretch",
	],
	["place-self"],
);
// Text alignment / wrapping
addAll(
	["text-left", "text-center", "text-right", "text-justify", "text-start", "text-end"],
	["text-align"],
);
addAll(["text-wrap", "text-nowrap", "text-balance", "text-pretty"], ["text-wrap"]);
// Hyphens / overflow wrap
addAll(["hyphens-none", "hyphens-manual", "hyphens-auto"], ["hyphens"]);
addAll(["wrap-normal", "wrap-break-word", "wrap-anywhere"], ["overflow-wrap"]);
// Text transform
addAll(["uppercase", "lowercase", "capitalize", "normal-case"], ["text-transform"]);
// Vertical alignment
addAll(
	[
		"align-baseline",
		"align-top",
		"align-middle",
		"align-bottom",
		"align-text-top",
		"align-text-bottom",
		"align-sub",
		"align-super",
	],
	["vertical-align"],
);
// List style type
addAll(["list-none", "list-disc", "list-decimal"], ["list-style-type"]);
// Decoration line / style
addAll(["underline", "overline", "line-through", "no-underline"], ["text-decoration-line"]);
addAll(
	[
		"decoration-solid",
		"decoration-dashed",
		"decoration-dotted",
		"decoration-double",
		"decoration-wavy",
	],
	["text-decoration-style"],
);
// Whitespace
addAll(
	[
		"whitespace-normal",
		"whitespace-nowrap",
		"whitespace-pre",
		"whitespace-pre-line",
		"whitespace-pre-wrap",
		"whitespace-break-spaces",
	],
	["white-space"],
);
// Overflow
addAll(
	["overflow-auto", "overflow-hidden", "overflow-clip", "overflow-visible", "overflow-scroll"],
	["overflow"],
);
addAll(
	[
		"overflow-x-auto",
		"overflow-x-hidden",
		"overflow-x-clip",
		"overflow-x-visible",
		"overflow-x-scroll",
	],
	["overflow-x"],
);
addAll(
	[
		"overflow-y-auto",
		"overflow-y-hidden",
		"overflow-y-clip",
		"overflow-y-visible",
		"overflow-y-scroll",
	],
	["overflow-y"],
);
// Overscroll behavior
addAll(["overscroll-auto", "overscroll-contain", "overscroll-none"], ["overscroll-behavior"]);
addAll(
	["overscroll-x-auto", "overscroll-x-contain", "overscroll-x-none"],
	["overscroll-behavior-x"],
);
addAll(
	["overscroll-y-auto", "overscroll-y-contain", "overscroll-y-none"],
	["overscroll-behavior-y"],
);
// Visibility
addAll(["visible", "invisible", "collapse"], ["visibility"]);
// Cursor
addAll(
	[
		"cursor-auto",
		"cursor-default",
		"cursor-pointer",
		"cursor-wait",
		"cursor-text",
		"cursor-move",
		"cursor-not-allowed",
		"cursor-none",
		"cursor-grab",
		"cursor-grabbing",
		"cursor-crosshair",
		"cursor-help",
		"cursor-context-menu",
		"cursor-cell",
		"cursor-vertical-text",
		"cursor-alias",
		"cursor-copy",
		"cursor-no-drop",
		"cursor-progress",
		"cursor-all-scroll",
		"cursor-col-resize",
		"cursor-row-resize",
		"cursor-n-resize",
		"cursor-e-resize",
		"cursor-s-resize",
		"cursor-w-resize",
		"cursor-ne-resize",
		"cursor-nw-resize",
		"cursor-se-resize",
		"cursor-sw-resize",
		"cursor-ew-resize",
		"cursor-ns-resize",
		"cursor-nesw-resize",
		"cursor-nwse-resize",
		"cursor-zoom-in",
		"cursor-zoom-out",
	],
	["cursor"],
);
// Select
addAll(["select-none", "select-text", "select-all", "select-auto"], ["user-select"]);
// Transitions (these utilities set property + timing-function + duration)
addAll(
	[
		"transition",
		"transition-all",
		"transition-colors",
		"transition-opacity",
		"transition-shadow",
		"transition-transform",
	],
	["transition-property", "transition-timing-function", "transition-duration"],
);
// Transform
addAll(["transform-none", "transform-gpu", "transform-cpu"], ["transform"]);
addAll(
	["transform-content", "transform-border", "transform-fill", "transform-stroke", "transform-view"],
	["transform-box"],
);
// Transform origin
addAll(
	[
		"origin-center",
		"origin-top",
		"origin-top-right",
		"origin-right",
		"origin-bottom-right",
		"origin-bottom",
		"origin-bottom-left",
		"origin-left",
		"origin-top-left",
	],
	["transform-origin"],
);
// Border width (static)
addAll(["border", "border-0", "border-2", "border-4", "border-8"], ["border-width"]);
// Border style
addAll(
	[
		"border-solid",
		"border-dashed",
		"border-dotted",
		"border-double",
		"border-hidden",
		"border-none",
	],
	["border-style"],
);
// Rounded (static)
addAll(["rounded-none", "rounded-full"], ["border-radius"]);
// Corner shape (static) — each utility also resets --ri-rounded-scale,
// so conflict resolution must claim both properties.
addAll(
	[
		"corner-round",
		"corner-scoop",
		"corner-bevel",
		"corner-notch",
		"corner-square",
		"corner-squircle",
	],
	["corner-shape", "--ri-rounded-scale"],
);
// Outline style keywords
addAll(
	["outline-none", "outline-solid", "outline-dashed", "outline-dotted", "outline-double"],
	["outline-style"],
);
// Aspect
addAll(["aspect-auto", "aspect-square", "aspect-video"], ["aspect-ratio"]);
// Object fit / position
addAll(
	["object-contain", "object-cover", "object-fill", "object-none", "object-scale-down"],
	["object-fit"],
);
addAll(
	[
		"object-center",
		"object-top",
		"object-bottom",
		"object-left",
		"object-right",
		"object-top-left",
		"object-top-right",
		"object-bottom-left",
		"object-bottom-right",
	],
	["object-position"],
);
// Background
addAll(["bg-cover", "bg-contain", "bg-auto"], ["background-size"]);
addAll(
	[
		"bg-center",
		"bg-top",
		"bg-top-left",
		"bg-top-right",
		"bg-bottom",
		"bg-bottom-left",
		"bg-bottom-right",
		"bg-left",
		"bg-right",
	],
	["background-position"],
);
addAll(
	["bg-repeat", "bg-no-repeat", "bg-repeat-x", "bg-repeat-y", "bg-repeat-round", "bg-repeat-space"],
	["background-repeat"],
);
addAll(["bg-fixed", "bg-local", "bg-scroll"], ["background-attachment"]);
addAll(
	["bg-clip-border", "bg-clip-padding", "bg-clip-content", "bg-clip-text"],
	["background-clip"],
);
addAll(["bg-origin-border", "bg-origin-padding", "bg-origin-content"], ["background-origin"]);
addAll(
	[
		"bg-blend-normal",
		"bg-blend-multiply",
		"bg-blend-screen",
		"bg-blend-overlay",
		"bg-blend-darken",
		"bg-blend-lighten",
		"bg-blend-color-dodge",
		"bg-blend-color-burn",
		"bg-blend-hard-light",
		"bg-blend-soft-light",
		"bg-blend-difference",
		"bg-blend-exclusion",
		"bg-blend-hue",
		"bg-blend-saturation",
		"bg-blend-color",
		"bg-blend-luminosity",
	],
	["background-blend-mode"],
);
// Divide style (namespaced with ~ to avoid false conflicts with element-level border-style)
addAll(
	[
		"divide-solid",
		"divide-dashed",
		"divide-dotted",
		"divide-double",
		"divide-hidden",
		"divide-none",
	],
	["~divide:border-style"],
);
// Animation (static). A named animation is theme-driven, so it merges through
// the `animate` prefix below rather than from a list here.
addAll(["animate-in", "animate-out", "animate-none"], ["animation"]);
addAll(["animate-infinite", "animate-once", "animate-twice"], ["animation-iteration-count"]);
addAll(
	["animate-fill-none", "animate-fill-forwards", "animate-fill-both", "animate-fill-backwards"],
	["animation-fill-mode"],
);
addAll(
	["animate-normal", "animate-reverse", "animate-alternate", "animate-alternate-reverse"],
	["animation-direction"],
);
// Mask
addAll(["mask-add", "mask-subtract", "mask-intersect", "mask-exclude"], ["mask-composite"]);
addAll(
	[
		"mask-clip-border",
		"mask-clip-padding",
		"mask-clip-content",
		"mask-clip-fill",
		"mask-clip-stroke",
		"mask-clip-view",
		"mask-no-clip",
	],
	["mask-clip"],
);
addAll(["mask-alpha", "mask-luminance", "mask-match"], ["mask-mode"]);
addAll(
	[
		"mask-origin-border",
		"mask-origin-padding",
		"mask-origin-content",
		"mask-origin-fill",
		"mask-origin-stroke",
		"mask-origin-view",
	],
	["mask-origin"],
);
addAll(
	[
		"mask-top-left",
		"mask-top",
		"mask-top-right",
		"mask-left",
		"mask-center",
		"mask-right",
		"mask-bottom-left",
		"mask-bottom",
		"mask-bottom-right",
	],
	["mask-position"],
);
addAll(
	[
		"mask-repeat",
		"mask-no-repeat",
		"mask-repeat-x",
		"mask-repeat-y",
		"mask-repeat-space",
		"mask-repeat-round",
	],
	["mask-repeat"],
);
addAll(["mask-auto", "mask-cover", "mask-contain"], ["mask-size"]);
// Mask radial size (keywords) / position
addAll(
	[
		"mask-radial-closest-corner",
		"mask-radial-closest-side",
		"mask-radial-farthest-corner",
		"mask-radial-farthest-side",
	],
	["--ri-mask-radial-size"],
);
addAll(
	[
		"mask-radial-at-top-left",
		"mask-radial-at-top",
		"mask-radial-at-top-right",
		"mask-radial-at-left",
		"mask-radial-at-center",
		"mask-radial-at-right",
		"mask-radial-at-bottom-left",
		"mask-radial-at-bottom",
		"mask-radial-at-bottom-right",
	],
	["--ri-mask-radial-position"],
);
// Anchor positioning areas
addAll(
	[
		"position-area-top",
		"position-area-bottom",
		"position-area-left",
		"position-area-right",
		"position-area-center",
		"position-area-start",
		"position-area-end",
		"position-area-self-start",
		"position-area-self-end",
		"position-area-top-left",
		"position-area-top-center",
		"position-area-top-right",
		"position-area-bottom-left",
		"position-area-bottom-center",
		"position-area-bottom-right",
		"position-area-center-left",
		"position-area-center-right",
		"position-area-top-span-all",
		"position-area-bottom-span-all",
		"position-area-left-span-all",
		"position-area-right-span-all",
		"position-area-span-all",
	],
	["position-area"],
);
// Resize
addAll(["resize", "resize-none", "resize-x", "resize-y"], ["resize"]);
// Touch action
addAll(
	[
		"touch-auto",
		"touch-none",
		"touch-manipulation",
		"touch-pan-x",
		"touch-pan-left",
		"touch-pan-right",
		"touch-pan-y",
		"touch-pan-up",
		"touch-pan-down",
		"touch-pinch-zoom",
	],
	["touch-action"],
);
// Color scheme
addAll(
	[
		"scheme-normal",
		"scheme-dark",
		"scheme-light",
		"scheme-light-dark",
		"scheme-only-dark",
		"scheme-only-light",
	],
	["color-scheme"],
);
// Scroll snap type / align
addAll(["snap-none", "snap-x", "snap-y", "snap-both"], ["scroll-snap-type"]);
addAll(["snap-align-none", "snap-start", "snap-center", "snap-end"], ["scroll-snap-align"]);
// Contain
addAll(
	[
		"contain-none",
		"contain-content",
		"contain-strict",
		"contain-size",
		"contain-inline-size",
		"contain-layout",
		"contain-paint",
		"contain-style",
	],
	["contain"],
);
// Word break
addAll(["break-normal", "break-all", "break-keep"], ["word-break"]);
// Scrollbar width / gutter
addAll(["scrollbar-auto", "scrollbar-thin", "scrollbar-none"], ["scrollbar-width"]);
addAll(
	["scrollbar-gutter-auto", "scrollbar-gutter-stable", "scrollbar-gutter-both"],
	["scrollbar-gutter"],
);
// Will change
addAll(
	["will-change-auto", "will-change-scroll", "will-change-contents", "will-change-transform"],
	["will-change"],
);
// Mix blend mode
addAll(
	[
		"mix-blend-normal",
		"mix-blend-multiply",
		"mix-blend-screen",
		"mix-blend-overlay",
		"mix-blend-darken",
		"mix-blend-lighten",
		"mix-blend-color-dodge",
		"mix-blend-color-burn",
		"mix-blend-hard-light",
		"mix-blend-soft-light",
		"mix-blend-difference",
		"mix-blend-exclusion",
		"mix-blend-hue",
		"mix-blend-saturation",
		"mix-blend-color",
		"mix-blend-luminosity",
		"mix-blend-plus-darker",
		"mix-blend-plus-lighter",
	],
	["mix-blend-mode"],
);
Object.freeze(BUILTIN_STATIC_PROPS);

export { BUILTIN_STATIC_PROPS };
