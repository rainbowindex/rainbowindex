import { describe, expect, test } from "vitest";
import {
	extractClassCandidates,
	extractClassesFromSource,
} from "../../src/scanner/class-extraction.js";

// ---------------------------------------------------------------------------
// RI-1412 — whitespace inside an arbitrary value
// ---------------------------------------------------------------------------
// A class name cannot contain whitespace: `class`, `@a`/`@apply` and
// `safelist()` all split on it, so `bg-[url('a b')]` reaches the browser as
// two tokens and matches nothing. The scanner has always dropped these; the
// warning exists so the author is told, instead of hunting for missing CSS.
//
// The gate is provenance, not shape. Only a collector that treats its input as
// a class list may report — the whole-file scan's grammar also matches JS and
// prose, where bracketed whitespace is ordinary.

const warn = (content: string, path = "/tmp/src/a.tsx"): string[] => {
	const warnings: string[] = [];
	extractClassesFromSource({ path, content }, warnings);
	return warnings.filter((w) => w.startsWith("[RI-1412]"));
};

describe("reports whitespace in a class-list context", () => {
	test("JSX className attribute", () => {
		const warnings = warn(`<div className="bg-[url('a b')]" />`);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain(`"bg-[url('a b')]"`);
		expect(warnings[0]).toContain('Use "_" for a space');
	});

	test("HTML class attribute", () => {
		expect(warn(`<div class="grid-cols-[1fr 2fr]">`, "/tmp/src/a.html")).toHaveLength(1);
	});

	test("Vue and Svelte class attributes", () => {
		expect(warn(`<template><i class="content-[a b]"/></template>`, "/tmp/a.vue")).toHaveLength(1);
		expect(warn(`<i class="content-[a b]"/>`, "/tmp/a.svelte")).toHaveLength(1);
	});

	test("class helper argument", () => {
		expect(warn(`const c = cn("shadow-[0 2px red]");`)).toHaveLength(1);
	});

	test("safelist argument", () => {
		expect(warn(`safelist("content-['hello world']");`)).toHaveLength(1);
	});

	test("reported once when an attribute and a nested helper both see it", () => {
		// collectAssignedValues (attribute) and collectCallArguments (helper)
		// both tokenize this value — the reader must still get one line.
		expect(warn(`<div className={cn("bg-[url('a b')]")} />`)).toHaveLength(1);
	});
});

describe("stays quiet where whitespace is ordinary", () => {
	test("a JS property access in a className expression", () => {
		// The exact false positive the filter order guards: this is JS, and it
		// sits inside a class-list context.
		expect(warn(`<div className={styles["my class"]} />`)).toEqual([]);
		expect(warn(`<div className={cn(styles["my class"], "p-4")} />`)).toEqual([]);
	});

	test("the whole-file scan alone never reports", () => {
		expect(warn(`const label = "select [a b] first";`)).toEqual([]);
		expect(warn(`See the [a b] note.`, "/tmp/readme.md")).toEqual([]);
	});

	test("an equality operand never reports", () => {
		expect(warn(`const on = mode === "[a b]";`)).toEqual([]);
	});

	test("the escaped form is silent and still collected", () => {
		const content = `<div className="bg-[url('a_b')] grid-cols-[1fr_2fr]" />`;
		expect(warn(content)).toEqual([]);
		const classes = extractClassesFromSource({ path: "/tmp/src/a.tsx", content });
		expect(classes).toContain("bg-[url('a_b')]");
		expect(classes).toContain("grid-cols-[1fr_2fr]");
	});

	test("no warnings on a real component file", () => {
		expect(warn(`<div className="p-4 hover:bg-red-500 -mt-2 w-1/2" />`)).toEqual([]);
	});
});

describe("reordering the filters changed no extracted value", () => {
	// All four candidate filters only skip, so their order cannot move a value.
	// This pins the whole rejected set, not just the whitespace case.
	test("every rejected shape is still rejected, every kept shape still kept", () => {
		const content = `<div className="p-[20px] FooBar content-[hello world] data-[12] obj[key] rest['aria invalid'] -mt-4 w-1/2 [color:red]" />`;
		const classes = extractClassesFromSource({ path: "/tmp/src/a.tsx", content });
		for (const kept of ["p-[20px]", "-mt-4", "w-1/2", "[color:red]"]) {
			expect(classes).toContain(kept);
		}
		for (const dropped of ["FooBar", "content-[hello world]", "data-[12]", "obj[key]"]) {
			expect(classes).not.toContain(dropped);
		}
	});

	test("candidate origins are unchanged", () => {
		const content = `<div className={cn("p-4", styles["my class"])} />`;
		const candidates = extractClassCandidates({ path: "/tmp/src/a.tsx", content });
		expect(candidates.find((c) => c.value === "p-4")?.origin).toBe("helper");
	});
});
