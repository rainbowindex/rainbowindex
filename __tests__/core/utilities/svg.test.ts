import { describe, expect, it } from "vitest";
import { resolveUtility } from "../../../src/utilities/index.js";
import { resolveDirectives } from "../../../src/directives/index.js";

const theme = resolveDirectives([]);

describe("svg utilities", () => {
	// Stroke width
	it.each([
		["stroke-0", "0"],
		["stroke-1", "1"],
		["stroke-6", "6"],
		["stroke-1.5", "1.5"],
		["stroke-6.4", "6.4"],
	])("%s → stroke-width: %s", (util, val) => {
		const r = resolveUtility("stroke", util.slice(7), false, theme);
		expect(r!.declarations[0]).toEqual({ property: "stroke-width", value: val });
	});

	it("stroke-6_4 (underscore decimal) → stroke-width: 6.4", () => {
		const r = resolveUtility("stroke", "6_4", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "stroke-width", value: "6.4" });
	});

	it("stroke-[3px] arbitrary → stroke-width: 3px", () => {
		const r = resolveUtility("stroke", "[3px]", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "stroke-width", value: "3px" });
	});

	// Stroke dashoffset — decimals allowed
	it("stroke-offset-1.5 → stroke-dashoffset: 1.5", () => {
		const r = resolveUtility("stroke-offset", "1.5", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "stroke-dashoffset", value: "1.5" });
	});
	it("stroke-offset-4 uses named static", () => {
		const r = resolveUtility("stroke-offset", "4", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "stroke-dashoffset", value: "4" });
	});

	// Stroke miterlimit — decimals allowed
	it("stroke-miter-1.5 → stroke-miterlimit: 1.5", () => {
		const r = resolveUtility("stroke-miter", "1.5", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "stroke-miterlimit", value: "1.5" });
	});

	// Stroke opacity
	it("stroke-opacity-50 → stroke-opacity: 0.5", () => {
		const r = resolveUtility("stroke-opacity", "50", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "stroke-opacity", value: "0.5" });
	});

	// Fill / stroke none
	it("fill-none → fill: none", () => {
		const r = resolveUtility("fill-none", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "fill", value: "none" });
	});
	it("stroke-none → stroke: none", () => {
		const r = resolveUtility("stroke-none", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "stroke", value: "none" });
	});
});
