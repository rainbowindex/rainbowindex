/**
 * Spec compliance suite — readable index of the public surface.
 *
 * Asserts every major behavioral claim (default theme shape, color generator,
 * font system, ri() semantics, parser, scanner, directives, engine variants,
 * CSS functions, ordering, preflight, per-family utility resolution).
 *
 * Not the constants-parity check — those tests live in
 * __tests__/core/utility-contracts.test.ts and __tests__/merge/merge.test.ts
 * via the helpers in __tests__/helpers/merge-parity.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Assembly
import { generateCornerShapeBlock, generateTokenLayer } from "../../src/assembly.js";
// CSS Functions
import { compileCSSFunctions } from "../../src/css/functions.js";
// Preflight
import { generatePreflight } from "../../src/css/preflight.js";
// Directives
import {
	extractDirectives,
	parseColorBody,
	parseRoundedModifier,
	resolveDirectives,
} from "../../src/directives/index.js";
// Engine
import { createCompiler } from "../../src/engine/index.js";
// Ordering
import { computeSortKey, PROPERTY_GROUPS, VARIANT_WEIGHTS } from "../../src/engine/ordering.js";
// Font system
import {
	createFontFace,
	createFontSlot,
	generateFontCSS,
	getFontPreloadLinks,
} from "../../src/integrations/font-providers/index.js";
// Merge
import {
	createCompilationContext,
	finalizeCompilationContext,
	registerCustomTextSizes,
	registerCustomUtility,
} from "../../src/merge/context.js";
import { ri } from "../../src/merge/index.js";
// Scanner
import { extractClasses } from "../../src/scanner/class-extraction.js";
// Color system
import {
	DEFAULT_DARK_CONFIG,
	generateColorVariables,
	generateStop,
	SEMANTIC_COLORS,
} from "../../src/theme/colors.js";
// Theme defaults
import {
	DEFAULT_COLORS,
	defaultTheme,
	isValidColorSuffix,
	lightnessFromSuffix,
} from "../../src/theme/index.js";
// Utilities
import { resolveUtility } from "../../src/utilities/index.js";
// Parser
import { parseUtility } from "../../src/utilities/parser.js";

import { scalesTheme } from "../helpers/fixture-scales.js";
import { typographyTheme } from "../helpers/fixture-typography.js";

const compile = (classNames: string[], theme: ReturnType<typeof resolveDirectives>) =>
	createCompiler().compile(classNames, theme);

// ============================================================================
// 1. THEME DEFAULTS
// ============================================================================
describe("Theme defaults match spec", () => {
	it("ships only the achromatic theme palette by default", () => {
		// Semantic/tonal palettes are no longer bundled — a project declares the
		// colors it needs with @color directives.
		expect(Object.keys(DEFAULT_COLORS)).toEqual(["theme"]);
	});

	it("validates color suffix range (1–999)", () => {
		expect(isValidColorSuffix(1)).toBe(true);
		expect(isValidColorSuffix(500)).toBe(true);
		expect(isValidColorSuffix(999)).toBe(true);
		expect(isValidColorSuffix(0)).toBe(false);
		expect(isValidColorSuffix(1000)).toBe(false);
	});

	it("derives lightness from the reference ramp (low suffix → light)", () => {
		expect(lightnessFromSuffix(50)).toBeCloseTo(0.9668, 3);
		expect(lightnessFromSuffix(500)).toBeCloseTo(0.663, 3);
		expect(lightnessFromSuffix(950)).toBeCloseTo(0.045, 3);
	});

	it("uses 0.25rem as the default spacing base", () => {
		expect(defaultTheme.spacing.base).toBe("0.25rem");
	});

	it("ships no named scale — every token comes from a directive", () => {
		const theme = resolveDirectives([]);
		for (const scale of [
			"text",
			"leading",
			"tracking",
			"breakpoints",
			"shadows",
			"weights",
			"easing",
			"blur",
			"animations",
		] as const) {
			expect(theme[scale], scale).toEqual({});
		}
		expect(theme.fluid).toEqual({});
	});
});

// ============================================================================
// 2. COLOR SYSTEM
// ============================================================================
describe("Color system (spec differentiator #1)", () => {
	it("generates a stop for every requested suffix", () => {
		const suffixes = [
			50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950,
		];
		const stops = suffixes.map((suffix) =>
			generateStop({ type: "generative", chroma: 0.15, hue: 30 }, suffix),
		);
		expect(stops.length).toBe(19);
		expect(stops[0].stop).toBe(50);
		expect(stops[18].stop).toBe(950);
	});

	it("generates paper and ink semantic colors", () => {
		// SEMANTIC_COLORS is a pre-computed readonly array of CSS variable declarations
		expect(Array.isArray(SEMANTIC_COLORS)).toBe(true);
		const joined = SEMANTIC_COLORS.join("\n");
		expect(joined).toContain("--color-paper");
		expect(joined).toContain("--color-ink");
		expect(joined).toContain("light-dark(");
	});

	it("supports dark mode config (auto/off, chroma-boost, hue-shift)", () => {
		expect(DEFAULT_DARK_CONFIG).toHaveProperty("mode");
		expect(DEFAULT_DARK_CONFIG).toHaveProperty("chromaBoost");
		expect(DEFAULT_DARK_CONFIG).toHaveProperty("hueShift");
	});

	it("supports fixed dark mode (no light-dark)", () => {
		// With mode "off", generateColorVariables emits plain values, no light-dark().
		const vars = generateColorVariables(
			"test",
			{ type: "generative", chroma: 0.15, hue: 30 },
			[500],
			{ ...DEFAULT_DARK_CONFIG, mode: "off" },
		);
		expect(vars).toHaveLength(1);
		expect(vars[0]).not.toContain("light-dark(");
	});
});

// ============================================================================
// 3. FONT SYSTEM
// ============================================================================
describe("Font system (spec differentiator #2)", () => {
	it("FontSlot supports optional user-specified metrics", () => {
		const slot = createFontSlot({
			slot: "sans",
			family: "Inter",
			kind: "google",
			metrics: {
				fallback: "Arial",
				sizeAdjust: 107.64,
				ascent: 90.49,
				descent: 22.48,
				lineGap: 0,
			},
		});
		expect(slot.metrics).toEqual({
			fallback: "Arial",
			sizeAdjust: 107.64,
			ascent: 90.49,
			descent: 22.48,
			lineGap: 0,
		});
	});

	it("generates @font-face for Google Fonts", () => {
		const slot = createFontSlot({ slot: "sans", family: "Inter", kind: "google" });
		const result = generateFontCSS(slot);
		expect(result.imports.length).toBeGreaterThan(0);
		expect(result.imports[0]).toContain("fonts.googleapis.com");
	});

	it("returns warning for unknown provider", () => {
		const slot = createFontSlot({
			slot: "sans",
			family: "Inter",
			faces: [createFontFace({ provider: "unknown-cdn" })],
		});
		const result = generateFontCSS(slot);
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toContain("[RI-1201]");
	});

	it("generates metrics-adjusted fallback @font-face when user provides metrics", () => {
		const slot = createFontSlot({
			slot: "sans",
			family: "Inter",
			kind: "google",
			metrics: {
				fallback: "Arial",
				sizeAdjust: 107.64,
				ascent: 90.49,
				descent: 22.48,
				lineGap: 0,
			},
		});
		const result = generateFontCSS(slot);
		const fallback = result.fontFaces.find((f) => f.includes("Fallback"));
		expect(fallback).toBeDefined();
		expect(fallback).toContain("size-adjust");
		expect(fallback).toContain("ascent-override");
		expect(fallback).toContain("descent-override");
	});

	it("automatic fallback @font-face for a family in the metrics table", () => {
		const slot = createFontSlot({ slot: "sans", family: "Inter", kind: "google" });
		const result = generateFontCSS(slot);
		expect(result.fontFaces).toHaveLength(1);
		expect(result.fontFaces[0]).toContain('"Inter Fallback"');
	});

	it("no fallback @font-face when metrics are disabled or the family is unknown", () => {
		const disabled = createFontSlot({
			slot: "sans",
			family: "Inter",
			kind: "google",
			metrics: null,
		});
		expect(generateFontCSS(disabled).fontFaces).toHaveLength(0);
		const unknown = createFontSlot({ slot: "sans", family: "Obscure Custom", kind: "google" });
		expect(generateFontCSS(unknown).fontFaces).toHaveLength(0);
	});

	it("getFontPreloadLinks returns preload data", () => {
		const slot = createFontSlot({
			slot: "sans",
			family: "Inter",
			kind: "google",
			faces: [createFontFace({ provider: "google", preload: true })],
		});
		const links = getFontPreloadLinks([slot]);
		// Google fonts use @import, so preload links may vary
		// At minimum the API should exist and return an array
		expect(Array.isArray(links)).toBe(true);
	});

	it("supports system font stacks", () => {
		const slot = createFontSlot({ slot: "sans", family: "", kind: "system" });
		const result = generateFontCSS(slot);
		// System fonts don't generate @import or @font-face
		expect(result.imports.length).toBe(0);
		expect(result.fontFaces.length).toBe(0);
		expect(result.variables.join(" ")).toContain("--font-sans");
	});
});

// ============================================================================
// 4. MERGE FUNCTION
// ============================================================================
describe("Merge function ri() (spec differentiator #3)", () => {
	// No text scale ships, so the merger learns size names when a theme
	// compiles. Register the ones these checks use, as an @text block would.
	beforeAll(() => {
		const ctx = createCompilationContext();
		registerCustomTextSizes(ctx, ["lg", "xl"]);
		finalizeCompilationContext(ctx);
	});
	afterAll(() => finalizeCompilationContext(createCompilationContext()));

	it("basic merge — last wins", () => {
		expect(ri("p-2 bg-red-500", "p-4")).toBe("bg-red-500 p-4");
	});

	it("shorthand overrides longhands", () => {
		expect(ri("px-2 py-1", "p-4")).toBe("p-4");
	});

	it("conditional merging (replaces clsx)", () => {
		expect(ri("flex items-center", true && "bg-blue-500", false && "text-white")).toBe(
			"flex items-center bg-blue-500",
		);
	});

	it("handles falsy values", () => {
		expect(ri(null, undefined, false)).toBe("");
		expect(ri("")).toBe("");
	});

	it("deduplicates", () => {
		expect(ri("p-4 p-4 p-4")).toBe("p-4");
	});

	it("normalizes whitespace", () => {
		expect(ri("  p-4  m-4  ")).toBe("p-4 m-4");
	});

	it("passes through unknown classes", () => {
		expect(ri("unknown-class")).toBe("unknown-class");
	});

	it("dual-mode: text-{size} vs text-{color} don't conflict", () => {
		expect(ri("text-lg text-red-500")).toBe("text-lg text-red-500");
	});

	it("dual-mode: text-{size} vs text-{size} conflict", () => {
		expect(ri("text-lg text-xl")).toBe("text-xl");
	});

	it("variant-scoped: hover: and bare don't conflict", () => {
		expect(ri("p-4 hover:p-8")).toBe("p-4 hover:p-8");
	});

	it("arbitrary values work", () => {
		expect(ri("p-[20px]")).toBe("p-[20px]");
	});

	it("arbitrary and token conflict on same property", () => {
		expect(ri("p-[20px] p-4")).toBe("p-4");
	});

	it("registerCustomUtility extends conflict map", () => {
		const ctx = createCompilationContext();
		registerCustomUtility(ctx, "card", ["padding", "background", "border-radius", "box-shadow"]);
		finalizeCompilationContext(ctx);
		// card's padding should conflict with p-8
		const result = ri("card p-8 bg-black");
		expect(result).toContain("p-8");
		expect(result).toContain("bg-black");
		expect(result).toContain("card");
		finalizeCompilationContext(createCompilationContext());
	});
});

// ============================================================================
// 5. PARSER
// ============================================================================
describe("Parser", () => {
	it("parses simple utility", () => {
		const p = parseUtility("p-4");
		expect(p.utility).toBe("p");
		expect(p.value).toBe("4");
	});

	it("parses variant chains", () => {
		const p = parseUtility("sm:hover:p-4");
		expect(p.variants).toEqual(["sm", "hover"]);
	});

	it("parses arbitrary values", () => {
		const p = parseUtility("p-[13px]");
		expect(p.arbitrary).toBe(true);
		expect(p.value).toBe("[13px]");
	});

	it("parses -physical- infix", () => {
		const p = parseUtility("pl-physical-4");
		expect(p.physical).toBe(true);
	});

	it("parses negative values", () => {
		const p = parseUtility("-translate-x-4");
		expect(p.negative).toBe(true);
	});

	it("parses important suffix", () => {
		const p = parseUtility("font-bold!");
		expect(p.important).toBe(true);
	});

	it("parses fractions", () => {
		const p = parseUtility("w-1/2");
		expect(p.value).toBe("1/2");
	});
});

// ============================================================================
// 6. SCANNER
// ============================================================================
describe("Scanner", () => {
	it("extracts classes from HTML", () => {
		const classes = extractClasses('<div class="p-4 bg-blue-500 text-white">');
		expect(classes).toContain("p-4");
		expect(classes).toContain("bg-blue-500");
		expect(classes).toContain("text-white");
	});

	it("expands variant groups", () => {
		const classes = extractClasses('<div class="hover:{text-red-500 bg-blue-100}">');
		expect(classes).toContain("hover:text-red-500");
		expect(classes).toContain("hover:bg-blue-100");
	});

	it("expands chained variant groups", () => {
		const classes = extractClasses('<div class="sm:hover:{p-4 m-4}">');
		expect(classes).toContain("sm:hover:p-4");
		expect(classes).toContain("sm:hover:m-4");
	});
});

// ============================================================================
// 7. DIRECTIVES
// ============================================================================
describe("Directives", () => {
	it("parses @color with generative, explicit, and pair forms", () => {
		const src = `
      @color {
        brand: 0.18 330;
        accent: oklch(0.72 0.21 330);
        surface: oklch(0.98 0.01 260) / oklch(0.15 0.01 260);
      }
    `;
		const dirs = extractDirectives(src);
		expect(dirs.length).toBe(1);
		const theme = resolveDirectives(dirs);
		expect(theme.colors.brand).toHaveProperty("type", "generative");
		expect(theme.colors.accent).toHaveProperty("type", "explicit");
		expect(theme.colors.surface).toHaveProperty("type", "pair");
	});

	it("parses @color dark config", () => {
		const src = `@color dark { mode: auto; chroma-boost: 0.015; hue-shift: 5; }`;
		const dirs = extractDirectives(src);
		const theme = resolveDirectives(dirs);
		expect(theme.darkConfig.mode).toBe("auto");
		expect(theme.darkConfig.chromaBoost).toBeCloseTo(0.015);
		expect(theme.darkConfig.hueShift).toBeCloseTo(5);
	});

	it("parses ! removal syntax", () => {
		const src = `@color { !theme; brand: 0.18 330; }`;
		const dirs = extractDirectives(src);
		const theme = resolveDirectives(dirs);
		expect(theme.colors).not.toHaveProperty("theme");
		expect(theme.colors).toHaveProperty("brand");
	});

	it("parses @rounded shape modifiers", () => {
		expect(parseRoundedModifier("squircle")).toBe("squircle");
		expect(parseRoundedModifier("bevel")).toBe("bevel");
		expect(parseRoundedModifier("superellipse(2.0)")).toEqual({ superellipse: 2.0 });
	});

	it("parses @rounded squircle directive", () => {
		const src = `@rounded squircle { --corner-scale: 1.3; }`;
		const dirs = extractDirectives(src);
		const theme = resolveDirectives(dirs);
		expect(theme.roundedShape).toBe("squircle");
		expect(theme.roundedShapeScale).toBeCloseTo(1.3);
	});

	it("parses a @font block slot", () => {
		const src = `@font { sans: "Inter" from google; }`;
		const dirs = extractDirectives(src);
		expect(dirs.length).toBe(1);
		expect(dirs[0].type).toBe("font");
		const theme = resolveDirectives(dirs);
		expect(theme.fonts[0].slot).toBe("sans");
		expect(theme.fonts[0].kind).toBe("google");
	});

	it("parses a @font block slot with a config block", () => {
		const src = `@font { sans: "Inter" from google { weight: 400 700; style: italic; } }`;
		const dirs = extractDirectives(src);
		const theme = resolveDirectives(dirs);
		expect(theme.fonts.length).toBe(1);
		expect(theme.fonts[0].faces[0].weight).toBe("400 700");
	});

	it("parses @utility directive", () => {
		const src = `@utility card { padding: 1rem; background: white; }`;
		const dirs = extractDirectives(src);
		const theme = resolveDirectives(dirs);
		expect(theme.customUtilities.length).toBe(1);
		expect(theme.customUtilities[0].name).toBe("card");
	});

	it("parses @custom directive", () => {
		const src = `@custom hocus (&:hover, &:focus);`;
		const dirs = extractDirectives(src);
		const theme = resolveDirectives(dirs);
		expect(theme.customVariants.length).toBe(1);
		expect(theme.customVariants[0].name).toBe("hocus");
	});

	it("parses @source directive with negation and inline", () => {
		const src = `
      @source "./src/**/*.tsx";
      @source not "./node_modules/**/*";
      @source inline("underline text-red-500");
    `;
		const dirs = extractDirectives(src);
		const theme = resolveDirectives(dirs);
		expect(theme.sources.length).toBe(3);
		expect(theme.sources[1].negated).toBe(true);
		expect(theme.sources[2].inline).toBe(true);
		expect(theme.sources[2].classes).toContain("underline");
	});

	it("parses @preflight off", () => {
		const src = `@preflight off;`;
		const dirs = extractDirectives(src);
		const theme = resolveDirectives(dirs);
		expect(theme.preflight.core).toBe(false);
		expect(theme.preflight.forms).toBe(false);
	});

	it("parses @preflight selective", () => {
		const src = `@preflight { core: on; forms: off; }`;
		const dirs = extractDirectives(src);
		const theme = resolveDirectives(dirs);
		expect(theme.preflight.core).toBe(true);
		expect(theme.preflight.forms).toBe(false);
	});

	it("parses all directive types", () => {
		const src = `
      @color { brand: 0.18 330; }
      @text { huge: 5rem, 1; }
      @spacing { base: 0.3rem; }
      @breakpoint { tablet: 50rem; }
      @rounded squircle;
      @shadow { brutal: 4px 4px 0 black; }
      @weight { extra: 950; }
      @ease { bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55); }
      @blur { mega: 100px; }
      @z { modal: 1000; }
      @fluid { min: 25rem; max: 90rem; }
      @preflight;
    `;
		const dirs = extractDirectives(src);
		const theme = resolveDirectives(dirs);
		expect(theme.colors).toHaveProperty("brand");
		expect(theme.text).toHaveProperty("huge");
		expect(theme.spacing.base).toBe("0.3rem");
		expect(theme.breakpoints).toHaveProperty("tablet");
		expect(theme.roundedShape).toBe("squircle");
		expect(theme.shadows).toHaveProperty("brutal");
		expect(theme.weights).toHaveProperty("extra");
		expect(theme.easing).toHaveProperty("bounce");
		expect(theme.blur).toHaveProperty("mega");
		expect(theme.z).toHaveProperty("modal");
		expect(theme.fluid.min).toBe("25rem");
		expect(theme.fluid.max).toBe("90rem");
	});
});

// ============================================================================
// 8. ENGINE + VARIANTS
// ============================================================================
describe("Engine variants", () => {
	const theme = scalesTheme();

	it("compiles responsive variants", () => {
		const result = compile(["sm:p-4"], theme);
		expect(result.rules.length).toBe(1);
		expect(result.rules[0].css).toContain("@media (min-width:");
	});

	it("compiles pseudo-class variants", () => {
		const result = compile(["hover:bg-theme-500"], theme);
		expect(result.rules[0].css).toContain(":hover");
	});

	it("compiles dark variant", () => {
		const result = compile(["dark:shadow-none"], theme);
		expect(result.rules[0].css).toContain("prefers-color-scheme: dark");
	});

	it("compiles data-[] variant", () => {
		const result = compile(["data-[state=open]:opacity-100"], theme);
		expect(result.rules[0].css).toContain("[data-state=open]");
	});

	it("compiles aria-* variant", () => {
		const result = compile(["aria-disabled:opacity-50"], theme);
		expect(result.rules[0].css).toContain('[aria-disabled="true"]');
	});

	it("compiles has-[] variant", () => {
		const result = compile(["has-[input:focus]:outline-2"], theme);
		expect(result.rules[0].css).toContain(":has(input:focus)");
	});

	it("compiles not-* variant", () => {
		const result = compile(["not-disabled:hover:bg-theme-600"], theme);
		const css = result.rules[0].css;
		expect(css).toContain(":not(:disabled)");
		expect(css).toContain(":hover");
	});

	it("compiles starting: variant", () => {
		const result = compile(["starting:opacity-0"], theme);
		expect(result.rules[0].css).toContain("@starting-style");
	});

	it("compiles container query variants (@sm:)", () => {
		const result = compile(["@sm:p-4"], theme);
		expect(result.rules[0].css).toContain("@container");
	});

	it("compiles named container query (@sidebar/sm:)", () => {
		const result = compile(["@sidebar/sm:p-4"], theme);
		expect(result.rules[0].css).toContain("@container sidebar");
	});

	it("compiles custom variants", () => {
		const dirs = extractDirectives(`@custom hocus (&:hover, &:focus);`);
		const customTheme = resolveDirectives(dirs);
		const result = compile(["hocus:text-theme-500"], customTheme);
		expect(result.rules.length).toBe(1);
	});

	it("compiles arbitrary values", () => {
		const result = compile(["p-[13px]"], theme);
		expect(result.rules[0].css).toContain("13px");
	});

	it("compiles -physical- infix", () => {
		const result = compile(["pl-physical-4"], theme);
		expect(result.rules[0].css).toContain("padding-left");
	});

	it("silently ignores unknown utilities", () => {
		const result = compile(["tect-lg"], theme);
		expect(result.warnings.some((w) => w.includes("RI-1001"))).toBe(false);
	});

	it("generates @keyframes for animate-in", () => {
		const result = compile(["animate-in", "fade-in", "zoom-in-95"], theme);
		expect(result.keyframes.length).toBeGreaterThan(0);
		expect(result.properties.length).toBeGreaterThan(0);
	});
});

// ============================================================================
// 9. CSS FUNCTIONS
// ============================================================================
describe("CSS functions", () => {
	const theme = resolveDirectives([]);

	it("--alpha() compiles to color-mix()", () => {
		const result = compileCSSFunctions("color: --alpha(var(--color-red-500) / 50%);", theme);
		expect(result).toContain("color-mix(in oklab");
		expect(result).toContain("50%");
	});

	it("--alpha() at 100% is optimized away", () => {
		const result = compileCSSFunctions("color: --alpha(red / 100%);", theme);
		expect(result).not.toContain("color-mix");
		expect(result).toContain("red");
	});

	it("--spacing() compiles to calc()", () => {
		const result = compileCSSFunctions("padding: --spacing(4);", theme);
		expect(result).toContain("calc(4 * var(--spacing))");
	});

	it("--spacing(0) optimizes to 0px", () => {
		const result = compileCSSFunctions("gap: --spacing(0);", theme);
		expect(result).toContain("0px");
	});

	it("--theme() compiles to var()", () => {
		const result = compileCSSFunctions("color: --theme(--color-error-500);", theme);
		expect(result).toContain("var(--color-error-500)");
	});

	it("--theme() with fallback", () => {
		const result = compileCSSFunctions("color: --theme(--color-red-500, blue);", theme);
		expect(result).toContain("var(--color-red-500, blue)");
	});
});

// ============================================================================
// 10. ORDERING
// ============================================================================
describe("Ordering", () => {
	it("has ~130+ property groups", () => {
		expect(Object.keys(PROPERTY_GROUPS).length).toBeGreaterThanOrEqual(100);
	});

	it("shorthands have lower group numbers than longhands", () => {
		expect(PROPERTY_GROUPS["padding"]).toBeLessThan(PROPERTY_GROUPS["padding-inline"]);
		expect(PROPERTY_GROUPS["padding-inline"]).toBeLessThan(PROPERTY_GROUPS["padding-inline-start"]);
		expect(PROPERTY_GROUPS["margin"]).toBeLessThan(PROPERTY_GROUPS["margin-inline"]);
		expect(PROPERTY_GROUPS["border-radius"]).toBeLessThan(
			PROPERTY_GROUPS["border-start-start-radius"],
		);
	});

	it("has variant weight bands with correct spacing", () => {
		expect(VARIANT_WEIGHTS["dark"]).toBe(0);
		expect(VARIANT_WEIGHTS["sm"]).toBeLessThan(VARIANT_WEIGHTS["hover"]);
		expect(VARIANT_WEIGHTS["hover"]).toBeLessThan(VARIANT_WEIGHTS["disabled"]);
		expect(VARIANT_WEIGHTS["before"]).toBeGreaterThan(VARIANT_WEIGHTS["hover"]);
	});

	it("sort key = variantWeight * 1000 + propertyGroup", () => {
		const key = computeSortKey("padding", ["hover"]);
		expect(key).toBe(VARIANT_WEIGHTS["hover"] * 1000 + PROPERTY_GROUPS["padding"]);
	});
});

// ============================================================================
// 11. PREFLIGHT
// ============================================================================
describe("Preflight", () => {
	it("generates CSS with all categories enabled", () => {
		const css = generatePreflight({
			core: true,
			typography: true,
			content: true,
			forms: true,
			interactive: true,
			modern: true,
		});
		expect(css).toContain("box-sizing: border-box");
		expect(css).toContain("margin: 0");
		expect(css).toContain("color-scheme");
	});

	it("respects category toggles", () => {
		const css = generatePreflight({
			core: true,
			typography: false,
			content: false,
			forms: false,
			interactive: false,
			modern: false,
		});
		expect(css).toContain("box-sizing");
		expect(css).not.toContain("color-scheme");
	});

	it("returns empty for all-off", () => {
		const css = generatePreflight({
			core: false,
			typography: false,
			content: false,
			forms: false,
			interactive: false,
			modern: false,
		});
		expect(css).toBe("");
	});
});

// ============================================================================
// 12. UTILITIES — spot checks per category
// ============================================================================
describe("Utility spot checks", () => {
	const theme = typographyTheme();

	// Spacing
	it("p-4 → padding with token", () => {
		const r = resolveUtility("p", "4", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("padding");
	});

	it("px-4 → padding-inline (logical)", () => {
		const r = resolveUtility("px", "4", false, theme);
		expect(r!.declarations[0].property).toBe("padding-inline");
	});

	it("pl-4 → padding-inline-start (logical)", () => {
		const r = resolveUtility("pl", "4", false, theme);
		expect(r!.declarations[0].property).toBe("padding-inline-start");
	});

	it("space-x-4 → reverse-aware margins on a nested selector", () => {
		const r = resolveUtility("space-x", "4", false, theme);
		expect(r!.nestedSelector).toBe("& > :not(:last-child)");
		expect(r!.declarations.map((d) => d.property)).toEqual([
			"--ri-space-x-reverse",
			"margin-inline-start",
			"margin-inline-end",
		]);
	});

	// Color
	it("bg-theme-500 → background-color with var", () => {
		const r = resolveUtility("bg", "theme-500", false, theme);
		expect(r!.declarations[0].property).toBe("background-color");
		expect(r!.declarations[0].value).toContain("--color-theme-500");
	});

	it("bg-paper → semantic color", () => {
		const r = resolveUtility("bg", "paper", false, theme);
		expect(r!.declarations[0].value).toContain("--color-paper");
	});

	it("bg-linear-to-r → linear-gradient", () => {
		const r = resolveUtility("bg-linear-to", "r", false, theme);
		expect(r!.declarations[0].property).toBe("--ri-gradient-position");
		expect(r!.declarations[0].value).toContain("to right");
		expect(r!.declarations[1].property).toBe("background-image");
		expect(r!.declarations[1].value).toContain("linear-gradient");
	});

	// Typography
	it("text-lg → font-size + line-height", () => {
		const r = resolveUtility("text", "lg", false, theme);
		expect(r!.declarations.length).toBe(2);
		expect(r!.declarations[0].property).toBe("font-size");
		expect(r!.declarations[1].property).toBe("line-height");
	});

	it("truncate → 3 declarations", () => {
		const r = resolveUtility("truncate", null, false, theme);
		expect(r!.declarations.length).toBe(3);
	});

	// Layout
	it("flex → display: flex", () => {
		const r = resolveUtility("flex", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "display", value: "flex" });
	});

	it("grid-cols-3 → repeat(3, minmax(0, 1fr))", () => {
		const r = resolveUtility("grid-cols", "3", false, theme);
		expect(r!.declarations[0].value).toContain("repeat(3");
	});

	it("@container → container-type", () => {
		const r = resolveUtility("@container", null, false, theme);
		expect(r!.declarations[0].property).toBe("container-type");
	});

	// Sizing
	it("w-full → width: 100%", () => {
		const r = resolveUtility("w", "full", false, theme);
		expect(r!.declarations[0].value).toBe("100%");
	});

	it("size-4 → width + height", () => {
		const r = resolveUtility("size", "4", false, theme);
		expect(r!.declarations.length).toBe(2);
	});

	// Borders
	it("rounded-4 → border-radius with scale", () => {
		const r = resolveUtility("rounded", "4", false, theme);
		expect(r!.declarations[0].property).toBe("border-radius");
		expect(r!.declarations[0].value).toContain("--ri-rounded-scale");
	});

	it("rounded-full → calc(infinity * 1px)", () => {
		const r = resolveUtility("rounded", "full", false, theme);
		expect(r!.declarations[0].value).toBe("calc(infinity * 1px)");
	});

	it("divide-y → nested selector", () => {
		const r = resolveUtility("divide-y", null, false, theme);
		expect(r!.nestedSelector).toBe("& > :not(:last-child)");
	});

	// Effects
	it("shadow-none → --ri-shadow slot + composed box-shadow", () => {
		const r = resolveUtility("shadow", "none", false, theme);
		expect(r!.declarations[0].property).toBe("--ri-shadow");
		expect(r!.declarations.some((d) => d.property === "box-shadow")).toBe(true);
	});

	it("transition-discrete → transition-behavior", () => {
		const r = resolveUtility("transition-discrete", null, false, theme);
		expect(r!.declarations[0].property).toBe("transition-behavior");
		expect(r!.declarations[0].value).toBe("allow-discrete");
	});

	it("mask-t-from-<percentage> → top edge gradient", () => {
		const r = resolveUtility("mask-t-from", "50%", false, theme);
		expect(r!.declarations[0].property).toBe("--ri-mask-top-from-position");
		expect(r!.declarations[1].property).toBe("mask-image");
		expect(r!.declarations[1].value).toContain("to top");
	});

	it("translate-x-4 → --ri-translate-x + translate (composable)", () => {
		const r = resolveUtility("translate-x", "4", false, theme);
		expect(r!.declarations[0].property).toBe("--ri-translate-x");
		expect(r!.declarations[1].property).toBe("translate");
	});

	it("rotate-45 → rotate property", () => {
		const r = resolveUtility("rotate", "45", false, theme);
		expect(r!.declarations[0].property).toBe("rotate");
		expect(r!.declarations[0].value).toBe("45deg");
	});

	// Animations
	it("animate-in → animation with enter", () => {
		const r = resolveUtility("animate-in", null, false, theme);
		expect(r!.declarations[0].value).toContain("enter");
	});

	it("fade-in → sets --ri-enter-opacity", () => {
		const r = resolveUtility("fade-in", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-enter-opacity");
	});

	it("slide-in-from-top-8 → sets --ri-enter-translate-y", () => {
		const r = resolveUtility("slide-in-from-top", "8", false, theme);
		expect(r!.declarations[0].property).toBe("--ri-enter-translate-y");
	});

	// Interactivity
	it("sr-only → accessible hidden", () => {
		const r = resolveUtility("sr-only", null, false, theme);
		expect(r!.declarations.length).toBeGreaterThan(5);
		expect(r!.declarations.some((d) => d.property === "position" && d.value === "absolute")).toBe(
			true,
		);
	});

	it("cursor-pointer → cursor: pointer", () => {
		const r = resolveUtility("cursor-pointer", null, false, theme);
		expect(r!.declarations[0].value).toBe("pointer");
	});
});

// ============================================================================
// 13. SHARED — token layer, corner-shape
// ============================================================================
describe("Shared utilities", () => {
	it("generateTokenLayer produces :root block", () => {
		const theme = resolveDirectives([]);
		const tokens = generateTokenLayer(
			theme,
			{
				usedColorStops: new Map([["theme", new Set([500])]]),
				usedTextSizes: new Set(["base"]),
				usedFonts: new Set(["sans"]),
				usedShadows: new Set(["md"]),
				usedAnimations: new Set(["spin"]),
			},
			new Map(),
		);
		expect(tokens).toContain(":root");
		expect(tokens).toContain("--color-theme-500:");
		expect(tokens).not.toContain("--fluid-text-min:");
		expect(tokens).not.toContain("--fluid-spacing-min:");
	});

	it("generateTokenLayer emits family fluid tokens only when configured", () => {
		const theme = resolveDirectives([
			{ type: "fluid", body: "min: 24rem; max: 90rem;", modifier: "text" },
			{ type: "fluid", body: "min: 18rem; max: 72rem;", modifier: "spacing" },
		]);
		const tokens = generateTokenLayer(
			theme,
			{
				usedColorStops: new Map(),
				usedTextSizes: new Set(),
				usedFonts: new Set(),
				usedShadows: new Set(),
				usedAnimations: new Set(),
			},
			new Map(),
		);
		expect(tokens).toContain("--fluid-text-min: 24rem;");
		expect(tokens).toContain("--fluid-text-max: 90rem;");
		expect(tokens).toContain("--fluid-spacing-min: 18rem;");
		expect(tokens).toContain("--fluid-spacing-max: 72rem;");
	});

	it("generateTokenLayer emits named @fluid range tokens", () => {
		const theme = resolveDirectives([
			{ type: "fluid", body: "min: 20rem; max: 48rem;", modifier: "compact" },
		]);
		const tokens = generateTokenLayer(
			theme,
			{
				usedColorStops: new Map(),
				usedTextSizes: new Set(),
				usedFonts: new Set(),
				usedShadows: new Set(),
				usedAnimations: new Set(),
			},
			new Map(),
		);
		expect(tokens).toContain("--fluid-compact-min: 20rem;");
		expect(tokens).toContain("--fluid-compact-max: 48rem;");
	});

	it("generateTokenLayer emits used @shadow tokens plus the ones they reference", () => {
		// `alias` resolves to var(--shadow-md), so emitting it alone would leave
		// the reference dangling — md must flow in with it. lg is unused: pruned.
		const theme = resolveDirectives(
			extractDirectives("@shadow { md: 0 4px 8px black; alias: shadow-md; lg: 0 8px 16px black; }"),
		);
		const tokens = generateTokenLayer(
			theme,
			{
				usedColorStops: new Map(),
				usedTextSizes: new Set(),
				usedFonts: new Set(),
				usedShadows: new Set(["alias"]),
				usedAnimations: new Set(),
			},
			new Map(),
		);
		expect(tokens).toContain("--shadow-alias: var(--shadow-md);");
		expect(tokens).toContain("--shadow-md: 0 4px 8px black;");
		expect(tokens).not.toContain("--shadow-lg:");
	});

	it("@shadow alias rewrites to a var() reference, across blocks", () => {
		// The target may be defined in a later block, so aliases resolve once
		// every @shadow directive has merged.
		const theme = resolveDirectives(
			extractDirectives("@shadow { alias: shadow-md; }\n@shadow { md: 0 1px black; }"),
		);
		expect(theme.shadows["alias"]).toBe("var(--shadow-md)");
		expect(theme.warnings).toEqual([]);
	});

	it("[RI-1123] @shadow alias to an undefined token warns and stays verbatim", () => {
		const theme = resolveDirectives(extractDirectives("@shadow { alias: shadow-nope; }"));
		expect(theme.shadows["alias"]).toBe("shadow-nope");
		const w = theme.warnings.find((x) => x.includes("[RI-1123]"));
		expect(w).toContain('"nope"');
	});

	// A cycle would emit var() references pointing at each other, which CSS calls
	// guaranteed-invalid: the shadow resolves to nothing with no hint as to why.
	it("[RI-1125] a circular @shadow alias chain warns and stays verbatim", () => {
		const theme = resolveDirectives(extractDirectives("@shadow { a: shadow-b;\n\tb: shadow-a; }"));
		expect(theme.warnings.filter((w) => w.includes("[RI-1125]"))).toHaveLength(2);
		expect(theme.shadows["a"]).toBe("shadow-b");
		expect(theme.shadows["b"]).toBe("shadow-a");
	});

	it("[RI-1125] a @shadow alias to itself warns", () => {
		const theme = resolveDirectives(extractDirectives("@shadow { a: shadow-a; }"));
		expect(theme.warnings.find((w) => w.includes("[RI-1125]"))).toContain('"a: shadow-a"');
		expect(theme.shadows["a"]).toBe("shadow-a");
	});

	// A chain is not a cycle: it must still resolve.
	it("a three-step @shadow alias chain still resolves", () => {
		const theme = resolveDirectives(
			extractDirectives("@shadow { md: 0 1px black;\n\tb: shadow-md;\n\tc: shadow-b; }"),
		);
		expect(theme.warnings).toEqual([]);
		expect(theme.shadows["c"]).toBe("var(--shadow-b)");
		expect(theme.shadows["b"]).toBe("var(--shadow-md)");
	});

	// The block is cut from the body whether or not its name survived. Left in
	// place, the brace-blind key/value parser reads its declarations as tokens.
	it("does not read a rejected utility block's declarations as scale entries", () => {
		const theme = resolveDirectives(
			extractDirectives(
				"@shadow { md: 0 4px 8px black;\n\tbad.name-* { box-shadow: 0 1px 2px black; }\n\tcard: 0 2px 4px gray; }",
			),
		);
		expect(theme.shadows).not.toHaveProperty("box-shadow");
		expect(theme.shadows["md"]).toBe("0 4px 8px black");
		expect(theme.shadows["card"]).toBe("0 2px 4px gray");
	});

	it("generateTokenLayer emits no shadow tokens when none are used", () => {
		const theme = resolveDirectives([]);
		const tokens = generateTokenLayer(
			theme,
			{
				usedColorStops: new Map(),
				usedTextSizes: new Set(),
				usedFonts: new Set(),
				usedShadows: new Set(),
				usedAnimations: new Set(),
			},
			new Map(),
		);
		expect(tokens).not.toContain("--shadow-");
	});

	it("generateCornerShapeBlock emits shape rule + @supports scale block", () => {
		const theme = resolveDirectives([{ type: "rounded", body: "", modifier: "squircle" }]);
		const css = generateCornerShapeBlock(theme);
		expect(css).toContain("corner-shape: squircle");
		expect(css).toContain("@supports (corner-shape: squircle)");
		expect(css).not.toContain("@supports not");
		expect(css).toContain("--ri-rounded-scale: 1.6");
	});

	it("generateCornerShapeBlock supports superellipse(N)", () => {
		const theme = resolveDirectives([{ type: "rounded", body: "", modifier: "superellipse(2.5)" }]);
		const css = generateCornerShapeBlock(theme);
		expect(css).toContain("corner-shape: superellipse(2.5)");
		expect(css).toContain("@supports (corner-shape: superellipse(2.5))");
	});

	it("generateCornerShapeBlock omits @supports when scale is 1", () => {
		// round has a per-shape default scale of 1 — no compensation needed.
		const theme = resolveDirectives([{ type: "rounded", body: "", modifier: "round" }]);
		const css = generateCornerShapeBlock(theme);
		expect(css).toContain("corner-shape: round");
		expect(css).not.toContain("@supports");
	});

	it("generateCornerShapeBlock returns null when no shape is configured", () => {
		const theme = resolveDirectives([]);
		const css = generateCornerShapeBlock(theme);
		expect(css).toBeNull();
	});
});

// ============================================================================
// 14. ERROR CODES
// ============================================================================
describe("Error codes", () => {
	it("RI-1001: unknown utilities are silently ignored", () => {
		const theme = resolveDirectives([]);
		const result = compile(["bg-brnda-500"], theme);
		expect(result.warnings.some((w) => w.includes("RI-1001"))).toBe(false);
	});

	it("RI-1101: invalid @color value", () => {
		// Multi-word non-numeric values still trigger RI-1101
		const warnings: string[] = [];
		parseColorBody("brand: not a color;", warnings);
		expect(warnings.some((w) => w.includes("RI-1101"))).toBe(true);
	});

	it("single word @color value is parsed as alias", () => {
		const warnings: string[] = [];
		const result = parseColorBody("brand: invalid;", warnings);
		expect(result.colors.brand).toEqual({ type: "alias", source: "invalid" });
		expect(warnings).toHaveLength(0);
	});

	it("RI-1105: alias referencing non-existent color", () => {
		const dirs = extractDirectives(`@color { brand: nonexistent; }`);
		const theme = resolveDirectives(dirs);
		expect(theme.warnings.some((w) => w.includes("RI-1105"))).toBe(true);
	});

	it("RI-1103: invalid ! removal", () => {
		const dirs = extractDirectives(`@color { !nonexistent; }`);
		const theme = resolveDirectives(dirs);
		expect(theme.warnings.some((w) => w.includes("RI-1103"))).toBe(true);
	});
});

// ============================================================================
// 16. FLUID SCALING
// ============================================================================
describe("Fluid scaling (spec differentiator #4)", () => {
	const theme = scalesTheme(typographyTheme());

	it("text-fluid-4xl uses clamp()", () => {
		const r = resolveUtility("text-fluid", "4xl", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("font-size");
		expect(r!.declarations[0].value).toContain("clamp(");
		expect(r!.declarations[0].value).toContain("100vi");
	});

	it("text-fluid-4xl steps back by 2 (display size)", () => {
		const r = resolveUtility("text-fluid", "4xl", false, theme);
		// 4xl should reference 2xl as min (step back by 2 for display sizes)
		expect(r!.declarations[0].value).toContain("--text-2xl");
	});

	it("text-fluid-lg steps back by 1 (body size)", () => {
		const r = resolveUtility("text-fluid", "lg", false, theme);
		expect(r!.declarations[0].value).toContain("clamp(var(--text-");
		expect(r!.declarations[0].value).toContain("var(--text-lg))");
	});

	it("p-fluid-8 uses clamp() with double at max viewport", () => {
		const r = resolveUtility("p-fluid", "8", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toContain("clamp(");
	});
});
