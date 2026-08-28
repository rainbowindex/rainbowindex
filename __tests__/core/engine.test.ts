import { describe, expect, it } from "vitest";
import {
	createCompiler,
	compileCSSFunctions,
	ANIMATION_KEYFRAMES,
	ANIMATION_PROPERTIES,
	renderCSS,
} from "../../src/engine/index.js";
import { escapeSelector } from "../../src/css/escape.js";
import { findClosest } from "../../src/engine/suggest.js";
import { resolveDirectives } from "../../src/directives/index.js";
import { fixtureTheme } from "../helpers/fixture-colors.js";

const theme = fixtureTheme();
const compile = (classNames: string[], activeTheme = theme) =>
	createCompiler().compile(classNames, activeTheme);

// ---------------------------------------------------------------------------
// escapeSelector
// ---------------------------------------------------------------------------

describe("escapeSelector", () => {
	it("escapes brackets", () => {
		expect(escapeSelector("p-[13px]")).toBe("p-\\[13px\\]");
	});

	it("escapes colon", () => {
		expect(escapeSelector("hover:text-red-500")).toBe("hover\\:text-red-500");
	});

	it("escapes dot", () => {
		expect(escapeSelector("w-0.5")).toBe("w-0\\.5");
	});

	it("escapes slash", () => {
		expect(escapeSelector("w-1/2")).toBe("w-1\\/2");
	});

	it("escapes @", () => {
		expect(escapeSelector("@sm:p-4")).toBe("\\@sm\\:p-4");
	});

	it("escapes !", () => {
		expect(escapeSelector("p-4!")).toBe("p-4\\!");
	});

	it("no escaping needed for simple classes", () => {
		expect(escapeSelector("flex")).toBe("flex");
	});

	it("replaces null bytes and escapes whitespace", () => {
		expect(escapeSelector("foo\0 bar")).toBe("foo\uFFFD\\ bar");
	});

	it("hex-escapes a leading digit", () => {
		expect(escapeSelector("2xl")).toBe("\\32 xl");
	});

	it("hex-escapes a digit after a leading hyphen", () => {
		expect(escapeSelector("-2xl")).toBe("-\\32 xl");
	});

	it("passes astral-plane code points through raw (ident-safe per CSS.escape)", () => {
		expect(escapeSelector("icon-😀")).toBe("icon-😀");
	});
});

// ---------------------------------------------------------------------------
// compile
// ---------------------------------------------------------------------------

