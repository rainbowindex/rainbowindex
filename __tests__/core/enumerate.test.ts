import { describe, expect, test } from "vitest";
import { enumerateClassNames, UTILITY_VALUE_SPACES } from "../../src/utilities/enumerate.js";
import { PREFIX_DISPATCH } from "../../src/utilities/index.js";
import { STATIC_UTILITIES } from "../../src/utilities/metadata.js";
import { createClassInspector } from "../../src/engine/inspector.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";

const defaultTheme = analyzeProjectCSS("").theme;
const customTheme = analyzeProjectCSS(`
@color { brand: 0.18 330; }
@utility card { background: red; padding: 1rem; }
@utility glow-* { box-shadow: 0 0 8px; }
`).theme;

describe("value-space table coverage", () => {
	test("every dispatch root has a declared value space", () => {
		const missing = [...PREFIX_DISPATCH.keys()].filter((root) => !UTILITY_VALUE_SPACES.has(root));
		expect(missing, `roots without a value-space entry: ${missing.join(", ")}`).toEqual([]);
	});

	test("every static utility from the merge tables is enumerated", () => {
		const { classes } = enumerateClassNames(defaultTheme);
		const names = new Set(classes.map((c) => c.name));
		const missing = [...STATIC_UTILITIES].filter((name) => !names.has(name));
		expect(missing, `statics missing from enumeration: ${missing.join(", ")}`).toEqual([]);
	});
});

