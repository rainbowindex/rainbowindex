import { describe, expect, it } from "vitest";
import { splitShadowLayers, withShadowColorSlotLayers } from "../../src/css/shadow-color.js";

const SLOT = "--ri-shadow-color";
/** How every family but drop-shadow joins the layers back together. */
const slot = (value: string) => withShadowColorSlotLayers(value, SLOT).join(", ");

/**
 * The expectations here are not invented — every one was checked against
 * Tailwind v4.3.3's own `replaceShadowColors` by compiling the same value as a
 * theme token and reading back what it emitted. `bench/` has the harness that
 * did it. Where this deliberately differs, the test says so.
 */
describe("withShadowColorSlotLayers", () => {
	it("wraps the colour of each layer, leaving the geometry alone", () => {
		expect(slot("0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)")).toBe(
			"0 4px 6px -1px var(--ri-shadow-color, rgb(0 0 0 / 0.1)), 0 2px 4px -2px var(--ri-shadow-color, rgb(0 0 0 / 0.1))",
		);
	});

	it("appends the slot to a layer that names no colour", () => {
		// currentColor is what the browser would have used, so the fallback keeps
		// the uncoloured rendering byte-identical.
		expect(slot("0 1px 2px")).toBe("0 1px 2px var(--ri-shadow-color, currentColor)");
		expect(slot("inset 0 1px 2px")).toBe("inset 0 1px 2px var(--ri-shadow-color, currentColor)");
	});

	it("recognises every colour spelling a value can use", () => {
		expect(slot("0 1px 2px #f00")).toBe("0 1px 2px var(--ri-shadow-color, #f00)");
		expect(slot("inset 0 2px 4px oklch(0.5 0.1 20)")).toBe(
			"inset 0 2px 4px var(--ri-shadow-color, oklch(0.5 0.1 20))",
		);
		expect(slot("0 1px 2px color-mix(in oklab, red 50%, transparent)")).toBe(
			"0 1px 2px var(--ri-shadow-color, color-mix(in oklab, red 50%, transparent))",
		);
		expect(slot("0 1px 2px var(--color-red-500)")).toBe(
			"0 1px 2px var(--ri-shadow-color, var(--color-red-500))",
		);
		expect(slot("0 1px 2px currentColor")).toBe("0 1px 2px var(--ri-shadow-color, currentColor)");
	});

	it("keeps a trailing `inset` after the colour it wrapped", () => {
		expect(slot("0 1px 2px #000 inset")).toBe("0 1px 2px var(--ri-shadow-color, #000) inset");
	});

	it("leaves a value that is not a shadow layer completely alone", () => {
		// Fewer than two lengths means there is no colour position to fill. This
		// is the rule that keeps `@shadow` aliases and `shadow-(--x)` working:
		// wrapping a bare var() would turn a whole shadow into a colour.
		expect(slot("var(--shadow-md)")).toBe("var(--shadow-md)");
		expect(slot("none")).toBe("none");
		expect(slot("inherit")).toBe("inherit");
		expect(slot("")).toBe("");
	});

	it("leaves a layer whose shape it cannot read", () => {
		// Two non-length tokens after the offsets: which one is the colour is not
		// decidable, so neither is touched.
		expect(slot("0 0 var(--x) var(--y)")).toBe("0 0 var(--x) var(--y)");
	});

	it("treats each layer independently", () => {
		expect(slot("0 1px 2px rgb(0 0 0 / 0.1), 0 0 0 1px")).toBe(
			"0 1px 2px var(--ri-shadow-color, rgb(0 0 0 / 0.1)), 0 0 0 1px var(--ri-shadow-color, currentColor)",
		);
		// An alias layer beside a literal one: the alias survives untouched, which
		// is what keeps its `--shadow-md` reference alive for token pruning.
		expect(slot("var(--shadow-md), 0 0 4px #f00")).toBe(
			"var(--shadow-md), 0 0 4px var(--ri-shadow-color, #f00)",
		);
	});

	it("does not split on a comma inside a function", () => {
		expect(splitShadowLayers("0 1px rgb(0, 0, 0), 0 2px red")).toEqual([
			"0 1px rgb(0, 0, 0)",
			" 0 2px red",
		]);
		expect(splitShadowLayers("0 1px light-dark(red, blue)")).toHaveLength(1);
	});

	it("hoists a trailing !important instead of reading it as the colour", () => {
		// `@shadow { x: 0 1px 2px !important; }` keeps the bang in the stored
		// value. Left in place it scored as the layer's colour and produced
		// `var(--ri-shadow-color, !important)`.
		expect(slot("0 1px 2px !important")).toBe(
			"0 1px 2px var(--ri-shadow-color, currentColor) !important",
		);
		expect(slot("0 1px 2px #f00 !important")).toBe(
			"0 1px 2px var(--ri-shadow-color, #f00) !important",
		);
	});

	it("never wraps a slot twice", () => {
		const once = slot("0 1px 2px #f00");
		expect(slot(once)).toBe(once);
	});

	it("counts a two-offset layer and a calc() offset as geometry", () => {
		// `0 1px` is a complete shadow — x and y, no blur — so it takes the slot.
		expect(slot("0 1px")).toBe("0 1px var(--ri-shadow-color, currentColor)");
		// A math function is a length, not a colour candidate. Counting it as one
		// would leave two offsets and one "value", and the calc would be wrapped
		// as though it were the colour.
		expect(slot("0 calc(1px + 2px) 3px")).toBe(
			"0 calc(1px + 2px) 3px var(--ri-shadow-color, currentColor)",
		);
		expect(slot("0 clamp(1px, 2vw, 3px) 4px")).toBe(
			"0 clamp(1px, 2vw, 3px) 4px var(--ri-shadow-color, currentColor)",
		);
	});

	it("lets a recognised colour win over the positional fallback", () => {
		// A `#hex` or a colour function ends the search where it stands. Without
		// that, these fall through to "one leftover token is the colour", which
		// two leftover tokens defeat — so the layer would be left alone and the
		// colour would silently not be slottable. The inputs are malformed CSS;
		// what is being pinned is that recognition beats counting.
		expect(slot("0 1px 2px #f00 var(--x)")).toBe("0 1px 2px var(--ri-shadow-color, #f00) var(--x)");
		expect(slot("0 1px 2px rgb(0 0 0 / 0.1) var(--x)")).toBe(
			"0 1px 2px var(--ri-shadow-color, rgb(0 0 0 / 0.1)) var(--x)",
		);
	});

	it("returns layers separately for drop-shadow, which takes one shadow per call", () => {
		expect(
			withShadowColorSlotLayers("0 1px 1px #f00, 0 2px 2px", "--ri-drop-shadow-color"),
		).toEqual([
			"0 1px 1px var(--ri-drop-shadow-color, #f00)",
			"0 2px 2px var(--ri-drop-shadow-color, currentColor)",
		]);
	});

	it("leaves values a browser would reject, rather than guessing", () => {
		// Tailwind slots both of these by carrying the 148 CSS named colours.
		// Neither is a valid box-shadow — one offset, and two colours — so
		// neither renders either way, and the table is not worth its weight.
		expect(slot("1px red")).toBe("1px red");
		expect(slot("0 1px 2px red blue")).toBe("0 1px 2px red blue");
	});
});
