import { describe, expect, it } from "vitest";
import { compileProject } from "../../src/project/index.js";

const identityFonts = <T>(fonts: T): T => fonts;

describe("sections / userCSS decoupling", () => {
	it("keeps user CSS out of sections and carries it in userCSS", async () => {
		const css = `@color { brand: 0.18 330; }\n.custom { color: red; }`;
		const result = await compileProject({
			css,
			classNames: ["p-4"],
			resolveFonts: identityFonts,
		});
		expect(result.userCSS).toContain(".custom");
		expect(result.sections.join("\n\n")).not.toContain(".custom");
		expect(result.css).toBe([...result.sections, result.userCSS].join("\n\n"));
	});

	it("returns empty userCSS when input is directives-only", async () => {
		const result = await compileProject({
			css: `@color { brand: 0.18 330; }`,
			classNames: ["p-4"],
			resolveFonts: identityFonts,
		});
		expect(result.userCSS).toBe("");
		expect(result.css).toBe(result.sections.join("\n\n"));
	});
});

describe("@layer wrapping with zero utility rules", () => {
	it("does not wrap preflight in the utilities layer when no rules compile", async () => {
		const css = `@layer {\n  base: base;\n  utilities: utilities;\n}`;
		const result = await compileProject({
			css,
			classNames: [],
			resolveFonts: identityFonts,
		});
		// Preflight (and tokens) belong to the base layer; the old positional
		// pop() wrapped whichever section happened to be last.
		const utilitiesBlock = result.css.match(/@layer utilities \{[\s\S]*?\n\}/)?.[0] ?? "";
		expect(utilitiesBlock).not.toContain("box-sizing");
		expect(result.css).toContain("@layer base {");
	});

	it("still wraps utility rules in the utilities layer when rules exist", async () => {
		const css = `@layer {\n  base: base;\n  utilities: utilities;\n}`;
		const result = await compileProject({
			css,
			classNames: ["p-4"],
			resolveFonts: identityFonts,
		});
		const utilitiesBlock = result.css.match(/@layer utilities \{[\s\S]*?\n\}/)?.[0] ?? "";
		expect(utilitiesBlock).toContain(".p-4");
	});
});
