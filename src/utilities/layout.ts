/**
 * Layout utilities — display, flex, grid, position, overflow,
 * visibility, z-index, aspect-ratio, columns, object-fit,
 * break, container queries.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import {
	type UtilityResult,
	single,
	multi,
	fullName,
	extractArbitrary,
	INTEGER_RE,
	DECIMAL_RE,
	spacingLookup,
	deepFreezeUtilityMap,
	normalizeDecimalToken,
} from "./index.js";
import { resolveColor } from "./color.js";
import { CONTAINER_WIDTHS } from "./sizing.js";
import { CSS_CUSTOM_IDENT_RE } from "../shared.js";

/** Bare aspect ratio: `16/9` → `16 / 9`. Bracket/custom-property forms go through extractArbitrary. */
const ASPECT_RATIO_RE = /^(\d+)\/(\d+)$/;

/**
 * Named container-width scale for `columns-{name}` (and any future
 * container-scale utility): the shared xs–7xl ladder from sizing.ts plus the
 * two sub-xs steps only this family exposes.
 */
const CONTAINER_SCALE: Readonly<Record<string, string>> = Object.freeze({
	"3xs": "16rem",
	"2xs": "18rem",
	...CONTAINER_WIDTHS,
});

/** Resolve a grid-line value (col/row start/end and bare col/row): auto / number / arbitrary / custom-property, with negation. */
function resolveGridLine(name: string, negative: boolean): string | null {
	if (name === "auto") return "auto";
	if (INTEGER_RE.test(name)) return negative ? `calc(${name} * -1)` : name;
	const arb = extractArbitrary(name);
	if (arb !== null) return negative ? `calc(${arb} * -1)` : arb;
	return null;
}

/** Fraction → percentage: `1/2` → `50%` (4-decimal rounding). Null when not a fraction. */
function fractionToPercent(name: string): string | null {
	const slash = name.indexOf("/");
	if (slash === -1) return null;
	const num = Number(name.slice(0, slash));
	const den = Number(name.slice(slash + 1));
	if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
	return `${Math.round((num / den) * 1000000) / 10000}%`;
}

/** Shared body for grid-cols-* / grid-rows-*: none | subgrid | <n> | arbitrary. */
function resolveGridTemplate(name: string, property: string): UtilityResult | null {
	if (name === "none") return single(property, "none");
	if (name === "subgrid") return single(property, "subgrid");
	if (INTEGER_RE.test(name)) return single(property, `repeat(${name}, minmax(0, 1fr))`);
	const arb = extractArbitrary(name);
	if (arb) return single(property, arb);
	return null;
}

/** Shared body for col-span-* / row-span-*: full | <n> | arbitrary. */
function resolveGridSpan(name: string, property: string): UtilityResult | null {
	if (name === "full") return single(property, "1 / -1");
	if (INTEGER_RE.test(name)) return single(property, `span ${name} / span ${name}`);
	const arb = extractArbitrary(name);
	if (arb !== null) return single(property, `span ${arb} / span ${arb}`);
	return null;
}

// ---------------------------------------------------------------------------
// Static utilities
// ---------------------------------------------------------------------------

