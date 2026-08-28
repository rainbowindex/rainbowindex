import { describe, expect, it } from "vitest";
import {
	DEFAULT_BREAKPOINTS,
	DEFAULT_COLORS,
	DEFAULT_SHADOWS,
	DEFAULT_TEXT,
	DEFAULT_WEIGHTS,
	isValidColorSuffix,
	lightnessFromSuffix,
	defaultTheme,
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

describe("DEFAULT_TEXT", () => {
	it("has 14 sizes", () => {
		expect(Object.keys(DEFAULT_TEXT)).toHaveLength(14);
	});

	it("md is 1rem", () => {
		expect(DEFAULT_TEXT["md"].fontSize).toBe("1rem");
	});

	it("sizes increase", () => {
		const sizes = Object.values(DEFAULT_TEXT).map((s) => Number.parseFloat(s.fontSize));
		for (let i = 1; i < sizes.length; i++) {
			expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
		}
	});
});

describe("DEFAULT_BREAKPOINTS", () => {
	it("has 4 breakpoints", () => {
		expect(Object.keys(DEFAULT_BREAKPOINTS)).toHaveLength(4);
	});

	it("values increase", () => {
		const vals = Object.values(DEFAULT_BREAKPOINTS).map((v) => Number.parseFloat(v));
		for (let i = 1; i < vals.length; i++) {
			expect(vals[i]).toBeGreaterThan(vals[i - 1]);
		}
	});
});

describe("DEFAULT_SHADOWS", () => {
	it("has none as transparent", () => {
		expect(DEFAULT_SHADOWS["none"]).toBe("0 0 #0000");
	});

	it("ships class-facing tokens (px through 2xl)", () => {
		for (const name of ["px", "2xs", "xs", "sm", "md", "lg", "xl", "2xl"]) {
			expect(DEFAULT_SHADOWS[name]).toBeDefined();
		}
	});

	it("ships building-block tokens referenced by class-facing values", () => {
		for (const name of [
			"line",
			"drop",
			"hi-1",
			"hi-2",
			"hi-3",
			"hi-4",
			"dark-line",
			"ring",
			"layer-1",
			"layer-2",
			"layer-3",
			"layer-4",
			"layer-5",
			"layer-6",
			"layer-7",
		]) {
			expect(DEFAULT_SHADOWS[name]).toBeDefined();
		}
	});

	it("class-facing tokens reference building blocks via var(--shadow-*)", () => {
		// shadow-md should reference ring, layer-1..layer-4, hi-3, dark-line.
		const md = DEFAULT_SHADOWS["md"]!;
		expect(md).toContain("var(--shadow-ring)");
		expect(md).toContain("var(--shadow-layer-1)");
		expect(md).toContain("var(--shadow-layer-4)");
		expect(md).toContain("var(--shadow-hi-3)");
	});
});

describe("DEFAULT_WEIGHTS", () => {
	it("normal is 400", () => {
		expect(DEFAULT_WEIGHTS["normal"]).toBe(400);
	});

	it("bold is 700", () => {
		expect(DEFAULT_WEIGHTS["bold"]).toBe(700);
	});
});

describe("defaultTheme", () => {
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
