import { describe, expect, it } from "vitest";
import {
	PROPERTY_GROUPS,
	VARIANT_WEIGHTS,
	computeSortKey,
	computeVariantWeight,
} from "../../src/engine/ordering.js";

describe("PROPERTY_GROUPS", () => {
	it("shorthand appears before longhand — padding", () => {
		expect(PROPERTY_GROUPS["padding"]).toBeLessThan(PROPERTY_GROUPS["padding-inline"]);
		expect(PROPERTY_GROUPS["padding-inline"]).toBeLessThan(PROPERTY_GROUPS["padding-inline-start"]);
	});

	it("shorthand appears before longhand — margin", () => {
		expect(PROPERTY_GROUPS["margin"]).toBeLessThan(PROPERTY_GROUPS["margin-inline"]);
		expect(PROPERTY_GROUPS["margin-inline"]).toBeLessThan(PROPERTY_GROUPS["margin-inline-start"]);
	});

	it("shorthand appears before longhand — border-radius", () => {
		expect(PROPERTY_GROUPS["border-radius"]).toBeLessThan(
			PROPERTY_GROUPS["border-start-start-radius"],
		);
	});

	it("shorthand appears before longhand — inset", () => {
		expect(PROPERTY_GROUPS["inset"]).toBeLessThan(PROPERTY_GROUPS["inset-inline"]);
		expect(PROPERTY_GROUPS["inset-inline"]).toBeLessThan(PROPERTY_GROUPS["inset-inline-start"]);
	});

	it("shorthand appears before longhand — border-width", () => {
		expect(PROPERTY_GROUPS["border-width"]).toBeLessThan(PROPERTY_GROUPS["border-inline-width"]);
		expect(PROPERTY_GROUPS["border-inline-width"]).toBeLessThan(
			PROPERTY_GROUPS["border-inline-start-width"],
		);
	});

	it("shorthand appears before longhand — overscroll-behavior", () => {
		expect(PROPERTY_GROUPS["overscroll-behavior"]).toBeLessThan(
			PROPERTY_GROUPS["overscroll-behavior-x"],
		);
		expect(PROPERTY_GROUPS["overscroll-behavior"]).toBeLessThan(
			PROPERTY_GROUPS["overscroll-behavior-y"],
		);
	});

	it("physical aliases share group with logical equivalents", () => {
		expect(PROPERTY_GROUPS["padding-left"]).toBe(PROPERTY_GROUPS["padding-inline-start"]);
		expect(PROPERTY_GROUPS["margin-top"]).toBe(PROPERTY_GROUPS["margin-block-start"]);
		expect(PROPERTY_GROUPS["top"]).toBe(PROPERTY_GROUPS["inset-block-start"]);
	});

	it("position comes before display", () => {
		expect(PROPERTY_GROUPS["position"]).toBeLessThan(PROPERTY_GROUPS["display"]);
	});

	it("sizing comes after layout", () => {
		expect(PROPERTY_GROUPS["display"]).toBeLessThan(PROPERTY_GROUPS["width"]);
	});

	it("background comes before padding", () => {
		expect(PROPERTY_GROUPS["background-color"]).toBeLessThan(PROPERTY_GROUPS["padding"]);
	});

	it("typography comes after padding", () => {
		expect(PROPERTY_GROUPS["padding"]).toBeLessThan(PROPERTY_GROUPS["font-size"]);
	});

	it("transitions come after effects", () => {
		expect(PROPERTY_GROUPS["opacity"]).toBeLessThan(PROPERTY_GROUPS["transition"]);
	});
});

