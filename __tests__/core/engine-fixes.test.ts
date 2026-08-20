import { describe, expect, it } from "vitest";
import { createCompiler } from "../../src/engine/index.js";
import {
	VARIANT_WEIGHTS,
	buildBreakpointWeights,
	computeVariantWeight,
} from "../../src/engine/ordering.js";
import { findClosest } from "../../src/engine/suggest.js";
import { resolveVariant, type VariantWrapper } from "../../src/engine/variants.js";
import { resolveDirectives } from "../../src/directives/index.js";

const theme = resolveDirectives([]);
const compile = (classNames: Iterable<string>, activeTheme = theme) =>
	createCompiler().compile(classNames, activeTheme);

// ---------------------------------------------------------------------------
// Deterministic rule ordering — sortKey ties must not leak scan order
// ---------------------------------------------------------------------------

describe("deterministic rule ordering", () => {
	it("same-group utilities compile in the same order regardless of input order", () => {
		const a = compile(["pt-8", "pt-4"]);
		const b = compile(["pt-4", "pt-8"]);
		expect(a.rules.map((r) => r.css)).toEqual(b.rules.map((r) => r.css));
	});

	it("ties break by selector codepoint order", () => {
		const result = compile(["pt-8", "pt-4"]);
		expect(result.rules.map((r) => r.selector)).toEqual([".pt-4", ".pt-8"]);
	});

	it("ties among variant rules are also input-order independent", () => {
		const a = compile(["hover:pt-8", "hover:pt-4"]);
		const b = compile(["hover:pt-4", "hover:pt-8"]);
		expect(a.rules.map((r) => r.css)).toEqual(b.rules.map((r) => r.css));
		expect(a.rules[0].selector).toBe(".hover\\:pt-4:hover");
	});
});

// ---------------------------------------------------------------------------
// Theme-derived breakpoint weights
// ---------------------------------------------------------------------------

describe("buildBreakpointWeights", () => {
	it("reproduces the static numbering for the default theme", () => {
		const map = buildBreakpointWeights(theme.breakpoints);
		for (const name of ["sm", "md", "lg", "xl"]) {
			expect(map.get(name)).toBe(VARIANT_WEIGHTS[name]);
			expect(map.get(`@${name}`)).toBe(VARIANT_WEIGHTS[`@${name}`]);
		}
	});

	it("slots custom breakpoints into the responsive and container tiers by size", () => {
		const custom = resolveDirectives([{ type: "breakpoint", body: "2xl: 96rem; 3xl: 120rem;" }]);
		const map = buildBreakpointWeights(custom.breakpoints);
		expect(map.get("2xl")).toBe(105);
		expect(map.get("3xl")).toBe(106);
		expect(map.get("@2xl")).toBe(210);
		expect(map.get("@3xl")).toBe(211);
	});

	it("orders mixed px/rem values numerically (rem at 16px)", () => {
		const map = buildBreakpointWeights({ a: "700px", sm: "40rem" });
		// 40rem = 640px < 700px
		expect(map.get("sm")).toBe(101);
		expect(map.get("a")).toBe(102);
	});

	it("orders unparseable values last, by codepoint", () => {
		const map = buildBreakpointWeights({ z: "10vw", a: "calc(1px)", sm: "40rem" });
		expect(map.get("sm")).toBe(101);
		expect(map.get("a")).toBe(102);
		expect(map.get("z")).toBe(103);
	});

	it("named container variants resolve through the derived map", () => {
		const custom = resolveDirectives([{ type: "breakpoint", body: "2xl: 96rem;" }]);
		const map = buildBreakpointWeights(custom.breakpoints);
		expect(computeVariantWeight(["@sidebar/2xl"], map)).toBe(210);
	});
});

describe("custom breakpoint cascade order", () => {
	const custom = resolveDirectives([{ type: "breakpoint", body: "2xl: 96rem; 3xl: 120rem;" }]);

	it("2xl sorts after xl and before state variants", () => {
		const result = compile(["hover:p-4", "2xl:p-4", "xl:p-4"], custom);
		const css = result.rules.map((r) => r.css);
		const xl = css.findIndex((c) => c.includes("min-width: 80rem"));
		const xxl = css.findIndex((c) => c.includes("min-width: 96rem"));
		const hover = css.findIndex((c) => c.includes(":hover"));
		expect(xl).toBeLessThan(xxl);
		expect(xxl).toBeLessThan(hover);
	});

	it("two custom breakpoints order by min-width, not by name", () => {
		const sized = resolveDirectives([{ type: "breakpoint", body: "wide: 100rem; huge: 120rem;" }]);
		// "huge" < "wide" by codepoint, but wide (100rem) is the smaller breakpoint.
		const result = compile(["huge:p-4", "wide:p-4"], sized);
		const css = result.rules.map((r) => r.css);
		const wide = css.findIndex((c) => c.includes("min-width: 100rem"));
		const huge = css.findIndex((c) => c.includes("min-width: 120rem"));
		expect(wide).toBeLessThan(huge);
	});

	it("custom container-query breakpoints sort within the container tier", () => {
		const result = compile(["@2xl:p-4", "@xl:p-4"], custom);
		const css = result.rules.map((r) => r.css);
		const xl = css.findIndex((c) => c.includes("@container (min-width: 80rem)"));
		const xxl = css.findIndex((c) => c.includes("@container (min-width: 96rem)"));
		expect(xl).toBeLessThan(xxl);
	});
});

