import { describe, expect, it } from "vitest";
import { validateGlobPattern } from "../../src/scanner/glob-utils.js";

describe("validateGlobPattern", () => {
	it("rejects absolute POSIX paths", () => {
		expect(validateGlobPattern("/Users/me/src/**/*.tsx")).toContain("must be relative");
	});

	it("rejects absolute Windows paths", () => {
		expect(validateGlobPattern("C:\\repo\\src\\**\\*.tsx")).toContain("must be relative");
	});

	it("rejects any parent traversal with ..", () => {
		expect(validateGlobPattern("../src/**/*.tsx")).toContain("..");
		expect(validateGlobPattern("../src/**/*.tsx")).toContain("..");
		expect(validateGlobPattern("..\\..\\src\\**\\*.tsx")).toContain("..");
	});

	it("allows relative patterns without parent traversal", () => {
		expect(validateGlobPattern("./src/**/*.tsx")).toBeNull();
		expect(validateGlobPattern("src/**/*.tsx")).toBeNull();
	});
});