describe("VARIANT_WEIGHTS", () => {
	it("dark mode has no cascade boost", () => {
		expect(VARIANT_WEIGHTS["dark"]).toBe(0);
	});

	it("responsive variants increase in order", () => {
		expect(VARIANT_WEIGHTS["sm"]).toBeLessThan(VARIANT_WEIGHTS["md"]);
		expect(VARIANT_WEIGHTS["md"]).toBeLessThan(VARIANT_WEIGHTS["lg"]);
		expect(VARIANT_WEIGHTS["lg"]).toBeLessThan(VARIANT_WEIGHTS["xl"]);
	});

	it("state variants come after responsive", () => {
		expect(VARIANT_WEIGHTS["xl"]).toBeLessThan(VARIANT_WEIGHTS["hover"]);
	});

	it("container query variants exist", () => {
		expect(VARIANT_WEIGHTS["@sm"]).toBeDefined();
		expect(VARIANT_WEIGHTS["@md"]).toBeDefined();
	});

	it("form variants in tier 5 (550-556)", () => {
		expect(VARIANT_WEIGHTS["disabled"]).toBe(550);
		expect(VARIANT_WEIGHTS["indeterminate"]).toBe(553);
		expect(VARIANT_WEIGHTS["valid"]).toBe(556);
	});

	it("structural variants in tier 6 (660-667)", () => {
		expect(VARIANT_WEIGHTS["first"]).toBe(660);
		expect(VARIANT_WEIGHTS["empty"]).toBe(667);
	});

	it("pseudo-elements in tier 8 (889-897)", () => {
		expect(VARIANT_WEIGHTS["placeholder"]).toBe(889);
		expect(VARIANT_WEIGHTS["before"]).toBe(895);
		expect(VARIANT_WEIGHTS["after"]).toBe(896);
	});

	it("group-* variants in tier 4 after base state variants", () => {
		expect(VARIANT_WEIGHTS["group-hover"]).toBeGreaterThan(VARIANT_WEIGHTS["focus-within"]);
		expect(VARIANT_WEIGHTS["group-hover"]).toBeLessThan(VARIANT_WEIGHTS["disabled"]);
	});

	it("group-* variants increase in order", () => {
		expect(VARIANT_WEIGHTS["group-hover"]).toBeLessThan(VARIANT_WEIGHTS["group-focus"]);
		expect(VARIANT_WEIGHTS["group-focus"]).toBeLessThan(VARIANT_WEIGHTS["group-active"]);
	});

	it("band ordering: state < form < structural < starting < pseudo-elements", () => {
		expect(VARIANT_WEIGHTS["focus-within"]).toBeLessThan(VARIANT_WEIGHTS["disabled"]);
		expect(VARIANT_WEIGHTS["valid"]).toBeLessThan(VARIANT_WEIGHTS["first"]);
		expect(VARIANT_WEIGHTS["empty"]).toBeLessThan(VARIANT_WEIGHTS["starting"]);
		expect(VARIANT_WEIGHTS["starting"]).toBeLessThan(VARIANT_WEIGHTS["before"]);
	});
});

describe("computeSortKey", () => {
	it("base utility gets property group as sort key", () => {
		expect(computeSortKey("padding")).toBe(PROPERTY_GROUPS["padding"]);
	});

	it("variant adds weight band", () => {
		const base = computeSortKey("padding");
		const hovered = computeSortKey("padding", ["hover"]);
		expect(hovered).toBe(VARIANT_WEIGHTS["hover"] * 1000 + PROPERTY_GROUPS["padding"]);
		expect(hovered).toBeGreaterThan(base);
	});

	it("multi-variant sums weights", () => {
		const key = computeSortKey("padding", ["sm", "hover"]);
		const expected =
			(VARIANT_WEIGHTS["sm"] + VARIANT_WEIGHTS["hover"]) * 1000 + PROPERTY_GROUPS["padding"];
		expect(key).toBe(expected);
	});

	it("shorthand sorts before longhand at same variant level", () => {
		const p = computeSortKey("padding", ["hover"]);
		const pi = computeSortKey("padding-inline", ["hover"]);
		const pis = computeSortKey("padding-inline-start", ["hover"]);
		expect(p).toBeLessThan(pi);
		expect(pi).toBeLessThan(pis);
	});

	it("unknown property gets mid-band group number", () => {
		const key = computeSortKey("some-unknown-prop");
		expect(key).toBe(500);
	});

	it("prototype-chain property/variant names get the unknown defaults, not Object.prototype members", () => {
		// A plain-object table would resolve these through the prototype chain
		// to functions, corrupting the numeric sort key.
		expect(PROPERTY_GROUPS["constructor"]).toBeUndefined();
		expect(VARIANT_WEIGHTS["valueOf"]).toBeUndefined();
		expect(computeSortKey("constructor", ["valueOf"])).toBe(900 * 1000 + 500);
		expect(computeSortKey("hasOwnProperty", ["toString", "__proto__"])).toBe(900 * 1000 + 500);
	});
});

describe("computeVariantWeight", () => {
	it("no variants = 0", () => {
		expect(computeVariantWeight([])).toBe(0);
	});

	it("single variant returns its weight", () => {
		expect(computeVariantWeight(["hover"])).toBe(VARIANT_WEIGHTS["hover"]);
	});

	it("named container variant uses base weight", () => {
		const weight = computeVariantWeight(["@sidebar/sm"]);
		expect(weight).toBe(VARIANT_WEIGHTS["@sm"]);
	});
});
