import { describe, expect, it, test } from "vitest";
import { resolveUtility } from "../../../src/utilities/index.js";
import { resolveDirectives } from "../../../src/directives/index.js";

const theme = resolveDirectives([]);

describe("layout utilities", () => {
	it("flex → display: flex", () => {
		const r = resolveUtility("flex", null, false, theme);
		expect(r!.declarations[0].value).toBe("flex");
	});

	it("grid → display: grid", () => {
		const r = resolveUtility("grid", null, false, theme);
		expect(r!.declarations[0].value).toBe("grid");
	});

	it("hidden → display: none", () => {
		const r = resolveUtility("hidden", null, false, theme);
		expect(r!.declarations[0].value).toBe("none");
	});

	it("block → display: block", () => {
		const r = resolveUtility("block", null, false, theme);
		expect(r!.declarations[0].value).toBe("block");
	});

	it("inline-flex → display: inline-flex", () => {
		const r = resolveUtility("inline-flex", null, false, theme);
		expect(r!.declarations[0].value).toBe("inline-flex");
	});

	it("relative → position: relative", () => {
		const r = resolveUtility("relative", null, false, theme);
		expect(r!.declarations[0].value).toBe("relative");
	});

	it("absolute → position: absolute", () => {
		const r = resolveUtility("absolute", null, false, theme);
		expect(r!.declarations[0].value).toBe("absolute");
	});

	it("sticky → position: sticky", () => {
		const r = resolveUtility("sticky", null, false, theme);
		expect(r!.declarations[0].value).toBe("sticky");
	});

	it("items-center → align-items: center", () => {
		const r = resolveUtility("items-center", null, false, theme);
		expect(r!.declarations[0].value).toBe("center");
	});

	it("justify-between → justify-content: space-between", () => {
		const r = resolveUtility("justify-between", null, false, theme);
		expect(r!.declarations[0].value).toBe("space-between");
	});

	it.each([
		["flex-1", "flex", "1"],
		["flex-3", "flex", "3"],
		["flex-1/2", "flex", "50%"],
		["flex-auto", "flex", "auto"],
		["flex-initial", "flex", "0 auto"],
		["flex-none", "flex", "none"],
		["flex-[var(--f)]", "flex", "var(--f)"],
		["flex-[2_2_0%]", "flex", "2 2 0%"],
		["grow-3", "flex-grow", "3"],
		["grow-[2]", "flex-grow", "2"],
		["shrink-3", "flex-shrink", "3"],
		["col-3", "grid-column", "3"],
		["col-auto", "grid-column", "auto"],
		["col-span-[var(--s)]", "grid-column", "span var(--s) / span var(--s)"],
		["col-start-[var(--s)]", "grid-column-start", "var(--s)"],
		["row-3", "grid-row", "3"],
		["row-auto", "grid-row", "auto"],
		["row-span-[2]", "grid-row", "span 2 / span 2"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	it("negative grid lines use calc(N * -1)", () => {
		expect(resolveUtility("col-start-3", null, true, theme)!.declarations[0]).toEqual({
			property: "grid-column-start",
			value: "calc(3 * -1)",
		});
		expect(resolveUtility("row-3", null, true, theme)!.declarations[0]).toEqual({
			property: "grid-row",
			value: "calc(3 * -1)",
		});
	});

	it("shrink-0 → flex-shrink: 0", () => {
		const r = resolveUtility("shrink-0", null, false, theme);
		expect(r!.declarations[0].value).toBe("0");
	});

	it("grow → flex-grow: 1", () => {
		const r = resolveUtility("grow", null, false, theme);
		expect(r!.declarations[0].value).toBe("1");
	});

	it("grid-cols-3 → repeat(3, minmax(0, 1fr))", () => {
		const r = resolveUtility("grid-cols-3", null, false, theme);
		expect(r!.declarations[0].value).toBe("repeat(3, minmax(0, 1fr))");
	});

	it("col-span-2 → grid-column: span 2 / span 2", () => {
		const r = resolveUtility("col-span-2", null, false, theme);
		expect(r!.declarations[0].value).toBe("span 2 / span 2");
	});

	it("overflow-hidden → overflow: hidden", () => {
		const r = resolveUtility("overflow-hidden", null, false, theme);
		expect(r!.declarations[0].value).toBe("hidden");
	});

	it("z-10 → z-index: 10", () => {
		const r = resolveUtility("z-10", null, false, theme);
		expect(r!.declarations[0].value).toBe("10");
	});

	it("sr-only → screen reader styles (clip-path)", () => {
		const r = resolveUtility("sr-only", null, false, theme);
		expect(r!.declarations.length).toBeGreaterThan(5);
		expect(r!.declarations).toContainEqual({ property: "clip-path", value: "inset(50%)" });
	});

	it("not-sr-only → undoes sr-only (clip-path: none)", () => {
		const r = resolveUtility("not-sr-only", null, false, theme);
		expect(r!.declarations).toContainEqual({ property: "clip-path", value: "none" });
		expect(r!.declarations).toContainEqual({ property: "position", value: "static" });
	});

	it("cursor-pointer → cursor: pointer", () => {
		const r = resolveUtility("cursor-pointer", null, false, theme);
		expect(r!.declarations[0].value).toBe("pointer");
	});

	it("select-none → user-select: none", () => {
		const r = resolveUtility("select-none", null, false, theme);
		expect(r!.declarations[0].value).toBe("none");
	});

	it("pointer-events-none → pointer-events: none", () => {
		const r = resolveUtility("pointer-events-none", null, false, theme);
		expect(r!.declarations[0].value).toBe("none");
	});

	it("aspect-video → aspect-ratio: 16 / 9", () => {
		const r = resolveUtility("aspect-video", null, false, theme);
		expect(r!.declarations[0].value).toBe("16 / 9");
	});

	it.each([
		["aspect-16/9", "16 / 9"],
		["aspect-4/3", "4 / 3"],
		["aspect-3/2", "3 / 2"],
	])("%s → aspect-ratio: %s (bare ratio)", (util, value) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "aspect-ratio", value });
	});

	it("aspect-[4/3] / aspect-(--r) → aspect-ratio arbitrary + custom property", () => {
		expect(resolveUtility("aspect-[4/3]", null, false, theme)!.declarations[0]).toEqual({
			property: "aspect-ratio",
			value: "4/3",
		});
		// `aspect-(--r)` is parsed to `[var(--r)]` upstream.
		expect(resolveUtility("aspect-[var(--r)]", null, false, theme)!.declarations[0]).toEqual({
			property: "aspect-ratio",
			value: "var(--r)",
		});
	});

	it("columns-3 → columns: 3", () => {
		const r = resolveUtility("columns-3", null, false, theme);
		expect(r!.declarations[0].value).toBe("3");
	});

	it.each([
		["columns-auto", "auto"],
		["columns-3xs", "16rem"],
		["columns-2xs", "18rem"],
		["columns-xs", "20rem"],
		["columns-md", "28rem"],
		["columns-7xl", "80rem"],
	])("%s → columns: %s", (util, value) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "columns", value });
	});

	it("columns-[3] / columns-(--c) → columns arbitrary + custom property", () => {
		expect(resolveUtility("columns-[3]", null, false, theme)!.declarations[0]).toEqual({
			property: "columns",
			value: "3",
		});
		// `columns-(--c)` is parsed to `[var(--c)]` upstream.
		expect(resolveUtility("columns-[var(--c)]", null, false, theme)!.declarations[0]).toEqual({
			property: "columns",
			value: "var(--c)",
		});
	});

	it("object-cover → object-fit: cover", () => {
		const r = resolveUtility("object-cover", null, false, theme);
		expect(r!.declarations[0].value).toBe("cover");
	});

	it("@container → container-type: inline-size", () => {
		const r = resolveUtility("@container", null, false, theme);
		expect(r!.declarations[0].value).toBe("inline-size");
	});

	test.each([
		["order-first", "order", "-9999"],
		["order-last", "order", "9999"],
		["order-none", "order", "0"],
		["order-7", "order", "7"],
		["col-start-auto", "grid-column-start", "auto"],
		["col-end-4", "grid-column-end", "4"],
		["row-start-2", "grid-row-start", "2"],
		["row-end-auto", "grid-row-end", "auto"],
		["grid-rows-subgrid", "grid-template-rows", "subgrid"],
		["grid-cols-none", "grid-template-columns", "none"],
		["col-span-full", "grid-column", "1 / -1"],
		["row-span-full", "grid-row", "1 / -1"],
		["auto-cols-fr", "grid-auto-columns", "minmax(0, 1fr)"],
		["auto-rows-max", "grid-auto-rows", "max-content"],
		["grid-flow-row-dense", "grid-auto-flow", "row dense"],
		["columns-auto", "columns", "auto"],
		["break-before-page", "break-before", "page"],
		["break-after-left", "break-after", "left"],
		["break-inside-avoid-column", "break-inside", "avoid-column"],
		["@container/sidebar", "container-name", "sidebar"],
	])("%s resolves to %s: %s", (className, property, value) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r).not.toBeNull();
		const decl = r!.declarations.find((d) => d.property === property);
		expect(decl).toBeDefined();
		expect(decl!.value).toBe(value);
	});

	it("supports arbitrary grid template columns", () => {
		const r = resolveUtility("grid-cols-[200px_minmax(0,1fr)]", null, false, theme);
		expect(r!.declarations[0].value).toBe("200px minmax(0,1fr)");
	});

	it("supports arbitrary columns values", () => {
		const r = resolveUtility("columns-[16rem]", null, false, theme);
		expect(r!.declarations[0].value).toBe("16rem");
	});

	it("supports arbitrary aspect ratios", () => {
		const r = resolveUtility("aspect-[4/3]", null, false, theme);
		expect(r!.declarations[0].value).toBe("4/3");
	});

	it("z-auto → z-index: auto (keyword)", () => {
		const r = resolveUtility("z-auto", null, false, theme);
		expect(r!.declarations[0].value).toBe("auto");
	});

	it("supports negative z-index values", () => {
		const r = resolveUtility("z-10", null, true, theme);
		expect(r!.declarations[0].value).toBe("-10");
	});

	it("supports arbitrary z-index values with negation", () => {
		const r = resolveUtility("z-[var(--layer)]", null, true, theme);
		expect(r!.declarations[0].value).toBe("calc(var(--layer) * -1)");
	});

	it("supports arbitrary order values with negation", () => {
		const r = resolveUtility("order-[var(--order)]", null, true, theme);
		expect(r!.declarations[0].value).toBe("calc(var(--order) * -1)");
	});

	it("rejects invalid named containers", () => {
		const r = resolveUtility("@container/1sidebar", null, false, theme);
		expect(r).toBeNull();
	});

	// Box sizing / decoration / table / caption / field-sizing
	it.each([
		["box-border", "box-sizing", "border-box"],
		["box-content", "box-sizing", "content-box"],
		["table-auto", "table-layout", "auto"],
		["table-fixed", "table-layout", "fixed"],
		["caption-top", "caption-side", "top"],
		["caption-bottom", "caption-side", "bottom"],
		["field-sizing-content", "field-sizing", "content"],
		["field-sizing-fixed", "field-sizing", "fixed"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	it("border-spacing — composable x/y + value forms", () => {
		const composed = {
			property: "border-spacing",
			value: "var(--ri-border-spacing-x, 0) var(--ri-border-spacing-y, 0)",
		};
		const both = resolveUtility("border-spacing-2", null, false, theme);
		expect(both!.declarations).toEqual([
			{ property: "--ri-border-spacing-x", value: "calc(2 * var(--spacing))" },
			{ property: "--ri-border-spacing-y", value: "calc(2 * var(--spacing))" },
			composed,
		]);
		const x = resolveUtility("border-spacing-x-2", null, false, theme);
		expect(x!.declarations).toEqual([
			{ property: "--ri-border-spacing-x", value: "calc(2 * var(--spacing))" },
			composed,
		]);
		const y = resolveUtility("border-spacing-y-[3px]", null, false, theme);
		expect(y!.declarations).toEqual([
			{ property: "--ri-border-spacing-y", value: "3px" },
			composed,
		]);
		expect(
			resolveUtility("border-spacing-x-[var(--c)]", null, false, theme)!.declarations[0],
		).toEqual({
			property: "--ri-border-spacing-x",
			value: "var(--c)",
		});
	});

	it.each([
		["box-decoration-clone", "clone"],
		["box-decoration-slice", "slice"],
	])("%s → -webkit-box-decoration-break + box-decoration-break: %s", (util, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations).toEqual([
			{ property: "-webkit-box-decoration-break", value: val },
			{ property: "box-decoration-break", value: val },
		]);
	});

	it.each([
		["float-right", "right"],
		["float-left", "left"],
		["float-start", "inline-start"],
		["float-end", "inline-end"],
		["float-none", "none"],
	])("%s → float: %s", (util, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "float", value: val });
	});

	it.each([
		["clear-left", "left"],
		["clear-right", "right"],
		["clear-both", "both"],
		["clear-start", "inline-start"],
		["clear-end", "inline-end"],
		["clear-none", "none"],
	])("%s → clear: %s", (util, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "clear", value: val });
	});

	it.each([
		["object-contain", "object-fit", "contain"],
		["object-scale-down", "object-fit", "scale-down"],
		["object-top-left", "object-position", "top left"],
		["object-top-right", "object-position", "top right"],
		["object-bottom-left", "object-position", "bottom left"],
		["object-bottom-right", "object-position", "bottom right"],
		["object-center", "object-position", "center"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	it("object-[v] / object-(--p) → object-position; v3 corners removed", () => {
		expect(resolveUtility("object-[center_bottom]", null, false, theme)!.declarations[0]).toEqual({
			property: "object-position",
			value: "center bottom",
		});
		expect(resolveUtility("object-[var(--p)]", null, false, theme)!.declarations[0]).toEqual({
			property: "object-position",
			value: "var(--p)",
		});
		expect(resolveUtility("object-left-top", null, false, theme)).toBeNull();
		expect(resolveUtility("object-right-bottom", null, false, theme)).toBeNull();
	});

	// Basis (functional)
	it("basis-auto → flex-basis: auto", () => {
		const r = resolveUtility("basis", "auto", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "flex-basis", value: "auto" });
	});
	it("basis-full → flex-basis: 100%", () => {
		const r = resolveUtility("basis", "full", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "flex-basis", value: "100%" });
	});
	it("basis-4 → flex-basis from spacing scale", () => {
		const r = resolveUtility("basis", "4", false, theme);
		expect(r!.declarations[0].property).toBe("flex-basis");
		expect(r!.declarations[0].value).toContain("var(--spacing)");
	});
	it("basis-1/2 → flex-basis: 50%", () => {
		const r = resolveUtility("basis", "1/2", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "flex-basis", value: "50%" });
	});

	// Safe alignment variants
	it.each([
		["items-center-safe", "align-items", "safe center"],
		["items-end-safe", "align-items", "safe flex-end"],
		["items-baseline-last", "align-items", "last baseline"],
		["justify-center-safe", "justify-content", "safe center"],
		["justify-end-safe", "justify-content", "safe flex-end"],
		["justify-normal", "justify-content", "normal"],
		["justify-baseline", "justify-content", "baseline"],
		["content-center-safe", "align-content", "safe center"],
		["content-normal", "align-content", "normal"],
		["self-center-safe", "align-self", "safe center"],
		["self-baseline-last", "align-self", "last baseline"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	// Place shorthands
	it.each([
		["place-content-center", "place-content", "center"],
		["place-items-center", "place-items", "center"],
		["place-self-center", "place-self", "center"],
		["place-content-center-safe", "place-content", "safe center"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	// Interactivity new additions
	it.each([
		["touch-pan-x", "touch-action", "pan-x"],
		["touch-pinch-zoom", "touch-action", "pinch-zoom"],
		["accent-auto", "accent-color", "auto"],
		["caret-transparent", "caret-color", "transparent"],
		["forced-color-adjust-auto", "forced-color-adjust", "auto"],
		["forced-color-adjust-none", "forced-color-adjust", "none"],
		["scheme-dark", "color-scheme", "dark"],
		["scheme-light-dark", "color-scheme", "light dark"],
		["scheme-only-light", "color-scheme", "only light"],
		["backface-hidden", "backface-visibility", "hidden"],
		["backface-visible", "backface-visibility", "visible"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	// Scrollbar width + gutter
	it.each([
		["scrollbar-auto", "scrollbar-width", "auto"],
		["scrollbar-thin", "scrollbar-width", "thin"],
		["scrollbar-none", "scrollbar-width", "none"],
		["scrollbar-gutter-auto", "scrollbar-gutter", "auto"],
		["scrollbar-gutter-stable", "scrollbar-gutter", "stable"],
		["scrollbar-gutter-both", "scrollbar-gutter", "stable both-edges"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	it("scrollbar-thumb/track — composable scrollbar-color", () => {
		// Fallbacks keep the shorthand valid when only one slot var is set.
		const composed = {
			property: "scrollbar-color",
			value: "var(--ri-scrollbar-thumb, currentColor) var(--ri-scrollbar-track, transparent)",
		};
		const thumb = resolveUtility("scrollbar-thumb-[#f00]", null, false, theme);
		expect(thumb!.declarations).toEqual([
			{ property: "--ri-scrollbar-thumb", value: "#f00" },
			composed,
		]);
		const track = resolveUtility("scrollbar-track-transparent", null, false, theme);
		expect(track!.declarations).toEqual([
			{ property: "--ri-scrollbar-track", value: "transparent" },
			composed,
		]);
	});

	// Scroll snap
	it.each([
		["snap-none", "scroll-snap-type", "none"],
		["snap-align-none", "scroll-snap-align", "none"],
		["snap-start", "scroll-snap-align", "start"],
		["snap-center", "scroll-snap-align", "center"],
		["snap-end", "scroll-snap-align", "end"],
		["snap-always", "scroll-snap-stop", "always"],
		["snap-normal", "scroll-snap-stop", "normal"],
		["snap-mandatory", "--ri-snap-strictness", "mandatory"],
		["snap-proximity", "--ri-snap-strictness", "proximity"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	it("snap-x includes snap-type with strictness variable", () => {
		const r = resolveUtility("snap-x", null, false, theme);
		expect(r!.declarations[0].property).toBe("scroll-snap-type");
		expect(r!.declarations[0].value).toContain("x");
		expect(r!.declarations[0].value).toContain("--ri-snap-strictness");
	});

	// Containment
	it.each([
		["contain-none", "contain", "none"],
		["contain-content", "contain", "content"],
		["contain-layout", "contain", "layout"],
		["contain-strict", "contain", "strict"],
		["contain-size", "contain", "size"],
		["contain-inline-size", "contain", "inline-size"],
		["contain-paint", "contain", "paint"],
		["contain-style", "contain", "style"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	// New cursors
	it.each([
		["cursor-zoom-in", "cursor", "zoom-in"],
		["cursor-zoom-out", "cursor", "zoom-out"],
		["cursor-copy", "cursor", "copy"],
		["cursor-alias", "cursor", "alias"],
		["cursor-no-drop", "cursor", "no-drop"],
		["cursor-col-resize", "cursor", "col-resize"],
		["cursor-nesw-resize", "cursor", "nesw-resize"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});
});
