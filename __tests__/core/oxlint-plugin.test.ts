import { describe, expect, it, vi } from "vitest";
import plugin, { preferRiRule } from "../../src/integrations/oxlint.js";

/** Drive the rule over one import specifier and return every reported message. */
function lintImport(specifier: string): string[] {
	const messages: string[] = [];
	const visitor = preferRiRule.create({
		report: ({ message }) => {
			messages.push(message);
		},
	});
	visitor.ImportDeclaration({ source: { value: specifier } });
	return messages;
}

describe("oxlint plugin", () => {
	it("registers prefer-ri under the rainbowindex namespace", () => {
		expect(plugin.meta.name).toBe("rainbowindex");
		expect(Object.keys(plugin.rules)).toEqual(["prefer-ri"]);
		expect(plugin.rules["prefer-ri"]).toBe(preferRiRule);
	});

	it.each(["clsx", "classnames", "tailwind-merge"])("reports an import of %s", (specifier) => {
		const messages = lintImport(specifier);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toContain(`instead of "${specifier}"`);
		expect(messages[0]).toContain('from "rainbowindex"');
	});

	it("reports a subpath import of a replaced package", () => {
		expect(lintImport("clsx/lite")).toHaveLength(1);
	});

	it("leaves every other import alone", () => {
		for (const specifier of ["rainbowindex", "react", "./styles.css", "@scope/clsx", "cva"]) {
			expect(lintImport(specifier)).toEqual([]);
		}
	});

	it("passes the reported node through so Oxlint can place the diagnostic", () => {
		const report = vi.fn();
		const node = { source: { value: "clsx" } };
		preferRiRule.create({ report }).ImportDeclaration(node);
		expect(report).toHaveBeenCalledWith(expect.objectContaining({ node }));
	});
});
