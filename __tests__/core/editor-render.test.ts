/**
 * `renderStylesheet` — the editor entry's stylesheet renderer.
 *
 * The claim worth testing is parity, not "it produced some CSS": this is the
 * production compile and assembly with two steps removed, so anything a
 * project does that touches neither font resolution nor `@apply` must come
 * out byte-identical to `compileProject`. That is what makes a playground an
 * honest preview rather than an approximation.
 */

import { describe, expect, test } from "vitest";
import { renderStylesheet } from "../../src/editor/render.js";
import { createEditorSession } from "../../src/editor/session.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";
import { compileProject } from "../../src/project/index.js";
import { stripRIDirectives } from "../../src/css/strip.js";

const THEME_CSS = `
@color { brand: 0.18 330; ink: oklch(0.2 0.02 260); }
@text { lg: 1.125rem, 1.5; }
@rounded { card: 0.75rem; }
`;

/** The pipeline's own answer, for the same input. */
async function viaPipeline(css: string, classNames: string[]): Promise<string> {
	const result = await compileProject({ css, classNames, resolveImport: null });
	return result.css;
}

describe("renderStylesheet", () => {
	test("matches compileProject byte for byte", async () => {
		const classNames = ["flex", "bg-brand-500", "text-lg", "rounded-card", "hover:text-ink"];
		const theme = analyzeProjectCSS(THEME_CSS).theme;
		const rendered = renderStylesheet(theme, classNames, {
			userCSS: stripRIDirectives(THEME_CSS),
		});
		expect(rendered.css).toBe(await viaPipeline(THEME_CSS, classNames));
	});

	test("matches compileProject when the project has CSS of its own", async () => {
		const css = `${THEME_CSS}\n.hero { color: var(--color-ink); padding: --spacing(4); }`;
		const classNames = ["flex"];
		const theme = analyzeProjectCSS(css).theme;
		const rendered = renderStylesheet(theme, classNames, { userCSS: stripRIDirectives(css) });
		expect(rendered.css).toBe(await viaPipeline(css, classNames));
		// The two things the userCSS pass is for: the `--spacing()` call was
		// compiled, and the token the rule names survived pruning.
		expect(rendered.userCSS).toContain("padding: calc(4 * var(--spacing))");
		expect(rendered.css).toContain("--color-ink:");
	});

	test("a token only the user's CSS names is not pruned away", () => {
		const theme = analyzeProjectCSS(THEME_CSS).theme;
		const without = renderStylesheet(theme, ["flex"], { userCSS: "" });
		const with_ = renderStylesheet(theme, ["flex"], {
			userCSS: ".hero { color: var(--color-brand-500); }",
		});
		expect(without.css).not.toContain("--color-brand-500");
		expect(with_.css).toContain("--color-brand-500");
	});

	test("generated sections come first, the project's own CSS last", () => {
		const theme = analyzeProjectCSS(THEME_CSS).theme;
		const rendered = renderStylesheet(theme, ["flex"], { userCSS: ".hero { color: red; }" });
		expect(rendered.css.endsWith(".hero { color: red; }")).toBe(true);
		expect(rendered.css.indexOf(".flex")).toBeLessThan(rendered.css.indexOf(".hero"));
		expect(rendered.sections.join("\n")).not.toContain(".hero");
	});

	test("reports compile warnings with their codes", () => {
		const theme = analyzeProjectCSS(THEME_CSS).theme;
		const rendered = renderStylesheet(theme, ["flurb:flex"]);
		expect(rendered.warnings.join("\n")).toMatch(/\[RI-1004\].*"flurb"/);
	});

	test("authoredClassNames gates the warnings that are only for hand-written classes", () => {
		const theme = analyzeProjectCSS(THEME_CSS).theme;
		const scanned = renderStylesheet(theme, ["xyzunknown-[notavalue]"], {
			authoredClassNames: new Set(),
		});
		const written = renderStylesheet(theme, ["xyzunknown-[notavalue]"]);
		expect(scanned.warnings).toEqual([]);
		expect(written.warnings.join("\n")).toMatch(/\[RI-1002\]/);
	});

	test("is pure: two themes rendered in either order give the same answer", () => {
		const a = analyzeProjectCSS(`@color { brand: 0.18 330; }`).theme;
		const b = analyzeProjectCSS(`@color { brand: 0.9 0.2 90; }`).theme;
		const first = renderStylesheet(a, ["bg-brand-500"]).css;
		const second = renderStylesheet(b, ["bg-brand-500"]).css;
		expect(renderStylesheet(a, ["bg-brand-500"]).css).toBe(first);
		expect(first).not.toBe(second);
	});

	test("a google font slot still emits its @import and its variable", () => {
		// Font *resolution* is the IO this renderer skips; emission is not.
		const theme = analyzeProjectCSS(`@font { sans: "Inter" from google; weight: 400 700; }`).theme;
		const rendered = renderStylesheet(theme, ["font-sans"]);
		expect(rendered.css).toContain("fonts.googleapis.com");
		expect(rendered.css).toContain("--font-sans:");
	});

	test("an @apply in the user's CSS passes through untouched", () => {
		// Documented: the rewrite is PostCSS's job. Passing through beats
		// silently dropping the rule.
		const theme = analyzeProjectCSS(THEME_CSS).theme;
		const rendered = renderStylesheet(theme, ["flex"], { userCSS: ".btn { @apply flex; }" });
		expect(rendered.css).toContain("@apply flex;");
	});
});

describe("EditorSession.render", () => {
	test("defaults the project CSS to the session's own entry", () => {
		const session = createEditorSession({ css: `${THEME_CSS}\n.hero { color: red; }` });
		const rendered = session.render(["bg-brand-500"]);
		expect(rendered.css).toContain(".hero { color: red; }");
		expect(rendered.css).toContain("--color-brand-500");
		// Directives are not part of the output — they were consumed.
		expect(rendered.css).not.toContain("@color");
	});

	test('userCSS: "" asks for the generated output alone', () => {
		const session = createEditorSession({ css: `${THEME_CSS}\n.hero { color: red; }` });
		expect(session.render(["flex"], { userCSS: "" }).css).not.toContain(".hero");
	});

	test("renders against the theme an @import contributed", () => {
		const session = createEditorSession({
			css: `@import "./tokens.css";`,
			cssPath: "/p/app.css",
			resolveImport: (spec) =>
				spec === "./tokens.css"
					? {
							path: "/p/tokens.css",
							content: `@color { brand: 0.18 330; }\n.imported { color: red; }`,
						}
					: null,
		});
		const rendered = session.render(["bg-brand-500"]);
		expect(rendered.css).toContain("--color-brand-500");
		// The imported file's own CSS is part of the entry once inlined.
		expect(rendered.css).toContain(".imported");
	});

	test("follows setCss", () => {
		const session = createEditorSession({ css: `@color { brand: 0.18 330; }` });
		expect(session.render(["bg-brand-500"]).css).toContain("--color-brand-500");
		session.setCss(`@color { ocean: 0.12 220; }`);
		const after = session.render(["bg-brand-500", "bg-ocean-500"]);
		expect(after.css).toContain("--color-ocean-500");
		expect(after.css).not.toContain("--color-brand-500");
	});
});
