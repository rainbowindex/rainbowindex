/**
 * `@import` inlining — the analyzer reading directives out of imported files.
 *
 * Two halves are tested separately on purpose: `inlineDirectiveImports` is pure
 * and gets a map-backed resolver, so every policy decision (cycles, depth, byte
 * budget, what is left alone) is asserted without touching a disk. The Node
 * resolver and the four wired surfaces then get their own temp-directory runs.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCSS } from "../../src/cli/build.js";
import { createEditorSession } from "../../src/editor/session.js";
import {
	inlineDirectiveImports,
	type ImportResolution,
	type ImportResolver,
} from "../../src/project/imports.js";
import { compileProject } from "../../src/project/index.js";
import { createNodeImportResolver } from "../../src/project/resolve-import.js";

/** Resolver over an in-memory file map; keys are the resolved identities. */
function mapResolver(files: Record<string, string>): ImportResolver {
	return (specifier, from): ImportResolution | null => {
		// Relative specifiers resolve against the importing file's directory,
		// exactly as the Node resolver does, so cycle keys stay comparable.
		const base = from === undefined ? "/" : dirname(from);
		const path = specifier.startsWith(".") ? join(base, specifier) : `/node_modules/${specifier}`;
		return path in files ? { path, content: files[path] } : null;
	};
}

const codes = (warnings: readonly string[]): string[] =>
	warnings.map((w) => /\[(RI-\d{4})\]/.exec(w)?.[1] ?? w);

describe("inlineDirectiveImports — what it replaces", () => {
	it("inlines a relative import and reports the file", () => {
		const result = inlineDirectiveImports('@import "./tokens.css";\n.x { color: red; }', {
			resolve: mapResolver({ "/tokens.css": "@color { brand: 0.18 330; }" }),
			from: "/index.css",
		});
		expect(result.css).toBe("@color { brand: 0.18 330; }\n.x { color: red; }");
		expect(result.files).toEqual(["/tokens.css"]);
		expect(result.warnings).toEqual([]);
	});

	it("resolves a bare specifier through the resolver", () => {
		const result = inlineDirectiveImports('@import "pkg/preset.css";', {
			resolve: mapResolver({ "/node_modules/pkg/preset.css": "@spacing { base: 0.5rem; }" }),
			from: "/index.css",
		});
		expect(result.css).toBe("@spacing { base: 0.5rem; }");
	});

	it("inlines recursively, deepest content first in source order", () => {
		const result = inlineDirectiveImports('@import "./a.css";', {
			resolve: mapResolver({
				"/a.css": '@import "./b.css";\n@text { body: 1rem; }',
				"/b.css": "@color { brand: 0.18 330; }",
			}),
			from: "/index.css",
		});
		expect(result.css).toBe("@color { brand: 0.18 330; }\n@text { body: 1rem; }");
		expect(result.files).toEqual(["/a.css", "/b.css"]);
	});

	it("returns the input unchanged when there is nothing to inline", () => {
		// Identity matters: analyzeProjectCSSMemo keys on the string, so a
		// rebuild with no imports must not mint a new theme object.
		const css = '@import "rainbowindex";\n.x { color: red; }';
		const result = inlineDirectiveImports(css, { resolve: mapResolver({}) });
		expect(result.css).toBe(css);
	});
});

