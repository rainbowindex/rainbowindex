/**
 * Emission ↔ claim parity, machine-checked over the whole enumeration
 * universe: every CSS declaration property a built-in utility emits must be
 * covered by the properties ri() claims for that same class. The shared
 * prefix→property maps in merge/props.ts pin the literal tables, but
 * dual-mode entries, slot vars, ~namespaced claims, and static tables are
 * mirrored by hand — this test turns that mirror discipline into an
 * invariant: a generator emitting a property the merge does not claim shows
 * up here instead of as a silent wrong merge.
 *
 * Coverage rules, in order:
 *  1. claims === null is exempt by design — the merge tables only include
 *     conflict-plausible utilities (see merge/props.ts).
 *  2. A claim covers its own property; `~family:prop` claims cover `prop`
 *     (the ~namespace only partitions merge keys, not CSS meaning).
 *  3. A claimed shorthand covers its OVERRIDES longhands — mergeUncached
 *     expands claims through OVERRIDES, so claiming `outline` claims
 *     outline-width/style/color too.
 *  4. An emitted shorthand is covered when every one of its OVERRIDES
 *     longhands is claimed (claiming all longhands is strictly more precise
 *     than claiming the shorthand, e.g. outline-hidden).
 *  5. Anything else must appear in the PARITY_EXCEPTIONS ledger below.
 */

import { describe, expect, test } from "vitest";
import { createThemeSnapshot } from "../../src/engine/index.js";
import { resolverFor } from "../../src/merge/context.js";
import { OVERRIDES } from "../../src/merge/props.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";
import { enumerateClassNames } from "../../src/utilities/enumerate.js";
import { resolveUtilityDeclarations } from "../../src/utilities/index.js";
import { parseUtility } from "../../src/utilities/parser.js";

interface ParityException {
	/** Emitted declaration property the claims deliberately do not cover. */
	property: string;
	/** Classes allowed to emit that property unclaimed. */
	classes: RegExp;
	reason: string;
}

/**
 * The explicit ledger of deliberate emission/claim asymmetries. Every entry
 * must be exercised by the walk (asserted below), so removing the asymmetry
 * fails the test until the row is deleted — the ledger cannot go stale.
 */
const PARITY_EXCEPTIONS: readonly ParityException[] = [
	{
		property: "--ri-scale-x",
		classes: /^scale-\d/,
		reason:
			"bare scale-{n} writes both axis slot vars but claims only `scale`; the axis vars are claimed by scale-x-*/scale-y-* alone, so an axis tweak is never dropped by a bare scale",
	},
	{
		property: "--ri-scale-y",
		classes: /^scale-\d/,
		reason: "see --ri-scale-x — same deliberate axis-var asymmetry",
	},
	{
		property: "--ri-space-x-reverse",
		classes: /^space-x-/,
		reason:
			"space-x-{n}'s reverse:0 is a defensive reset, not a claim — only space-x-reverse claims ~space:--ri-space-x-reverse, so `space-x-reverse space-x-4` keeps both classes",
	},
	{
		property: "--ri-space-y-reverse",
		classes: /^space-y-/,
		reason: "see --ri-space-x-reverse — same deliberate reset-vs-claim split",
	},
	{
		property: "stroke-width",
		classes: /^stroke-\d/,
		reason:
			"stroke-{n} emits stroke-width but the merge claims `stroke` (the color property) — width and color forms share one claim today; known drift in merge/props.ts, documented here until fixed there",
	},
];

const defaultTheme = analyzeProjectCSS("").theme;
const customTheme = analyzeProjectCSS(`
@color { brand: 0.18 330; }
@utility card { background: red; padding: 1rem; }
@utility glow-* { box-shadow: 0 0 8px; }
`).theme;

/** Strip the `~family:` merge-key namespace off a claim. */
function claimProperty(claim: string): string {
	if (claim.charCodeAt(0) !== 126 /* '~' */) return claim;
	const colon = claim.indexOf(":");
	return colon === -1 ? claim : claim.slice(colon + 1);
}

describe("emitted declaration properties are claimed by resolveProps()", () => {
	test.each([
		["default", defaultTheme],
		["custom", customTheme],
	] as const)("%s theme", (_label, theme) => {
		const resolveProps = resolverFor(createThemeSnapshot(theme));
		const { classes, templates } = enumerateClassNames(theme);
		// The open-ended families are represented by their template examples.
		const names = [...classes.map((c) => c.name), ...templates.map((t) => t.example)];

		// Probe warnings are expected for over-approximated candidates — the sink
		// keeps generators from routing them to the dev console.
		const probeWarnings: string[] = [];
		const violations: string[] = [];
		const usedExceptions = new Set<ParityException>();
		let checked = 0;

		for (const name of names) {
			const result = resolveUtilityDeclarations(parseUtility(name), theme, probeWarnings);
			if (!result) continue;
			const claims = resolveProps(name);
			if (claims === null) continue; // rule 1: not conflict-plausible
			checked++;

			// Rules 2+3: claimed properties plus their OVERRIDES expansions
			// (OVERRIDES is already the transitive closure).
			const claimed = new Set<string>();
			for (const claim of claims) {
				const prop = claimProperty(claim);
				claimed.add(prop);
				for (const longhand of OVERRIDES[prop] ?? []) claimed.add(longhand);
			}

			for (const decl of result.declarations) {
				if (claimed.has(decl.property)) continue;
				// Rule 4: an emitted shorthand whose longhands are all claimed.
				if (OVERRIDES[decl.property]?.every((lh) => claimed.has(lh))) continue;
				// Rule 5: the exceptions ledger.
				const exception = PARITY_EXCEPTIONS.find(
					(e) => e.property === decl.property && e.classes.test(name),
				);
				if (exception) {
					usedExceptions.add(exception);
					continue;
				}
				violations.push(`${name} emits ${decl.property}, claims [${claims.join(", ")}]`);
			}
		}

		expect(
			violations,
			"every emitted declaration property must be claimed (or ledgered above)",
		).toEqual([]);
		// The walk must stay meaningful — a broken enumeration or an all-null
		// resolver would otherwise pass vacuously.
		expect(checked).toBeGreaterThan(3000);
		// Self-cleaning ledger: every exception row must still be exercised.
		const stale = PARITY_EXCEPTIONS.filter((e) => !usedExceptions.has(e));
		expect(
			stale.map((e) => e.property),
			"stale PARITY_EXCEPTIONS rows — the asymmetry no longer exists, delete them",
		).toEqual([]);
	});
});