// ---------------------------------------------------------------------------
// Variant fixes
// ---------------------------------------------------------------------------

describe("comma-bearing variant stacking", () => {
	it("applies a stacked suffix variant to every branch of a comma-bearing custom variant", () => {
		// Previously the engine appended a stacked suffix only after the last
		// branch of a comma-bearing variant selector (".x:hover, .x:focus:hover"),
		// diverging from @apply's per-branch semantics. Both surfaces now share
		// applyVariantWrappers, which lands the suffix on every branch.
		const custom = resolveDirectives([
			{ type: "custom", body: "", modifier: "hocus (&:hover, &:focus)" },
		]);
		const result = compile(["hocus:hover:underline"], custom);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].selector).toBe(
			".hocus\\:hover\\:underline:hover:hover, .hocus\\:hover\\:underline:focus:hover",
		);
	});
});

describe("plain arbitrary variant self-match", () => {
	it("[p] emits a self-match :is() with no descendant space", () => {
		const result = compile(["[p]:p-4"]);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].selector).toBe(".\\[p\\]\\:p-4:is(p)");
	});
});

describe("not- variant fallback removal", () => {
	it("explicit not- mappings still resolve", () => {
		const result = compile(["not-hover:p-4", "not-first:p-4", "not-[.foo]:p-4"]);
		expect(result.rules).toHaveLength(3);
		const css = result.rules.map((r) => r.css).join("\n");
		expect(css).toContain(":not(:hover)");
		expect(css).toContain(":not(:first-child)");
		expect(css).toContain(":not(.foo)");
	});

	it("unknown not- names are rejected with RI-1004 instead of emitting invalid CSS", () => {
		const result = compile(["not-hoover:p-4"]);
		expect(result.rules).toHaveLength(0);
		expect(result.warnings.some((w) => w.includes("RI-1004"))).toBe(true);
	});
});

describe("underscore decoding in bracket variants", () => {
	it("has-[.a_.b] compiles to :has(.a .b) while the class selector keeps the raw underscore", () => {
		const result = compile(["has-[.a_.b]:p-4"]);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].selector).toBe(".has-\\[\\.a_\\.b\\]\\:p-4:has(.a .b)");
	});

	it("decodes underscores across all bracket variant families", () => {
		expect(resolveVariant("group-[.foo_.bar]", theme)?.selectorSuffix).toBe(
			".group:is(.foo .bar) &",
		);
		expect(resolveVariant("peer-[.a_.b]", theme)?.selectorSuffix).toBe(".peer:is(.a .b) ~ &");
		expect(resolveVariant("in-[.a_.b]", theme)?.selectorSuffix).toBe(":where(.a .b) &");
		expect(resolveVariant("not-[.a_.b]", theme)?.selectorSuffix).toBe(":not(.a .b)");
		expect(resolveVariant('aria-[label="hello_world"]', theme)?.selectorSuffix).toBe(
			'[aria-label="hello world"]',
		);
	});

	it("escaped underscores stay literal", () => {
		expect(resolveVariant("has-[.a\\_b]", theme)?.selectorSuffix).toBe(":has(.a_b)");
	});
});

describe("variant wrapper reuse", () => {
	it("static pseudo-class/element wrappers are shared frozen singletons", () => {
		expect(resolveVariant("hover", theme)).toBe(resolveVariant("hover", theme));
		expect(resolveVariant("before", theme)).toBe(resolveVariant("before", theme));
		expect(Object.isFrozen(resolveVariant("hover", theme))).toBe(true);
	});

	it("memo caches wrappers and null misses per variant name", () => {
		const memo = new Map<string, VariantWrapper | null>();
		const wrapper = resolveVariant("data-[state=open]", theme, undefined, memo);
		expect(wrapper).not.toBeNull();
		expect(resolveVariant("data-[state=open]", theme, undefined, memo)).toBe(wrapper);
		expect(resolveVariant("hoover", theme, undefined, memo)).toBeNull();
		expect(memo.has("hoover")).toBe(true);
		expect(memo.size).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// compile() string input
// ---------------------------------------------------------------------------

describe("compile() with a bare string", () => {
	it("splits on whitespace instead of iterating per character", () => {
		const result = compile("flex  p-4\n\thover:underline");
		expect(result.rules).toHaveLength(3);
	});

	it("empty and whitespace-only strings compile to zero rules", () => {
		expect(compile("").rules).toHaveLength(0);
		expect(compile("  \n\t ").rules).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// OSA typo suggestions
// ---------------------------------------------------------------------------

describe("findClosest OSA distance", () => {
	it("treats adjacent transpositions as a single edit", () => {
		// Distance 2 under plain Levenshtein (over the short-string threshold of 1).
		expect(findClosest("felx", ["flex", "block", "grid"])).toBe("flex");
		expect(findClosest("grdi", ["flex", "block", "grid"])).toBe("grid");
	});

	it("grows the shared dp buffer for long inputs and stays reusable", () => {
		const target = `${"a".repeat(98)}yx`;
		expect(findClosest(`${"a".repeat(98)}xy`, [target])).toBe(target);
		// Shorter input after growth still works against the reused buffer.
		expect(findClosest("fex", ["flex"])).toBe("flex");
	});
});
