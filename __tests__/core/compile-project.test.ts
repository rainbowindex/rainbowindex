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
	// Regression: the block (which sets `corner-shape` and defines
	// --ri-rounded-scale) was gated on usedRounded, which only tracks named token
	// refs like var(--rounded-lg). Numeric/arbitrary radii — and @apply-inlined
	// radii, which bypass usedRounded entirely — never populate it, so
	// `@rounded squircle;` + `rounded-4` silently dropped the shape: corners
	// rendered round and the scale var was undefined. The block is now emitted
	// whenever a shape is configured.
	it.each([
		["named token", "rounded-lg"],
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
