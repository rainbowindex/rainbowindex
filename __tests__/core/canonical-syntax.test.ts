/**
 * The canonical directive spellings, as accepted syntax.
 *
 * The claim these tests defend is not "the new form parses" but "the new form
 * and the old one produce the *same stylesheet*". A migration where the two
 * spellings differ by a byte is a migration nobody can run, so the central
 * assertion is an equality between two compiles rather than a check on either
 * one.
 *
 * The second claim is that the old forms still work and say so exactly once —
 * a deprecation that silently changes behaviour is worse than no deprecation,
 * and one that warns on the *new* form is worse still.
 *
 * All four forms are covered: A (a block after a declaration), B (removal),
 * C (a bare keyword) and D (a variant group inside `@apply`).
 */

import postcss from "postcss";
import { describe, expect, test } from "vitest";
import { usesLegacyDirectiveSyntax } from "../../src/directives/postcss-safe.js";
import rainbowindex from "../../src/integrations/postcss/index.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";
import { compileProject } from "../../src/project/index.js";
import { expandApplyBodyGroups } from "../../src/scanner/class-extraction.js";
// Not re-exported through the barrel: nothing outside variant-groups.ts calls it.
import { normalizeApplyParenGroups } from "../../src/scanner/variant-groups.js";

/** Compile two stylesheets and return their output plus their warnings. */
async function compile(css: string, classNames: string[]) {
	return compileProject({ css, classNames, resolveImport: null, resolveFonts: (f) => f });
}

/** Warnings carrying the deprecation code. */
const deprecations = (warnings: readonly string[]): string[] =>
	warnings.filter((w) => w.includes("[RI-1046]"));

// ---------------------------------------------------------------------------
// Form A — a block after a declaration
// ---------------------------------------------------------------------------

describe("@animate: a nested rule replaces a block after a declaration", () => {
	const LEGACY = `@animate {
	spin: spin 1s linear infinite {
		to { transform: rotate(360deg); }
	}
}`;
	const CANONICAL = `@animate {
	spin {
		animation: spin 1s linear infinite;
		@keyframes spin {
			to { transform: rotate(360deg); }
		}
	}
}`;

	test("the two spellings compile to the same stylesheet", async () => {
		expect((await compile(CANONICAL, ["animate-spin"])).css).toBe(
			(await compile(LEGACY, ["animate-spin"])).css,
		);
	});

	test("the emitted keyframes do not carry the source's indentation", async () => {
		// The canonical form nests one level deeper than the legacy one. Without
		// normalisation the two spellings of the same animation would emit
		// different bytes, which is the difference between a migration and a
		// diff nobody can review.
		const css = (await compile(CANONICAL, ["animate-spin"])).css;
		expect(css).toContain("@keyframes spin {\n  to { transform: rotate(360deg); }\n}");
	});

	test("the legacy spelling warns, the canonical one does not", () => {
		expect(deprecations(analyzeProjectCSS(LEGACY).warnings)).toHaveLength(1);
		expect(deprecations(analyzeProjectCSS(CANONICAL).warnings)).toEqual([]);
	});

	test("a utility block in @animate is still a utility block", () => {
		// The collision this form had to be designed around: `name { … }` inside
		// a named scale is already a custom utility. The keyframes are what tell
		// the two apart.
		const analysis = analyzeProjectCSS("@animate {\n\tpulse-slow { opacity: 0.5; }\n}");
		expect(analysis.theme.customUtilities.map((u) => u.name)).toEqual(["animate-pulse-slow"]);
		expect(analysis.theme.animations).toEqual({});
		expect(analysis.warnings).toEqual([]);
	});

	test("the near miss between the two is reported, not guessed", () => {
		// An `animation:` with no keyframes reads as a perfectly good utility,
		// validates clean, and animates nothing — which is exactly why it warns.
		const analysis = analyzeProjectCSS(
			"@animate {\n\tshimmer { animation: shimmer 2s linear infinite; }\n}",
		);
		const warned = analysis.warnings.filter((w) => w.includes("[RI-1047]"));
		expect(warned).toHaveLength(1);
		expect(warned[0]).toContain("never defined");
	});

	test("keyframes named after something else are rejected", () => {
		const analysis = analyzeProjectCSS(
			"@animate {\n\tshimmer {\n\t\tanimation: shimmer 2s linear;\n\t\t@keyframes shimmy { to { opacity: 1; } }\n\t}\n}",
		);
		expect(analysis.warnings.some((w) => w.includes("[RI-1048]"))).toBe(true);
		expect(analysis.theme.animations).toEqual({});
	});

	test("a shorthand that never names its own entry is reported", () => {
		// `animation: 2s linear infinite` sets no animation-name, so the class
		// resolves, the CSS is valid, and nothing moves.
		const analysis = analyzeProjectCSS(
			"@animate {\n\tshimmer {\n\t\tanimation: 2s linear infinite;\n\t\t@keyframes shimmer { to { opacity: 1; } }\n\t}\n}",
		);
		expect(analysis.warnings.some((w) => w.includes("[RI-1049]"))).toBe(true);
	});
});