describe("inlineDirectiveImports — what it leaves alone", () => {
	it("keeps the activating import at the entry and drops a nested one", () => {
		const result = inlineDirectiveImports('@import "rainbowindex";\n@import "./preset.css";', {
			resolve: mapResolver({
				"/preset.css": '@import "rainbowindex";\n@color { brand: 0.18 330; }',
			}),
			from: "/index.css",
		});
		expect(result.css).toBe('@import "rainbowindex";\n\n@color { brand: 0.18 330; }');
		expect(result.warnings).toEqual([]);
	});

	it.each([
		['@import url("https://example.com/a.css");', "remote url()"],
		['@import "https://example.com/a.css";', "remote string"],
		['@import "//example.com/a.css";', "protocol-relative"],
		['@import "/site.css";', "site-root path"],
	])("leaves %s untouched (%s)", (css) => {
		const result = inlineDirectiveImports(css, {
			resolve: () => {
				throw new Error("resolver must not be called");
			},
			from: "/index.css",
		});
		expect(result.css).toBe(css);
		expect(result.warnings).toEqual([]);
	});

	it.each([
		['@import "./a.css" screen;', "media query"],
		['@import "./a.css" layer(base);', "layer()"],
		['@import "./a.css" supports(display: grid);', "supports()"],
	])("warns RI-1045 and keeps %s (%s)", (css) => {
		const result = inlineDirectiveImports(css, {
			resolve: mapResolver({ "/a.css": "@color { brand: 0.18 330; }" }),
			from: "/index.css",
		});
		expect(result.css).toBe(css);
		expect(codes(result.warnings)).toEqual(["RI-1045"]);
	});

	it("does not mistake a block at-rule for an import statement", () => {
		const css = '@media screen { @import "./a.css"; }';
		// The inner import sits inside a block; findStatementEnd still ends it at
		// the `;`, so it is inlined — what must not happen is the outer @media
		// being consumed.
		const result = inlineDirectiveImports(css, {
			resolve: mapResolver({ "/a.css": ".y { color: red; }" }),
			from: "/index.css",
		});
		expect(result.css).toBe("@media screen { .y { color: red; } }");
	});

	it("ignores an @import inside a comment or a string", () => {
		const css = '/* @import "./a.css"; */\n.x { content: "@import \\"./a.css\\";"; }';
		const result = inlineDirectiveImports(css, {
			resolve: () => {
				throw new Error("resolver must not be called");
			},
			from: "/index.css",
		});
		expect(result.css).toBe(css);
	});

	it("does not end the statement on a semicolon inside url()", () => {
		const result = inlineDirectiveImports("@import url(./a;b.css);", {
			resolve: mapResolver({ "/a;b.css": "@color { brand: 0.18 330; }" }),
			from: "/index.css",
		});
		expect(result.css).toBe("@color { brand: 0.18 330; }");
	});
});

describe("inlineDirectiveImports — comments in package imports", () => {
	// The rule: a package's stylesheet is consumed as CSS and its notes are
	// addressed to whoever opens the package, so they are dropped; the project's
	// own files keep theirs, because those are addressed to whoever reads the
	// build output. Documented in docs/preset-protocol.md.
	it("drops a package file's comments and keeps a relative file's", () => {
		const files = {
			"/node_modules/pkg/preset.css": "/* pkg note */\n@color { brand: 0.18 330; }",
			"/tokens.css": "/* my note */\n@color { accent: 0.2 200; }",
		};
		const result = inlineDirectiveImports('@import "pkg/preset.css";\n@import "./tokens.css";', {
			resolve: mapResolver(files),
			from: "/index.css",
		});
		expect(result.css).not.toContain("pkg note");
		expect(result.css).toContain("my note");
		// Stripping is only ever about comments — every directive still arrives.
		expect(result.css).toContain("brand: 0.18 330");
		expect(result.css).toContain("accent: 0.2 200");
	});

	it("strips through the package's own relative imports", () => {
		// `pkg/preset.css` importing `./colors.css` is still the package's file,
		// and a real design-system package is mostly those second-hop files.
		//
		// What carries this is the outermost boundary stripping the whole
		// assembled subtree, not the `inPackage` flag: judging each hop on its own
		// specifier gives the same bytes. The flag only stops the text being
		// re-stripped once per nesting level. See the note at the call site.
		const files = {
			"/node_modules/pkg/preset.css": '/* outer */\n@import "./colors.css";',
			"/node_modules/pkg/colors.css": "/* inner */\n@color { brand: 0.18 330; }",
		};
		const result = inlineDirectiveImports('@import "pkg/preset.css";', {
			resolve: mapResolver(files),
			from: "/index.css",
		});
		expect(result.css).not.toContain("outer");
		expect(result.css).not.toContain("inner");
		expect(result.css).toContain("brand: 0.18 330");
	});

	it("leaves the entry's own comments alone", () => {
		const result = inlineDirectiveImports('/* mine */\n@import "pkg/preset.css";', {
			resolve: mapResolver({ "/node_modules/pkg/preset.css": "/* theirs */\n.a { color: red; }" }),
			from: "/index.css",
		});
		expect(result.css).toContain("mine");
		expect(result.css).not.toContain("theirs");
	});

	it("keeps a /*! banner, which is how a package ships a licence notice", () => {
		// The convention every minifier already implements. Without it the policy
		// would strip attribution notices, and the only advice left for a package
		// author would be "do not put your licence in your stylesheet".
		const files = {
			"/node_modules/pkg/preset.css":
				"/*! @scope/tokens v2 — MIT */\n/* internal note */\n@color { brand: 0.18 330; }",
		};
		const result = inlineDirectiveImports('@import "pkg/preset.css";', {
			resolve: mapResolver(files),
			from: "/index.css",
		});
		expect(result.css).toContain("/*! @scope/tokens v2 — MIT */");
		expect(result.css).not.toContain("internal note");
	});

	it("never strips a comment that is really a string, and never welds tokens", () => {
		const files = {
			"/node_modules/pkg/preset.css":
				'.a { content: "/* not a comment */"; border: 1px/* c */solid red; }',
		};
		const result = inlineDirectiveImports('@import "pkg/preset.css";', {
			resolve: mapResolver(files),
			from: "/index.css",
		});
		// The string is content, not commentary.
		expect(result.css).toContain('content: "/* not a comment */"');
		// A comment can stand where a separator is required, so dropping it
		// outright would produce `1pxsolid` — a value the browser discards.
		expect(result.css).toContain("border: 1px solid red");
	});
});

