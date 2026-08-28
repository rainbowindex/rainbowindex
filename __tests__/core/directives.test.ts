import { describe, expect, it } from "vitest";
import {
	extractDirectives,
	hasRIActivation,
	hasRIDirectiveName,
	parseAnimateBody,
	parseColorBody,
	parseCustomVariantDirective,
	parseFluidBody,
	parseFontBody,
	parseKeyValueBody,
	parseLayerDirective,
	parseNestedFontBlock,
	parsePreflightDirective,
	parseRoundedModifier,
	parseSourceDirective,
	parseSpacingBody,
	parseTextBody,
	parseUtilityDirective,
	MAX_DIRECTIVE_INPUT_SIZE,
	resolveDirectives,
} from "../../src/directives/index.js";
import { DEFAULT_COLORS } from "../../src/theme/index.js";
import { generateThemeOverrides } from "../../src/theme/colors.js";

// ---------------------------------------------------------------------------
// extractDirectives
// ---------------------------------------------------------------------------

describe("extractDirectives", () => {
	it("extracts @color with body", () => {
		const ds = extractDirectives(`@color { brand: 0.18 330; }`);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("color");
		expect(ds[0].body).toContain("brand: 0.18 330");
	});

	it("extracts multiple directives", () => {
		const ds = extractDirectives(`
			@color { brand: 0.18 330; }
			@text { huge: 5rem, 1; }
			@breakpoint { tablet: 50rem; }
		`);
		expect(ds).toHaveLength(3);
		expect(ds[0].type).toBe("color");
		expect(ds[1].type).toBe("text");
		expect(ds[2].type).toBe("breakpoint");
	});

	it("warns (RI-1202) and skips the removed @font-<slot> inline syntax", () => {
		const warnings: string[] = [];
		const ds = extractDirectives(`@font-sans "Inter" from google;`, warnings);
		expect(ds).toHaveLength(0);
		expect(warnings.some((w) => w.includes("[RI-1202]"))).toBe(true);
	});

	it("warns (RI-1202) and skips a removed @font-<slot> block too", () => {
		const warnings: string[] = [];
		const ds = extractDirectives(
			`@font-mono "JetBrains Mono" from google { weight: 400 700; }`,
			warnings,
		);
		expect(ds).toHaveLength(0);
		expect(warnings.some((w) => w.includes("[RI-1202]"))).toBe(true);
	});

	it("extracts the bare @font block", () => {
		const ds = extractDirectives(`@font { sans: "Inter" from google; }`);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("font");
		expect(ds[0].body).toContain("sans:");
	});

	it("extracts @preflight bare", () => {
		const ds = extractDirectives(`@preflight;`);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("preflight");
		expect(ds[0].body).toBe("");
	});

	it("extracts @preflight off", () => {
		const ds = extractDirectives(`@preflight off;`);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("preflight");
		expect(ds[0].modifier).toBe("off");
	});

	it("extracts @preflight with body", () => {
		const ds = extractDirectives(`@preflight { core: on; forms: off; }`);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("preflight");
		expect(ds[0].body).toContain("core: on");
	});

	it("extracts @rounded with squircle modifier", () => {
		const ds = extractDirectives(`@rounded squircle { sm: 0.125rem; }`);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("rounded");
		expect(ds[0].modifier).toBe("squircle");
	});

	it("extracts @rounded squircle(2.0)", () => {
		const ds = extractDirectives(`@rounded squircle(2.0) { sm: 0.125rem; }`);
		expect(ds).toHaveLength(1);
		expect(ds[0].modifier).toBe("squircle(2.0)");
	});

	it("extracts @rounded squircle bare", () => {
		const ds = extractDirectives(`@rounded squircle;`);
		expect(ds).toHaveLength(1);
		expect(ds[0].modifier).toBe("squircle");
		expect(ds[0].body).toBe("");
	});

	it("extracts @utility with modifier (name)", () => {
		const ds = extractDirectives(`@utility card { background: var(--color-surface); }`);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("utility");
		expect(ds[0].modifier).toBe("card");
	});

	it("extracts @custom with inline selector", () => {
		const ds = extractDirectives(
			`@custom hocus (&:hover, &:focus) { &:hover, &:focus { @slot; } }`,
		);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("custom");
	});

	it("extracts @source with modifier", () => {
		const ds = extractDirectives(`@source "./src/**/*.ts";`);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("source");
	});

	it("skips standard CSS at-rules", () => {
		const ds = extractDirectives(`
			@import "something";
			@media (min-width: 640px) { .foo { color: red; } }
			@supports (display: grid) { .bar { display: grid; } }
			@keyframes spin { from { transform: rotate(0); } }
			@color { brand: 0.18 330; }
		`);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("color");
	});

	it("skips CSS comments", () => {
		const ds = extractDirectives(`
			/* @color { ignored: 0.1 100; } */
			@color { brand: 0.18 330; }
		`);
		expect(ds).toHaveLength(1);
	});

	it("extracts multiple font slots from one @font block", () => {
		const ds = extractDirectives(`@font {
      sans: "Inter" from google;
      serif: "Merriweather" from google;
      mono: "Fira Code" from google;
    }`);
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("font");
		expect(ds[0].body).toContain("sans:");
		expect(ds[0].body).toContain("serif:");
		expect(ds[0].body).toContain("mono:");
	});

	it("does not confuse @font block with @font-face", () => {
		const ds = extractDirectives(`
      @font-face { font-family: "Custom"; src: url("c.woff2"); }
      @font { sans: "Inter" from google; }
    `);
		// @font-face is skipped (standard CSS), @font is captured
		expect(ds).toHaveLength(1);
		expect(ds[0].type).toBe("font");
	});

	it("returns no directives and warns when source exceeds size limit", () => {
		const warnings: string[] = [];
		const oversized = `@color { brand: 0.18 330; }\n${"a".repeat(MAX_DIRECTIVE_INPUT_SIZE + 1)}`;
		const ds = extractDirectives(oversized, warnings);
		expect(ds).toHaveLength(0);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("[RI-1019] CSS input exceeds 5 MB limit");
	});
});

describe("hasRIActivation — directive detection", () => {
	it("detects standard RI directives", () => {
		expect(hasRIActivation('@source inline("flex");')).toBe(true);
	});

	it("detects PostCSS-only @apply and @slot", () => {
		expect(hasRIActivation(".x { @apply flex; }")).toBe(true);
		expect(hasRIActivation("@slot header { color: red; }")).toBe(true);
	});

	it("ignores mentions inside comments", () => {
		expect(hasRIActivation("/* mention @color { brand: 0.2 200; } */")).toBe(false);
		expect(hasRIActivation('// @source "./src/**/*.tsx";\n.x { color: red; }')).toBe(false);
	});

	it("ignores mentions inside strings", () => {
		expect(hasRIActivation('.x::before { content: "@source inline(\\"flex\\")"; }')).toBe(false);
	});

	it("does not treat standard prefixed at-rules as directives", () => {
		expect(hasRIActivation('@font-face { font-family: "Custom"; }')).toBe(false);
		expect(hasRIActivation("@custom-media --narrow (max-width: 40rem);")).toBe(false);
	});

	it("does not match @ tokens inside URL/property values", () => {
		expect(
			hasRIActivation(".x { background-image: url(https://cdn.example.com/@source.png); }"),
		).toBe(false);
		expect(hasRIActivation('.x { content: "mailto:user@example.com"; }')).toBe(false);
	});

	it("matches directives immediately after block comments", () => {
		expect(hasRIActivation('/* lead */@source inline("flex");')).toBe(true);
	});

	it("// inside url() is content, not a line comment", () => {
		// A protocol-relative URL must not swallow the rest of the line —
		// extractDirectives and the activation scan share this paren-depth rule.
		expect(
			hasRIActivation(
				".x { background: url(//cdn.example.com/a.png); } @color { brand: 0.1 200; }",
			),
		).toBe(true);
	});

	it("detects specific directive names outside comments/strings", () => {
		expect(hasRIDirectiveName(".x { @apply flex; }", "apply")).toBe(true);
		expect(hasRIDirectiveName("/* @apply flex; */ .x { color: red; }", "apply")).toBe(false);
		expect(hasRIDirectiveName('.x::before { content: "@slot nav"; }', "slot")).toBe(false);
	});
});

