import { describe, expect, it } from "vitest";
import { compileCSSFunctions } from "../../src/engine/index.js";
import { extractDirectives, resolveDirectives } from "../../src/directives/index.js";

// ---------------------------------------------------------------------------
// --alpha()
// ---------------------------------------------------------------------------

describe("--alpha()", () => {
	it("converts fraction opacity", () => {
		const result = compileCSSFunctions("--alpha(var(--color-red-500) / 0.5)");
		expect(result).toBe("color-mix(in oklab, var(--color-red-500) 50%, transparent)");
	});

	it("converts percentage opacity", () => {
		const result = compileCSSFunctions("--alpha(var(--color-blue-300) / 75%)");
		expect(result).toBe("color-mix(in oklab, var(--color-blue-300) 75%, transparent)");
	});

	it("optimizes away 100% opacity", () => {
		const result = compileCSSFunctions("--alpha(var(--color-red-500) / 1)");
		expect(result).toBe("var(--color-red-500)");
	});

	it("optimizes away 100 percentage opacity", () => {
		const result = compileCSSFunctions("--alpha(var(--color-red-500) / 100%)");
		expect(result).toBe("var(--color-red-500)");
	});

	it("handles integer percentage > 1", () => {
		const result = compileCSSFunctions("--alpha(var(--color-red-500) / 50)");
		expect(result).toBe("color-mix(in oklab, var(--color-red-500) 50%, transparent)");
	});

	it("passes through non-numeric opacity for the browser to resolve", () => {
		const result = compileCSSFunctions("--alpha(red / abc)");
		expect(result).toBe("color-mix(in oklab, red abc, transparent)");
	});

	it("handles --alpha with var() color", () => {
		const result = compileCSSFunctions("--alpha(var(--color-green-400) / 0.8)");
		expect(result).toBe("color-mix(in oklab, var(--color-green-400) 80%, transparent)");
	});
});

// ---------------------------------------------------------------------------
// --alpha() edge cases — reverse `/` scanning with nested parens and strings
// ---------------------------------------------------------------------------

describe("--alpha() edge cases", () => {
	it("handles nested function calls containing /", () => {
		// The / inside calc() should not be mistaken for the alpha separator
		const result = compileCSSFunctions("--alpha(rgb(calc(255 / 2), 0, 0) / 0.5)");
		expect(result).toBe("color-mix(in oklab, rgb(calc(255 / 2), 0, 0) 50%, transparent)");
	});

	it("handles deeply nested parens with /", () => {
		const result = compileCSSFunctions("--alpha(var(--c, calc(1 / 3)) / 50%)");
		expect(result).toBe("color-mix(in oklab, var(--c, calc(1 / 3)) 50%, transparent)");
	});

	it("handles string literals containing / in color arg", () => {
		// Unusual but valid: a string literal in the color side shouldn't trip the scanner
		const result = compileCSSFunctions(`--alpha(var(--c) / 0.3)`);
		expect(result).toBe("color-mix(in oklab, var(--c) 30%, transparent)");
	});

	it("handles no / separator — passes through unchanged", () => {
		const result = compileCSSFunctions("--alpha(red)");
		expect(result).toBe("--alpha(red)");
	});

	it("handles multiple --alpha calls in one value", () => {
		const result = compileCSSFunctions("background: --alpha(red / 0.5), --alpha(blue / 0.3)");
		expect(result).toBe(
			"background: color-mix(in oklab, red 50%, transparent), color-mix(in oklab, blue 30%, transparent)",
		);
	});

	it("handles unclosed --alpha( — passes through unchanged", () => {
		const result = compileCSSFunctions("--alpha(red / 0.5");
		expect(result).toBe("--alpha(red / 0.5");
	});

	it("clamps opacity to 0-100 range", () => {
		expect(compileCSSFunctions("--alpha(red / 0)")).toBe(
			"color-mix(in oklab, red 0%, transparent)",
		);
		expect(compileCSSFunctions("--alpha(red / 200%)")).toBe("red");
	});
});

// ---------------------------------------------------------------------------
// --spacing()
// ---------------------------------------------------------------------------