describe("enumeration validity", () => {
	// The core guarantee: everything enumerated is accepted by the inspector
	// (and therefore by the compiler — see the inspector's parity suite).
	test.each([
		["default", defaultTheme],
		["custom", customTheme],
	] as const)("every enumerated class validates (%s theme)", (_label, theme) => {
		const inspector = createClassInspector(theme);
		const { classes } = enumerateClassNames(theme);
		const invalid = classes.filter((c) => !inspector.validate(c.name).ok);
		expect(
			invalid.map((c) => c.name),
			"enumerated classes must all validate",
		).toEqual([]);
		expect(classes.length).toBeGreaterThan(300);
	});

	test("names are unique and sorted", () => {
		const { classes } = enumerateClassNames(defaultTheme);
		const names = classes.map((c) => c.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
	});
});

describe("enumeration richness", () => {
	// Named scales are enumerated from the theme, and none ships, so this theme
	// defines the tokens the checks below name.
	const { classes, templates } = enumerateClassNames(
		analyzeProjectCSS("@text { lg: 1.25rem, 1.4; }\n@weight { bold: 700; }").theme,
	);
	const names = new Set(classes.map((c) => c.name));

	test.each([
		"flex",
		"justify-center",
		"items-center",
		"overflow-hidden",
		"sr-only",
		"bg-cover",
		"bg-theme-500",
		"text-theme-500",
		"border-transparent",
		"text-lg",
		"font-sans",
		"font-bold",
		"p-4",
		"gap-2",
		"z-10",
		"opacity-50",
		"cursor-pointer",
		"grid-cols-3",
		"col-span-2",
		"stroke-cap-round",
		"rounded-bs-2",
		"rounded-be-4",
	])("enumerates %s", (name) => {
		expect(names.has(name), `expected "${name}" in enumeration`).toBe(true);
	});

	test("functional classes carry root and kind", () => {
		const bg = classes.find((c) => c.name === "bg-theme-500");
		expect(bg).toMatchObject({ root: "bg", kind: "color" });
		const p4 = classes.find((c) => c.name === "p-4");
		expect(p4).toMatchObject({ root: "p", kind: "spacing" });
	});

	test("spacing roots emit templates", () => {
		const p = templates.find((t) => t.root === "p");
		expect(p).toMatchObject({ kind: "spacing", example: "p-4" });
		const gap = templates.find((t) => t.root === "gap");
		expect(gap).toMatchObject({ kind: "spacing" });
	});

	test("font weights enumerate as the nine steps plus an open number template", () => {
		for (const step of ["100", "400", "900"]) {
			expect(classes.some((c) => c.name === `font-${step}`)).toBe(true);
		}
		expect(templates.find((t) => t.root === "font")).toMatchObject({ kind: "number" });
	});

	test("custom utilities enumerate as classes or templates", () => {
		const custom = enumerateClassNames(customTheme);
		expect(custom.classes.some((c) => c.name === "card" && c.kind === "custom")).toBe(true);
		expect(custom.templates.some((t) => t.root === "glow" && t.kind === "custom")).toBe(true);
		expect(custom.classes.some((c) => c.name === "bg-brand-500")).toBe(true);
	});
});

/**
 * The container ladder resolves on `w-`, `min-w-`, `max-w-`, `basis-`,
 * `columns-`, and the inline-axis logical forms, so an editor has to offer it.
 * It did not: those rows carried the `breakpoint` kind, which enumerates the
 * theme's breakpoint names — a set no sizing table has a key for, so it
 * contributed nothing and `max-w-md` was resolvable but never suggested.
 */
describe("container ladder completions", () => {
	const names = new Set(enumerateClassNames(defaultTheme).classes.map((c) => c.name));

	test.each([
		"w-md",
		"w-3xs",
		"min-w-md",
		"max-w-md",
		"max-w-7xl",
		"basis-md",
		"columns-3xs",
		"inline-md",
	])("offers %s", (name) => {
		expect(names.has(name)).toBe(true);
	});

	test("does not offer it on the block axis", () => {
		for (const name of ["h-md", "size-md", "block-md", "min-h-md"]) {
			expect(names.has(name)).toBe(false);
		}
	});

	test("every offered ladder class actually resolves", () => {
		// The point of enumerating from the same table the resolver reads: a
		// completion the compiler would discard is worse than none.
		const inspect = createClassInspector(defaultTheme);
		for (const name of names) {
			if (
				/^(?:w|min-w|max-w|basis|columns|inline)-(?:3xs|2xs|xs|sm|md|lg|xl|[2-7]xl)$/.test(name)
			) {
				expect(inspect.validate(name).ok, name).toBe(true);
			}
		}
	});
});

describe("classes closed by the Tailwind parity sweep are offered by completions", () => {
	// A class that resolves but is not enumerated is invisible to the editor
	// API, the strict `ri()` types and the suggestion corpus. Two of the newly
	// closed families needed their value spaces widened to match their
	// resolvers, which is the kind of drift nothing else catches.
	const names = new Set(enumerateClassNames(defaultTheme).classes.map((c) => c.name));

	test("min-w-auto and min-h-auto", () => {
		expect(names.has("min-w-auto")).toBe(true);
		expect(names.has("min-h-auto")).toBe(true);
		// `auto` is not valid on max-*, so it must not appear there either.
		expect(names.has("max-w-auto")).toBe(false);
		expect(names.has("max-h-auto")).toBe(false);
	});

	test("every translate fraction, on both axes and the shorthand", () => {
		for (const fraction of ["1/2", "1/3", "2/3", "5/12", "11/12"]) {
			expect(names.has(`translate-x-${fraction}`), `translate-x-${fraction}`).toBe(true);
			expect(names.has(`translate-y-${fraction}`), `translate-y-${fraction}`).toBe(true);
			expect(names.has(`translate-${fraction}`), `translate-${fraction}`).toBe(true);
		}
		expect(names.has("translate-3d")).toBe(true);
	});

	test("the bare chain-enablers and basis-px", () => {
		for (const name of ["transform", "filter", "backdrop-filter", "basis-px"]) {
			expect(names.has(name), name).toBe(true);
		}
	});

	test("the ring-offset family and ring-inset, which closed the last of the gap", () => {
		// These resolve through the `ring` dispatch, so the resolver works whether
		// or not the enumerator knows about them — and an editor would then
		// complete `ring-2` but never `ring-offset-2`. The value space is a
		// separate registration from the resolver, which is exactly the drift
		// this file exists to catch.
		for (const name of ["ring-inset", "ring-offset-0", "ring-offset-2", "ring-offset-4"]) {
			expect(names.has(name), name).toBe(true);
		}
		// Colours too — the family is dual-mode, like `ring` itself.
		expect([...names].some((n) => /^ring-offset-[a-z]+$/.test(n) && n !== "ring-offset-0")).toBe(
			true,
		);
		// `inset-ring` is already inset; `inset-ring-inset` is not a class in
		// either engine, so the keyword belongs to the outer root alone.
		expect(names.has("inset-ring-inset")).toBe(false);
	});

	test("the logical sizing spellings, not just the physical ones", () => {
		// These resolve and always did; only the physical spellings were listed,
		// so an editor could complete `min-w-full` and not `min-inline-full`.
		for (const name of [
			"min-inline-full",
			"max-inline-full",
			"min-block-0",
			"min-block-auto",
			"min-block-full",
			"max-block-full",
			"max-block-none",
			"inline-full",
			"block-full",
			"block-screen",
		]) {
			expect(names.has(name), name).toBe(true);
		}
		// The union of named values is offered to every sizing root and filtered
		// by what each actually resolves, so nothing invalid leaks in.
		for (const name of ["max-w-auto", "max-h-auto", "max-block-auto", "max-inline-auto"]) {
			expect(names.has(name), name).toBe(false);
		}
	});

	test("the shadow resets, on exactly the families that have them", () => {
		for (const name of [
			"shadow-none",
			"shadow-initial",
			"inset-shadow-none",
			"inset-shadow-initial",
			"text-shadow-none",
			"text-shadow-initial",
			"drop-shadow-none",
		]) {
			expect(names.has(name), name).toBe(true);
		}
		// Neither of these is a Tailwind class, and neither resolves here.
		expect(names.has("drop-shadow-initial")).toBe(false);
		expect(names.has("ring-initial")).toBe(false);
	});
});
