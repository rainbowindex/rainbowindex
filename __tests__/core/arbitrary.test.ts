import { describe, expect, it } from "vitest";
import { createCompiler } from "../../src/engine/index.js";
import { parseUtility, decodeArbitraryValue } from "../../src/utilities/parser.js";
import { extractClasses } from "../../src/scanner/class-extraction.js";
import { fixtureTheme } from "../helpers/fixture-colors.js";

const theme = fixtureTheme();
const compile = (classNames: string[], activeTheme = theme) =>
	createCompiler().compile(classNames, activeTheme);

// ---------------------------------------------------------------------------
// decodeArbitraryValue
// ---------------------------------------------------------------------------

describe("decodeArbitraryValue", () => {
	it("converts underscores to spaces", () => {
		expect(decodeArbitraryValue("foo_bar")).toBe("foo bar");
	});

	it("preserves escaped underscores", () => {
		expect(decodeArbitraryValue("foo\\_bar")).toBe("foo_bar");
	});

	it("handles mixed underscores", () => {
		expect(decodeArbitraryValue("a_b\\_c_d")).toBe("a b_c d");
	});

	it("handles empty string", () => {
		expect(decodeArbitraryValue("")).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Arbitrary Properties
// ---------------------------------------------------------------------------

describe("arbitrary properties", () => {
	describe("parsing", () => {
		it("parses [color:red]", () => {
			const r = parseUtility("[color:red]");
			expect(r.arbitraryProperty).toEqual({ property: "color", value: "red" });
		});

		it("parses [mask-type:luminance]", () => {
			const r = parseUtility("[mask-type:luminance]");
			expect(r.arbitraryProperty).toEqual({ property: "mask-type", value: "luminance" });
		});

		it("parses vendor-prefixed property", () => {
			const r = parseUtility("[-webkit-box-decoration-break:clone]");
			expect(r.arbitraryProperty).toEqual({
				property: "-webkit-box-decoration-break",
				value: "clone",
			});
		});

		it("parses CSS custom property declaration", () => {
			const r = parseUtility("[--mask-size:15px]");
			expect(r.arbitraryProperty).toEqual({ property: "--mask-size", value: "15px" });
		});

		it("parses custom property with var() value", () => {
			const r = parseUtility("[--brand:var(--accent)]");
			expect(r.arbitraryProperty).toEqual({ property: "--brand", value: "var(--accent)" });
		});

		it("parses custom property with !important and variant", () => {
			const r = parseUtility("hover:[--ring-color:red]!");
			expect(r.variants).toEqual(["hover"]);
			expect(r.important).toBe(true);
			expect(r.arbitraryProperty).toEqual({ property: "--ring-color", value: "red" });
		});

		it("rejects single-dash custom-property-looking name (must be exactly --)", () => {
			// `-foo` (one dash) is the vendor-prefix form and only matches when followed
			// by a lowercase letter — `-` alone is not a valid property name.
			const r = parseUtility("[-:red]");
			expect(r.arbitraryProperty).toBeNull();
		});

		it("parses with !important", () => {
			const r = parseUtility("[color:red]!");
			expect(r.arbitraryProperty).toEqual({ property: "color", value: "red" });
			expect(r.important).toBe(true);
		});

		it("parses with variants", () => {
			const r = parseUtility("hover:[color:red]");
			expect(r.variants).toEqual(["hover"]);
			expect(r.arbitraryProperty).toEqual({ property: "color", value: "red" });
		});

		it("decodes underscores to spaces in value", () => {
			const r = parseUtility("[background:url(foo)_no-repeat]");
			expect(r.arbitraryProperty?.property).toBe("background");
			expect(r.arbitraryProperty?.value).toContain("no-repeat");
		});
	});

	describe("compilation", () => {
		it("compiles [color:red]", () => {
			const result = compile(["[color:red]"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("color: red");
		});

		it("compiles [mask-type:luminance]", () => {
			const result = compile(["[mask-type:luminance]"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("mask-type: luminance");
		});

		it("compiles [-webkit-box-decoration-break:clone]", () => {
			const result = compile(["[-webkit-box-decoration-break:clone]"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("-webkit-box-decoration-break: clone");
		});

		it("compiles [--mask-size:15px] as a custom property declaration", () => {
			const result = compile(["[--mask-size:15px]"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("--mask-size: 15px");
		});

		it("compiles [--brand:var(--accent)]", () => {
			const result = compile(["[--brand:var(--accent)]"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("--brand: var(--accent)");
		});

		it("compiles with !important", () => {
			const result = compile(["[color:red]!"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("color: red !important");
		});

		it("compiles with variant", () => {
			const result = compile(["hover:[color:red]"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain(":hover");
			expect(result.rules[0].css).toContain("color: red");
		});

		it("compiles with function value", () => {
			const result = compile(["[color:rgb(255,0,0)]"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("color: rgb(255,0,0)");
		});

		it("compiles with var()", () => {
			const result = compile(["[color:var(--my-color)]"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("color: var(--my-color)");
		});
	});

	describe("security", () => {
		it("rejects semicolons in value", () => {
			const result = compile(["[color:red;background:blue]"]);
			expect(result.rules).toHaveLength(0);
		});

		it("rejects curly braces in value", () => {
			const result = compile(["[color:red}html{color:blue]"]);
			expect(result.rules).toHaveLength(0);
		});

		it("rejects invalid property names", () => {
			const r = parseUtility("[123:red]");
			expect(r.arbitraryProperty).toBeNull();
		});

		it("rejects empty value", () => {
			const result = compile(["[color:]"]);
			expect(result.rules).toHaveLength(0);
		});
	});
});

// ---------------------------------------------------------------------------
// Arbitrary Variants
// ---------------------------------------------------------------------------

describe("arbitrary variants", () => {
	describe("parsing", () => {
		it("parses [&_p]:mt-4", () => {
			const r = parseUtility("[&_p]:mt-4");
			expect(r.variants).toEqual(["[&_p]"]);
			expect(r.utility).toBe("mt");
		});

		it("parses [&>*]:flex", () => {
			const r = parseUtility("[&>*]:flex");
			expect(r.variants).toEqual(["[&>*]"]);
			expect(r.utility).toBe("flex");
		});

		it("parses [@media(width>=123px)]:flex", () => {
			const r = parseUtility("[@media(width>=123px)]:flex");
			expect(r.variants).toEqual(["[@media(width>=123px)]"]);
			expect(r.utility).toBe("flex");
		});
	});

	describe("compilation", () => {
		it("compiles [&_p]:mt-4 with descendant selector", () => {
			const result = compile(["[&_p]:mt-4"]);
			expect(result.rules).toHaveLength(1);
			const css = result.rules[0].css;
			// & p selector — the & is replaced with the base selector
			expect(css).toContain(" p");
			expect(css).toContain("margin");
		});

		it("compiles [&>*]:flex with child selector", () => {
			const result = compile(["[&>*]:flex"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain(">");
			expect(result.rules[0].css).toContain("display: flex");
		});

		it("compiles [&:hover]:flex with pseudo-class", () => {
			const result = compile(["[&:hover]:flex"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain(":hover");
			expect(result.rules[0].css).toContain("display: flex");
		});

		it("compiles [@media(width>=123px)]:flex with at-rule", () => {
			const result = compile(["[@media(width>=123px)]:flex"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("@media(width>=123px)");
			expect(result.rules[0].css).toContain("display: flex");
		});

		it("compiles [@supports(display:flex)]:grid", () => {
			const result = compile(["[@supports(display:flex)]:grid"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("@supports(display:flex)");
			expect(result.rules[0].css).toContain("display: grid");
		});

		it("compiles plain selector without &: [p]:mt-4 self-matches via :is()", () => {
			const result = compile(["[p]:mt-4"]);
			expect(result.rules).toHaveLength(1);
			// Exact: self-match (no descendant space before :is)
			expect(result.rules[0].selector).toBe(".\\[p\\]\\:mt-4:is(p)");
		});

		it("compiles relative selector [>div]:flex", () => {
			const result = compile(["[>div]:flex"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain(">div");
			expect(result.rules[0].css).toContain("display: flex");
		});
	});

	describe("security", () => {
		it("rejects curly braces in selector", () => {
			const result = compile(["[&{color:red}]:flex"]);
			expect(result.rules).toHaveLength(0);
		});

		it("rejects unsafe at-rules", () => {
			const result = compile(["[@import_url(evil.css)]:flex"]);
			expect(result.rules).toHaveLength(0);
		});
	});
});

// ---------------------------------------------------------------------------
// CSS Variable Shorthand
// ---------------------------------------------------------------------------

describe("CSS variable shorthand", () => {
	describe("parsing", () => {
		it("parses bg-(--my-color)", () => {
			const r = parseUtility("bg-(--my-color)");
			expect(r.utility).toBe("bg");
			expect(r.value).toBe("[var(--my-color)]");
			expect(r.arbitrary).toBe(true);
		});

		it("parses with type hint bg-(color:--my-color)", () => {
			const r = parseUtility("bg-(color:--my-color)");
			expect(r.utility).toBe("bg");
			expect(r.value).toContain("var(--my-color)");
			expect(r.arbitrary).toBe(true);
		});

		it("parses p-(--my-spacing)", () => {
			const r = parseUtility("p-(--my-spacing)");
			expect(r.utility).toBe("p");
			expect(r.value).toBe("[var(--my-spacing)]");
			expect(r.arbitrary).toBe(true);
		});
	});

	describe("compilation", () => {
		it("compiles bg-(--my-color) to background-color: var(--my-color)", () => {
			const result = compile(["bg-(--my-color)"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("background-color: var(--my-color)");
		});

		it("compiles p-(--my-spacing)", () => {
			const result = compile(["p-(--my-spacing)"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain("var(--my-spacing)");
		});

		it("compiles with variant hover:bg-(--my-color)", () => {
			const result = compile(["hover:bg-(--my-color)"]);
			expect(result.rules).toHaveLength(1);
			expect(result.rules[0].css).toContain(":hover");
			expect(result.rules[0].css).toContain("var(--my-color)");
		});
	});
});

// ---------------------------------------------------------------------------
// Arbitrary Modifiers
// ---------------------------------------------------------------------------

describe("arbitrary modifiers", () => {
	it("compiles bg-error-500/[50%]", () => {
		const result = compile(["bg-error-500/[50%]"]);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("color-mix");
		expect(result.rules[0].css).toContain("50%");
	});

	it("compiles bg-error-500/[0.5]", () => {
		const result = compile(["bg-error-500/[0.5]"]);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("color-mix");
		expect(result.rules[0].css).toContain("50%");
	});

	it("compiles bg-error-500/[0.55] to a rounded percentage", () => {
		// 0.55 * 100 floats to 55.00000000000001 — emission must round it away.
		const result = compile(["bg-error-500/[0.55]"]);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain(" 55%, transparent");
		expect(result.rules[0].css).not.toContain("55.0");
	});

	it("compiles text-info-500/(--my-opacity)", () => {
		const result = compile(["text-info-500/(--my-opacity)"]);
		expect(result.rules).toHaveLength(1);
		expect(result.rules[0].css).toContain("color-mix");
		expect(result.rules[0].css).toContain("var(--my-opacity)");
	});
});

// ---------------------------------------------------------------------------
// Scanner extraction
// ---------------------------------------------------------------------------

describe("scanner extracts new syntax", () => {
	it("extracts arbitrary properties", () => {
		const classes = extractClasses("[color:red] [mask-type:luminance]");
		expect(classes.has("[color:red]")).toBe(true);
		expect(classes.has("[mask-type:luminance]")).toBe(true);
	});

	it("extracts arbitrary variants", () => {
		const classes = extractClasses("[&_p]:mt-4 [@media(width>=123px)]:flex");
		expect(classes.has("[&_p]:mt-4")).toBe(true);
	});

	it("extracts CSS variable shorthand", () => {
		const classes = extractClasses("bg-(--my-color)");
		expect(classes.has("bg-(--my-color)")).toBe(true);
	});

	it("extracts arbitrary modifiers", () => {
		const classes = extractClasses("bg-error-500/[50%] text-info-500/(--opacity)");
		expect(classes.has("bg-error-500/[50%]")).toBe(true);
		expect(classes.has("text-info-500/(--opacity)")).toBe(true);
	});
});
