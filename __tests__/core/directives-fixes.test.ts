/**
 * Regression suite for the directive parser/resolver audit fixes:
 * comment-vs-url scanning, escaped selectors, depth-aware entry splitting,
 * nested-directive diagnostics (RI-1036), ignored-modifier diagnostics
 * (RI-1034), key/name validation (RI-1035), non-generative option blocks
 * (RI-1108), @font slot dedup (RI-1215) + cap (RI-1216), cumulative
 * @preflight/@fluid resolution, and theme freezing.
 */
import { describe, expect, it } from "vitest";
import {
	extractDirectives,
	parseAnimateBody,
	parseColorBody,
	parseFontBody,
	parseGroupedUtilityDirective,
	parseKeyValueBody,
	parseNestedFontBlock,
	parseRoundedModifier,
	parseSourceDirective,
	parseTextBody,
	parseUtilityDirective,
	resolveDirectives,
} from "../../src/directives/index.js";

// ---------------------------------------------------------------------------
// extractDirectives — // comments vs url() (paren-depth tracking)
// ---------------------------------------------------------------------------

describe("extractDirectives — // inside url() is not a comment", () => {
	it("extracts a directive on the same line as url(https://…)", () => {
		const warnings: string[] = [];
		const ds = extractDirectives(
			`.a { background: url(https://cdn.x/y.png); } @color { brand: 0.18 330; }`,
			warnings,
		);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("color");
		expect(ds[0].body).toContain("brand: 0.18 330");
		expect(warnings.some((w) => w.includes("[RI-1011]"))).toBe(false);
	});

	it("survives protocol-relative url(//…) without warning", () => {
		const warnings: string[] = [];
		const ds = extractDirectives(
			`.a { background: url(//cdn.x/y.png); } @color { brand: 0.18 330; }`,
			warnings,
		);
		expect(ds).toHaveLength(1);
		expect(warnings.some((w) => w.includes("[RI-1011]"))).toBe(false);
	});

	it("still warns RI-1011 and skips real // comments", () => {
		const warnings: string[] = [];
		const ds = extractDirectives(
			`// @color { ignored: 0.1 100; }\n@color { brand: 0.18 330; }`,
			warnings,
		);
		expect(ds).toHaveLength(1);
		expect(ds[0].body).toContain("brand");
		expect(warnings.some((w) => w.includes("[RI-1011]"))).toBe(true);
	});

	it("a // comment still consumes the rest of its line", () => {
		const warnings: string[] = [];
		const ds = extractDirectives(`// @color { brand: 0.18 330; }`, warnings);
		expect(ds).toHaveLength(0);
		expect(warnings.some((w) => w.includes("[RI-1011]"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// extractDirectives — escaped @ in selectors
// ---------------------------------------------------------------------------

describe("extractDirectives — escaped @ is not a directive", () => {
	it("ignores escaped @ in class selectors", () => {
		const ds = extractDirectives(`.\\@color\\:red { color: red; }`);
		expect(ds).toHaveLength(0);
	});

	it("still extracts a real directive after the escaped selector", () => {
		const ds = extractDirectives(`.\\@color\\:red { color: red; }\n@color { brand: 0.18 330; }`);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("color");
	});
});

// ---------------------------------------------------------------------------
// extractDirectives — RI-1036 for directives nested in conditional at-rules
// ---------------------------------------------------------------------------

describe("extractDirectives — RI-1036 nested directive diagnostics", () => {
	it("warns when a directive sits inside @media but still extracts it", () => {
		const warnings: string[] = [];
		const ds = extractDirectives(
			`@media (min-width: 600px) {\n  @color { brand: 0.18 330; }\n}`,
			warnings,
		);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("color");
		const w = warnings.find((x) => x.includes("[RI-1036]"));
		expect(w).toBeDefined();
		expect(w).toContain("@color");
		expect(w).toContain("@media");
	});

	it("warns for @supports too", () => {
		const warnings: string[] = [];
		extractDirectives(`@supports (display: grid) { @spacing { base: 0.3rem; } }`, warnings);
		expect(warnings.some((w) => w.includes("[RI-1036]") && w.includes("@supports"))).toBe(true);
	});

	it("does not warn for top-level directives before or after a @media block", () => {
		const warnings: string[] = [];
		const ds = extractDirectives(
			`@color { brand: 0.18 330; }\n@media (min-width: 600px) { .a { color: red; } }\n@text { huge: 5rem, 1; }`,
			warnings,
		);
		expect(ds).toHaveLength(2);
		expect(warnings.some((w) => w.includes("[RI-1036]"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// extractDirectives — braces/semicolons inside quoted directive preludes
// ---------------------------------------------------------------------------

describe("extractDirectives — quoted terminators in directive preludes", () => {
	it("keeps a brace-expansion glob in @source intact", () => {
		const warnings: string[] = [];
		const ds = extractDirectives(`@source "src/**/*.{ts,tsx}";`, warnings);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("source");
		expect(ds[0].modifier).toBe('"src/**/*.{ts,tsx}"');
		expect(ds[0].body).toBe("");
		expect(warnings).toHaveLength(0);
		const source = parseSourceDirective(ds[0].body, ds[0].modifier);
		expect(source).toEqual({ pattern: "src/**/*.{ts,tsx}", negated: false, inline: false });
	});

	it("does not corrupt directives following a brace-glob @source", () => {
		const ds = extractDirectives(`@source "src/**/*.{ts,tsx}";\n@color { brand: 0.18 330; }`);
		expect(ds).toHaveLength(2);
		expect(ds[0].type).toBe("source");
		expect(ds[1].type).toBe("color");
		expect(ds[1].body).toContain("brand: 0.18 330");
	});

	it("a quoted { in another directive's modifier does not open the body", () => {
		const ds = extractDirectives(`@color "da{rk" { brand: 0.18 330; }`);
		expect(ds).toHaveLength(1);
		expect(ds[0].modifier).toBe('"da{rk"');
		expect(ds[0].body).toContain("brand: 0.18 330");
	});

	it("a quoted ; does not terminate a statement directive early", () => {
		const ds = extractDirectives(`@source "src/a;b/**/*.ts";\n@color { brand: 0.18 330; }`);
		expect(ds).toHaveLength(2);
		expect(ds[0].modifier).toBe('"src/a;b/**/*.ts"');
		expect(ds[1].type).toBe("color");
	});

	it("a { inside a prelude comment does not open the body", () => {
		const warnings: string[] = [];
		const ds = extractDirectives(`@rounded /* { */ bevel;`, warnings);
		expect(ds).toHaveLength(1);
		expect(ds[0].body).toBe("");
		expect(parseRoundedModifier(ds[0].modifier)).toBe("bevel");
		expect(warnings.some((w) => w.includes("[RI-1012]"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// parseKeyValueBody — depth-aware entry boundaries
// ---------------------------------------------------------------------------

describe("parseKeyValueBody — wrapped values", () => {
	it("keeps a trailing-comma wrapped value as ONE entry", () => {
		const { entries } = parseKeyValueBody(
			"card: 0 1px 2px oklch(0 0 0 / 0.1),\n  0 4px 8px oklch(0 0 0 / 0.12);",
		);
		expect(entries).toHaveLength(1);
		expect(entries[0][0]).toBe("card");
		expect(entries[0][1].replace(/\s+/g, " ")).toBe(
			"0 1px 2px oklch(0 0 0 / 0.1), 0 4px 8px oklch(0 0 0 / 0.12)",
		);
	});

	it("still splits newline-separated entries", () => {
		const { entries } = parseKeyValueBody("min: 10rem\nmax: 20rem");
		expect(entries).toEqual([
			["min", "10rem"],
			["max", "20rem"],
		]);
	});

	it("never splits inside parens spanning lines", () => {
		const { entries } = parseKeyValueBody("snappy: cubic-bezier(0.4,\n 0,\n 0.2,\n 1);");
		expect(entries).toHaveLength(1);
		expect(entries[0][1].replace(/\s+/g, " ")).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
	});

	it("keeps !key removals and --ri-rm recognition working", () => {
		const { entries, removals } = parseKeyValueBody("!slate;\n--ri-rm: zinc;\nbrand: 0.18 330;");
		expect(removals).toEqual(["slate", "zinc"]);
		expect(entries).toEqual([["brand", "0.18 330"]]);
	});

	it("applies a wrapped @shadow override as one scale entry end-to-end", () => {
		const theme = resolveDirectives([
			{
				type: "shadow",
				body: "card: 0 1px 2px oklch(0 0 0 / 0.1),\n  0 4px 8px oklch(0 0 0 / 0.12);",
			},
		]);
		expect(theme.shadows["card"]).toBeDefined();
		expect(theme.shadows["card"].replace(/\s+/g, " ")).toContain("0 4px 8px");
		// The continuation line must NOT have become its own broken entry.
		expect(Object.keys(theme.shadows).some((k) => k.includes("0 4px"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// parseTextBody — top-level comma split
// ---------------------------------------------------------------------------

describe("parseTextBody — depth-aware fontSize/lineHeight split", () => {
	it("keeps clamp() intact and reads the trailing line-height", () => {
		const { text } = parseTextBody("hero: clamp(2rem, 5vw, 4rem), 1.1;");
		expect(text["hero"].fontSize).toBe("clamp(2rem, 5vw, 4rem)");
		expect(text["hero"].lineHeight).toBe("1.1");
	});

	it("defaults line-height when the only commas are inside functions", () => {
		const { text } = parseTextBody("hero: clamp(2rem, 5vw, 4rem);");
		expect(text["hero"].fontSize).toBe("clamp(2rem, 5vw, 4rem)");
		expect(text["hero"].lineHeight).toBe("1.5");
	});
});

// ---------------------------------------------------------------------------
// parseFontBody / parseNestedFontBlock — wrapped declarations
// ---------------------------------------------------------------------------

describe("@font — wrapped declarations", () => {
	it("parses a multi-line manual font stack", () => {
		const configs = parseNestedFontBlock(`sans: "Inter",\n  ui-sans-serif,\n  sans-serif;`);
		expect(configs).toHaveLength(1);
		expect(configs[0].family).toBe("Inter");
		expect(configs[0].kind).toBe("manual");
		expect(configs[0].fallback).toEqual(["ui-sans-serif", "sans-serif"]);
	});

	it("parses a wrapped from-provider preamble with a block", () => {
		const slot = parseFontBody(
			'"Satoshi"\n  from "/fonts/Satoshi.woff2" { weight: 300 900; }',
			"sans",
		);
		expect(slot.family).toBe("Satoshi");
		expect(slot.kind).toBe("local");
		expect(slot.faces[0].provider).toBe("/fonts/Satoshi.woff2");
		expect(slot.faces[0].weight).toBe("300 900");
	});
});

// ---------------------------------------------------------------------------
// parseAnimateBody — removals only at top level
// ---------------------------------------------------------------------------

describe("parseAnimateBody — top-level-only removals", () => {
	it("keeps !important inside keyframes and records no bogus removal", () => {
		const { animations, removals } = parseAnimateBody(`
			!old;
			fade: fade 1s ease {
				from { opacity: 0 !important; }
				to { opacity: 1; }
			}
		`);
		expect(removals).toEqual(["old"]);
		expect(animations["fade"]).toBeDefined();
		expect(animations["fade"].keyframes).toContain("opacity: 0 !important;");
	});

	it("still supports --ri-rm at the top level", () => {
		const { animations, removals } = parseAnimateBody(`
			--ri-rm: spin;
			fade: fade 1s ease { from { opacity: 0; } to { opacity: 1; } }
		`);
		expect(removals).toEqual(["spin"]);
		expect(animations["fade"]).toBeDefined();
	});

	it("drops a colon-less fragment even when it carries a block", () => {
		// Regression guard for scanEntries yielding blocks on fragments (added for
		// @font's legacy @face desugaring): a keyless fragment must never register.
		const { animations } = parseAnimateBody(`
			stray { from { opacity: 0; } }
			fade: fade 1s ease { from { opacity: 0; } to { opacity: 1; } }
		`);
		expect(Object.keys(animations)).toEqual(["fade"]);
	});
});

// ---------------------------------------------------------------------------
// resolver — @animate removals route through mergeWithRemovals (RI-1103)
// ---------------------------------------------------------------------------

describe("resolver — @animate removal diagnostics", () => {
	it("warns RI-1103 when removing an animation that does not exist", () => {
		const theme = resolveDirectives([{ type: "animate", body: "!nope;" }]);
		expect(theme.warnings.some((w) => w.includes("[RI-1103]") && w.includes("@animate"))).toBe(
			true,
		);
		expect(theme.animations["spin"]).toBeDefined();
	});

	it("removes an existing animation without warning", () => {
		const theme = resolveDirectives([{ type: "animate", body: "!spin;" }]);
		expect(theme.animations["spin"]).toBeUndefined();
		expect(theme.warnings.some((w) => w.includes("[RI-1103]"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resolver — @fluid text/spacing accumulate
// ---------------------------------------------------------------------------

describe("resolver — consecutive @fluid target directives accumulate", () => {
	it("two @fluid text directives merge instead of resetting", () => {
		const theme = resolveDirectives([
			{ type: "fluid", body: "min: 24rem;", modifier: "text" },
			{ type: "fluid", body: "max: 90rem;", modifier: "text" },
		]);
		expect(theme.textFluid).toEqual({ min: "24rem", max: "90rem" });
	});

	it("two @fluid spacing directives merge instead of resetting", () => {
		const theme = resolveDirectives([
			{ type: "fluid", body: "min: 18rem; multiplier: 1.5;", modifier: "spacing" },
			{ type: "fluid", body: "max: 72rem;", modifier: "spacing" },
		]);
		expect(theme.spacingFluid).toEqual({ min: "18rem", max: "72rem", multiplier: 1.5 });
	});
});

// ---------------------------------------------------------------------------
// resolver — @rounded --roof / --corner-scale are last-wins
// ---------------------------------------------------------------------------

describe("resolver — @rounded special keys are last-wins", () => {
	it("takes the last --roof and --corner-scale occurrences", () => {
		const theme = resolveDirectives([
			{
				type: "rounded",
				body: "--roof: 1rem; --roof: 2rem; --corner-scale: 1.2; --corner-scale: 1.4;",
				modifier: "squircle",
			},
		]);
		expect(theme.roundedRoof).toBe("2rem");
		expect(theme.roundedShapeScale).toBe(1.4);
	});
});

// ---------------------------------------------------------------------------
// resolver — @font slot dedup (RI-1215) and slot cap (RI-1216)
// ---------------------------------------------------------------------------

describe("resolver — @font slot dedup", () => {
	it("keeps only the last definition of a slot and warns RI-1215", () => {
		const theme = resolveDirectives([
			{ type: "font", body: 'sans: "Inter" from google;' },
			{ type: "font", body: 'sans: "Onest" from google;' },
		]);
		expect(theme.fonts).toHaveLength(1);
		expect(theme.fonts[0].family).toBe("Onest");
		expect(theme.warnings.some((w) => w.includes("[RI-1215]") && w.includes('"sans"'))).toBe(true);
	});

	it("does not warn for distinct slots", () => {
		const theme = resolveDirectives([
			{ type: "font", body: 'sans: "Inter" from google;\nmono: system;' },
		]);
		expect(theme.fonts).toHaveLength(2);
		expect(theme.warnings.some((w) => w.includes("[RI-1215]"))).toBe(false);
	});
});

describe("parseNestedFontBlock — slot cap warns RI-1216", () => {
	it("warns when definitions beyond the cap are dropped", () => {
		const body = Array.from({ length: 21 }, (_, i) => `slot${i}: system;`).join("\n");
		const warnings: string[] = [];
		const configs = parseNestedFontBlock(body, warnings);
		expect(configs).toHaveLength(20);
		expect(warnings.some((w) => w.includes("[RI-1216]"))).toBe(true);
	});

	it("does not warn at exactly the cap", () => {
		const body = Array.from({ length: 20 }, (_, i) => `slot${i}: system;`).join("\n");
		const warnings: string[] = [];
		const configs = parseNestedFontBlock(body, warnings);
		expect(configs).toHaveLength(20);
		expect(warnings.some((w) => w.includes("[RI-1216]"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// RI-1035 — invalid entry keys and @utility names
// ---------------------------------------------------------------------------

describe("RI-1035 — invalid keys/names are warn-skipped", () => {
	it("warn-skips a colon-less @color fragment without eating later entries", () => {
		const warnings: string[] = [];
		const { colors } = parseColorBody("brand 0.18 330; accent: 0.2 100;", warnings);
		expect(colors["accent"]).toEqual({ type: "generative", chroma: 0.2, hue: 100 });
		expect(Object.keys(colors)).toHaveLength(1);
		expect(
			warnings.some(
				(w) => w.includes("[RI-1035]") && w.includes("@color") && w.includes("brand 0.18 330"),
			),
		).toBe(true);
	});

	it("skips an invalid key in a key-value directive, naming the directive", () => {
		const theme = resolveDirectives([{ type: "shadow", body: "bad key: 0 0 1px red;" }]);
		expect(theme.shadows["bad key"]).toBeUndefined();
		expect(theme.warnings.some((w) => w.includes("[RI-1035]") && w.includes("@shadow"))).toBe(true);
	});

	it("rejects `@utility my util` with RI-1035", () => {
		const warnings: string[] = [];
		const util = parseUtilityDirective("color: red;", "my util", warnings);
		expect(util).toBeNull();
		expect(warnings.some((w) => w.includes("[RI-1035]") && w.includes('"my util"'))).toBe(true);
	});

	it("rejects a ;-separated grouped-utility artifact with RI-1035", () => {
		const warnings: string[] = [];
		const utils = parseGroupedUtilityDirective(
			"alpha { color: red; }; beta { color: blue; }",
			warnings,
		);
		expect(utils).toHaveLength(1);
		expect(utils[0].name).toBe("alpha");
		expect(warnings.some((w) => w.includes("[RI-1035]"))).toBe(true);
	});

	it("still accepts digit-leading and --prefixed keys", () => {
		const warnings: string[] = [];
		const { entries } = parseKeyValueBody("2xl: 2rem; --roof: 1rem;", warnings, "rounded");
		expect(entries).toEqual([
			["2xl", "2rem"],
			["--roof", "1rem"],
		]);
		expect(warnings).toEqual([]);
	});

	it("still accepts functional utility names ending in -*", () => {
		const warnings: string[] = [];
		const util = parseUtilityDirective("tab-size: var(--value);", "tab-size-*", warnings);
		expect(util).toEqual({ name: "tab-size", functional: true, body: "tab-size: var(--value);" });
		expect(warnings).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// RI-1034 — ignored directive modifiers
// ---------------------------------------------------------------------------

describe("RI-1034 — ignored modifiers warn but the body still applies", () => {
	it("@shadow card { … } warns and merges globally", () => {
		const theme = resolveDirectives(extractDirectives("@shadow card { glow: 0 0 4px red; }"));
		expect(theme.shadows["glow"]).toBe("0 0 4px red");
		const w = theme.warnings.find((x) => x.includes("[RI-1034]"));
		expect(w).toBeDefined();
		expect(w).toContain("@shadow");
		expect(w).toContain('"card"');
	});

	it("@color with a non-dark modifier warns and applies as a regular block", () => {
		const theme = resolveDirectives(extractDirectives("@color brand { accent: 0.2 100; }"));
		expect(theme.colors["accent"]).toEqual({ type: "generative", chroma: 0.2, hue: 100 });
		expect(theme.warnings.some((w) => w.includes("[RI-1034]") && w.includes('"brand"'))).toBe(true);
	});

	it("@animate and @text with modifiers warn too", () => {
		const theme = resolveDirectives([
			{ type: "animate", body: "", modifier: "fast" },
			{ type: "text", body: "huge: 5rem, 1;", modifier: "display" },
		]);
		const hits = theme.warnings.filter((w) => w.includes("[RI-1034]"));
		expect(hits.some((w) => w.includes("@animate"))).toBe(true);
		expect(hits.some((w) => w.includes("@text"))).toBe(true);
		expect(theme.text["huge"]).toEqual({ fontSize: "5rem", lineHeight: "1" });
	});

	it("does not warn for modifier-less directives", () => {
		const theme = resolveDirectives([{ type: "shadow", body: "glow: 0 0 4px red;" }]);
		expect(theme.warnings.some((w) => w.includes("[RI-1034]"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// RI-1108 — options block on non-generative @color values
// ---------------------------------------------------------------------------

describe("RI-1108 — options block ignored on non-generative colors", () => {
	it("warns when a hex value carries a { dark: … } block", () => {
		const warnings: string[] = [];
		const { colors } = parseColorBody("surface: #ffffff { dark: fixed; };", warnings);
		expect(colors["surface"]).toEqual({ type: "explicit", value: "#ffffff" });
		expect(warnings.some((w) => w.includes("[RI-1108]") && w.includes('"surface"'))).toBe(true);
	});

	it("warns for pairs and aliases with option blocks", () => {
		const warnings: string[] = [];
		parseColorBody("surface: #fff / #111 { inline };\naccent: brand { dark: mirror; };", warnings);
		expect(warnings.filter((w) => w.includes("[RI-1108]"))).toHaveLength(2);
	});

	it("does not warn for generative values with option blocks", () => {
		const warnings: string[] = [];
		const { colors } = parseColorBody("brand: 0.18 330 { dark: fixed; };", warnings);
		expect(colors["brand"]).toEqual({
			type: "generative",
			chroma: 0.18,
			hue: 330,
			dark: { strategy: "fixed" },
		});
		expect(warnings).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// resolver — @preflight accumulates
// ---------------------------------------------------------------------------

describe("resolver — @preflight directives accumulate", () => {
	it("two selective directives both apply", () => {
		const theme = resolveDirectives([
			{ type: "preflight", body: "forms: off;" },
			{ type: "preflight", body: "interactive: off;" },
		]);
		expect(theme.preflight.forms).toBe(false);
		expect(theme.preflight.interactive).toBe(false);
		expect(theme.preflight.core).toBe(true);
	});

	it("selective re-enable after @preflight off keeps the rest off", () => {
		const theme = resolveDirectives([
			{ type: "preflight", body: "", modifier: "off" },
			{ type: "preflight", body: "forms: on;" },
		]);
		expect(theme.preflight.forms).toBe(true);
		expect(theme.preflight.core).toBe(false);
	});

	it("single-directive behavior is unchanged", () => {
		const theme = resolveDirectives([{ type: "preflight", body: "core: on; forms: off;" }]);
		expect(theme.preflight.core).toBe(true);
		expect(theme.preflight.forms).toBe(false);
		expect(theme.preflight.typography).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// resolver — theme freezing
// ---------------------------------------------------------------------------

describe("resolver — darkConfig is frozen with the other sub-objects", () => {
	it("freezes theme.darkConfig", () => {
		const theme = resolveDirectives([]);
		expect(Object.isFrozen(theme.darkConfig)).toBe(true);
	});
});
