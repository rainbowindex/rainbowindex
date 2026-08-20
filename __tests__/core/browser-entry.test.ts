import { describe, expect, test, vi } from "vitest";
import browserDefault, { defaultTheme, ri, safelist } from "../../src/entries/browser.js";

describe("rainbowindex/browser entry", () => {
	test("re-exports the client-safe surface", () => {
		expect(defaultTheme).toBeDefined();
		expect(safelist("flex", false, "px-4")).toBe("flex px-4");
		expect(ri("px-2 py-1", "p-4")).toBe("p-4");
	});

	test("default export fails loudly instead of resolving the PostCSS plugin", () => {
		// Browser bundles must not silently no-op when someone does
		// `import rainbowindex from "rainbowindex"` in client code.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(() => browserDefault()).toThrow(/RI-2003/);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("RI-2003"));
		warn.mockRestore();
	});
});