describe("compile", () => {
	it("compiles a simple utility", () => {
		const result = compile(["flex"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("display: flex");
		expect(result.rules[0].css).toContain(".flex");
	});

	it("compiles spacing utility", () => {
		const result = compile(["p-4"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("padding");
		expect(result.rules[0].css).toContain("calc(4 * var(--spacing))");
	});

	it("compiles color utility", () => {
		const result = compile(["text-error-500"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("color");
		expect(result.rules[0].css).toContain("var(--color-error-500)");
	});

	it("deduplicates repeated classes", () => {
		const result = compile(["flex", "flex", "flex"], theme);
		expect(result.rules).toHaveLength(1);
	});

	it("skips unknown utilities", () => {
		const result = compile(["nonexistent-utility"], theme);
		expect(result.rules).toHaveLength(0);
	});

	it("handles hover variant", () => {
		const result = compile(["hover:text-error-500"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain(":hover");
	});

	it("handles responsive variant", () => {
		const result = compile(["sm:flex"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("@media (min-width:");
	});

	it("handles dark variant", () => {
		const result = compile(["dark:bg-black"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("prefers-color-scheme: dark");
	});

	it("handles !important", () => {
		const result = compile(["p-4!"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("!important");
	});

	it("handles arbitrary values", () => {
		const result = compile(["p-[13px]"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("13px");
	});

	it("physical infix converts logical to physical properties", () => {
		const result = compile(["pl-physical-4"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("padding-left");
		expect(result.rules[0].css).not.toContain("padding-inline");
	});

	it("physical infix works with border-radius", () => {
		const result = compile(["rounded-tl-physical-4"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("border-top-left-radius");
		expect(result.rules[0].css).not.toContain("border-start-start-radius");
	});

	it("handles data-* variants", () => {
		const result = compile(["data-[state=open]:flex"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("[data-state=open]");
	});

	it("handles aria-* variants", () => {
		const result = compile(["aria-disabled:opacity-50"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain('[aria-disabled="true"]');
	});

	it("handles has-* variants", () => {
		const result = compile(["has-[input:focus]:border-info-500"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain(":has(input:focus)");
	});

	it("handles not-* variants", () => {
		const result = compile(["not-disabled:opacity-100"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain(":not(:disabled)");
	});

	it("handles group-hover variant", () => {
		const result = compile(["group-hover:underline"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain(".group:hover");
	});

	it("handles group-focus variant", () => {
		const result = compile(["group-focus:opacity-100"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain(".group:focus");
	});

	it("rejects unknown group-* variant", () => {
		const result = compile(["group-xyz:flex"], theme);
		expect(result.rules).toHaveLength(0);
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toContain("RI-1004");
	});

	it("handles container query variant", () => {
		const result = compile(["@sm:flex"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("@container");
	});

	it("handles starting variant", () => {
		const result = compile(["starting:opacity-0"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("@starting-style");
	});

	it("handles portrait/landscape", () => {
		const result = compile(["portrait:flex"], theme);
		expect(result.rules[0].css).toContain("orientation: portrait");
	});

	it("tracks used color stops", () => {
		const result = compile(["text-error-500", "bg-info-200"], theme);
		expect(result.usedColorStops.get("error")?.has(500)).toBe(true);
		expect(result.usedColorStops.get("info")?.has(200)).toBe(true);
	});

	it("sorts rules deterministically", () => {
		const result = compile(["text-error-500", "flex", "p-4"], theme);
		expect(result.rules.length).toBe(3);
		// Layout (flex) should come before spacing (p) should come before color (text)
		const utilities = result.rules.map((r) => r.selector);
		const flexIdx = utilities.findIndex((s) => s.includes("flex"));
		const _pIdx = utilities.findIndex((s) => s.includes("p-4"));
		const textIdx = utilities.findIndex((s) => s.includes("text-error"));
		expect(flexIdx).toBeLessThan(textIdx);
	});

	it("generates animation keyframes when needed", () => {
		const result = compile(["animate-in", "fade-in", "zoom-in-95"], theme);
		expect(result.keyframes.length).toBeGreaterThan(0);
		expect(result.keyframes.some((k) => k.includes("@keyframes enter"))).toBe(true);
	});

	it("generates @property declarations for animations", () => {
		const result = compile(["animate-in"], theme);
		expect(result.properties.length).toBeGreaterThan(0);
		expect(result.properties.some((p) => p.includes("@property --ri-enter-opacity"))).toBe(true);
	});

	it("compiles multiple utilities", () => {
		const result = compile(
			[
				"flex",
				"items-center",
				"justify-between",
				"p-4",
				"gap-2",
				"bg-white",
				"text-black",
				"rounded-4",
				"shadow-md",
			],
			theme,
		);
		expect(result.rules.length).toBe(9);
	});

	it("handles pseudo-element variants", () => {
		const result = compile(["before:content-none"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("::before");
	});

	it("handles placeholder variant", () => {
		const result = compile(["placeholder:text-storm-400"], theme);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("::placeholder");
	});
});

// ---------------------------------------------------------------------------
// renderCSS
// ---------------------------------------------------------------------------

describe("renderCSS", () => {
	it("renders rules to CSS string", () => {
		const result = compile(["flex", "p-4"], theme);
		const css = renderCSS(result);
		expect(css).toContain(".flex");
		expect(css).toContain(".p-4");
		expect(typeof css).toBe("string");
	});

	it("renders @keyframes when present", () => {
		const result = compile(["animate-in", "fade-in"], theme);
		const css = renderCSS(result);
		expect(css).toContain("@keyframes enter");
	});

	it("renders @property when present", () => {
		const result = compile(["animate-in"], theme);
		const css = renderCSS(result);
		expect(css).toContain("@property");
	});

	it("empty input produces empty output", () => {
		const result = compile([], theme);
		const css = renderCSS(result);
		expect(css).toBe("");
	});
});

// ---------------------------------------------------------------------------
// compileCSSFunctions
// ---------------------------------------------------------------------------

describe("compileCSSFunctions", () => {
	it("compiles --alpha() with slash separator and percentage", () => {
		const result = compileCSSFunctions("--alpha(var(--color-red-500) / 50%)");
		expect(result).toContain("color-mix(in oklab");
		expect(result).toContain("50%");
	});

	it("compiles --alpha() with fractional opacity", () => {
		const result = compileCSSFunctions("--alpha(var(--color-red-500) / 0.5)");
		expect(result).toContain("color-mix(in oklab");
		expect(result).toContain("50%");
	});

	it("compiles --alpha() full opacity as pass-through", () => {
		const result = compileCSSFunctions("--alpha(var(--color-red-500) / 100%)");
		expect(result).toBe("var(--color-red-500)");
	});

	it("compiles --alpha() full opacity 1.0 as pass-through", () => {
		const result = compileCSSFunctions("--alpha(var(--color-red-500) / 1)");
		expect(result).toBe("var(--color-red-500)");
	});

	it("compiles --spacing()", () => {
		const result = compileCSSFunctions("--spacing(4)");
		expect(result).toContain("calc(4 * var(--spacing))");
	});

	it("compiles --spacing(0) to 0px", () => {
		const result = compileCSSFunctions("--spacing(0)");
		expect(result).toBe("0px");
	});

	it("compiles --theme() preserving -- prefix", () => {
		const result = compileCSSFunctions("--theme(--color-red-500)");
		expect(result).toBe("var(--color-red-500)");
	});

	it("compiles --theme() with fallback", () => {
		const result = compileCSSFunctions("--theme(--color-red-500, blue)");
		expect(result).toBe("var(--color-red-500, blue)");
	});

	it("handles nested function calls", () => {
		const result = compileCSSFunctions("background: --alpha(--theme(--color-blue-500) / 50%)");
		expect(result).toContain("color-mix");
		expect(result).toContain("var(--color-blue-500)");
	});
});

// ---------------------------------------------------------------------------
// ANIMATION_KEYFRAMES
// ---------------------------------------------------------------------------

describe("ANIMATION_KEYFRAMES", () => {
	it("contains enter and exit keyframes", () => {
		expect(ANIMATION_KEYFRAMES).toHaveLength(2);
		expect(ANIMATION_KEYFRAMES[0]).toContain("@keyframes enter");
		expect(ANIMATION_KEYFRAMES[1]).toContain("@keyframes exit");
	});

	it("enter keyframe uses CSS variables", () => {
		expect(ANIMATION_KEYFRAMES[0]).toContain("--ri-enter-opacity");
		expect(ANIMATION_KEYFRAMES[0]).toContain("--ri-enter-scale");
		expect(ANIMATION_KEYFRAMES[0]).toContain("--ri-enter-translate-x");
	});
});

// ---------------------------------------------------------------------------
// ANIMATION_PROPERTIES
// ---------------------------------------------------------------------------

describe("ANIMATION_PROPERTIES", () => {
	it("contains @property for all animation variables", () => {
		expect(ANIMATION_PROPERTIES.length).toBe(12);
		expect(ANIMATION_PROPERTIES.some((p) => p.includes("--ri-enter-opacity"))).toBe(true);
		expect(ANIMATION_PROPERTIES.some((p) => p.includes("--ri-exit-scale"))).toBe(true);
	});

	it("uses correct syntax types", () => {
		const opacity = ANIMATION_PROPERTIES.find((p) => p.includes("--ri-enter-opacity"))!;
		expect(opacity).toContain('"<number>"');

		const translate = ANIMATION_PROPERTIES.find((p) => p.includes("--ri-enter-translate-x"))!;
		expect(translate).toContain('"<length-percentage>"');

		const rotate = ANIMATION_PROPERTIES.find((p) => p.includes("--ri-enter-rotate"))!;
		expect(rotate).toContain('"<angle>"');
	});
});

describe("findClosest", () => {
	it("suggests close match", () => {
		const candidates = ["flex", "block", "grid", "hidden", "relative"];
		expect(findClosest("fex", candidates)).toBe("flex");
		expect(findClosest("blok", candidates)).toBe("block");
	});

	it("returns null for no close match", () => {
		const candidates = ["flex", "block", "grid"];
		expect(findClosest("xyzabc", candidates)).toBeNull();
	});

	it("respects maxDistance", () => {
		const candidates = ["flex"];
		expect(findClosest("fle", candidates, 1)).toBe("flex");
		expect(findClosest("abc", candidates, 1)).toBeNull();
	});
});

describe("compile warnings", () => {
	it("silently ignores unknown utility (no RI-1001)", () => {
		const theme = resolveDirectives([]);
		const result = compile(["fex"], theme);
		expect(result.warnings).toHaveLength(0);
	});

	it("no warning for valid utility", () => {
		const theme = resolveDirectives([]);
		const result = compile(["flex"], theme);
		expect(result.warnings).toHaveLength(0);
	});

	it("does not warn for arbitrary tokens that look like JS indexing", () => {
		const theme = resolveDirectives([]);
		const result = compile(["lessons[activeIndex-1]"], theme);
		expect(result.warnings).toHaveLength(0);
	});
});
