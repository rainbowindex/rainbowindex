/**
 * `outermostCandidates` — one candidate per class the author wrote.
 *
 * The asymmetry it exists for is easy to miss and expensive to hit: the HTML
 * extractor emits `sm:flex` once, and the JS lexer emits `sm` and `sm:flex`,
 * because in JavaScript a colon is also a ternary and an object key. Anything
 * that turns a candidate into an underline has to see the same thing in both,
 * so both are pinned here — a change to either extractor that broke the
 * symmetry would show up as a failure in this file rather than as a wrong
 * squiggle in someone's editor.
 */

import { describe, expect, test } from "vitest";
import { outermostCandidates } from "../../src/editor/candidates.js";
import { extractClassCandidates, type ClassCandidate } from "../../src/scanner/class-extraction.js";

/** Class values the editor path should see, in source order. */
function outermost(content: string, path: string): string[] {
	return outermostCandidates(extractClassCandidates({ content, path }))
		.filter((c) => c.origin === "attribute" || c.origin === "helper")
		.map((c) => c.value);
}

/** Everything the scanner emits, for the contrast the filter exists to remove. */
function raw(content: string, path: string): string[] {
	return extractClassCandidates({ content, path })
		.filter((c) => c.origin === "attribute" || c.origin === "helper")
		.map((c) => c.value);
}

describe("outermostCandidates", () => {
	test("drops the colon fragments the JS lexer emits around a variant", () => {
		const jsx = `const a = <div className="sm:hover:focus:flex p-4" />;`;
		expect(raw(jsx, "a.tsx")).toEqual(["sm", "sm:hover:focus:flex", "hover", "focus", "p-4"]);
		expect(outermost(jsx, "a.tsx")).toEqual(["sm:hover:focus:flex", "p-4"]);
	});

	test("makes the JS and HTML extractors agree", () => {
		const classes = "sm:flex hover:bg-red-500 p-4";
		expect(outermost(`<div class="${classes}"></div>`, "a.html")).toEqual(
			outermost(`const a = <div className="${classes}" />;`, "a.tsx"),
		);
	});

	test("drops a named group's name, which is not a class", () => {
		const jsx = `const a = <div className="group-hover/item:underline" />;`;
		expect(raw(jsx, "a.tsx")).toContain("item");
		expect(outermost(jsx, "a.tsx")).toEqual(["group-hover/item:underline"]);
	});

	test("drops a variant group's prefix, which its members already carry", () => {
		const jsx = `const a = <div className="hover:{px-2 py-1} flex" />;`;
		expect(raw(jsx, "a.tsx")).toContain("hover");
		expect(outermost(jsx, "a.tsx")).toEqual(["hover:px-2", "hover:py-1", "flex"]);
	});

	test("keeps every class in a helper call, across arguments", () => {
		const jsx = `const a = ri("sm:flex", cond && "hover:underline");`;
		expect(outermost(jsx, "a.tsx")).toEqual(["sm:flex", "hover:underline"]);
	});

	test("leaves markup alone — nothing there overlaps", () => {
		const html = `<div class="sm:flex hover:bg-red-500 p-4"></div>`;
		expect(outermost(html, "a.html")).toEqual(raw(html, "a.html"));
	});

	test("keeps arbitrary values whole", () => {
		const jsx = `const a = <div className="data-[state=open]:rotate-180 p-[calc(1rem+2px)]" />;`;
		expect(outermost(jsx, "a.tsx")).toEqual(["data-[state=open]:rotate-180", "p-[calc(1rem+2px)]"]);
	});

	test("keeps the first of two candidates over the identical span", () => {
		const duplicate: ClassCandidate[] = [
			{ value: "sm:hover", start: 10, end: 15, origin: "attribute" },
			{ value: "hover", start: 10, end: 15, origin: "attribute" },
		];
		expect(outermostCandidates(duplicate).map((c) => c.value)).toEqual(["sm:hover"]);
	});

	test("returns source order regardless of input order", () => {
		const shuffled: ClassCandidate[] = [
			{ value: "c", start: 20, end: 21, origin: "attribute" },
			{ value: "a", start: 0, end: 1, origin: "attribute" },
			{ value: "b", start: 10, end: 11, origin: "attribute" },
		];
		expect(outermostCandidates(shuffled).map((c) => c.value)).toEqual(["a", "b", "c"]);
	});

	test("is a no-op on zero and one candidate", () => {
		expect(outermostCandidates([])).toEqual([]);
		const one: ClassCandidate[] = [{ value: "flex", start: 0, end: 4, origin: "attribute" }];
		expect(outermostCandidates(one)).toEqual(one);
	});

	test("keeps adjacent spans that merely touch", () => {
		// [0,4) and [4,8) share a boundary and contain nothing.
		const touching: ClassCandidate[] = [
			{ value: "flex", start: 0, end: 4, origin: "attribute" },
			{ value: "p-40", start: 4, end: 8, origin: "attribute" },
		];
		expect(outermostCandidates(touching)).toHaveLength(2);
	});

	test("drops a candidate contained by one that starts earlier and ends level", () => {
		const nested: ClassCandidate[] = [
			{ value: "sm:flex", start: 0, end: 7, origin: "attribute" },
			{ value: "flex", start: 3, end: 7, origin: "attribute" },
		];
		expect(outermostCandidates(nested).map((c) => c.value)).toEqual(["sm:flex"]);
	});
});
