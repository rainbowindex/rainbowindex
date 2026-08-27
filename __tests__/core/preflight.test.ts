import { describe, expect, it } from "vitest";
import { DEFAULT_PREFLIGHT, generatePreflight } from "../../src/css/preflight.js";
import type { PreflightConfig } from "../../src/directives/foundation.js";

describe("generatePreflight", () => {
	it("generates all modules by default", () => {
		const css = generatePreflight();
		expect(css).toContain("box-sizing: border-box");
		expect(css).toContain("margin: 0");
		expect(css).toContain("border-color: inherit");
		expect(css).toContain("-webkit-font-smoothing: antialiased");
		expect(css).toContain("display: block");
		expect(css).toContain("cursor: pointer");
		expect(css).toContain(":focus-visible");
		expect(css).toContain("color-scheme: light dark");
		expect(css).toContain("font-family: var(--font-sans)");
		expect(css).toContain("font-family: var(--font-mono)");
		// Fallback stacks live in the font token emission now, not preflight.
		expect(css).not.toContain("--sans-fallback");
		expect(css).not.toContain("--serif-fallback");
		expect(css).not.toContain("--mono-fallback");
		// A preflight neutralizes; it does not design form controls.
		expect(css).not.toContain("/* preflight: select-reset */");
		expect(css).not.toContain("background-position");
	});

	it("resets list margins, fieldset, and legend", () => {
		const css = generatePreflight();
		expect(css).toContain("pre, ol, ul, menu {");
		expect(css).toContain("/* preflight: fieldset-reset */");
		expect(css).toContain("legend {");
	});

	it("placeholder color follows the text color", () => {
		const css = generatePreflight();
		expect(css).toContain("color-mix(in oklab, currentColor 48%, transparent)");
		expect(css).not.toContain("oklch(0.556 0 0)");
	});

	it("focus ring uses literal widths and keeps default :focus behavior", () => {
		const css = generatePreflight();
		expect(css).toContain("outline-width: 2px");
		expect(css).toContain("outline-offset: 2px");
		expect(css).not.toContain(":focus:not(:focus-visible)");
	});

	it("disables forms category", () => {
		const css = generatePreflight({ ...DEFAULT_PREFLIGHT, forms: false });
		expect(css).toContain("box-sizing: border-box"); // core still on
		expect(css).not.toContain("background-image: none"); // button-reset gone
		expect(css).not.toContain("resize: vertical"); // textarea-reset gone
		expect(css).not.toContain("appearance: button"); // input-reset gone
		expect(css).not.toContain("select-reset"); // select-reset gone
	});

	it("disables modern category", () => {
		const css = generatePreflight({ ...DEFAULT_PREFLIGHT, modern: false });
		expect(css).not.toContain("interpolate-size");
		expect(css).not.toContain("color-scheme");
		expect(css).not.toContain("data-appearance");
		// Other categories still work
		expect(css).toContain("box-sizing: border-box");
	});

	it("core-only mode", () => {
		const config: PreflightConfig = {
			core: true,
			typography: false,
			content: false,
			forms: false,
			interactive: false,
			modern: false,
		};
		const css = generatePreflight(config);
		expect(css).toContain("box-sizing: border-box");
		expect(css).toContain("margin: 0");
		expect(css).toContain("border-width: 0");
		expect(css).toContain("border-color: inherit");
		expect(css).toContain("line-height: 1.5");
		// No typography
		expect(css).not.toContain("font-smoothing");
		// No content
		expect(css).not.toContain("max-inline-size");
		// No forms
		expect(css).not.toContain("textarea");
	});

	it("all off returns empty string", () => {
		const config: PreflightConfig = {
			core: false,
			typography: false,
			content: false,
			forms: false,
			interactive: false,
			modern: false,
		};
		expect(generatePreflight(config)).toBe("");
	});

	it("includes @supports wrapping for interpolate-size", () => {
		const css = generatePreflight();
		expect(css).toContain("@supports (interpolate-size: allow-keywords)");
	});

	it("includes data-appearance selectors", () => {
		const css = generatePreflight();
		expect(css).toContain('html[data-appearance="dark"]');
		expect(css).toContain('html[data-appearance="light"]');
	});

	it("uses logical properties for media", () => {
		const css = generatePreflight();
		expect(css).toContain("max-inline-size: 100%");
		expect(css).toContain("block-size: auto");
	});

	it("includes module name comments", () => {
		const css = generatePreflight();
		expect(css).toContain("/* preflight: box-sizing */");
		expect(css).toContain("/* preflight: color-scheme */");
	});

	it("does not apply automatic text-wrap rules", () => {
		const css = generatePreflight();
		expect(css).not.toContain("text-wrap: balance");
		expect(css).not.toContain("text-wrap: pretty");
	});
});
