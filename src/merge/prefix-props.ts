/**
 * `ri()` conflict claims for prefix utilities — the table keyed by the part of
 * a class before its value (`p-`, `text-`, `border-t-`).
 *
 * The spacing rows are spread from the shared family maps rather than retyped,
 * so a prefix claims exactly the properties the generator emits for it.
 */

import {
	BACKDROP_FILTER_SLOTS,
	BORDER_DIR_PROPS,
	FILTER_SLOTS,
	GAP_MAP,
	INSET_MAP,
	MARGIN_MAP,
	PADDING_MAP,
	SCROLL_MARGIN_MAP,
	SCROLL_PADDING_MAP,
} from "../utilities/property-maps.js";

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
	// `ring-offset-*` claims its own slots and NOT `box-shadow`, which is the
	// whole reason it composes: the offset layer joins a chain some other class
	// already emits the shorthand for. A claim on `box-shadow` here would let
	// `ring-offset-2` dominate the `ring-2` doing the visible work — which is
	// what happened before this row existed, when the family fell into the
	// `ring` prefix and `ri("ring-2 ring-offset-2 ring-offset-white")` returned
	// just `"ring-offset-white"`.
	"ring-offset": ["--ri-ring-offset-width", "--ri-ring-offset-shadow"],
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
	// `filter-[v]` replaces the chain outright, so it claims every slot. The
	// bare `filter` static above is matched first and claims only the shorthand.
	filter: ["filter", ...FILTER_SLOTS],
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
	"backdrop-filter": ["backdrop-filter", ...BACKDROP_FILTER_SLOTS],
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
	// Scoped, like `divide`: the declaration is `color`, but it lands inside
	// `&::placeholder`, so it never conflicts with `text-*`. Without the
	// `~placeholder:` scope both would claim `color` and the merger would drop
	// one of `text-red-500 placeholder-gray-400`.
	placeholder: ["~placeholder:color"],
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

Object.freeze(PREFIX_PROPS);

export { PREFIX_PROPS };
