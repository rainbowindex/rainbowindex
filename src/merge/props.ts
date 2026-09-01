/**
 * Data maps for ri() conflict resolution.
 *
 * Extracted from merge.ts to keep the merge algorithm readable.
 * These are pure data — no mutable state, no side effects.
 */

// ---------------------------------------------------------------------------
// Shared prefix → property family maps
//
// Single source of truth for both sides of the pipeline: the generators
// (utilities/spacing.ts, utilities/borders.ts) emit declarations from these
// maps, and the merge tables below spread them into their claim entries — so
// the properties ri() claims can never drift from the CSS the engine emits.
// Frozen pure data, safe for browser bundles like everything else here.
// ---------------------------------------------------------------------------

export const PADDING_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	p: ["padding"],
	px: ["padding-inline"],
	py: ["padding-block"],
	pt: ["padding-block-start"],
	pb: ["padding-block-end"],
	pl: ["padding-inline-start"],
	pr: ["padding-inline-end"],
	ps: ["padding-inline-start"],
	pe: ["padding-inline-end"],
	pbs: ["padding-block-start"],
	pbe: ["padding-block-end"],
});

export const MARGIN_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	m: ["margin"],
	mx: ["margin-inline"],
	my: ["margin-block"],
	mt: ["margin-block-start"],
	mb: ["margin-block-end"],
	ml: ["margin-inline-start"],
	mr: ["margin-inline-end"],
	ms: ["margin-inline-start"],
	me: ["margin-inline-end"],
	mbs: ["margin-block-start"],
	mbe: ["margin-block-end"],
});

export const GAP_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	gap: ["gap"],
	"gap-x": ["column-gap"],
	"gap-y": ["row-gap"],
});

export const INSET_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	inset: ["inset"],
	"inset-x": ["inset-inline"],
	"inset-y": ["inset-block"],
	top: ["inset-block-start"],
	bottom: ["inset-block-end"],
	left: ["inset-inline-start"],
	right: ["inset-inline-end"],
	start: ["inset-inline-start"],
	end: ["inset-inline-end"],
	"inset-s": ["inset-inline-start"],
	"inset-e": ["inset-inline-end"],
	"inset-bs": ["inset-block-start"],
	"inset-be": ["inset-block-end"],
});

export const SCROLL_MARGIN_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	"scroll-m": ["scroll-margin"],
	"scroll-mx": ["scroll-margin-inline"],
	"scroll-my": ["scroll-margin-block"],
	"scroll-mt": ["scroll-margin-block-start"],
	"scroll-mb": ["scroll-margin-block-end"],
	"scroll-ml": ["scroll-margin-inline-start"],
	"scroll-mr": ["scroll-margin-inline-end"],
	"scroll-ms": ["scroll-margin-inline-start"],
	"scroll-me": ["scroll-margin-inline-end"],
	"scroll-mbs": ["scroll-margin-block-start"],
	"scroll-mbe": ["scroll-margin-block-end"],
});

export const SCROLL_PADDING_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	"scroll-p": ["scroll-padding"],
	"scroll-px": ["scroll-padding-inline"],
	"scroll-py": ["scroll-padding-block"],
	"scroll-pt": ["scroll-padding-block-start"],
	"scroll-pb": ["scroll-padding-block-end"],
	"scroll-pl": ["scroll-padding-inline-start"],
	"scroll-pr": ["scroll-padding-inline-end"],
	"scroll-ps": ["scroll-padding-inline-start"],
	"scroll-pe": ["scroll-padding-inline-end"],
	"scroll-pbs": ["scroll-padding-block-start"],
	"scroll-pbe": ["scroll-padding-block-end"],
});

/** Directional border-width prefixes → per-side logical width property.
 *  The generator (utilities/borders.ts) derives its trailing-dash entries
 *  from this map at module init. */
export const BORDER_DIR_PROPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	"border-t": ["border-block-start-width"],
	"border-b": ["border-block-end-width"],
	"border-l": ["border-inline-start-width"],
	"border-r": ["border-inline-end-width"],
	"border-s": ["border-inline-start-width"],
	"border-e": ["border-inline-end-width"],
	"border-bs": ["border-block-start-width"],
	"border-be": ["border-block-end-width"],
	"border-x": ["border-inline-width"],
	"border-y": ["border-block-width"],
});

