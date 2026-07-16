import { describe, expect, it } from "vitest";
import postcss from "postcss";
import { extractDirectives, resolveDirectives } from "../../src/directives/index.js";
import rainbowindex from "../../src/integrations/postcss/index.js";

function resolve(css: string) {
	return resolveDirectives(extractDirectives(css));
}

async function compile(css: string): Promise<string> {
	const result = await postcss([rainbowindex({ cwd: process.cwd() })]).process(css, {
		from: undefined,
	});
	return result.css;
}

describe("@register directive — parsing", () => {
	it("grouped name list shares one definition across all names", () => {
		const theme = resolve(`
			@register --ri-scroll-mask-top, --ri-scroll-mask-right, --ri-scroll-mask-bottom, --ri-scroll-mask-left {
				syntax: "<length>";
				inherits: false;
				initial-value: 0px;
			}
		`);
		expect(theme.registeredProperties).toEqual([
			{ name: "--ri-scroll-mask-top", syntax: '"<length>"', inherits: false, initialValue: "0px" },
			{
				name: "--ri-scroll-mask-right",
				syntax: '"<length>"',
				inherits: false,
				initialValue: "0px",
			},
			{
				name: "--ri-scroll-mask-bottom",
				syntax: '"<length>"',
				inherits: false,
				initialValue: "0px",
			},
			{ name: "--ri-scroll-mask-left", syntax: '"<length>"', inherits: false, initialValue: "0px" },
		]);
		expect(theme.warnings).toEqual([]);
	});

	it("shared-defaults block: per-name entries take their value as initial-value", () => {
		const theme = resolve(`
			@register {
				syntax: "<length>";
				inherits: true;
				--gap-sm: 4px;
				--gap-lg: 16px;
			}
		`);
		expect(theme.registeredProperties).toEqual([
			{ name: "--gap-sm", syntax: '"<length>"', inherits: true, initialValue: "4px" },
			{ name: "--gap-lg", syntax: '"<length>"', inherits: true, initialValue: "16px" },
		]);
	});

	it('defaults syntax to "*" (universal) and inherits to false; initial-value optional', () => {
		const theme = resolve(`@register --tw { }`);
		expect(theme.registeredProperties).toEqual([
			{ name: "--tw", syntax: '"*"', inherits: false, initialValue: undefined },
		]);
		expect(theme.warnings).toEqual([]);
	});

	it("normalizes an unquoted syntax descriptor", () => {
		const theme = resolve(`@register --angle { syntax: <angle>; initial-value: 0deg; }`);
		expect(theme.registeredProperties[0]).toMatchObject({ syntax: '"<angle>"' });
	});

	it("RI-1028: rejects names not starting with --", () => {
		const theme = resolve(`@register foo, --bar { syntax: "<length>"; initial-value: 0px; }`);
		expect(theme.registeredProperties.map((r) => r.name)).toEqual(["--bar"]);
		expect(theme.warnings.some((w) => w.includes("[RI-1028]"))).toBe(true);
	});

	it("RI-1029: drops a typed property with no initial-value", () => {
		const theme = resolve(`@register --x { syntax: "<color>"; }`);
		expect(theme.registeredProperties).toEqual([]);
		expect(theme.warnings.some((w) => w.includes("[RI-1029]"))).toBe(true);
	});

	it("RI-1030: duplicate name — last definition wins", () => {
		const theme = resolve(`
			@register --dup { syntax: "<length>"; initial-value: 1px; }
			@register --dup { syntax: "<length>"; initial-value: 9px; }
		`);
		expect(theme.registeredProperties).toEqual([
			{ name: "--dup", syntax: '"<length>"', inherits: false, initialValue: "9px" },
		]);
		expect(theme.warnings.some((w) => w.includes("[RI-1030]"))).toBe(true);
	});

	it("RI-1031: warns when a @register declares no properties", () => {
		const theme = resolve(`@register { syntax: "<length>"; }`);
		expect(theme.registeredProperties).toEqual([]);
		expect(theme.warnings.some((w) => w.includes("[RI-1031]"))).toBe(true);
	});
});

describe("@register directive — emission", () => {
	it("emits one @property rule per registered name", async () => {
		const css = await compile(`
			@register --ri-scroll-mask-top, --ri-scroll-mask-bottom {
				syntax: "<length>";
				inherits: false;
				initial-value: 0px;
			}
			[data-ui="x"] { @apply block; }
		`);
		const blocks = [...css.matchAll(/@property\s+(--ri-scroll-mask-\w+)/g)].map((m) => m[1]);
		expect(blocks).toEqual(["--ri-scroll-mask-top", "--ri-scroll-mask-bottom"]);
		expect(css).toContain(`@property --ri-scroll-mask-top {`);
		expect(css).toContain(`  syntax: "<length>";`);
		expect(css).toContain(`  inherits: false;`);
		expect(css).toContain(`  initial-value: 0px;`);
	});

	it("a registered property is emitted even when no utility references it", async () => {
		const css = await compile(`@register --standalone { syntax: "<number>"; initial-value: 0; }`);
		expect(css).toContain("@property --standalone {");
	});

	it("does not duplicate a @property the engine also emits for its own vars", async () => {
		// `mask-t-from-50%` makes the engine register --ri-mask-top-from-position.
		// Registering the same name via @register must not produce two blocks.
		const css = await compile(`
			@register --ri-mask-top-from-position { syntax: "<length-percentage>"; initial-value: 0%; }
			.m { @apply mask-t-from-50%; }
		`);
		const count = [...css.matchAll(/@property\s+--ri-mask-top-from-position\b/g)].length;
		expect(count).toBe(1);
	});
});
