import { describe, expect, it } from "vitest";
import { generateTokenLayer } from "../../src/assembly.js";
import { escapeSelector } from "../../src/css/escape.js";
import { compileCSSFunctions } from "../../src/css/functions.js";
import { generatePreflight } from "../../src/css/preflight.js";
import { stripRIDirectives } from "../../src/css/strip.js";
import { COLOR_STOP_REF_RE, SHADOW_VAR_REF_RE } from "../../src/css/token-refs.js";
import type { ResolvedTheme } from "../../src/directives/foundation.js";
import { resolveDirectives } from "../../src/directives/index.js";

// ---------------------------------------------------------------------------
// Token layer ordering — codepoint comparison, not ICU collation
// ---------------------------------------------------------------------------

const baseTheme = resolveDirectives([]);

function emptyUsage() {
	return {
		usedColorStops: new Map<string, Set<number>>(),
		usedTextSizes: new Set<string>(),
		usedFonts: new Set<string>(),
		usedRounded: new Set<string>(),
		usedShadows: new Set<string>(),
		usedAnimations: new Set<string>(),
	};
}

/** "B" < "a" by codepoint while ICU collation orders "a" first — a
 *  discriminating pair that fails if the sort regresses to localeCompare. */
function expectBBeforeA(css: string, prefix: string): void {
	const bIdx = css.indexOf(`${prefix}-B:`);
	const aIdx = css.indexOf(`${prefix}-a:`);
	expect(bIdx).toBeGreaterThan(-1);
	expect(aIdx).toBeGreaterThan(-1);
	expect(bIdx).toBeLessThan(aIdx);
}

describe("generateTokenLayer deterministic ordering", () => {
	it("sorts text size tokens by codepoint", () => {
		const theme: ResolvedTheme = {
			...baseTheme,
			text: { a: { fontSize: "1rem", lineHeight: "1" }, B: { fontSize: "2rem", lineHeight: "1" } },
		};
		const usage = emptyUsage();
		usage.usedTextSizes = new Set(["a", "B"]);
		expectBBeforeA(generateTokenLayer(theme, usage, new Map()), "--text");
	});

	it("sorts rounded tokens by codepoint", () => {
		const theme: ResolvedTheme = { ...baseTheme, rounded: { a: "1px", B: "2px" } };
		const usage = emptyUsage();
		usage.usedRounded = new Set(["a", "B"]);
		expectBBeforeA(generateTokenLayer(theme, usage, new Map()), "--rounded");
	});

	it("sorts shadow tokens by codepoint", () => {
		const theme: ResolvedTheme = {
			...baseTheme,
			shadows: { a: "0 0 1px red", B: "0 0 2px red" },
		};
		const usage = emptyUsage();
		usage.usedShadows = new Set(["a", "B"]);
		expectBBeforeA(generateTokenLayer(theme, usage, new Map()), "--shadow");
	});

	it("sorts animation tokens by codepoint", () => {
		const theme: ResolvedTheme = {
			...baseTheme,
			animations: {
				a: { shorthand: "a 1s linear infinite", keyframes: "" },
				B: { shorthand: "B 1s linear infinite", keyframes: "" },
			},
		};
		const usage = emptyUsage();
		usage.usedAnimations = new Set(["a", "B"]);
		expectBBeforeA(generateTokenLayer(theme, usage, new Map()), "--animate");
	});

	it("sorts default system font stacks by codepoint", () => {
		const theme: ResolvedTheme = { ...baseTheme, fonts: [] };
		const usage = emptyUsage();
		usage.usedFonts = new Set(["serif", "mono", "sans"]);
		const css = generateTokenLayer(theme, usage, new Map());
		const mono = css.indexOf("--font-mono:");
		const sans = css.indexOf("--font-sans:");
		const serif = css.indexOf("--font-serif:");
		expect(mono).toBeGreaterThan(-1);
		expect(mono).toBeLessThan(sans);
		expect(sans).toBeLessThan(serif);
	});
});

// ---------------------------------------------------------------------------
// Token layer ↔ [data-theme] override parity
// ---------------------------------------------------------------------------

describe("generateTokenLayer [data-theme] override parity", () => {
	it("force-emits inline palette stops referenced by [data-theme] overrides", () => {
		const theme = resolveDirectives([{ type: "color", body: "ocean: 0.16 222 { inline; };" }]);
		const usage = emptyUsage();
		usage.usedColorStops.set("theme", new Set([500]));
		const css = generateTokenLayer(theme, usage, new Map());
		expect(css).toMatch(/--color-ocean-500:\s*[^;]+;/);
	});

	it("still prunes inline palettes when no theme stops are used", () => {
		const theme = resolveDirectives([{ type: "color", body: "ocean: 0.16 222 { inline; };" }]);
		const css = generateTokenLayer(theme, emptyUsage(), new Map());
		expect(css).not.toContain("--color-ocean-");
	});
});