// ---------------------------------------------------------------------------
// Conflict resolution data
// ---------------------------------------------------------------------------

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

	// Backdrop filter (static) — backdrop-blur-none resets all backdrop filters
	"backdrop-blur-none": ["backdrop-filter"],
	"backdrop-grayscale": ["--ri-backdrop-grayscale", "backdrop-filter"],
	"backdrop-invert": ["--ri-backdrop-invert", "backdrop-filter"],
	"backdrop-sepia": ["--ri-backdrop-sepia", "backdrop-filter"],

	// Filter (static) — filter-none resets all filters
	"filter-none": ["filter"],
	"backdrop-filter-none": ["backdrop-filter"],
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
/**
 * `<base>-fluid` spacing rows, derived at module init from the same shared
 * family maps the generator resolves against (utilities/spacing.ts) — a fluid
 * utility claims exactly what its base form claims, so the merge side can
 * never drift from the plain one.
 *
 * The inset-{s,e,bs,be} logical aliases are deliberately excluded: their
 * -fluid forms have never been registered here, and because PREFIX_PROP_KEYS
 * feeds the parser's MULTI_SEGMENT_PREFIXES, adding them would enable new
 * utility classes rather than just merge claims.
 */
const FLUID_EXCLUDED_PREFIXES = new Set(["inset-s", "inset-e", "inset-bs", "inset-be"]);
const FLUID_SPACING_PROPS: Readonly<Record<string, readonly string[]>> = (() => {
	const rows: Record<string, readonly string[]> = {};
	for (const map of [PADDING_MAP, MARGIN_MAP, GAP_MAP, INSET_MAP]) {
		for (const [prefix, props] of Object.entries(map)) {
			if (FLUID_EXCLUDED_PREFIXES.has(prefix)) continue;
			rows[`${prefix}-fluid`] = props;
		}
	}
	return Object.freeze(rows);
})();

/**
 * Prefix-based utility → CSS properties.
 * For dynamic utilities like "p-4", "w-1/2", "text-red-500".
 * Null prototype — see BUILTIN_STATIC_PROPS.
 */
