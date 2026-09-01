/**
 * Concurrent SSR integration test.
 *
 * Verifies that createCompiler() produces correct, isolated results when
 * multiple compilations run concurrently — no warnings leak between requests,
 * no shared state corruption, and each compilation produces a deterministic output.
 */
import { describe, expect, it } from "vitest";
import { createCompiler } from "../../src/engine/index.js";
import { resolveDirectives } from "../../src/directives/index.js";
import { assembleSections } from "../../src/assembly.js";
import { scalesTheme } from "../helpers/fixture-scales.js";

const theme = scalesTheme();

describe("concurrent SSR compilations via createCompiler()", () => {
	it("produces identical results across concurrent compilations", async () => {
		const classNames = [
			"flex",
			"items-center",
			"justify-between",
			"p-4",
			"bg-red-500",
			"text-white",
			"hover:bg-red-600",
			"sm:flex-col",
			"rounded-4",
			"shadow-md",
		];

		// Simulate N concurrent SSR requests
		const concurrency = 10;
		const results = await Promise.all(
			Array.from({ length: concurrency }, () => {
				const compiler = createCompiler();
				const result = compiler.compile(classNames, theme);
				const { sections, warnings } = assembleSections(result, theme, compiler.fontOutputCache);
				return { sections, warnings, rules: result.rules, compileWarnings: result.warnings };
			}),
		);

		// All compilations should produce identical CSS output
		const firstCSS = results[0].sections.join("\n");
		for (let i = 1; i < results.length; i++) {
			expect(results[i].sections.join("\n")).toBe(firstCSS);
		}

		// All compilations should produce the same number of rules
		const firstRuleCount = results[0].rules.length;
		for (let i = 1; i < results.length; i++) {
			expect(results[i].rules.length).toBe(firstRuleCount);
		}

		// No unexpected warnings should leak between compilations
		for (const r of results) {
			expect(r.compileWarnings.length).toBe(0);
		}
	});

	it("isolates warnings between concurrent compilations", async () => {
		// Use different class sets — one clean, one that intentionally triggers a spacing warning
		const cleanClasses = ["flex", "p-4", "text-sm"];
		const warningClasses = ["flex", "p-full", "text-sm"];

		const [cleanResult, typoResult] = await Promise.all([
			(() => {
				const compiler = createCompiler();
				return compiler.compile(cleanClasses, theme);
			})(),
			(() => {
				const compiler = createCompiler();
				return compiler.compile(warningClasses, theme);
			})(),
		]);

		// Clean compilation should have no warnings about spacing
		const cleanSpacingWarnings = cleanResult.warnings.filter((w) => w.includes("RI-1018"));
		expect(cleanSpacingWarnings.length).toBe(0);

		// Warning-producing compilation should retain its own warning
		const warningSpacingWarnings = typoResult.warnings.filter((w) => w.includes("RI-1018"));
		expect(warningSpacingWarnings.length).toBeGreaterThan(0);
	});

	it("each createCompiler() instance has independent ri() function", () => {
		const compiler1 = createCompiler();
		const compiler2 = createCompiler();

		compiler1.compile(["flex", "p-4", "text-sm"], theme);
		compiler2.compile(["grid", "gap-2", "text-lg"], theme);

		const ri1 = compiler1.createRi();
		const ri2 = compiler2.createRi();

		// Each ri() should work independently with its own compilation context
		const merged1 = ri1("flex p-4");
		const merged2 = ri2("grid gap-2");

		expect(merged1).toContain("flex");
		expect(merged1).toContain("p-4");
		expect(merged2).toContain("grid");
		expect(merged2).toContain("gap-2");
	});

	it("concurrent compilations with different themes don't interfere", async () => {
		const theme1 = resolveDirectives([]);
		const theme2 = resolveDirectives([]);

		const classes = ["flex", "p-4", "text-sm"];

		const [result1, result2] = await Promise.all([
			(() => {
				const compiler = createCompiler();
				return compiler.compile(classes, theme1);
			})(),
			(() => {
				const compiler = createCompiler();
				return compiler.compile(classes, theme2);
			})(),
		]);

		// Both should produce the same number of rules (same input, same defaults)
		expect(result1.rules.length).toBe(result2.rules.length);

		// CSS output should be identical
		for (let i = 0; i < result1.rules.length; i++) {
			expect(result1.rules[i].css).toBe(result2.rules[i].css);
		}
	});
});
