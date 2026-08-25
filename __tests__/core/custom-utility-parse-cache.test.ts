import { describe, expect, it } from "vitest";
import { resolveUtility, extractCustomUtilityRootInfo } from "../../src/utilities/index.js";
import { resolveDirectives, extractDirectives } from "../../src/directives/index.js";

describe("custom utility parsed-body cache", () => {
	it("resolves the same custom utility repeatedly (variant forms) with stable, correct output", () => {
		const theme = resolveDirectives(
			extractDirectives(
				"@utility card { background: red; @apply px-8; &:hover { color: blue; } }",
				[],
			),
		);
		// card / hover:card / md:card all resolve the bare utility — three resolutions.
		const results = [1, 2, 3].map(() => resolveUtility("card", null, false, theme));
		for (const r of results) {
			expect(r).not.toBeNull();
			expect(r!.declarations).toContainEqual({ property: "background", value: "red" });
			expect(r!.declarations.map((d) => d.property)).toContain("padding-inline");
			expect(r!.nested).toEqual([
				{ selector: "&:hover", declarations: [{ property: "color", value: "blue" }], nested: [] },
			]);
		}
		expect(results[1]).toEqual(results[0]);
		expect(results[2]).toEqual(results[0]);
	});

	it("returns fresh result arrays per resolution — mutating one result cannot poison later ones", () => {
		const theme = resolveDirectives(
			extractDirectives("@utility card { color: red; &:hover { color: blue; } }", []),
		);
		const a = resolveUtility("card", null, false, theme)!;
		const b = resolveUtility("card", null, false, theme)!;
		expect(a.declarations).not.toBe(b.declarations);
		expect(a.nested).not.toBe(b.nested);
		a.declarations.push({ property: "outline", value: "none" });
		a.nested!.pop();
		const c = resolveUtility("card", null, false, theme)!;
		expect(c.declarations).toEqual([{ property: "color", value: "red" }]);
		expect(c.nested).toHaveLength(1);
	});

	it("reuses one parsed tree across resolutions: repeated calls share declaration objects", () => {
		const theme = resolveDirectives(extractDirectives("@utility card { color: red; }", []));
		const a = resolveUtility("card", null, false, theme)!;
		const b = resolveUtility("card", null, false, theme)!;
		// The result arrays are fresh copies, but their elements come from the one
		// cached tree — same object identity. Fails if the cache stops deduplicating.
		expect(a.declarations[0]).toBe(b.declarations[0]);
	});

	it("returns fresh applyClasses arrays from root-info extraction — no cache poisoning", () => {
		const body = "color: red; @apply px-8; &:hover { box-shadow: none; @apply py-2; }";
		const first = extractCustomUtilityRootInfo(body);
		const second = extractCustomUtilityRootInfo(body);
		expect(first.properties).toEqual(["color"]);
		expect(first.applyClasses).toEqual(["px-8"]);
		expect(second).toEqual(first);
		expect(second.applyClasses).not.toBe(first.applyClasses);
		// Mutating a returned array must not corrupt the cached tree.
		first.applyClasses.push("junk");
		first.properties.push("junk");
		expect(extractCustomUtilityRootInfo(body)).toEqual({
			properties: ["color"],
			applyClasses: ["px-8"],
		});
	});

	it("does not serve a stale tree when a rebuilt theme carries a changed body", () => {
		const themeA = resolveDirectives(extractDirectives("@utility card { color: red; }", []));
		expect(resolveUtility("card", null, false, themeA)!.declarations).toEqual([
			{ property: "color", value: "red" },
		]);
		// Watch rebuild: same utility name, edited body, fresh theme.
		const themeB = resolveDirectives(extractDirectives("@utility card { color: blue; }", []));
		expect(resolveUtility("card", null, false, themeB)!.declarations).toEqual([
			{ property: "color", value: "blue" },
		]);
		expect(extractCustomUtilityRootInfo("color: blue;").properties).toEqual(["color"]);
	});
});
