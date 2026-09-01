import { describe, expect, it } from "vitest";
import {
	DEFAULT_COLORS,
	defaultTheme,
	isValidColorSuffix,
	lightnessFromSuffix,
} from "../../src/theme/index.js";

describe("isValidColorSuffix", () => {
	it("accepts integers 1–999", () => {
		expect(isValidColorSuffix(1)).toBe(true);
		expect(isValidColorSuffix(500)).toBe(true);
		expect(isValidColorSuffix(999)).toBe(true);
		expect(isValidColorSuffix(276)).toBe(true);
	});

	it("rejects 0 and 1000", () => {
		expect(isValidColorSuffix(0)).toBe(false);
		expect(isValidColorSuffix(1000)).toBe(false);
	});

	it("rejects non-integers", () => {
		expect(isValidColorSuffix(50.5)).toBe(false);
		expect(isValidColorSuffix(-1)).toBe(false);
	});
});

describe("lightnessFromSuffix", () => {
	it("samples the reference lightness ramp", () => {
		// Stops 50–500 reproduce the example; the dark half descends to near-black.
		expect(lightnessFromSuffix(50)).toBeCloseTo(0.9668, 3);
		expect(lightnessFromSuffix(500)).toBeCloseTo(0.663, 3);
		expect(lightnessFromSuffix(950)).toBeCloseTo(0.045, 3);
	});

	it("is monotonic decreasing in suffix", () => {
		for (const suffix of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
			expect(lightnessFromSuffix(suffix)).toBeGreaterThan(lightnessFromSuffix(suffix + 50));
		}
	});
});

describe("DEFAULT_COLORS", () => {
	it("ships only the achromatic theme palette", () => {
		// Semantic/tonal palettes are no longer bundled — a project declares the
		// colors it needs with @color directives.
		expect(Object.keys(DEFAULT_COLORS)).toEqual(["theme"]);
	});

	it("theme is a generative, zero-chroma neutral", () => {
		const theme = DEFAULT_COLORS["theme"];
		expect(theme.type).toBe("generative");
		if (theme.type === "generative") {
			expect(theme.chroma).toBe(0);
			expect(theme.hue).toBe(0);
		}
	});
});

describe("defaultTheme", () => {
	it("ships no named scale — every token comes from a directive", () => {
		expect(defaultTheme.breakpoints).toEqual({});
		expect(defaultTheme.text).toEqual({});
		expect(defaultTheme.shadows).toEqual({});
		expect(defaultTheme.weights).toEqual({});
		expect(defaultTheme.easing).toEqual({});
		expect(defaultTheme.blur).toEqual({});
		expect(defaultTheme.animations).toEqual({});
		expect(defaultTheme.fluid).toEqual({});
	});

	it("ships the colour palette and the spacing base", () => {
		expect(defaultTheme.spacing.base).toBe("0.25rem");
		expect(Object.keys(defaultTheme.colors).length).toBeGreaterThan(0);
	});

	it("is a complete theme object", () => {
		expect(defaultTheme.spacing).toBeDefined();
		expect(defaultTheme.colors).toBeDefined();
		expect(defaultTheme.text).toBeDefined();
		expect(defaultTheme.breakpoints).toBeDefined();
		expect(defaultTheme.shadows).toBeDefined();
		expect(defaultTheme.weights).toBeDefined();
		expect(defaultTheme.easing).toBeDefined();
		expect(defaultTheme.fluid).toBeDefined();
		expect(defaultTheme.animations).toBeDefined();
		expect(defaultTheme.blur).toBeDefined();
	});

	it("is frozen — shared defaults must not be mutable", () => {
		expect(Object.isFrozen(defaultTheme)).toBe(true);
		expect(Object.isFrozen(DEFAULT_COLORS)).toBe(true);
	});
});