describe("@color: a nested rule replaces a block after a declaration", () => {
	const CLASSES = ["bg-punchy-500"];
	const LEGACY = "@color { punchy: 0.18 330 { dark: shift chroma +0.02 hue +10; } }";
	const CANONICAL = "@color { punchy { ramp: 0.18 330; dark: shift chroma +0.02 hue +10; } }";

	test("the two spellings compile to the same stylesheet", async () => {
		expect((await compile(CANONICAL, CLASSES)).css).toBe((await compile(LEGACY, CLASSES)).css);
	});

	test("`value:` is the spelling for a colour that is not a ramp", () => {
		const theme = analyzeProjectCSS(
			"@color {\n\tsurface { value: oklch(0.98 0.01 250); }\n\tpaperish { value: oklch(0.98 0 0) / oklch(0.15 0 0); }\n}",
		).theme;
		expect(theme.colors.surface).toEqual({ type: "explicit", value: "oklch(0.98 0.01 250)" });
		expect(theme.colors.paperish).toMatchObject({ type: "pair" });
	});

	test("a block with neither is reported", () => {
		const analysis = analyzeProjectCSS("@color { broken { inline: true; } }");
		expect(analysis.warnings.some((w) => w.includes("[RI-1126]"))).toBe(true);
		expect(analysis.theme.colors.broken).toBeUndefined();
	});

	test("the legacy spelling warns, the canonical one does not", () => {
		expect(deprecations(analyzeProjectCSS(LEGACY).warnings)).toHaveLength(1);
		expect(deprecations(analyzeProjectCSS(CANONICAL).warnings)).toEqual([]);
	});
});

