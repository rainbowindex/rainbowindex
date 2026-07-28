import { describe, expect, it } from "vitest";
import postcss from "postcss";
import rainbowindex from "../../src/integrations/postcss/index.js";

// The default export is the PostCSS plugin. A common mistake is to drop it into
// Vite's `plugins: []` array, where it has no Vite hooks and would silently do
// nothing. The plugin carries a `name` + `config` facade so Vite fails loudly
// (RI-1606) instead — while remaining a fully valid, inert-guard PostCSS plugin.

describe("Vite-misuse guard on the PostCSS plugin", () => {
	it("exposes a Vite-recognizable name so Vite treats it as a plugin", () => {
		const plugin = rainbowindex() as { name?: unknown };
		expect(plugin.name).toBe("rainbowindex");
	});

	it("throws an actionable RI-1606 when Vite invokes its config hook", () => {
		const plugin = rainbowindex() as { config?: () => unknown };
		expect(typeof plugin.config).toBe("function");
		expect(() => plugin.config?.()).toThrow(/\[RI-1606\]/);
		expect(() => plugin.config?.()).toThrow(/rainbowindex\/vite/);
	});

	it("the guard is inert under PostCSS — normal compilation is unaffected", async () => {
		// `config`/`name` are never dispatched by PostCSS (it only fires visitor
		// keys derived from node names), so a real run must succeed and, notably,
		// a `config:` declaration must NOT trigger the guard.
		const result = await postcss([rainbowindex({ cwd: process.cwd() })]).process(
			`.x { config: 1; transform: none; }`,
			{ from: undefined },
		);
		expect(result.css).toContain("config: 1");
		expect(result.css).toContain("transform: none");
	});
});
