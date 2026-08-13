import { describe, expect, test } from "vitest";
import { analyzeMerge, createRi } from "../../src/merge/index.js";
import { createThemeSnapshot } from "../../src/engine/index.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";

const customTheme = analyzeProjectCSS(`
@color { brand: 0.18 330; }
@text { display: 4rem, 1.05; }
@utility card { background: red; padding: 1rem; border-radius: 8px; }
`).theme;
const snapshot = createThemeSnapshot(customTheme);

describe("analyzeMerge — drop attribution", () => {
	test("rightmost same-property class wins", () => {
		const result = analyzeMerge(["px-2", "py-1", "px-4"]);
		expect(result.output).toBe("py-1 px-4");
		expect(result.kept).toEqual([1, 2]);
		expect(result.dropped).toEqual([{ index: 0, className: "px-2", overriddenBy: [2] }]);
	});

	test("shorthand dominates both axes", () => {
		const result = analyzeMerge(["px-2", "py-1", "p-4"]);
		expect(result.output).toBe("p-4");
		expect(result.dropped.map((d) => d.className).sort()).toEqual(["px-2", "py-1"]);
		for (const drop of result.dropped) {
			expect(drop.overriddenBy).toEqual([2]);
		}
	});

	test("a leading shorthand survives later longhands (mirrors ri)", () => {
		// ri() drops a class only when its own claims are covered — p-2 claims
		// the `padding` shorthand, which px/py longhands never claim. The
		// compiled stylesheet's cascade order settles the visual outcome, so
		// dedup stays conservative here.
		const result = analyzeMerge(["p-2", "px-4", "py-4"]);
		expect(result.output).toBe("p-2 px-4 py-4");
		expect(result.dropped).toEqual([]);
	});

	test("joint overrides attribute every winner", () => {
		// text-lg claims font-size + line-height; the arbitrary property covers
		// font-size and leading-tight covers line-height — only together do
		// they dominate it, so the attribution lists both.
		const result = analyzeMerge(["text-lg", "[font-size:16px]", "leading-tight"]);
		expect(result.output).toBe("[font-size:16px] leading-tight");
		expect(result.dropped).toEqual([{ index: 0, className: "text-lg", overriddenBy: [1, 2] }]);
	});

	test("duplicate classes attribute to the surviving copy", () => {
		const result = analyzeMerge(["flex", "flex"]);
		expect(result.output).toBe("flex");
		expect(result.dropped).toEqual([{ index: 0, className: "flex", overriddenBy: [1] }]);
	});

	test("variants partition the claim namespace", () => {
		expect(analyzeMerge(["px-2", "hover:px-4"]).dropped).toEqual([]);
		expect(analyzeMerge(["hover:px-2", "sm:hover:px-4"]).dropped).toEqual([]);
		const sameVariant = analyzeMerge(["hover:px-2", "hover:px-4"]);
		expect(sameVariant.dropped).toEqual([{ index: 0, className: "hover:px-2", overriddenBy: [1] }]);
	});

	test("variant order canonicalizes for claims", () => {
		const result = analyzeMerge(["sm:hover:px-2", "hover:sm:px-4"]);
		expect(result.dropped).toEqual([{ index: 0, className: "sm:hover:px-2", overriddenBy: [1] }]);
	});

	test("!important partitions from normal declarations", () => {
		expect(analyzeMerge(["px-2!", "px-4"]).dropped).toEqual([]);
		expect(analyzeMerge(["px-2!", "px-4!"]).dropped).toEqual([
			{ index: 0, className: "px-2!", overriddenBy: [1] },
		]);
	});

	test("unknown classes always survive", () => {
		const result = analyzeMerge(["totally-unknown", "flex", "totally-unknown"]);
		expect(result.dropped).toEqual([]);
		expect(result.kept).toEqual([0, 1, 2]);
	});

	test("dual-mode text: size and color do not conflict", () => {
		const result = analyzeMerge(["text-lg", "text-brand-500"], snapshot);
		expect(result.dropped).toEqual([]);
	});
});

describe("analyzeMerge — theme snapshots", () => {
	test("custom text size conflicts only with the snapshot", () => {
		// Without the snapshot "display" is not a known text size, so
		// text-display resolves as a color claim and survives text-lg.
		expect(analyzeMerge(["text-display", "text-lg"]).dropped).toEqual([]);
		// With it, both claim font-size/line-height — rightmost wins.
		expect(analyzeMerge(["text-display", "text-lg"], snapshot).dropped).toEqual([
			{ index: 0, className: "text-display", overriddenBy: [1] },
		]);
	});

	test("multi-property custom utility survives partial overrides", () => {
		const partial = analyzeMerge(["card", "p-8"], snapshot);
		expect(partial.dropped).toEqual([]);
		expect(partial.output).toBe("card p-8");
	});
});

describe("analyzeMerge — output parity with ri()", () => {
	const cases: string[][] = [
		["px-2", "py-1", "px-4"],
		["px-2", "py-1", "p-4"],
		["flex", "flex"],
		["hover:px-2", "hover:px-4", "px-1"],
		["sm:hover:px-2", "hover:sm:px-4"],
		["px-2!", "px-4"],
		["totally-unknown", "flex"],
		["text-display", "text-lg", "card", "p-8"],
		["text-lg", "text-brand-500"],
	];

	test.each(cases.map((c) => [c.join(" "), c] as const))("%s", (_label, classes) => {
		const bound = createRi(snapshot);
		expect(analyzeMerge(classes, snapshot).output).toBe(bound(...classes));
	});

	test("kept indices reproduce the output", () => {
		for (const classes of cases) {
			const result = analyzeMerge(classes, snapshot);
			expect(result.kept.map((i) => classes[i]).join(" ")).toBe(result.output);
		}
	});
});