// ---------------------------------------------------------------------------
// Canonical token-reference regexes
// ---------------------------------------------------------------------------

describe("token-refs canonical regexes", () => {
	it("stays textually identical to the engine scanner literals", () => {
		expect(COLOR_STOP_REF_RE.source).toBe(
			String.raw`var\(--color-([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)(?:-(\d+))?\)`,
		);
		expect(COLOR_STOP_REF_RE.flags).toBe("g");
		expect(SHADOW_VAR_REF_RE.source).toBe(String.raw`var\(--shadow-([a-z0-9]+(?:-[a-z0-9]+)*)\)`);
		expect(SHADOW_VAR_REF_RE.flags).toBe("g");
	});

	it("captures the hue with an optional stop", () => {
		const input = "var(--color-paper) var(--color-theme-22) var(--color-red-ish-500)";
		const matches = [...input.matchAll(COLOR_STOP_REF_RE)].map((m) => [m[1], m[2]]);
		expect(matches).toEqual([
			["paper", undefined],
			["theme", "22"],
			["red-ish", "500"],
		]);
	});

	it("is safe to share across matchAll consumers (lastIndex untouched)", () => {
		const input = "var(--shadow-md) var(--shadow-layer-1)";
		expect([...input.matchAll(SHADOW_VAR_REF_RE)]).toHaveLength(2);
		expect([...input.matchAll(SHADOW_VAR_REF_RE)]).toHaveLength(2);
		expect(SHADOW_VAR_REF_RE.lastIndex).toBe(0);
	});

	it("still force-emits generative stops referenced by explicit colors", () => {
		const theme = resolveDirectives([{ type: "color", body: "background: theme-22;" }]);
		const css = generateTokenLayer(theme, emptyUsage(), new Map());
		expect(css).toMatch(/--color-theme-22:\s*[^;]+;/);
	});
});

// ---------------------------------------------------------------------------
// escapeSelector — single-pass CSS.escape-aligned escaping
// ---------------------------------------------------------------------------

describe("escapeSelector single-pass escaping", () => {
	it("escapes the previously-missed selector metacharacters", () => {
		expect(escapeSelector("a;b")).toBe("a\\;b");
		expect(escapeSelector("a<b")).toBe("a\\<b");
		expect(escapeSelector("a?b")).toBe("a\\?b");
		expect(escapeSelector("a`b")).toBe("a\\`b");
	});

	it("hex-escapes control characters with a terminating space", () => {
		expect(escapeSelector("a\u0001b")).toBe("a\\1 b");
		expect(escapeSelector("a\u000Bb")).toBe("a\\b b");
		expect(escapeSelector("a\u001Fb")).toBe("a\\1f b");
		expect(escapeSelector("a\u007Fb")).toBe("a\\7f b");
	});

	it("keeps the legacy byte shape for every previously escaped character", () => {
		for (const ch of "\\[]:/.@!#(),+%>~*=^$|'\"{}&") {
			expect(escapeSelector(`a${ch}b`)).toBe(`a\\${ch}b`);
		}
		for (const ws of ["\t", "\n", "\f", "\r", " "]) {
			expect(escapeSelector(`a${ws}b`)).toBe(`a\\${ws}b`);
		}
	});

	it("replaces NUL with U+FFFD", () => {
		expect(escapeSelector("a\0b")).toBe("a\uFFFDb");
	});

	it("hex-escapes digits only in lead position", () => {
		expect(escapeSelector("2xl")).toBe("\\32 xl");
		expect(escapeSelector("-2xl")).toBe("-\\32 xl");
		expect(escapeSelector("w2")).toBe("w2");
		expect(escapeSelector("--2")).toBe("--2");
	});

	it("passes non-ASCII through raw", () => {
		expect(escapeSelector("café")).toBe("café");
		expect(escapeSelector("icon-😀")).toBe("icon-😀");
	});

	it("returns the input when nothing needs escaping", () => {
		expect(escapeSelector("inline-flex_2")).toBe("inline-flex_2");
	});
});

// ---------------------------------------------------------------------------
// --alpha() non-numeric opacity passthrough
// ---------------------------------------------------------------------------