describe("hasRIActivation — package import detection", () => {
	it('detects @import "rainbowindex"', () => {
		expect(hasRIActivation('@import "rainbowindex";')).toBe(true);
		expect(hasRIActivation("@import 'rainbowindex' layer(base);")).toBe(true);
		expect(hasRIActivation('@import "rainbowindex/index.css";')).toBe(true);
		expect(hasRIActivation('@import url("rainbowindex");')).toBe(true);
	});

	it("ignores non-package imports and comments", () => {
		expect(hasRIActivation('@import "something-else";')).toBe(false);
		expect(hasRIActivation('/* @import "rainbowindex"; */')).toBe(false);
		expect(hasRIActivation('.x::before { content: "@import \\"rainbowindex\\""; }')).toBe(false);
	});

	it("activates on either directives or the package import, not plain CSS", () => {
		expect(hasRIActivation('@import "rainbowindex";')).toBe(true);
		expect(hasRIActivation('@source "./src/**/*.tsx";')).toBe(true);
		expect(hasRIActivation("body { color: red; }")).toBe(false);
	});

	it("finds a directive after a non-matching @import in the same scan", () => {
		expect(hasRIActivation('@import "reset.css";\n@color { brand: 0.18 330; }')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// parseKeyValueBody
// ---------------------------------------------------------------------------

describe("parseKeyValueBody", () => {
	it("parses simple key-value pairs", () => {
		const { entries } = parseKeyValueBody("sm: 0.125rem; md: 0.375rem;");
		expect(entries).toEqual([
			["sm", "0.125rem"],
			["md", "0.375rem"],
		]);
	});

	it("handles newline-separated entries", () => {
		const { entries } = parseKeyValueBody("sm: 0.125rem\nmd: 0.375rem");
		expect(entries).toEqual([
			["sm", "0.125rem"],
			["md", "0.375rem"],
		]);
	});

	it("handles removals", () => {
		const { entries, removals } = parseKeyValueBody("!slate; !zinc; brand: 0.18 330;");
		expect(removals).toEqual(["slate", "zinc"]);
		expect(entries).toEqual([["brand", "0.18 330"]]);
	});

	it("handles --ri-rm PostCSS-safe removals", () => {
		const { entries, removals } = parseKeyValueBody(
			"--ri-rm: slate; --ri-rm: zinc; brand: 0.18 330;",
		);
		expect(removals).toEqual(["slate", "zinc"]);
		expect(entries).toEqual([["brand", "0.18 330"]]);
	});

	it("skips empty lines", () => {
		const { entries } = parseKeyValueBody("  \n  sm: 0.125rem  \n  ");
		expect(entries).toEqual([["sm", "0.125rem"]]);
	});
});

// ---------------------------------------------------------------------------
// parseColorBody
// ---------------------------------------------------------------------------

describe("parseColorBody", () => {
	it("parses chroma + hue", () => {
		const { colors } = parseColorBody("brand: 0.18 330;");
		expect(colors["brand"]).toEqual({
			type: "generative",
			chroma: 0.18,
			hue: 330,
		});
	});

	it("parses multiple colors", () => {
		const { colors } = parseColorBody("brand: 0.18 330; accent: 0.15 270;");
		expect(Object.keys(colors)).toHaveLength(2);
	});

	it("handles removals", () => {
		const { removals } = parseColorBody("!slate; !zinc;");
		expect(removals).toEqual(["slate", "zinc"]);
	});

	it("handles --ri-rm PostCSS-safe removals", () => {
		const { removals } = parseColorBody("--ri-rm: slate; --ri-rm: zinc;");
		expect(removals).toEqual(["slate", "zinc"]);
	});

	it("parses light-dark() as pair alias", () => {
		const { colors } = parseColorBody(
			"surface: light-dark(oklch(0.98 0.01 260), oklch(0.15 0.01 260));",
		);
		expect(colors["surface"]).toEqual({
			type: "pair",
			light: "oklch(0.98 0.01 260)",
			dark: "oklch(0.15 0.01 260)",
		});
	});

	it("parses light-dark() with nested parens", () => {
		const { colors } = parseColorBody(
			"overlay: light-dark(rgb(0 0 0 / 0.1), rgb(255 255 255 / 0.1));",
		);
		expect(colors["overlay"]).toEqual({
			type: "pair",
			light: "rgb(0 0 0 / 0.1)",
			dark: "rgb(255 255 255 / 0.1)",
		});
	});

	it("expands stop reference to var()", () => {
		const { colors } = parseColorBody("code-comment: theme-700;");
		expect(colors["code-comment"]).toEqual({
			type: "explicit",
			value: "var(--color-theme-700)",
		});
	});

	it("expands stop references in slash pairs", () => {
		const { colors } = parseColorBody("code-comment: theme-700 / theme-300;");
		expect(colors["code-comment"]).toEqual({
			type: "pair",
			light: "var(--color-theme-700)",
			dark: "var(--color-theme-300)",
		});
	});

	it("expands stop references inside light-dark()", () => {
		const { colors } = parseColorBody("code-comment: light-dark(theme-700, theme-300);");
		expect(colors["code-comment"]).toEqual({
			type: "pair",
			light: "var(--color-theme-700)",
			dark: "var(--color-theme-300)",
		});
	});

	it("applies /alpha to a stop reference as a color-mix", () => {
		const { colors } = parseColorBody("border: theme-282/52;");
		expect(colors["border"]).toEqual({
			type: "explicit",
			value: "color-mix(in oklab, var(--color-theme-282) 52%, transparent)",
		});
	});

	it("applies per-side /alpha across a light/dark stop pair", () => {
		const { colors } = parseColorBody("border: theme-282/52 / theme-344/52;");
		expect(colors["border"]).toEqual({
			type: "pair",
			light: "color-mix(in oklab, var(--color-theme-282) 52%, transparent)",
			dark: "color-mix(in oklab, var(--color-theme-344) 52%, transparent)",
		});
	});

	it("treats a fractional /alpha as a percentage", () => {
		const { colors } = parseColorBody("border: theme-282/0.4;");
		expect(colors["border"]).toEqual({
			type: "explicit",
			value: "color-mix(in oklab, var(--color-theme-282) 40%, transparent)",
		});
	});

	it("does not mistake a native oklch alpha slash for a pair separator", () => {
		const { colors } = parseColorBody(
			"surface: oklch(0.98 0.01 260 / 0.5) / oklch(0.15 0.01 260);",
		);
		expect(colors["surface"]).toEqual({
			type: "pair",
			light: "oklch(0.98 0.01 260 / 0.5)",
			dark: "oklch(0.15 0.01 260)",
		});
	});

	it("does not expand invalid stop numbers", () => {
		const { colors } = parseColorBody("foo: brand-99999;");
		// 99999 is not a valid suffix, so treated as alias
		expect(colors["foo"]).toEqual({ type: "alias", source: "brand-99999" });
	});

	it("parses 3-digit hex color", () => {
		const { colors } = parseColorBody("surface: #abc;");
		expect(colors["surface"]).toEqual({ type: "explicit", value: "#abc" });
	});

	it("parses 6-digit hex color", () => {
		const { colors } = parseColorBody("brand: #ff5500;");
		expect(colors["brand"]).toEqual({ type: "explicit", value: "#ff5500" });
	});

	it("parses 8-digit hex color with alpha", () => {
		const { colors } = parseColorBody("overlay: #ff550080;");
		expect(colors["overlay"]).toEqual({ type: "explicit", value: "#ff550080" });
	});

	it("parses hex in light/dark pair", () => {
		const { colors } = parseColorBody("surface: #ffffff / #111111;");
		expect(colors["surface"]).toEqual({
			type: "pair",
			light: "#ffffff",
			dark: "#111111",
		});
	});

	it("parses bare inline keyword in block", () => {
		const { colors } = parseColorBody("brand: 0.18 330 { inline };");
		expect(colors["brand"]).toEqual({
			type: "generative",
			chroma: 0.18,
			hue: 330,
			inline: true,
		});
	});

	it("parses inline combined with dark override", () => {
		const { colors } = parseColorBody("brand: 0.18 330 { inline; dark: fixed; };");
		expect(colors["brand"]).toEqual({
			type: "generative",
			chroma: 0.18,
			hue: 330,
			dark: { strategy: "fixed" },
			inline: true,
		});
	});

	it("parses dark override with inline after", () => {
		const { colors } = parseColorBody("brand: 0.18 330 { dark: mirror; inline };");
		expect(colors["brand"]).toEqual({
			type: "generative",
			chroma: 0.18,
			hue: 330,
			dark: { strategy: "mirror" },
			inline: true,
		});
	});

	it("recognizes the Vite-rewritten --ri-inline form", () => {
		// The Vite plugin rewrites the bare `inline` flag to `--ri-inline: true` so
		// PostCSS can parse the @color block; parseColorBody must accept it too.
		const { colors } = parseColorBody("brand: 0.18 330 { --ri-inline: true; };");
		expect(colors["brand"]).toEqual({
			type: "generative",
			chroma: 0.18,
			hue: 330,
			inline: true,
		});
	});

	it("parses a dark: shift override (the `shift` strategy keyword is not an option flag)", () => {
		// The `shift` strategy keyword inside a `dark:` value is parsed as the dark
		// override strategy, not mistaken for a bare option flag.
		const { colors } = parseColorBody("brand: 0.18 330 { dark: shift chroma +0.02 hue +10; };");
		expect(colors["brand"]).toEqual({
			type: "generative",
			chroma: 0.18,
			hue: 330,
			dark: { strategy: "shift", chromaDelta: 0.02, hueDelta: 10 },
		});
	});

	it("parses bare ramp flags (parabolic / no-parabolic)", () => {
		const { colors } = parseColorBody("brand: 0.18 330 { no-parabolic; };");
		expect(colors["brand"]).toEqual({
			type: "generative",
			chroma: 0.18,
			hue: 330,
			parabolic: false,
		});
	});

	it("omits inline flag when not specified", () => {
		const { colors } = parseColorBody("brand: 0.18 330;");
		expect(colors["brand"]).toEqual({
			type: "generative",
			chroma: 0.18,
			hue: 330,
		});
		expect(colors["brand"]).not.toHaveProperty("inline");
	});
});

// ---------------------------------------------------------------------------
// parseTextBody
// ---------------------------------------------------------------------------

describe("parseTextBody", () => {
	it("parses paired values", () => {
		const { text } = parseTextBody("xs: 0.75rem, calc(1 / 0.75);");
		expect(text["xs"].fontSize).toBe("0.75rem");
		expect(text["xs"].lineHeight).toBe("calc(1 / 0.75)");
	});

	it("defaults line-height to 1.5", () => {
		const { text } = parseTextBody("huge: 5rem;");
		expect(text["huge"].lineHeight).toBe("1.5");
	});

	it("handles removals", () => {
		const { removals } = parseTextBody("!xs;");
		expect(removals).toEqual(["xs"]);
	});
});

// ---------------------------------------------------------------------------
// parseSpacingBody
// ---------------------------------------------------------------------------

describe("parseSpacingBody", () => {
	it("parses base value", () => {
		const { base } = parseSpacingBody("base: 0.3rem;");
		expect(base).toBe("0.3rem");
	});
});

// ---------------------------------------------------------------------------
// parseAnimateBody
// ---------------------------------------------------------------------------

describe("parseAnimateBody", () => {
	it("parses animation with keyframes", () => {
		const { animations: result } = parseAnimateBody(`
			spin: spin 1s linear infinite {
				from { transform: rotate(0deg); }
				to { transform: rotate(360deg); }
			}
		`);
		expect(result["spin"]).toBeDefined();
		expect(result["spin"].shorthand).toBe("spin 1s linear infinite");
		expect(result["spin"].keyframes).toContain("rotate(0deg)");
		expect(result["spin"].keyframes).toContain("rotate(360deg)");
	});

	it("parses multiple animations", () => {
		const { animations: result } = parseAnimateBody(`
			spin: spin 1s linear infinite {
				from { transform: rotate(0deg); }
				to { transform: rotate(360deg); }
			}
			pulse: pulse 2s ease infinite {
				0%, 100% { opacity: 1; }
				50% { opacity: 0.5; }
			}
		`);
		expect(result["spin"]).toBeDefined();
		expect(result["pulse"]).toBeDefined();
	});

	it("supports !name removal syntax", () => {
		const { animations, removals } = parseAnimateBody(`
			!spin;
			bounce: bounce 0.5s ease {
				0%, 100% { transform: translateY(0); }
				50% { transform: translateY(-10px); }
			}
		`);
		expect(removals).toContain("spin");
		expect(animations["bounce"]).toBeDefined();
	});

	it("supports --ri-rm PostCSS-safe removal syntax", () => {
		const { animations, removals } = parseAnimateBody(`
			--ri-rm: spin;
			bounce: bounce 0.5s ease {
				0%, 100% { transform: translateY(0); }
				50% { transform: translateY(-10px); }
			}
		`);
		expect(removals).toContain("spin");
		expect(animations["bounce"]).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// parseFluidBody
// ---------------------------------------------------------------------------

describe("parseFluidBody", () => {
	it("parses min and max", () => {
		const result = parseFluidBody("min: 20rem; max: 80rem; unit: vw; multiplier: 1.5;");
		expect(result.min).toBe("20rem");
		expect(result.max).toBe("80rem");
		expect(result.unit).toBe("vw");
		expect(result.multiplier).toBe("1.5");
	});

	it("handles partial", () => {
		const result = parseFluidBody("min: 20rem;");
		expect(result.min).toBe("20rem");
		expect(result.max).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// parsePreflightDirective
// ---------------------------------------------------------------------------

describe("parsePreflightDirective", () => {
	it("bare: all on", () => {
		const config = parsePreflightDirective("");
		expect(config.core).toBe(true);
		expect(config.forms).toBe(true);
	});

	it("off modifier: all off", () => {
		const config = parsePreflightDirective("", "off");
		expect(config.core).toBe(false);
		expect(config.forms).toBe(false);
		expect(config.modern).toBe(false);
	});

	it("selective", () => {
		const config = parsePreflightDirective("core: on; forms: off;");
		expect(config.core).toBe(true);
		expect(config.forms).toBe(false);
		expect(config.typography).toBe(true); // unchanged default
	});
});

// ---------------------------------------------------------------------------
// parseFontBody
// ---------------------------------------------------------------------------

describe("parseFontBody", () => {
	it("parses system keyword", () => {
		const slot = parseFontBody("system", "sans");
		expect(slot.kind).toBe("system");
	});

	it("parses provider-based font", () => {
		const slot = parseFontBody('"Inter" from google', "sans");
		expect(slot.family).toBe("Inter");
		expect(slot.kind).toBe("google");
		expect(slot.faces[0].provider).toBe("google");
		expect(slot.slot).toBe("sans");
	});

	it("parses provider with block body", () => {
		const slot = parseFontBody(
			'"Inter" from google { weight: 100 900; display: optional; }',
			"sans",
		);
		expect(slot.family).toBe("Inter");
		expect(slot.faces[0].weight).toBe("100 900");
		expect(slot.faces[0].display).toBe("optional");
	});

	it("parses manual font stack", () => {
		const slot = parseFontBody('"Inter", ui-sans-serif, sans-serif', "sans");
		expect(slot.family).toBe("Inter");
		expect(slot.kind).toBe("manual");
		expect(slot.fallback).toEqual(["ui-sans-serif", "sans-serif"]);
	});

	it("parses manual stack with features", () => {
		const slot = parseFontBody('"Inter", ui-sans-serif { features: "cv11", "ss01"; }', "sans");
		expect(slot.features).toBe('"cv11", "ss01"');
	});

	it("parses local file provider", () => {
		const slot = parseFontBody('"Satoshi" from "/fonts/satoshi.woff2"', "sans");
		expect(slot.family).toBe("Satoshi");
		expect(slot.kind).toBe("local");
		expect(slot.faces[0].provider).toBe("/fonts/satoshi.woff2");
	});

	it("parses a local font with @face blocks (regular + italic)", () => {
		const slot = parseFontBody(
			'"Satoshi" { weight: 300 900; @face { src: "/fonts/Satoshi.woff2"; style: normal; } @face { src: "/fonts/Satoshi-Italic.woff2"; style: italic; } }',
			"sans",
		);
		expect(slot.kind).toBe("local");
		expect(slot.faces).toHaveLength(2);
		expect(slot.faces[0].provider).toBe("/fonts/Satoshi.woff2");
		expect(slot.faces[0].weight).toBe("300 900"); // inherited slot default
		expect(slot.faces[1].provider).toBe("/fonts/Satoshi-Italic.woff2");
		expect(slot.faces[1].style).toBe("italic");
	});

	it("desugars the italic: shorthand into a second face", () => {
		const slot = parseFontBody(
			'"Satoshi" from "/fonts/Satoshi.woff2" { weight: 300 900; italic: "/fonts/Satoshi-Italic.woff2"; }',
			"sans",
		);
		expect(slot.kind).toBe("local");
		expect(slot.faces).toHaveLength(2);
		expect(slot.faces[0].provider).toBe("/fonts/Satoshi.woff2");
		expect(slot.faces[0].style).toBe("normal");
		expect(slot.faces[1].provider).toBe("/fonts/Satoshi-Italic.woff2");
		expect(slot.faces[1].style).toBe("italic");
		expect(slot.faces[1].weight).toBe("300 900"); // inherited
	});

	it("warns (RI-1204) when a google slot also declares @face faces", () => {
		const warnings: string[] = [];
		const slot = parseFontBody(
			'"Inter" from google { @face { src: "/fonts/Inter.woff2"; } }',
			"sans",
			warnings,
		);
		expect(slot.kind).toBe("google");
		expect(slot.faces).toHaveLength(1); // extra @face ignored
		expect(warnings.some((w) => w.includes("[RI-1204]"))).toBe(true);
	});

	it("parses font with explicit metrics", () => {
		const slot = parseFontBody(
			'"Inter" from google { metrics: "Arial" 107.64 90.49 22.48 0; }',
			"sans",
		);
		expect(slot.family).toBe("Inter");
		expect(slot.metrics).toEqual({
			fallback: "Arial",
			sizeAdjust: 107.64,
			ascent: 90.49,
			descent: 22.48,
			lineGap: 0,
		});
	});

	it("parses metrics: none", () => {
		const slot = parseFontBody('"Inter" from google { metrics: none; }', "sans");
		expect(slot.metrics).toBeNull();
	});

	it("parses metrics with only a fallback font", () => {
		const slot = parseFontBody('"Inter" from google { metrics: "Segoe UI"; }', "sans");
		expect(slot.metrics).toEqual({ fallback: "Segoe UI" });
	});

	it("warns (RI-1220) on a partial metrics value and ignores it", () => {
		const warnings: string[] = [];
		const slot = parseFontBody(
			'"Inter" from google { metrics: "Arial" 105 92; }',
			"sans",
			warnings,
		);
		expect(slot.metrics).toBeUndefined();
		expect(warnings.some((w) => w.includes("[RI-1220]"))).toBe(true);
	});

	it("warns (RI-1220) when metrics are set on a manual stack, but still stores them", () => {
		const warnings: string[] = [];
		const slot = parseFontBody(
			'"Inter", ui-sans-serif { metrics: "Arial" 100 90 22 0; }',
			"sans",
			warnings,
		);
		expect(slot.metrics?.sizeAdjust).toBe(100);
		expect(warnings.some((w) => w.includes("[RI-1220]"))).toBe(true);
	});

	it("parses face: entries with inherited defaults and per-face overrides", () => {
		const slot = parseFontBody(
			'"Satoshi" { weight: 300 900; face: /fonts/Satoshi.woff2; face: "/fonts/Satoshi-Italic.woff2" { style: italic; } }',
			"sans",
		);
		expect(slot.kind).toBe("local");
		expect(slot.faces).toHaveLength(2);
		expect(slot.faces[0].provider).toBe("/fonts/Satoshi.woff2");
		expect(slot.faces[0].weight).toBe("300 900"); // inherited slot default
		expect(slot.faces[1].provider).toBe("/fonts/Satoshi-Italic.woff2");
		expect(slot.faces[1].style).toBe("italic");
	});

	it("parses fallbacks in the preamble of a google slot", () => {
		const slot = parseFontBody(
			'"Inter", ui-sans-serif, sans-serif from google { weight: 400 700; }',
			"sans",
		);
		expect(slot.kind).toBe("google");
		expect(slot.family).toBe("Inter");
		expect(slot.fallback).toEqual(["ui-sans-serif", "sans-serif"]);
		expect(slot.faces[0].weight).toBe("400 700");
	});

	it("warns (RI-1217) on an unknown option key", () => {
		const warnings: string[] = [];
		parseFontBody('"Inter" from google { fallbak: sans-serif; }', "sans", warnings);
		expect(warnings.some((w) => w.includes("[RI-1217]") && w.includes('"fallbak"'))).toBe(true);
	});

	it("warns (RI-1219) when preload is set on a google slot", () => {
		const warnings: string[] = [];
		parseFontBody('"Inter" from google { preload: true; }', "sans", warnings);
		expect(warnings.some((w) => w.includes("[RI-1219]"))).toBe(true);
	});

	it("warns (RI-1218) on deprecated forms while still desugaring them", () => {
		const warnings: string[] = [];
		const slot = parseFontBody(
			'"Satoshi" from "/fonts/Satoshi.woff2" { italic: "/fonts/Satoshi-Italic.woff2"; }',
			"sans",
			warnings,
		);
		expect(slot.kind).toBe("local");
		expect(slot.faces).toHaveLength(2);
		expect(warnings.filter((w) => w.includes("[RI-1218]"))).toHaveLength(2); // from-path + italic
	});

	it("warns (RI-1218) and folds the legacy five-key metrics cluster", () => {
		const warnings: string[] = [];
		const slot = parseFontBody(
			'"Inter" from google { sizeAdjust: 107.64; ascent: 90.49; descent: 22.48; lineGap: 0; metricsFallback: Arial; }',
			"sans",
			warnings,
		);
		expect(slot.metrics).toEqual({
			fallback: "Arial",
			sizeAdjust: 107.64,
			ascent: 90.49,
			descent: 22.48,
			lineGap: 0,
		});
		expect(warnings.some((w) => w.includes("[RI-1218]"))).toBe(true);
	});

	it("warns (RI-1220) on a partial legacy metrics cluster", () => {
		const warnings: string[] = [];
		const slot = parseFontBody('"Inter" from google { sizeAdjust: 107.64; }', "sans", warnings);
		expect(slot.metrics).toBeUndefined();
		expect(warnings.some((w) => w.includes("[RI-1220]"))).toBe(true);
	});

	it("desugars from system to a system slot with an RI-1218 warning", () => {
		const warnings: string[] = [];
		const slot = parseFontBody('"Whatever" from system', "sans", warnings);
		expect(slot.kind).toBe("system");
		expect(warnings.some((w) => w.includes("[RI-1218]"))).toBe(true);
	});

	it("sanitizes preamble fallback entries through the family trust boundary", () => {
		const slot = parseFontBody('"Inter", "foo;} .evil { color: red } " from google', "sans");
		expect(slot.kind).toBe("google");
		for (const f of slot.fallback) {
			expect(f).not.toMatch(/[;{}]/);
		}
	});

	it("sanitizes deprecated fallback: entries too", () => {
		const slot = parseFontBody('"Inter" from google { fallback: "bad;}stack", Arial; }', "sans");
		for (const f of slot.fallback) {
			expect(f).not.toMatch(/[;{}]/);
		}
		expect(slot.fallback).toContain("Arial");
	});

	it("drops a features value that would break out of its declaration (RI-1217)", () => {
		// An unbalanced quote is the one way a `}` survives brace pairing into a value.
		const warnings: string[] = [];
		const slot = parseFontBody(
			'"Inter" from google { features: "cv11; } :root{--x:y}',
			"sans",
			warnings,
		);
		expect(slot.features).toBeNull();
		expect(warnings.some((w) => w.includes("[RI-1217]"))).toBe(true);
	});

	it("keeps a quoted features list (quotes are inert in emitted CSS)", () => {
		const slot = parseFontBody('"Inter", ui-sans-serif { features: "cv11", "ss01"; }', "sans");
		expect(slot.features).toBe('"cv11", "ss01"');
	});

	it("drops an unsafe unicode-range value (RI-1217)", () => {
		const warnings: string[] = [];
		const slot = parseFontBody(
			'"Satoshi" { face: /f.woff2; unicode-range: "U+0-FF} .evil{color:red; }',
			"sans",
			warnings,
		);
		expect(slot.faces[0].unicodeRange).toBeUndefined();
		expect(warnings.some((w) => w.includes("[RI-1217]"))).toBe(true);
	});

	it("warns (RI-1220) on metrics with an empty quoted name instead of silently disabling", () => {
		const warnings: string[] = [];
		const slot = parseFontBody('"Inter" from google { metrics: ""; }', "sans", warnings);
		expect(slot.metrics).toBeUndefined();
		expect(warnings.some((w) => w.includes("[RI-1220]"))).toBe(true);
	});

	it("warns (RI-1217) on a stray keyless value (e.g. a line-wrapped metrics tail)", () => {
		const warnings: string[] = [];
		parseFontBody(
			'"Inter" from google { metrics: "Arial"\n 107.64 90.49 22.48 0; }',
			"sans",
			warnings,
		);
		expect(warnings.some((w) => w.includes("[RI-1217]") && w.includes("stray value"))).toBe(true);
	});

	it("warns (RI-1217) when a scalar key carries a { } block", () => {
		const warnings: string[] = [];
		const slot = parseFontBody(
			'"Satoshi" { weight: 400 { face: /hidden.woff2; } face: /real.woff2; }',
			"sans",
			warnings,
		);
		expect(slot.faces).toHaveLength(1);
		expect(slot.faces[0].provider).toBe("/real.woff2");
		expect(warnings.some((w) => w.includes("[RI-1217]") && w.includes("takes no"))).toBe(true);
	});

	it("warns (RI-1217) on a face: entry with no source", () => {
		const warnings: string[] = [];
		const slot = parseFontBody('"Satoshi" { face: { style: italic; } }', "sans", warnings);
		expect(slot.kind).toBe("manual");
		expect(warnings.some((w) => w.includes("[RI-1217]") && w.includes("no source"))).toBe(true);
	});

	it("warns (RI-1217) on an unterminated block inside a slot body", () => {
		const warnings: string[] = [];
		parseFontBody('"Satoshi" { face: /f.woff2 { style: italic;', "sans", warnings);
		expect(warnings.some((w) => w.includes("[RI-1217]") && w.includes("unterminated"))).toBe(true);
	});

	it("still emits body diagnostics for a system slot", () => {
		const warnings: string[] = [];
		const slot = parseFontBody("system { preload: true; subzet: latin; }", "sans", warnings);
		expect(slot.kind).toBe("system");
		expect(warnings.some((w) => w.includes("[RI-1219]"))).toBe(true);
		expect(warnings.some((w) => w.includes("[RI-1217]") && w.includes('"subzet"'))).toBe(true);
	});

	it("warns (RI-1217) on a slot with no family before its block", () => {
		const warnings: string[] = [];
		const slot = parseFontBody("{ weight: 400; }", "sans", warnings);
		expect(slot.family).toBe("");
		expect(warnings.some((w) => w.includes("[RI-1217]") && w.includes("no font family"))).toBe(
			true,
		);
	});
});

// ---------------------------------------------------------------------------
// parseNestedFontBlock
// ---------------------------------------------------------------------------

describe("parseNestedFontBlock", () => {
	it("parses multiple slots", () => {
		const configs = parseNestedFontBlock(`
      sans: "Inter" from google;
      serif: "Merriweather" from google;
      mono: "Fira Code" from google;
    `);
		expect(configs).toHaveLength(3);
		expect(configs[0].slot).toBe("sans");
		expect(configs[0].family).toBe("Inter");
		expect(configs[0].kind).toBe("google");
		expect(configs[1].slot).toBe("serif");
		expect(configs[1].family).toBe("Merriweather");
		expect(configs[2].slot).toBe("mono");
		expect(configs[2].family).toBe("Fira Code");
	});

	it("parses system keyword in nested block", () => {
		const configs = parseNestedFontBlock(`sans: system;`);
		expect(configs).toHaveLength(1);
		expect(configs[0].slot).toBe("sans");
		expect(configs[0].kind).toBe("system");
	});

	it("parses nested block with options", () => {
		const configs = parseNestedFontBlock(`
      sans: "Inter" from google {
        weight: 100 900;
        display: optional;
        metrics: "Arial" 107.64 90.49 22.48 0;
      }
      mono: "Fira Code" from google;
    `);
		expect(configs).toHaveLength(2);
		expect(configs[0].slot).toBe("sans");
		expect(configs[0].faces[0].weight).toBe("100 900");
		expect(configs[0].faces[0].display).toBe("optional");
		expect(configs[0].metrics?.sizeAdjust).toBe(107.64);
		expect(configs[1].slot).toBe("mono");
		expect(configs[1].kind).toBe("google");
	});

	it("parses face: entries in a nested block", () => {
		const configs = parseNestedFontBlock(`
      display: "Satoshi" {
        weight: 300 900;
        face: /fonts/Satoshi.woff2;
        face: /fonts/Satoshi-Italic.woff2 { style: italic; }
      }
    `);
		expect(configs).toHaveLength(1);
		expect(configs[0].kind).toBe("local");
		expect(configs[0].faces).toHaveLength(2);
		expect(configs[0].faces[1].style).toBe("italic");
		expect(configs[0].faces[1].weight).toBe("300 900");
	});

	it("parses manual font stack in nested block", () => {
		const configs = parseNestedFontBlock(`sans: "Inter", ui-sans-serif, sans-serif;`);
		expect(configs).toHaveLength(1);
		expect(configs[0].family).toBe("Inter");
		expect(configs[0].fallback).toEqual(["ui-sans-serif", "sans-serif"]);
	});

	it("parses a slot with @face blocks in a nested block", () => {
		const configs = parseNestedFontBlock(`
      sans: "Satoshi" {
        weight: 300 900;
        @face { src: "/fonts/Satoshi.woff2"; style: normal; }
        @face { src: "/fonts/Satoshi-Italic.woff2"; style: italic; }
      }
    `);
		expect(configs).toHaveLength(1);
		expect(configs[0].kind).toBe("local");
		expect(configs[0].faces).toHaveLength(2);
		expect(configs[0].faces[1].style).toBe("italic");
	});

	it("ignores comments in nested font blocks", () => {
		const configs = parseNestedFontBlock(`
      /* biome-ignore lint/correctness/noUnknownProperty: Rainbow Index custom directive syntax */
      sans: "Onest" from google;
      /* biome-ignore lint/correctness/noUnknownProperty: Rainbow Index custom directive syntax */
      mono: "Victor Mono" from google {
        /* comment before config */
        weight: 300 700;
      }
    `);
		expect(configs).toHaveLength(2);
		expect(configs[0].slot).toBe("sans");
		expect(configs[0].family).toBe("Onest");
		expect(configs[1].slot).toBe("mono");
		expect(configs[1].family).toBe("Victor Mono");
		expect(configs[1].faces[0].weight).toBe("300 700");
	});
});

describe("directive comment stripping", () => {
	it("ignores comments in color bodies", () => {
		const { colors, removals } = parseColorBody(`
      /* palette */
      brand: 0.18 330;
      /* remove old */
      !storm;
    `);
		expect(colors.brand).toEqual({ type: "generative", chroma: 0.18, hue: 330 });
		expect(removals).toEqual(["storm"]);
	});

	it("ignores comments in animate bodies", () => {
		const { animations } = parseAnimateBody(`
      /* motion */
      spin: spin 1s linear infinite {
        /* frame */
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `);
		expect(animations.spin).toBeDefined();
		expect(animations.spin.keyframes).toContain("transform: rotate(0deg)");
	});

	it("ignores comments in custom/source/rounded parsing", () => {
		const variant = parseCustomVariantDirective(
			`
        /* wrap */
        &:hover {
          /* slot marker */
          @slot;
        }
      `,
			"hocus",
		);
		const source = parseSourceDirective("", '/* root */ "./src/**/*.tsx"');
		const rounded = parseRoundedModifier("/* shape */ superellipse(2.5)");
		expect(variant).toEqual({ name: "hocus", selector: "&:hover" });
		expect(source).toEqual({ pattern: "./src/**/*.tsx", negated: false, inline: false });
		expect(rounded).toEqual({ superellipse: 2.5 });
	});

	it("strips comments from utility bodies before validation", () => {
		const warnings: string[] = [];
		const utility = parseUtilityDirective(
			`
        /* comment with @apply should not warn */
        color: red;
      `,
			"card",
			warnings,
		);
		expect(warnings).toEqual([]);
		expect(utility).toEqual({ name: "card", functional: false, body: "color: red;" });
	});
});

// ---------------------------------------------------------------------------
// parseUtilityDirective
// ---------------------------------------------------------------------------

describe("parseUtilityDirective", () => {
	it("parses static utility", () => {
		const util = parseUtilityDirective("background: var(--color-surface);", "card");
		expect(util).not.toBeNull();
		expect(util!.name).toBe("card");
		expect(util!.functional).toBe(false);
	});

	it("parses functional utility", () => {
		const util = parseUtilityDirective("tab-size: var(--value);", "tab-size-*");
		expect(util).not.toBeNull();
		expect(util!.name).toBe("tab-size");
		expect(util!.functional).toBe(true);
	});

	it("returns null without modifier", () => {
		expect(parseUtilityDirective("something", undefined)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// parseCustomVariantDirective
// ---------------------------------------------------------------------------

describe("parseCustomVariantDirective", () => {
	it("parses inline selector form", () => {
		const v = parseCustomVariantDirective("", "hocus (&:hover, &:focus)");
		expect(v).not.toBeNull();
		expect(v!.name).toBe("hocus");
		expect(v!.selector).toBe("&:hover, &:focus");
	});

	it("parses block form", () => {
		const v = parseCustomVariantDirective("&:hover, &:focus { @slot; }", "hocus");
		expect(v).not.toBeNull();
		expect(v!.name).toBe("hocus");
		// @slot is stripped and the selector wrapper is extracted
		expect(v!.selector).toBe("&:hover, &:focus");
	});

	it("returns null without modifier", () => {
		expect(parseCustomVariantDirective("body", undefined)).toBeNull();
	});

	it("rejects invalid custom variant names", () => {
		const warnings: string[] = [];
		const v = parseCustomVariantDirective("&:hover { @slot; }", "Hocus", warnings);
		expect(v).toBeNull();
		expect(warnings.some((w) => w.includes("RI-1017"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// parseSourceDirective
// ---------------------------------------------------------------------------

describe("parseSourceDirective", () => {
	it("parses glob pattern", () => {
		const s = parseSourceDirective("", '"./src/**/*.ts"');
		expect(s).not.toBeNull();
		expect(s!.pattern).toBe("./src/**/*.ts");
		expect(s!.negated).toBe(false);
	});

	it("parses negated pattern", () => {
		const s = parseSourceDirective("", 'not "./node_modules/**/*"');
		expect(s).not.toBeNull();
		expect(s!.pattern).toBe("./node_modules/**/*");
		expect(s!.negated).toBe(true);
	});

	it("parses inline classes", () => {
		const s = parseSourceDirective("", 'inline("underline text-red-500")');
		expect(s).not.toBeNull();
		expect(s!.inline).toBe(true);
		expect(s!.classes).toEqual(["underline", "text-red-500"]);
	});
});

// ---------------------------------------------------------------------------
// parseRoundedModifier
// ---------------------------------------------------------------------------

describe("parseRoundedModifier", () => {
	it("returns null for no modifier", () => {
		expect(parseRoundedModifier()).toBeNull();
	});

	it.each(["round", "scoop", "bevel", "notch", "square", "squircle"])(
		"returns keyword for %s",
		(kw) => {
			expect(parseRoundedModifier(kw)).toBe(kw);
		},
	);

	it("returns superellipse object for superellipse(N)", () => {
		expect(parseRoundedModifier("superellipse(2.0)")).toEqual({ superellipse: 2.0 });
	});

	it("returns null for unrecognized modifier", () => {
		expect(parseRoundedModifier("bogus")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolveDirectives
// ---------------------------------------------------------------------------

describe("resolveDirectives", () => {
	it("returns defaults with no directives", () => {
		const theme = resolveDirectives([]);
		expect(Object.keys(theme.colors)).toHaveLength(Object.keys(DEFAULT_COLORS).length);
		expect(theme.spacing.base).toBe("0.25rem");
		expect(theme.preflight.core).toBe(true);
	});

	it("adds custom colors while keeping defaults", () => {
		const theme = resolveDirectives([{ type: "color", body: "brand: 0.18 330;" }]);
		expect(theme.colors["brand"]).toEqual({
			type: "generative",
			chroma: 0.18,
			hue: 330,
		});
		expect(theme.colors["theme"]).toBeDefined(); // default still present
	});

	it("removes colors with ! prefix", () => {
		const theme = resolveDirectives([{ type: "color", body: "!theme; brand: 0.18 330;" }]);
		expect(theme.colors["theme"]).toBeUndefined();
		expect(theme.colors["brand"]).toBeDefined();
	});

	it("overrides existing color", () => {
		const theme = resolveDirectives([{ type: "color", body: "red: 0.17 25;" }]);
		expect(theme.colors["red"]).toEqual({
			type: "generative",
			chroma: 0.17,
			hue: 25,
		});
	});

	it("merges text overrides", () => {
		const theme = resolveDirectives([{ type: "text", body: "huge: 5rem, 1;" }]);
		expect(theme.text["huge"]).toEqual({ fontSize: "5rem", lineHeight: "1" });
		expect(theme.text["md"]).toBeDefined(); // default kept
	});

	it("updates spacing base", () => {
		const theme = resolveDirectives([{ type: "spacing", body: "base: 0.3rem;" }]);
		expect(theme.spacing.base).toBe("0.3rem");
	});

	it("ignores legacy spacing removals", () => {
		const theme = resolveDirectives([{ type: "spacing", body: "!96;" }]);
		expect(theme.spacing.base).toBe("0.25rem");
	});

	it("adds breakpoints", () => {
		const theme = resolveDirectives([{ type: "breakpoint", body: "tablet: 50rem;" }]);
		expect(theme.breakpoints["tablet"]).toBe("50rem");
		expect(theme.breakpoints["sm"]).toBeDefined(); // default kept
	});

	it("handles radius with squircle shape", () => {
		const theme = resolveDirectives([{ type: "rounded", body: "", modifier: "squircle" }]);
		expect(theme.roundedShape).toBe("squircle");
		expect(theme.roundedShapeScale).toBe(1.6);
	});

	it("warns on a radius token in the body (RI-1122)", () => {
		const theme = resolveDirectives([
			{ type: "rounded", body: "sm: 0.125rem;", modifier: "squircle" },
		]);
		expect(theme.warnings.some((w) => w.includes("RI-1122"))).toBe(true);
	});

	it("handles superellipse with custom exponent", () => {
		const theme = resolveDirectives([{ type: "rounded", body: "", modifier: "superellipse(2.5)" }]);
		expect(theme.roundedShape).toEqual({ superellipse: 2.5 });
		expect(theme.roundedShapeScale).toBe(1.6);
	});

	it("uses per-shape default compensation", () => {
		const bevel = resolveDirectives([{ type: "rounded", body: "", modifier: "bevel" }]);
		expect(bevel.roundedShape).toBe("bevel");
		expect(bevel.roundedShapeScale).toBe(0.8);

		const scoop = resolveDirectives([{ type: "rounded", body: "", modifier: "scoop" }]);
		expect(scoop.roundedShapeScale).toBe(1.2);
	});

	it("overrides compensation via --corner-scale", () => {
		const theme = resolveDirectives([
			{ type: "rounded", body: "--corner-scale: 1.3;", modifier: "bevel" },
		]);
		expect(theme.roundedShape).toBe("bevel");
		expect(theme.roundedShapeScale).toBe(1.3);
	});

	it("warns on invalid --corner-scale", () => {
		const theme = resolveDirectives([
			{ type: "rounded", body: "--corner-scale: -1;", modifier: "squircle" },
		]);
		expect(theme.warnings.some((w) => w.includes("RI-1121"))).toBe(true);
		// falls back to per-shape default
		expect(theme.roundedShapeScale).toBe(1.6);
	});

	it("leaves roundedShape null when no modifier given", () => {
		const theme = resolveDirectives([{ type: "rounded", body: "" }]);
		expect(theme.roundedShape).toBeNull();
		expect(theme.roundedShapeScale).toBe(1);
	});

	it("resolves font directives", () => {
		const theme = resolveDirectives([
			{ type: "font", body: 'sans: "Inter" from google;\nmono: system;' },
		]);
		expect(theme.fonts).toHaveLength(2);
		expect(theme.fonts[0].family).toBe("Inter");
		expect(theme.fonts[0].kind).toBe("google");
		expect(theme.fonts[1].kind).toBe("system");
	});

	it("resolves nested @font block into multiple FontConfigs", () => {
		const theme = resolveDirectives([
			{
				type: "font",
				body: 'sans: "Inter" from google;\nserif: "Merriweather" from google;',
			},
		]);
		expect(theme.fonts).toHaveLength(2);
		expect(theme.fonts[0].slot).toBe("sans");
		expect(theme.fonts[0].family).toBe("Inter");
		expect(theme.fonts[1].slot).toBe("serif");
		expect(theme.fonts[1].family).toBe("Merriweather");
	});

	it("resolves preflight off", () => {
		const theme = resolveDirectives([{ type: "preflight", body: "", modifier: "off" }]);
		expect(theme.preflight.core).toBe(false);
		expect(theme.preflight.forms).toBe(false);
	});

	it("resolves custom utilities", () => {
		const theme = resolveDirectives([
			{ type: "utility", body: "background: red;", modifier: "card" },
		]);
		expect(theme.customUtilities).toHaveLength(1);
		expect(theme.customUtilities[0].name).toBe("card");
	});

	it("resolves custom variants", () => {
		const theme = resolveDirectives([
			{
				type: "custom",
				body: "",
				modifier: "hocus (&:hover, &:focus)",
			},
		]);
		expect(theme.customVariants).toHaveLength(1);
		expect(theme.customVariants[0].name).toBe("hocus");
	});

	it("resolves source directives", () => {
		const theme = resolveDirectives([{ type: "source", body: "", modifier: '"./src/**/*.ts"' }]);
		expect(theme.sources).toHaveLength(1);
		expect(theme.sources[0].pattern).toBe("./src/**/*.ts");
	});

	it("resolves fluid overrides", () => {
		const theme = resolveDirectives([{ type: "fluid", body: "min: 20rem; max: 80rem;" }]);
		expect(theme.fluid.min).toBe("20rem");
		expect(theme.fluid.max).toBe("80rem");
	});

	it("resolves fluid text and spacing modifiers", () => {
		const theme = resolveDirectives([
			{ type: "fluid", body: "min: 24rem; max: 90rem; unit: vw;", modifier: "text" },
			{
				type: "fluid",
				body: "min: 18rem; max: 72rem; unit: vi; multiplier: 1.5;",
				modifier: "spacing",
			},
		]);
		expect(theme.textFluid).toEqual({ min: "24rem", max: "90rem", unit: "vw" });
		expect(theme.spacingFluid).toEqual({
			min: "18rem",
			max: "72rem",
			unit: "vi",
			multiplier: 1.5,
		});
	});

	it("warns for invalid fluid ranges, units, multipliers, and modifiers", () => {
		const theme = resolveDirectives([
			{ type: "fluid", body: "min: 40px; max: 20rem; unit: vh; multiplier: 1;" },
			{ type: "fluid", body: "min: 80rem; max: 20rem;", modifier: "text" },
			{ type: "fluid", body: "multiplier: 1.5;", modifier: "text" },
			{ type: "fluid", body: "min: 20rem; max: 80rem;", modifier: "layout" },
		]);
		const warnings = theme.warnings.join("\n");
		expect(warnings).toContain("[RI-1022]");
		expect(warnings).toContain("[RI-1024]");
		expect(warnings).toContain("[RI-1025]");
		expect(warnings).toContain("[RI-1026]");
		expect(warnings).toContain("[RI-1027]");
	});
});

// ---------------------------------------------------------------------------
// generateThemeOverrides — inline filtering
// ---------------------------------------------------------------------------

describe("generateThemeOverrides", () => {
	it("emits [data-theme] blocks only for colors with inline flag", () => {
		const colors = {
			theme: { type: "generative" as const, chroma: 0, hue: 0 },
			brand: { type: "generative" as const, chroma: 0.18, hue: 330, inline: true },
			error: { type: "generative" as const, chroma: 0.35, hue: 32 },
		};
		const usedThemeSuffixes = new Set([500, 700]);
		const blocks = generateThemeOverrides(colors, usedThemeSuffixes);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toContain('[data-theme="brand"]');
	});

	it("emits nothing when no colors have inline flag", () => {
		const blocks = generateThemeOverrides(DEFAULT_COLORS, new Set([500]));
		expect(blocks).toHaveLength(0);
	});

	it("emits nothing when theme color is not defined", () => {
		const colors = {
			brand: { type: "generative" as const, chroma: 0.18, hue: 330, inline: true },
		};
		const blocks = generateThemeOverrides(colors);
		expect(blocks).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// @layer directive
// ---------------------------------------------------------------------------

describe("@layer directive", () => {
	describe("extractDirectives", () => {
		it("extracts @layer with modifier (simple form)", () => {
			const ds = extractDirectives(`@layer utilities;`);
			expect(ds).toHaveLength(1);
			expect(ds[0].type).toBe("layer");
			expect(ds[0].modifier).toBe("utilities");
			expect(ds[0].body).toBe("");
		});

		it("extracts @layer with body (configured form)", () => {
			const ds = extractDirectives(`@layer {
				order: base, components, utilities;
				utilities: utilities;
				base: base;
			}`);
			expect(ds).toHaveLength(1);
			expect(ds[0].type).toBe("layer");
			expect(ds[0].body).toContain("order: base, components, utilities");
		});

		it("extracts @layer alongside other directives", () => {
			const ds = extractDirectives(`
				@color { brand: 0.18 330; }
				@layer utilities;
			`);
			expect(ds).toHaveLength(2);
			expect(ds[0].type).toBe("color");
			expect(ds[1].type).toBe("layer");
		});
	});

	describe("parseLayerDirective", () => {
		it("parses simple form (@layer <name>;)", () => {
			const warnings: string[] = [];
			const config = parseLayerDirective("", "utilities", warnings);
			expect(config.wrapAll).toBe("utilities");
			expect(config.order).toBeNull();
			expect(config.utilities).toBeNull();
			expect(config.base).toBeNull();
			expect(warnings).toHaveLength(0);
		});

		it("parses configured form with all keys", () => {
			const warnings: string[] = [];
			const config = parseLayerDirective(
				"order: base, components, utilities; utilities: utilities; base: base;",
				undefined,
				warnings,
			);
			expect(config.wrapAll).toBeNull();
			expect(config.order).toEqual(["base", "components", "utilities"]);
			expect(config.utilities).toBe("utilities");
			expect(config.base).toBe("base");
			expect(warnings).toHaveLength(0);
		});

		it("parses configured form with only order", () => {
			const warnings: string[] = [];
			const config = parseLayerDirective("order: reset, base, utilities;", undefined, warnings);
			expect(config.order).toEqual(["reset", "base", "utilities"]);
			expect(config.utilities).toBeNull();
			expect(config.base).toBeNull();
			expect(config.wrapAll).toBeNull();
		});

		it("warns on unknown keys", () => {
			const warnings: string[] = [];
			parseLayerDirective("foo: bar;", undefined, warnings);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("RI-1120");
			expect(warnings[0]).toContain("foo");
		});
	});

	describe("resolveDirectives", () => {
		it("resolves @layer to null by default", () => {
			const ds = extractDirectives(`@color { brand: 0.18 330; }`);
			const theme = resolveDirectives(ds);
			expect(theme.layer).toBeNull();
		});

		it("resolves @layer simple form", () => {
			const ds = extractDirectives(`@layer utilities;`);
			const theme = resolveDirectives(ds);
			expect(theme.layer).not.toBeNull();
			expect(theme.layer!.wrapAll).toBe("utilities");
		});

		it("resolves @layer configured form", () => {
			const ds = extractDirectives(`@layer {
				order: base, utilities;
				utilities: utilities;
				base: base;
			}`);
			const theme = resolveDirectives(ds);
			expect(theme.layer).not.toBeNull();
			expect(theme.layer!.order).toEqual(["base", "utilities"]);
			expect(theme.layer!.utilities).toBe("utilities");
			expect(theme.layer!.base).toBe("base");
		});

		it("last @layer wins when multiple are specified", () => {
			const ds = extractDirectives(`
				@layer base;
				@layer utilities;
			`);
			const theme = resolveDirectives(ds);
			expect(theme.layer!.wrapAll).toBe("utilities");
		});
	});
});
