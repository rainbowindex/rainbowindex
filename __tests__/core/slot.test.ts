import { describe, expect, it } from "vitest";
import postcss from "postcss";
import rainbowindex from "../../src/integrations/postcss/index.js";

async function compile(css: string): Promise<{ css: string; warnings: string[] }> {
	const result = await postcss([rainbowindex({ cwd: process.cwd() })]).process(css, {
		from: undefined,
	});
	return { css: result.css, warnings: result.warnings().map((w) => w.text) };
}

describe("@slot is only valid inside @custom", () => {
	it("warns RI-1037 and drops a standalone named @slot (no [data-slot] sugar)", async () => {
		const { css, warnings } = await compile(`@slot header { @apply flex; }`);
		expect(warnings.some((w) => w.includes("[RI-1037]"))).toBe(true);
		// The directive must not leak into output, and the old sugar is gone.
		expect(css).not.toContain("@slot");
		expect(css).not.toContain('[data-slot="header"]');
	});

	it("warns RI-1037 and drops the grouped @slot form", async () => {
		const { css, warnings } = await compile(`@slot { header { @apply flex; } }`);
		expect(warnings.some((w) => w.includes("[RI-1037]"))).toBe(true);
		expect(css).not.toContain("@slot");
		expect(css).not.toContain("data-slot");
	});

	it("does NOT flag @slot used as a @custom variant placeholder", async () => {
		const { css, warnings } = await compile(
			`@custom hocus { &:hover, &:focus { @slot; } } .x { @apply hocus:flex; }`,
		);
		expect(warnings.some((w) => w.includes("[RI-1037]"))).toBe(false);
		// The custom variant still resolves and expands via @apply.
		expect(css).toMatch(/:hover/);
		expect(css).toMatch(/display:\s*flex/);
	});
});
