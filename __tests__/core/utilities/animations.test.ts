import { describe, expect, it, test } from "vitest";
import { resolveUtility } from "../../../src/utilities/index.js";
import { scalesTheme } from "../../helpers/fixture-scales.js";

const theme = scalesTheme();

function mutableTheme() {
	const base = scalesTheme();
	return {
		...base,
		animations: { ...base.animations },
	};
}

describe("animation utilities", () => {
	it("animate-spin → animation: var(--animate-spin)", () => {
		const r = resolveUtility("animate-spin", null, false, theme);
		expect(r!.declarations[0].property).toBe("animation");
	});

	it("animate-in → animation: enter", () => {
		const r = resolveUtility("animate-in", null, false, theme);
		expect(r!.declarations[0].value).toContain("enter");
	});

	it("animate-out → animation: exit", () => {
		const r = resolveUtility("animate-out", null, false, theme);
		expect(r!.declarations[0].value).toContain("exit");
	});

	it("fade-in → --ri-enter-opacity: 0", () => {
		const r = resolveUtility("fade-in", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-enter-opacity");
		expect(r!.declarations[0].value).toBe("0");
	});

	it("fade-in-50 → --ri-enter-opacity: 0.5", () => {
		const r = resolveUtility("fade-in-50", null, false, theme);
		expect(r!.declarations[0].value).toBe("0.5");
	});

	it("fade-out → --ri-exit-opacity: 0", () => {
		const r = resolveUtility("fade-out", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-exit-opacity");
	});

	it("zoom-in-95 → --ri-enter-scale: 0.95", () => {
		const r = resolveUtility("zoom-in-95", null, false, theme);
		expect(r!.declarations[0].value).toBe("0.95");
	});

	it("zoom-out-95 → --ri-exit-scale: 0.95", () => {
		const r = resolveUtility("zoom-out-95", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-exit-scale");
	});

	it("spin-in-180 → --ri-enter-rotate: 180deg", () => {
		const r = resolveUtility("spin-in-180", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-enter-rotate");
	});

	it("slide-in-from-top-4 → --ri-enter-translate-y", () => {
		const r = resolveUtility("slide-in-from-top-4", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-enter-translate-y");
	});

	it("slide-in-from-left → --ri-enter-translate-x: -100%", () => {
		const r = resolveUtility("slide-in-from-left", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-enter-translate-x");
		expect(r!.declarations[0].value).toBe("-100%");
	});

	it("slide-out-to-bottom-4 → --ri-exit-translate-y", () => {
		const r = resolveUtility("slide-out-to-bottom-4", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-exit-translate-y");
	});

	it("animate-duration-300 → animation-duration: 300ms", () => {
		const r = resolveUtility("animate-duration-300", null, false, theme);
		expect(r!.declarations[0].value).toBe("300ms");
	});

	it("animate-infinite → animation-iteration-count: infinite", () => {
		const r = resolveUtility("animate-infinite", null, false, theme);
		expect(r!.declarations[0].value).toBe("infinite");
	});

	it("animate-fill-both → animation-fill-mode: both", () => {
		const r = resolveUtility("animate-fill-both", null, false, theme);
		expect(r!.declarations[0].value).toBe("both");
	});

	it("animate-fill-forwards → animation-fill-mode: forwards", () => {
		const r = resolveUtility("animate-fill-forwards", null, false, theme);
		expect(r!.declarations[0].value).toBe("forwards");
	});

	it("animate-paused → animation-play-state: paused", () => {
		const r = resolveUtility("animate-paused", null, false, theme);
		expect(r!.declarations[0].value).toBe("paused");
	});

	test.each([
		["animate-pulse", "animation", "var(--animate-pulse)"],
		["animate-none", "animation", "none"],
		["animate-once", "animation-iteration-count", "1"],
		["animate-twice", "animation-iteration-count", "2"],
		["animate-fill-none", "animation-fill-mode", "none"],
		["animate-fill-backwards", "animation-fill-mode", "backwards"],
		["animate-normal", "animation-direction", "normal"],
		["animate-reverse", "animation-direction", "reverse"],
		["animate-alternate", "animation-direction", "alternate"],
		["animate-alternate-reverse", "animation-direction", "alternate-reverse"],
		["animate-running", "animation-play-state", "running"],
		["fade-out-25", "--ri-exit-opacity", "0.25"],
		["zoom-in", "--ri-enter-scale", "0"],
		["zoom-out", "--ri-exit-scale", "0"],
		["spin-out-90", "--ri-exit-rotate", "90deg"],
		["blur-in-8", "--ri-enter-blur", "8px"],
		["blur-out-4", "--ri-exit-blur", "4px"],
		// Static spin/blur (no numeric suffix)
		["spin-in", "--ri-enter-rotate", "30deg"],
		["spin-out", "--ri-exit-rotate", "30deg"],
		["blur-in", "--ri-enter-blur", "20px"],
		["blur-out", "--ri-exit-blur", "20px"],
		["animate-duration-[2s]", "animation-duration", "2s"],
		["animate-delay-[150ms]", "animation-delay", "150ms"],
		// A named theme animation resolves to its token
		["animate-spin", "animation", "var(--animate-spin)"],
		["animate-bounce", "animation", "var(--animate-bounce)"],
	])("%s resolves to %s: %s", (className, property, value) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe(property);
		expect(r!.declarations[0].value).toBe(value);
	});

	// Negative prefix reverses spin rotation and mirrors zoom scale. The parser
	// strips the leading `-` and passes negative=true with the bare utility.
	test.each([
		["spin-in", null, "--ri-enter-rotate", "-30deg"],
		["spin-out", null, "--ri-exit-rotate", "-30deg"],
		["spin-in-90", null, "--ri-enter-rotate", "-90deg"],
		["spin-out-45", null, "--ri-exit-rotate", "-45deg"],
		["zoom-in-95", null, "--ri-enter-scale", "-0.95"],
		["zoom-out-50", null, "--ri-exit-scale", "-0.5"],
	])("-%s%s resolves to %s: %s", (utility, value, property, expected) => {
		const r = resolveUtility(utility, value, true, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe(property);
		expect(r!.declarations[0].value).toBe(expected);
	});

	it("slide-in-from-top uses full offset by default", () => {
		const r = resolveUtility("slide-in-from-top", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-enter-translate-y");
		expect(r!.declarations[0].value).toBe("-100%");
	});

	it("slide-out-to-right uses full offset by default", () => {
		const r = resolveUtility("slide-out-to-right", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-exit-translate-x");
		expect(r!.declarations[0].value).toBe("100%");
	});

	it("slide supports zero spacing values", () => {
		const r = resolveUtility("slide-in-from-bottom-0", null, false, theme);
		expect(r!.declarations[0].value).toBe("0px");
	});

	it("slide supports arbitrary values", () => {
		const r = resolveUtility("slide-out-to-left-[10px]", null, false, theme);
		expect(r!.declarations[0].value).toBe("calc(10px * -1)");
	});

	it("animate-ease uses theme easing values", () => {
		const r = resolveUtility("animate-ease-in", null, false, theme);
		expect(r!.declarations[0].property).toBe("animation-timing-function");
		expect(r!.declarations[0].value).toBe(theme.easing.in);
	});

	it("animate picks up custom theme animations", () => {
		const customTheme = mutableTheme();
		customTheme.animations.wiggle = {
			shorthand: "wiggle 1s ease-in-out infinite",
			keyframes:
				"@keyframes wiggle { 0% { transform: rotate(0deg); } 100% { transform: rotate(3deg); } }",
		};
		const r = resolveUtility("animate-wiggle", null, false, customTheme);
		expect(r!.declarations[0].value).toBe("var(--animate-wiggle)");
	});
});