const PREFIX_PROPS: Record<string, readonly string[]> = Object.assign(Object.create(null), {
	// Spacing (family maps shared with utilities/spacing.ts — see header above)
	...PADDING_MAP,
	...MARGIN_MAP,
	...GAP_MAP,
	...FLUID_SPACING_PROPS,
	// fluid-<name> scope classes all claim the same scope-var pair, so a later
	// range wins over an earlier one.
	fluid: ["--fluid-scope-min", "--fluid-scope-max"],
	"space-x": ["~space:margin-inline-start", "~space:margin-inline-end"],
	"space-y": ["~space:margin-block-start", "~space:margin-block-end"],
	...INSET_MAP,

	// Sizing
	w: ["width"],
	h: ["height"],
	"min-w": ["min-width"],
	"max-w": ["max-width"],
	"min-h": ["min-height"],
	"max-h": ["max-height"],
	size: ["width", "height"],
	// Logical sizing — overloads the inline/block display prefixes. Bare
	// `inline`/`block` and `inline-block` etc. resolve as display via the
	// BUILTIN_STATIC_PROPS match, which runs before prefix resolution.
	inline: ["inline-size"],
	block: ["block-size"],
	"min-inline": ["min-inline-size"],
	"max-inline": ["max-inline-size"],
	"min-block": ["min-block-size"],
	"max-block": ["max-block-size"],

	// Layout
	z: ["z-index"],
	order: ["order"],
	"grid-cols": ["grid-template-columns"],
	"grid-rows": ["grid-template-rows"],
	"col-span": ["grid-column"],
	"col-start": ["grid-column-start"],
	"col-end": ["grid-column-end"],
	"row-span": ["grid-row"],
	"row-start": ["grid-row-start"],
	"row-end": ["grid-row-end"],
	// Bare grid-column / grid-row + flex-value prefixes (statics are matched first;
	// `flex`/`grow`/`shrink` are also display/flex-grow/flex-shrink statics).
	col: ["grid-column"],
	row: ["grid-row"],
	flex: ["flex"],
	grow: ["flex-grow"],
	shrink: ["flex-shrink"],
	"auto-cols": ["grid-auto-columns"],
	"auto-rows": ["grid-auto-rows"],
	columns: ["columns"],
	aspect: ["aspect-ratio"],
	// object-[v] / object-(--p) → object-position (object-fit + keyword statics
	// are matched first via BUILTIN_STATIC_PROPS).
	object: ["object-position"],

	// Typography
	"text-fluid": ["font-size", "line-height"],
	leading: ["line-height"],
	tracking: ["letter-spacing"],
	indent: ["text-indent"],
	tab: ["tab-size"],
	align: ["vertical-align"],
	"line-clamp": ["overflow", "display", "-webkit-box-orient", "-webkit-line-clamp"],
	"underline-offset": ["text-underline-offset"],
	"font-stretch": ["font-stretch"],
	"font-features": ["font-feature-settings"],
	"list-image": ["list-style-image"],
	// list-[<value>] / list-(--v) → list-style-type (keyword/position statics matched first)
	list: ["list-style-type"],

	// Flex basis
	basis: ["flex-basis"],

	// Perspective (functional): perspective-{n}, perspective-[arb]
	perspective: ["perspective"],
	"perspective-origin": ["perspective-origin"],

	// Transform axis variants — each sets its own CSS variable plus the shared
	// `transform` property, so rotate-x/y/z and skew-x/y compose (distinct slot vars).
	"rotate-x": ["transform", "--ri-rotate-x"],
	"rotate-y": ["transform", "--ri-rotate-y"],
	"rotate-z": ["transform", "--ri-rotate-z"],
	"scale-z": ["--ri-scale-z", "scale"],
	"translate-z": ["--ri-translate-z", "translate"],

	// Effects — composable shadow/ring families (shared box-shadow + slot var)
	shadow: ["box-shadow", "--ri-shadow"],
	"inset-shadow": ["box-shadow", "--ri-inset-shadow"],
	ring: ["box-shadow", "--ri-ring-shadow"],
	"inset-ring": ["box-shadow", "--ri-inset-ring-shadow"],
	// text-shadow is its own property (not part of the box-shadow composition)
	"text-shadow": ["text-shadow"],
	opacity: ["opacity"],
	blur: ["--ri-blur", "filter"],
	duration: ["transition-duration", "animation-duration"],
	delay: ["transition-delay", "animation-delay"],
	ease: ["transition-timing-function"],
	"translate-x": ["--ri-translate-x", "translate"],
	"translate-y": ["--ri-translate-y", "translate"],
	rotate: ["rotate"],
	"scale-x": ["--ri-scale-x", "scale"],
	"scale-y": ["--ri-scale-y", "scale"],
	scale: ["scale"],
	skew: ["transform", "--ri-skew-x", "--ri-skew-y"],
	"skew-x": ["transform", "--ri-skew-x"],
	"skew-y": ["transform", "--ri-skew-y"],
	transform: ["transform"],
	zoom: ["zoom"],
	filter: ["filter"],
	brightness: ["--ri-brightness", "filter"],
	contrast: ["--ri-contrast", "filter"],
	saturate: ["--ri-saturate", "filter"],
	grayscale: ["--ri-grayscale", "filter"],
	invert: ["--ri-invert", "filter"],
	sepia: ["--ri-sepia", "filter"],
	"hue-rotate": ["--ri-hue-rotate", "filter"],
	"drop-shadow": ["--ri-drop-shadow", "filter"],

	// Borders — these also appear in BUILTIN_STATIC_PROPS for the bare static
	// form (e.g. `border-t` → default 1px width). The prefix entries here handle
	// the dynamic form (e.g. `border-t-2`, `border-t-red-500`) via resolvePropsWith().
	...BORDER_DIR_PROPS,
	// Table border-spacing — composable: shared border-spacing + per-axis slot var.
	"border-spacing": ["border-spacing", "--ri-border-spacing-x", "--ri-border-spacing-y"],
	"border-spacing-x": ["border-spacing", "--ri-border-spacing-x"],
	"border-spacing-y": ["border-spacing", "--ri-border-spacing-y"],
	rounded: ["border-radius"],
	"rounded-t": ["border-start-start-radius", "border-start-end-radius"],
	"rounded-b": ["border-end-start-radius", "border-end-end-radius"],
	"rounded-l": ["border-start-start-radius", "border-end-start-radius"],
	"rounded-r": ["border-start-end-radius", "border-end-end-radius"],
	"rounded-tl": ["border-start-start-radius"],
	"rounded-tr": ["border-start-end-radius"],
	"rounded-bl": ["border-end-start-radius"],
	"rounded-br": ["border-end-end-radius"],
	"rounded-s": ["border-start-start-radius", "border-end-start-radius"],
	"rounded-e": ["border-start-end-radius", "border-end-end-radius"],
	"rounded-bs": ["border-start-start-radius", "border-start-end-radius"],
	"rounded-be": ["border-end-start-radius", "border-end-end-radius"],
	"rounded-ss": ["border-start-start-radius"],
	"rounded-se": ["border-start-end-radius"],
	"rounded-es": ["border-end-start-radius"],
	"rounded-ee": ["border-end-end-radius"],
	// Arbitrary corner-shape: corner-[superellipse(2)], etc.
	corner: ["corner-shape", "--ri-rounded-scale"],
	"outline-offset": ["outline-offset"],
	outline: ["outline-width"],
	divide: ["~divide:border-color"],
	"divide-x": ["~divide:border-inline-start-width", "~divide:border-inline-end-width"],
	"divide-y": ["~divide:border-block-start-width", "~divide:border-block-end-width"],
	border: ["border-width"],

	// Gradients
	"bg-linear-to": ["background-image", "--ri-gradient-position"],
	"bg-linear": ["background-image", "--ri-gradient-position"],
	"bg-conic": ["background-image", "--ri-gradient-position"],
	"bg-radial": ["background-image", "--ri-gradient-position"],
	from: ["--ri-gradient-from", "--ri-gradient-stops"],
	via: ["--ri-gradient-via", "--ri-gradient-stops"],
	to: ["--ri-gradient-to", "--ri-gradient-stops"],
	"from-position": ["--ri-gradient-from-position"],
	"via-position": ["--ri-gradient-via-position"],
	"to-position": ["--ri-gradient-to-position"],

	// Animations. `animate` is last of the four by length, so the three
	// specific prefixes match first and `animate-{name}` catches every
	// @animate token and arbitrary shorthand.
	"animate-duration": ["animation-duration"],
	"animate-delay": ["animation-delay"],
	"animate-ease": ["animation-timing-function"],
	animate: ["animation"],
	"break-before": ["break-before"],
	"break-after": ["break-after"],
	"break-inside": ["break-inside"],
	content: ["content"],
	"fade-in": ["--ri-enter-opacity"],
	"fade-out": ["--ri-exit-opacity"],
	"zoom-in": ["--ri-enter-scale"],
	"zoom-out": ["--ri-exit-scale"],
	"spin-in": ["--ri-enter-rotate"],
	"spin-out": ["--ri-exit-rotate"],
	"blur-in": ["--ri-enter-blur"],
	"blur-out": ["--ri-exit-blur"],
	"slide-in-from-top": ["--ri-enter-translate-y"],
	"slide-in-from-bottom": ["--ri-enter-translate-y"],
	"slide-in-from-left": ["--ri-enter-translate-x"],
	"slide-in-from-right": ["--ri-enter-translate-x"],
	"slide-out-to-top": ["--ri-exit-translate-y"],
	"slide-out-to-bottom": ["--ri-exit-translate-y"],
	"slide-out-to-left": ["--ri-exit-translate-x"],
	"slide-out-to-right": ["--ri-exit-translate-x"],

	// Scroll margin/padding (family maps shared with utilities/spacing.ts)
	...SCROLL_MARGIN_MAP,
	...SCROLL_PADDING_MAP,

	// Backdrop filter — each function gets a unique CSS variable so they coexist
	"backdrop-filter": ["backdrop-filter"],
	"backdrop-blur": ["--ri-backdrop-blur", "backdrop-filter"],
	"backdrop-brightness": ["--ri-backdrop-brightness", "backdrop-filter"],
	"backdrop-contrast": ["--ri-backdrop-contrast", "backdrop-filter"],
	"backdrop-saturate": ["--ri-backdrop-saturate", "backdrop-filter"],
	"backdrop-grayscale": ["--ri-backdrop-grayscale", "backdrop-filter"],
	"backdrop-invert": ["--ri-backdrop-invert", "backdrop-filter"],
	"backdrop-sepia": ["--ri-backdrop-sepia", "backdrop-filter"],
	"backdrop-opacity": ["--ri-backdrop-opacity", "backdrop-filter"],
	"backdrop-hue-rotate": ["--ri-backdrop-hue-rotate", "backdrop-filter"],

	// Mask
	mask: ["mask-image"],
	// Mask gradient families. The `*-from`/`*-to` prefixes are dual-mode
	// (position vs color), resolved in merge/index.ts; the arrays here are the
	// color-case defaults. Listing `mask-image` lets same-family from/to coexist
	// (each also owns a unique stop var) while same-end repeats dedupe.
	"mask-linear": ["mask-image", "--ri-mask-linear-position"],
	"mask-linear-from": ["mask-image", "--ri-mask-linear-from"],
	"mask-linear-to": ["mask-image", "--ri-mask-linear-to"],
	"mask-conic": ["mask-image", "--ri-mask-conic-position"],
	"mask-conic-from": ["mask-image", "--ri-mask-conic-from"],
	"mask-conic-to": ["mask-image", "--ri-mask-conic-to"],
	"mask-radial": ["mask-image"],
	"mask-radial-from": ["mask-image", "--ri-mask-radial-from"],
	"mask-radial-to": ["mask-image", "--ri-mask-radial-to"],
	"mask-t-from": ["mask-image", "--ri-mask-top-from"],
	"mask-t-to": ["mask-image", "--ri-mask-top-to"],
	"mask-r-from": ["mask-image", "--ri-mask-right-from"],
	"mask-r-to": ["mask-image", "--ri-mask-right-to"],
	"mask-b-from": ["mask-image", "--ri-mask-bottom-from"],
	"mask-b-to": ["mask-image", "--ri-mask-bottom-to"],
	"mask-l-from": ["mask-image", "--ri-mask-left-from"],
	"mask-l-to": ["mask-image", "--ri-mask-left-to"],
	"mask-x-from": ["mask-image", "mask-composite", "--ri-mask-right-from", "--ri-mask-left-from"],
	"mask-x-to": ["mask-image", "mask-composite", "--ri-mask-right-to", "--ri-mask-left-to"],
	"mask-y-from": ["mask-image", "mask-composite", "--ri-mask-top-from", "--ri-mask-bottom-from"],
	"mask-y-to": ["mask-image", "mask-composite", "--ri-mask-top-to", "--ri-mask-bottom-to"],
	"mask-position": ["mask-position"],
	"mask-size": ["mask-size"],

	// Background position/size (longer than the `bg` dual-mode prefix → matched first)
	"bg-position": ["background-position"],
	"bg-size": ["background-size"],

	// Color prefixes (dual-mode entries — resolved by special-case logic in resolveProps)
	text: ["color"],
	bg: ["background-color"],
	font: ["font-weight"],
	decoration: ["text-decoration-thickness"],
	accent: ["accent-color"],
	caret: ["caret-color"],
	// Composable scrollbar-color (shared scrollbar-color + per-part slot var).
	"scrollbar-thumb": ["scrollbar-color", "--ri-scrollbar-thumb"],
	"scrollbar-track": ["scrollbar-color", "--ri-scrollbar-track"],
	fill: ["fill"],
	stroke: ["stroke"],
	"stroke-cap": ["stroke-linecap"],
	"stroke-join": ["stroke-linejoin"],
	"stroke-dash": ["stroke-dasharray"],
	"stroke-offset": ["stroke-dashoffset"],
	"stroke-miter": ["stroke-miterlimit"],
	"stroke-opacity": ["stroke-opacity"],
	paint: ["paint-order"],
	vector: ["vector-effect"],

	// Anchor positioning
	"@anchor": ["anchor-name"],
	"@anchor-to": ["position-anchor"],
	"position-area": ["position-area"],
	"anchor-scope": ["anchor-scope"],
});

