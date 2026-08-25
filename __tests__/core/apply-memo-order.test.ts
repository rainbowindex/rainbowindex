import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { extractDirectives, resolveDirectives } from "../../src/directives/index.js";
import { processApply } from "../../src/integrations/postcss/apply.js";
import rainbowindex from "../../src/integrations/postcss/index.js";

async function compile(css: string): Promise<{ css: string; warnings: string[] }> {
	const result = await postcss([rainbowindex({ cwd: process.cwd() })]).process(css, {
		from: undefined,
	});
	return { css: result.css, warnings: result.warnings().map((w) => w.text) };
}

describe("@apply memoization and pre-prepend walk ordering", () => {
	it("expands duplicate classes across rules identically, after the generated sections", async () => {
		const { css, warnings } = await compile(`@import "rainbowindex";
@color { background: oklch(0.978 0 0) / oklch(0.182 0 0); }
@slot header { color: red; }
.a { @apply flex px-4 bg-background; }
.b { @apply flex px-4 hover:flex; }
.c { @apply flex nosuchutility; }
.d { @apply nosuchutility px-4; }`);

		// The user CSS tail must be byte-identical in content and order to the
		// pre-memo/pre-reorder output: each duplicate class expands in every
		// rule (a cached-node memo would reparent decls out of earlier rules),
		// and the hover variant rule lands directly after its source rule.
		const tail = css.slice(css.indexOf(".a {"));
		expect(
			tail,
		).toBe(`.a { display: flex; background-color: var(--color-background); padding-inline: calc(4 * var(--spacing)); }
.b { display: flex; padding-inline: calc(4 * var(--spacing)); }
.b:hover {
  display: flex;
}
.c { display: flex; }
.d { padding-inline: calc(4 * var(--spacing)); }`);

		// Generated sections still precede the user CSS after the walk reorder.
		expect(css.indexOf(":root")).toBeGreaterThanOrEqual(0);
		expect(css.indexOf(":root")).toBeLessThan(css.indexOf(".a {"));

		// Walks running before the prepend still see the user AST: the
		// standalone @slot warns and is dropped, unknown utilities warn.
		expect(warnings.some((w) => w.includes("[RI-1037]"))).toBe(true);
		expect(css).not.toContain("@slot");
		expect(warnings.some((w) => w.includes('Unknown utility "nosuchutility"'))).toBe(true);
	});

	it("replays per-occurrence warnings on memo hits", () => {
		const theme = resolveDirectives(extractDirectives("", []));
		const root = postcss.parse(".x { @apply nope; }\n.y { @apply nope; }");
		const warnings: string[] = [];
		processApply(root, theme, warnings);
		expect(warnings.filter((w) => w.includes('Unknown utility "nope"'))).toHaveLength(2);
	});

	it("gives every rule its own declaration nodes on memo hits", () => {
		const theme = resolveDirectives(extractDirectives("", []));
		const root = postcss.parse(
			".x { @apply px-8 hover:flex; }\n.y { @apply px-8 hover:flex; }\n.z { @apply px-8; }",
		);
		const warnings: string[] = [];
		processApply(root, theme, warnings);
		const css = root.toString();
		expect(warnings).toEqual([]);
		// A memo that cached PostCSS nodes would reparent them into the last
		// rule, emptying the earlier ones.
		for (const sel of [".x", ".y", ".z"]) {
			expect(css).toMatch(new RegExp(`\\${sel} \\{[^}]*padding-inline`));
		}
		expect(css.match(/:hover/g)).toHaveLength(2);
	});
});
