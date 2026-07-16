import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";
import { MAX_WARNINGS, pushWarningsDeduped } from "../../src/warnings.js";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const WARNINGS_FILE = join(SRC_ROOT, "warnings.ts");

/** Codes documented in the warnings.ts header that are deliberately never emitted. */
const RESERVED_SILENT_CODES = new Set(["1001"]);

function collectEmittedCodes(): Set<string> {
	const codes = new Set<string>();
	const files = globSync(["**/*.ts"], { cwd: SRC_ROOT, absolute: true });
	const codeRe = /\[RI-(\d{4})\]/g;
	for (const file of files) {
		let src = readFileSync(file, "utf-8");
		// In warnings.ts itself, skip the header JSDoc block so the documented
		// codes don't bleed into the emitted set — only count the actual emitters.
		if (file === WARNINGS_FILE) {
			const end = src.indexOf("*/");
			if (end !== -1) src = src.slice(end + 2);
		}
		for (const match of src.matchAll(codeRe)) codes.add(match[1]);
	}
	return codes;
}

function collectDocumentedCodes(): Set<string> {
	const docBlock = readFileSync(WARNINGS_FILE, "utf-8").split("*/")[0];
	const codes = new Set<string>();
	// Header entries look like:  *   1002  Description...
	const docRe = /^\s*\*\s+(\d{4})\s+/gm;
	for (const match of docBlock.matchAll(docRe)) codes.add(match[1]);
	return codes;
}

describe("pushWarningsDeduped", () => {
	it("deduplicates exact duplicate warnings", () => {
		const target = ["[RI-1004] Unknown variant: foo"];
		pushWarningsDeduped(
			target,
			["[RI-1004] Unknown variant: foo", "[RI-1004] Unknown variant: foo"],
			new Set(target),
		);
		expect(target).toEqual(["[RI-1004] Unknown variant: foo"]);
	});

	it("uses the provided seen set when supplied", () => {
		const target = ["[RI-1004] Existing warning"];
		const seen = new Set(target);
		pushWarningsDeduped(target, ["[RI-1004] Existing warning", "[RI-1005] New warning"], seen);
		expect(target).toEqual(
			["[RI-1004] Existing warning", "[RI-1005] New warning"],
			new Set(target),
		);
		expect(seen.has("[RI-1005] New warning")).toBe(true);
	});

	it("adds a hard-cap summary warning once the max warning budget is reached", () => {
		const target = Array.from(
			{ length: MAX_WARNINGS - 1 },
			(_, i) => `[RI-1004] Existing warning ${i}`,
		);
		pushWarningsDeduped(
			target,
			["[RI-1005] Final warning", "[RI-1006] Dropped warning"],
			new Set(target),
		);
		expect(target).toHaveLength(MAX_WARNINGS);
		expect(target.at(-1)).toBe(
			`[RI-1013] Warning limit reached (${MAX_WARNINGS}). Further warnings suppressed.`,
		);
	});

	it("caps low-severity warnings earlier and adds a truncation warning", () => {
		const target = Array.from(
			{ length: MAX_WARNINGS - 20 - 1 },
			(_, i) => `[RI-1004] Existing low severity ${i}`,
		);
		pushWarningsDeduped(target, ["[RI-1101] Another low severity warning"], new Set(target));
		expect(target.at(-1)).toBe(
			"[RI-1013] Low-severity warning budget exhausted. Some informational warnings suppressed to reserve capacity for critical issues.",
		);
	});

	it("still allows high-severity warnings after the low-severity budget is exhausted", () => {
		const target = Array.from(
			{ length: MAX_WARNINGS - 20 - 1 },
			(_, i) => `[RI-1004] Existing low severity ${i}`,
		);
		pushWarningsDeduped(
			target,
			[
				"[RI-2001] High severity compile warning",
				"[RI-2002] Another high severity compile warning",
			],
			new Set(target),
		);
		expect(target).toContain("[RI-2001] High severity compile warning");
		expect(target).toContain("[RI-2002] Another high severity compile warning");
	});

	it("does not append the low-severity truncation warning more than once", () => {
		const truncMsg =
			"[RI-1013] Low-severity warning budget exhausted. Some informational warnings suppressed to reserve capacity for critical issues.";
		const target = Array.from(
			{ length: MAX_WARNINGS - 20 - 1 },
			(_, i) => `[RI-1004] Existing low severity ${i}`,
		);
		pushWarningsDeduped(target, ["[RI-1101] first"], new Set(target));
		pushWarningsDeduped(target, ["[RI-1102] second"], new Set(target));
		expect(target.filter((w) => w === truncMsg)).toHaveLength(1);
	});

	it("does not append the hard-cap summary warning more than once", () => {
		const capMsg = `[RI-1013] Warning limit reached (${MAX_WARNINGS}). Further warnings suppressed.`;
		const target = Array.from(
			{ length: MAX_WARNINGS - 1 },
			(_, i) => `[RI-1004] Existing warning ${i}`,
		);
		pushWarningsDeduped(target, ["[RI-1005] first"], new Set(target));
		pushWarningsDeduped(target, ["[RI-1006] second"], new Set(target));
		expect(target.filter((w) => w === capMsg)).toHaveLength(1);
	});
});

describe("RI-NNNN documentation parity", () => {
	const emitted = collectEmittedCodes();
	const documented = collectDocumentedCodes();

	it("every code emitted in src/ appears in the warnings.ts header", () => {
		const undocumented = [...emitted].filter((c) => !documented.has(c)).sort();
		expect(undocumented).toEqual([]);
	});

	it("every code documented in warnings.ts is emitted somewhere in src/", () => {
		const unused = [...documented]
			.filter((c) => !emitted.has(c) && !RESERVED_SILENT_CODES.has(c))
			.sort();
		expect(unused).toEqual([]);
	});
});
