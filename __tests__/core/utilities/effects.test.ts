import { describe, expect, it, test } from "vitest";
import { resolveUtility } from "../../../src/utilities/index.js";
import { fixtureTheme } from "../../helpers/fixture-colors.js";

const theme = fixtureTheme();

describe("effects utilities", () => {
	it("shadow → --ri-shadow slot + composed box-shadow", () => {
		const r = resolveUtility("shadow", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-shadow");
		const boxShadow = r!.declarations.find((d) => d.property === "box-shadow");
		expect(boxShadow!.value).toContain("var(--ri-ring-shadow, 0 0 #0000)");
		expect(boxShadow!.value).toContain("var(--ri-shadow, 0 0 #0000)");
	});

	it("shadow-lg → --ri-shadow: var(--shadow-lg)", () => {
		const r = resolveUtility("shadow-lg", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-shadow");
		expect(r!.declarations[0].value).toBe("var(--shadow-lg)");
	});

	it("opacity-50 → opacity: 50%", () => {
		const r = resolveUtility("opacity-50", null, false, theme);
		expect(r!.declarations[0].value).toBe("50%");
	});

	it("transition → transition properties", () => {
		const r = resolveUtility("transition", null, false, theme);
		expect(r!.declarations.length).toBe(3);
	});

	it("duration-300 → transition-duration: 300ms", () => {
		const r = resolveUtility("duration-300", null, false, theme);
		expect(r!.declarations[0].value).toBe("300ms");
	});

	it("ease-in → timing function from theme", () => {
		const r = resolveUtility("ease-in", null, false, theme);
		expect(r!.declarations[0].property).toBe("transition-timing-function");
	});

	it("duration-initial / ease-initial → initial", () => {
		const d = resolveUtility("duration-initial", null, false, theme);
		expect(d!.declarations[0]).toEqual({ property: "transition-duration", value: "initial" });
		const e = resolveUtility("ease-initial", null, false, theme);
		expect(e!.declarations[0]).toEqual({
			property: "transition-timing-function",
			value: "initial",
		});
	});

	it("transition / -colors / -transform cover the v4 property set", () => {
		const t = resolveUtility("transition", null, false, theme)!.declarations[0].value;
		// v4 additions: outline-color, gradient stop vars, individual transforms, discrete props
		for (const p of [
			"outline-color",
			"--ri-gradient-from",
			"translate",
			"scale",
			"rotate",
			"display",
		]) {
			expect(t).toContain(p);
		}
		expect(
			resolveUtility("transition-colors", null, false, theme)!.declarations[0].value,
		).toContain("--ri-gradient-to");
		expect(resolveUtility("transition-transform", null, false, theme)!.declarations[0].value).toBe(
			"transform, translate, scale, rotate",
		);
	});

	it("translate-x-4 → --ri-translate-x + translate", () => {
		const r = resolveUtility("translate-x-4", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-translate-x");
		expect(r!.declarations[1].property).toBe("translate");
		// Fallback `, 0` on every axis is required: without it a single-axis class
		// like `-translate-x-full` would resolve `translate` to its initial value
		// `none` when the other axes' vars are unset.
		expect(r!.declarations[1].value).toBe("var(--ri-translate-x, 0) var(--ri-translate-y, 0)");
	});

	it("rotate-45 → rotate: 45deg", () => {
		const r = resolveUtility("rotate-45", null, false, theme);
		expect(r!.declarations[0].value).toBe("45deg");
	});

	it("-rotate-45 → rotate: -45deg", () => {
		const r = resolveUtility("rotate-45", null, true, theme);
		expect(r!.declarations[0].value).toBe("-45deg");
	});

	it("scale-75 sets both axes via vars + shorthand", () => {
		const r = resolveUtility("scale-75", null, false, theme);
		const byProp = new Map(r!.declarations.map((d) => [d.property, d.value]));
		expect(byProp.get("--ri-scale-x")).toBe("75%");
		expect(byProp.get("--ri-scale-y")).toBe("75%");
		expect(byProp.get("scale")).toBe("var(--ri-scale-x, 1) var(--ri-scale-y, 1)");
	});

	it("-scale-75 negates via the negative flag", () => {
		const r = resolveUtility("scale-75", null, true, theme);
		const byProp = new Map(r!.declarations.map((d) => [d.property, d.value]));
		expect(byProp.get("--ri-scale-x")).toBe("calc(75% * -1)");
		expect(byProp.get("--ri-scale-y")).toBe("calc(75% * -1)");
	});

	it("blur-md → filter: blur(...)", () => {
		const r = resolveUtility("blur-md", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-blur");
		expect(r!.declarations[0].value).toContain("blur(");
		expect(r!.declarations[1].property).toBe("filter");
	});

	it("bg-cover → background-size: cover", () => {
		const r = resolveUtility("bg-cover", null, false, theme);
		expect(r!.declarations[0].value).toBe("cover");
	});

	it("bg-none → background-image: none (v4, not the background shorthand)", () => {
		const r = resolveUtility("bg-none", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "background-image", value: "none" });
	});

	it("mask-t-from-<percentage> → top edge position var + composed image", () => {
		const r = resolveUtility("mask-t-from", "50%", false, theme);
		expect(r!.declarations[0]).toEqual({
			property: "--ri-mask-top-from-position",
			value: "50%",
		});
		expect(r!.declarations[1].value).toContain("to top");
	});

	test.each([
		["transition-all", "transition-property", "all"],
		["transition-discrete", "transition-behavior", "allow-discrete"],
		["transition-normal", "transition-behavior", "normal"],
		["mix-blend-screen", "mix-blend-mode", "screen"],
		["bg-blend-overlay", "background-blend-mode", "overlay"],
		["backdrop-blur-none", "backdrop-filter", "none"],
		["filter-none", "filter", "none"],
	])("%s resolves to %s: %s", (className, property, value) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe(property);
		expect(r!.declarations[0].value).toBe(value);
	});

	test.each([["delay-150", "transition-delay", "150ms"]])(
		"%s generates %s",
		(className, property, value) => {
			const r = resolveUtility(className, null, false, theme);
			expect(r).not.toBeNull();
			expect(r!.declarations[0].property).toBe(property);
			expect(r!.declarations[0].value).toBe(value);
		},
	);

	test.each([
		["brightness-150", "--ri-brightness", "brightness(150%)", "filter"],
		["contrast-125", "--ri-contrast", "contrast(125%)", "filter"],
		["saturate-200", "--ri-saturate", "saturate(200%)", "filter"],
		["grayscale-50", "--ri-grayscale", "grayscale(50%)", "filter"],
		["invert-50", "--ri-invert", "invert(50%)", "filter"],
		["sepia-50", "--ri-sepia", "sepia(50%)", "filter"],
		["grayscale", "--ri-grayscale", "grayscale(100%)", "filter"],
		["hue-rotate-45", "--ri-hue-rotate", "hue-rotate(45deg)", "filter"],
		["backdrop-brightness-150", "--ri-backdrop-brightness", "brightness(150%)", "backdrop-filter"],
		["backdrop-opacity-50", "--ri-backdrop-opacity", "opacity(50%)", "backdrop-filter"],
		["backdrop-grayscale", "--ri-backdrop-grayscale", "grayscale(100%)", "backdrop-filter"],
		["backdrop-invert-0", "--ri-backdrop-invert", "invert(0%)", "backdrop-filter"],
		["backdrop-hue-rotate-90", "--ri-backdrop-hue-rotate", "hue-rotate(90deg)", "backdrop-filter"],
	])("%s generates composable %s", (className, cssVar, value, composedProp) => {
		const r = resolveUtility(className, null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe(cssVar);
		expect(r!.declarations[0].value).toBe(value);
		expect(r!.declarations[1].property).toBe(composedProp);
	});

	it("filter-(--c) / filter-[v] → literal filter override", () => {
		expect(resolveUtility("filter-[blur(1px)]", null, false, theme)!.declarations[0]).toEqual({
			property: "filter",
			value: "blur(1px)",
		});
		expect(resolveUtility("filter-[var(--c)]", null, false, theme)!.declarations[0]).toEqual({
			property: "filter",
			value: "var(--c)",
		});
	});

	it("blur-xs / backdrop-blur-xs → blur(2px)", () => {
		expect(resolveUtility("blur-xs", null, false, theme)!.declarations[0]).toEqual({
			property: "--ri-blur",
			value: "blur(2px)",
		});
		expect(resolveUtility("backdrop-blur-xs", null, false, theme)!.declarations[0]).toEqual({
			property: "--ri-backdrop-blur",
			value: "blur(2px)",
		});
	});

	it("drop-shadow scale / none / color", () => {
		const md = resolveUtility("drop-shadow-md", null, false, theme);
		expect(md!.declarations[0].property).toBe("--ri-drop-shadow");
		expect(md!.declarations[0].value).toContain("var(--ri-drop-shadow-color,");
		expect(md!.declarations[1].property).toBe("filter");
		expect(resolveUtility("drop-shadow-none", null, false, theme)!.declarations[0]).toEqual({
			property: "--ri-drop-shadow",
			value: "drop-shadow(0 0 #0000)",
		});
		expect(resolveUtility("drop-shadow-[#f00]", null, false, theme)!.declarations[0]).toEqual({
			property: "--ri-drop-shadow-color",
			value: "#f00",
		});
		expect(resolveUtility("drop-shadow-inherit", null, false, theme)!.declarations[0]).toEqual({
			property: "--ri-drop-shadow-color",
			value: "inherit",
		});
	});

	it("backdrop-filter-none / -[v] → literal backdrop-filter", () => {
		expect(resolveUtility("backdrop-filter-none", null, false, theme)!.declarations[0]).toEqual({
			property: "backdrop-filter",
			value: "none",
		});
		expect(
			resolveUtility("backdrop-filter-[blur(2px)]", null, false, theme)!.declarations[0],
		).toEqual({
			property: "backdrop-filter",
			value: "blur(2px)",
		});
	});

	it("supports arbitrary shadow values", () => {
		const r = resolveUtility("shadow-[0_0_10px_red]", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-shadow");
		expect(r!.declarations[0].value).toBe("0 0 10px red");
	});

	it("shadow-[#hex] resolves as shadow-color, not box-shadow", () => {
		const r = resolveUtility("shadow-[#ff0000]", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-shadow-color");
		expect(r!.declarations[0].value).toBe("#ff0000");
	});

	it("shadow-{themed-color} resolves as shadow-color", () => {
		const r = resolveUtility("shadow-error-500", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-shadow-color");
		expect(r!.declarations[0].value).toContain("var(--color-error-500)");
	});

	it("shadow-[color:var(--x)] hint routes to shadow-color", () => {
		const r = resolveUtility(
			"shadow",
			"[var(--my-color)]",
			false,
			theme,
			undefined,
			undefined,
			"color",
		);
		expect(r!.declarations[0].property).toBe("--ri-shadow-color");
		expect(r!.declarations[0].value).toBe("var(--my-color)");
	});

	it("shadow-[length:var(--x)] hint routes to the --ri-shadow slot", () => {
		const r = resolveUtility(
			"shadow",
			"[var(--my-shadow)]",
			false,
			theme,
			undefined,
			undefined,
			"length",
		);
		expect(r!.declarations[0].property).toBe("--ri-shadow");
		expect(r!.declarations[0].value).toBe("var(--my-shadow)");
	});

	it("inset-shadow-md → --ri-inset-shadow slot (color-parameterized) + composition", () => {
		const r = resolveUtility("inset-shadow-md", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-inset-shadow");
		expect(r!.declarations[0].value).toContain("var(--ri-inset-shadow-color,");
		expect(r!.declarations.find((d) => d.property === "box-shadow")).toBeDefined();
	});

	it("inset-shadow-none → reset slot; inset-shadow-{color} → color var", () => {
		const none = resolveUtility("inset-shadow-none", null, false, theme);
		expect(none!.declarations[0]).toEqual({
			property: "--ri-inset-shadow",
			value: "inset 0 0 #0000",
		});
		const color = resolveUtility("inset-shadow-[#00f]", null, false, theme);
		expect(color!.declarations[0]).toEqual({ property: "--ri-inset-shadow-color", value: "#00f" });
	});

	it("ring / ring-2 / ring-[3px] → --ri-ring-shadow with currentColor fallback", () => {
		expect(resolveUtility("ring", null, false, theme)!.declarations[0]).toEqual({
			property: "--ri-ring-shadow",
			value: "0 0 0 1px var(--ri-ring-color, currentColor)",
		});
		expect(resolveUtility("ring-2", null, false, theme)!.declarations[0].value).toBe(
			"0 0 0 2px var(--ri-ring-color, currentColor)",
		);
		expect(resolveUtility("ring-[3px]", null, false, theme)!.declarations[0].value).toBe(
			"0 0 0 3px var(--ri-ring-color, currentColor)",
		);
	});

	it("ring-{color} → --ri-ring-color (no ring shadow)", () => {
		const themed = resolveUtility("ring-error-500", null, false, theme);
		expect(themed!.declarations).toHaveLength(1);
		expect(themed!.declarations[0].property).toBe("--ri-ring-color");
		expect(resolveUtility("ring-current", null, false, theme)!.declarations[0]).toEqual({
			property: "--ri-ring-color",
			value: "currentColor",
		});
	});

	it("inset-ring / inset-ring-2 → inset --ri-inset-ring-shadow; color → --ri-inset-ring-color", () => {
		expect(resolveUtility("inset-ring", null, false, theme)!.declarations[0]).toEqual({
			property: "--ri-inset-ring-shadow",
			value: "inset 0 0 0 1px var(--ri-inset-ring-color, currentColor)",
		});
		expect(resolveUtility("inset-ring-2", null, false, theme)!.declarations[0].value).toBe(
			"inset 0 0 0 2px var(--ri-inset-ring-color, currentColor)",
		);
		expect(resolveUtility("inset-ring-[#0f0]", null, false, theme)!.declarations[0]).toEqual({
			property: "--ri-inset-ring-color",
			value: "#0f0",
		});
	});

	it("text-shadow-md / -none / -[v] / -(--c) → text-shadow property", () => {
		const md = resolveUtility("text-shadow-md", null, false, theme);
		expect(md!.declarations[0].property).toBe("text-shadow");
		expect(md!.declarations[0].value).toContain("var(--ri-text-shadow-color,");
		expect(resolveUtility("text-shadow-none", null, false, theme)!.declarations[0]).toEqual({
			property: "text-shadow",
			value: "none",
		});
		expect(
			resolveUtility("text-shadow-[0_1px_2px_red]", null, false, theme)!.declarations[0],
		).toEqual({
			property: "text-shadow",
			value: "0 1px 2px red",
		});
		expect(resolveUtility("text-shadow-[var(--c)]", null, false, theme)!.declarations[0]).toEqual({
			property: "text-shadow",
			value: "var(--c)",
		});
	});

	it("text-shadow-{color} → its own --ri-text-shadow-color (not --ri-shadow-color)", () => {
		expect(resolveUtility("text-shadow-inherit", null, false, theme)!.declarations[0]).toEqual({
			property: "--ri-text-shadow-color",
			value: "inherit",
		});
		expect(resolveUtility("text-shadow-[#00f]", null, false, theme)!.declarations[0]).toEqual({
			property: "--ri-text-shadow-color",
			value: "#00f",
		});
		const themed = resolveUtility("text-shadow-error-500", null, false, theme);
		expect(themed!.declarations[0].property).toBe("--ri-text-shadow-color");
		expect(themed!.declarations[0].value).toContain("var(--color-error-500)");
	});

	it("supports arbitrary opacity values", () => {
		const r = resolveUtility("opacity-[var(--opacity)]", null, false, theme);
		expect(r!.declarations[0].value).toBe("var(--opacity)");
	});

	it("supports arbitrary blur values", () => {
		const r = resolveUtility("blur-[3px]", null, false, theme);
		expect(r!.declarations[0].value).toBe("blur(3px)");
	});

	it("supports arbitrary ease values", () => {
		const r = resolveUtility("ease-[cubic-bezier(0.1,0.2,0.3,0.4)]", null, false, theme);
		expect(r!.declarations[0].value).toBe("cubic-bezier(0.1,0.2,0.3,0.4)");
	});

	it("supports negative arbitrary translate values", () => {
		const r = resolveUtility("translate-x-[12px]", null, true, theme);
		expect(r!.declarations[0].value).toBe("calc(12px * -1)");
	});

	it("supports translate full and half shorthands", () => {
		const full = resolveUtility("translate-y-full", null, false, theme);
		const half = resolveUtility("translate-x-1/2", null, true, theme);
		expect(full!.declarations[0].value).toBe("100%");
		expect(half!.declarations[0].value).toBe("-50%");
	});

	it("translate-x-px → --ri-translate-x: 1px", () => {
		const r = resolveUtility("translate-x-px", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-translate-x");
		expect(r!.declarations[0].value).toBe("1px");
	});

	it("-translate-y-px → --ri-translate-y: -1px", () => {
		const r = resolveUtility("translate-y-px", null, true, theme);
		expect(r!.declarations[0].property).toBe("--ri-translate-y");
		expect(r!.declarations[0].value).toBe("-1px");
	});

	it("supports arbitrary rotate values with negation", () => {
		const r = resolveUtility("rotate-[var(--angle)]", null, true, theme);
		expect(r!.declarations[0].value).toBe("calc(var(--angle) * -1)");
	});

	it("supports axis-specific scale values", () => {
		// Per-axis classes set only their own var + the shared shorthand reading
		// from var(..., 1) for unset axes — so `scale-x-125 scale-y-80` composes.
		const x = resolveUtility("scale-x-125", null, false, theme);
		const y = resolveUtility("scale-y-80", null, false, theme);
		const xByProp = new Map(x!.declarations.map((d) => [d.property, d.value]));
		const yByProp = new Map(y!.declarations.map((d) => [d.property, d.value]));
		expect(xByProp.get("--ri-scale-x")).toBe("125%");
		expect(xByProp.get("scale")).toBe("var(--ri-scale-x, 1) var(--ri-scale-y, 1)");
		expect(yByProp.get("--ri-scale-y")).toBe("80%");
		expect(yByProp.get("scale")).toBe("var(--ri-scale-x, 1) var(--ri-scale-y, 1)");
	});

	it("negates per-axis scale via the negative flag", () => {
		const x = resolveUtility("scale-x-50", null, true, theme);
		const xByProp = new Map(x!.declarations.map((d) => [d.property, d.value]));
		expect(xByProp.get("--ri-scale-x")).toBe("calc(50% * -1)");
	});

	it("supports arbitrary scale values", () => {
		const r = resolveUtility("scale-[1.125]", null, false, theme);
		const byProp = new Map(r!.declarations.map((d) => [d.property, d.value]));
		expect(byProp.get("--ri-scale-x")).toBe("1.125");
		expect(byProp.get("--ri-scale-y")).toBe("1.125");
	});

	it("wraps arbitrary scale values in calc(...) when negative", () => {
		const r = resolveUtility("scale-x-[var(--foo)]", null, true, theme);
		const byProp = new Map(r!.declarations.map((d) => [d.property, d.value]));
		expect(byProp.get("--ri-scale-x")).toBe("calc(var(--foo) * -1)");
	});

	it("supports arbitrary skew values with negation", () => {
		const r = resolveUtility("skew-y-[12deg]", null, true, theme);
		expect(r!.declarations[0].value).toBe("skewY(calc(12deg * -1))");
	});

	it("supports arbitrary drop shadows", () => {
		const r = resolveUtility("drop-shadow-[0_2px_4px_rgb(0_0_0_/_0.2)]", null, false, theme);
		expect(r!.declarations[0].value).toBe("drop-shadow(0 2px 4px rgb(0 0 0 / 0.2))");
	});

	it("supports arbitrary backdrop blur values", () => {
		const r = resolveUtility("backdrop-blur-[6px]", null, false, theme);
		expect(r!.declarations[0].value).toBe("blur(6px)");
	});

	it("supports default backdrop blur token", () => {
		const r = resolveUtility("backdrop-blur", null, false, theme);
		expect(r!.declarations[0].value).toContain("blur(");
	});

	it("supports arbitrary mask values", () => {
		const r = resolveUtility("mask-[url(mask.svg)]", null, false, theme);
		expect(r!.declarations[0].value).toBe("url(mask.svg)");
	});

	// Mask compositing
	it.each([
		["mask-add", "mask-composite", "add"],
		["mask-subtract", "mask-composite", "subtract"],
		["mask-intersect", "mask-composite", "intersect"],
		["mask-exclude", "mask-composite", "exclude"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	// Mask — Tailwind v4 surface (composable --ri-mask-* vars)
	it.each([
		["mask-clip-padding", "mask-clip", "padding-box"],
		["mask-no-clip", "mask-clip", "no-clip"],
		["mask-luminance", "mask-mode", "luminance"],
		["mask-match", "mask-mode", "match-source"],
		["mask-origin-content", "mask-origin", "content-box"],
		["mask-center", "mask-position", "center"],
		["mask-bottom-right", "mask-position", "bottom right"],
		["mask-no-repeat", "mask-repeat", "no-repeat"],
		["mask-repeat-x", "mask-repeat", "repeat-x"],
		["mask-cover", "mask-size", "cover"],
		["mask-type-luminance", "mask-type", "luminance"],
		["mask-circle", "--ri-mask-radial-shape", "circle"],
		["mask-radial-closest-side", "--ri-mask-radial-size", "closest-side"],
		["mask-radial-at-top-left", "--ri-mask-radial-position", "top left"],
	])("static %s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	it("mask-linear-<n> sets the angle var + composed image", () => {
		const r = resolveUtility("mask-linear", "45", false, theme);
		expect(r!.declarations[0]).toEqual({
			property: "--ri-mask-linear-position",
			value: "45deg",
		});
		expect(r!.declarations[1].property).toBe("mask-image");
		expect(r!.declarations[1].value).toContain("linear-gradient(");
	});

	it("-mask-linear-<n> negates the angle", () => {
		const r = resolveUtility("mask-linear", "45", true, theme);
		expect(r!.declarations[0].value).toBe("calc(45deg * -1)");
	});

	it("mask-conic-<n> sets the conic angle var", () => {
		const r = resolveUtility("mask-conic", "30", false, theme);
		expect(r!.declarations[0]).toEqual({
			property: "--ri-mask-conic-position",
			value: "30deg",
		});
		expect(r!.declarations[1].value).toContain("conic-gradient(from ");
	});

	it.each([
		["mask-linear-from", "20%", "--ri-mask-linear-from-position", "20%"],
		["mask-linear-from", "4", "--ri-mask-linear-from-position", "calc(var(--spacing) * 4)"],
		["mask-linear-to", "80%", "--ri-mask-linear-to-position", "80%"],
	])("%s-%s → %s", (util, value, prop, expected) => {
		const r = resolveUtility(util, value, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: expected });
		expect(r!.declarations[1].property).toBe("mask-image");
	});

	it("mask-linear-from-<color> sets the color var", () => {
		const r = resolveUtility("mask-linear-from", "[#000]", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "--ri-mask-linear-from", value: "#000" });
	});

	it("mask-linear-from-(--v) custom property resolves to a position var", () => {
		const r = resolveUtility("mask-linear-from", "[var(--v)]", false, theme);
		expect(r!.declarations[0]).toEqual({
			property: "--ri-mask-linear-from-position",
			value: "var(--v)",
		});
	});

	it("mask-b-to uses the bottom edge namespace + direction", () => {
		const r = resolveUtility("mask-b-to", "50%", false, theme);
		expect(r!.declarations[0].property).toBe("--ri-mask-bottom-to-position");
		expect(r!.declarations[1].value).toContain("to bottom");
	});

	it("mask-y-from sets both edge vars + intersect composite", () => {
		const r = resolveUtility("mask-y-from", "10%", false, theme);
		expect(r!.declarations.map((d) => d.property)).toEqual([
			"--ri-mask-top-from-position",
			"--ri-mask-bottom-from-position",
			"mask-image",
			"mask-composite",
		]);
		expect(r!.declarations[2].value).toContain("to top");
		expect(r!.declarations[2].value).toContain("to bottom");
		expect(r!.declarations[3].value).toBe("intersect");
	});

	it("mask-x-to sets right + left color vars", () => {
		const r = resolveUtility("mask-x-to", "[#000]", false, theme);
		expect(r!.declarations.map((d) => d.property)).toEqual([
			"--ri-mask-right-to",
			"--ri-mask-left-to",
			"mask-image",
			"mask-composite",
		]);
	});

	it("mask-radial-from sets the radial from var + radial image", () => {
		const r = resolveUtility("mask-radial-from", "30%", false, theme);
		expect(r!.declarations[0].property).toBe("--ri-mask-radial-from-position");
		expect(r!.declarations[1].value).toContain("radial-gradient(");
	});

	it("mask-radial-[<size>] sets the size var; mask-radial-[<value>] is an image", () => {
		expect(resolveUtility("mask-radial", "[50%]", false, theme)!.declarations[0]).toEqual({
			property: "--ri-mask-radial-size",
			value: "50%",
		});
		expect(resolveUtility("mask-radial", "[circle_at_top]", false, theme)!.declarations[0]).toEqual(
			{
				property: "mask-image",
				value: "radial-gradient(circle at top)",
			},
		);
	});

	it("mask-conic-from / mask-conic-to set conic stop vars", () => {
		expect(resolveUtility("mask-conic-from", "10%", false, theme)!.declarations[0].property).toBe(
			"--ri-mask-conic-from-position",
		);
		expect(resolveUtility("mask-conic-to", "[#00f]", false, theme)!.declarations[0].property).toBe(
			"--ri-mask-conic-to",
		);
	});

	it("mask-position / mask-size accept arbitrary + custom-property values", () => {
		expect(resolveUtility("mask-position", "[center_top]", false, theme)!.declarations[0]).toEqual({
			property: "mask-position",
			value: "center top",
		});
		expect(resolveUtility("mask-size", "[200px_100px]", false, theme)!.declarations[0]).toEqual({
			property: "mask-size",
			value: "200px 100px",
		});
		expect(resolveUtility("mask-position", "[var(--p)]", false, theme)!.declarations[0]).toEqual({
			property: "mask-position",
			value: "var(--p)",
		});
	});

	it("bare mask-[<value>] / mask-(--v) set mask-image", () => {
		expect(resolveUtility("mask", "[url(m.svg)]", false, theme)!.declarations[0]).toEqual({
			property: "mask-image",
			value: "url(m.svg)",
		});
		expect(resolveUtility("mask", "[var(--m)]", false, theme)!.declarations[0]).toEqual({
			property: "mask-image",
			value: "var(--m)",
		});
	});

	it("removed non-standard shorthands no longer resolve", () => {
		for (const util of ["mask-linear", "mask-radial", "mask-conic", "mask-t", "mask-25"]) {
			expect(resolveUtility(util, null, false, theme)).toBeNull();
		}
	});

	// Transform additions
	it.each([
		["transform-flat", "transform-style", "flat"],
		["transform-3d", "transform-style", "preserve-3d"],
		["transform-border", "transform-box", "border-box"],
		["transform-content", "transform-box", "content-box"],
		["transform-fill", "transform-box", "fill-box"],
		["transform-stroke", "transform-box", "stroke-box"],
		["transform-view", "transform-box", "view-box"],
		["translate-none", "translate", "none"],
		["rotate-none", "rotate", "none"],
		["scale-none", "scale", "none"],
		["perspective-none", "perspective", "none"],
	])("%s → %s: %s", (util, prop, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: prop, value: val });
	});

	// Transform origin
	it.each([
		["origin-center", "center"],
		["origin-top", "top"],
		["origin-top-right", "top right"],
		["origin-bottom-left", "bottom left"],
	])("%s → transform-origin: %s", (util, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "transform-origin", value: val });
	});

	// Mix blend plus-*
	it("mix-blend-plus-darker → mix-blend-mode: plus-darker", () => {
		const r = resolveUtility("mix-blend-plus-darker", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "mix-blend-mode", value: "plus-darker" });
	});
	it("mix-blend-plus-lighter → mix-blend-mode: plus-lighter", () => {
		const r = resolveUtility("mix-blend-plus-lighter", null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "mix-blend-mode", value: "plus-lighter" });
	});

	// Background corner positions
	it.each([
		["bg-top-left", "top left"],
		["bg-top-right", "top right"],
		["bg-bottom-left", "bottom left"],
		["bg-bottom-right", "bottom right"],
	])("%s → background-position: %s", (util, val) => {
		const r = resolveUtility(util, null, false, theme);
		expect(r!.declarations[0]).toEqual({ property: "background-position", value: val });
	});

	// Transform axis variants
	it("rotate-x-45 sets --ri-rotate-x + composed transform", () => {
		const r = resolveUtility("rotate-x", "45", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "--ri-rotate-x", value: "rotateX(45deg)" });
		expect(r!.declarations.find((d) => d.property === "transform")!.value).toContain(
			"var(--ri-rotate-x, rotateX(0))",
		);
	});
	it("rotate-y-90 uses rotateY()", () => {
		const r = resolveUtility("rotate-y", "90", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "--ri-rotate-y", value: "rotateY(90deg)" });
	});
	it("rotate-z-180 uses rotateZ()", () => {
		const r = resolveUtility("rotate-z", "180", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "--ri-rotate-z", value: "rotateZ(180deg)" });
	});
	it("-rotate-x-45 negates", () => {
		const r = resolveUtility("rotate-x", "45", true, theme);
		expect(r!.declarations[0]).toEqual({ property: "--ri-rotate-x", value: "rotateX(-45deg)" });
	});
	it("scale-z-50 sets z axis only", () => {
		const r = resolveUtility("scale-z", "50", false, theme);
		const byProp = new Map(r!.declarations.map((d) => [d.property, d.value]));
		expect(byProp.get("--ri-scale-z")).toBe("50%");
		expect(byProp.get("scale")).toBe(
			"var(--ri-scale-x, 1) var(--ri-scale-y, 1) var(--ri-scale-z, 1)",
		);
	});
	it("skew-6 (shorthand) sets both skew axes + composed transform", () => {
		const r = resolveUtility("skew", "6", false, theme);
		const byProp = new Map(r!.declarations.map((d) => [d.property, d.value]));
		expect(byProp.get("--ri-skew-x")).toBe("skewX(6deg)");
		expect(byProp.get("--ri-skew-y")).toBe("skewY(6deg)");
		expect(byProp.get("transform")).toContain("var(--ri-skew-x, skewX(0))");
	});
	it("translate-4 (shorthand) sets both x and y", () => {
		const r = resolveUtility("translate", "4", false, theme);
		const byProp = new Map(r!.declarations.map((d) => [d.property, d.value]));
		expect(byProp.get("--ri-translate-x")).toBe("calc(4 * var(--spacing))");
		expect(byProp.get("--ri-translate-y")).toBe("calc(4 * var(--spacing))");
		expect(byProp.get("translate")).toBe("var(--ri-translate-x, 0) var(--ri-translate-y, 0)");
	});
	it("translate-z-5 sets z axis", () => {
		const r = resolveUtility("translate-z", "5", false, theme);
		const byProp = new Map(r!.declarations.map((d) => [d.property, d.value]));
		expect(byProp.get("--ri-translate-z")).toBe("calc(5 * var(--spacing))");
	});

	// Perspective functional
	it("perspective-500 → perspective: 500px", () => {
		const r = resolveUtility("perspective", "500", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "perspective", value: "500px" });
	});
	it("perspective-[10em] arbitrary", () => {
		const r = resolveUtility("perspective", "[10em]", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "perspective", value: "10em" });
	});
	it("perspective named scale + origin positions", () => {
		expect(resolveUtility("perspective-dramatic", null, false, theme)!.declarations[0]).toEqual({
			property: "perspective",
			value: "100px",
		});
		expect(resolveUtility("perspective-distant", null, false, theme)!.declarations[0]).toEqual({
			property: "perspective",
			value: "1200px",
		});
		expect(
			resolveUtility("perspective-origin-top-right", null, false, theme)!.declarations[0],
		).toEqual({ property: "perspective-origin", value: "top right" });
	});
	it("transform-gpu / -cpu compose the rotate/skew vars", () => {
		const gpu = resolveUtility("transform-gpu", null, false, theme)!.declarations[0];
		expect(gpu.property).toBe("transform");
		expect(gpu.value).toBe(
			"translateZ(0) var(--ri-rotate-x, rotateX(0)) var(--ri-rotate-y, rotateY(0)) var(--ri-rotate-z, rotateZ(0)) var(--ri-skew-x, skewX(0)) var(--ri-skew-y, skewY(0))",
		);
		const cpu = resolveUtility("transform-cpu", null, false, theme)!.declarations[0];
		expect(cpu.value).toContain("var(--ri-rotate-x, rotateX(0))");
		expect(cpu.value).not.toContain("translateZ");
	});
	it("transform-[v] / transform-(--c) → literal transform", () => {
		expect(
			resolveUtility("transform-[matrix(1,2,3,4,5,6)]", null, false, theme)!.declarations[0],
		).toEqual({ property: "transform", value: "matrix(1,2,3,4,5,6)" });
		expect(resolveUtility("transform-[var(--t)]", null, false, theme)!.declarations[0]).toEqual({
			property: "transform",
			value: "var(--t)",
		});
	});
	it("zoom-<n> → %, zoom-[v] → literal", () => {
		expect(resolveUtility("zoom-50", null, false, theme)!.declarations[0]).toEqual({
			property: "zoom",
			value: "50%",
		});
		expect(resolveUtility("zoom-[1.5]", null, false, theme)!.declarations[0]).toEqual({
			property: "zoom",
			value: "1.5",
		});
	});
	it("perspective-origin-[20px_30px] arbitrary", () => {
		const r = resolveUtility("perspective-origin", "[20px_30px]", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "perspective-origin", value: "20px 30px" });
	});

	// Origin functional arbitrary
	it("origin-[20%_40%] arbitrary transform-origin", () => {
		const r = resolveUtility("origin", "[20%_40%]", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "transform-origin", value: "20% 40%" });
	});

	// Cursor arbitrary
	it("cursor-[url(custom.cur),auto] arbitrary", () => {
		const r = resolveUtility("cursor", "[url(custom.cur),auto]", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "cursor", value: "url(custom.cur),auto" });
	});

	// Will-change arbitrary
	it("will-change-[opacity_transform] arbitrary", () => {
		const r = resolveUtility("will-change", "[opacity_transform]", false, theme);
		expect(r!.declarations[0]).toEqual({ property: "will-change", value: "opacity transform" });
	});

	// Animate arbitrary
	it("animate-[spin_2s_linear_infinite] arbitrary", () => {
		const r = resolveUtility("animate", "[spin_2s_linear_infinite]", false, theme);
		expect(r!.declarations[0]).toEqual({
			property: "animation",
			value: "spin 2s linear infinite",
		});
	});
});
