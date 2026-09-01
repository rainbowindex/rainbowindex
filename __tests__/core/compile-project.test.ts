import { describe, expect, it } from "vitest";
import { compileProject } from "../../src/project/index.js";

describe("compileProject", () => {
	it("compiles CSS from provided source entries without filesystem access", async () => {
		const result = await compileProject({
			css: "",
			sources: [{ content: '<div class="text-white p-4"></div>' }],
		});

		expect(result.css).toContain(".text-white");
		expect(result.classNames).toContain("p-4");
	});

	it("parses a brace-expansion @source glob and strips it from the output", async () => {
		const result = await compileProject({
			css: '@import "rainbowindex";\n@source "src/**/*.{ts,tsx}";',
			classNames: ["p-4"],
		});
		expect(result.theme.sources).toEqual([
			{ pattern: "src/**/*.{ts,tsx}", negated: false, inline: false },
		]);
		expect(result.css).toContain(".p-4");
		expect(result.css).not.toContain("@source");
		expect(result.warnings.some((w) => w.includes("[RI-1012]"))).toBe(false);
	});

	it("force-emits stops referenced by explicit @color values", async () => {
		// `background: theme-22;` is stored as an explicit color whose value is
		// `var(--color-theme-22)`. The explicit declaration is emitted
		// unconditionally, so the underlying generative stop must be force-emitted
		// too — otherwise --color-background resolves to a dangling reference.
		const result = await compileProject({
			css: "@color { background: theme-22; }\n.foo { @apply bg-background; }",
			sources: [{ content: '<div class="bg-background"></div>' }],
		});
		expect(result.css).toContain("--color-background: var(--color-theme-22)");
		expect(result.css).toMatch(/--color-theme-22:\s*[^;]+;/);
	});

	it("force-emits stops referenced by pair @color values", async () => {
		const result = await compileProject({
			css: "@color { brand: 0.18 330; surface: brand-100 / brand-900; }\n.foo { @apply bg-surface; }",
			sources: [{ content: '<div class="bg-surface"></div>' }],
		});
		expect(result.css).toMatch(/--color-brand-100:\s*[^;]+;/);
		expect(result.css).toMatch(/--color-brand-900:\s*[^;]+;/);
	});

	it("force-emits inline palette stops referenced by [data-theme] overrides", async () => {
		// Inline generative colors get [data-theme] override blocks aliasing
		// --color-theme-<n> to var(--color-<name>-<n>). Those stops must reach
		// the :root token layer even when only theme-<n> utilities are used —
		// otherwise switching data-theme yields dangling var() references.
		const result = await compileProject({
			css: "@color { ocean: 0.16 222 { inline; } }",
			sources: [{ content: '<div class="bg-theme-500"></div>' }],
		});
		expect(result.css).toContain('[data-theme="ocean"]');
		expect(result.css).toContain("--color-theme-500: var(--color-ocean-500)");
		expect(result.css).toMatch(/--color-ocean-500:\s*[^;]+;/);
	});
});

describe("compileProject — corner-shape block follows the @rounded directive, not radius usage", () => {
	// The block (which sets `corner-shape` and defines --ri-rounded-scale) follows
	// the directive alone. A radius reaches the output through several paths —
	// compiled classes, @apply-inlined declarations, hand-authored CSS — so any
	// usage-based gate would silently drop the shape for the paths it cannot see.
	it.each([
		["numeric radius", "rounded-4"],
		["arbitrary radius", "rounded-[2rem]"],
		["no radius at all", "p-4"],
	])("emits the corner-shape block with %s", async (_label, className) => {
		const result = await compileProject({ css: "@rounded squircle;", classNames: [className] });
		expect(result.css).toContain("corner-shape: squircle");
		expect(result.css).toContain("--ri-rounded-scale: 1.6");
	});

	it("emits no corner-shape block when no @rounded shape is configured", async () => {
		const result = await compileProject({ css: "", classNames: ["rounded-4"] });
		expect(result.css).not.toContain("corner-shape: squircle");
		expect(result.css).not.toContain("--ri-rounded-scale: 1.6");
	});
});

