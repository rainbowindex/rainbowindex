import { describe, expect, it } from "vitest";
import { resolveUtility } from "../../../src/utilities/index.js";
import { resolveDirectives } from "../../../src/directives/index.js";

const theme = resolveDirectives([]);

describe("sizing utilities", () => {
	it("w-4 → width: calc(4 * var(--spacing))", () => {
		const r = resolveUtility("w-4", null, false, theme);
		expect(r!.declarations[0].property).toBe("width");
	});

	it("w-full → width: 100%", () => {
		const r = resolveUtility("w-full", null, false, theme);
		expect(r!.declarations[0].value).toBe("100%");
	});

	it("h-screen → height: 100vh", () => {
		const r = resolveUtility("h-screen", null, false, theme);
		expect(r!.declarations[0].value).toBe("100vh");
	});

	it("w-1/2 → width: 50%", () => {
		const r = resolveUtility("w-1/2", null, false, theme);
		expect(r!.declarations[0].value).toBe("50%");
	});

	it("max-w-lg → max-width: 32rem", () => {
		const r = resolveUtility("max-w-lg", null, false, theme);
		expect(r!.declarations[0].value).toBe("32rem");
	});

	it("max-w-prose → max-width: 65ch", () => {
		const r = resolveUtility("max-w-prose", null, false, theme);
		expect(r!.declarations[0].value).toBe("65ch");
	});

	it("min-w-0 → min-width: 0px", () => {
		const r = resolveUtility("min-w-0", null, false, theme);
		expect(r!.declarations[0].value).toBe("0px");
	});

	it("size-4 → width + height", () => {
		const r = resolveUtility("size-4", null, false, theme);
		expect(r!.declarations).toHaveLength(2);
		expect(r!.declarations[0].property).toBe("width");
		expect(r!.declarations[1].property).toBe("height");
	});

	it("w-[300px] → arbitrary width", () => {
		const r = resolveUtility("w-[300px]", null, false, theme);
		expect(r!.declarations[0].value).toBe("300px");
	});

	it("w-px → width: 1px", () => {
		const r = resolveUtility("w-px", null, false, theme);
		expect(r!.declarations[0].property).toBe("width");
		expect(r!.declarations[0].value).toBe("1px");
	});

	it("h-px → height: 1px", () => {
		const r = resolveUtility("h-px", null, false, theme);
		expect(r!.declarations[0].property).toBe("height");
		expect(r!.declarations[0].value).toBe("1px");
	});

	it("size-px → width + height: 1px", () => {
		const r = resolveUtility("size-px", null, false, theme);
		expect(r!.declarations).toHaveLength(2);
		expect(r!.declarations[0].value).toBe("1px");
		expect(r!.declarations[1].value).toBe("1px");
	});

	it("takes any fraction, not just the enumerated ones", () => {
		// The fraction space is infinite and Tailwind compiles all of it. A
		// lookup table on its own silently rejected `w-7/9` — and the parity
		// sweep could not see it, because Tailwind's own class list only
		// enumerates the 26 fractions its completions offer.
		expect(resolveUtility("w-1/3", null, false, theme)!.declarations[0].value).toBe("33.333333%");
		expect(resolveUtility("w-7/9", null, false, theme)!.declarations[0].value).toBe(
			"calc(7 / 9 * 100%)",
		);
		expect(resolveUtility("max-w-13/17", null, false, theme)!.declarations[0].value).toBe(
			"calc(13 / 17 * 100%)",
		);
		// Every percentage-valued family agrees on the same fraction.
		for (const cls of ["w-1/3", "basis-1/3", "translate-x-1/3"]) {
			expect(resolveUtility(cls, null, false, theme)!.declarations[0].value, cls).toBe(
				"33.333333%",
			);
		}
		for (const cls of ["w-7/9", "basis-7/9", "translate-x-7/9"]) {
			expect(resolveUtility(cls, null, false, theme)!.declarations[0].value, cls).toBe(
				"calc(7 / 9 * 100%)",
			);
		}
	});

	it("rejects what is not a fraction", () => {
		for (const cls of ["w-1/0", "w-a/b", "w-1.5/3", "w-/3", "w-3/"]) {
			expect(resolveUtility(cls, null, false, theme), cls).toBeNull();
		}
	});

	it("min-*-auto resolves on all four spellings, and stays off max-*", () => {
		// `auto` is a legal min-width/min-height value and not a legal max-*
		// one, which is why Tailwind registers `min-w-auto` and no `max-w-auto`.
		// The logical spellings share the physical tables, so all four land
		// together; found by the Tailwind class-surface parity sweep.
		for (const [cls, property] of [
			["min-w-auto", "min-width"],
			["min-h-auto", "min-height"],
			["min-inline-auto", "min-inline-size"],
			["min-block-auto", "min-block-size"],
		] as const) {
			const r = resolveUtility(cls, null, false, theme);
			expect(r, cls).not.toBeNull();
			expect(r!.declarations[0].property).toBe(property);
			expect(r!.declarations[0].value).toBe("auto");
		}
		for (const cls of ["max-w-auto", "max-h-auto", "max-inline-auto", "max-block-auto"]) {
			expect(resolveUtility(cls, null, false, theme), cls).toBeNull();
		}
	});

	it("min-w-px → min-width: 1px", () => {
		const r = resolveUtility("min-w-px", null, false, theme);
		expect(r!.declarations[0].property).toBe("min-width");
		expect(r!.declarations[0].value).toBe("1px");
	});

	it("max-h-px → max-height: 1px", () => {
		const r = resolveUtility("max-h-px", null, false, theme);
		expect(r!.declarations[0].property).toBe("max-height");
		expect(r!.declarations[0].value).toBe("1px");
	});

	// Logical sizing — inline-size / block-size (mirror w-* / h-*, sharing the
	// inline/block display prefixes).
	it("inline-4 → inline-size with spacing calc", () => {
		const r = resolveUtility("inline-4", null, false, theme);
		expect(r!.declarations[0].property).toBe("inline-size");
		expect(r!.declarations[0].value).toContain("var(--spacing)");
	});

	it.each([
		["inline-auto", "auto"],
		["inline-px", "1px"],
		["inline-full", "100%"],
		["inline-screen", "100vw"],
		["inline-dvw", "100dvw"],
		["inline-dvh", "100dvh"],
		["inline-lvw", "100lvw"],
		["inline-svh", "100svh"],
		["inline-min", "min-content"],
		["inline-max", "max-content"],
		["inline-fit", "fit-content"],
		["inline-1/2", "50%"],
	])("%s → inline-size: %s", (util, value) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0].property).toBe("inline-size");
		expect(r!.declarations[0].value).toBe(value);
	});

	it("inline-[20cqi] / inline-(--w) → arbitrary + custom property", () => {
		expect(resolveUtility("inline-[20cqi]", null, false, theme)!.declarations[0]).toEqual({
			property: "inline-size",
			value: "20cqi",
		});
		// `inline-(--w)` is parsed to `[var(--w)]` upstream.
		expect(resolveUtility("inline-[var(--w)]", null, false, theme)!.declarations[0]).toEqual({
			property: "inline-size",
			value: "var(--w)",
		});
	});

	it("block-* → block-size (block axis: screen → 100vh)", () => {
		expect(resolveUtility("block-4", null, false, theme)!.declarations[0].property).toBe(
			"block-size",
		);
		expect(resolveUtility("block-screen", null, false, theme)!.declarations[0].value).toBe("100vh");
		expect(resolveUtility("block-full", null, false, theme)!.declarations[0]).toEqual({
			property: "block-size",
			value: "100%",
		});
	});

	it("display utilities are unaffected by the inline/block sizing overload", () => {
		expect(resolveUtility("inline", null, false, theme)!.declarations[0]).toEqual({
			property: "display",
			value: "inline",
		});
		expect(resolveUtility("inline-block", null, false, theme)!.declarations[0]).toEqual({
			property: "display",
			value: "inline-block",
		});
		expect(resolveUtility("block", null, false, theme)!.declarations[0]).toEqual({
			property: "display",
			value: "block",
		});
	});

	it.each([
		["min-inline-4", "min-inline-size", "calc(4 * var(--spacing))"],
		["max-inline-full", "max-inline-size", "100%"],
		["min-inline-1/2", "min-inline-size", "50%"],
		["max-inline-[40rem]", "max-inline-size", "40rem"],
		["min-block-dvh", "min-block-size", "100dvh"],
		["max-block-lh", "max-block-size", "1lh"],
		["min-block-(--v)", "min-block-size", "var(--v)"],
	])("%s → %s: %s (logical min/max sizing)", (util, prop, val) => {
		const r = resolveUtility(util.replace("(--v)", "[var(--v)]"), null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	it.each([
		["min-w-dvh", "min-width", "100dvh"],
		["max-w-svh", "max-width", "100svh"],
		["min-h-dvw", "min-height", "100dvw"],
		["max-h-lvw", "max-height", "100lvw"],
		["min-w-1/2", "min-width", "50%"],
		["h-lh", "height", "1lh"],
		["max-h-lh", "max-height", "1lh"],
		["block-lh", "block-size", "1lh"],
	])("%s → %s: %s (cross-axis viewport / lh / fraction)", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});
});

