import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createCompiler } from "../../src/engine/index.js";
import { resolveDirectives } from "../../src/directives/index.js";

const theme = resolveDirectives([]);

describe("performance guardrails", () => {
	it("compiles a representative large class list within a broad time budget", () => {
		const compiler = createCompiler();
		const classNames = Array.from({ length: 400 }, (_, index) => [
			`p-${(index % 12) + 1}`,
			`m-${(index % 8) + 1}`,
			`text-${["sm", "base", "lg", "xl"][index % 4]}`,
			`bg-error-${[100, 200, 300, 400, 500][index % 5]}`,
			`${["hover", "focus", "sm", "md"][index % 4]}:rounded-${["sm", "md", "lg"][index % 3]}`,
		]).flat();

		const start = performance.now();
		const result = compiler.compile(classNames, theme);
		const durationMs = performance.now() - start;

		expect(result.rules.length).toBeGreaterThan(0);
		// Broad CI-safe guardrail to catch accidental algorithmic blowups.
		expect(durationMs).toBeLessThan(2_000);
	});
});
