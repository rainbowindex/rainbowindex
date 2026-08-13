import { describe, expect, test } from "vitest";
import { analyzeProjectCSS } from "../../src/project/analyze.js";
import { diagnosticFromWarning, severityForCode, warningCode } from "../../src/diagnostics.js";

describe("diagnostic primitives", () => {
	test("warningCode parses the RI prefix", () => {
		expect(warningCode("[RI-1012] whatever")).toBe("RI-1012");
		expect(warningCode("no code here")).toBeNull();
	});

	test("severity follows the documented code ranges", () => {
		expect(severityForCode("RI-0001")).toBe("error");
		expect(severityForCode("RI-2006")).toBe("error");
		expect(severityForCode("RI-1012")).toBe("warning");
		expect(severityForCode("RI-1604")).toBe("warning");
		expect(severityForCode(null)).toBe("warning");
	});

	test("diagnosticFromWarning keeps the message verbatim", () => {
		const diagnostic = diagnosticFromWarning("[RI-1101] bad color", [4, 10]);
		expect(diagnostic).toEqual({
			code: "RI-1101",
			severity: "warning",
			message: "[RI-1101] bad color",
			start: 4,
			end: 10,
		});
		expect(diagnosticFromWarning("[RI-1101] bad color").start).toBeNull();
	});
});

describe("analyzeProjectCSS diagnostics", () => {
	test("clean css yields no diagnostics", () => {
		expect(analyzeProjectCSS("@color { brand: 0.18 330; }").diagnostics).toEqual([]);
	});

	test("messages mirror the warnings array one to one", () => {
		const { warnings, diagnostics } = analyzeProjectCSS(`
@color { brand: banana fruit; }
// stray comment
@spacing { base: banana; }
`);
		expect(warnings.length).toBeGreaterThan(0);
		expect(diagnostics.map((d) => d.message)).toEqual(warnings);
	});

	test("resolver warnings span their source directive", () => {
		const css = `@text { body: 1rem, 1.5; }\n@color { brand: banana fruit; }`;
		const { diagnostics } = analyzeProjectCSS(css);
		const colorProblem = diagnostics.find((d) => d.code?.startsWith("RI-11"));
		expect(colorProblem).toBeDefined();
		expect(colorProblem?.start).not.toBeNull();
		const sliced = css.slice(colorProblem?.start ?? 0, colorProblem?.end ?? 0);
		expect(sliced.startsWith("@color")).toBe(true);
		expect(sliced.endsWith("}")).toBe(true);
	});

	test("line comments span the comment site", () => {
		const css = `@color { brand: 0.18 330; }\n// not css\n`;
		const { diagnostics } = analyzeProjectCSS(css);
		const comment = diagnostics.find((d) => d.code === "RI-1011");
		expect(comment).toBeDefined();
		expect(css.slice(comment?.start ?? 0, comment?.end ?? 0)).toBe("//");
	});

	test("unparseable directives span the at-rule name", () => {
		const css = `@color { unclosed`;
		const { diagnostics } = analyzeProjectCSS(css);
		const parseError = diagnostics.find((d) => d.code === "RI-1012");
		expect(parseError).toBeDefined();
		expect(css.slice(parseError?.start ?? 0, parseError?.end ?? 0)).toBe("@color");
	});

	test("directives nested in standard at-rules span the nested directive", () => {
		const css = `@media (min-width: 40rem) {\n\t@color { brand: 0.18 330; }\n}`;
		const { diagnostics } = analyzeProjectCSS(css);
		const nested = diagnostics.find((d) => d.code === "RI-1036");
		expect(nested).toBeDefined();
		expect(css.slice(nested?.start ?? 0, nested?.end ?? 0)).toBe("@color");
	});

	test("identical warnings from different directives keep their own spans", () => {
		// The resolver pushes without dedup and its message templates embed no
		// position, so two blocks with the same invalid entry produce two
		// identical messages — each diagnostic must still span its own block.
		const css = `@color { ba$d: 0.1 30; }\n@color { ba$d: 0.1 30; }`;
		const { diagnostics } = analyzeProjectCSS(css);
		const dupes = diagnostics.filter((d) => d.code === "RI-1035");
		expect(dupes).toHaveLength(2);
		expect(dupes[0].message).toBe(dupes[1].message);
		expect(dupes[0].start).not.toBe(dupes[1].start);
		for (const dupe of dupes) {
			expect(css.slice(dupe.start ?? 0, dupe.end ?? 0).startsWith("@color")).toBe(true);
		}
		expect(dupes[1].start ?? 0).toBeGreaterThan(dupes[0].end ?? 0);
	});

	test("post-loop validations stay unattributed but structured", () => {
		// A circular alias is detected after the directive loop — no span, but
		// still a structured diagnostic.
		const css = `@color { a: b; b: a; }`;
		const { diagnostics, warnings } = analyzeProjectCSS(css);
		expect(diagnostics.map((d) => d.message)).toEqual(warnings);
		const cycle = diagnostics.find((d) => d.code === "RI-1107");
		if (cycle) {
			expect(cycle.severity).toBe("warning");
		}
	});
});