/**
 * Shorthand CSS properties → the longhand properties they directly decompose
 * into. Entries list only DIRECT longhands; the exported OVERRIDES below is
 * this table's transitive closure, computed once at module init — so a
 * shorthand's claim set can never silently miss a transitive leaf (claim
 * expansion in merge/index.ts is single-level by design).
 */
const DIRECT_OVERRIDES: Record<string, readonly string[]> = Object.assign(Object.create(null), {
	padding: ["padding-inline", "padding-block"],
	"padding-inline": ["padding-inline-start", "padding-inline-end"],
	"padding-block": ["padding-block-start", "padding-block-end"],
	margin: ["margin-inline", "margin-block"],
	"margin-inline": ["margin-inline-start", "margin-inline-end"],
	"margin-block": ["margin-block-start", "margin-block-end"],
	gap: ["column-gap", "row-gap"],
	inset: ["inset-inline", "inset-block"],
	"inset-inline": ["inset-inline-start", "inset-inline-end"],
	"inset-block": ["inset-block-start", "inset-block-end"],
	"border-width": ["border-inline-width", "border-block-width"],
	"border-inline-width": ["border-inline-start-width", "border-inline-end-width"],
	"border-block-width": ["border-block-start-width", "border-block-end-width"],
	// Full `border` shorthand ([border:…] arbitrary properties / custom
	// utilities) — the closure reaches every width/style/color leaf.
	border: ["border-width", "border-style", "border-color"],
	"border-radius": [
		"border-start-start-radius",
		"border-start-end-radius",
		"border-end-start-radius",
		"border-end-end-radius",
	],
	overflow: ["overflow-x", "overflow-y"],
	"overscroll-behavior": ["overscroll-behavior-x", "overscroll-behavior-y"],
	"border-color": ["border-inline-color", "border-block-color"],
	"border-inline-color": ["border-inline-start-color", "border-inline-end-color"],
	"border-block-color": ["border-block-start-color", "border-block-end-color"],
	// Unlike width/color, the style intermediates have no OVERRIDES entries of
	// their own (nothing claims them alone), so this entry stays flat.
	"border-style": [
		"border-inline-style",
		"border-block-style",
		"border-block-start-style",
		"border-block-end-style",
		"border-inline-start-style",
		"border-inline-end-style",
	],
	"scroll-margin": ["scroll-margin-inline", "scroll-margin-block"],
	"scroll-margin-inline": ["scroll-margin-inline-start", "scroll-margin-inline-end"],
	"scroll-margin-block": ["scroll-margin-block-start", "scroll-margin-block-end"],
	"scroll-padding": ["scroll-padding-inline", "scroll-padding-block"],
	"scroll-padding-inline": ["scroll-padding-inline-start", "scroll-padding-inline-end"],
	"scroll-padding-block": ["scroll-padding-block-start", "scroll-padding-block-end"],
	flex: ["flex-grow", "flex-shrink", "flex-basis"],
	transition: [
		"transition-property",
		"transition-duration",
		"transition-timing-function",
		"transition-delay",
	],
	animation: [
		"animation-name",
		"animation-duration",
		"animation-timing-function",
		"animation-delay",
		"animation-iteration-count",
		"animation-direction",
		"animation-fill-mode",
		"animation-play-state",
	],
	"text-decoration": [
		"text-decoration-line",
		"text-decoration-style",
		"text-decoration-color",
		"text-decoration-thickness",
	],
	outline: ["outline-width", "outline-style", "outline-color"],
	"grid-column": ["grid-column-start", "grid-column-end"],
	"grid-row": ["grid-row-start", "grid-row-end"],
	background: [
		"background-color",
		"background-image",
		"background-size",
		"background-position",
		"background-repeat",
		"background-attachment",
		"background-origin",
		"background-clip",
	],
	"place-items": ["align-items", "justify-items"],
	"place-content": ["align-content", "justify-content"],
	"place-self": ["align-self", "justify-self"],
	// filter-none / backdrop-blur-none reset all individual filter functions
	filter: [
		"--ri-blur",
		"--ri-brightness",
		"--ri-contrast",
		"--ri-saturate",
		"--ri-hue-rotate",
		"--ri-drop-shadow",
		"--ri-grayscale",
		"--ri-invert",
		"--ri-sepia",
	],
	"backdrop-filter": [
		"--ri-backdrop-blur",
		"--ri-backdrop-brightness",
		"--ri-backdrop-contrast",
		"--ri-backdrop-saturate",
		"--ri-backdrop-grayscale",
		"--ri-backdrop-invert",
		"--ri-backdrop-sepia",
		"--ri-backdrop-opacity",
		"--ri-backdrop-hue-rotate",
	],
});