describe("inlineDirectiveImports — limits and failures", () => {
	it("warns RI-1041 and keeps an import it cannot resolve", () => {
		const result = inlineDirectiveImports('@import "./missing.css";', {
			resolve: mapResolver({}),
			from: "/index.css",
		});
		expect(result.css).toBe('@import "./missing.css";');
		expect(codes(result.warnings)).toEqual(["RI-1041"]);
		expect(result.warnings[0]).toContain("./missing.css");
	});

	it("warns RI-1042 and drops the repeat on a cycle", () => {
		const result = inlineDirectiveImports('@import "./a.css";', {
			resolve: mapResolver({
				"/a.css": '@color { brand: 0.18 330; }\n@import "./a.css";',
			}),
			from: "/index.css",
		});
		expect(codes(result.warnings)).toEqual(["RI-1042"]);
		expect(result.css).toBe("@color { brand: 0.18 330; }\n");
	});

	it("reads a file reached twice by different paths only once", () => {
		const result = inlineDirectiveImports('@import "./a.css";\n@import "./b.css";', {
			resolve: mapResolver({
				"/a.css": '@import "./shared.css";',
				"/b.css": '@import "./shared.css";',
				"/shared.css": "@color { brand: 0.18 330; }",
			}),
			from: "/index.css",
		});
		// Twice would duplicate the declarations in the CLI's emitted user CSS.
		expect(result.css).toBe("@color { brand: 0.18 330; }\n");
		expect(result.files).toEqual(["/a.css", "/shared.css", "/b.css"]);
		expect(result.warnings).toEqual([]);
	});

	it("warns RI-1043 past the depth cap and keeps the deepest import", () => {
		const result = inlineDirectiveImports('@import "./l1.css";', {
			resolve: mapResolver({
				"/l1.css": '@import "./l2.css";',
				"/l2.css": '@import "./l3.css";',
				"/l3.css": "@color { brand: 0.18 330; }",
			}),
			from: "/index.css",
			maxDepth: 2,
		});
		expect(codes(result.warnings)).toEqual(["RI-1043"]);
		expect(result.css).toBe('@import "./l3.css";');
	});

	it("warns RI-1044 once the byte budget is spent and stops inlining", () => {
		const big = `.a { color: red; }${" ".repeat(200)}`;
		const result = inlineDirectiveImports('@import "./a.css";\n@import "./b.css";', {
			resolve: mapResolver({ "/a.css": big, "/b.css": "@color { brand: 0.18 330; }" }),
			from: "/index.css",
			maxBytes: big.length + 1,
		});
		expect(codes(result.warnings)).toEqual(["RI-1044"]);
		expect(result.css).toBe(`${big}\n@import "./b.css";`);
	});
});

describe("createNodeImportResolver", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(realpathSync(tmpdir()), "ri-import-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	const write = (rel: string, content: string): string => {
		const full = join(dir, rel);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
		return full;
	};

	it("reads a relative path against the importing file", () => {
		const entry = write("src/index.css", "");
		write("src/theme/tokens.css", "@color { brand: 0.18 330; }");
		const resolve = createNodeImportResolver({ cwd: dir });
		expect(resolve("./theme/tokens.css", entry)?.content).toBe("@color { brand: 0.18 330; }");
	});

	it("reads a relative path against cwd when the entry has no path", () => {
		write("tokens.css", "@spacing { base: 0.5rem; }");
		const resolve = createNodeImportResolver({ cwd: dir });
		expect(resolve("./tokens.css", undefined)?.content).toBe("@spacing { base: 0.5rem; }");
	});

	it("resolves a bare specifier through the package exports map", () => {
		const entry = write("src/index.css", "");
		write(
			"node_modules/preset-pkg/package.json",
			JSON.stringify({ name: "preset-pkg", exports: { "./theme.css": "./dist/theme.css" } }),
		);
		write("node_modules/preset-pkg/dist/theme.css", "@color { brand: 0.18 330; }");
		const resolve = createNodeImportResolver({ cwd: dir });
		expect(resolve("preset-pkg/theme.css", entry)?.content).toBe("@color { brand: 0.18 330; }");
	});

	it("strips a BOM so the tokenizer does not read it as part of a token", () => {
		const entry = write("index.css", "");
		write("bom.css", "\uFEFF@color { brand: 0.18 330; }");
		const resolve = createNodeImportResolver({ cwd: dir });
		expect(resolve("./bom.css", entry)?.content).toBe("@color { brand: 0.18 330; }");
	});

	it("returns null rather than throwing for anything it cannot read", () => {
		const entry = write("index.css", "");
		const resolve = createNodeImportResolver({ cwd: dir });
		expect(resolve("./nope.css", entry)).toBeNull();
		expect(resolve("no-such-package/theme.css", entry)).toBeNull();
		// A directory, not a file.
		mkdirSync(join(dir, "adir.css"));
		expect(resolve("./adir.css", entry)).toBeNull();
	});
});