/**
 * The container ladder — Tailwind's `--container-*` namespace. It reached
 * `max-w-*` only, while `columns-*` kept a second copy of the same table that
 * added `3xs`/`2xs`, so `columns-3xs` resolved and `max-w-3xs` did not. One
 * table now, read by every family upstream feeds from it.
 */
describe("container ladder", () => {
	const decl = (cls: string): [string, string] | null => {
		const r = resolveUtility(cls, null, false, theme);
		return r ? [r.declarations[0].property, r.declarations[0].value] : null;
	};

	it.each([
		["w-md", "width", "28rem"],
		["w-3xs", "width", "16rem"],
		["w-2xs", "width", "18rem"],
		["min-w-md", "min-width", "28rem"],
		["max-w-3xs", "max-width", "16rem"],
		["basis-md", "flex-basis", "28rem"],
		["columns-3xs", "columns", "16rem"],
		["inline-md", "inline-size", "28rem"],
		["min-inline-md", "min-inline-size", "28rem"],
	])("%s → %s: %s", (cls, prop, value) => {
		expect(decl(cls)).toEqual([prop, value]);
	});

	it("stays off the block axis, as upstream does", () => {
		// `--container-*` is an inline-axis scale. Adding it to NAMED_SIZES would
		// have given it to `size-` and `h-` for free, which is why the ladder is
		// read per-branch instead.
		for (const cls of ["h-md", "size-md", "block-md", "min-h-md", "max-h-md"]) {
			expect(resolveUtility(cls, null, false, theme)).toBeNull();
		}
	});

	it("does not shadow the spacing scale or the keyword values", () => {
		expect(decl("w-4")).toEqual(["width", "calc(4 * var(--spacing))"]);
		expect(decl("w-full")).toEqual(["width", "100%"]);
		expect(decl("basis-4")).toEqual(["flex-basis", "calc(4 * var(--spacing))"]);
		expect(decl("min-w-0")).toEqual(["min-width", "0px"]);
	});
});
