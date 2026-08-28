import { describe, expect, it } from "vitest";
import { createCompiler } from "../../src/engine/index.js";
import { fixtureTheme } from "../helpers/fixture-colors.js";

const theme = fixtureTheme();

// The per-theme class compile memo is module-private, so the cap is asserted
// behaviorally: flooding it past CLASS_COMPILE_MEMO_CAP (50_000) must trigger
// the clear-at-cap path without corrupting results, in the same compile pass
// and in later ones. Would this test hang or OOM instead of fail? No — a
// broken clear just skips the branch, so the correctness asserts still run.
describe("class compile memo cap", () => {
	it("compiles correctly while crossing the cap and on later compiles", () => {
		const compiler = createCompiler();

		const warm = compiler.compile(["p-4"], theme);
		expect(warm.rules).toHaveLength(1);

		const junk = Array.from({ length: 50_001 }, (_, i) => `junk-${i}`);
		const flood = compiler.compile([...junk, "p-4", "flex"], theme);
		expect(flood.rules).toHaveLength(2);
		const floodCSS = flood.rules.map((r) => r.css).join("\n");
		expect(floodCSS).toContain("calc(4 * var(--spacing))");
		expect(floodCSS).toContain("display: flex");

		const after = compiler.compile(["p-4", "text-error-500"], theme);
		expect(after.rules).toHaveLength(2);
		const afterCSS = after.rules.map((r) => r.css).join("\n");
		expect(afterCSS).toContain("calc(4 * var(--spacing))");
		expect(afterCSS).toContain("var(--color-error-500)");
	});
});
