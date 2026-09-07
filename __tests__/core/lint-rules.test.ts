/**
 * `no-unknown-class` and `no-conflicting-classes`, driven by ESLint's own
 * RuleTester.
 *
 * Rolling a fake linter context would test the rule against my idea of the
 * API. RuleTester runs the real one: it parses the source, walks it, asserts
 * the reported *locations* land where they are claimed to, and applies every
 * suggestion's fix and checks the output. That is what makes "the rule
 * underlines the typo, not the line" an assertion rather than a hope.
 *
 * Oxlint reads the same rule objects through `rainbowindex/oxlint`; only the
 * packaging differs, and a separate test pins that they are the same objects.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuleTester } from "eslint";
import { afterAll, describe, expect, it } from "vitest";
import oxlintPlugin from "../../src/integrations/oxlint.js";
import eslintPlugin, { rules } from "../../src/integrations/lint/index.js";
import {
	noConflictingClassesRule,
	noUnknownClassRule,
	type LintRule,
} from "../../src/integrations/lint/rules.js";
import { clearSessionCache, findCSSEntry } from "../../src/integrations/lint/theme.js";

// ---------------------------------------------------------------------------
// A project on disk, because that is what the rules read
// ---------------------------------------------------------------------------

const project = mkdtempSync(join(tmpdir(), "ri-lint-"));
writeFileSync(
	join(project, "index.css"),
	`@import "rainbowindex";\n@color { brand: 0.18 330; }\n@breakpoint { sm: 40rem; }\n`,
);

/** A directory with a stylesheet that activates nothing. */
const foreign = mkdtempSync(join(tmpdir(), "ri-lint-none-"));
writeFileSync(join(foreign, "index.css"), `.button { color: red; }\n`);

afterAll(() => {
	clearSessionCache();
});

// Without this, RuleTester falls back to running every case inline at import
// time: the first mismatch throws during collection, the file reports "no
// tests", and the message never says which case failed.
RuleTester.describe = describe as unknown as typeof RuleTester.describe;
RuleTester.it = it as unknown as typeof RuleTester.it;
RuleTester.itOnly = it.only as unknown as typeof RuleTester.itOnly;

const tester = new RuleTester({
	languageOptions: {
		ecmaVersion: 2022,
		sourceType: "module",
		parserOptions: { ecmaFeatures: { jsx: true } },
	},
});

/** RuleTester types describe ESLint's rule shape; ours is the shared subset. */
const asESLintRule = (rule: LintRule) => rule as unknown as Parameters<typeof tester.run>[1];
const options = [{ cwd: project }];

// ---------------------------------------------------------------------------
// no-unknown-class
// ---------------------------------------------------------------------------

tester.run("no-unknown-class", asESLintRule(noUnknownClassRule), {
	valid: [
		{ code: `const a = <div className="flex p-4 bg-brand-500" />;`, options },
		{ code: `const a = <div className="sm:flex hover:bg-brand-600" />;`, options },
		// A word in prose is not a class position, and neither is a bare
		// identifier the scanner could not attribute to one.
		{ code: `const message = "felx is a typo people make";`, options },
		{ code: `const a = <p>felx</p>;`, options },
		// No theme to check against: a repository that does not use Rainbow
		// Index has to lint clean, not fail.
		{ code: `const a = <div className="felx" />;`, options: [{ cwd: foreign }] },
	],
	invalid: [
		{
			code: `const a = <div className="flex felx" />;`,
			options,
			errors: [
				{
					message: 'Unknown utility "felx" — "felx" compiles to nothing. Did you mean "flex"?',
					line: 1,
					column: 32,
					endColumn: 36,
					suggestions: [
						{
							desc: 'Replace "felx" with "flex"',
							output: `const a = <div className="flex flex" />;`,
						},
					],
				},
			],
		},
		{
			// The offender is the variant, and only the variant gets rewritten.
			code: `const a = <div className="hovr:flex" />;`,
			options,
			errors: [
				{
					message:
						'Unknown variant "hovr" — "hovr:flex" compiles to nothing. Did you mean "hover"?',
					suggestions: [
						{
							desc: 'Replace "hovr" with "hover"',
							output: `const a = <div className="hover:flex" />;`,
						},
					],
				},
			],
		},
		{
			// A theme-defined class is unknown when the theme does not define it.
			code: `const a = ri("bg-ocean-500");`,
			options,
			errors: 1,
		},
	],
});

// ---------------------------------------------------------------------------
// no-conflicting-classes
// ---------------------------------------------------------------------------

tester.run("no-conflicting-classes", asESLintRule(noConflictingClassesRule), {
	valid: [
		{ code: `const a = <div className="flex p-4 bg-brand-500" />;`, options },
		// Different properties, no conflict.
		{ code: `const a = <div className="px-2 py-4" />;`, options },
		// Separate arguments are the whole point of ri(): the later one is
		// meant to win, and saying so is not a finding.
		{ code: `const a = ri("px-2", "px-4");`, options },
		{ code: `const a = ri("px-2", cond && "px-4");`, options },
		// Two attributes on two elements are two class strings.
		{ code: `const a = <><i className="p-2" /><b className="p-4" /></>;`, options },
		{ code: `const a = <div className="felx flex" />;`, options: [{ cwd: foreign }] },
	],
	invalid: [
		{
			code: `const a = <div className="px-2 px-4" />;`,
			options,
			errors: [
				{
					message: '"px-2" is overridden by "px-4" in the same class string, so it has no effect.',
					line: 1,
					column: 27,
					endColumn: 31,
				},
			],
		},
		{
			// A shorthand later in the string swallows both earlier axes.
			code: `const a = ri("px-2 py-1 p-4");`,
			options,
			errors: 2,
		},
		{
			code: `const a = <div className="flex flex" />;`,
			options,
			errors: 1,
		},
	],
});

// ---------------------------------------------------------------------------
// Packaging
// ---------------------------------------------------------------------------

describe("lint rule packaging", () => {
	it("exposes the same rule objects from both entries", () => {
		expect(eslintPlugin.rules["no-unknown-class"]).toBe(noUnknownClassRule);
		expect(eslintPlugin.rules["no-conflicting-classes"]).toBe(noConflictingClassesRule);
		expect(oxlintPlugin.rules["no-unknown-class"]).toBe(noUnknownClassRule);
		expect(oxlintPlugin.rules["no-conflicting-classes"]).toBe(noConflictingClassesRule);
	});

	it("keeps prefer-ri on the oxlint plugin only", () => {
		expect(Object.keys(oxlintPlugin.rules).sort()).toEqual([
			"no-conflicting-classes",
			"no-unknown-class",
			"prefer-ri",
		]);
		expect(Object.keys(rules).sort()).toEqual(["no-conflicting-classes", "no-unknown-class"]);
	});

	it("names itself so flat config can spell the rule ids", () => {
		expect(eslintPlugin.meta.name).toBe("rainbowindex");
	});
});

describe("finding the CSS entry", () => {
	it("finds a stylesheet that activates Rainbow Index", () => {
		expect(findCSSEntry(project)).toBe(join(project, "index.css"));
	});

	it("ignores a stylesheet that activates nothing", () => {
		expect(findCSSEntry(foreign)).toBeNull();
	});

	it("returns null when there is no candidate at all", () => {
		expect(findCSSEntry(mkdtempSync(join(tmpdir(), "ri-lint-empty-")))).toBeNull();
	});
});
