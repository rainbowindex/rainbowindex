/**
 * Regression tests for cache-key collision prevention, RI-1002 warning
 * propagation, and audit-identified edge cases.
 */

import { describe, expect, it } from "vitest";
import { createCompiler } from "../../src/engine/index.js";
import { resolveDirectives } from "../../src/directives/index.js";
import { spacingLookup } from "../../src/utilities/index.js";
import { validateGlobPattern } from "../../src/scanner/glob-utils.js";
import { getCachedFontOutput } from "../../src/assembly.js";
import {
	type FontSlot,
	createFontFace,
	createFontSlot,
} from "../../src/integrations/font-providers/index.js";

const theme = resolveDirectives([]);
const compile = (classNames: string[], activeTheme = theme) =>
	createCompiler().compile(classNames, activeTheme);

// ---------------------------------------------------------------------------
// RI-1002 warning propagation
// ---------------------------------------------------------------------------

describe("RI-1002 arbitrary utility warnings", () => {
	it("warns for unresolved arbitrary utility via compile()", () => {
		// Use a prefix that doesn't match any generator to trigger the unresolved warning
		const result = compile(["xyzunknown-[notavalue]"], theme);
		const ri1002 = result.warnings.filter((w) => w.includes("RI-1002"));
		expect(ri1002.length).toBeGreaterThanOrEqual(1);
		expect(ri1002[0]).toContain("xyzunknown-[notavalue]");
	});

	it("warns for unresolved arbitrary utility via createCompiler()", () => {
		const compiler = createCompiler();
		const result = compiler.compile(["xyzunknown-[notavalue]"], theme);
		const ri1002 = result.warnings.filter((w) => w.includes("RI-1002"));
		expect(ri1002.length).toBeGreaterThanOrEqual(1);
	});

	it("does not warn for valid arbitrary values", () => {
		const result = compile(["p-[20px]"], theme);
		expect(result.warnings.filter((w) => w.includes("RI-1002"))).toHaveLength(0);
	});

	it("does not warn for attribute-selector-like brackets", () => {
		const result = compile(["data-[state=active]"], theme);
		expect(result.warnings.filter((w) => w.includes("RI-1002"))).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Font output cache-key collision prevention
// ---------------------------------------------------------------------------

describe("font output cache-key collisions", () => {
	const makeSlot = (overrides: Partial<FontSlot> = {}): FontSlot =>
		createFontSlot({ slot: "sans", family: "Inter", kind: "google", ...overrides });

	const withFaceWeight = (weight: string): FontSlot =>
		createFontSlot({
			slot: "sans",
			family: "Inter",
			kind: "google",
			faces: [createFontFace({ provider: "google", weight })],
		});

	it("different weights produce different cache entries", () => {
		const cache = new Map();
		// Cache key must cover nested faces[] — a key allowlist would strip them.
		const out400 = getCachedFontOutput(withFaceWeight("400"), cache);
		const out700 = getCachedFontOutput(withFaceWeight("700"), cache);
		expect(out400).not.toBe(out700);
	});

	it("different families produce different cache entries", () => {
		const cache = new Map();
		const outInter = getCachedFontOutput(makeSlot({ family: "Inter" }), cache);
		const outRoboto = getCachedFontOutput(makeSlot({ family: "Roboto" }), cache);
		expect(outInter).not.toBe(outRoboto);
	});

	it("same config returns cached result", () => {
		const cache = new Map();
		const slot = makeSlot();
		const out1 = getCachedFontOutput(slot, cache);
		const out2 = getCachedFontOutput(slot, cache);
		expect(out1).toBe(out2);
	});

	it("different slots produce different cache entries", () => {
		const cache = new Map();
		const outSans = getCachedFontOutput(makeSlot({ slot: "sans" }), cache);
		const outMono = getCachedFontOutput(makeSlot({ slot: "mono" }), cache);
		expect(outSans).not.toBe(outMono);
	});
});

// ---------------------------------------------------------------------------
// spacingLookup input validation
// ---------------------------------------------------------------------------

describe("spacingLookup rejects non-decimal inputs", () => {
	it("rejects hex notation", () => {
		expect(spacingLookup("0x1F")).toBeNull();
	});

	it("rejects scientific notation", () => {
		expect(spacingLookup("1e3")).toBeNull();
	});

	it("rejects Infinity", () => {
		expect(spacingLookup("Infinity")).toBeNull();
	});

	it("rejects negative sign prefix", () => {
		// Negative is handled via the `negative` parameter, not string prefix
		expect(spacingLookup("-4")).toBeNull();
	});

	it("accepts valid decimal values", () => {
		expect(spacingLookup("4")).toBe("calc(4 * var(--spacing))");
		expect(spacingLookup("1_5")).toBe("calc(1.5 * var(--spacing))");
		expect(spacingLookup("0")).toBe("0px");
	});
});

// ---------------------------------------------------------------------------
// Glob pattern traversal rejection
// ---------------------------------------------------------------------------

describe("glob pattern validation rejects parent traversal", () => {
	it("rejects single .. segment", () => {
		const err = validateGlobPattern("../src/**/*.tsx");
		expect(err).not.toBeNull();
		expect(err).toContain("..");
	});

	it("rejects multiple .. segments", () => {
		const err = validateGlobPattern("../../secret/**/*.ts");
		expect(err).not.toBeNull();
	});

	it("rejects .. in the middle of path", () => {
		const err = validateGlobPattern("src/../../../etc/passwd");
		expect(err).not.toBeNull();
	});

	it("allows simple relative patterns", () => {
		expect(validateGlobPattern("src/**/*.tsx")).toBeNull();
		expect(validateGlobPattern("**/*.ts")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// @container name validation
// ---------------------------------------------------------------------------

describe("@container name validation", () => {
	it("compiles valid container name", () => {
		const result = compile(["@container/sidebar"], theme);
		expect(result.rules.length).toBe(1);
		expect(result.rules[0].css).toContain("container-name: sidebar");
	});

	it("rejects container name starting with digit", () => {
		const result = compile(["@container/123invalid"], theme);
		expect(result.rules.length).toBe(0);
	});

	it("rejects container name with special characters", () => {
		const result = compile(["@container/foo;bar"], theme);
		expect(result.rules.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// ResolvedTheme freezing
// ---------------------------------------------------------------------------

describe("ResolvedTheme is frozen", () => {
	it("theme object itself is frozen", () => {
		expect(Object.isFrozen(theme)).toBe(true);
	});

	it("theme.breakpoints is frozen", () => {
		expect(Object.isFrozen(theme.breakpoints)).toBe(true);
	});

	it("theme.colors is frozen", () => {
		expect(Object.isFrozen(theme.colors)).toBe(true);
	});

	it("theme.text is frozen", () => {
		expect(Object.isFrozen(theme.text)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// createCompiler isolation
// ---------------------------------------------------------------------------

describe("createCompiler isolation", () => {
	it("two compiler instances do not share state", () => {
		const compiler1 = createCompiler();
		const compiler2 = createCompiler();
		const result1 = compiler1.compile(["flex", "p-4"], theme);
		const result2 = compiler2.compile(["grid", "m-8"], theme);
		// Each result should only contain its own classes
		expect(result1.rules.map((r) => r.css).join("")).not.toContain("grid");
		expect(result2.rules.map((r) => r.css).join("")).not.toContain("flex");
	});
});
