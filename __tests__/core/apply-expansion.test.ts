import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { analyzeProjectCSS } from "../../src/project/analyze.js";
import { processApply } from "../../src/integrations/postcss/apply.js";
import rainbowindex from "../../src/integrations/postcss/index.js";

async function compile(css: string): Promise<{ css: string; warnings: string[] }> {
	const result = await postcss([rainbowindex({ cwd: process.cwd() })]).process(css, {
		from: undefined,
	});
	return { css: result.css, warnings: result.warnings().map((w) => w.text) };
}

const ACTIVATE = `@import "rainbowindex";\n`;

/** A rule emitted with no selector at all — never valid output. */
const EMPTY_SELECTOR = /(^|\n)\s*\{/;

/** Body of the first rule whose selector matches, with whitespace collapsed. */
function ruleBody(css: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const m = css.match(new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^{}]*)\\}`));
	return m ? m[2].replace(/\s+/g, " ").trim() : "";
}

describe("@apply — placement errors", () => {
	it("warns RI-1006 when used at the top level", async () => {
		const { css, warnings } = await compile(`${ACTIVATE}@apply flex;`);
		expect(warnings.some((w) => w.includes("[RI-1006]"))).toBe(true);
		expect(css).not.toContain("@apply");
	});

	it("warns RI-1006 past the class-count limit and drops the directive", async () => {
		const many = Array.from({ length: 501 }, (_, i) => `p-${i}`).join(" ");
		const { css, warnings } = await compile(`${ACTIVATE}.x { @apply ${many}; }`);
		expect(warnings.some((w) => w.includes("limit: 500"))).toBe(true);
		expect(css).not.toContain("@apply");
	});

	it("drops an @apply whose parent rule is detached from any container", () => {
		const theme = analyzeProjectCSS("").theme;
		const rule = postcss.rule({ selector: ".orphan" });
		rule.append(postcss.atRule({ name: "apply", params: "flex" }));
		const root = postcss.root();
		root.append(rule);
		// Detach the rule so the @apply has a parent rule but no grandparent.
		rule.parent = undefined;
		const warnings: string[] = [];
		processApply(root, theme, warnings);
		expect(rule.toString()).not.toContain("@apply");
	});
});

describe("@apply — aliases and marker classes", () => {
	it("@a is expanded exactly like @apply", async () => {
		const { css } = await compile(`${ACTIVATE}.x { @a flex; }`);
		expect(ruleBody(css, ".x")).toContain("display: flex");
	});

	it("the bare `group` marker contributes no declarations", async () => {
		const { css, warnings } = await compile(`${ACTIVATE}.card { @apply group flex; }`);
		expect(ruleBody(css, ".card")).toBe("display: flex;");
		expect(warnings.some((w) => w.includes("[RI-1005]"))).toBe(false);
	});
});

describe("@apply — unknown input", () => {
	it("warns RI-1005 for an unknown utility", async () => {
		const { warnings } = await compile(`${ACTIVATE}.x { @apply totally-not-a-utility; }`);
		expect(warnings.some((w) => w.includes("[RI-1005]"))).toBe(true);
	});

	it("warns RI-1004 for an unknown variant and skips the whole class", async () => {
		const { css, warnings } = await compile(`${ACTIVATE}.x { @apply nosuchvariant:flex; }`);
		expect(warnings.some((w) => w.includes("[RI-1004]"))).toBe(true);
		expect(ruleBody(css, ".x")).not.toContain("display: flex");
	});
});

describe("@apply — nested-selector utilities", () => {
	it("emits space-x-* as a sibling rule after the parent", async () => {
		const { css } = await compile(`${ACTIVATE}.row { @apply flex space-x-4; }`);
		expect(ruleBody(css, ".row")).toContain("display: flex");
		expect(css).toContain(".row > :not(:last-child)");
		expect(css).toMatch(/--ri-space-x/);
	});

	it("keeps a variant-wrapped nested utility inside its variant rule", async () => {
		const { css } = await compile(`${ACTIVATE}.row { @apply hover:space-x-4; }`);
		expect(css).toContain(".row:hover");
		expect(css).toContain("& > :not(:last-child)");
	});

	it("groups two nested-selector utilities into one rule", async () => {
		const { css } = await compile(`${ACTIVATE}.row { @apply space-x-4 divide-x; }`);
		const nested = css.match(/\.row > :not\(:last-child\)/g) ?? [];
		expect(nested).toHaveLength(1);
	});
});

describe("@apply — variant wrappers", () => {
	it("wraps a responsive variant in its media query", async () => {
		const { css } = await compile(`${ACTIVATE}.x { @apply md:flex; }`);
		expect(css).toMatch(/@media[^{]*\{[\s\S]*\.x[\s\S]*display:\s*flex/);
	});

	it("emits a starting-style variant as a nested @starting-style block", async () => {
		const { css } = await compile(`${ACTIVATE}.x { @apply starting:opacity-0; }`);
		expect(css).toContain("@starting-style");
		expect(css).toMatch(/@starting-style[\s\S]*opacity/);
	});

	it("keeps distinct variant sets in separate rules", async () => {
		const { css } = await compile(`${ACTIVATE}.x { @apply hover:flex focus:grid; }`);
		expect(css).toContain(".x:hover");
		expect(css).toContain(".x:focus");
	});

	it("carries `!` importance into the generated declarations", async () => {
		const { css } = await compile(`${ACTIVATE}.x { @apply hover:flex!; }`);
		expect(css).toMatch(/display:\s*flex\s*!important/);
	});
});

describe("@apply — group variants", () => {
	it("rewrites group-* against the ancestor that declares `@apply group`", async () => {
		const { css } = await compile(`${ACTIVATE}
			[data-slot="card"] {
				@apply group;
				.title { @apply group-hover:underline; }
			}
		`);
		// The rule is emitted at the document root with the group root's real
		// selector, not the literal `.group` class.
		expect(css).toContain('[data-slot="card"]:hover .title');
	});

	it("expands a comma-separated group root into one branch per selector", async () => {
		const { css } = await compile(`${ACTIVATE}
			.card, .panel {
				@apply group;
				.title { @apply group-hover:underline; }
			}
		`);
		expect(css).toContain(".card:hover");
		expect(css).toContain(".panel:hover");
	});

	it("resolves group-* declared in the same rule as the group marker", async () => {
		// The group root is the @apply's own rule, so the ancestor walk matches on
		// its first step instead of climbing. There is no descendant to target:
		// the variant lands on the element itself, not on `.self:hover .self`.
		const { css, warnings } = await compile(`${ACTIVATE}
			.self { @apply group group-hover:underline; }
		`);
		expect(warnings.some((w) => w.includes("[RI-1004]") || w.includes("[RI-1005]"))).toBe(false);
		expect(ruleBody(css, ".self:hover")).toBe("text-decoration-line: underline;");
		expect(css).not.toMatch(EMPTY_SELECTOR);
	});

	it("resolves group-* in a nested `&` block of the group root", async () => {
		// Same degenerate shape reached by climbing instead of matching in place:
		// the `&` block resolves to the group root's own selector.
		const { css } = await compile(`${ACTIVATE}
			.card { @apply group; & { @apply group-hover:underline; } }
		`);
		expect(ruleBody(css, ".card:hover")).toBe("text-decoration-line: underline;");
		expect(css).not.toMatch(EMPTY_SELECTOR);
	});

	it("hoists a non-group variant that shares an @apply with a group variant", async () => {
		const { css } = await compile(`${ACTIVATE}
			.card {
				@apply group;
				.title { @apply group-hover:underline hover:italic; }
			}
		`);
		// Both land at the document root so source order decides the cascade.
		expect(css).toContain(".card:hover .title");
		expect(css).toContain(".card .title:hover");
	});

	it("leaves group-* alone when no ancestor declares the group marker", async () => {
		const { css } = await compile(`${ACTIVATE}.title { @apply group-hover:underline; }`);
		expect(css).toContain(".group:hover");
	});
});

describe("@apply — custom utilities", () => {
	it("expands a custom utility body once, not twice", async () => {
		const { css } = await compile(`${ACTIVATE}
			@utility card { @apply flex; }
			.x { @apply card; }
		`);
		const flexes = ruleBody(css, ".x").match(/display: flex/g) ?? [];
		expect(flexes).toHaveLength(1);
	});

	it("emits a custom utility's nested block as native CSS nesting", async () => {
		const { css } = await compile(`${ACTIVATE}
			@utility panel { color: red; &:hover { color: blue; } }
			.x { @apply panel; }
		`);
		expect(css).toContain("&:hover");
		expect(css).toContain("color: blue");
	});

	it("carries nested blocks through a variant wrapper", async () => {
		const { css } = await compile(`${ACTIVATE}
			@utility panel { color: red; &:hover { color: blue; } }
			.x { @apply md:panel; }
		`);
		expect(css).toMatch(/@media[\s\S]*&:hover[\s\S]*color: blue/);
	});

	it("warns RI-1005 on a circular @apply between custom utilities", async () => {
		const { warnings } = await compile(`${ACTIVATE}
			@utility one { color: red; @apply two; }
			@utility two { color: blue; @apply one; }
			.x { @apply one; }
		`);
		expect(warnings.some((w) => w.includes("[RI-1005]") && w.includes("Circular"))).toBe(true);
	});

	it("warns RI-1005 when custom @apply nesting passes the depth limit", async () => {
		const chain = Array.from(
			{ length: 8 },
			(_, i) => `@utility u${i} { color: red; @apply u${i + 1}; }`,
		).join("\n");
		const { warnings } = await compile(`${ACTIVATE}
			${chain}
			@utility u8 { color: green; }
			.x { @apply u0; }
		`);
		expect(warnings.some((w) => w.includes("[RI-1005]") && w.includes("depth limit"))).toBe(true);
	});

	it("expands an @apply that sits inside a custom utility's nested block", async () => {
		const { css } = await compile(`${ACTIVATE}
			@utility panel { color: red; &:hover { @apply flex; } }
			.x { @apply panel; }
		`);
		expect(css).toMatch(/\.x \{[\s\S]*&:hover \{[\s\S]*display: flex/);
	});
});
