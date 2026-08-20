import { describe, expect, test } from "vitest";
import {
	analyzeProjectCSS,
	CLASS_HELPER_NAMES,
	createClassInspector,
	CSS_ENTRY_CANDIDATES,
	EDITOR_API_VERSION,
	editorCapabilities,
	extractClassCandidates,
	findClosest,
	hasRIActivation,
	isSourceFile,
	listVariants,
	parseUtility,
	VARIANT_HELPER_NAMES,
	version,
} from "../../src/entries/editor.js";
import { CSS_CANDIDATES } from "../../src/cli/css-file.js";

describe("rainbowindex/editor entry", () => {
	test("exposes a version handshake", () => {
		// Running from source, the build-time define is absent.
		expect(version).toBe("0.0.0-dev");
		expect(EDITOR_API_VERSION).toBe(1);
		expect(editorCapabilities).toContain("class-candidates");
		expect(editorCapabilities).toContain("candidate-call-ids");
		expect(editorCapabilities).toContain("css-entry-detection");
		expect(editorCapabilities).toContain("theme-analysis");
		expect(editorCapabilities).toContain("class-inspection");
		expect(editorCapabilities).toContain("variant-list");
		expect(editorCapabilities).toContain("class-enumeration");
		expect(editorCapabilities).toContain("merge-analysis");
		expect(editorCapabilities).toContain("structured-diagnostics");
		expect(editorCapabilities).toContain("color-swatches");
		expect(editorCapabilities).toContain("editor-session");
		expect(Object.isFrozen(editorCapabilities)).toBe(true);
	});

	test("scanner helper-name contract is exposed for completion tooling", () => {
		// Editor completion-context detection must match the scanner's own
		// helper-call matching, so these name lists are public API.
		expect(CLASS_HELPER_NAMES).toEqual([
			"clsx",
			"cn",
			"classnames",
			"classNames",
			"cx",
			"ri",
			"twJoin",
			"twMerge",
		]);
		expect(VARIANT_HELPER_NAMES).toEqual(["cva", "tv"]);
		expect(Object.isFrozen(CLASS_HELPER_NAMES)).toBe(true);
		expect(Object.isFrozen(VARIANT_HELPER_NAMES)).toBe(true);
	});

	test("inspection surface works end to end through the entry", () => {
		const { theme } = analyzeProjectCSS(`@color { brand: 0.18 330; }`);
		const inspector = createClassInspector(theme);
		expect(inspector.validate("bg-brand-500")).toEqual({ ok: true });
		expect(inspector.validate("felx")).toMatchObject({ suggestion: "flex" });
		expect(inspector.explain("px-4")?.css).toContain(".px-4");
		expect(listVariants(theme).some((v) => v.name === "hover")).toBe(true);
		expect(findClosest("hver", ["hover", "focus"])).toBe("hover");
		expect(parseUtility("hover:px-4").variants).toEqual(["hover"]);
	});

	test("CSS entry candidates are shared with the CLI's detection order", () => {
		expect(CSS_ENTRY_CANDIDATES).toBe(CSS_CANDIDATES);
		expect(CSS_ENTRY_CANDIDATES[0]).toBe("src/index.css");
		expect(CSS_ENTRY_CANDIDATES).toHaveLength(10);
		expect(Object.isFrozen(CSS_ENTRY_CANDIDATES)).toBe(true);
	});

	test("activation detection works through the pure leaf module", () => {
		expect(hasRIActivation(`@import "rainbowindex";`)).toBe(true);
		expect(hasRIActivation(`@color { brand: 0.18 330; }`)).toBe(true);
		expect(hasRIActivation(`.plain { color: red; }`)).toBe(false);
	});

	test("scanner surface is re-exported", () => {
		const content = `<div class="flex"></div>`;
		const candidates = extractClassCandidates({ path: "a.html", content });
		// The scanner over-collects by design ("class" is a candidate too and
		// the compiler drops it) — assert on the real utility.
		const flex = candidates.find((c) => c.value === "flex");
		expect(flex).toBeDefined();
		expect(content.slice(flex?.start, flex?.end)).toBe("flex");
		expect(flex?.origin).toBe("attribute");
		expect(isSourceFile("a.tsx")).toBe(true);
		expect(isSourceFile("a.css")).toBe(false);
	});
});
