/**
 * `rainbowindex/editor` is browser-safe by contract, not by intention.
 *
 * The entry's own doc comment promises it "behaves in browser-based editor
 * hosts (vscode.dev) exactly as it does in Node", and V3's playground runs it
 * with no server at all. Nothing enforced that: one `import` added to a module
 * five levels down — `assembly.ts` reaching the font barrel, which re-exports
 * the Google client, which caches metadata through `node:crypto` and
 * `node:fs` — would break every browser host, and the Node test suite would
 * stay green because Node has those builtins.
 *
 * So bundle the entry the way a browser host would and let the bundler answer.
 * `platform: "browser"` gives `node:*` no polyfill and no implicit external,
 * so a reachable builtin is a resolve error naming the exact importer, which
 * is the message worth failing with.
 *
 * The same check runs for `rainbowindex` itself under the `browser` condition,
 * since `package.json` maps that to `dist/browser.mjs` and a bundler will take
 * it at its word.
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entry = (rel: string): string => fileURLToPath(new URL(`../../${rel}`, import.meta.url));

/** Bundle for a browser and return the code, or throw with esbuild's own text. */
async function bundleForBrowser(entryPoint: string): Promise<string> {
	const result = await build({
		entryPoints: [entryPoint],
		bundle: true,
		write: false,
		format: "esm",
		platform: "browser",
		// Match tsup: the entry reads a build-time version constant.
		define: { __RI_VERSION__: '"0.0.0-test"' },
		logLevel: "silent",
	});
	return result.outputFiles.map((f) => f.text).join("\n");
}

describe("the editor entry bundles for a browser", () => {
	it("resolves with no node: builtin anywhere in its graph", async () => {
		const code = await bundleForBrowser(entry("src/entries/editor.ts"));
		// A resolve failure throws above. This catches the other shape: a
		// `node:` specifier that survived into the output as a dynamic import
		// or a string the bundler never looked at.
		expect(code).not.toMatch(/["']node:[a-z/]+["']/);
	});

	it("carries the stylesheet renderer, not just the analyzers", async () => {
		const code = await bundleForBrowser(entry("src/entries/editor.ts"));
		// `renderStylesheet` pulls assembly.ts, which is the module that made
		// this test necessary — so assert its output is actually in there.
		expect(code).toContain("renderStylesheet");
		expect(code).toContain("@font-face");
	});

	it("bundles the browser entry too", async () => {
		const code = await bundleForBrowser(entry("src/entries/browser.ts"));
		expect(code).not.toMatch(/["']node:[a-z/]+["']/);
	});
});
