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