const STATIC_LAYOUT: Readonly<Record<string, UtilityResult>> = {
	// Display
	block: single("display", "block"),
	"inline-block": single("display", "inline-block"),
	inline: single("display", "inline"),
	flex: single("display", "flex"),
	"inline-flex": single("display", "inline-flex"),
	grid: single("display", "grid"),
	"inline-grid": single("display", "inline-grid"),
	contents: single("display", "contents"),
	hidden: single("display", "none"),
	table: single("display", "table"),
	"inline-table": single("display", "inline-table"),
	"table-row": single("display", "table-row"),
	"table-cell": single("display", "table-cell"),
	"table-caption": single("display", "table-caption"),
	"table-column": single("display", "table-column"),
	"table-column-group": single("display", "table-column-group"),
	"table-footer-group": single("display", "table-footer-group"),
	"table-header-group": single("display", "table-header-group"),
	"table-row-group": single("display", "table-row-group"),
	"flow-root": single("display", "flow-root"),
	"list-item": single("display", "list-item"),

	// Position
	static: single("position", "static"),
	relative: single("position", "relative"),
	absolute: single("position", "absolute"),
	fixed: single("position", "fixed"),
	sticky: single("position", "sticky"),

	// Flex direction
	"flex-row": single("flex-direction", "row"),
	"flex-row-reverse": single("flex-direction", "row-reverse"),
	"flex-col": single("flex-direction", "column"),
	"flex-col-reverse": single("flex-direction", "column-reverse"),

	// Flex wrap
	"flex-wrap": single("flex-wrap", "wrap"),
	"flex-wrap-reverse": single("flex-wrap", "wrap-reverse"),
	"flex-nowrap": single("flex-wrap", "nowrap"),

	// Flex sizing
	// flex-1 is dynamic (flex-<number> → flex: 1); auto/initial/none stay static.
	"flex-auto": single("flex", "auto"),
	"flex-initial": single("flex", "0 auto"),
	"flex-none": single("flex", "none"),

	// Flex grow/shrink
	grow: single("flex-grow", "1"),
	"grow-0": single("flex-grow", "0"),
	shrink: single("flex-shrink", "1"),
	"shrink-0": single("flex-shrink", "0"),

	// Align items
	"items-start": single("align-items", "flex-start"),
	"items-end": single("align-items", "flex-end"),
	"items-end-safe": single("align-items", "safe flex-end"),
	"items-center": single("align-items", "center"),
	"items-center-safe": single("align-items", "safe center"),
	"items-baseline": single("align-items", "baseline"),
	"items-baseline-last": single("align-items", "last baseline"),
	"items-stretch": single("align-items", "stretch"),

	// Justify content
	"justify-normal": single("justify-content", "normal"),
	"justify-start": single("justify-content", "flex-start"),
	"justify-end": single("justify-content", "flex-end"),
	"justify-end-safe": single("justify-content", "safe flex-end"),
	"justify-center": single("justify-content", "center"),
	"justify-center-safe": single("justify-content", "safe center"),
	"justify-between": single("justify-content", "space-between"),
	"justify-around": single("justify-content", "space-around"),
	"justify-evenly": single("justify-content", "space-evenly"),
	"justify-stretch": single("justify-content", "stretch"),
	"justify-baseline": single("justify-content", "baseline"),

	// Justify items
	"justify-items-normal": single("justify-items", "normal"),
	"justify-items-start": single("justify-items", "start"),
	"justify-items-end": single("justify-items", "end"),
	"justify-items-end-safe": single("justify-items", "safe end"),
	"justify-items-center": single("justify-items", "center"),
	"justify-items-center-safe": single("justify-items", "safe center"),
	"justify-items-stretch": single("justify-items", "stretch"),

	// Align content
	"content-normal": single("align-content", "normal"),
	"content-start": single("align-content", "flex-start"),
	"content-end": single("align-content", "flex-end"),
	"content-end-safe": single("align-content", "safe flex-end"),
	"content-center": single("align-content", "center"),
	"content-center-safe": single("align-content", "safe center"),
	"content-between": single("align-content", "space-between"),
	"content-around": single("align-content", "space-around"),
	"content-evenly": single("align-content", "space-evenly"),
	"content-baseline": single("align-content", "baseline"),
	"content-stretch": single("align-content", "stretch"),

	// Align self
	"self-auto": single("align-self", "auto"),
	"self-start": single("align-self", "flex-start"),
	"self-end": single("align-self", "flex-end"),
	"self-end-safe": single("align-self", "safe flex-end"),
	"self-center": single("align-self", "center"),
	"self-center-safe": single("align-self", "safe center"),
	"self-stretch": single("align-self", "stretch"),
	"self-baseline": single("align-self", "baseline"),
	"self-baseline-last": single("align-self", "last baseline"),

	// Justify self
	"justify-self-auto": single("justify-self", "auto"),
	"justify-self-start": single("justify-self", "start"),
	"justify-self-end": single("justify-self", "end"),
	"justify-self-end-safe": single("justify-self", "safe end"),
	"justify-self-center": single("justify-self", "center"),
	"justify-self-center-safe": single("justify-self", "safe center"),
	"justify-self-stretch": single("justify-self", "stretch"),

	// Place content (shorthand for align-content + justify-content)
	"place-content-normal": single("place-content", "normal"),
	"place-content-start": single("place-content", "start"),
	"place-content-end": single("place-content", "end"),
	"place-content-end-safe": single("place-content", "safe end"),
	"place-content-center": single("place-content", "center"),
	"place-content-center-safe": single("place-content", "safe center"),
	"place-content-between": single("place-content", "space-between"),
	"place-content-around": single("place-content", "space-around"),
	"place-content-evenly": single("place-content", "space-evenly"),
	"place-content-baseline": single("place-content", "baseline"),
	"place-content-stretch": single("place-content", "stretch"),

	// Place items (shorthand for align-items + justify-items)
	"place-items-start": single("place-items", "start"),
	"place-items-end": single("place-items", "end"),
	"place-items-end-safe": single("place-items", "safe end"),
	"place-items-center": single("place-items", "center"),
	"place-items-center-safe": single("place-items", "safe center"),
	"place-items-baseline": single("place-items", "baseline"),
	"place-items-stretch": single("place-items", "stretch"),

	// Place self (shorthand for align-self + justify-self)
	"place-self-auto": single("place-self", "auto"),
	"place-self-start": single("place-self", "start"),
	"place-self-end": single("place-self", "end"),
	"place-self-end-safe": single("place-self", "safe end"),
	"place-self-center": single("place-self", "center"),
	"place-self-center-safe": single("place-self", "safe center"),
	"place-self-stretch": single("place-self", "stretch"),

	// Overflow
	"overflow-auto": single("overflow", "auto"),
	"overflow-hidden": single("overflow", "hidden"),
	"overflow-clip": single("overflow", "clip"),
	"overflow-visible": single("overflow", "visible"),
	"overflow-scroll": single("overflow", "scroll"),
	"overflow-x-auto": single("overflow-x", "auto"),
	"overflow-x-hidden": single("overflow-x", "hidden"),
	"overflow-x-clip": single("overflow-x", "clip"),
	"overflow-x-visible": single("overflow-x", "visible"),
	"overflow-x-scroll": single("overflow-x", "scroll"),
	"overflow-y-auto": single("overflow-y", "auto"),
	"overflow-y-hidden": single("overflow-y", "hidden"),
	"overflow-y-clip": single("overflow-y", "clip"),
	"overflow-y-visible": single("overflow-y", "visible"),
	"overflow-y-scroll": single("overflow-y", "scroll"),

	// Overscroll behavior
	"overscroll-auto": single("overscroll-behavior", "auto"),
	"overscroll-contain": single("overscroll-behavior", "contain"),
	"overscroll-none": single("overscroll-behavior", "none"),
	"overscroll-x-auto": single("overscroll-behavior-x", "auto"),
	"overscroll-x-contain": single("overscroll-behavior-x", "contain"),
	"overscroll-x-none": single("overscroll-behavior-x", "none"),
	"overscroll-y-auto": single("overscroll-behavior-y", "auto"),
	"overscroll-y-contain": single("overscroll-behavior-y", "contain"),
	"overscroll-y-none": single("overscroll-behavior-y", "none"),

	// Visibility
	visible: single("visibility", "visible"),
	invisible: single("visibility", "hidden"),
	collapse: single("visibility", "collapse"),

	// Border collapse (table layout)
	"border-collapse": single("border-collapse", "collapse"),
	"border-separate": single("border-collapse", "separate"),

	// Isolation
	isolate: single("isolation", "isolate"),
	"isolation-auto": single("isolation", "auto"),

	// Float
	"float-right": single("float", "right"),
	"float-left": single("float", "left"),
	"float-start": single("float", "inline-start"),
	"float-end": single("float", "inline-end"),
	"float-none": single("float", "none"),
	clear: single("clear", "both"),
	"clear-left": single("clear", "left"),
	"clear-right": single("clear", "right"),
	"clear-both": single("clear", "both"),
	"clear-start": single("clear", "inline-start"),
	"clear-end": single("clear", "inline-end"),
	"clear-none": single("clear", "none"),

	// Box sizing
	"box-border": single("box-sizing", "border-box"),
	"box-content": single("box-sizing", "content-box"),

	// Box decoration
	"box-decoration-clone": multi(
		["-webkit-box-decoration-break", "clone"],
		["box-decoration-break", "clone"],
	),
	"box-decoration-slice": multi(
		["-webkit-box-decoration-break", "slice"],
		["box-decoration-break", "slice"],
	),

	// Table layout
	"table-auto": single("table-layout", "auto"),
	"table-fixed": single("table-layout", "fixed"),

	// Caption side
	"caption-top": single("caption-side", "top"),
	"caption-bottom": single("caption-side", "bottom"),

	// Field sizing
	"field-sizing-content": single("field-sizing", "content"),
	"field-sizing-fixed": single("field-sizing", "fixed"),

	// Flex basis (static)
	"basis-auto": single("flex-basis", "auto"),
	"basis-full": single("flex-basis", "100%"),

	// Aspect ratio
	"aspect-auto": single("aspect-ratio", "auto"),
	"aspect-square": single("aspect-ratio", "1 / 1"),
	"aspect-video": single("aspect-ratio", "16 / 9"),

	// Object fit
	"object-contain": single("object-fit", "contain"),
	"object-cover": single("object-fit", "cover"),
	"object-fill": single("object-fit", "fill"),
	"object-none": single("object-fit", "none"),
	"object-scale-down": single("object-fit", "scale-down"),

	// Object position (v4 corner naming: top/bottom precede left/right)
	"object-top-left": single("object-position", "top left"),
	"object-top": single("object-position", "top"),
	"object-top-right": single("object-position", "top right"),
	"object-left": single("object-position", "left"),
	"object-center": single("object-position", "center"),
	"object-right": single("object-position", "right"),
	"object-bottom-left": single("object-position", "bottom left"),
	"object-bottom": single("object-position", "bottom"),
	"object-bottom-right": single("object-position", "bottom right"),

	// Interactivity
	"cursor-auto": single("cursor", "auto"),
	"cursor-default": single("cursor", "default"),
	"cursor-pointer": single("cursor", "pointer"),
	"cursor-wait": single("cursor", "wait"),
	"cursor-text": single("cursor", "text"),
	"cursor-move": single("cursor", "move"),
	"cursor-help": single("cursor", "help"),
	"cursor-not-allowed": single("cursor", "not-allowed"),
	"cursor-none": single("cursor", "none"),
	"cursor-grab": single("cursor", "grab"),
	"cursor-grabbing": single("cursor", "grabbing"),
	"cursor-crosshair": single("cursor", "crosshair"),
	"cursor-context-menu": single("cursor", "context-menu"),
	"cursor-cell": single("cursor", "cell"),
	"cursor-vertical-text": single("cursor", "vertical-text"),
	"cursor-alias": single("cursor", "alias"),
	"cursor-copy": single("cursor", "copy"),
	"cursor-no-drop": single("cursor", "no-drop"),
	"cursor-progress": single("cursor", "progress"),
	"cursor-all-scroll": single("cursor", "all-scroll"),
	"cursor-col-resize": single("cursor", "col-resize"),
	"cursor-row-resize": single("cursor", "row-resize"),
	"cursor-n-resize": single("cursor", "n-resize"),
	"cursor-e-resize": single("cursor", "e-resize"),
	"cursor-s-resize": single("cursor", "s-resize"),
	"cursor-w-resize": single("cursor", "w-resize"),
	"cursor-ne-resize": single("cursor", "ne-resize"),
	"cursor-nw-resize": single("cursor", "nw-resize"),
	"cursor-se-resize": single("cursor", "se-resize"),
	"cursor-sw-resize": single("cursor", "sw-resize"),
	"cursor-ew-resize": single("cursor", "ew-resize"),
	"cursor-ns-resize": single("cursor", "ns-resize"),
	"cursor-nesw-resize": single("cursor", "nesw-resize"),
	"cursor-nwse-resize": single("cursor", "nwse-resize"),
	"cursor-zoom-in": single("cursor", "zoom-in"),
	"cursor-zoom-out": single("cursor", "zoom-out"),

	// Pointer events
	"pointer-events-none": single("pointer-events", "none"),
	"pointer-events-auto": single("pointer-events", "auto"),

	// User select
	"select-none": single("user-select", "none"),
	"select-text": single("user-select", "text"),
	"select-all": single("user-select", "all"),
	"select-auto": single("user-select", "auto"),

	// Touch action
	"touch-auto": single("touch-action", "auto"),
	"touch-none": single("touch-action", "none"),
	"touch-manipulation": single("touch-action", "manipulation"),
	"touch-pan-x": single("touch-action", "pan-x"),
	"touch-pan-left": single("touch-action", "pan-left"),
	"touch-pan-right": single("touch-action", "pan-right"),
	"touch-pan-y": single("touch-action", "pan-y"),
	"touch-pan-up": single("touch-action", "pan-up"),
	"touch-pan-down": single("touch-action", "pan-down"),
	"touch-pinch-zoom": single("touch-action", "pinch-zoom"),

	// Accent color
	"accent-auto": single("accent-color", "auto"),

	// Caret color
	"caret-transparent": single("caret-color", "transparent"),
	"caret-current": single("caret-color", "currentColor"),
	"caret-inherit": single("caret-color", "inherit"),

	// Forced color adjust
	"forced-color-adjust-auto": single("forced-color-adjust", "auto"),
	"forced-color-adjust-none": single("forced-color-adjust", "none"),

	// Color scheme
	"scheme-normal": single("color-scheme", "normal"),
	"scheme-dark": single("color-scheme", "dark"),
	"scheme-light": single("color-scheme", "light"),
	"scheme-light-dark": single("color-scheme", "light dark"),
	"scheme-only-dark": single("color-scheme", "only dark"),
	"scheme-only-light": single("color-scheme", "only light"),

	// Backface visibility
	"backface-hidden": single("backface-visibility", "hidden"),
	"backface-visible": single("backface-visibility", "visible"),

	// Scroll snap type
	"snap-none": single("scroll-snap-type", "none"),
	"snap-x": single("scroll-snap-type", "x var(--ri-snap-strictness, proximity)"),
	"snap-y": single("scroll-snap-type", "y var(--ri-snap-strictness, proximity)"),
	"snap-both": single("scroll-snap-type", "both var(--ri-snap-strictness, proximity)"),
	"snap-mandatory": single("--ri-snap-strictness", "mandatory"),
	"snap-proximity": single("--ri-snap-strictness", "proximity"),

	// Scroll snap align
	"snap-align-none": single("scroll-snap-align", "none"),
	"snap-start": single("scroll-snap-align", "start"),
	"snap-center": single("scroll-snap-align", "center"),
	"snap-end": single("scroll-snap-align", "end"),

	// Scroll snap stop
	"snap-normal": single("scroll-snap-stop", "normal"),
	"snap-always": single("scroll-snap-stop", "always"),

	// Contain
	"contain-none": single("contain", "none"),
	"contain-content": single("contain", "content"),
	"contain-strict": single("contain", "strict"),
	"contain-size": single("contain", "size"),
	"contain-inline-size": single("contain", "inline-size"),
	"contain-layout": single("contain", "layout"),
	"contain-paint": single("contain", "paint"),
	"contain-style": single("contain", "style"),

	// Scroll behavior
	"scroll-auto": single("scroll-behavior", "auto"),
	"scroll-smooth": single("scroll-behavior", "smooth"),

	// Scrollbar width
	"scrollbar-auto": single("scrollbar-width", "auto"),
	"scrollbar-thin": single("scrollbar-width", "thin"),
	"scrollbar-none": single("scrollbar-width", "none"),

	// Scrollbar gutter
	"scrollbar-gutter-auto": single("scrollbar-gutter", "auto"),
	"scrollbar-gutter-stable": single("scrollbar-gutter", "stable"),
	"scrollbar-gutter-both": single("scrollbar-gutter", "stable both-edges"),

	// Resize
	"resize-none": single("resize", "none"),
	"resize-x": single("resize", "horizontal"),
	"resize-y": single("resize", "vertical"),
	resize: single("resize", "both"),

	// Appearance
	"appearance-none": single("appearance", "none"),
	"appearance-auto": single("appearance", "auto"),

	// Will change
	"will-change-auto": single("will-change", "auto"),
	"will-change-scroll": single("will-change", "scroll-position"),
	"will-change-contents": single("will-change", "contents"),
	"will-change-transform": single("will-change", "transform"),

	// Screen reader only
	"sr-only": multi(
		["position", "absolute"],
		["width", "1px"],
		["height", "1px"],
		["padding", "0"],
		["margin", "-1px"],
		["overflow", "hidden"],
		["clip-path", "inset(50%)"],
		["white-space", "nowrap"],
		["border-width", "0"],
	),
	"not-sr-only": multi(
		["position", "static"],
		["width", "auto"],
		["height", "auto"],
		["padding", "0"],
		["margin", "0"],
		["overflow", "visible"],
		["clip-path", "none"],
		["white-space", "normal"],
		// border-width:0 isn't in the spec, but it makes not-sr-only cover every
		// property sr-only sets so `ri("sr-only not-sr-only")` fully reverts.
		["border-width", "0"],
	),

	// Container queries
	"@container": single("container-type", "inline-size"),
	"@container-normal": single("container-type", "normal"),

	// Anchor positioning — static position-area keywords
	"position-area-top": single("position-area", "top"),
	"position-area-bottom": single("position-area", "bottom"),
	"position-area-left": single("position-area", "left"),
	"position-area-right": single("position-area", "right"),
	"position-area-center": single("position-area", "center"),
	"position-area-start": single("position-area", "start"),
	"position-area-end": single("position-area", "end"),
	"position-area-self-start": single("position-area", "self-start"),
	"position-area-self-end": single("position-area", "self-end"),
	"position-area-top-left": single("position-area", "top left"),
	"position-area-top-center": single("position-area", "top center"),
	"position-area-top-right": single("position-area", "top right"),
	"position-area-bottom-left": single("position-area", "bottom left"),
	"position-area-bottom-center": single("position-area", "bottom center"),
	"position-area-bottom-right": single("position-area", "bottom right"),
	"position-area-center-left": single("position-area", "center left"),
	"position-area-center-right": single("position-area", "center right"),
	"position-area-top-span-all": single("position-area", "top span-all"),
	"position-area-bottom-span-all": single("position-area", "bottom span-all"),
	"position-area-left-span-all": single("position-area", "left span-all"),
	"position-area-right-span-all": single("position-area", "right span-all"),
	"position-area-span-all": single("position-area", "span-all"),

	// Anchor scope
	"anchor-scope-all": single("anchor-scope", "all"),
	"anchor-scope-none": single("anchor-scope", "none"),
};
deepFreezeUtilityMap(STATIC_LAYOUT);
// Key list export for editor enumeration — the map itself stays private.
export const LAYOUT_STATIC_NAMES: readonly string[] = Object.freeze(Object.keys(STATIC_LAYOUT));