/**
 * Shorthand CSS properties → ALL longhand properties they override — the
 * transitive closure of DIRECT_OVERRIDES (merge/index.ts expands claims one
 * level, so each entry must carry every reachable leaf). Null prototype —
 * see BUILTIN_STATIC_PROPS.
 */
const OVERRIDES: Record<string, readonly string[]> = (() => {
	const closed: Record<string, readonly string[]> = Object.create(null);
	for (const key of Object.keys(DIRECT_OVERRIDES)) {
		const seen = new Set<string>();
		const stack = [...DIRECT_OVERRIDES[key]];
		while (stack.length > 0) {
			const prop = stack.pop();
			if (prop === undefined || seen.has(prop)) continue;
			seen.add(prop);
			const next = DIRECT_OVERRIDES[prop];
			if (next !== undefined) stack.push(...next);
		}
		closed[key] = Object.freeze([...seen]);
	}
	return closed;
})();

// Freeze all three data maps to prevent accidental mutation.
Object.freeze(BUILTIN_STATIC_PROPS);
Object.freeze(PREFIX_PROPS);
Object.freeze(OVERRIDES);

// ---------------------------------------------------------------------------
// Color detection helpers
// ---------------------------------------------------------------------------

/**
 * Detect if a value part looks like a color.
 * Used for dual-mode resolution (text-{size} vs text-{color}).
 */
