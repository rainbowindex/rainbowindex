import { describe, expect, it } from "vitest";
import { generateTokenLayer } from "../../src/assembly.js";
import { escapeSelector } from "../../src/css/escape.js";
import { compileCSSFunctions } from "../../src/css/functions.js";
import { generatePreflight } from "../../src/css/preflight.js";
import { stripRIDirectives } from "../../src/css/strip.js";
import {
	COLOR_STOP_REF_RE,
	COLOR_VAR_REF_RE,
	SHADOW_VAR_REF_RE,
} from "../../src/css/token-refs.js";
import type { ResolvedTheme } from "../../src/directives/foundation.js";
import { resolveDirectives } from "../../src/directives/index.js";

// ---------------------------------------------------------------------------
// Token layer ordering — codepoint comparison, not ICU collation
// ---------------------------------------------------------------------------

const baseTheme = resolveDirectives([]);

function emptyUsage() {
	return {
		usedColorStops: new Map<string, Set<number>>(),
		usedColorNames: new Set<string>(),
		keyframes: [] as string[],
		usedTextSizes: new Set<string>(),
		usedFonts: new Set<string>(),
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
// @color aliases and the stops they reference
// ---------------------------------------------------------------------------

/**
 * An alias emits `--color-<alias>-<n>: var(--color-<source>-<n>)`. The source's
 * stop is not "used" by anything the scanner can see, so it used to be pruned
 * away and the alias pointed at a variable that never existed — a utility that
 * renders nothing, with no warning on any surface. It only worked by accident,
 * when the same stop happened to be used directly somewhere else.
 */
describe("generateTokenLayer @color alias stops", () => {
	const aliasUsage = (name: string, stop: number) => {
		const usage = emptyUsage();
		usage.usedColorStops.set(name, new Set([stop]));
		return usage;
	};

	it("emits the source stop an alias references, used only through the alias", () => {
		const theme = resolveDirectives([{ type: "color", body: "brand: 0.18 330; accent: brand;" }]);
		const css = generateTokenLayer(theme, aliasUsage("accent", 500), new Map());
		expect(css).toContain("--color-accent-500: var(--color-brand-500);");
		expect(css).toMatch(/--color-brand-500:\s*[^;]+;/);
	});

	it("carries the stop the alias actually uses, not stop 500", () => {
		const theme = resolveDirectives([{ type: "color", body: "brand: 0.18 330; accent: brand;" }]);
		const css = generateTokenLayer(theme, aliasUsage("accent", 700), new Map());
		expect(css).toMatch(/--color-brand-700:\s*[^;]+;/);
		expect(css).not.toContain("--color-brand-500:");
	});

	it("walks a chain, emitting every hop", () => {
		// Each link emits its own var(), so a stop missing anywhere in the middle
		// breaks the whole chain.
		const theme = resolveDirectives([
			{ type: "color", body: "brand: 0.18 330; mid: brand; accent: mid;" },
		]);
		const css = generateTokenLayer(theme, aliasUsage("accent", 500), new Map());
		expect(css).toContain("--color-accent-500: var(--color-mid-500);");
		expect(css).toContain("--color-mid-500: var(--color-brand-500);");
		expect(css).toMatch(/--color-brand-500:\s*[^;]+;/);
	});

	it("prunes an alias nothing uses, and its source with it", () => {
		const theme = resolveDirectives([{ type: "color", body: "brand: 0.18 330; accent: brand;" }]);
		const css = generateTokenLayer(theme, emptyUsage(), new Map());
		expect(css).not.toContain("--color-accent-");
		expect(css).not.toContain("--color-brand-");
	});

	it("emits a stop-less reference when the chain ends somewhere non-generative", () => {
		// A bare alias is named, not stopped, so it is kept alive by name — the
		// stop map has nothing to say about it.
		const theme = resolveDirectives([
			{ type: "color", body: "ink-ish: #123456; accent: ink-ish;" },
		]);
		const usage = emptyUsage();
		usage.usedColorNames.add("accent");
		const css = generateTokenLayer(theme, usage, new Map());
		expect(css).toContain("--color-accent: var(--color-ink-ish);");
		// And the alias drags its source along, or the reference dangles.
		expect(css).toContain("--color-ink-ish: #123456;");
	});

	it("terminates on a circular chain instead of emitting dangling references", () => {
		// RI-1107 warns but leaves the colors in the theme, so every consumer has
		// to survive them. Emitting nothing beats emitting two variables that
		// point at each other and resolve to nothing.
		const theme = resolveDirectives([{ type: "color", body: "a: b; b: a;" }]);
		const css = generateTokenLayer(theme, aliasUsage("a", 500), new Map());
		expect(css).not.toContain("--color-a");
		expect(css).not.toContain("--color-b");
	});
});

// ---------------------------------------------------------------------------
// Canonical token-reference regexes
// ---------------------------------------------------------------------------

describe("token-refs canonical regexes", () => {
	it("stays textually identical to the engine scanner literals", () => {
		expect(COLOR_STOP_REF_RE.source).toBe(
			String.raw`var\(--color-([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)(?:-(\d+))?\s*[,)]`,
		);
		expect(COLOR_STOP_REF_RE.flags).toBe("g");
		expect(SHADOW_VAR_REF_RE.source).toBe(
			String.raw`var\(--shadow-(DEFAULT|[a-z0-9]+(?:-[a-z0-9]+)*)\)`,
		);
		expect(SHADOW_VAR_REF_RE.flags).toBe("g");
	});

	it("counts a reference that carries a var() fallback", () => {
		// `var(--color-x, red)` references `--color-x` exactly as much as the bare
		// form does. Both patterns used to require an immediate `)`, so the
		// fallback spelling went unrecorded — harmless while every color was
		// emitted regardless, and a silently deleted variable once pruning landed.
		const input =
			"var(--color-foo, red) var(--color-base, var(--color-two)) var(--color-red-500, blue)";
		expect([...input.matchAll(COLOR_VAR_REF_RE)].map((m) => m[1])).toEqual([
			"foo",
			"base",
			"two",
			"red-500",
		]);
		expect([...input.matchAll(COLOR_STOP_REF_RE)].map((m) => [m[1], m[2]])).toEqual([
			["foo", undefined],
			["base", undefined],
			["two", undefined],
			["red", "500"],
		]);
	});

	it("recognizes the uppercase DEFAULT token name", () => {
		// Bare `shadow` emits `var(--shadow-DEFAULT)`. A scanner that cannot see
		// that reference prunes the token and leaves the class painting the
		// `0 0 #0000` fallback — see the pruning test in token-scan.test.ts.
		const input = "var(--shadow-DEFAULT) var(--shadow-md)";
		expect([...input.matchAll(SHADOW_VAR_REF_RE)].map((m) => m[1])).toEqual(["DEFAULT", "md"]);
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

	it("still force-emits generative stops referenced by a live explicit color", () => {
		const theme = resolveDirectives([{ type: "color", body: "background: theme-22;" }]);
		const usage = emptyUsage();
		usage.usedColorNames.add("background");
		const css = generateTokenLayer(theme, usage, new Map());
		expect(css).toMatch(/--color-theme-22:\s*[^;]+;/);
	});

	it("does not force a stop for an explicit color that was itself pruned", () => {
		// The other half of the same rule. Forcing `theme-22` for a `background`
		// nobody uses would leak back in exactly what pruning removed, and the
		// stop would have no reader.
		const theme = resolveDirectives([{ type: "color", body: "background: theme-22;" }]);
		const css = generateTokenLayer(theme, emptyUsage(), new Map());
		expect(css).not.toContain("--color-background:");
		expect(css).not.toContain("--color-theme-22:");
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
// stripRIDirectives — a directive named inside a comment
// ---------------------------------------------------------------------------

/**
 * The strip patterns run forward to the next `{` or `;`, so a directive name
 * written inside a comment matches text well past the comment — usually the
 * *real* directive that follows it. Skipping that false match used to resume
 * the scan after the swallowed opener, which left every directive from there
 * on in the output as invalid CSS. Real stylesheets hit this constantly: any
 * comment that documents the theme by naming `@color` or `@font` was enough,
 * and `rainbowindex/tailwind.css` opens with exactly such a header.
 */
describe("stripRIDirectives with directive names inside comments", () => {
	it("strips a block directive announced by a preceding comment", () => {
		expect(stripRIDirectives("/* palette via @color */\n@color {\n\tbrand: 0.18 330;\n}")).toBe(
			"/* palette via @color */",
		);
	});

	it("strips every directive after the comment, not just the first", () => {
		const css = [
			"/* uses @color, @text and @shadow */",
			"@color { brand: 0.18 330; }",
			"@text { body: 1rem, 1.5; }",
			"@shadow { card: 0 1px 2px oklch(0 0 0 / 0.1); }",
			".keep { color: red; }",
		].join("\n");
		// The comment survives; the three blocks it announced do not. Comparing
		// the whole string is the point — a partial `toContain` would pass on the
		// buggy output, whose comment also contains every directive name.
		expect(stripRIDirectives(css)).toBe(
			"/* uses @color, @text and @shadow */\n\n\n\n.keep { color: red; }",
		);
	});

	it("strips a statement directive announced by a preceding comment", () => {
		expect(stripRIDirectives('/* see @source */\n@source "src/**/*.tsx";\n.k { x: y; }')).toBe(
			"/* see @source */\n\n.k { x: y; }",
		);
	});

	it("strips the activation import named in an earlier comment", () => {
		expect(
			stripRIDirectives('/* start with @import "rainbowindex" */\n@import "rainbowindex";'),
		).toBe('/* start with @import "rainbowindex" */');
	});

	it("leaves a comment that only mentions a directive untouched", () => {
		const css = "/* @color and @text are directives */\n.k { x: y; }";
		expect(stripRIDirectives(css)).toBe(css);
	});

	it("does not let a directive name in a declaration string shield what follows", () => {
		const css = '.x { content: "@color"; }\n@color { brand: 0.18 330; }';
		expect(stripRIDirectives(css)).toBe('.x { content: "@color"; }');
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