describe("@rounded named radii", () => {
	const build = (css: string, markup: string) =>
		compileProject({ css, sources: [{ content: `<div class="${markup}"></div>` }] });

	it("emits the class and its token", async () => {
		const result = await build("@rounded { roof: 24px; }", "rounded-roof");
		expect(result.css).toContain("--rounded-roof: 24px;");
		expect(result.css).toMatch(/\.rounded-roof\s*\{\s*border-radius:\s*24px;/);
	});

	it("feeds a functional block declared beside it", async () => {
		const css =
			"@rounded { roof: 24px; roof-minus-* { border-radius: calc(var(--rounded-roof) - var(--value) * var(--spacing)); } }";
		const result = await build(css, "rounded-roof-minus-2");
		expect(result.css).toContain("--rounded-roof: 24px;");
		expect(result.css).toContain("calc(var(--rounded-roof) - 2 * var(--spacing))");
	});

	it("works through a corner suffix", async () => {
		const result = await build("@rounded { roof: 24px; }", "rounded-tl-roof");
		expect(result.css).toContain("border-start-start-radius: 24px");
	});

	it("leaves the numeric scale alone", async () => {
		const result = await build("@rounded { roof: 24px; }", "rounded-4");
		expect(result.css).toContain("calc(var(--spacing) * 4 * var(--ri-rounded-scale, 1))");
	});
});

describe("a named entry replaces the built-in it shadows", () => {
	const build = (css: string, markup: string) =>
		compileProject({ css, sources: [{ content: `<div class="${markup}"></div>` }] });

	it("rounded-full", async () => {
		const result = await build("@rounded { full: 30px; }", "rounded-full");
		expect(result.css).toMatch(/\.rounded-full\s*\{\s*border-radius:\s*30px;/);
		expect(result.css).not.toContain("calc(infinity * 1px)");
	});

	it("shadow-none", async () => {
		const result = await build("@shadow { none: 0 0 9px lime; }", "shadow-none");
		expect(result.css).toContain("--shadow-none: 0 0 9px lime;");
		expect(result.css).toContain("--ri-shadow: var(--shadow-none)");
	});

	it("blur-none", async () => {
		const result = await build("@blur { none: 7px; }", "blur-none");
		expect(result.css).toContain("--ri-blur: blur(7px)");
	});

	it("duration-initial", async () => {
		const result = await build("@duration { initial: 5s; }", "duration-initial");
		expect(result.css).toContain("transition-duration: 5s");
	});
});

describe("utility blocks in named-scale directives", () => {
	const build = (css: string, markup: string) =>
		compileProject({ css, sources: [{ content: `<div class="${markup}"></div>` }] });

	// A colon-less `name { … }` block defines a utility in that scale's own class
	// family, so the math sits beside the tokens it reads.
	it.each([
		[
			"@rounded",
			"@rounded { roof: 24px; roof-minus-* { border-radius: calc(var(--rounded-roof) - var(--value) * var(--spacing)); } }",
			"rounded-roof-minus-2",
			"calc(var(--rounded-roof) - 2 * var(--spacing))",
		],
		[
			"@shadow",
			"@shadow { lifted-* { box-shadow: 0 calc(var(--value) * 2px) 8px #0003; } }",
			"shadow-lifted-3",
			"0 calc(3 * 2px) 8px #0003",
		],
		[
			"@blur",
			"@blur { half-* { filter: blur(calc(var(--value) * 1px)); } }",
			"blur-half-4",
			"blur(calc(4 * 1px))",
		],
		["@z", "@z { over-* { z-index: calc(900 + var(--value)); } }", "z-over-5", "calc(900 + 5)"],
		[
			"@leading",
			"@leading { snug-* { line-height: calc(1 + var(--value) * 0.1); } }",
			"leading-snug-3",
			"calc(1 + 3 * 0.1)",
		],
		[
			"@tracking",
			"@tracking { wider-* { letter-spacing: calc(var(--value) * 0.01em); } }",
			"tracking-wider-4",
			"calc(4 * 0.01em)",
		],
		[
			"@opacity",
			"@opacity { step-* { opacity: calc(var(--value) * 0.1); } }",
			"opacity-step-4",
			"calc(4 * 0.1)",
		],
		[
			"@duration",
			"@duration { beats-* { transition-duration: calc(var(--value) * 120ms); } }",
			"duration-beats-2",
			"calc(2 * 120ms)",
		],
		[
			"@ease",
			"@ease { back-* { transition-timing-function: cubic-bezier(0.2, 0, 0, calc(1 + var(--value) * 0.2)); } }",
			"ease-back-2",
			"calc(1 + 2 * 0.2)",
		],
		[
			"@weight",
			"@weight { over-* { font-weight: calc(400 + var(--value) * 100); } }",
			"font-over-3",
			"calc(400 + 3 * 100)",
		],
		[
			"@text",
			"@text { step-* { font-size: calc(1rem + var(--value) * 0.25rem); } }",
			"text-step-4",
			"calc(1rem + 4 * 0.25rem)",
		],
		[
			"@animate",
			"@animate { slow-* { animation-duration: calc(var(--value) * 1s); } }",
			"animate-slow-3",
			"calc(3 * 1s)",
		],
	])("%s takes a functional block", async (_label, css, cls, expected) => {
		const result = await build(css, cls);
		expect(result.css).toContain(`.${cls} {`);
		expect(result.css).toContain(expected);
	});

	it("defines a static block too", async () => {
		const result = await build("@shadow { card { box-shadow: 0 1px 2px #0003; } }", "shadow-card");
		expect(result.css).toContain(".shadow-card {");
	});

	// The colon is what separates a utility block from a directive's own block
	// grammar, so both must survive in the same body.
	it("leaves @animate keyframes alone", async () => {
		const css =
			"@animate { spin2: spin2 1s linear infinite { from { rotate: 0deg; } to { rotate: 360deg; } } slow-* { animation-duration: calc(var(--value) * 1s); } }";
		const result = await build(css, "animate-spin2 animate-slow-3");
		expect(result.css).toContain("@keyframes spin2");
		expect(result.css).toContain("--animate-spin2");
		expect(result.css).toContain(".animate-slow-3 {");
	});

	it("leaves the @text comma grammar alone", async () => {
		const css = "@text { hero: 4rem, 1.1; step-* { font-size: calc(var(--value) * 1rem); } }";
		const result = await build(css, "text-hero text-step-2");
		expect(result.css).toContain("--text-hero: 4rem;");
		expect(result.css).toContain("--text-hero-leading: 1.1;");
		expect(result.css).toContain(".text-step-2 {");
	});
});