// Auto track values (shared by auto-cols and auto-rows)
const AUTO_TRACK_MAP: Readonly<Record<string, string>> = Object.freeze({
	auto: "auto",
	min: "min-content",
	max: "max-content",
	fr: "minmax(0, 1fr)",
});

function resolveAutoTrack(name: string): string | null {
	if (Object.hasOwn(AUTO_TRACK_MAP, name)) return AUTO_TRACK_MAP[name];
	return extractArbitrary(name);
}

// Grid flow values (hoisted to avoid per-call allocation)
const GRID_FLOW_MAP: Readonly<Record<string, string>> = Object.freeze({
	row: "row",
	col: "column",
	dense: "dense",
	"row-dense": "row dense",
	"col-dense": "column dense",
});

// Break-before/after/inside values
const BREAK_VALUES = new Set([
	"auto",
	"avoid",
	"all",
	"avoid-page",
	"page",
	"left",
	"right",
	"column",
]);
const BREAK_INSIDE_VALUES = new Set(["auto", "avoid", "avoid-page", "avoid-column"]);

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

type LayoutResolver = (
	full: string,
	negative: boolean,
	theme: ResolvedTheme,
) => UtilityResult | null;

// z-{n}: z-index
function resolveZIndex(
	full: string,
	negative: boolean,
	theme: ResolvedTheme,
): UtilityResult | null {
	const name = full.slice(2);
	// Named tokens from @z take precedence (so a user could override `auto`).
	if (Object.hasOwn(theme.z, name))
		return single("z-index", negative ? `calc(${theme.z[name]} * -1)` : theme.z[name]);
	// `auto` is a fixed keyword (not negatable, not a theme default).
	if (name === "auto") return single("z-index", "auto");
	const arb = extractArbitrary(name);
	if (arb !== null) return single("z-index", negative ? `calc(${arb} * -1)` : arb);
	if (INTEGER_RE.test(name)) return single("z-index", negative ? `-${name}` : name);
	return null;
}

