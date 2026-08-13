import { describe, expect, test } from "vitest";
import {
	CANONICAL_COLOR_STOPS,
	cssColorToHex,
	listThemeTokens,
	oklchToHex,
	resolveColorSwatch,
} from "../../src/theme/swatch.js";
import { generateColorVariables } from "../../src/theme/colors.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";

const theme = analyzeProjectCSS(`
@color {
	brand: 0.18 330;
	accent: oklch(0.72 0.21 330);
	mark: #ff8800;
	surface: oklch(0.98 0.01 260) / oklch(0.15 0.01 260);
	primary: brand;
}
`).theme;

describe("oklch → hex", () => {
	test("white and black anchor the conversion", () => {
		expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
		expect(oklchToHex(0, 0, 0)).toBe("#000000");
	});

	test("css color text conversion handles the definition shapes", () => {
		expect(cssColorToHex("#ff8800")).toBe("#ff8800");
		expect(cssColorToHex("#f80")).toBe("#ff8800");
		expect(cssColorToHex("oklch(1 0 0)")).toBe("#ffffff");
		expect(cssColorToHex("oklch(100% 0 0)")).toBe("#ffffff");
		expect(cssColorToHex("oklch(0.7 0.1 200 / 50%)")).not.toBeNull();
		expect(cssColorToHex("rebeccapurple")).toBeNull();
	});
});

describe("resolveColorSwatch", () => {
	test("generative colors match the emitted CSS variables exactly", () => {
		const def = theme.colors.brand;
		if (def.type !== "generative") throw new Error("expected generative brand");
		const swatch = resolveColorSwatch(theme, "brand", 500);
		expect(swatch).not.toBeNull();
		// The emitted variable is `--color-brand-500: light-dark(<light>, <dark>);`
		const [variable] = generateColorVariables("brand", def, [500], theme.darkConfig, def.dark);
		expect(variable).toContain(swatch?.light.css ?? "");
		expect(variable).toContain(swatch?.dark?.css ?? "");
		expect(swatch?.light.hex).toMatch(/^#[0-9a-f]{6}$/);
		expect(swatch?.dark?.hex).toMatch(/^#[0-9a-f]{6}$/);
		// Stop 500 pivots to itself: its mirror (1000 - 500) is the same stop,
		// so with default dark config light === dark exactly there…
		expect(swatch?.light.hex).toBe(swatch?.dark?.hex);
		// …while every off-center stop mirrors to a different lightness.
		const s200 = resolveColorSwatch(theme, "brand", 200);
		expect(s200?.light.hex).not.toBe(s200?.dark?.hex);
	});

	test("stops darken as the suffix grows", () => {
		const s100 = resolveColorSwatch(theme, "brand", 100);
		const s900 = resolveColorSwatch(theme, "brand", 900);
		expect(s100?.light.css).not.toBe(s900?.light.css);
	});

	test("explicit and hex colors pass through with conversion", () => {
		expect(resolveColorSwatch(theme, "accent")).toEqual({
			light: { css: "oklch(0.72 0.21 330)", hex: expect.stringMatching(/^#[0-9a-f]{6}$/) },
			dark: null,
		});
		expect(resolveColorSwatch(theme, "mark")?.light.hex).toBe("#ff8800");
	});

	test("pairs carry both modes", () => {
		const swatch = resolveColorSwatch(theme, "surface");
		expect(swatch?.light.css).toBe("oklch(0.98 0.01 260)");
		expect(swatch?.dark?.css).toBe("oklch(0.15 0.01 260)");
	});

	test("aliases resolve to their source palette", () => {
		expect(resolveColorSwatch(theme, "primary", 500)).toEqual(
			resolveColorSwatch(theme, "brand", 500),
		);
	});

	test("semantic paper/ink and unknown names", () => {
		expect(resolveColorSwatch(theme, "paper")?.light.hex).toBe("#ffffff");
		expect(resolveColorSwatch(theme, "ink")?.dark?.hex).toBe("#ffffff");
		expect(resolveColorSwatch(theme, "nope")).toBeNull();
	});

	test("dark mode off drops the dark swatch", () => {
		const offTheme = analyzeProjectCSS(`
@color { brand: 0.18 330; }
@color dark { mode: off; }
`).theme;
		expect(resolveColorSwatch(offTheme, "brand", 500)?.dark).toBeNull();
	});

	test("dark mode off drops the pair's dark side too", () => {
		const offTheme = analyzeProjectCSS(`
@color { surface: oklch(0.98 0.01 260) / oklch(0.15 0.01 260); }
@color dark { mode: off; }
`).theme;
		const swatch = resolveColorSwatch(offTheme, "surface");
		expect(swatch?.light.css).toBe("oklch(0.98 0.01 260)");
		expect(swatch?.dark).toBeNull();
	});

	test("a user-defined palette wins over the semantic fallback", () => {
		// The resolver accepts white/paper/… as regular color names and emits
		// --color-white-* stops from the user's palette; the swatch must
		// mirror those variables, not the fixed semantic values.
		const userTheme = analyzeProjectCSS(`@color { white: 0.02 30; }`).theme;
		const swatch = resolveColorSwatch(userTheme, "white", 300);
		expect(swatch?.light.hex).not.toBe("#ffffff");
		expect(swatch?.light.css).toMatch(/^oklch\(/);
		expect(swatch?.dark).not.toBeNull();
		// The semantic fallback still applies when the theme doesn't define it.
		expect(resolveColorSwatch(theme, "white")?.light.hex).toBe("#ffffff");
	});
});

describe("listThemeTokens", () => {
	test("returns render-ready namespaces", () => {
		const tokens = listThemeTokens(theme);
		expect(tokens.colors.find((c) => c.name === "brand")).toEqual({
			name: "brand",
			kind: "generative",
		});
		expect(tokens.colorStops).toBe(CANONICAL_COLOR_STOPS);
		expect(tokens.spacingBase).toMatch(/rem$/);
		expect(tokens.textSizes.some((t) => t.name === "lg")).toBe(true);
		expect(Object.keys(tokens.breakpoints).length).toBeGreaterThan(0);
		expect(tokens.fonts).toEqual([]);
		expect(Object.keys(tokens.weights)).toContain("bold");
	});
});