describe("@font: a nested rule replaces a block after a declaration", () => {
	const LEGACY = '@font {\n\tsans: "Inter", ui-sans-serif from google { weight: 400 700; }\n}';
	const CANONICAL =
		'@font {\n\tsans {\n\t\tfamily: "Inter", ui-sans-serif;\n\t\tfrom: google;\n\t\tweight: 400 700;\n\t}\n}';

	test("the two spellings build the same font slot", () => {
		expect(analyzeProjectCSS(CANONICAL).theme.fonts).toEqual(analyzeProjectCSS(LEGACY).theme.fonts);
	});

	test("a face block matches the legacy face declaration", () => {
		const legacy =
			'@font {\n\tdisplay: "Satoshi" {\n\t\tweight: 300 900;\n\t\tface: /fonts/S.woff2;\n\t\tface: /fonts/S-Italic.woff2 { style: italic; }\n\t}\n}';
		const canonical =
			'@font {\n\tdisplay {\n\t\tfamily: "Satoshi";\n\t\tweight: 300 900;\n\t\tface { src: url("/fonts/S.woff2"); }\n\t\tface { src: url("/fonts/S-Italic.woff2"); style: italic; }\n\t}\n}';
		expect(analyzeProjectCSS(canonical).theme.fonts).toEqual(analyzeProjectCSS(legacy).theme.fonts);
	});

	test("a slot with no family is reported", () => {
		const analysis = analyzeProjectCSS("@font {\n\tbroken { weight: 400; }\n}");
		expect(analysis.warnings.some((w) => w.includes("[RI-1221]"))).toBe(true);
		expect(analysis.theme.fonts).toEqual([]);
	});

	test("a slot with no block needs no change", () => {
		const analysis = analyzeProjectCSS("@font {\n\tmono: ui-monospace, monospace;\n}");
		expect(deprecations(analysis.warnings)).toEqual([]);
		expect(analysis.theme.fonts[0]).toMatchObject({ slot: "mono", kind: "manual" });
	});

	test("the legacy spelling warns, the canonical one does not", () => {
		expect(deprecations(analyzeProjectCSS(LEGACY).warnings)).toHaveLength(1);
		expect(deprecations(analyzeProjectCSS(CANONICAL).warnings)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Form B — removal
// ---------------------------------------------------------------------------

describe("removal: `name: initial` replaces `!name`", () => {
	const CLASSES = ["bg-brand-500", "bg-ocean-500", "rounded-card", "rounded-lg"];

	test("the two spellings compile to the same stylesheet", async () => {
		// Removing in a later block is the real use — taking a token back out of
		// a preset, or out of an earlier `@color`. A removal beside the
		// definition it removes has never done anything, in either spelling.
		const defined = "@color { brand: 0.18 330; ocean: 0.12 220; }\n@rounded { card: 0.75rem; }\n";
		const legacy = await compile(`${defined}@color { !brand; }\n@rounded { !card; }`, CLASSES);
		const canonical = await compile(
			`${defined}@color { brand: initial; }\n@rounded { card: initial; }`,
			CLASSES,
		);
		expect(canonical.css).toBe(legacy.css);
		// And the removal actually happened.
		expect(canonical.css).not.toContain("--color-brand-500");
		expect(canonical.css).not.toContain("--rounded-card");
		expect(canonical.css).toContain("--color-ocean-500");
	});

	test("the legacy spelling warns, the canonical one does not", () => {
		const legacy = analyzeProjectCSS("@color { brand: 0.18 330; !brand; }");
		expect(deprecations(legacy.warnings)).toHaveLength(1);
		expect(deprecations(legacy.warnings)[0]).toContain("brand: initial;");

		const canonical = analyzeProjectCSS("@color { brand: 0.18 330; brand: initial; }");
		expect(deprecations(canonical.warnings)).toEqual([]);
	});

	test("works in every key-value scale, not only @color", () => {
		for (const [directive, key] of [
			["shadow", "card"],
			["blur", "soft"],
			["leading", "airy"],
			["z", "modal"],
			["text", "huge"],
		] as const) {
			const analysis = analyzeProjectCSS(`@${directive} { ${key}: initial; }`);
			expect(deprecations(analysis.warnings), directive).toEqual([]);
		}
	});

	test("removing a token that was never defined still warns as it always did", () => {
		// RI-1103, the pre-existing "removed something that is not there"
		// warning — the new spelling must not route around it.
		const canonical = analyzeProjectCSS("@color { nothing: initial; }");
		expect(canonical.warnings.some((w) => w.includes("RI-1103"))).toBe(true);
	});

	test("a value of `initial` no longer defines a token", () => {
		// The repurposing the RFC accepts, stated as a test: a custom property
		// set to `initial` was always invalid at computed-value time, so nothing
		// that worked stops working.
		const analysis = analyzeProjectCSS("@shadow { card: initial; }");
		expect(analysis.theme.shadows.card).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Form C — a bare keyword
// ---------------------------------------------------------------------------

describe("options: `inline: true` replaces `inline`", () => {
	const CLASSES = ["bg-punchy-500", "text-punchy-700"];
	const LEGACY = "@color { punchy: 0.18 330 { inline; no-parabolic; } }";
	// Form C and form A at once: the flags become declarations, and the block
	// after the declaration becomes the entry itself.
	const CANONICAL = "@color { punchy { ramp: 0.18 330; inline: true; parabolic: false; } }";

	test("the two spellings compile to the same stylesheet", async () => {
		expect((await compile(CANONICAL, CLASSES)).css).toBe((await compile(LEGACY, CLASSES)).css);
	});

	test("the flags actually took effect, in both spellings", () => {
		for (const css of [LEGACY, CANONICAL]) {
			const definition = analyzeProjectCSS(css).theme.colors.punchy;
			expect(definition, css).toMatchObject({ inline: true, parabolic: false });
		}
	});

	test("`parabolic: true` is read as well as `parabolic: false`", () => {
		const definition = analyzeProjectCSS("@color { punchy { ramp: 0.18 330; parabolic: true; } }")
			.theme.colors.punchy;
		expect(definition).toMatchObject({ parabolic: true });
	});

	test("the legacy spelling warns for each form it uses, the canonical one not at all", () => {
		// Two bare flags and one block-after-declaration.
		expect(deprecations(analyzeProjectCSS(LEGACY).warnings)).toHaveLength(3);
		expect(deprecations(analyzeProjectCSS(CANONICAL).warnings)).toEqual([]);
	});

	test("a `dark: shift …` override is not mistaken for a bare flag", () => {
		// `shift` inside the dark value looks like a keyword; the statement-wise
		// parse is what keeps it from being read as one.
		const analysis = analyzeProjectCSS(
			"@color { punchy { ramp: 0.18 330; inline: true; dark: shift chroma +0.02 hue +10; } }",
		);
		expect(deprecations(analysis.warnings)).toEqual([]);
		expect(analysis.theme.colors.punchy).toMatchObject({ inline: true });
	});

	test("a dead @fluid keyword says it is dead", () => {
		const analysis = analyzeProjectCSS("@fluid { min: 20rem; max: 80rem; parabolic; }");
		const warned = deprecations(analysis.warnings);
		expect(warned).toHaveLength(1);
		expect(warned[0]).toContain("never had an effect");
		// And the real options still parsed.
		expect(analysis.theme.fluid).toMatchObject({ min: "20rem", max: "80rem" });
	});
});

// ---------------------------------------------------------------------------
// Form D — a variant group inside @apply
// ---------------------------------------------------------------------------

describe("@apply: `variant:( … )` replaces `variant:{ … }`", () => {
	test("normalization preserves every offset", () => {
		const input = "px-2 hover:(bg-red-500 underline) sm:(p-4 gap-2)";
		const output = normalizeApplyParenGroups(input);
		expect(output).toBe("px-2 hover:{bg-red-500 underline} sm:{p-4 gap-2}");
		// The map the expander builds is offset-based, so a rewrite that moved
		// anything would misplace every candidate downstream.
		expect(output.length).toBe(input.length);
	});

	test("expands to the same classes as the brace form", () => {
		expect(expandApplyBodyGroups("hover:(px-2 py-1)")).toBe(
			expandApplyBodyGroups("hover:{px-2 py-1}"),
		);
		expect(expandApplyBodyGroups("px-2 sm:(hover:(underline) p-4)")).toBe(
			expandApplyBodyGroups("px-2 sm:{hover:{underline} p-4}"),
		);
	});

	test("leaves a parenthesised variant value alone", () => {
		// `supports-(display:grid)` has no colon before its paren, which is what
		// keeps it from reading as a group.
		for (const input of [
			"supports-(display:grid):flex",
			"p-[calc(1rem+2px)]",
			"not-supports-(display:grid):block",
		]) {
			expect(normalizeApplyParenGroups(input), input).toBe(input);
		}
	});

	test("leaves an unclosed group alone rather than guessing", () => {
		expect(normalizeApplyParenGroups("hover:(px-2 py-1")).toBe("hover:(px-2 py-1");
	});

	test("a bracketed variant is left alone, exactly as the brace form leaves it", () => {
		// The segment scan that finds a group prefix accepts `[\w@-]`, so a
		// bracketed variant has never opened a group. Parity with the brace form
		// is the bar: neither expands, and the limitation is one thing rather
		// than two.
		expect(normalizeApplyParenGroups("[&:hover]:(px-2 py-1)")).toBe("[&:hover]:(px-2 py-1)");
		expect(expandApplyBodyGroups("[&:hover]:{px-2 py-1}")).toBe("[&:hover]:{px-2 py-1}");
	});

	test("an unbalanced paren inside a bracket cannot end the group", () => {
		// The brace expander skips `[ … ]` wholesale for the same reason, and the
		// two forms have to agree about where a group ends or the same source
		// expands differently depending on which one it is written in.
		expect(normalizeApplyParenGroups("hover:(p-[--x:(] gap-2)")).toBe("hover:{p-[--x:(] gap-2}");
	});

	test("a bracket inside a group cannot end it early", () => {
		expect(normalizeApplyParenGroups("hover:(p-[calc(1rem)] gap-2)")).toBe(
			"hover:{p-[calc(1rem)] gap-2}",
		);
	});

	test("the brace form warns, the parenthesised one does not", () => {
		const legacy: string[] = [];
		expandApplyBodyGroups("hover:{px-2 py-1}", legacy);
		expect(deprecations(legacy)).toHaveLength(1);

		const canonical: string[] = [];
		expandApplyBodyGroups("hover:(px-2 py-1)", canonical);
		expect(deprecations(canonical)).toEqual([]);
	});

	test("expands under plain PostCSS, where the brace form is a parse error", async () => {
		// The headline of this form. A brace opens a block, so PostCSS never
		// parses the file at all — which is why the Vite plugin rewrites groups
		// before the parse, and why a project on plain PostCSS could not use
		// them. Parentheses are an ordinary component value and need no pre-pass.
		const run = (css: string) =>
			postcss([rainbowindex({ cwd: process.cwd() })]).process(css, { from: undefined });

		const theme = '@import "rainbowindex";\n@color { brand: 0.18 330; }\n';
		const out = await run(`${theme}.btn { @apply px-2 hover:(bg-brand-600 underline); }`);
		expect(out.css).toContain(".btn:hover");
		expect(out.css).toContain("var(--color-brand-600)");
		expect(out.css).toContain("text-decoration-line: underline");

		await expect(
			run(`${theme}.btn { @apply px-2 hover:{bg-brand-600 underline}; }`),
		).rejects.toThrow(/Unknown word/);
	});

	test("its class names reach the compiler with no pre-pass", async () => {
		// `APPLY_LIKE_MATCH_RE` stops a parameter list at `{`, so a brace group's
		// members were invisible to `compileProject` — no rule, no token — unless
		// something had already expanded them.
		const canonical = await compile(
			"@color { brand: 0.18 330; }\n.btn { @apply px-2 hover:(bg-brand-600 underline); }",
			[],
		);
		const flat = await compile(
			"@color { brand: 0.18 330; }\n.btn { @apply px-2 hover:bg-brand-600 hover:underline; }",
			[],
		);
		expect(canonical.classNames.sort()).toEqual(flat.classNames.sort());
		expect(canonical.classNames).toContain("hover:bg-brand-600");

		const legacy = await compile(
			"@color { brand: 0.18 330; }\n.btn { @apply px-2 hover:{bg-brand-600 underline}; }",
			[],
		);
		expect(legacy.classNames).not.toContain("hover:bg-brand-600");
	});
});

// ---------------------------------------------------------------------------
// The whole file, both ways
// ---------------------------------------------------------------------------

describe("a stylesheet in either dialect", () => {
	const CLASSES = ["bg-punchy-500", "rounded-card", "bg-keep-500"];

	const LEGACY = `@color {
	punchy: 0.18 330 { inline; parabolic; }
	keep: 0.12 220;
	drop: 0.2 40;
	!drop;
}
@rounded { card: 0.75rem; !lg; }
@fluid { min: 20rem; max: 80rem; }
.btn { @apply rounded-card hover:bg-punchy-600 hover:underline; }
`;

	const CANONICAL = `@color {
	punchy { ramp: 0.18 330; inline: true; parabolic: true; }
	keep: 0.12 220;
	drop: 0.2 40;
	drop: initial;
}
@rounded { card: 0.75rem; lg: initial; }
@fluid { min: 20rem; max: 80rem; }
.btn { @apply rounded-card hover:(bg-punchy-600 underline); }
`;

	test("produces byte-identical generated CSS", async () => {
		// The *generated* sections, not `css`: the user's own rules pass through
		// verbatim, so the `@apply` line differs by construction and comparing
		// it would only assert that the two files are two files.
		const canonical = (await compile(CANONICAL, CLASSES)).sections.join("\n\n");
		const legacy = (await compile(LEGACY, CLASSES)).sections.join("\n\n");
		expect(canonical).toBe(legacy);
	});

	test("the canonical dialect emits no deprecation at all", async () => {
		expect(deprecations((await compile(CANONICAL, CLASSES)).warnings)).toEqual([]);
	});

	test("the legacy dialect names every form it used", async () => {
		const warned = deprecations((await compile(LEGACY, CLASSES)).warnings).join("\n");
		expect(warned).toContain("!drop;");
		expect(warned).toContain("!lg;");
		expect(warned).toContain("inline;");
		expect(warned).toContain("parabolic;");
	});

	test("the @apply group warns through the expander the plugins use", () => {
		// The brace form never reaches `compileProject` (see above), so its
		// deprecation is reported where the plugins expand it.
		const warnings: string[] = [];
		expandApplyBodyGroups("rounded-card hover:{bg-punchy-600 underline}", warnings);
		expect(deprecations(warnings)).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// The point of the whole RFC
// ---------------------------------------------------------------------------

/**
 * `usesLegacyDirectiveSyntax` is what lets the Vite plugin stop hiding a
 * stylesheet from the formatter. A false negative un-hides a file Oxfmt then
 * chokes on, so the interesting direction is "does it catch every legacy
 * form", and each of the four is checked on its own.
 */
describe("telling a canonical stylesheet from a legacy one", () => {
	const ACTIVATION = '@import "rainbowindex";\n';

	test("every legacy form is caught", () => {
		for (const [form, css] of [
			["A — @font", '@font { sans: "Inter" from google { weight: 400 700; } }'],
			["A — @animate", "@animate { spin: spin 1s linear { to { opacity: 1; } } }"],
			["A — @color", "@color { punchy: 0.18 330 { dark: fixed; } }"],
			["B — removal", "@color { brand: 0.18 330; !brand; }"],
			["C — @fluid keyword", "@fluid { min: 20rem; max: 80rem; parabolic; }"],
			["C — @color flag", "@color { punchy { ramp: 0.18 330; inline; } }"],
			["D — @apply group", ".btn { @apply hover:{px-2 py-1}; }"],
		] as const) {
			expect(usesLegacyDirectiveSyntax(ACTIVATION + css), form).toBe(true);
		}
	});

	test("a stylesheet written the canonical way is not hidden from anything", () => {
		const canonical = `${ACTIVATION}@color {
	brand: 0.18 330;
	punchy { ramp: 0.2 40; inline: true; parabolic: false; dark: fixed; }
	scrap: 0.1 90;
}
@color { scrap: initial; }
@font {
	sans { family: "Inter", ui-sans-serif; from: google; weight: 400 700; }
	display { family: "Satoshi"; face { src: url("/f.woff2"); style: italic; } }
}
@animate {
	spin { animation: spin 1s linear infinite; @keyframes spin { to { opacity: 1; } } }
	pulse-slow { opacity: 0.5; }
}
@fluid { min: 20rem; max: 80rem; }
@rounded { card: 0.75rem; scrap: 1rem; }
@rounded { scrap: initial; }
.btn { @apply rounded-card hover:(bg-brand-600 underline); }
`;
		expect(usesLegacyDirectiveSyntax(canonical)).toBe(false);
		// And it compiles clean — no deprecation, no diagnostic of any kind.
		expect(analyzeProjectCSS(canonical).warnings).toEqual([]);
	});

	test("a `!important` inside a keyframes body is not a removal", () => {
		// The removal pattern and CSS's own `!` collide, and only the top-level
		// reading is a removal.
		const css = `${ACTIVATION}@animate {
	spin { animation: spin 1s linear; @keyframes spin { to { opacity: 1 !important; } } }
}`;
		expect(usesLegacyDirectiveSyntax(css)).toBe(false);
	});

	test("plain CSS is never legacy", () => {
		expect(usesLegacyDirectiveSyntax(".a { color: red !important; }")).toBe(false);
	});

	test("answers the same way twice", () => {
		// The rewrite patterns are global regexes, whose `lastIndex` carries
		// between calls — a bare `.test()` reads the second file from the middle.
		const css = `${ACTIVATION}@color { brand: 0.18 330; !brand; }`;
		expect(usesLegacyDirectiveSyntax(css)).toBe(true);
		expect(usesLegacyDirectiveSyntax(css)).toBe(true);
	});
});
