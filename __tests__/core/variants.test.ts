import { describe, expect, it } from "vitest";
import { compileProject } from "../../src/project/index.js";

/** Compile a single class and return the generated CSS. */
async function css(cls: string): Promise<string> {
	const r = await compileProject({ css: '@import "rainbowindex";', classNames: [cls] });
	return r.css;
}

describe("variants", () => {
	it.each([
		// pseudo-classes (added)
		["target:flex", ":target"],
		["only-of-type:flex", ":only-of-type"],
		["read-only:flex", ":read-only"],
		["placeholder-shown:flex", ":placeholder-shown"],
		["autofill:flex", ":autofill"],
		["in-range:flex", ":in-range"],
		["user-valid:flex", ":user-valid"],
		// media (added)
		["light:flex", "@media (prefers-color-scheme: light)"],
		["contrast-more:flex", "@media (prefers-contrast: more)"],
		["contrast-less:flex", "@media (prefers-contrast: less)"],
		["forced-colors:flex", "@media (forced-colors: active)"],
		["inverted-colors:flex", "@media (inverted-colors: inverted)"],
		["pointer-fine:flex", "@media (pointer: fine)"],
		["any-pointer-coarse:flex", "@media (any-pointer: coarse)"],
		["noscript:flex", "@media (scripting: none)"],
		// special selectors
		["rtl:flex", ':where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)'],
		["ltr:flex", ':where(:dir(ltr), [dir="ltr"], [dir="ltr"] *)'],
		["open:flex", ":is([open], :popover-open, :open)"],
		["inert:flex", ":is([inert], [inert] *)"],
		["*:flex", ":is(.\\*\\:flex > *)"],
		["**:flex", ":is(.\\*\\*\\:flex *)"],
		// dynamic
		["peer-checked:flex", ".peer:checked ~ "],
		["peer-[:disabled]:flex", ".peer:is(:disabled) ~ "],
		["group-[.foo]:flex", ".group:is(.foo) "],
		["supports-[display:grid]:flex", "@supports (display:grid)"],
		["nth-[2n]:flex", ":nth-child(2n)"],
		["nth-last-[1]:flex", ":nth-last-child(1)"],
		["nth-of-type-[3]:flex", ":nth-of-type(3)"],
		["nth-last-of-type-[2]:flex", ":nth-last-of-type(2)"],
		["min-[600px]:flex", "@media (width >= 600px)"],
		["max-[40rem]:flex", "@media (width < 40rem)"],
		["in-[.parent]:flex", ":where(.parent) "],
	])("%s emits %s", async (cls, expected) => {
		expect(await css(cls)).toContain(expected);
	});

	it("rejects unsafe bracket content in new variants", async () => {
		// curly braces / unbalanced parens must not produce a rule
		expect(await css("nth-[2n);x{color:red}]:flex")).not.toContain("display: flex");
		expect(await css("min-[1px;}]:flex")).not.toContain("display: flex");
		expect(await css("supports-[display:grid}]:flex")).not.toContain("display: flex");
	});
});
