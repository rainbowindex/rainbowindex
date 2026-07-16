import { describe, expect, it, test } from "vitest";
import { resolveUtility } from "../../../src/utilities/index.js";
import { resolveDirectives } from "../../../src/directives/index.js";

const theme = resolveDirectives([]);

describe("spacing utilities", () => {
	test.each([
		["p", "4", "padding", "calc(4 * var(--spacing))"],
		["px", "2", "padding-inline", "calc(2 * var(--spacing))"],
		["py", "0", "padding-block", "0px"],
	])("%s-%s resolves spacing declaration", (utility, value, property, expectedValue) => {
		const r = resolveUtility(utility, value, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe(property);
		expect(r!.declarations[0].value).toBe(expectedValue);
	});

	test.each([
		["pt", "padding-block-start"],
		["pl", "padding-inline-start"],
		["ps", "padding-inline-start"],
		["pe", "padding-inline-end"],
		["pbs", "padding-block-start"],
		["pbe", "padding-block-end"],
		["mx", "margin-inline"],
		["ms", "margin-inline-start"],
		["me", "margin-inline-end"],
		["mbs", "margin-block-start"],
		["mbe", "margin-block-end"],
		["gap", "gap"],
		["gap-x", "column-gap"],
		["inset", "inset"],
		["top", "inset-block-start"],
		["left", "inset-inline-start"],
	])("%s maps to %s", (utility, property) => {
		const r = resolveUtility(utility, "4", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe(property);
	});

	it("m-auto → margin: auto", () => {
		const r = resolveUtility("m", "auto", false, theme);
		expect(r!.declarations[0].value).toBe("auto");
	});

	it("-m-4 → negative margin", () => {
		const r = resolveUtility("m", "4", true, theme);
		expect(r!.declarations[0].value).toBe("calc(4 * var(--spacing) * -1)");
	});

	it("space-x-4 → reverse-aware inline margins on a nested selector", () => {
		const r = resolveUtility("space-x", "4", false, theme);
		expect(r!.nestedSelector).toBe("& > :not(:last-child)");
		expect(r!.declarations[0]).toEqual({ property: "--ri-space-x-reverse", value: "0" });
		expect(r!.declarations[1]).toEqual({
			property: "margin-inline-start",
			value: "calc(calc(4 * var(--spacing)) * var(--ri-space-x-reverse))",
		});
		expect(r!.declarations[2].property).toBe("margin-inline-end");
	});

	it("space-y-2 → reverse-aware block margins on a nested selector", () => {
		const r = resolveUtility("space-y", "2", false, theme);
		expect(r!.nestedSelector).toBe("& > :not(:last-child)");
		expect(r!.declarations[0].property).toBe("--ri-space-y-reverse");
		expect(r!.declarations[1].property).toBe("margin-block-start");
		expect(r!.declarations[2].property).toBe("margin-block-end");
	});

	it("space-x-reverse / space-y-reverse set the reverse flag", () => {
		const x = resolveUtility("space-x-reverse", null, false, theme);
		expect(x!.nestedSelector).toBe("& > :not(:last-child)");
		expect(x!.declarations).toEqual([{ property: "--ri-space-x-reverse", value: "1" }]);
		const y = resolveUtility("space-y-reverse", null, false, theme);
		expect(y!.declarations).toEqual([{ property: "--ri-space-y-reverse", value: "1" }]);
	});

	it("-space-x-4 negates the resolved spacing", () => {
		const r = resolveUtility("space-x", "4", true, theme);
		expect(r!.declarations[1].value).toBe(
			"calc(calc(4 * var(--spacing) * -1) * var(--ri-space-x-reverse))",
		);
	});

	it("p-[13px] → arbitrary value", () => {
		const r = resolveUtility("p", "[13px]", false, theme);
		expect(r!.declarations[0].value).toBe("13px");
	});

	it("p-px → 1px", () => {
		const r = resolveUtility("p", "px", false, theme);
		expect(r!.declarations[0].value).toBe("1px");
	});

	it("-m-px → margin: -1px", () => {
		const r = resolveUtility("m", "px", true, theme);
		expect(r!.declarations[0].value).toBe("-1px");
	});

	it("gap-px → gap: 1px", () => {
		const r = resolveUtility("gap", "px", false, theme);
		expect(r!.declarations[0].property).toBe("gap");
		expect(r!.declarations[0].value).toBe("1px");
	});

	it("top-px → inset-block-start: 1px", () => {
		const r = resolveUtility("top", "px", false, theme);
		expect(r!.declarations[0].property).toBe("inset-block-start");
		expect(r!.declarations[0].value).toBe("1px");
	});

	it("-top-px → inset-block-start: -1px", () => {
		const r = resolveUtility("top", "px", true, theme);
		expect(r!.declarations[0].value).toBe("-1px");
	});

	it("space-x-px → 1px reverse-aware margins", () => {
		const r = resolveUtility("space-x", "px", false, theme);
		expect(r!.declarations[1].value).toBe("calc(1px * var(--ri-space-x-reverse))");
		expect(r!.nestedSelector).toBe("& > :not(:last-child)");
	});

	it("inset-px → inset: 1px", () => {
		const r = resolveUtility("inset", "px", false, theme);
		expect(r!.declarations[0].property).toBe("inset");
		expect(r!.declarations[0].value).toBe("1px");
	});

	// Inset fractions (scoped to inset; padding/margin must NOT accept them)
	it.each([
		["inset", "1/2", "inset", "calc(1/2 * 100%)"],
		["inset-x", "1/3", "inset-inline", "calc(1/3 * 100%)"],
		["top", "1/2", "inset-block-start", "calc(1/2 * 100%)"],
	])("%s-%s → %s: %s (fraction)", (util, val, prop, expected) => {
		const r = resolveUtility(util, val, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: expected });
	});

	it("-inset-1/2 → inset: calc(1/2 * -100%) (negative fraction)", () => {
		const r = resolveUtility("inset", "1/2", true, theme);
		expect(r!.declarations[0]).toEqual({ property: "inset", value: "calc(1/2 * -100%)" });
	});

	it("fractions stay scoped to inset — p-1/2 does not resolve", () => {
		expect(resolveUtility("p", "1/2", false, theme)).toBeNull();
	});

	// Logical edge utilities (inset-s/e/bs/be)
	it.each([
		["inset-s", "inset-inline-start"],
		["inset-e", "inset-inline-end"],
		["inset-bs", "inset-block-start"],
		["inset-be", "inset-block-end"],
	])("%s-4 → %s (logical edge)", (util, prop) => {
		const r = resolveUtility(util, "4", false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: "calc(4 * var(--spacing))" });
	});

	it("inset-bs supports fraction / auto / arbitrary / custom-property", () => {
		expect(resolveUtility("inset-bs", "1/2", false, theme)!.declarations[0]).toEqual({
			property: "inset-block-start",
			value: "calc(1/2 * 100%)",
		});
		expect(resolveUtility("inset-bs", "auto", false, theme)!.declarations[0]).toEqual({
			property: "inset-block-start",
			value: "auto",
		});
		expect(resolveUtility("inset-be", "[10px]", false, theme)!.declarations[0]).toEqual({
			property: "inset-block-end",
			value: "10px",
		});
	});

	it("accepts any valid number for spacing", () => {
		const r = resolveUtility("p", "50", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toBe("calc(50 * var(--spacing))");
	});

	it("accepts dot decimals for spacing", () => {
		const r = resolveUtility("px", "3.75", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toBe("calc(3.75 * var(--spacing))");
	});

	it("accepts dot decimals for negative spacing", () => {
		const r = resolveUtility("m", "0.75", true, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toBe("calc(0.75 * var(--spacing) * -1)");
	});

	test.each([
		["scroll-m-4", "scroll-margin", "calc(4 * var(--spacing))"],
		["scroll-mx-4", "scroll-margin-inline", "calc(4 * var(--spacing))"],
		["scroll-ms-4", "scroll-margin-inline-start", "calc(4 * var(--spacing))"],
		// logical-first: scroll-mt → block-start (kept, like margin/inset)
		["scroll-mt-4", "scroll-margin-block-start", "calc(4 * var(--spacing))"],
		// explicit logical block aliases (added)
		["scroll-mbs-4", "scroll-margin-block-start", "calc(4 * var(--spacing))"],
		["scroll-mbe-[10px]", "scroll-margin-block-end", "10px"],
		["scroll-p-4", "scroll-padding", "calc(4 * var(--spacing))"],
		["scroll-pbs-4", "scroll-padding-block-start", "calc(4 * var(--spacing))"],
		["scroll-pbe-4", "scroll-padding-block-end", "calc(4 * var(--spacing))"],
	])("%s → %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	it("-scroll-mbs-4 negates", () => {
		const r = resolveUtility("scroll-mbs-4", null, true, theme);
		expect(r!.declarations[0].value).toBe("calc(4 * var(--spacing) * -1)");
	});
});
