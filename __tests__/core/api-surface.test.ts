import { describe, expect, it } from "vitest";

describe("Root API surface", () => {
	it("default export is a PostCSS plugin creator", async () => {
		const mod = await import("../../src/entries/index.js");
		expect(typeof mod.default).toBe("function");
	});

	it("exports createCompiler", async () => {
		const mod = await import("../../src/entries/index.js");
		expect(typeof mod.createCompiler).toBe("function");
	});

	it("exports compileProject", async () => {
		const mod = await import("../../src/entries/index.js");
		expect(typeof mod.compileProject).toBe("function");
	});

	it("does not export removed framework helpers", async () => {
		const mod = await import("../../src/entries/index.js");
		expect("listProjectPresets" in mod).toBe(false);
		expect("resolveProjectPreset" in mod).toBe(false);
		expect("detectProjectPresetName" in mod).toBe(false);
		expect("runFrameworkRunner" in mod).toBe(false);
	});
});