function resolveOrder(full: string, negative: boolean): UtilityResult | null {
	const name = full.slice(6);
	if (name === "first") return single("order", "-9999");
	if (name === "last") return single("order", "9999");
	if (name === "none") return single("order", "0");
	if (INTEGER_RE.test(name)) return single("order", negative ? `-${name}` : name);
	const arb = extractArbitrary(name);
	if (arb !== null) return single("order", negative ? `calc(${arb} * -1)` : arb);
	return null;
}

// grid-cols-{n} | grid-rows-{n} | grid-flow-{v}
function resolveGridFamily(full: string): UtilityResult | null {
	if (full.startsWith("grid-cols-")) {
		const r = resolveGridTemplate(full.slice(10), "grid-template-columns");
		if (r) return r;
	}
	if (full.startsWith("grid-rows-")) {
		const r = resolveGridTemplate(full.slice(10), "grid-template-rows");
		if (r) return r;
	}
	if (full.startsWith("grid-flow-")) {
		const name = full.slice(10);
		if (Object.hasOwn(GRID_FLOW_MAP, name)) return single("grid-auto-flow", GRID_FLOW_MAP[name]);
	}
	return null;
}

// col-span- | col-start- | col-end- | col-{line}
function resolveColFamily(full: string, negative: boolean): UtilityResult | null {
	if (full.startsWith("col-span-")) {
		const r = resolveGridSpan(full.slice(9), "grid-column");
		if (r) return r;
	}
	if (full.startsWith("col-start-")) {
		const v = resolveGridLine(full.slice(10), negative);
		if (v !== null) return single("grid-column-start", v);
	}
	if (full.startsWith("col-end-")) {
		const v = resolveGridLine(full.slice(8), negative);
		if (v !== null) return single("grid-column-end", v);
	}
	// col-{n} | col-auto | -col-{n} | col-(--v) | col-[v] (span/start/end handled above)
	const v = resolveGridLine(full.slice(4), negative);
	if (v !== null) return single("grid-column", v);
	return null;
}

