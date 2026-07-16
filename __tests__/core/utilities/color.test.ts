import { describe, expect, it } from "vitest";
import { resolveUtility } from "../../../src/utilities/index.js";
import { resolveDirectives } from "../../../src/directives/index.js";
import { fixtureTheme } from "../../helpers/fixture-colors.js";

const theme = fixtureTheme();

describe("color utilities", () => {
	it("text-error-500 → color: var(--color-error-500)", () => {
		const r = resolveUtility("text-error-500", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("color");
		expect(r!.declarations[0].value).toBe("var(--color-error-500)");
	});

	it("bg-info-200 → background-color", () => {
		const r = resolveUtility("bg-info-200", null, false, theme);
		expect(r!.declarations[0].property).toBe("background-color");
		expect(r!.declarations[0].value).toBe("var(--color-info-200)");
	});

	it("bg-info-200/50 → background-color with alpha mix", () => {
		const r = resolveUtility("bg-info-200/50", null, false, theme);
		expect(r!.declarations[0].property).toBe("background-color");
		expect(r!.declarations[0].value).toBe(
			"color-mix(in oklab, var(--color-info-200) 50%, transparent)",
		);
	});

	it("border-success-300 → border-color", () => {
		const r = resolveUtility("border-success-300", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-color");
	});

	it("border-bs-success-300 → border-block-start-color (logical block alias)", () => {
		const r = resolveUtility("border-bs-success-300", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-block-start-color");
	});

	it("border-be-[#f00] → border-block-end-color", () => {
		const r = resolveUtility("border-be-[#f00]", null, false, theme);
		expect(r!.declarations[0].property).toBe("border-block-end-color");
		expect(r!.declarations[0].value).toBe("#f00");
	});

	it("outline-general-500 → outline-color", () => {
		const r = resolveUtility("outline-general-500", null, false, theme);
		expect(r!.declarations[0].property).toBe("outline-color");
	});

	it("accent-info-500 → accent-color", () => {
		const r = resolveUtility("accent-info-500", null, false, theme);
		expect(r!.declarations[0].property).toBe("accent-color");
	});

	it("caret-error-500 → caret-color", () => {
		const r = resolveUtility("caret-error-500", null, false, theme);
		expect(r!.declarations[0].property).toBe("caret-color");
	});

	it("text-transparent → transparent", () => {
		const r = resolveUtility("text-transparent", null, false, theme);
		expect(r!.declarations[0].value).toBe("transparent");
	});

	it("text-current → currentColor", () => {
		const r = resolveUtility("text-current", null, false, theme);
		expect(r!.declarations[0].value).toBe("currentColor");
	});

	it("bg-paper → var(--color-paper)", () => {
		const r = resolveUtility("bg-paper", null, false, theme);
		expect(r!.declarations[0].value).toBe("var(--color-paper)");
	});

	it("bg-paper/25 → var(--color-paper) with alpha mix", () => {
		const r = resolveUtility("bg-paper/25", null, false, theme);
		expect(r!.declarations[0].value).toBe(
			"color-mix(in oklab, var(--color-paper) 25%, transparent)",
		);
	});

	it("text-ink → var(--color-ink)", () => {
		const r = resolveUtility("text-ink", null, false, theme);
		expect(r!.declarations[0].value).toBe("var(--color-ink)");
	});

	it("text-[#ff0000] → arbitrary color", () => {
		const r = resolveUtility("text-[#ff0000]", null, false, theme);
		expect(r!.declarations[0].value).toBe("#ff0000");
	});

	it("text-[#ff0000]/0.5 → arbitrary color with alpha mix", () => {
		const r = resolveUtility("text-[#ff0000]/0.5", null, false, theme);
		expect(r!.declarations[0].value).toBe("color-mix(in oklab, #ff0000 50%, transparent)");
	});

	it("bg-[oklch(0.7_0.1_200)] → arbitrary color with underscores decoded", () => {
		const r = resolveUtility("bg-[oklch(0.7_0.1_200)]", null, false, theme);
		expect(r!.declarations[0].property).toBe("background-color");
		expect(r!.declarations[0].value).toBe("oklch(0.7 0.1 200)");
	});

	it("bg-error-500/[0.55] → percentage without float artifacts", () => {
		const r = resolveUtility("bg-error-500/[0.55]", null, false, theme);
		expect(r!.declarations[0].value).toBe(
			"color-mix(in oklab, var(--color-error-500) 55%, transparent)",
		);
	});

	it("from-error-500 → gradient from color", () => {
		const r = resolveUtility("from-error-500", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-gradient-from");
	});

	it("from-error-500/30 → gradient from color with alpha mix", () => {
		const r = resolveUtility("from-error-500/30", null, false, theme);
		expect(r!.declarations[0].value).toBe(
			"color-mix(in oklab, var(--color-error-500) 30%, transparent)",
		);
	});

	it("via-info-300 → gradient via color", () => {
		const r = resolveUtility("via-info-300", null, false, theme);
		expect(r!.declarations[0].property).toBe("--ri-gradient-via");
	});

	it("decoration-error-500 → text-decoration-color", () => {
		const r = resolveUtility("decoration-error-500", null, false, theme);
		expect(r!.declarations[0].property).toBe("text-decoration-color");
	});
});

// ---------------------------------------------------------------------------
// Gradient position stops
// ---------------------------------------------------------------------------

describe("gradient position stops", () => {
	it("from-50% → --ri-gradient-from-position: 50%", () => {
		const r = resolveUtility("from", "50%", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-from-position");
		expect(r!.declarations[0].value).toBe("50%");
	});

	it("from-0% → --ri-gradient-from-position: 0%", () => {
		const r = resolveUtility("from", "0%", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-from-position");
		expect(r!.declarations[0].value).toBe("0%");
	});

	it("from-100% → --ri-gradient-from-position: 100%", () => {
		const r = resolveUtility("from", "100%", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-from-position");
		expect(r!.declarations[0].value).toBe("100%");
	});

	it("from-[20px] → --ri-gradient-from-position: 20px", () => {
		const r = resolveUtility("from", "[20px]", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-from-position");
		expect(r!.declarations[0].value).toBe("20px");
	});

	it("via-30% → --ri-gradient-via-position: 30%", () => {
		const r = resolveUtility("via", "30%", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-via-position");
		expect(r!.declarations[0].value).toBe("30%");
	});

	it("to-90% → --ri-gradient-to-position: 90%", () => {
		const r = resolveUtility("to", "90%", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-to-position");
		expect(r!.declarations[0].value).toBe("90%");
	});

	it("to-[80px] → --ri-gradient-to-position: 80px", () => {
		const r = resolveUtility("to", "[80px]", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-to-position");
		expect(r!.declarations[0].value).toBe("80px");
	});

	it("from-[#hex] resolves as gradient-from color, not position", () => {
		const r = resolveUtility("from", "[#ff0000]", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-from");
		expect(r!.declarations[0].value).toBe("#ff0000");
	});

	it("via-[rgb(...)] resolves as gradient-via color, not position", () => {
		const r = resolveUtility("via", "[rgb(255,0,0)]", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-via");
		expect(r!.declarations[0].value).toBe("rgb(255,0,0)");
	});

	it("to-[#hex] resolves as gradient-to color, not position", () => {
		const r = resolveUtility("to", "[#00ff00]", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-to");
		expect(r!.declarations[0].value).toBe("#00ff00");
	});

	it("from-[color:var(--x)] hint routes to gradient color", () => {
		const r = resolveUtility(
			"from",
			"[var(--my-color)]",
			false,
			theme,
			undefined,
			undefined,
			"color",
		);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-from");
		expect(r!.declarations[0].value).toBe("var(--my-color)");
	});

	it("from-[length:var(--x)] hint routes to gradient position", () => {
		const r = resolveUtility(
			"from",
			"[var(--my-pos)]",
			false,
			theme,
			undefined,
			undefined,
			"length",
		);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-from-position");
		expect(r!.declarations[0].value).toBe("var(--my-pos)");
	});
});

// ---------------------------------------------------------------------------
// Multiple gradient types
// ---------------------------------------------------------------------------

describe("gradient types", () => {
	it("bg-linear-to-r → linear-gradient with --ri-gradient-position", () => {
		const r = resolveUtility("bg-linear-to", "r", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-position");
		expect(r!.declarations[0].value).toBe("to right");
		expect(r!.declarations[1].property).toBe("background-image");
		expect(r!.declarations[1].value).toContain("linear-gradient");
	});

	it("bg-linear-45 → linear-gradient(45deg ...)", () => {
		const r = resolveUtility("bg-linear", "45", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-position");
		expect(r!.declarations[0].value).toBe("45deg");
		expect(r!.declarations[1].property).toBe("background-image");
		expect(r!.declarations[1].value).toContain("linear-gradient");
	});

	it("bg-[<image>] and bg-(image:--v) → background-image (not background-color)", () => {
		expect(resolveUtility("bg", "[url(x.png)]", false, theme)!.declarations[0]).toEqual({
			property: "background-image",
			value: "url(x.png)",
		});
		// image dataType hint forces background-image even for a bare var()
		expect(
			resolveUtility("bg", "[var(--i)]", false, theme, undefined, undefined, "image")!
				.declarations[0],
		).toEqual({ property: "background-image", value: "var(--i)" });
		// a color arbitrary still routes to background-color
		expect(resolveUtility("bg", "[#abc]", false, theme)!.declarations[0]).toEqual({
			property: "background-color",
			value: "#abc",
		});
	});

	it("bg-position-* / bg-size-* → background-position / background-size", () => {
		expect(resolveUtility("bg-position", "[10px_20px]", false, theme)!.declarations[0]).toEqual({
			property: "background-position",
			value: "10px 20px",
		});
		expect(resolveUtility("bg-size", "[200px_100px]", false, theme)!.declarations[0]).toEqual({
			property: "background-size",
			value: "200px 100px",
		});
		expect(resolveUtility("bg-position", "[var(--p)]", false, theme)!.declarations[0]).toEqual({
			property: "background-position",
			value: "var(--p)",
		});
	});

	it("bg-linear-[125deg] → linear-gradient(125deg ...)", () => {
		const r = resolveUtility("bg-linear", "[125deg]", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-position");
		expect(r!.declarations[0].value).toBe("125deg");
	});

	it("bg-conic → conic-gradient", () => {
		const r = resolveUtility("bg", "conic", false, theme);
		expect(r).not.toBeNull();
		const bgImage = r!.declarations.find((d) => d.property === "background-image");
		expect(bgImage).toBeDefined();
		expect(bgImage!.value).toContain("conic-gradient");
	});

	it("bg-conic-45 → conic-gradient(from 45deg ...)", () => {
		const r = resolveUtility("bg-conic", "45", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-position");
		expect(r!.declarations[0].value).toBe("from 45deg");
		expect(r!.declarations[1].property).toBe("background-image");
		expect(r!.declarations[1].value).toContain("conic-gradient");
	});

	it("bg-radial → radial-gradient", () => {
		const r = resolveUtility("bg", "radial", false, theme);
		expect(r).not.toBeNull();
		const bgImage = r!.declarations.find((d) => d.property === "background-image");
		expect(bgImage).toBeDefined();
		expect(bgImage!.value).toContain("radial-gradient");
	});

	it("bg-radial-[circle_at_top] → radial-gradient(circle at top ...)", () => {
		const r = resolveUtility("bg-radial", "[circle_at_top]", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-position");
		expect(r!.declarations[0].value).toBe("circle at top");
	});
});

// ---------------------------------------------------------------------------
// Color interpolation methods
// ---------------------------------------------------------------------------

describe("gradient interpolation methods", () => {
	it("bg-linear-to-r/oklab → includes 'in oklab'", () => {
		const r = resolveUtility("bg-linear-to", "r/oklab", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-position");
		expect(r!.declarations[0].value).toBe("to right in oklab");
	});

	it("bg-linear-to-r/shorter → includes 'in oklch shorter hue'", () => {
		const r = resolveUtility("bg-linear-to", "r/shorter", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toBe("to right in oklch shorter hue");
	});

	it("bg-linear-to-r/hsl → includes 'in hsl'", () => {
		const r = resolveUtility("bg-linear-to", "r/hsl", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toBe("to right in hsl");
	});

	it("bg-linear-45/oklch → includes 'in oklch'", () => {
		const r = resolveUtility("bg-linear", "45/oklch", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toBe("45deg in oklch");
	});

	it("bg-conic-45/longer → includes 'in oklch longer hue'", () => {
		const r = resolveUtility("bg-conic", "45/longer", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].value).toBe("from 45deg in oklch longer hue");
	});
});

// ---------------------------------------------------------------------------
// via-none
// ---------------------------------------------------------------------------

describe("via-none utility", () => {
	it("via-none → clears gradient via and sets 2-stop stops", () => {
		const r = resolveUtility("via", "none", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-via");
		expect(r!.declarations[0].value).toBe("initial");
		expect(r!.declarations[1].property).toBe("--ri-gradient-stops");
		expect(r!.declarations[1].value).toContain("--ri-gradient-from-position");
		expect(r!.declarations[1].value).not.toContain("--ri-gradient-via)");
	});
});

// ---------------------------------------------------------------------------
// Updated gradient stop composition
// ---------------------------------------------------------------------------

describe("gradient stop composition with positions", () => {
	it("from-{color} includes direction and position vars in stops", () => {
		const r = resolveUtility("from-error-500", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-from");
		const stopsDecl = r!.declarations.find((d) => d.property === "--ri-gradient-stops");
		expect(stopsDecl).toBeDefined();
		expect(stopsDecl!.value).toContain("--ri-gradient-position");
		expect(stopsDecl!.value).toContain("--ri-gradient-from-position");
		expect(stopsDecl!.value).toContain("--ri-gradient-to-position");
	});

	it("to-{color} also sets --ri-gradient-stops", () => {
		const r = resolveUtility("to-info-500", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations[0].property).toBe("--ri-gradient-to");
		const stopsDecl = r!.declarations.find((d) => d.property === "--ri-gradient-stops");
		expect(stopsDecl).toBeDefined();
		expect(stopsDecl!.value).toContain("--ri-gradient-position");
	});

	it("via-{color} produces 3-stop composition with positions", () => {
		const r = resolveUtility("via-info-300", null, false, theme);
		expect(r).not.toBeNull();
		const stopsDecl = r!.declarations.find((d) => d.property === "--ri-gradient-stops");
		expect(stopsDecl).toBeDefined();
		expect(stopsDecl!.value).toContain("--ri-gradient-from-position");
		expect(stopsDecl!.value).toContain("--ri-gradient-via)");
		expect(stopsDecl!.value).toContain("--ri-gradient-via-position");
		expect(stopsDecl!.value).toContain("--ri-gradient-to-position");
	});
});

// Suffixed colors require shade variables. Explicit/pair/keyword entries have
// no per-stop variables, so `bg-foo-500` must reject — otherwise we emit a
// dangling `var(--color-foo-500)` reference.
describe("suffixed colors only resolve when shades exist", () => {
	it("explicit single-value alias rejects the suffixed form", () => {
		// `background: theme-22` → stored as { type: "explicit", value: "var(--color-theme-22)" }
		const t = resolveDirectives([{ type: "color", body: "background: theme-22;" }]);
		expect(resolveUtility("from-background-22", null, false, t)).toBeNull();
		expect(resolveUtility("bg-background-22", null, false, t)).toBeNull();
		// Bare form still works via --color-background
		const bg = resolveUtility("bg-background", null, false, t);
		expect(bg!.declarations[0].value).toBe("var(--color-background)");
	});

	it("alias to a generative color accepts the suffixed form", () => {
		const t = resolveDirectives([{ type: "color", body: "brand: 0.18 330; accent: brand;" }]);
		const r = resolveUtility("from-accent-500", null, false, t);
		expect(r!.declarations[0].property).toBe("--ri-gradient-from");
		expect(r!.declarations[0].value).toBe("var(--color-accent-500)");
	});

	it("keyword alias rejects the suffixed form", () => {
		const t = resolveDirectives([{ type: "color", body: "blank: transparent;" }]);
		expect(resolveUtility("from-blank-500", null, false, t)).toBeNull();
	});
});