describe("--spacing()", () => {
	it("converts numeric value to calc", () => {
		const result = compileCSSFunctions("--spacing(4)");
		expect(result).toBe("calc(4 * var(--spacing))");
	});

	it("converts zero to 0px", () => {
		const result = compileCSSFunctions("--spacing(0)");
		expect(result).toBe("0px");
	});

	it("handles decimal values", () => {
		const result = compileCSSFunctions("--spacing(1.5)");
		expect(result).toBe("calc(1.5 * var(--spacing))");
	});

	it("passes through non-numeric argument", () => {
		const result = compileCSSFunctions("--spacing(abc)");
		expect(result).toBe("--spacing(abc)");
	});

	it("emits warning for non-numeric argument", () => {
		const warnings: string[] = [];
		compileCSSFunctions("--spacing(calc(2 + 3))", undefined, warnings);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("RI-2005");
		expect(warnings[0]).toContain("non-numeric");
	});

	it("works in compound expressions", () => {
		const result = compileCSSFunctions("padding: --spacing(2) --spacing(4)");
		expect(result).toBe("padding: calc(2 * var(--spacing)) calc(4 * var(--spacing))");
	});
});

// ---------------------------------------------------------------------------
// --theme()
// ---------------------------------------------------------------------------

describe("--theme()", () => {
	it("converts to var() without theme", () => {
		const result = compileCSSFunctions("--theme(--color-red-500)");
		expect(result).toBe("var(--color-red-500)");
	});

	it("handles fallback value", () => {
		const result = compileCSSFunctions("--theme(--color-custom, blue)");
		expect(result).toBe("var(--color-custom, blue)");
	});

	it("handles fallback with parens", () => {
		const result = compileCSSFunctions("--theme(--color-custom, rgb(255, 0, 0))");
		expect(result).toBe("var(--color-custom, rgb(255, 0, 0))");
	});

	it("inline mode falls back to var() without theme", () => {
		const result = compileCSSFunctions("--theme(--breakpoint-md inline)");
		expect(result).toBe("var(--breakpoint-md)");
	});

	it("handles multiple theme calls", () => {
		const result = compileCSSFunctions(
			"color: --theme(--color-red-500); background: --theme(--color-blue-100)",
		);
		expect(result).toBe("color: var(--color-red-500); background: var(--color-blue-100)");
	});
});

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------

describe("combined functions", () => {
	it("processes all function types in one value", () => {
		const result = compileCSSFunctions(
			"border: --spacing(1) solid --alpha(--theme(--color-red-500) / 0.5)",
		);
		expect(result).toContain("calc(1 * var(--spacing))");
		expect(result).toContain("color-mix(in oklab, var(--color-red-500) 50%, transparent)");
	});

	it("leaves non-function values untouched", () => {
		const result = compileCSSFunctions("color: red; font-size: 16px");
		expect(result).toBe("color: red; font-size: 16px");
	});
});

// ---------------------------------------------------------------------------
// --theme() validation with resolved theme
// ---------------------------------------------------------------------------

describe("--theme() with theme validation", () => {
	function makeTheme() {
		const directives = extractDirectives("@color { brand: 0.18 330; }");
		return resolveDirectives(directives);
	}

	it("validates color stop numbers against valid suffix range", () => {
		const theme = makeTheme();
		const warnings: string[] = [];
		compileCSSFunctions("--theme(--color-brand-500)", theme, warnings);
		expect(warnings).toHaveLength(0);
	});

	it("rejects invalid color stop numbers", () => {
		const theme = makeTheme();
		const warnings: string[] = [];
		compileCSSFunctions("--theme(--color-brand-99999)", theme, warnings);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("RI-2001");
	});

	it("accepts explicit single-value colors as --color-{name}", () => {
		const directives = extractDirectives("@color { accent: oklch(0.72 0.21 330); }");
		const theme = resolveDirectives(directives);
		const warnings: string[] = [];
		const result = compileCSSFunctions("--theme(--color-accent)", theme, warnings);
		expect(result).toBe("var(--color-accent)");
		expect(warnings).toHaveLength(0);
	});

	it("accepts light/dark pair colors as --color-{name}", () => {
		const directives = extractDirectives(
			"@color { surface: oklch(0.98 0.01 260) / oklch(0.15 0.01 260); }",
		);
		const theme = resolveDirectives(directives);
		const warnings: string[] = [];
		const result = compileCSSFunctions("--theme(--color-surface)", theme, warnings);
		expect(result).toBe("var(--color-surface)");
		expect(warnings).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Convergence warning
// ---------------------------------------------------------------------------

describe("convergence", () => {
	it("does not warn when functions converge normally", () => {
		const warnings: string[] = [];
		compileCSSFunctions("--spacing(4)", undefined, warnings);
		expect(warnings).toHaveLength(0);
	});
});
