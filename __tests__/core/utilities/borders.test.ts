import { describe, expect, it, test } from "vitest";
import { resolveUtility } from "../../../src/utilities/index.js";
import { parseUtility } from "../../../src/utilities/parser.js";
import { resolveDirectives } from "../../../src/directives/index.js";

const theme = resolveDirectives([]);

function resolveClass(input: string) {
	const parsed = parseUtility(input);
	return resolveUtility(
		parsed.utility,
		parsed.value,
		parsed.negative,
		theme,
		undefined,
		undefined,
		parsed.dataType ?? null,
	);
}

describe("border utilities", () => {
	it("border → border-width: 1px", () => {
		const r = resolveUtility("border", null, false, theme);
		expect(r!.declarations[0].value).toBe("1px");
	});

	it("border-2 → border-width: 2px", () => {
		const r = resolveUtility("border-2", null, false, theme);
		expect(r!.declarations[0].value).toBe("2px");
	});

	it("rounded → border-radius from theme", () => {
		const r = resolveUtility("rounded", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-radius");
	});

	it("rounded-lg → themed radius", () => {
		const r = resolveUtility("rounded-lg", null, false, theme);
		expect(r!.declarations[0].value).toContain("--rounded-lg");
	});

	it("rounded-full → calc(infinity * 1px)", () => {
		const r = resolveUtility("rounded-full", null, false, theme);
		expect(r!.declarations[0].value).toBe("calc(infinity * 1px)");
	});

	it("rounded-t-lg → logical start-start + start-end radius", () => {
		const r = resolveUtility("rounded-t-lg", null, false, theme);
		expect(r!.declarations).toHaveLength(2);
		expect(r!.declarations[0].property).toBe("border-start-start-radius");
		expect(r!.declarations[1].property).toBe("border-start-end-radius");
	});

	it("rounded-tl-md → border-start-start-radius", () => {
		const r = resolveUtility("rounded-tl-md", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-start-start-radius");
	});

	it("rounded-ss-md → explicit logical start-start", () => {
		const r = resolveUtility("rounded-ss-md", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-start-start-radius");
	});

	it("rounded-ee-md → explicit logical end-end", () => {
		const r = resolveUtility("rounded-ee-md", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-end-end-radius");
	});

	it("divide-y → reverse-aware logical block borders on a nested selector", () => {
		const r = resolveUtility("divide-y", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "--ri-divide-y-reverse", value: "0" });
		expect(r!.declarations[1].property).toBe("border-block-start-width");
		expect(r!.declarations[1].value).toBe("calc(1px * var(--ri-divide-y-reverse))");
		expect(r!.declarations[2].property).toBe("border-block-end-width");
		expect(r!.declarations[2].value).toBe("calc(1px * calc(1 - var(--ri-divide-y-reverse)))");
		expect(r!.nestedSelector).toBe("& > :not(:last-child)");
	});

	it("border-t → border-block-start-width (logical)", () => {
		const r = resolveUtility("border-t", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-block-start-width");
	});

	it("border-solid → border-style: solid", () => {
		const r = resolveUtility("border-solid", null, false, theme);
		expect(r!.declarations[0].value).toBe("solid");
	});

	test.each([
		["border-0", "border-width", "0px"],
		["border-4", "border-width", "4px"],
		["border-8", "border-width", "8px"],
		["border-b", "border-block-end-width", "1px"],
		["border-l", "border-inline-start-width", "1px"],
		["border-r", "border-inline-end-width", "1px"],
		["border-s", "border-inline-start-width", "1px"],
		["border-e", "border-inline-end-width", "1px"],
		["border-x", "border-inline-width", "1px"],
		["border-y", "border-block-width", "1px"],
		["border-dashed", "border-style", "dashed"],
		["border-dotted", "border-style", "dotted"],
		["border-double", "border-style", "double"],
		["border-hidden", "border-style", "hidden"],
		["border-none", "border-style", "none"],
		["rounded-none", "border-radius", "0px"],
		["outline", "outline-width", "1px"],
		["outline-none", "outline-style", "none"],
		["outline-solid", "outline-style", "solid"],
		["outline-dashed", "outline-style", "dashed"],
		["outline-dotted", "outline-style", "dotted"],
		["outline-double", "outline-style", "double"],
	])("%s resolves to %s: %s", (className, property, value) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe(property);
		expect(r!.declarations[0].value).toBe(value);
	});

	test.each([
		["rounded-s-md", ["border-start-start-radius", "border-end-start-radius"]],
		["rounded-e-md", ["border-start-end-radius", "border-end-end-radius"]],
		["rounded-bs-md", ["border-start-start-radius", "border-start-end-radius"]],
		["rounded-be-md", ["border-end-start-radius", "border-end-end-radius"]],
	])("%s resolves both logical radii", (className, props) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations.map((d) => d.property)).toEqual(props);
	});

	test.each([
		["rounded-tr-md", "border-start-end-radius"],
		["rounded-bl-md", "border-end-start-radius"],
		["rounded-br-md", "border-end-end-radius"],
		["rounded-se-md", "border-start-end-radius"],
		["rounded-es-md", "border-end-start-radius"],
	])("%s resolves the correct corner radius", (className, property) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r!.declarations[0].property).toBe(property);
	});

	it("supports arbitrary rounded values", () => {
		const r = resolveUtility("rounded-[12px]", null, false, theme);
		expect(r!.declarations[0].value).toBe("12px");
	});

	it("supports arbitrary border widths", () => {
		const r = resolveUtility("border-[3px]", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-width");
		expect(r!.declarations[0].value).toBe("3px");
	});

	it("resolves rem arbitrary border widths as border-width, not border-color", () => {
		const r = resolveUtility("border-[1rem]", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-width");
		expect(r!.declarations[0].value).toBe("1rem");
	});

	it("resolves hex arbitrary border values as border-color", () => {
		const r = resolveUtility("border-[#ff0000]", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-color");
		expect(r!.declarations[0].value).toBe("#ff0000");
	});

	it("respects explicit [length:...] hint for border width", () => {
		const r = resolveClass("border-[length:1rem]");
		expect(r!.declarations[0].property).toBe("border-width");
		expect(r!.declarations[0].value).toBe("1rem");
	});

	it("respects explicit [color:var(--x)] hint for border color", () => {
		const r = resolveClass("border-[color:var(--my-color)]");
		expect(r!.declarations[0].property).toBe("border-color");
		expect(r!.declarations[0].value).toBe("var(--my-color)");
	});

	it("respects explicit [length:var(--x)] hint for border width", () => {
		const r = resolveClass("border-[length:var(--my-width)]");
		expect(r!.declarations[0].property).toBe("border-width");
		expect(r!.declarations[0].value).toBe("var(--my-width)");
	});

	it("respects paren shorthand border-(color:--x) for border color", () => {
		const r = resolveClass("border-(color:--my-color)");
		expect(r!.declarations[0].property).toBe("border-color");
		expect(r!.declarations[0].value).toBe("var(--my-color)");
	});

	it("respects paren shorthand border-(length:--x) for border width", () => {
		const r = resolveClass("border-(length:--my-width)");
		expect(r!.declarations[0].property).toBe("border-width");
		expect(r!.declarations[0].value).toBe("var(--my-width)");
	});

	it("border-(--x) defaults to border-color (var() is ambiguous, color-first dispatch)", () => {
		const r = resolveClass("border-(--my-color)");
		expect(r!.declarations[0].property).toBe("border-color");
		expect(r!.declarations[0].value).toBe("var(--my-color)");
	});

	it("outline-[color:var(--x)] resolves as outline-color", () => {
		const r = resolveClass("outline-[color:var(--my-color)]");
		expect(r!.declarations[0].property).toBe("outline-color");
		expect(r!.declarations[0].value).toBe("var(--my-color)");
	});

	it("outline-[length:var(--x)] resolves as outline-width", () => {
		const r = resolveClass("outline-[length:var(--my-width)]");
		expect(r!.declarations[0].property).toBe("outline-width");
		expect(r!.declarations[0].value).toBe("var(--my-width)");
	});

	test.each([
		["border-t-2", "border-block-start-width", "2px"],
		["border-b-5", "border-block-end-width", "5px"],
		["border-l-4", "border-inline-start-width", "4px"],
		["border-r-6", "border-inline-end-width", "6px"],
		["border-s-8", "border-inline-start-width", "8px"],
		["border-e-7", "border-inline-end-width", "7px"],
		["border-x-2", "border-inline-width", "2px"],
		["border-y-3", "border-block-width", "3px"],
	])("%s resolves directional border widths", (className, property, value) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe(property);
		expect(r!.declarations[0].value).toBe(value);
	});

	it("divide-x uses nested selector and reverse-aware logical inline borders", () => {
		const r = resolveUtility("divide-x", null, false, theme);
		expect(r!.nestedSelector).toBe("& > :not(:last-child)");
		expect(r!.declarations[0]).toEqual({ property: "--ri-divide-x-reverse", value: "0" });
		expect(r!.declarations[1].property).toBe("border-inline-start-width");
		expect(r!.declarations[1].value).toBe("calc(1px * var(--ri-divide-x-reverse))");
		expect(r!.declarations[2].property).toBe("border-inline-end-width");
		expect(r!.declarations[2].value).toBe("calc(1px * calc(1 - var(--ri-divide-x-reverse)))");
	});

	it("divide-y supports arbitrary widths", () => {
		const r = resolveUtility("divide-y-[3px]", null, false, theme);
		expect(r!.nestedSelector).toBe("& > :not(:last-child)");
		expect(r!.declarations[1].value).toBe("calc(3px * var(--ri-divide-y-reverse))");
		expect(r!.declarations[2].value).toBe("calc(3px * calc(1 - var(--ri-divide-y-reverse)))");
	});

	it("divide-x-reverse / divide-y-reverse set the reverse flag", () => {
		const x = resolveUtility("divide-x-reverse", null, false, theme);
		expect(x!.declarations).toEqual([{ property: "--ri-divide-x-reverse", value: "1" }]);
		expect(x!.nestedSelector).toBe("& > :not(:last-child)");
		const y = resolveUtility("divide-y-reverse", null, false, theme);
		expect(y!.declarations).toEqual([{ property: "--ri-divide-y-reverse", value: "1" }]);
	});

	it("border-bs / border-be → logical block-start/end widths", () => {
		expect(resolveUtility("border-bs", null, false, theme)!.declarations[0]).toEqual({
			property: "border-block-start-width",
			value: "1px",
		});
		expect(resolveUtility("border-be", null, false, theme)!.declarations[0]).toEqual({
			property: "border-block-end-width",
			value: "1px",
		});
		expect(resolveUtility("border-bs-2", null, false, theme)!.declarations[0]).toEqual({
			property: "border-block-start-width",
			value: "2px",
		});
	});

	test.each([
		["divide-solid", "solid"],
		["divide-dashed", "dashed"],
		["divide-dotted", "dotted"],
		["divide-double", "double"],
		["divide-hidden", "hidden"],
		["divide-none", "none"],
	])("%s sets divide border style", (className, style) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r!.nestedSelector).toBe("& > :not(:last-child)");
		expect(r!.declarations[0].property).toBe("border-style");
		expect(r!.declarations[0].value).toBe(style);
	});

	test.each([
		["outline-offset-2", "outline-offset", "2px"],
		["outline-offset--1", "outline-offset", "-1px"],
		["outline-offset-[0.25rem]", "outline-offset", "0.25rem"],
		["outline-4", "outline-width", "4px"],
		["outline-[5px]", "outline-width", "5px"],
	])("%s resolves outline values", (className, property, value) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r).not.toBeNull();
		const decl = r!.declarations.find((d) => d.property === property);
		expect(decl).toBeDefined();
		expect(decl!.value).toBe(value);
	});

	it("outline-[#hex] resolves as outline-color, not outline-width", () => {
		const r = resolveUtility("outline-[#ff0000]", null, false, theme);
		expect(r!.declarations[0].property).toBe("outline-color");
		expect(r!.declarations[0].value).toBe("#ff0000");
	});

	it("outline-[rgb(...)] resolves as outline-color", () => {
		const r = resolveUtility("outline-[rgb(255,0,0)]", null, false, theme);
		expect(r!.declarations[0].property).toBe("outline-color");
		expect(r!.declarations[0].value).toBe("rgb(255,0,0)");
	});

	it.each([
		["corner-round", "round"],
		["corner-scoop", "scoop"],
		["corner-bevel", "bevel"],
		["corner-notch", "notch"],
		["corner-square", "square"],
		["corner-squircle", "squircle"],
	])("%s emits corner-shape + --ri-rounded-scale reset", (className, shape) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r!.declarations).toEqual([
			{ property: "corner-shape", value: shape },
			{ property: "--ri-rounded-scale", value: "1" },
		]);
	});

	it("corner-[superellipse(2)] emits arbitrary corner-shape + scale reset", () => {
		const r = resolveUtility("corner-[superellipse(2)]", null, false, theme);
		expect(r!.declarations).toEqual([
			{ property: "corner-shape", value: "superellipse(2)" },
			{ property: "--ri-rounded-scale", value: "1" },
		]);
	});

	it("rounded-scale-none → --ri-rounded-scale: 1", () => {
		const r = resolveUtility("rounded-scale-none", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-rounded-scale");
		expect(r!.declarations[0].value).toBe("1");
	});

	it("rounded-scale-[1.8] → --ri-rounded-scale: 1.8", () => {
		const r = resolveUtility("rounded-scale-[1.8]", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-rounded-scale");
		expect(r!.declarations[0].value).toBe("1.8");
	});

	it("rounded-scale-2 → --ri-rounded-scale: 2", () => {
		const r = resolveUtility("rounded-scale-2", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-rounded-scale");
		expect(r!.declarations[0].value).toBe("2");
	});

	it("outline-none → outline-style: none (v4)", () => {
		const r = resolveUtility("outline-none", null, false, theme);
		expect(r!.declarations).toEqual([{ property: "outline-style", value: "none" }]);
	});

	it("outline-hidden keeps the transparent-outline accessibility hack", () => {
		const r = resolveUtility("outline-hidden", null, false, theme);
		expect(r!.declarations).toEqual([
			{ property: "outline", value: "2px solid transparent" },
			{ property: "outline-offset", value: "2px" },
		]);
	});

	it("-outline-offset-2 → negated offset", () => {
		const r = resolveUtility("outline-offset-2", null, true, theme);
		expect(r!.declarations[0]).toEqual({
			property: "outline-offset",
			value: "calc(2px * -1)",
		});
	});

	it("outline-(--c) → outline-color (bare custom property)", () => {
		const r = resolveUtility("outline-[var(--c)]", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "outline-color", value: "var(--c)" });
	});

	it("outline-solid → outline-style: solid", () => {
		const r = resolveUtility("outline-solid", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "outline-style", value: "solid" });
	});
});
