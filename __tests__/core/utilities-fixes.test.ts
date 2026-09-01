/**
 * Regression tests for the utilities audit fixes — alpha-modifier injection,
 * scrollbar-color fallbacks, light-dark() color routing, and the shared
 * image/font-family predicates from merge/props.ts.
 */

import { describe, expect, it } from "vitest";
import { resolveUtility } from "../../src/utilities/index.js";
import { parseUtility } from "../../src/utilities/parser.js";
import { fixtureTheme } from "../helpers/fixture-colors.js";
import { typographyTheme } from "../helpers/fixture-typography.js";

const theme = typographyTheme(fixtureTheme());

/** Resolve a raw class string through the real parse → resolve pipeline. */
function resolve(cls: string) {
	const p = parseUtility(cls);
	return resolveUtility(
		p.utility,
		p.value,
		p.negative,
		theme,
		undefined,
		undefined,
		p.dataType ?? null,
	);
}

describe("alpha modifier sanitization (color.ts alphaToPercent)", () => {
	it("text-error-500/[100%;color:red] cannot inject declarations", () => {
		const r = resolve("text-error-500/[100%;color:red]");
		if (r !== null) {
			for (const decl of r.declarations) {
				expect(decl.property).not.toContain(";");
				expect(decl.value).not.toContain(";");
				expect(decl.value).not.toMatch(/[{}]/);
			}
		}
	});

	it("calc() alpha modifiers keep working", () => {
		// Non-numeric bracket modifiers get the shared arbitrary-value decode,
		// so math operators are spaced like every other arbitrary path.
		const r = resolve("text-error-500/[calc(var(--opacity)*100%)]");
		expect(r).not.toBeNull();
		expect(r!.declarations).toEqual([
			{
				property: "color",
				value:
					"color-mix(in oklab, var(--color-error-500) calc(var(--opacity) * 100%), transparent)",
			},
		]);
	});

	it("alpha modifier underscores decode to spaces", () => {
		const r = resolve("text-error-500/[var(--o,_50%)]");
		expect(r!.declarations).toEqual([
			{
				property: "color",
				value: "color-mix(in oklab, var(--color-error-500) var(--o, 50%), transparent)",
			},
		]);
	});

	it("bracket fraction modifiers emit a rounded percentage", () => {
		// 0.55 * 100 is 55.00000000000001 in float — the emitted percentage must round.
		const r = resolve("bg-error-500/[0.55]");
		expect(r!.declarations).toEqual([
			{
				property: "background-color",
				value: "color-mix(in oklab, var(--color-error-500) 55%, transparent)",
			},
		]);
	});

	it("var shorthand alpha modifiers keep working", () => {
		const r = resolve("text-error-500/(--my-opacity)");
		expect(r!.declarations).toEqual([
			{
				property: "color",
				value: "color-mix(in oklab, var(--color-error-500) var(--my-opacity), transparent)",
			},
		]);
	});

	it("numeric alpha modifiers are unchanged", () => {
		const r = resolve("text-error-500/[50%]");
		expect(r!.declarations[0].value).toBe(
			"color-mix(in oklab, var(--color-error-500) 50%, transparent)",
		);
	});
});

describe("line-height modifier sanitization (typography.ts)", () => {
	it("a modifier with injection characters is rejected, not stripped", () => {
		// Rejection (vs stripping) matters: the stripped remainder would carry a
		// top-level colon into the emitted line-height declaration.
		const r = resolve("text-lg/[1.5;color:red]");
		expect(r!.declarations).toEqual([
			{ property: "font-size", value: "var(--text-lg)" },
			{ property: "line-height", value: "var(--text-lg-leading)" },
		]);
	});

	it("text-lg/[1.5] keeps working", () => {
		const r = resolve("text-lg/[1.5]");
		expect(r!.declarations).toEqual([
			{ property: "font-size", value: "var(--text-lg)" },
			{ property: "line-height", value: "1.5" },
		]);
	});
});

describe("scrollbar-color fallbacks (layout.ts)", () => {
	it("setting only the thumb emits color fallbacks for both slots", () => {
		const r = resolveUtility("scrollbar-thumb-error-500", null, false, theme);
		expect(r!.declarations).toEqual([
			{ property: "--ri-scrollbar-thumb", value: "var(--color-error-500)" },
			{
				property: "scrollbar-color",
				value: "var(--ri-scrollbar-thumb, currentColor) var(--ri-scrollbar-track, transparent)",
			},
		]);
	});

	it("setting only the track emits the same composed shorthand", () => {
		const r = resolveUtility("scrollbar-track-transparent", null, false, theme);
		expect(r!.declarations).toEqual([
			{ property: "--ri-scrollbar-track", value: "transparent" },
			{
				property: "scrollbar-color",
				value: "var(--ri-scrollbar-thumb, currentColor) var(--ri-scrollbar-track, transparent)",
			},
		]);
	});
});

describe("light-dark() routes to the color path (isBracketedColor)", () => {
	it("text-[light-dark(white,black)] → color, not font-size", () => {
		const r = resolve("text-[light-dark(white,black)]");
		expect(r!.declarations).toEqual([{ property: "color", value: "light-dark(white,black)" }]);
	});

	it("decoration-[light-dark(white,black)] → text-decoration-color", () => {
		const r = resolve("decoration-[light-dark(white,black)]");
		expect(r!.declarations).toEqual([
			{ property: "text-decoration-color", value: "light-dark(white,black)" },
		]);
	});

	it("text-[1.5rem] still resolves as font-size", () => {
		const r = resolve("text-[1.5rem]");
		expect(r!.declarations).toEqual([{ property: "font-size", value: "1.5rem" }]);
	});
});

describe("shared merge predicates (RE_IMAGE_VALUE / isFontFamilyValue)", () => {
	it("bg-[url(/x.png)] → background-image", () => {
		const r = resolve("bg-[url(/x.png)]");
		expect(r!.declarations).toEqual([{ property: "background-image", value: "url(/x.png)" }]);
	});

	it("bg-[#aabbcc] still resolves as background-color", () => {
		const r = resolve("bg-[#aabbcc]");
		expect(r!.declarations).toEqual([{ property: "background-color", value: "#aabbcc" }]);
	});

	it("font-[Georgia,_serif] → font-family with underscores decoded", () => {
		const r = resolve("font-[Georgia,_serif]");
		expect(r!.declarations[0].property).toBe("font-family");
		expect(r!.declarations[0].value).toBe("Georgia, serif");
	});

	it("font-[family-name:Georgia,_serif] hint also decodes underscores", () => {
		const r = resolve("font-[family-name:Georgia,_serif]");
		expect(r!.declarations).toEqual([{ property: "font-family", value: "Georgia, serif" }]);
	});

	it("font-[650] still resolves as font-weight", () => {
		const r = resolve("font-[650]");
		expect(r!.declarations).toEqual([{ property: "font-weight", value: "650" }]);
	});

	it("font-(family-name:--brand) honors the hint as font-family", () => {
		const r = resolve("font-(family-name:--brand)");
		expect(r!.declarations).toEqual([{ property: "font-family", value: "var(--brand)" }]);
	});
});