// Hoisted regexes — compiled once (merge.ts is browser-shipped hot path).
const RE_COLOR_SHADE = /^[a-z]+(?:-[a-z]+)*-\d{2,3}$/;

/**
 * CSS color-function names. Single source for the merge classifier here and
 * the engine's bracketed-color detector (utilities/color.ts) — if the two
 * sets drift, conflict groups stop matching emitted CSS.
 */
export const COLOR_FUNCTION_ALTERNATION =
	"oklch|oklab|rgb|rgba|hsl|hsla|hwb|lab|lch|color|light-dark";
const RE_ARBITRARY_COLOR = new RegExp(`[#]|(?:${COLOR_FUNCTION_ALTERNATION})\\s*\\(`);
const RE_ALPHA_SUFFIX = /\/[\w.%-]+$/;

/**
 * Special color names → CSS values. Single source for the engine resolver
 * (utilities/color.ts emits these values) and the merge classifier
 * (isColorValue matches the names) — a name added here is recognized by both
 * sides, so conflict groups always match emitted CSS. Null prototype + frozen.
 */
export const SPECIAL_COLORS: Readonly<Record<string, string>> = Object.freeze(
	Object.assign(Object.create(null), {
		transparent: "transparent",
		current: "currentColor",
		inherit: "inherit",
		black: "oklch(0 0 0)",
		white: "oklch(1 0 0)",
		paper: "var(--color-paper)",
		ink: "var(--color-ink)",
	}),
);
const SPECIAL_COLOR_NAMES: ReadonlySet<string> = new Set(Object.keys(SPECIAL_COLORS));

