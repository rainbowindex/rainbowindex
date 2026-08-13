import { describe, expect, test } from "vitest";
import { analyzeProjectCSS } from "../../src/project/analyze.js";
import { createClassInspector } from "../../src/engine/inspector.js";
import { listVariants } from "../../src/engine/variants.js";
import { createCompiler } from "../../src/engine/index.js";

const defaultTheme = analyzeProjectCSS("").theme;

const customTheme = analyzeProjectCSS(`
@color { brand: 0.18 330; }
@breakpoint { tablet: 50rem; }
@utility card { background: red; padding: 1rem; }
@custom hocus { &:hover, &:focus { @slot; } }
`).theme;

describe("createClassInspector — validate", () => {
	const inspector = createClassInspector(defaultTheme);

	test.each([
		"flex",
		"px-4",
		"hover:bg-theme-500",
		"sm:flex",
		"@md:flex",
		"w-[37rem]",
		"[color:red]",
		"flex!",
		"-translate-x-2",
		"data-[state=open]:flex",
		"group-hover:underline",
		"dark:sm:hover:bg-theme-500",
	])("accepts %s", (cls) => {
		expect(inspector.validate(cls)).toEqual({ ok: true });
	});

	test("unknown utility with typo suggestion", () => {
		expect(inspector.validate("felx")).toEqual({
			ok: false,
			reason: "unknown-utility",
			offender: "felx",
			suggestion: "flex",
		});
	});

	test("unknown utility keeps the offender base under variants and important", () => {
		const result = inspector.validate("hover:felx!");
		expect(result).toMatchObject({ ok: false, reason: "unknown-utility", offender: "felx" });
	});

	test("unknown utility with no near match gets no suggestion", () => {
		const result = inspector.validate("definitely-not-a-thing");
		expect(result).toMatchObject({ ok: false, reason: "unknown-utility" });
		expect((result as { suggestion?: string }).suggestion).toBeUndefined();
	});

	test("unknown variant with typo suggestion", () => {
		expect(inspector.validate("hver:flex")).toEqual({
			ok: false,
			reason: "unknown-variant",
			offender: "hver",
			suggestion: "hover",
		});
	});

	test("malformed arbitrary value", () => {
		expect(inspector.validate("foo-[3px]")).toMatchObject({
			ok: false,
			reason: "invalid-arbitrary",
		});
	});

	test("resolutions are cached", () => {
		const first = inspector.validate("hver:flex");
		expect(inspector.validate("hver:flex")).toBe(first);
	});
});

describe("createClassInspector — custom theme", () => {
	const inspector = createClassInspector(customTheme);

	test("theme colors drive functional utilities", () => {
		expect(inspector.validate("bg-brand-500")).toEqual({ ok: true });
		expect(inspector.validate("text-brand-300")).toEqual({ ok: true });
	});

	test("custom breakpoint works as variant and container", () => {
		expect(inspector.validate("tablet:flex")).toEqual({ ok: true });
		expect(inspector.validate("@tablet:flex")).toEqual({ ok: true });
	});

	test("custom @utility resolves", () => {
		expect(inspector.validate("card")).toEqual({ ok: true });
	});

	test("custom @custom variant resolves and its typo is suggested", () => {
		expect(inspector.validate("hocus:flex")).toEqual({ ok: true });
		expect(inspector.validate("hocsu:flex")).toEqual({
			ok: false,
			reason: "unknown-variant",
			offender: "hocsu",
			suggestion: "hocus",
		});
	});

	test("custom static utility joins the suggestion corpus", () => {
		expect(inspector.validate("carrd")).toEqual({
			ok: false,
			reason: "unknown-utility",
			offender: "carrd",
			suggestion: "card",
		});
	});
});

describe("createClassInspector — explain", () => {
	const inspector = createClassInspector(defaultTheme);

	test("explains a plain utility", () => {
		const explanation = inspector.explain("px-4");
		expect(explanation).not.toBeNull();
		expect(explanation?.selector).toBe(".px-4");
		expect(explanation?.css).toContain(".px-4");
		expect(explanation?.declarations.length).toBeGreaterThan(0);
		for (const decl of explanation?.declarations ?? []) {
			expect(decl.property).toContain("padding");
		}
		expect(typeof explanation?.sortKey).toBe("number");
		expect(explanation?.parsed.utility).toBe("px");
		expect(explanation?.parsed.value).toBe("4");
	});

	test("variant wrapping shows up in the rule text", () => {
		expect(inspector.explain("hover:bg-theme-500")?.css).toContain(":hover");
		expect(inspector.explain("sm:flex")?.css).toContain("@media (min-width:");
		expect(inspector.explain("dark:flex")?.css).toContain("prefers-color-scheme: dark");
	});

	test("important propagates into declarations", () => {
		expect(inspector.explain("flex!")?.css).toContain("!important");
	});

	test("invalid classes explain as null", () => {
		expect(inspector.explain("felx")).toBeNull();
		expect(inspector.explain("hver:flex")).toBeNull();
	});
});

