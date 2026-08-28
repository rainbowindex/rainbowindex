import { describe, expect, it } from "vitest";
import { resolveUtility } from "../../../src/utilities/index.js";
import { resolveDirectives } from "../../../src/directives/index.js";
import { parseUtility } from "../../../src/utilities/parser.js";
import { fixtureTheme } from "../../helpers/fixture-colors.js";

// A theme carrying the former default palette, so color utilities resolve.
const theme = fixtureTheme();

describe("utility resolver dispatch", () => {
	it("routes spacing utilities through the spacing resolver", () => {
		const r = resolveUtility("p", "4", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("padding");
		expect(r!.declarations[0].value).toBe("calc(4 * var(--spacing))");
	});
});

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

describe("color utilities", () => {
	it("text-error-500 → color: var(--color-error-500)", () => {
		const r = resolveUtility("text-error-500", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("color");
		expect(r!.declarations[0].value).toBe("var(--color-error-500)");
	});

	it("bg-info-200 → background-color", () => {
		const r = resolveUtility("bg-info-200", null, false, theme);
		expect(r!.declarations[0].property).toBe("background-color");
		expect(r!.declarations[0].value).toBe("var(--color-info-200)");
	});

	it("border-success-300 → border-color", () => {
		const r = resolveUtility("border-success-300", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-color");
	});

	it("outline-general-500 → outline-color", () => {
		const r = resolveUtility("outline-general-500", null, false, theme);
		expect(r!.declarations[0].property).toBe("outline-color");
	});

	it("text-transparent → transparent", () => {
		const r = resolveUtility("text-transparent", null, false, theme);
		expect(r!.declarations[0].value).toBe("transparent");
	});

	it("text-current → currentColor", () => {
		const r = resolveUtility("text-current", null, false, theme);
		expect(r!.declarations[0].value).toBe("currentColor");
	});

	it("bg-paper → var(--color-paper)", () => {
		const r = resolveUtility("bg-paper", null, false, theme);
		expect(r!.declarations[0].value).toBe("var(--color-paper)");
	});

	it("text-[#ff0000] → arbitrary color", () => {
		const r = resolveUtility("text-[#ff0000]", null, false, theme);
		expect(r!.declarations[0].value).toBe("#ff0000");
	});

	it("from-error-500 → gradient from color", () => {
		const r = resolveUtility("from-error-500", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-gradient-from");
	});

	it("via-info-300 → gradient via color", () => {
		const r = resolveUtility("via-info-300", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-gradient-via");
	});

	it("bg-linear-to-r → linear-gradient(to right, ...)", () => {
		const r = resolveUtility("bg-linear-to-r", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-gradient-position");
		expect(r!.declarations[0].value).toContain("to right");
		expect(r!.declarations[1].property).toBe("background-image");
		expect(r!.declarations[1].value).toContain("linear-gradient");
	});
});

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

describe("typography utilities", () => {
	it("text-lg → font-size + line-height", () => {
		const r = resolveUtility("text-lg", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations).toHaveLength(2);
		expect(r!.declarations[0].property).toBe("font-size");
		expect(r!.declarations[1].property).toBe("line-height");
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

	it("italic → font-style: italic", () => {
		const r = resolveUtility("italic", null, false, theme);
		expect(r!.declarations[0].value).toBe("italic");
	});

	it("leading-tight → line-height", () => {
		const r = resolveUtility("leading-tight", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("line-height");
	});

	it("tracking-wide → letter-spacing", () => {
		const r = resolveUtility("tracking-wide", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("letter-spacing");
	});
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

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

	it("relative → position: relative", () => {
		const r = resolveUtility("relative", null, false, theme);
		expect(r!.declarations[0].value).toBe("relative");
	});

	it("items-center → align-items: center", () => {
		const r = resolveUtility("items-center", null, false, theme);
		expect(r!.declarations[0].value).toBe("center");
	});

	it("justify-between → justify-content: space-between", () => {
		const r = resolveUtility("justify-between", null, false, theme);
		expect(r!.declarations[0].value).toBe("space-between");
	});

	it("flex-1 → flex: 1 (v4 concise)", () => {
		const r = resolveUtility("flex-1", null, false, theme);
		expect(r!.declarations[0].value).toBe("1");
	});

	it("shrink-0 → flex-shrink: 0", () => {
		const r = resolveUtility("shrink-0", null, false, theme);
		expect(r!.declarations[0].value).toBe("0");
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

	it("sr-only → screen reader styles", () => {
		const r = resolveUtility("sr-only", null, false, theme);
		expect(r!.declarations.length).toBeGreaterThan(5);
	});

	it("cursor-pointer → cursor: pointer", () => {
		const r = resolveUtility("cursor-pointer", null, false, theme);
		expect(r!.declarations[0].value).toBe("pointer");
	});

	it("aspect-video → aspect-ratio: 16 / 9", () => {
		const r = resolveUtility("aspect-video", null, false, theme);
		expect(r!.declarations[0].value).toBe("16 / 9");
	});

	it("columns-3 → columns: 3", () => {
		const r = resolveUtility("columns-3", null, false, theme);
		expect(r!.declarations[0].value).toBe("3");
	});

	it("object-cover → object-fit: cover", () => {
		const r = resolveUtility("object-cover", null, false, theme);
		expect(r!.declarations[0].value).toBe("cover");
	});

	it("float-start → float: inline-start (logical)", () => {
		const r = resolveUtility("float-start", null, false, theme);
		expect(r!.declarations[0].value).toBe("inline-start");
	});

	it("@container → container-type: inline-size", () => {
		const r = resolveUtility("@container", null, false, theme);
		expect(r!.declarations[0].value).toBe("inline-size");
	});
});

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

describe("sizing utilities", () => {
	it("w-4 → width: calc(4 * var(--spacing))", () => {
		const r = resolveUtility("w-4", null, false, theme);
		expect(r!.declarations[0].property).toBe("width");
	});

	it("w-full → width: 100%", () => {
		const r = resolveUtility("w-full", null, false, theme);
		expect(r!.declarations[0].value).toBe("100%");
	});

	it("h-screen → height: 100vh", () => {
		const r = resolveUtility("h-screen", null, false, theme);
		expect(r!.declarations[0].value).toBe("100vh");
	});

	it("w-1/2 → width: 50%", () => {
		const r = resolveUtility("w-1/2", null, false, theme);
		expect(r!.declarations[0].value).toBe("50%");
	});

	it("max-w-lg → max-width: 32rem", () => {
		const r = resolveUtility("max-w-lg", null, false, theme);
		expect(r!.declarations[0].value).toBe("32rem");
	});

	it("max-w-prose → max-width: 65ch", () => {
		const r = resolveUtility("max-w-prose", null, false, theme);
		expect(r!.declarations[0].value).toBe("65ch");
	});

	it("min-w-0 → min-width: 0px", () => {
		const r = resolveUtility("min-w-0", null, false, theme);
		expect(r!.declarations[0].value).toBe("0px");
	});

	it("size-4 → width + height", () => {
		const r = resolveUtility("size-4", null, false, theme);
		expect(r!.declarations).toHaveLength(2);
		expect(r!.declarations[0].property).toBe("width");
		expect(r!.declarations[1].property).toBe("height");
	});

	it("w-[300px] → arbitrary width", () => {
		const r = resolveUtility("w-[300px]", null, false, theme);
		expect(r!.declarations[0].value).toBe("300px");
	});
});

// ---------------------------------------------------------------------------
// Border
// ---------------------------------------------------------------------------

describe("border utilities", () => {
	it("border → border-width: 1px", () => {
		const r = resolveUtility("border", null, false, theme);
		expect(r!.declarations[0].value).toBe("1px");
	});

	it("border-2 → border-width: 2px", () => {
		const r = resolveUtility("border-2", null, false, theme);
		expect(r!.declarations[0].value).toBe("2px");
	});

	it("rounded-4 → border-radius from the spacing step", () => {
		const r = resolveUtility("rounded-4", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-radius");
		expect(r!.declarations[0].value).toBe("calc(var(--spacing) * 4 * var(--ri-rounded-scale, 1))");
	});

	it("rounded-full → calc(infinity * 1px)", () => {
		const r = resolveUtility("rounded-full", null, false, theme);
		expect(r!.declarations[0].value).toBe("calc(infinity * 1px)");
	});

	it("rounded-t-4 → logical start-start + start-end radius", () => {
		const r = resolveUtility("rounded-t-4", null, false, theme);
		expect(r!.declarations).toHaveLength(2);
		expect(r!.declarations[0].property).toBe("border-start-start-radius");
		expect(r!.declarations[1].property).toBe("border-start-end-radius");
	});

	it("rounded-tl-2 → border-start-start-radius", () => {
		const r = resolveUtility("rounded-tl-2", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-start-start-radius");
	});

	it("divide-y → reverse-aware logical block borders with nested selector", () => {
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
});

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

describe("effects utilities", () => {
	it("shadow → --ri-shadow slot + composed box-shadow", () => {
		const r = resolveUtility("shadow", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-shadow");
		expect(r!.declarations.some((d) => d.property === "box-shadow")).toBe(true);
	});

	it("shadow-lg → var(--shadow-lg)", () => {
		const r = resolveUtility("shadow-lg", null, false, theme);
		expect(r!.declarations[0].value).toContain("--shadow-lg");
	});

	it("opacity-50 → opacity: 50%", () => {
		const r = resolveUtility("opacity-50", null, false, theme);
		expect(r!.declarations[0].value).toBe("50%");
	});

	it("transition → transition properties", () => {
		const r = resolveUtility("transition", null, false, theme);
		expect(r!.declarations.length).toBe(3);
	});

	it("duration-300 → transition-duration: 300ms", () => {
		const r = resolveUtility("duration-300", null, false, theme);
		expect(r!.declarations[0].value).toBe("300ms");
	});

	it("ease-in → timing function from theme", () => {
		const r = resolveUtility("ease-in", null, false, theme);
		expect(r!.declarations[0].property).toBe("transition-timing-function");
	});

	it("translate-x-4 → --ri-translate-x + translate", () => {
		const r = resolveUtility("translate-x-4", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-translate-x");
		expect(r!.declarations[1].property).toBe("translate");
		expect(r!.declarations[1].value).toBe("var(--ri-translate-x, 0) var(--ri-translate-y, 0)");
	});

	it("rotate-45 → rotate: 45deg", () => {
		const r = resolveUtility("rotate-45", null, false, theme);
		expect(r!.declarations[0].value).toBe("45deg");
	});

	it("-rotate-45 → rotate: -45deg", () => {
		const r = resolveUtility("rotate-45", null, true, theme);
		expect(r!.declarations[0].value).toBe("-45deg");
	});

	it("scale-75 sets both axes via vars + shorthand", () => {
		const r = resolveUtility("scale-75", null, false, theme);
		const byProp = new Map(r!.declarations.map((d) => [d.property, d.value]));
		expect(byProp.get("--ri-scale-x")).toBe("75%");
		expect(byProp.get("--ri-scale-y")).toBe("75%");
		expect(byProp.get("scale")).toBe("var(--ri-scale-x, 1) var(--ri-scale-y, 1)");
	});

	it("blur-md → filter: blur(...)", () => {
		const r = resolveUtility("blur-md", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-blur");
		expect(r!.declarations[0].value).toContain("blur(");
		expect(r!.declarations[1].property).toBe("filter");
	});

	it("bg-cover → background-size: cover", () => {
		const r = resolveUtility("bg-cover", null, false, theme);
		expect(r!.declarations[0].value).toBe("cover");
	});

	it("bg-no-repeat → background-repeat: no-repeat", () => {
		const r = resolveUtility("bg-no-repeat", null, false, theme);
		expect(r!.declarations[0].value).toBe("no-repeat");
	});

	it("mask-t-from-<percentage> → top edge position var + composed image", () => {
		const r = resolveUtility("mask-t-from", "50%", false, theme);
		expect(r!.declarations[0].property).toBe("--ri-mask-top-from-position");
		expect(r!.declarations[0].value).toBe("50%");
		expect(r!.declarations[1].property).toBe("mask-image");
		expect(r!.declarations[1].value).toContain("to top");
	});

	it("mask-linear-from-<number> → spacing-based position var", () => {
		const r = resolveUtility("mask-linear-from", "4", false, theme);
		expect(r!.declarations[0].property).toBe("--ri-mask-linear-from-position");
		expect(r!.declarations[0].value).toBe("calc(var(--spacing) * 4)");
	});

	it("removed shorthands (mask-t, mask-25, mask-50) no longer resolve", () => {
		expect(resolveUtility("mask-t", null, false, theme)).toBeNull();
		expect(resolveUtility("mask-25", null, false, theme)).toBeNull();
		expect(resolveUtility("mask-50", null, false, theme)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

describe("animation utilities", () => {
	it("animate-spin → animation: var(--animate-spin)", () => {
		const r = resolveUtility("animate-spin", null, false, theme);
		expect(r!.declarations[0].property).toBe("animation");
	});

	it("animate-in → animation: enter", () => {
		const r = resolveUtility("animate-in", null, false, theme);
		expect(r!.declarations[0].value).toContain("enter");
	});

	it("fade-in → --ri-enter-opacity: 0", () => {
		const r = resolveUtility("fade-in", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-enter-opacity");
		expect(r!.declarations[0].value).toBe("0");
	});

	it("fade-in-50 → --ri-enter-opacity: 0.5", () => {
		const r = resolveUtility("fade-in-50", null, false, theme);
		expect(r!.declarations[0].value).toBe("0.5");
	});

	it("zoom-in-95 → --ri-enter-scale: 0.95", () => {
		const r = resolveUtility("zoom-in-95", null, false, theme);
		expect(r!.declarations[0].value).toBe("0.95");
	});

	it("slide-in-from-top-4 → --ri-enter-translate-y", () => {
		const r = resolveUtility("slide-in-from-top-4", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-enter-translate-y");
	});

	it("slide-in-from-left → --ri-enter-translate-x: -100%", () => {
		const r = resolveUtility("slide-in-from-left", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-enter-translate-x");
		expect(r!.declarations[0].value).toBe("-100%");
	});

	it("animate-duration-300 → animation-duration: 300ms", () => {
		const r = resolveUtility("animate-duration-300", null, false, theme);
		expect(r!.declarations[0].value).toBe("300ms");
	});

	it("animate-infinite → animation-iteration-count: infinite", () => {
		const r = resolveUtility("animate-infinite", null, false, theme);
		expect(r!.declarations[0].value).toBe("infinite");
	});

	it("animate-fill-both → animation-fill-mode: both", () => {
		const r = resolveUtility("animate-fill-both", null, false, theme);
		expect(r!.declarations[0].value).toBe("both");
	});
});

// ---------------------------------------------------------------------------
// Fluid Utilities
// ---------------------------------------------------------------------------

describe("fluid typography utilities", () => {
	it("text-fluid-lg → clamps from the previous theme text size", () => {
		const r = resolveUtility("text-fluid", "lg", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("font-size");
		expect(r!.declarations[0].value).toContain("clamp(var(--text-");
		expect(r!.declarations[0].value).toContain("var(--text-lg))");
		expect(r!.declarations[0].value).toContain("100vi");
		expect(r!.declarations[1].property).toBe("line-height");
		expect(r!.declarations[1].value).toBe("var(--text-lg-leading)");
	});

	it("text-fluid-4xl → steps back 2 sizes (display size)", () => {
		const r = resolveUtility("text-fluid", "4xl", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toContain("var(--text-2xl)");
		expect(r!.declarations[0].value).toContain("var(--text-4xl))");
	});

	it("text-fluid-5xl → steps back 2 sizes (display size)", () => {
		const r = resolveUtility("text-fluid", "5xl", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toContain("var(--text-3xl)");
		expect(r!.declarations[0].value).toContain("var(--text-5xl))");
	});

	it("text-fluid-2xl → steps back 1 size (body size)", () => {
		const r = resolveUtility("text-fluid", "2xl", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toContain("var(--text-xl)");
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

	it("text-fluid-lg respects @fluid text unit and binds to the text bound token", () => {
		const customTheme = resolveDirectives([
			{ type: "fluid", body: "min: 24rem; max: 72rem; unit: vw;", modifier: "text" },
		]);
		const r = resolveUtility("text-fluid", "lg", false, customTheme);
		expect(r).not.toBeNull();
		// Unit is baked; bounds are referenced via the published :root token (the
		// 24rem/72rem values live in the token layer — see spec-compliance), with a
		// fallback to the global --fluid-min.
		expect(r!.declarations[0].value).toContain("100vw");
		expect(r!.declarations[0].value).toContain("var(--fluid-text-min, var(--fluid-min))");
	});
});

describe("fluid spacing utilities", () => {
	it("p-fluid-4 → padding: clamp(1rem, ..., 2rem)", () => {
		const r = resolveUtility("p-fluid", "4", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("padding");
		expect(r!.declarations[0].value).toContain("clamp(1rem");
		expect(r!.declarations[0].value).toContain("2rem)");
		expect(r!.declarations[0].value).toContain("100vw");
		// Viewport bounds are referenced via :root tokens, not baked — the default
		// 20rem/60rem range must not appear inline.
		expect(r!.declarations[0].value).toContain("var(--fluid-spacing-min, var(--fluid-min))");
		expect(r!.declarations[0].value).not.toContain("20rem");
	});

	it("p-fluid-4 respects @fluid spacing unit and multiplier", () => {
		const customTheme = resolveDirectives([
			{
				type: "fluid",
				body: "min: 24rem; max: 72rem; unit: vi; multiplier: 1.5;",
				modifier: "spacing",
			},
		]);
		const r = resolveUtility("p-fluid", "4", false, customTheme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toContain("1.5rem)");
		expect(r!.declarations[0].value).toContain("100vi");
		expect(r!.declarations[0].value).toContain("var(--fluid-spacing-min, var(--fluid-min))");
	});

	it("p-fluid-8 → padding: clamp(2rem, ..., 4rem)", () => {
		const r = resolveUtility("p-fluid", "8", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toContain("clamp(2rem");
		expect(r!.declarations[0].value).toContain("4rem)");
	});

	it("px-fluid-4 → padding-inline: clamp(...)", () => {
		const r = resolveUtility("px-fluid", "4", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("padding-inline");
	});

	it("m-fluid-8 → margin: clamp(...)", () => {
		const r = resolveUtility("m-fluid", "8", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("margin");
	});

	it("mx-fluid-4 → margin-inline: clamp(...)", () => {
		const r = resolveUtility("mx-fluid", "4", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("margin-inline");
	});

	it("gap-fluid-6 → gap: clamp(1.5rem, ..., 3rem)", () => {
		const r = resolveUtility("gap-fluid", "6", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("gap");
		expect(r!.declarations[0].value).toContain("clamp(1.5rem");
		expect(r!.declarations[0].value).toContain("3rem)");
	});

	it("gap-x-fluid-6 → column-gap: clamp(...)", () => {
		const r = resolveUtility("gap-x-fluid", "6", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("column-gap");
	});

	it("p-fluid-0 → null (zero not valid for fluid)", () => {
		const r = resolveUtility("p-fluid", "0", false, theme);
		expect(r).toBeNull();
	});

	it("parser splits px-fluid-8 correctly for fluid spacing", () => {
		const parsed = parseUtility("px-fluid-8");
		expect(parsed.utility).toBe("px-fluid");
		expect(parsed.value).toBe("8");
	});

	it("px-fluid-8 resolves to padding-inline clamp() end-to-end", () => {
		const parsed = parseUtility("px-fluid-8");
		const r = resolveUtility(parsed.utility, parsed.value, parsed.negative, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("padding-inline");
		expect(r!.declarations[0].value).toContain("clamp(");
	});

	it("mt-fluid-4 resolves to margin-block-start clamp() end-to-end", () => {
		const parsed = parseUtility("mt-fluid-4");
		const r = resolveUtility(parsed.utility, parsed.value, parsed.negative, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("margin-block-start");
		expect(r!.declarations[0].value).toContain("clamp(");
	});

	it("gap-x-fluid-6 resolves to column-gap clamp() end-to-end", () => {
		const parsed = parseUtility("gap-x-fluid-6");
		const r = resolveUtility(parsed.utility, parsed.value, parsed.negative, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("column-gap");
		expect(r!.declarations[0].value).toContain("clamp(");
	});

	it("p-fluid-(--x) → runtime clamp() built from the var base", () => {
		const parsed = parseUtility("p-fluid-(--x)");
		expect(parsed.utility).toBe("p-fluid");
		expect(parsed.value).toBe("[var(--x)]");
		const r = resolveUtility(parsed.utility, parsed.value, parsed.negative, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("padding");
		// Default multiplier 2: min = base, max = base * 2, no baked rem endpoints.
		expect(r!.declarations[0].value).toBe(
			"clamp(var(--x), calc(var(--x) + calc(var(--x) * 1) * ((100vw - var(--fluid-spacing-min, var(--fluid-min))) / calc(var(--fluid-spacing-max, var(--fluid-max)) - var(--fluid-spacing-min, var(--fluid-min))))), calc(var(--x) * 2))",
		);
	});

	it("p-fluid-[10px] → runtime clamp() from an arbitrary length base", () => {
		const parsed = parseUtility("p-fluid-[10px]");
		const r = resolveUtility(parsed.utility, parsed.value, parsed.negative, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toContain("clamp(10px,");
		expect(r!.declarations[0].value).toContain("calc(10px * 2)");
	});

	it("-m-fluid-(--x) → negated runtime clamp() for margin", () => {
		const parsed = parseUtility("-m-fluid-(--x)");
		expect(parsed.negative).toBe(true);
		const r = resolveUtility(parsed.utility, parsed.value, parsed.negative, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("margin");
		expect(r!.declarations[0].value).toBe(
			"calc(clamp(var(--x), calc(var(--x) + calc(var(--x) * 1) * ((100vw - var(--fluid-spacing-min, var(--fluid-min))) / calc(var(--fluid-spacing-max, var(--fluid-max)) - var(--fluid-spacing-min, var(--fluid-min))))), calc(var(--x) * 2)) * -1)",
		);
	});

	it("p-fluid-(--x) respects @fluid spacing multiplier", () => {
		const customTheme = resolveDirectives([
			{ type: "fluid", body: "multiplier: 1.5;", modifier: "spacing" },
		]);
		const r = resolveUtility("p-fluid", "[var(--x)]", false, customTheme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toContain("calc(var(--x) * 1.5)");
		expect(r!.declarations[0].value).toContain("calc(var(--x) * 0.5)");
	});
});