// row-span- | row-start- | row-end- | row-{line}
function resolveRowFamily(full: string, negative: boolean): UtilityResult | null {
	if (full.startsWith("row-span-")) {
		const r = resolveGridSpan(full.slice(9), "grid-row");
		if (r) return r;
	}
	if (full.startsWith("row-start-")) {
		const v = resolveGridLine(full.slice(10), negative);
		if (v !== null) return single("grid-row-start", v);
	}
	if (full.startsWith("row-end-")) {
		const v = resolveGridLine(full.slice(8), negative);
		if (v !== null) return single("grid-row-end", v);
	}
	const v = resolveGridLine(full.slice(4), negative);
	if (v !== null) return single("grid-row", v);
	return null;
}

// auto-cols-{v}, auto-rows-{v}
function resolveAutoFamily(full: string): UtilityResult | null {
	if (full.startsWith("auto-cols-")) {
		const val = resolveAutoTrack(full.slice(10));
		if (val) return single("grid-auto-columns", val);
	}
	if (full.startsWith("auto-rows-")) {
		const val = resolveAutoTrack(full.slice(10));
		if (val) return single("grid-auto-rows", val);
	}
	return null;
}

// columns-{n} | columns-auto | columns-{container-scale} | columns-[v] | columns-(--var)
function resolveColumns(full: string): UtilityResult | null {
	const name = full.slice(8);
	if (name === "auto") return single("columns", "auto");
	if (INTEGER_RE.test(name)) return single("columns", name);
	if (Object.hasOwn(CONTAINER_SCALE, name)) return single("columns", CONTAINER_SCALE[name]);
	const arb = extractArbitrary(name);
	if (arb) return single("columns", arb);
	return null;
}