describe("--alpha() non-numeric opacity passthrough", () => {
	it("passes var() opacity through to color-mix", () => {
		expect(compileCSSFunctions("--alpha(red / var(--o))")).toBe(
			"color-mix(in oklab, red var(--o), transparent)",
		);
	});

	it("passes calc() opacity through to color-mix", () => {
		expect(compileCSSFunctions("--alpha(var(--c) / calc(var(--o) * 1%))")).toBe(
			"color-mix(in oklab, var(--c) calc(var(--o) * 1%), transparent)",
		);
	});

	it("keeps numeric opacities byte-identical", () => {
		expect(compileCSSFunctions("--alpha(red / 0.5)")).toBe(
			"color-mix(in oklab, red 50%, transparent)",
		);
		expect(compileCSSFunctions("--alpha(red / 75%)")).toBe(
			"color-mix(in oklab, red 75%, transparent)",
		);
		expect(compileCSSFunctions("--alpha(red / 1)")).toBe("red");
	});

	it("keeps the implicit mix when the opacity side is empty", () => {
		expect(compileCSSFunctions("--alpha(red /)")).toBe("color-mix(in oklab, red, transparent)");
	});
});

// ---------------------------------------------------------------------------
// --spacing() strict argument validation
// ---------------------------------------------------------------------------

describe("--spacing() strict argument validation", () => {
	it("rejects empty, hex, binary, octal, and Infinity arguments via RI-2005", () => {
		for (const arg of ["", "0x10", "0b101", "0o17", "Infinity", "-Infinity"]) {
			const warnings: string[] = [];
			const value = `--spacing(${arg})`;
			expect(compileCSSFunctions(value, undefined, warnings)).toBe(value);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("RI-2005");
		}
	});

	it("keeps accepting CSS-valid decimal forms", () => {
		expect(compileCSSFunctions("--spacing(.5)")).toBe("calc(.5 * var(--spacing))");
		expect(compileCSSFunctions("--spacing(-2)")).toBe("calc(-2 * var(--spacing))");
		expect(compileCSSFunctions("--spacing(1e2)")).toBe("calc(1e2 * var(--spacing))");
		expect(compileCSSFunctions("--spacing(0.0)")).toBe("0px");
		expect(compileCSSFunctions("--spacing(4)")).toBe("calc(4 * var(--spacing))");
	});
});

// ---------------------------------------------------------------------------
// stripRIDirectives — terminators inside quoted values
// ---------------------------------------------------------------------------

describe("stripRIDirectives quoted-terminator handling", () => {
	it("strips a semicolon directive whose quoted value contains a semicolon", () => {
		expect(stripRIDirectives('@source "a;b";')).toBe("");
		expect(stripRIDirectives('@source "a;b";\n.keep { color: red; }')).toBe(
			".keep { color: red; }",
		);
	});

	it("strips a block directive whose quoted prelude contains a brace", () => {
		expect(stripRIDirectives('@font "a{b" { weight: 400; }\n.keep { color: red; }')).toBe(
			".keep { color: red; }",
		);
	});

	it("strips a block directive whose quoted prelude contains a semicolon", () => {
		expect(stripRIDirectives('@font "a;b" { weight: 400; }\n.keep { color: red; }')).toBe(
			".keep { color: red; }",
		);
	});

	it("strips a statement directive whose quoted value contains a brace", () => {
		expect(stripRIDirectives('@source "src/**/*.{ts,tsx}";\n.keep { color: red; }')).toBe(
			".keep { color: red; }",
		);
	});

	it("consumes an unterminated quoted directive to EOF", () => {
		expect(stripRIDirectives('@source "a;b')).toBe("");
		expect(stripRIDirectives('@source "src/**/*.{ts')).toBe("");
	});

	it("strips a malformed quoted-brace prelude without eating user rules", () => {
		expect(stripRIDirectives('@font "a{b"; .keep { color: red; }')).toBe(".keep { color: red; }");
	});

	it("leaves directive-shaped text inside declaration strings untouched", () => {
		const css = `.x { content: "@source 'a;b';"; }`;
		expect(stripRIDirectives(css)).toBe(css);
	});

	it("stays stable across repeated invocations (shared cached regexes)", () => {
		const css = '@source "a;b";\n@animate spin { to { transform: rotate(1turn); } }\n.k { x: y; }';
		const first = stripRIDirectives(css);
		const second = stripRIDirectives(css);
		expect(first).toBe(".k { x: y; }");
		expect(second).toBe(first);
	});
});

// ---------------------------------------------------------------------------
// Preflight byte hygiene
// ---------------------------------------------------------------------------

describe("preflight button reset", () => {
	it("emits a space after the colon in the padding declaration", () => {
		const css = generatePreflight();
		expect(css).toContain('button, [role="button"] {\n  cursor: pointer;\n  padding: 0;\n}');
		expect(css).not.toContain("padding:0");
	});
});
