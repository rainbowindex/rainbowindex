import { describe, expect, it } from "vitest";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compileProject } from "../src/project/index.js";

const pkgRoot = resolve(import.meta.dirname, "..");

describe("package entrypoints", () => {
	it("exports, types, style, and bin paths target built dist artifacts", () => {
		const pkgPath = resolve(pkgRoot, "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
			style: string;
			exports: {
				".": { style: string; types: string; default: string };
				"./index.css": string;
				"./tailwind.css": string;
				"./editor": { types: string; default: string };
				"./vite": { types: string; default: string };
				"./oxlint": { types: string; default: string };
				"./eslint": { types: string; default: string };
				"./recipe": { types: string; default: string };
			};
			bin: { rainbowindex: string };
		};

		expect(pkg.style).toBe("./dist/index.css");
		expect(pkg.exports["."].style).toBe("./dist/index.css");
		// "types" must precede every JS condition so TypeScript always finds declarations;
		// "browser" must precede "node"/"default" so bundlers pick the browser build.
		expect(Object.keys(pkg.exports["."])).toEqual(["types", "style", "browser", "node", "default"]);
		expect(pkg.exports["."].types).toBe("./dist/index.d.ts");
		expect(pkg.exports["."].default).toBe("./dist/index.mjs");
		expect(pkg.exports["./index.css"]).toBe("./dist/index.css");
		expect(pkg.exports["./tailwind.css"]).toBe("./dist/tailwind.css");
		expect(pkg.exports["./editor"].types).toBe("./dist/editor.d.ts");
		expect(pkg.exports["./editor"].default).toBe("./dist/editor.mjs");
		expect(pkg.exports["./vite"].types).toBe("./dist/vite.d.ts");
		expect(pkg.exports["./vite"].default).toBe("./dist/vite.mjs");
		expect(pkg.exports["./oxlint"].types).toBe("./dist/oxlint.d.ts");
		expect(pkg.exports["./oxlint"].default).toBe("./dist/oxlint.mjs");
		expect(pkg.exports["./eslint"].types).toBe("./dist/eslint.d.ts");
		expect(pkg.exports["./eslint"].default).toBe("./dist/eslint.mjs");
		expect(pkg.exports["./recipe"].types).toBe("./dist/recipe.d.ts");
		expect(pkg.exports["./recipe"].default).toBe("./dist/recipe.mjs");
		expect(Object.keys(pkg.exports).sort()).toEqual([
			".",
			"./editor",
			"./eslint",
			"./index.css",
			"./oxlint",
			"./package.json",
			"./recipe",
			"./tailwind.css",
			"./vite",
		]);
		expect(existsSync(resolve(pkgRoot, "dist/index.mjs"))).toBe(true);
		expect(existsSync(resolve(pkgRoot, "dist/vite.mjs"))).toBe(true);
		expect(existsSync(resolve(pkgRoot, "dist/editor.mjs"))).toBe(true);
		expect(existsSync(resolve(pkgRoot, "dist/oxlint.mjs"))).toBe(true);
		expect(existsSync(resolve(pkgRoot, "dist/eslint.mjs"))).toBe(true);
		expect(existsSync(resolve(pkgRoot, "dist/recipe.mjs"))).toBe(true);

		expect(pkg.bin.rainbowindex).toBe("dist/cli.mjs");
		expect(existsSync(resolve(pkgRoot, "dist/cli.mjs"))).toBe(true);
		expect(existsSync(resolve(pkgRoot, "dist/index.css"))).toBe(true);
		// The preset is copied, not bundled, so nothing but this compares the two
		// files: a tsup `onSuccess` that stops copying would otherwise ship a
		// stale preset, or none, and every other test reads `src/` directly.
		expect(readFileSync(resolve(pkgRoot, "dist/tailwind.css"), "utf8")).toBe(
			readFileSync(resolve(pkgRoot, "src/presets/tailwind.css"), "utf8"),
		);
	});

	/**
	 * The specifier a real project writes. It resolves through the package
	 * `exports` map to `dist/tailwind.css`, so only a suite that builds first can
	 * exercise it — which is why this lives here and not beside the golden
	 * fixture, whose `input.css` reaches `src/presets/` by relative path instead.
	 */
	it("resolves and inlines the bare `rainbowindex/tailwind.css` specifier", async () => {
		// Resolve the way a consumer does — through a linked package in
		// node_modules — rather than through Node's self-reference, which keys
		// off this package.json's own `name`. The release workflow renames the
		// package to @rainbowindex/rainbowindex before publishing to GitHub
		// Packages, and `npm publish` runs this suite through prepublishOnly:
		// under that name a self-referencing specifier resolves to nothing, so
		// the test failed in that job and nowhere else.
		const project = mkdtempSync(join(tmpdir(), "ri-package-"));
		mkdirSync(join(project, "node_modules"), { recursive: true });
		symlinkSync(pkgRoot, join(project, "node_modules/rainbowindex"), "junction");

		const result = await compileProject({
			css: '@import "rainbowindex";\n@import "rainbowindex/tailwind.css";',
			// Anchors bare-specifier resolution inside the fake consumer. The
			// file need not exist; only its directory is used.
			cssPath: join(project, "entry.css"),
			classNames: [
				"sm:flex",
				"text-lg",
				"font-bold",
				"shadow-md",
				"rounded-lg",
				"rounded",
				"leading-none",
				"animate-spin",
				"inset-shadow-sm",
				"drop-shadow-md",
				"text-shadow-lg",
				"bg-red-500",
			],
			resolveFonts: (fonts) => fonts,
		});

		expect(result.warnings).toEqual([]);
		for (const rule of [
			".sm\\:flex",
			".text-lg",
			".font-bold",
			".shadow-md",
			".rounded-lg",
			".leading-none",
			".animate-spin",
			".inset-shadow-sm",
			".drop-shadow-md",
			".text-shadow-lg",
			".bg-red-500",
		]) {
			expect(result.css).toContain(`${rule} {`);
		}
		// Bare `rounded` is C2b: the preset names a DEFAULT radius, and without
		// the borders.ts change it would silently resolve to nothing.
		expect(result.css).toContain(".rounded {");
		// Nothing of the preset's directive text may survive into the output.
		expect(result.css).not.toMatch(/^@(?:color|leading|rounded|shadow|utility)\b/m);

		// Nor its commentary. The preset is nothing *but* directives and section
		// headings, so before package imports were stripped it contributed only
		// its headings — 4.3 KB of "Corner radii — DEFAULT is what bare `rounded`
		// reads", addressed to someone reading src/presets/tailwind.css. Asserted
		// on a phrase from the file rather than on a byte count, which would
		// re-fail on every unrelated edit to the preset.
		expect(result.css).not.toContain("GENERATED by scripts/generate-tailwind-preset.mjs");
		expect(result.css).not.toContain("one block per family");
		// The comments that remain are the engine's own section markers, which
		// the compiler writes and the preflight opt-out removes. Pinned so
		// "strip package comments" cannot quietly grow into "strip everything".
		expect(result.css).toContain("/* preflight:");
	});

	/**
	 * The lint rules through the *shipped* entry, in a real ESLint.
	 *
	 * The rule logic is covered against `src/` by RuleTester in
	 * `__tests__/core/lint-rules.test.ts`. What only a built package can answer
	 * is whether `rainbowindex/eslint` resolves, whether the bundle kept the
	 * plugin shape flat config reads, and whether the rules still find a CSS
	 * entry once they are running out of `dist/` rather than out of the source
	 * tree.
	 */
	it("lints with the built rainbowindex/eslint plugin", async () => {
		const [{ Linter }, plugin] = await Promise.all([
			import("eslint"),
			import(pathToFileURL(resolve(pkgRoot, "dist/eslint.mjs")).href) as Promise<{
				default: { rules: Record<string, unknown> };
			}>,
		]);

		const project = mkdtempSync(join(tmpdir(), "ri-eslint-"));
		writeFileSync(
			join(project, "index.css"),
			`@import "rainbowindex";\n@color { brand: 0.18 330; }\n`,
		);

		const lint = (code: string, rule: string): string[] =>
			new Linter()
				.verify(
					code,
					{
						// Flat config matches by pattern; the default set is JS only,
						// and this fixture is a .tsx so JSX parses.
						files: ["**/*.tsx"],
						plugins: { rainbowindex: plugin.default as never },
						languageOptions: {
							ecmaVersion: 2022,
							sourceType: "module",
							parserOptions: { ecmaFeatures: { jsx: true } },
						},
						rules: { [`rainbowindex/${rule}`]: ["error", { cwd: project }] },
					},
					"a.tsx",
				)
				.map((message) => message.message);

		expect(lint(`const a = <div className="flex bg-brand-500" />;`, "no-unknown-class")).toEqual(
			[],
		);
		expect(lint(`const a = <div className="flex felx" />;`, "no-unknown-class")).toEqual([
			'Unknown utility "felx" — "felx" compiles to nothing. Did you mean "flex"?',
		]);
		expect(lint(`const a = <div className="px-2 px-4" />;`, "no-conflicting-classes")).toEqual([
			'"px-2" is overridden by "px-4" in the same class string, so it has no effect.',
		]);
		// Separate arguments are what ri() is for; only one string is analyzed.
		expect(lint(`const a = ri("px-2", "px-4");`, "no-conflicting-classes")).toEqual([]);
	});
});