// aspect-[{v}] / aspect-(--var) (both arrive bracketed) / aspect-{n}/{m}
function resolveAspect(full: string): UtilityResult | null {
	const val = full.slice(7);
	const arb = extractArbitrary(val);
	if (arb) return single("aspect-ratio", arb);
	// Bare ratio: aspect-16/9 → aspect-ratio: 16 / 9
	const ratio = ASPECT_RATIO_RE.exec(val);
	if (ratio) return single("aspect-ratio", `${ratio[1]} / ${ratio[2]}`);
	return null;
}

// object-[{v}] / object-(--var) → object-position (statics own object-fit + keywords)
function resolveObjectPosition(full: string): UtilityResult | null {
	const arb = extractArbitrary(full.slice(7));
	return arb !== null ? single("object-position", arb) : null;
}

// cursor-[url(...)] or cursor-[arbitrary]
function resolveCursor(full: string): UtilityResult | null {
	const arb = extractArbitrary(full.slice(7));
	return arb !== null ? single("cursor", arb) : null;
}

// basis-{n}, basis-{fraction}, basis-[arbitrary]
function resolveBasis(full: string): UtilityResult | null {
	const name = full.slice(6);
	const arb = extractArbitrary(name);
	if (arb !== null) return single("flex-basis", arb);
	const pct = fractionToPercent(name);
	if (pct !== null) return single("flex-basis", pct);
	if (DECIMAL_RE.test(name)) {
		const sp = spacingLookup(name, false);
		if (sp) return single("flex-basis", sp);
	}
	return null;
}