describe("validate ⟺ compile parity", () => {
	// The inspector's contract: validate(cls).ok exactly when the compiler
	// emits a rule for cls. Checked against both themes over a mixed corpus.
	const corpus = [
		"flex",
		"px-4",
		"felx",
		"hover:bg-theme-500",
		"hver:flex",
		"unknownthing",
		"w-[37rem]",
		"foo-[3px]",
		"[color:red]",
		"data-[state=open]:opacity-50",
		"card",
		"hocus:flex",
		"tablet:flex",
		"bg-brand-500",
		"-translate-x-2",
		"flex!",
		"@md:flex",
		"group-hover:underline",
		"nth-[2n+1]:flex",
		"supports-[display:grid]:grid",
	];

	test.each([
		["default", defaultTheme],
		["custom", customTheme],
	] as const)("%s theme", (_label, theme) => {
		const inspector = createClassInspector(theme);
		const compiler = createCompiler();
		for (const cls of corpus) {
			const compiled = compiler.compile([cls], theme).rules.length > 0;
			expect(inspector.validate(cls).ok, `parity for "${cls}"`).toBe(compiled);
		}
	});
});

describe("listVariants", () => {
	test("enumerates concrete variants across kinds", () => {
		const variants = listVariants(customTheme);
		const byName = new Map(variants.map((v) => [v.name, v]));

		expect(byName.get("hover")).toMatchObject({ kind: "pseudo-class", wraps: ":hover" });
		expect(byName.get("before")).toMatchObject({ kind: "pseudo-element", wraps: "::before" });
		expect(byName.get("dark")).toMatchObject({ kind: "media" });
		expect(byName.get("tablet")).toMatchObject({
			kind: "breakpoint",
			wraps: "@media (min-width: 50rem)",
		});
		expect(byName.get("@tablet")).toMatchObject({ kind: "container" });
		expect(byName.get("hocus")).toMatchObject({ kind: "custom" });
		expect(byName.get("rtl")).toMatchObject({ kind: "special" });
		expect(byName.get("data-")).toMatchObject({ kind: "pattern" });
	});

	test("every concrete variant validates through the inspector", () => {
		const inspector = createClassInspector(customTheme);
		for (const variant of listVariants(customTheme)) {
			if (variant.kind === "pattern") continue;
			const result = inspector.validate(`${variant.name}:flex`);
			expect(result.ok, `variant "${variant.name}" should resolve`).toBe(true);
		}
	});

	test("custom variants the resolver rejects are not listed", () => {
		// The directive parser caps selectors at 2000 chars; the resolver at
		// 500 — a selector in between parses into the theme but never
		// resolves, so it must not be listed or offered as a suggestion.
		const hugeSelector = `${"&:not(.x)".repeat(70)} { @slot; }`;
		const gappyTheme = analyzeProjectCSS(`@custom huge { ${hugeSelector} }`).theme;
		expect(gappyTheme.customVariants).toHaveLength(1);
		expect(listVariants(gappyTheme).some((v) => v.name === "huge")).toBe(false);

		const inspector = createClassInspector(gappyTheme);
		const result = inspector.validate("huge:flex");
		expect(result).toMatchObject({ ok: false, reason: "unknown-variant" });
		expect((result as { suggestion?: string }).suggestion).not.toBe("huge");
	});

	test("inspector.variants() is cached and frozen", () => {
		const inspector = createClassInspector(defaultTheme);
		const first = inspector.variants();
		expect(inspector.variants()).toBe(first);
		expect(Object.isFrozen(first)).toBe(true);
	});
});

describe("analyzeProjectCSS", () => {
	test("empty css resolves to a usable default theme", () => {
		const { theme, warnings } = analyzeProjectCSS("");
		expect(Object.keys(theme.breakpoints).length).toBeGreaterThan(0);
		expect(warnings).toEqual([]);
	});

	test("collects directives and surfaces parse warnings", () => {
		const { theme, warnings, directives } = analyzeProjectCSS(`
@color { brand: 0.18 330; }
// single-line comments are not CSS
`);
		expect(theme.colors.brand).toBeDefined();
		expect(directives.some((d) => d.type === "color")).toBe(true);
		expect(warnings.some((w) => w.includes("[RI-1011]"))).toBe(true);
	});
});
