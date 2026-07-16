import { describe, expect, it } from "vitest";
import postcss from "postcss";
import rainbowindex from "../../src/integrations/postcss/index.js";

async function compile(css: string): Promise<string> {
	const result = await postcss([rainbowindex({ cwd: process.cwd() })]).process(css, {
		from: undefined,
	});
	return result.css;
}

function gradientStopsIn(body: string): string[] {
	return [...body.matchAll(/--ri-gradient-stops:\s*([^;]+);/g)].map((m) => m[1]);
}

describe("@apply with gradient stops", () => {
	it("via-* declaration wins even when listed before to-*", async () => {
		const css = await compile(`
			@import "rainbowindex";
			@color { background: oklch(0.978 0 0) / oklch(0.182 0 0); }
			.fade {
				@apply bg-linear-to-b from-background via-background/92 to-transparent;
			}
		`);

		const block = css.match(/\.fade\s*\{([\s\S]*?)\}/);
		expect(block, "could not find .fade rule").not.toBeNull();
		const body = block![1];
		const stops = gradientStopsIn(body);
		expect(stops.length).toBeGreaterThan(0);
		expect(stops[stops.length - 1]).toContain("--ri-gradient-via");
	});

	it("ordering is independent of class order in @apply", async () => {
		const css = await compile(`
			@import "rainbowindex";
			@color { background: oklch(0.978 0 0) / oklch(0.182 0 0); }
			.a { @apply from-background via-background/92 to-transparent; }
			.b { @apply to-transparent via-background/92 from-background; }
			.c { @apply via-background/92 from-background to-transparent; }
		`);

		for (const sel of [".a", ".b", ".c"]) {
			const block = css.match(new RegExp(`\\${sel}\\s*\\{([\\s\\S]*?)\\}`));
			expect(block, `block for ${sel}`).not.toBeNull();
			const stops = gradientStopsIn(block![1]);
			expect(stops.length, `stops in ${sel}`).toBeGreaterThan(0);
			expect(stops[stops.length - 1], `last stops in ${sel}`).toContain("--ri-gradient-via");
		}
	});
});
