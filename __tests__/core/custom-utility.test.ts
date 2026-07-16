import { describe, expect, it } from "vitest";
import postcss, { type AtRule, type Declaration, type Rule } from "postcss";
import { resolveUtility, extractCustomUtilityRootInfo } from "../../src/utilities/index.js";
import { resolveDirectives, extractDirectives } from "../../src/directives/index.js";
import { processApply } from "../../src/integrations/postcss/apply.js";
import { compileProject } from "../../src/project/index.js";

describe("custom utility resolution", () => {
	it("resolves a custom utility with direct declarations", () => {
		const dirs = extractDirectives("@utility card { background: red; padding: 1rem; }", []);
		const theme = resolveDirectives(dirs);
		const r = resolveUtility("card", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations).toContainEqual({ property: "background", value: "red" });
		expect(r!.declarations).toContainEqual({ property: "padding", value: "1rem" });
	});

	it("resolves a custom utility whose body is only @apply", () => {
		const dirs = extractDirectives("@utility pg-mg { @apply px-8 py-7; }", []);
		const theme = resolveDirectives(dirs);
		const r = resolveUtility("pg-mg", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations.length).toBeGreaterThan(0);
		const props = r!.declarations.map((d) => d.property);
		expect(props).toContain("padding-inline");
		expect(props).toContain("padding-block");
	});

	it("resolves a custom utility with @apply when parsed as utility+value (className path)", () => {
		const dirs = extractDirectives("@utility pg-mg { @apply px-8 py-7; }", []);
		const theme = resolveDirectives(dirs);
		// When scanned from className="pg-mg", the parser splits into utility="pg", value="mg"
		const r = resolveUtility("pg", "mg", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations.length).toBeGreaterThan(0);
		const props = r!.declarations.map((d) => d.property);
		expect(props).toContain("padding-inline");
		expect(props).toContain("padding-block");
	});

	it("resolves a custom utility mixing declarations and @apply via resolveUtility", () => {
		const dirs = extractDirectives("@utility card { @apply rounded-lg; background: white; }", []);
		const theme = resolveDirectives(dirs);
		const r = resolveUtility("card", null, false, theme);
		expect(r).not.toBeNull();
		const props = r!.declarations.map((d) => d.property);
		expect(props).toContain("background");
		expect(props).toContain("border-radius");
	});

	it("expands @apply of a custom utility via processApply", () => {
		const dirs = extractDirectives("@utility card { background: red; padding: 1rem; }", []);
		const theme = resolveDirectives(dirs);
		const root = postcss.parse(".btn { @apply card; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		const css = root.toString();
		expect(warnings.filter((w) => w.includes("Unknown utility"))).toEqual([]);
		expect(css).toContain("background: red");
		expect(css).toContain("padding: 1rem");
	});

	it("expands @apply of a custom utility with @apply in body", () => {
		const dirs = extractDirectives("@utility pg-mg { @apply px-8 py-7; }", []);
		const theme = resolveDirectives(dirs);
		const root = postcss.parse(".section { @apply pg-mg; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		const css = root.toString();
		expect(warnings.filter((w) => w.includes("Unknown utility"))).toEqual([]);
		expect(css).toContain("padding-inline");
		expect(css).toContain("padding-block");
	});

	it("expands @apply of a custom utility mixing declarations and @apply", () => {
		const dirs = extractDirectives(
			"@utility card { @apply rounded-lg shadow-md; background: white; }",
			[],
		);
		const theme = resolveDirectives(dirs);
		const root = postcss.parse(".box { @apply card; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		const css = root.toString();
		expect(warnings.filter((w) => w.includes("Unknown utility"))).toEqual([]);
		expect(css).toContain("background: white");
		expect(css).toContain("border-radius");
		expect(css).toContain("box-shadow");
	});

	it("resolves multiple utilities from a grouped @utility block", () => {
		const dirs = extractDirectives(
			`@utility {
				flex-center {
					display: flex;
					align-items: center;
				}
				text-shadow {
					text-shadow: 0 2px 4px rgb(0 0 0 / 0.1);
				}
			}`,
			[],
		);
		const theme = resolveDirectives(dirs);
		const r1 = resolveUtility("flex-center", null, false, theme);
		expect(r1).not.toBeNull();
		expect(r1!.declarations).toContainEqual({ property: "display", value: "flex" });
		expect(r1!.declarations).toContainEqual({ property: "align-items", value: "center" });

		const r2 = resolveUtility("text-shadow", null, false, theme);
		expect(r2).not.toBeNull();
		expect(r2!.declarations).toContainEqual({
			property: "text-shadow",
			value: "0 2px 4px rgb(0 0 0 / 0.1)",
		});
	});

	it("resolves grouped @utility alongside named @utility directives", () => {
		const dirs = extractDirectives(
			`@utility card { background: white; }
			@utility {
				flex-center {
					display: flex;
					align-items: center;
				}
			}`,
			[],
		);
		const theme = resolveDirectives(dirs);
		expect(resolveUtility("card", null, false, theme)).not.toBeNull();
		expect(resolveUtility("flex-center", null, false, theme)).not.toBeNull();
	});

	it("handles empty grouped @utility block gracefully", () => {
		const warnings: string[] = [];
		const dirs = extractDirectives("@utility { }", warnings);
		const theme = resolveDirectives(dirs);
		expect(theme.customUtilities).toEqual([]);
	});

	it("detects circular @apply between custom utilities", () => {
		const dirs = extractDirectives("@utility a { @apply b; } @utility b { @apply a; }", []);
		const theme = resolveDirectives(dirs);
		const root = postcss.parse(".x { @apply a; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		// Circular @apply is caught at the resolution level — the utility
		// resolves to null (no declarations) and processApply reports it
		// as an unknown utility.
		expect(warnings.some((w) => w.includes("Circular") || w.includes("Unknown utility"))).toBe(
			true,
		);
	});

	it("handles circular @apply gracefully via resolveUtility (className path)", () => {
		const dirs = extractDirectives("@utility a { @apply b; } @utility b { @apply a; }", []);
		const theme = resolveDirectives(dirs);
		// Should not throw or infinite-loop
		const r = resolveUtility("a", null, false, theme);
		// Returns null because the circular reference produces no declarations
		expect(r).toBeNull();
	});

	it("expands @a alias inside a custom utility body (className path)", () => {
		const dirs = extractDirectives("@utility glass { @a backdrop-blur-lg; }", []);
		const theme = resolveDirectives(dirs);
		const r = resolveUtility("glass", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations.length).toBeGreaterThan(0);
	});

	it("expands @a alias inside a custom utility body (PostCSS @apply path)", () => {
		const dirs = extractDirectives("@utility glass { @a backdrop-blur-lg; }", []);
		const theme = resolveDirectives(dirs);
		const root = postcss.parse("header { @apply fixed glass; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		expect(warnings.some((w) => w.includes('Unknown utility "glass"'))).toBe(false);
		const css = root.toString();
		expect(css).toContain("backdrop-filter");
	});

	it("expands @a alias inside a grouped custom utility body", () => {
		const dirs = extractDirectives("@utility { glass { @a backdrop-blur-lg; } }", []);
		const theme = resolveDirectives(dirs);
		const r = resolveUtility("glass", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations.length).toBeGreaterThan(0);
	});

	it("applies variant suffix to every branch of a comma-separated parent selector", () => {
		const theme = resolveDirectives(extractDirectives("", []));
		const root = postcss.parse("a, button { @apply hover:text-white; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		const css = root.toString();
		expect(css).toMatch(/a:hover\s*,\s*button:hover\s*\{/);
		expect(css).not.toMatch(/(^|\n)\s*a\s*,\s*button:hover\s*\{/);
	});

	it("applies & replacement to every branch of a comma-separated parent selector", () => {
		const theme = resolveDirectives(
			extractDirectives("@custom hocus { &:hover, &:focus { @slot; } }", []),
		);
		const root = postcss.parse("a, button { @apply hocus:text-white; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		const css = root.toString();
		expect(css).toMatch(/a:hover/);
		expect(css).toMatch(/button:hover/);
		expect(css).toMatch(/a:focus/);
		expect(css).toMatch(/button:focus/);
	});
});

describe("custom utility / built-in name collisions (RI-1032)", () => {
	it("warns that a custom utility shadowing a built-in static is ignored", () => {
		const theme = resolveDirectives(extractDirectives("@utility flex { gap: 4px; }", []));
		const w = theme.warnings.find((x) => x.includes("[RI-1032]"));
		expect(w).toBeDefined();
		expect(w).toContain('@utility "flex"');
		expect(w).toContain("is ignored");
	});

	it("does not warn for a prefix-family name — custom and built-in coexist", () => {
		const theme = resolveDirectives(extractDirectives("@utility min-h { min-height: 50vh; }", []));
		expect(theme.warnings.some((x) => x.includes("[RI-1032]"))).toBe(false);
	});

	it("does not warn for a custom utility name that does not collide", () => {
		const theme = resolveDirectives(extractDirectives("@utility card { background: red; }", []));
		expect(theme.warnings.some((x) => x.includes("[RI-1032]"))).toBe(false);
	});

	it("flags only the colliding name inside a grouped @utility block", () => {
		const theme = resolveDirectives(
			extractDirectives("@utility { flex { gap: 2px; } card { color: red; } }", []),
		);
		const hits = theme.warnings.filter((x) => x.includes("[RI-1032]"));
		expect(hits.length).toBe(1);
		expect(hits[0]).toContain('@utility "flex"');
	});
});

describe("custom utility / built-in coexistence (value-gated lookup)", () => {
	it("a custom utility named like a built-in prefix only claims its bare class", () => {
		const theme = resolveDirectives(extractDirectives("@utility min-h { min-height: 50vh; }", []));
		// Bare `min-h` resolves to the custom utility...
		const bare = resolveUtility("min-h", null, false, theme);
		expect(bare).not.toBeNull();
		expect(bare!.declarations).toContainEqual({ property: "min-height", value: "50vh" });
		// ...but `min-h-4` still resolves to the built-in, not the custom utility.
		const built = resolveUtility("min-h", "4", false, theme);
		expect(built).not.toBeNull();
		expect(built!.declarations[0].property).toBe("min-height");
		expect(built!.declarations[0].value).not.toBe("50vh");
	});

	it("no false circular @apply when a custom utility wraps the built-in it shadows", () => {
		const theme = resolveDirectives(
			extractDirectives(
				"@utility min-h { @a min-h-[calc(var(--ri-vh)_-_env(safe-area-inset-top))]; }",
				[],
			),
		);
		const root = postcss.parse(".app { @apply min-h; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		expect(warnings.some((w) => w.includes("[RI-1005]"))).toBe(false);
		expect(root.toString()).toContain("min-height: calc(var(--ri-vh) - env(safe-area-inset-top))");
	});
});

describe("custom utility — leading dot tolerated (@utility .foo ≡ @utility foo)", () => {
	it("named form: a leading dot is stripped from the utility name", () => {
		const theme = resolveDirectives(extractDirectives("@utility .card { background: red; }", []));
		expect(theme.customUtilities).toContainEqual({
			name: "card",
			functional: false,
			body: "background: red;",
		});
		const r = resolveUtility("card", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations).toContainEqual({ property: "background", value: "red" });
	});

	it("grouped form: a leading dot is stripped from each name", () => {
		const theme = resolveDirectives(
			extractDirectives("@utility { .min-h-safe { color: red; } }", []),
		);
		const r = resolveUtility("min-h", "safe", false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations).toContainEqual({ property: "color", value: "red" });
		// And it applies cleanly via @apply with the dotless class name.
		const root = postcss.parse(".x { @apply min-h-safe; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		expect(warnings.some((w) => w.includes("Unknown utility"))).toBe(false);
		expect(root.toString()).toContain("color: red");
	});

	it("grouped form: dotted and undotted names mix in one block", () => {
		const theme = resolveDirectives(
			extractDirectives("@utility { .a { color: red; } b { color: blue; } }", []),
		);
		expect(resolveUtility("a", null, false, theme)).not.toBeNull();
		expect(resolveUtility("b", null, false, theme)).not.toBeNull();
	});

	it("strips the dot before the functional -* suffix", () => {
		const theme = resolveDirectives(extractDirectives("@utility { .tab-size-* { x: 1; } }", []));
		expect(theme.customUtilities).toContainEqual({
			name: "tab-size",
			functional: true,
			body: "x: 1;",
		});
	});
});

describe("custom utility @apply body — no duplicate declarations (PostCSS @apply path)", () => {
	it("emits a single declaration exactly once for an @apply-bodied custom utility", () => {
		const theme = resolveDirectives(
			extractDirectives(
				"@utility min-h { @a min-h-[calc(var(--ri-vh)_-_env(safe-area-inset-top))]; }",
				[],
			),
		);
		const root = postcss.parse(".app { @apply min-h; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		// resolveUtilityDeclarations already expands the body; the apply path must
		// not re-expand it. Exactly one min-height declaration, with the right value.
		const values: string[] = [];
		root.walkDecls("min-height", (d) => values.push(d.value));
		expect(values).toEqual(["calc(var(--ri-vh) - env(safe-area-inset-top))"]);
	});

	it("emits each declaration once for a multi-declaration @apply-bodied custom utility", () => {
		const theme = resolveDirectives(extractDirectives("@utility pad { @apply px-8 py-7; }", []));
		const root = postcss.parse(".section { @apply pad; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		const props: string[] = [];
		root.walkDecls((d) => props.push(d.prop));
		expect(props.filter((p) => p === "padding-inline")).toHaveLength(1);
		expect(props.filter((p) => p === "padding-block")).toHaveLength(1);
	});

	it("emits each declaration once when a custom utility mixes raw decls and @apply", () => {
		const theme = resolveDirectives(
			extractDirectives("@utility card { @apply rounded-lg; background: white; }", []),
		);
		const root = postcss.parse(".box { @apply card; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		const props: string[] = [];
		root.walkDecls((d) => props.push(d.prop));
		expect(props.filter((p) => p === "background")).toHaveLength(1);
		expect(props.filter((p) => p === "border-radius")).toHaveLength(1);
	});
});

describe("custom utility nested rules", () => {
	const focusCSS = `@utility {
		route-focus-inner {
			@a outline-none;
			&:focus-visible {
				[data-slot="inner"] {
					@a ring-2;
				}
			}
		}
	}`;

	function focusTheme() {
		return resolveDirectives(extractDirectives(focusCSS, []));
	}

	it("resolves nested blocks with per-block @apply expansion (className path)", () => {
		const r = resolveUtility("route-focus-inner", null, false, focusTheme());
		expect(r).not.toBeNull();
		const rootProps = r!.declarations.map((d) => d.property);
		expect(rootProps).toContain("outline-style");
		// The nested @a ring-2 must NOT hoist onto the root element.
		expect(rootProps).not.toContain("box-shadow");
		expect(r!.nested).toHaveLength(1);
		const focus = r!.nested![0];
		expect(focus.selector).toBe("&:focus-visible");
		expect(focus.declarations).toEqual([]);
		expect(focus.nested).toHaveLength(1);
		const inner = focus.nested[0];
		expect(inner.selector).toBe('[data-slot="inner"]');
		expect(inner.declarations.map((d) => d.property)).toContain("box-shadow");
	});

	it("does not emit a nested block as a garbage declaration (regression)", () => {
		const theme = resolveDirectives(
			extractDirectives("@utility card { color: red; &:hover { color: blue; } }", []),
		);
		const r = resolveUtility("card", null, false, theme);
		expect(r!.declarations).toEqual([{ property: "color", value: "red" }]);
		expect(r!.nested).toEqual([
			{ selector: "&:hover", declarations: [{ property: "color", value: "blue" }], nested: [] },
		]);
	});

	it("does not split declarations on semicolons inside quoted strings", () => {
		const theme = resolveDirectives(
			extractDirectives('@utility deco { content: "a;b"; color: red; }', []),
		);
		const r = resolveUtility("deco", null, false, theme);
		expect(r!.declarations).toEqual([
			{ property: "content", value: '"a;b"' },
			{ property: "color", value: "red" },
		]);
	});

	it("emits nested blocks as native CSS nesting (engine path)", async () => {
		const result = await compileProject({
			css: focusCSS,
			sources: [{ content: '<div class="route-focus-inner"></div>' }],
		});
		const css = result.css;
		const ruleStart = css.indexOf(".route-focus-inner {");
		expect(ruleStart).toBeGreaterThan(-1);
		// Nested closers are indented, so the first "\n}" terminates the rule.
		const rule = css.slice(ruleStart, css.indexOf("\n}", ruleStart) + 2);
		expect(rule).toContain("outline-style: none;");
		expect(rule).toContain("&:focus-visible {");
		expect(rule).toContain('[data-slot="inner"] {');
		expect(rule).toContain("box-shadow:");
		const beforeNested = rule.slice(0, rule.indexOf("&:focus-visible"));
		expect(beforeNested).not.toContain("box-shadow");
	});

	it("inlines nested blocks into the target rule via processApply", () => {
		const root = postcss.parse(".btn { @apply route-focus-inner; }");
		const warnings: string[] = [];
		processApply(root, focusTheme(), warnings, postcss);
		expect(warnings.filter((w) => w.includes("Unknown utility"))).toEqual([]);
		const btn = root.first as Rule;
		const directProps = btn.nodes
			.filter((n) => n.type === "decl")
			.map((n) => (n as Declaration).prop);
		expect(directProps).toContain("outline-style");
		expect(directProps).not.toContain("box-shadow");
		const focus = btn.nodes.find((n) => n.type === "rule") as Rule;
		expect(focus.selector).toBe("&:focus-visible");
		const inner = focus.first as Rule;
		expect(inner.selector).toBe('[data-slot="inner"]');
		expect(inner.nodes.map((n) => (n as Declaration).prop)).toContain("box-shadow");
	});

	it("nests blocks inside the variant rule for variant-prefixed custom utilities", () => {
		const root = postcss.parse(".btn { @apply hover:route-focus-inner; }");
		const warnings: string[] = [];
		processApply(root, focusTheme(), warnings, postcss);
		expect(warnings.filter((w) => w.includes("Unknown utility"))).toEqual([]);
		const hoverRule = root.nodes.find(
			(n) => n.type === "rule" && (n as Rule).selector === ".btn:hover",
		) as Rule;
		expect(hoverRule).toBeDefined();
		const directProps = hoverRule.nodes
			.filter((n) => n.type === "decl")
			.map((n) => (n as Declaration).prop);
		expect(directProps).toContain("outline-style");
		expect(directProps).not.toContain("box-shadow");
		const focus = hoverRule.nodes.find((n) => n.type === "rule") as Rule;
		expect(focus.selector).toBe("&:focus-visible");
	});

	it("supports nested at-rules in custom utility bodies (engine path)", async () => {
		const result = await compileProject({
			css: "@utility resp-pad { padding: 1rem; @media (min-width: 600px) { padding: 2rem; } }",
			sources: [{ content: '<div class="resp-pad"></div>' }],
		});
		const ruleStart = result.css.indexOf(".resp-pad {");
		const rule = result.css.slice(ruleStart, result.css.indexOf("\n}", ruleStart) + 2);
		expect(rule).toContain("padding: 1rem;");
		expect(rule).toContain("@media (min-width: 600px) {");
		expect(rule).toContain("padding: 2rem;");
	});

	it("supports nested at-rules in custom utility bodies (PostCSS @apply path)", () => {
		const theme = resolveDirectives(
			extractDirectives(
				"@utility resp-pad { padding: 1rem; @media (min-width: 600px) { padding: 2rem; } }",
				[],
			),
		);
		const root = postcss.parse(".box { @apply resp-pad; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings, postcss);
		const box = root.first as Rule;
		const media = box.nodes.find((n) => n.type === "atrule") as AtRule;
		expect(media.name).toBe("media");
		expect(media.params).toBe("(min-width: 600px)");
		expect((media.first as Declaration).prop).toBe("padding");
	});

	it("keeps :root tokens referenced only inside nested blocks", async () => {
		const result = await compileProject({
			css: "@color { brand: 0.5 200; }\n@utility hover-brand { color: black; &:hover { color: var(--color-brand-500); } }",
			sources: [{ content: '<div class="hover-brand"></div>' }],
		});
		expect(result.css).toMatch(/--color-brand-500:\s*[^;]+;/);
	});

	it("terminates on circular @apply through nested blocks", () => {
		const theme = resolveDirectives(
			extractDirectives(
				"@utility aa { color: red; &:hover { @apply bb; } } @utility bb { color: blue; &:focus { @apply aa; } }",
				[],
			),
		);
		const r = resolveUtility("aa", null, false, theme);
		expect(r).not.toBeNull();
		expect(r!.declarations).toEqual([{ property: "color", value: "red" }]);
		expect(r!.nested![0].selector).toBe("&:hover");
		expect(r!.nested![0].declarations).toEqual([{ property: "color", value: "blue" }]);
	});

	it("prunes nested blocks that resolve to nothing", () => {
		const theme = resolveDirectives(
			extractDirectives("@utility xx { color: red; &:hover { @apply no-such-utility-zz; } }", []),
		);
		const r = resolveUtility("xx", null, false, theme);
		expect(r!.declarations).toEqual([{ property: "color", value: "red" }]);
		expect(r!.nested).toBeUndefined();
	});

	it("registers only root-level properties for ri() conflict resolution", () => {
		const info = extractCustomUtilityRootInfo(
			"color: red; @apply px-8; &:hover { box-shadow: none; @apply py-2; }",
		);
		expect(info.properties).toEqual(["color"]);
		expect(info.applyClasses).toEqual(["px-8"]);
	});
});
