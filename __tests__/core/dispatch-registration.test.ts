import { describe, expect, test } from "vitest";
import { PREFIX_DISPATCH } from "../../src/utilities/index.js";
import { EFFECTS_DISPATCH_ROOTS, effectsGenerator } from "../../src/utilities/effects/index.js";
import { LAYOUT_DISPATCH_ROOTS, layoutGenerator } from "../../src/utilities/layout.js";

/**
 * Drift guard between the generators' internal first-segment dispatch tables
 * and the top-level PREFIX_DISPATCH registration in utilities/index.ts. A
 * dispatch key missing from PREFIX_DISPATCH still resolves (the fallback loop
 * scans every generator) but silently degrades to a multi-probe slow path —
 * this suite turns the next unregistered key into a CI failure instead.
 */
describe("generator dispatch keys are registered in PREFIX_DISPATCH", () => {
	test("every effects dispatch root reaches effectsGenerator", () => {
		const missing = EFFECTS_DISPATCH_ROOTS.filter((root) => {
			// Bare "inset" belongs to spacing; the effects entry serves the
			// multi-segment inset-shadow/inset-ring keys, asserted below.
			if (root === "inset") return false;
			return !(PREFIX_DISPATCH.get(root) ?? []).includes(effectsGenerator);
		});
		expect(missing, `effects roots not registered: ${missing.join(", ")}`).toEqual([]);
		for (const key of ["inset-shadow", "inset-ring"]) {
			expect(PREFIX_DISPATCH.get(key) ?? [], `${key} bucket`).toContain(effectsGenerator);
		}
	});

	test("every layout dispatch root reaches layoutGenerator", () => {
		const missing = LAYOUT_DISPATCH_ROOTS.filter((root) => {
			// position/anchor only match the /-separated @anchor forms' companions;
			// the registered roots are the full position-area/anchor-scope keys,
			// asserted below.
			if (root === "position" || root === "anchor") return false;
			return !(PREFIX_DISPATCH.get(root) ?? []).includes(layoutGenerator);
		});
		expect(missing, `layout roots not registered: ${missing.join(", ")}`).toEqual([]);
		for (const key of ["position-area", "anchor-scope"]) {
			expect(PREFIX_DISPATCH.get(key) ?? [], `${key} bucket`).toContain(layoutGenerator);
		}
	});
});
