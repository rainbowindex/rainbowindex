import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { resolveUtility } from "../../../src/utilities/index.js";
import { resolveDirectives } from "../../../src/directives/index.js";

const theme = resolveDirectives([]);
let devWarnSpy: ReturnType<typeof vi.spyOn>;

function mutableTheme() {
	const base = resolveDirectives([]);
	return {
		...base,
		text: { ...base.text },
		animations: { ...base.animations },
	};
}

beforeEach(() => {
	devWarnSpy?.mockRestore();
	devWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("typography utilities", () => {
	it("text-lg → font-size + line-height", () => {
		const r = resolveUtility("text-lg", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations).toHaveLength(2);
		expect(r!.declarations[0].property).toBe("font-size");
		expect(r!.declarations[1].property).toBe("line-height");
	});

	it("text-<size>/<modifier> sets font-size + overridden line-height", () => {
		// numeric modifier resolves like leading-7 (theme leading scale)
		const num = resolveUtility("text", "lg/7", false, theme);
		expect(num!.declarations[0]).toEqual({ property: "font-size", value: "var(--text-lg)" });
		expect(num!.declarations[1]).toEqual({
			property: "line-height",
			value: resolveUtility("leading-7", null, false, theme)!.declarations[0].value,
		});
		// arbitrary + custom-property modifiers
		expect(resolveUtility("text", "lg/[1.5]", false, theme)!.declarations[1]).toEqual({
			property: "line-height",
			value: "1.5",
		});
		expect(resolveUtility("text", "lg/(--lh)", false, theme)!.declarations[1]).toEqual({
			property: "line-height",
			value: "var(--lh)",
		});
		// no modifier → default leading var
		expect(resolveUtility("text", "lg", false, theme)!.declarations[1].value).toBe(
			"var(--text-lg-leading)",
		);
	});

	it("font-bold → font-weight: 700", () => {
		const r = resolveUtility("font-bold", null, false, theme);
		expect(r!.declarations[0].property).toBe("font-weight");
		expect(r!.declarations[0].value).toBe("700");
	});

	it("font-sans → font-family: var(--font-sans)", () => {
		const r = resolveUtility("font-sans", null, false, theme);
		expect(r!.declarations[0].property).toBe("font-family");
		expect(r!.declarations[0].value).toBe("var(--font-sans)");
	});

	it("uppercase → text-transform: uppercase", () => {
		const r = resolveUtility("uppercase", null, false, theme);
		expect(r!.declarations[0].value).toBe("uppercase");
	});

	it("truncate → 3 declarations", () => {
		const r = resolveUtility("truncate", null, false, theme);
		expect(r!.declarations).toHaveLength(3);
	});

	it("underline → text-decoration-line: underline", () => {
		const r = resolveUtility("underline", null, false, theme);
		expect(r!.declarations[0].value).toBe("underline");
	});

	it("text-center → text-align: center", () => {
		const r = resolveUtility("text-center", null, false, theme);
		expect(r!.declarations[0].value).toBe("center");
	});

	it("text-balance → text-wrap: balance", () => {
		const r = resolveUtility("text-balance", null, false, theme);
		expect(r!.declarations[0].value).toBe("balance");
	});

	it("text-pretty → text-wrap: pretty", () => {
		const r = resolveUtility("text-pretty", null, false, theme);
		expect(r!.declarations[0].value).toBe("pretty");
	});

	it("italic → font-style: italic", () => {
		const r = resolveUtility("italic", null, false, theme);
		expect(r!.declarations[0].value).toBe("italic");
	});

	it("leading-tight → line-height", () => {
		const r = resolveUtility("leading-tight", null, false, theme);
		expect(r!.declarations[0].property).toBe("line-height");
	});

	it("tracking-wide → letter-spacing", () => {
		const r = resolveUtility("tracking-wide", null, false, theme);
		expect(r!.declarations[0].property).toBe("letter-spacing");
	});

	it("decoration-solid → text-decoration-style: solid", () => {
		const r = resolveUtility("decoration-solid", null, false, theme);
		expect(r!.declarations[0].property).toBe("text-decoration-style");
		expect(r!.declarations[0].value).toBe("solid");
	});

	it("decoration-2 → text-decoration-thickness: 2px", () => {
		const r = resolveUtility("decoration-2", null, false, theme);
		expect(r!.declarations[0].property).toBe("text-decoration-thickness");
		expect(r!.declarations[0].value).toBe("2px");
	});

	it("decoration-(--c) → color; decoration-(length:--t) → thickness", () => {
		// bare custom property → text-decoration-color (resolved by colorGenerator)
		expect(resolveUtility("decoration", "[var(--c)]", false, theme)!.declarations[0]).toEqual({
			property: "text-decoration-color",
			value: "var(--c)",
		});
		// length-hinted custom property → text-decoration-thickness
		expect(
			resolveUtility("decoration", "[var(--t)]", false, theme, undefined, undefined, "length")!
				.declarations[0],
		).toEqual({ property: "text-decoration-thickness", value: "var(--t)" });
	});

	it("-underline-offset-<number> negates via calc", () => {
		expect(resolveUtility("underline-offset", "2", true, theme)!.declarations[0]).toEqual({
			property: "text-underline-offset",
			value: "calc(2px * -1)",
		});
		expect(resolveUtility("underline-offset", "2", false, theme)!.declarations[0]).toEqual({
			property: "text-underline-offset",
			value: "2px",
		});
	});

	test.each([
		["text-left", "text-align", "left"],
		["text-wrap", "text-wrap", "wrap"],
		["text-nowrap", "text-wrap", "nowrap"],
		["lowercase", "text-transform", "lowercase"],
		["capitalize", "text-transform", "capitalize"],
		["normal-case", "text-transform", "none"],
		["overline", "text-decoration-line", "overline"],
		["line-through", "text-decoration-line", "line-through"],
		["no-underline", "text-decoration-line", "none"],
		["decoration-wavy", "text-decoration-style", "wavy"],
		["decoration-auto", "text-decoration-thickness", "auto"],
		["decoration-from-font", "text-decoration-thickness", "from-font"],
		["whitespace-break-spaces", "white-space", "break-spaces"],
		["break-normal", "word-break", "normal"],
		["break-words", "overflow-wrap", "break-word"],
		["break-all", "word-break", "break-all"],
		["not-italic", "font-style", "normal"],
		["align-super", "vertical-align", "super"],
		["list-decimal", "list-style-type", "decimal"],
		["list-inside", "list-style-position", "inside"],
		["content-none", "content", "none"],
	])("%s resolves to %s: %s", (className, property, value) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe(property);
		expect(r!.declarations[0].value).toBe(value);
	});

	it("font-mono resolves to theme font slot", () => {
		const r = resolveUtility("font-mono", null, false, theme);
		expect(r!.declarations[0].value).toBe("var(--font-mono)");
	});

	it("font arbitrary family values stay font-family", () => {
		const r = resolveUtility(`font-["IBM Plex Sans",sans-serif]`, null, false, theme);
		expect(r!.declarations[0].property).toBe("font-family");
		expect(r!.declarations[0].value).toBe(`"IBM Plex Sans",sans-serif`);
	});

	it("font arbitrary family underscores decode to spaces", () => {
		// The authorable form — class names cannot contain spaces.
		const r = resolveUtility(`font-["IBM_Plex_Sans",sans-serif]`, null, false, theme);
		expect(r!.declarations[0].property).toBe("font-family");
		expect(r!.declarations[0].value).toBe(`"IBM Plex Sans",sans-serif`);
	});

	it("font arbitrary numeric values become font-weight", () => {
		const r = resolveUtility("font-[550]", null, false, theme);
		expect(r!.declarations[0].property).toBe("font-weight");
		expect(r!.declarations[0].value).toBe("550");
	});

	it("text arbitrary values become font-size", () => {
		const r = resolveUtility("text-[clamp(1rem,2vw,2rem)]", null, false, theme);
		expect(r!.declarations[0].property).toBe("font-size");
		expect(r!.declarations[0].value).toBe("clamp(1rem, 2vw, 2rem)");
	});

	it("leading arbitrary values are supported", () => {
		const r = resolveUtility("leading-[1.2]", null, false, theme);
		expect(r!.declarations[0].value).toBe("1.2");
	});

	it("tracking arbitrary values are supported", () => {
		const r = resolveUtility("tracking-[0.02em]", null, false, theme);
		expect(r!.declarations[0].value).toBe("0.02em");
	});

	it("decoration arbitrary thickness values are supported", () => {
		const r = resolveUtility("decoration-[0.15em]", null, false, theme);
		expect(r!.declarations[0].value).toBe("0.15em");
	});

	it("decoration arbitrary color-like values fall through", () => {
		const r = resolveUtility("decoration-[#ff0000]", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("text-decoration-color");
		expect(r!.declarations[0].value).toBe("#ff0000");
	});

	it("indent spacing values resolve through spacing lookup", () => {
		const r = resolveUtility("indent-4", null, false, theme);
		expect(r!.declarations[0].property).toBe("text-indent");
		expect(r!.declarations[0].value).toBe("calc(4 * var(--spacing))");
	});

	it("indent arbitrary values are supported", () => {
		const r = resolveUtility("indent-[2ch]", null, false, theme);
		expect(r!.declarations[0].value).toBe("2ch");
	});

	it.each([
		["tab", "4", "tab-size", "4"],
		["tab", "[8]", "tab-size", "8"],
		["tab", "[var(--t)]", "tab-size", "var(--t)"],
	])("%s-%s → %s: %s", (util, value, prop, expected) => {
		const r = resolveUtility(util, value, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: expected });
	});

	it("align-[<value>] / align-(<custom-property>) → vertical-align", () => {
		expect(resolveUtility("align", "[12px]", false, theme)!.declarations[0]).toEqual({
			property: "vertical-align",
			value: "12px",
		});
		expect(resolveUtility("align", "[var(--v)]", false, theme)!.declarations[0]).toEqual({
			property: "vertical-align",
			value: "var(--v)",
		});
	});

	it("indent-px → text-indent: 1px", () => {
		const r = resolveUtility("indent-px", null, false, theme);
		expect(r!.declarations[0].property).toBe("text-indent");
		expect(r!.declarations[0].value).toBe("1px");
	});

	it("leading-px → line-height: 1px", () => {
		const r = resolveUtility("leading-px", null, false, theme);
		expect(r!.declarations[0].property).toBe("line-height");
		expect(r!.declarations[0].value).toBe("1px");
	});

	it("content arbitrary values are supported", () => {
		const r = resolveUtility(`content-['hello']`, null, false, theme);
		expect(r!.declarations[0].value).toBe(`'hello'`);
	});
});

describe("fluid typography utilities", () => {
	it("text-fluid-lg → clamp with vi units", () => {
		const r = resolveUtility("text-fluid", "lg", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("font-size");
		expect(r!.declarations[0].value).toContain("clamp(var(--text-");
		expect(r!.declarations[0].value).toContain("100vi");
	});

	it("text-fluid-4xl → steps back 2 sizes (display size)", () => {
		const r = resolveUtility("text-fluid", "4xl", false, theme);
		expect(r!.declarations[0].value).toContain("var(--text-2xl)");
	});

	it("text-fluid-2xs → returns null (smallest size)", () => {
		const r = resolveUtility("text-fluid", "2xs", false, theme);
		expect(r).toBeNull();
	});

	it("text-fluid-xs → interpolates from 2xs", () => {
		const r = resolveUtility("text-fluid", "xs", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toContain("var(--text-2xs)");
	});

	it("text-fluid custom size interpolates from closest smaller rem size", () => {
		const customTheme = mutableTheme();
		customTheme.text.kilo = { fontSize: "1.375rem", lineHeight: "1.9" };
		const r = resolveUtility("text-fluid", "kilo", false, customTheme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toContain("var(--text-lg)");
		expect(r!.declarations[0].value).toContain("var(--text-kilo)");
	});

	it("text-fluid warns and returns null for non-rem font sizes", () => {
		const customTheme = mutableTheme();
		customTheme.text.pixel = { fontSize: "20px", lineHeight: "28px" };
		const r = resolveUtility("text-fluid", "pixel", false, customTheme);
		expect(r).toBeNull();
		expect(devWarnSpy).toHaveBeenCalledWith(expect.stringContaining("[RI-1501]"));
	});

	it("text-fluid warns when there is no smaller size to interpolate from", () => {
		const customTheme = mutableTheme();
		customTheme.text.unique = { fontSize: "0.5rem", lineHeight: "1" };
		const r = resolveUtility("text-fluid", "unique", false, customTheme);
		expect(r).toBeNull();
		expect(devWarnSpy).toHaveBeenCalledWith(expect.stringContaining("[RI-1502]"));
	});

	// Text overflow
	it("text-clip → text-overflow: clip", () => {
		const r = resolveUtility("text-clip", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "text-overflow", value: "clip" });
	});
	it("text-ellipsis → text-overflow: ellipsis", () => {
		const r = resolveUtility("text-ellipsis", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "text-overflow", value: "ellipsis" });
	});

	// Hyphens
	it.each([
		["hyphens-none", "none"],
		["hyphens-manual", "manual"],
		["hyphens-auto", "auto"],
	])("%s → hyphens: %s", (util, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "hyphens", value: val });
	});

	// Overflow wrap
	it.each([
		["wrap-normal", "normal"],
		["wrap-break-word", "break-word"],
		["wrap-anywhere", "anywhere"],
	])("%s → overflow-wrap: %s", (util, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "overflow-wrap", value: val });
	});

	// Font variant numeric — composable via CSS vars
	it("normal-nums → font-variant-numeric: normal", () => {
		const r = resolveUtility("normal-nums", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "font-variant-numeric", value: "normal" });
	});
	it("tabular-nums sets --ri-numeric-spacing and composed font-variant-numeric", () => {
		const r = resolveUtility("tabular-nums", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "--ri-numeric-spacing", value: "tabular-nums" });
		expect(r!.declarations[1].property).toBe("font-variant-numeric");
	});
	it("ordinal, slashed-zero, lining-nums, diagonal-fractions are registered", () => {
		for (const name of ["ordinal", "slashed-zero", "lining-nums", "diagonal-fractions"]) {
			const r = resolveUtility(name, null, false, theme);
			expect(r, `expected ${name} to resolve`).not.toBeNull();
		}
	});

	// Line clamp
	it("line-clamp-3 sets webkit line-clamp", () => {
		const r = resolveUtility("line-clamp", "3", false, theme);
		const byProp = new Map(r!.declarations.map((d) => [d.property, d.value]));
		expect(byProp.get("overflow")).toBe("hidden");
		expect(byProp.get("display")).toBe("-webkit-box");
		expect(byProp.get("-webkit-box-orient")).toBe("vertical");
		expect(byProp.get("-webkit-line-clamp")).toBe("3");
	});
	it("line-clamp-none resets line-clamp", () => {
		const r = resolveUtility("line-clamp-none", null, false, theme);
		const byProp = new Map(r!.declarations.map((d) => [d.property, d.value]));
		expect(byProp.get("-webkit-line-clamp")).toBe("unset");
		expect(byProp.get("display")).toBe("block");
	});

	// Underline offset
	it("underline-offset-4 → text-underline-offset: 4px", () => {
		const r = resolveUtility("underline-offset", "4", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "text-underline-offset", value: "4px" });
	});
	it("underline-offset-auto → text-underline-offset: auto", () => {
		const r = resolveUtility("underline-offset-auto", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "text-underline-offset", value: "auto" });
	});
	it("underline-offset-[3px] arbitrary", () => {
		const r = resolveUtility("underline-offset", "[3px]", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "text-underline-offset", value: "3px" });
	});

	// Font stretch
	it.each([
		["font-stretch-normal", "normal"],
		["font-stretch-condensed", "condensed"],
		["font-stretch-extra-condensed", "extra-condensed"],
		["font-stretch-semi-expanded", "semi-expanded"],
		["font-stretch-ultra-expanded", "ultra-expanded"],
	])("%s → font-stretch: %s", (util, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "font-stretch", value: val });
	});
	it("font-stretch-50 → font-stretch: 50%", () => {
		const r = resolveUtility("font-stretch", "50", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "font-stretch", value: "50%" });
	});
	it("font-stretch-[80%] arbitrary", () => {
		const r = resolveUtility("font-stretch", "[80%]", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "font-stretch", value: "80%" });
	});

	it("font-features-[<value>] / -(<custom-property>) → font-feature-settings", () => {
		expect(resolveUtility("font-features", '["cv11"_1]', false, theme)!.declarations[0]).toEqual({
			property: "font-feature-settings",
			value: '"cv11" 1',
		});
		expect(resolveUtility("font-features", "[var(--f)]", false, theme)!.declarations[0]).toEqual({
			property: "font-feature-settings",
			value: "var(--f)",
		});
	});

	// List image
	it("list-image-none → list-style-image: none", () => {
		const r = resolveUtility("list-image-none", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "list-style-image", value: "none" });
	});
	it("list-image-[url(bullet.svg)] arbitrary", () => {
		const r = resolveUtility("list-image", "[url(bullet.svg)]", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "list-style-image", value: "url(bullet.svg)" });
	});
	it("list-[<value>] / list-(<custom-property>) → list-style-type", () => {
		expect(resolveUtility("list", "[upper-roman]", false, theme)!.declarations[0]).toEqual({
			property: "list-style-type",
			value: "upper-roman",
		});
		expect(resolveUtility("list", "[var(--t)]", false, theme)!.declarations[0]).toEqual({
			property: "list-style-type",
			value: "var(--t)",
		});
	});
});