// flex-{number} | flex-{fraction} | flex-(--v) | flex-[v]  (auto/initial/none are statics)
function resolveFlex(full: string): UtilityResult | null {
	const name = full.slice(5);
	const arb = extractArbitrary(name);
	if (arb !== null) return single("flex", arb);
	const pct = fractionToPercent(name);
	if (pct !== null) return single("flex", pct);
	if (DECIMAL_RE.test(name)) return single("flex", normalizeDecimalToken(name));
	return null;
}

// grow-{number} | grow-[v] | grow-(--v)  (bare grow / grow-0 are statics)
function resolveGrow(full: string): UtilityResult | null {
	const name = full.slice(5);
	const arb = extractArbitrary(name);
	if (arb !== null) return single("flex-grow", arb);
	if (DECIMAL_RE.test(name)) return single("flex-grow", normalizeDecimalToken(name));
	return null;
}

// shrink-{number} | shrink-[v] | shrink-(--v)  (bare shrink / shrink-0 are statics)
function resolveShrink(full: string): UtilityResult | null {
	const name = full.slice(7);
	const arb = extractArbitrary(name);
	if (arb !== null) return single("flex-shrink", arb);
	if (DECIMAL_RE.test(name)) return single("flex-shrink", normalizeDecimalToken(name));
	return null;
}

// break-before-{v}, break-after-{v}, break-inside-{v}
function resolveBreak(full: string): UtilityResult | null {
	if (full.startsWith("break-before-")) {
		const name = full.slice(13);
		if (BREAK_VALUES.has(name)) return single("break-before", name);
	}
	if (full.startsWith("break-after-")) {
		const name = full.slice(12);
		if (BREAK_VALUES.has(name)) return single("break-after", name);
	}
	if (full.startsWith("break-inside-")) {
		const name = full.slice(13);
		if (BREAK_INSIDE_VALUES.has(name)) return single("break-inside", name);
	}
	return null;
}

// position-area-[arbitrary]
function resolvePositionArea(full: string): UtilityResult | null {
	if (!full.startsWith("position-area-")) return null;
	const arb = extractArbitrary(full.slice(14));
	return arb ? single("position-area", arb) : null;
}

// anchor-scope-{name} — scope anchor visibility
function resolveAnchorScope(full: string): UtilityResult | null {
	if (!full.startsWith("anchor-scope-")) return null;
	const name = full.slice(13);
	const arb = extractArbitrary(name);
	if (arb) return single("anchor-scope", arb);
	if (CSS_CUSTOM_IDENT_RE.test(name)) {
		return single("anchor-scope", `--${name}`);
	}
	return null;
}

// border-spacing — composable x/y via --ri-border-spacing-{x,y}; the bare form
// sets both axes. Reuses spacingLookup (calc(n * var(--spacing)), px, 0).
function resolveBorderSpacing(full: string): UtilityResult | null {
	if (!full.startsWith("border-spacing-")) return null;
	const composed: [string, string] = [
		"border-spacing",
		"var(--ri-border-spacing-x, 0) var(--ri-border-spacing-y, 0)",
	];
	if (full.startsWith("border-spacing-x-")) {
		const v = borderSpacingValue(full.slice(17));
		return v === null ? null : multi(["--ri-border-spacing-x", v], composed);
	}
	if (full.startsWith("border-spacing-y-")) {
		const v = borderSpacingValue(full.slice(17));
		return v === null ? null : multi(["--ri-border-spacing-y", v], composed);
	}
	const v = borderSpacingValue(full.slice(15));
	return v === null
		? null
		: multi(["--ri-border-spacing-x", v], ["--ri-border-spacing-y", v], composed);
}