describe("the wired surfaces", () => {
	let dir: string;
	let errors: string[];

	beforeEach(() => {
		dir = mkdtempSync(join(realpathSync(tmpdir()), "ri-import-wire-"));
		errors = [];
		vi.spyOn(console, "error").mockImplementation((m: unknown) => {
			errors.push(String(m));
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(dir, { recursive: true, force: true });
	});

	const write = (rel: string, content: string): string => {
		const full = join(dir, rel);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, content);
		return full;
	};

	it("compileProject reads directives from an imported file once cssPath is given", async () => {
		const entry = write("src/index.css", '@import "rainbowindex";\n@import "./tokens.css";');
		write("src/tokens.css", "@color { brand: 0.18 330; }");
		const result = await compileProject({
			css: '@import "rainbowindex";\n@import "./tokens.css";',
			cssPath: entry,
			classNames: ["bg-brand-500"],
			resolveFonts: (f) => f,
		});
		expect(result.css).toContain("--color-brand-500");
		expect(result.css).toContain(".bg-brand-500");
	});

	it("compileProject leaves imports alone without a cssPath, as it always has", async () => {
		const result = await compileProject({
			css: '@import "rainbowindex";\n@import "./tokens.css";',
			classNames: ["bg-brand-500"],
			resolveFonts: (f) => f,
		});
		expect(result.css).not.toContain("--color-brand-500");
		expect(result.css).toContain('@import "./tokens.css";');
	});

	it("the CLI build emits an imported file's tokens, classes, and CSS exactly once", async () => {
		write("src/index.css", '@import "rainbowindex";\n@import "./tokens.css";');
		write("src/tokens.css", "@color { brand: 0.18 330; }\n.token-rule { color: red; }");
		write("src/App.tsx", 'export const A = () => <b className="bg-brand-500" />;');

		const result = await buildCSS(
			{ cssFile: "src/index.css", globs: ["src/**/*.tsx"] } as never,
			dir,
		);
		expect(result.css).toContain("--color-brand-500");
		expect(result.css).toContain(".bg-brand-500");
		expect(result.css.match(/\.token-rule/g)).toHaveLength(1);
		expect(result.css).not.toContain('@import "./tokens.css"');
	});

	it("the CLI build reports an unresolved import instead of failing", async () => {
		write("src/index.css", '@import "rainbowindex";\n@import "./gone.css";');
		write("src/App.tsx", 'export const A = () => <b className="flex" />;');
		await buildCSS({ cssFile: "src/index.css", globs: ["src/**/*.tsx"] } as never, dir);
		expect(errors.some((e) => e.includes("[RI-1041]"))).toBe(true);
	});

	it("an editor session reads imported directives through a host resolver", () => {
		const files: Record<string, string> = { "/tokens.css": "@color { brand: 0.18 330; }" };
		const session = createEditorSession({
			css: '@import "rainbowindex";\n@import "./tokens.css";',
			cssPath: "/index.css",
			resolveImport: (specifier) =>
				specifier === "./tokens.css"
					? { path: "/tokens.css", content: files["/tokens.css"] }
					: null,
		});
		expect(Object.keys(session.theme.colors)).toContain("brand");
		expect(session.importedFiles).toEqual(["/tokens.css"]);
	});

	it("an editor session without a resolver behaves exactly as before", () => {
		const session = createEditorSession({
			css: '@import "rainbowindex";\n@import "./tokens.css";',
		});
		expect(Object.keys(session.theme.colors)).not.toContain("brand");
		expect(session.importedFiles).toEqual([]);
	});

	it("an editor session surfaces an import failure as a diagnostic", () => {
		const session = createEditorSession({
			css: '@import "rainbowindex";\n@import "./gone.css";',
			cssPath: "/index.css",
			resolveImport: () => null,
		});
		expect(session.diagnostics.some((d) => d.code === "RI-1041")).toBe(true);
	});
});
