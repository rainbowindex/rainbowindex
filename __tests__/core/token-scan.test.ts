import { describe, expect, it } from "vitest";
import { analyzeProjectCSS, finalizeProjectCompilation } from "../../src/project/pipeline.js";

describe("token-scan", () => {
	// No type scale ships, so every text-token check defines its own @text size.
	const TEXT = `@text { lg: 1.25rem, 1.4; }`;

	it("emits --text-lg when user CSS references var(--text-lg)", async () => {
		const css = `@source "none";\n${TEXT}\nbody { font-size: var(--text-lg); }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: [], analysis });
		expect(result.css).toContain("--text-lg:");
	});

	it("emits --font-sans when preflight core is enabled", async () => {
		const css = `@source "none";\n@font { sans: "Onest" from google; }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: [], analysis });
		expect(result.css).toContain("--font-sans:");
	});

	it("emits --text-lg when utility class text-lg is used", async () => {
		const css = `@source "none";\n${TEXT}`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["text-lg"], analysis });
		expect(result.css).toContain("--text-lg:");
	});

	it("emits --font-sans and --text-lg with @font + user CSS referencing both", async () => {
		const css = [
			`@source "none";`,
			TEXT,
			`@font { sans: "Onest" from google; mono: "Anonymous Pro" from google; }`,
			`body { font-family: var(--font-sans); font-size: var(--text-lg); line-height: var(--text-lg-leading); }`,
		].join("\n");
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: [], analysis });
		expect(result.css).toContain("--font-sans:");
		expect(result.css).toContain("--text-lg:");
		expect(result.css).toContain("--text-lg-leading:");
	});

	/**
	 * `DEFAULT` is the one uppercase token name the engine emits, and the usage
	 * scanner's reference regexes are lowercase by design. Bare `shadow`
	 * resolves to `var(--shadow-DEFAULT)`, so a scanner that cannot see that
	 * reference prunes the token and leaves a dangling var — and because
	 * `resolveShadow` falls back to `md` when no `DEFAULT` exists, defining one
	 * would make bare `shadow` worse than not defining it.
	 */
	it("inlines a @shadow token's value instead of referencing it", async () => {
		// A shadow utility used to emit `--ri-shadow: var(--shadow-DEFAULT)`,
		// which kept the token alive in `:root`. It now inlines the value with a
		// colour slot, because a slot written into a `:root` token resolves
		// against `:root` and can never see the element's `shadow-{color}`. The
		// token is therefore no longer referenced and prunes away — which is what
		// Tailwind does with its own theme variables for the same reason.
		const css = `@source "none";\n@shadow { DEFAULT: 0 1px 3px oklch(0 0 0 / 0.1); md: 0 4px 6px oklch(0 0 0 / 0.1); }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["shadow"], analysis });
		expect(result.css).toContain(
			"--ri-shadow: 0 1px 3px var(--ri-shadow-color, oklch(0 0 0 / 0.1))",
		);
		expect(result.css).not.toContain("--shadow-DEFAULT:");
		expect(result.css).not.toContain("--shadow-md:");
	});

	it("keeps a @shadow token that the project's own CSS references", async () => {
		// The tokens are still the public API: writing `var(--shadow-md)` by hand
		// keeps it, through the same user-CSS scan that keeps a colour alive.
		const css = `@source "none";\n@shadow { md: 0 4px 6px oklch(0 0 0 / 0.1); lg: 0 8px 12px oklch(0 0 0 / 0.1); }\n.card { box-shadow: var(--shadow-md); }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: [], analysis });
		expect(result.css).toContain("--shadow-md:");
		expect(result.css).not.toContain("--shadow-lg:");
	});

	it("keeps a @shadow token an alias names", async () => {
		// An alias stores the literal `var(--shadow-md)`, which is a whole-layer
		// var() and so is left alone by the colour rewriter — the reference
		// survives and the token with it.
		const css = `@source "none";\n@shadow { md: 0 4px 6px oklch(0 0 0 / 0.1); card: shadow-md; }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["shadow-card"], analysis });
		expect(result.css).toContain("--ri-shadow: var(--shadow-md)");
		expect(result.css).toContain("--shadow-md:");
	});

	/**
	 * Explicit and pair colors used to emit unconditionally, so importing the
	 * Tailwind preset added all 286 of its stops to `:root` — ~14 KB — on a page
	 * that used two colors. Pruning them is a reachability closure rather than a
	 * filter: a surviving entry's own value can name other colors, transitively.
	 */
	it("prunes an explicit color nothing references", async () => {
		const css = `@source "none";\n@color { surface: oklch(0.98 0.01 260); unused: oklch(0.5 0.1 200); }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["bg-surface"], analysis });
		expect(result.css).toContain("--color-surface:");
		expect(result.css).not.toContain("--color-unused:");
	});

	it("prunes a pair color nothing references", async () => {
		const css = `@source "none";\n@color { kept: oklch(0.9 0 0) / oklch(0.2 0 0); gone: oklch(0.9 0 0) / oklch(0.2 0 0); }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["bg-kept"], analysis });
		expect(result.css).toContain("--color-kept:");
		expect(result.css).not.toContain("--color-gone:");
	});

	it("keeps a color referenced only from user CSS, with no stop to go on", async () => {
		// `var(--color-surface)` has no numeric suffix, so `usedColorStops` never
		// saw it. That is the whole reason the name set exists.
		const css = `@source "none";\n@color { surface: oklch(0.98 0.01 260); unused: oklch(0.5 0.1 200); }\nbody { background: var(--color-surface); }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: [], analysis });
		expect(result.css).toContain("--color-surface:");
		expect(result.css).not.toContain("--color-unused:");
	});

	it("follows a value that names another color, transitively", async () => {
		const css = [
			`@source "none";`,
			`@color {`,
			`\tbase: 0.18 330;`,
			`\tmid: color-mix(in oklab, var(--color-base-500) 50%, transparent);`,
			`\ttop: color-mix(in oklab, var(--color-mid) 50%, white);`,
			`\tunused: oklch(0.5 0.1 200);`,
			`}`,
		].join("\n");
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["text-top"], analysis });
		// Only `top` is named by a class; `mid` and `base-500` survive because
		// the chain of values reaches them.
		expect(result.css).toContain("--color-top:");
		expect(result.css).toContain("--color-mid:");
		expect(result.css).toContain("--color-base-500:");
		expect(result.css).not.toContain("--color-unused:");
	});

	it("keeps the source an alias names, and drops both when neither is used", async () => {
		const css = `@source "none";\n@color { surface: oklch(0.98 0.01 260); accent: surface; }`;
		const analysis = analyzeProjectCSS(css);
		const used = await finalizeProjectCompilation({ css, classNames: ["bg-accent"], analysis });
		expect(used.css).toContain("--color-accent: var(--color-surface);");
		expect(used.css).toContain("--color-surface:");

		const unused = await finalizeProjectCompilation({ css, classNames: ["flex"], analysis });
		expect(unused.css).not.toContain("--color-accent");
		expect(unused.css).not.toContain("--color-surface");
	});

	it("keeps a color referenced only through a var() fallback", async () => {
		const css = `@source "none";\n@color { foo: oklch(0.5 0 0); unused: oklch(0.5 0.1 200); }\n.y { color: var(--color-foo, red); }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: [], analysis });
		expect(result.css).toContain("--color-foo:");
		expect(result.css).not.toContain("--color-unused:");
	});

	it("keeps a color a @shadow token's value names", async () => {
		// The colour now arrives through the inlined utility value rather than
		// through the `:root` token, which prunes away — but it must still be
		// found, or the utility would reference a variable that does not exist.
		const css = `@source "none";\n@color { brand: 0.18 330; }\n@shadow { glow: 0 0 8px var(--color-brand-500); }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["shadow-glow"], analysis });
		expect(result.css).toContain("--color-brand-500:");
		expect(result.css).toContain("var(--ri-shadow-color, var(--color-brand-500))");
	});

	it("keeps a color a @keyframes body names", async () => {
		const css = `@source "none";\n@color { surface: oklch(0.98 0.01 260); }\n@animate { blink: blink 1s linear infinite { from { background: var(--color-surface); } to { background: white; } } }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({
			css,
			classNames: ["animate-blink"],
			analysis,
		});
		expect(result.css).toContain("--color-surface:");
	});

	/**
	 * The `[data-theme]` blocks and the `:root` palette stops are two halves of
	 * one mechanism, and they used to be computed from different inputs. A
	 * `theme-<n>` demanded by a value got its declaration but no override block,
	 * so it silently stopped following `data-theme`; feeding the other input
	 * instead emitted a palette stop no block ever read. Both now read the same
	 * effective stops, so the two directions are asserted together.
	 */
	async function themeParity(classNames: string[]): Promise<{ stops: string[]; refs: string[] }> {
		const css = `@source "none";\n@color { theme: 0 0; punchy: 0.18 30 { inline; }; hairline: theme-282/52; }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames, analysis });
		return {
			// Every inline-palette stop that reached :root.
			stops: [...result.css.matchAll(/--color-punchy-(\d+):/g)].map((m) => m[1]).sort(),
			// Every inline-palette stop an override block reads.
			refs: [...result.css.matchAll(/var\(--color-punchy-(\d+)\)/g)].map((m) => m[1]).sort(),
		};
	}

	it("emits a [data-theme] block for a theme stop demanded by a value", async () => {
		// `hairline: theme-282/52` is the only thing asking for stop 282.
		const { stops, refs } = await themeParity(["bg-hairline"]);
		expect(stops).toEqual(["282"]);
		expect(refs).toEqual(["282"]);
	});

	it("keeps palette stops and override blocks in step for both kinds of demand", async () => {
		const { stops, refs } = await themeParity(["bg-hairline", "bg-theme-500"]);
		expect(stops).toEqual(["282", "500"]);
		expect(refs).toEqual(stops);
	});

	it("emits neither when nothing asks for a theme stop", async () => {
		const { stops, refs } = await themeParity(["flex"]);
		expect(stops).toEqual([]);
		expect(refs).toEqual([]);
	});

	it("keeps a color a bare-name /alpha value references", async () => {
		// The one reference shape the closure could not see: `soft: surface/50`
		// used to emit the literal `surface`, which is not a var() and so kept
		// nothing alive. Now that it expands, the closure follows it.
		const css = `@source "none";\n@color { surface: oklch(0.98 0.01 250); soft: surface/50; }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["bg-soft"], analysis });
		expect(result.css).toContain(
			"--color-soft: color-mix(in oklab, var(--color-surface) 50%, transparent);",
		);
		expect(result.css).toContain("--color-surface:");
	});

	it("keeps a color an @register initial value names", async () => {
		const css = `@source "none";\n@color { surface: oklch(0.98 0.01 250); }\n@register --tone { syntax: "*"; inherits: false; initial-value: var(--color-surface); }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["flex"], analysis });
		expect(result.css).toContain("initial-value: var(--color-surface)");
		expect(result.css).toContain("--color-surface:");
	});

	it("emits the whole chain when an alias is reached through an explicit value", async () => {
		// Ordering bug the fixpoint replaced: the alias pass used to finish before
		// the explicit values were read, so `card` demanded `--color-accent-500`
		// and `accent` never learned it needed `brand-500`.
		const css = `@source "none";\n@color { brand: 0.18 330; accent: brand; card: accent-500; }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["bg-card"], analysis });
		expect(result.css).toContain("--color-card: var(--color-accent-500);");
		expect(result.css).toContain("--color-accent-500: var(--color-brand-500);");
		expect(result.css).toMatch(/--color-brand-500:\s*[^;]+;/);
	});

	it("prunes every @shadow token no one references", async () => {
		const css = `@source "none";\n@shadow { DEFAULT: 0 1px 3px oklch(0 0 0 / 0.1); md: 0 4px 6px oklch(0 0 0 / 0.1); }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["shadow-md"], analysis });
		expect(result.css).toContain(".shadow-md");
		expect(result.css).not.toContain("--shadow-md:");
		expect(result.css).not.toContain("--shadow-DEFAULT:");
	});
});
