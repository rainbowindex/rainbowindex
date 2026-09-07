/**
 * Docs drift guards.
 *
 * `docs/editor-api.md` is the contract an editor integration codes against, so
 * a capability that exists but is undocumented is as good as missing, and a
 * documented one that no longer exists is worse. These tests read the prose
 * and compare it to the code, so adding a capability without a doc line fails
 * the same gate that runs the unit suite.
 *
 * Counts drift on every utility addition, which is expected; the guards allow
 * 5% so they catch a stale figure rather than nagging about a rounding.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { editorCapabilities } from "../../src/entries/editor.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";
import { enumerateClassNames } from "../../src/utilities/enumerate.js";

const repoFile = (rel: string): string =>
	readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

const EDITOR_API = repoFile("docs/editor-api.md");
const README = repoFile("README.md");

/** The `n%` band the documented counts are allowed to lag the real ones by. */
const TOLERANCE = 0.05;

/** Backtick-quoted items from the "The capability list: …" sentence. */
function documentedCapabilities(markdown: string): string[] {
	const sentence = /The capability list:([^.]*)\./.exec(markdown);
	if (!sentence) throw new Error('docs/editor-api.md: no "The capability list: …" sentence found');
	return [...sentence[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** First number in a sentence matching `pattern`, with thousands separators stripped. */
function documentedCount(markdown: string, pattern: RegExp, label: string): number {
	const match = pattern.exec(markdown);
	if (!match) throw new Error(`${label}: no sentence matched ${pattern}`);
	return Number(match[1].replace(/[,_]/g, ""));
}

function expectWithinTolerance(documented: number, actual: number, what: string): void {
	const drift = Math.abs(documented - actual) / actual;
	expect(
		drift,
		`${what}: docs say ${documented}, code yields ${actual} (${(drift * 100).toFixed(1)}% drift). ` +
			"Update the docs, or the number in this test's message is the one to write.",
	).toBeLessThanOrEqual(TOLERANCE);
}

describe("docs/editor-api.md stays in sync with rainbowindex/editor", () => {
	it("documents exactly the capabilities the entry exports, in order", () => {
		expect(documentedCapabilities(EDITOR_API)).toEqual([...editorCapabilities]);
	});

	it("quotes a class count within 5% of the real enumeration", () => {
		const enumeration = enumerateClassNames(analyzeProjectCSS("").theme);
		expectWithinTolerance(
			documentedCount(EDITOR_API, /The default theme yields ([\d,]+) classes/, "editor-api.md"),
			enumeration.classes.length,
			"editor-api.md class count",
		);
	});

	it("quotes a template-family count within 5% of the real enumeration", () => {
		const enumeration = enumerateClassNames(analyzeProjectCSS("").theme);
		expectWithinTolerance(
			documentedCount(EDITOR_API, /`templates` holds the ([\d,]+) families/, "editor-api.md"),
			enumeration.templates.length,
			"editor-api.md template count",
		);
	});
});

describe("README.md stays in sync", () => {
	it("quotes a completion count within 5% of the real enumeration", () => {
		const enumeration = enumerateClassNames(analyzeProjectCSS("").theme);
		expectWithinTolerance(
			documentedCount(README, /~?([\d,]+) probe-verified completions/, "README.md"),
			enumeration.classes.length,
			"README.md completion count",
		);
	});
});