/**
 * Detect if a value part looks like a gradient position (percentage or arbitrary length).
 * Used for dual-mode resolution (from-{color} vs from-{position}).
 */
export function isGradientPositionValue(value: string): boolean {
	// Named percentage: "50%", "0%", "100%"
	if (value.endsWith("%")) {
		const num = Number(value.slice(0, -1));
		return !Number.isNaN(num) && Number.isInteger(num) && num >= 0 && num <= 100;
	}
	// Arbitrary non-color value in brackets: [20px], [calc(...)]
	if (value.startsWith("[") && value.endsWith("]") && !RE_ARBITRARY_COLOR.test(value)) {
		return true;
	}
	return false;
}

/**
 * Detect whether a mask gradient stop value (the part after `mask-…-from-`/`-to-`)
 * is a position rather than a color. Broader than isGradientPositionValue: bare
 * numbers resolve to spacing multiples and `(--custom-prop)` shorthands are
 * treated as positions for mask from/to utilities. Keep this in lockstep with
 * `resolveMaskPosition` in utilities/effects/masks.ts.
 */
const MASK_STOP_NUMBER_RE = /^\d+(?:[._]\d+)?$/;
const MASK_RADIAL_KEYWORD_RE = /\b(?:at|circle|ellipse|closest|farthest)\b/;

export function isMaskStopPositionValue(value: string): boolean {
	// Bare number (int or decimal) → spacing-based position
	if (MASK_STOP_NUMBER_RE.test(value)) return true;
	// CSS variable shorthand → position
	if (value.startsWith("(") && value.endsWith(")")) return true;
	// Any numeric percentage → position
	if (value.endsWith("%")) {
		const num = Number(value.slice(0, -1));
		return !Number.isNaN(num);
	}
	// Non-color arbitrary bracket → position
	if (value.startsWith("[")) return isGradientPositionValue(value);
	return false;
}

/** Single length/percentage token for radial size detection (e.g. 50%, 20px, 1.5rem). */
const MASK_RADIAL_SIZE_TOKEN_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)?$/i;

/**
 * Distinguish `mask-radial-[<size>]` (one or two length/percentage tokens →
 * `--ri-mask-radial-size`) from `mask-radial-[<value>]` (a full radial-gradient
 * argument → `mask-image`). Shape/position keywords (`circle`, `ellipse`,
 * `at …`, `closest/farthest …`) mark the value as a full image, not a size.
 * Used on both the generate side (utilities/effects/masks.ts) and the merge side.
 */
export function isMaskRadialSizeValue(value: string): boolean {
	if (!(value.startsWith("[") && value.endsWith("]"))) return false;
	const inner = value.slice(1, -1);
	if (!inner) return false;
	if (MASK_RADIAL_KEYWORD_RE.test(inner)) return false;
	const tokens = inner.split("_").filter(Boolean);
	if (tokens.length === 0 || tokens.length > 2) return false;
	return tokens.every((token) => MASK_RADIAL_SIZE_TOKEN_RE.test(token));
}

export function isColorValue(
	value: string,
	textSizes?: ReadonlySet<string>,
	colorNames?: ReadonlySet<string>,
): boolean {
	// Explicit color hint ([color:var(--x)] / (color:--x)) — the parser forces
	// these down the color path, so the merge must classify them identically.
	if (value.startsWith("[color:") || value.startsWith("(color:")) return true;
	// Single regex pass: the suffix match anchors at $, so slicing at its index
	// equals replacing it with "".
	const alphaMatch = RE_ALPHA_SUFFIX.exec(value);
	const baseValue = alphaMatch ? value.slice(0, alphaMatch.index) : value;
	// If the value is a known text size, it's definitively not a color —
	// prevents false positives where custom text sizes match color patterns.
	if (textSizes?.has(baseValue) === true) return false;
	// Theme color names registered at compile time — covers flat custom colors
	// (@color { accent: … }) whose bare form matches no shade/special pattern.
	if (colorNames?.has(baseValue) === true) return true;
	if (SPECIAL_COLOR_NAMES.has(baseValue)) return true;
	// Color shade: e.g., "red-500", "blue-50", "deep-blue-500"
	if (RE_COLOR_SHADE.test(baseValue)) return true;
	// Arbitrary color: hex (#fff), or known color functions
	if (baseValue.startsWith("[") && RE_ARBITRARY_COLOR.test(baseValue)) return true;
	return false;
}

