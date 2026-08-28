import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	extractClassCandidates,
	extractClassesFromSource,
} from "../../src/scanner/class-extraction.js";

// ---------------------------------------------------------------------------
// SVG geometry attributes are not class lists
// ---------------------------------------------------------------------------
// Regression guard for the v0.5.0 line-length bump (2,000 -> 10,000). The
// grammar never changed, but raising the guard let a 4,675-character inline
// `d="…"` line reach the whole-file scan, where SVG path data tokenizes into
// hundreds of digit fragments — 33 candidates became 845. They match no
// utility and carry the "plain" origin editors skip, so nothing rendered
// wrong; each one just cost a compile lookup and a cache entry on every build
// of every file with an inline icon.

const LOGO_TSX = readFileSync(join(import.meta.dirname, "fixtures/logo.tsx.txt"), "utf8");

describe("inline SVG path data", () => {
	const input = { path: "/tmp/src/components/icons/logo.tsx", content: LOGO_TSX };

	test("does not inflate the candidate count", () => {
		const candidates = extractClassCandidates(input);
		// 33 pre-regression, 36 now: the same tokens plus three the old
		// line-length guard used to drop with the rest of the long line. The
		// bound is what matters — 845 is the failure being guarded against.
		expect(candidates.length).toBeGreaterThan(25);
		expect(candidates.length).toBeLessThan(45);
	});

	test("emits no path-data fragments", () => {
		const values = extractClassCandidates(input).map((candidate) => candidate.value);
		expect(values).not.toContain("9.17-57.2");
		expect(values).not.toContain("40c-.35-1.1-1.04-2.03-1.98-2.67-.86-.59-1.87-.9-2.92-.9-.66");
		expect(values).not.toContain("2.56c-1.76.19-3.28");
		// No candidate may be a bare number sequence carved out of path data.
		// The viewBox numbers are the deliberate exception: they predate the
		// regression and cost three entries, not eight hundred.
		const numeric = values.filter((value) => /^[\d.]+[-,]/.test(value));
		expect(numeric).toEqual([]);
	});

	test("keeps every real class in the file", () => {
		const classes = extractClassesFromSource(input);
		for (const cls of ["fill-[#222]", "fill-[#fff]", "fill-foreground", "fill-accent"]) {
			expect(classes).toContain(cls);
		}
	});
});

describe("blanking preserves the rest of the grammar", () => {
	// Every value shape the mask could plausibly break, on a line that also
	// carries path data — negatives, fractions, decimals, arbitrary values,
	// variants, and arbitrary properties.
	const CLASSES = [
		"-mt-4",
		"w-1/2",
		"p-1.5",
		"hover:-inset-2.5",
		"[color:red]",
		"2xl:gap-0.5",
		"mask-[url(#a)]",
		"bg-[url('a_b')]",
	];

	test("real classes survive alongside a masked d attribute", () => {
		const content = `<path d="M9.9,9.9c-.3-.1-.5-.2-.7-.3" className="${CLASSES.join(" ")}" />`;
		const classes = extractClassesFromSource({ path: "/tmp/src/icon.tsx", content });
		for (const cls of CLASSES) expect(classes).toContain(cls);
	});

	test("polygon points are blanked too", () => {
		const content = `<polygon points="0,0 100.5,50.25 3.7-2.1" class="gap-2" />`;
		const classes = extractClassesFromSource({ path: "/tmp/src/icon.html", content });
		expect(classes).toContain("gap-2");
		expect(classes).not.toContain("100.5,50.25");
		expect(classes).not.toContain("3.7-2.1");
	});

	test("attributes merely ending in d are untouched", () => {
		const content = `<div id="p-4" data-d="m-2" class="gap-3"></div>`;
		const classes = extractClassesFromSource({ path: "/tmp/src/icon.html", content });
		expect(classes).toContain("p-4");
		expect(classes).toContain("gap-3");
	});

	test("d={expr} bindings still yield their classes", () => {
		const content = `const icon = <path d={cn("stroke-1")} />;`;
		const classes = extractClassesFromSource({ path: "/tmp/src/icon.tsx", content });
		expect(classes).toContain("stroke-1");
	});

	test("candidate spans still point at the original text", () => {
		const content = `<path d="M9.9,9.9c-.3-.1" className="fill-accent" />`;
		const input = { path: "/tmp/src/icon.tsx", content };
		for (const candidate of extractClassCandidates(input)) {
			expect(content.slice(candidate.start, candidate.end)).toBe(
				candidate.groupPrefix ? candidate.value.split(":").pop() : candidate.value,
			);
		}
	});
});