// scrollbar-thumb / scrollbar-track color — composable scrollbar-color
// (both prefixes are 16 chars; each sets its slot var + the shared shorthand).
function resolveScrollbarColor(
	full: string,
	_negative: boolean,
	theme: ResolvedTheme,
): UtilityResult | null {
	const isThumb = full.startsWith("scrollbar-thumb-");
	if (!isThumb && !full.startsWith("scrollbar-track-")) return null;
	const color = resolveColor(full.slice(16), theme);
	if (color === null) return null;
	// Fallbacks keep the declaration valid when only one slot is set; both must
	// be colors — `auto` is invalid in the two-value scrollbar-color form.
	const composed: [string, string] = [
		"scrollbar-color",
		"var(--ri-scrollbar-thumb, currentColor) var(--ri-scrollbar-track, transparent)",
	];
	return isThumb
		? multi(["--ri-scrollbar-thumb", color], composed)
		: multi(["--ri-scrollbar-track", color], composed);
}

/**
 * First-segment dispatch (replacing the former ~35-probe startsWith chain;
 * same shape as EFFECTS_PREFIX_DISPATCH in effects.ts). The `@`-prefixed
 * container/anchor forms use `/` separators, so layoutGenerator checks them
 * directly before consulting this table.
 */
const LAYOUT_PREFIX_DISPATCH: ReadonlyMap<string, LayoutResolver> = new Map<string, LayoutResolver>(
	[
		["z", resolveZIndex],
		["order", (full, negative) => resolveOrder(full, negative)],
		["grid", (full) => resolveGridFamily(full)],
		["col", (full, negative) => resolveColFamily(full, negative)],
		["row", (full, negative) => resolveRowFamily(full, negative)],
		["auto", (full) => resolveAutoFamily(full)],
		["columns", (full) => resolveColumns(full)],
		["aspect", (full) => resolveAspect(full)],
		["object", (full) => resolveObjectPosition(full)],
		["cursor", (full) => resolveCursor(full)],
		["basis", (full) => resolveBasis(full)],
		["flex", (full) => resolveFlex(full)],
		["grow", (full) => resolveGrow(full)],
		["shrink", (full) => resolveShrink(full)],
		["break", (full) => resolveBreak(full)],
		["position", (full) => resolvePositionArea(full)],
		["anchor", (full) => resolveAnchorScope(full)],
		["border", (full) => resolveBorderSpacing(full)],
		["scrollbar", resolveScrollbarColor],
	],
);

export function layoutGenerator(
	utility: string,
	value: string | null,
	negative: boolean,
	theme: ResolvedTheme,
): UtilityResult | null {
	const full = fullName(utility, value);

	// Static utilities
	if (Object.hasOwn(STATIC_LAYOUT, full)) return STATIC_LAYOUT[full];

	// @container/{name}, @anchor/{name}, @anchor-to/{name} — `/`-separated, so
	// handled outside the dash-segment dispatch. Names are validated against
	// the custom-ident grammar to prevent at-rule injection.
	if (full.charCodeAt(0) === 64 /* '@' */) {
		if (full.startsWith("@container/")) {
			const name = full.slice(11);
			if (CSS_CUSTOM_IDENT_RE.test(name)) {
				return multi(["container-type", "inline-size"], ["container-name", name]);
			}
			return null;
		}
		if (full.startsWith("@anchor/")) {
			const name = full.slice(8);
			const arb = extractArbitrary(name);
			if (arb) return single("anchor-name", arb);
			if (CSS_CUSTOM_IDENT_RE.test(name)) {
				return single("anchor-name", `--${name}`);
			}
			return null;
		}
		if (full.startsWith("@anchor-to/")) {
			const name = full.slice(11);
			const arb = extractArbitrary(name);
			if (arb) return single("position-anchor", arb);
			if (CSS_CUSTOM_IDENT_RE.test(name)) {
				return single("position-anchor", `--${name}`);
			}
			return null;
		}
		return null;
	}

	const dashIdx = full.indexOf("-");
	const seg = dashIdx === -1 ? full : full.slice(0, dashIdx);
	const resolver = LAYOUT_PREFIX_DISPATCH.get(seg);
	if (resolver) return resolver(full, negative, theme);

	return null;
}

function borderSpacingValue(rest: string): string | null {
	const arb = extractArbitrary(rest);
	if (arb !== null) return arb;
	return spacingLookup(rest, false);
}