/**
 * Image-shaped value: routes `bg-[<value>]` to `background-image` rather than
 * `background-color`. Single source for the engine dispatch (utilities/color.ts)
 * and the merge-side `bg` dual-mode so conflict groups match emitted CSS.
 */
export const RE_IMAGE_VALUE =
	/^(?:url|image|image-set|cross-fade|element|paint|(?:repeating-)?(?:linear|radial|conic)-gradient)\s*\(/i;

/** Merge-side wrapper: tests a raw class value (`[url(/x.png)]`, `(image:--x)`,
 *  `[image:linear-gradient(...)]`) for image shape, including the `image:` hint. */
export function isImageValue(value: string): boolean {
	if (value.startsWith("[image:") || value.startsWith("(image:")) return true;
	if (value.startsWith("[") || value.startsWith("(")) {
		return RE_IMAGE_VALUE.test(value.slice(1, -1));
	}
	return false;
}

/**
 * Font-stack-shaped arbitrary value (`font-[Georgia,_serif]`, `font-["Inter"]`,
 * `font-[family-name:var(--x)]`): mirrors typography.ts's family-vs-weight
 * heuristic so the merge claims `font-family` exactly when the engine emits it.
 */
export function isFontFamilyValue(value: string): boolean {
	if (value.startsWith("[family-name:") || value.startsWith("(family-name:")) return true;
	if (value.startsWith("[") && value.endsWith("]")) {
		const raw = value.slice(1, -1);
		return raw.includes(",") || raw.startsWith('"') || raw.startsWith("'");
	}
	return false;
}

// ---------------------------------------------------------------------------
// Derived lookup structures
// ---------------------------------------------------------------------------

/** Consumed by utilities/metadata.ts to derive STATIC_UTILITIES (single source of truth). */
export const BUILTIN_STATIC_KEYS = new Set(Object.keys(BUILTIN_STATIC_PROPS));
/** Consumed by utilities/metadata.ts to derive MULTI_SEGMENT_PREFIXES (single source of truth). */
export const PREFIX_PROP_KEYS = new Set(Object.keys(PREFIX_PROPS));
/** Sorted prefix list (longest first) for greedy matching. Internal to PREFIX_FIRST_SEGMENT_MAP. */
const SORTED_PREFIXES = Object.keys(PREFIX_PROPS).sort((a, b) => b.length - a.length);

/**
 * Group prefixes by first segment (before the first dash, or the full prefix
 * if no dash) for O(1) first-segment dispatch instead of an O(N) linear scan.
 * Bucket order preserves input order — callers pass longest-first lists so
 * greedy longest-prefix matching holds. Arrays are frozen because ReadonlyArray
 * only protects TypeScript callers. Shared by the merge dispatch below and the
 * parser's MULTI_SEGMENT_PREFIX_MAP (utilities/parser.ts).
 */
export function buildFirstSegmentMap(
	prefixes: Iterable<string>,
): ReadonlyMap<string, readonly string[]> {
	const map = new Map<string, string[]>();
	for (const prefix of prefixes) {
		const dashIdx = prefix.indexOf("-");
		const firstSeg = dashIdx === -1 ? prefix : prefix.slice(0, dashIdx);
		const existing = map.get(firstSeg);
		if (existing) {
			existing.push(prefix);
		} else {
			map.set(firstSeg, [prefix]);
		}
	}
	const frozen = new Map<string, readonly string[]>();
	for (const [key, arr] of map) {
		frozen.set(key, Object.freeze(arr));
	}
	return frozen;
}

/**
 * First-segment dispatch over every PREFIX_PROPS key, longest-first. For a
 * utility like "border-t-2", the first segment is "border", which maps to
 * ["border-spacing", "border-t", ..., "border"]; the caller then checks each
 * candidate with startsWith for greedy longest-prefix matching.
 */
export const PREFIX_FIRST_SEGMENT_MAP: ReadonlyMap<string, readonly string[]> =
	buildFirstSegmentMap(SORTED_PREFIXES);

export { BUILTIN_STATIC_PROPS, OVERRIDES, PREFIX_PROPS };
