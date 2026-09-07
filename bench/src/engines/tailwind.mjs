/**
 * Tailwind CSS v4 adapter.
 *
 * Uses the same two packages `@tailwindcss/cli` itself uses: `@tailwindcss/node`
 * for the compiler and `@tailwindcss/oxide` for the scanner. `build()` is given
 * the full candidate list every time, which is what the CLI does on a rebuild —
 * the compiler caches the candidates it has already seen.
 */

import { createRequire } from "node:module";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const require = createRequire(import.meta.url);

export const id = "tailwind";
export const label = "Tailwind CSS";
export const version = require("tailwindcss/package.json").version;
export const entryFile = "entry.tailwind.css";

/** Oxide wants an extension, not a path. */
function extensionOf(path) {
	const dot = path.lastIndexOf(".");
	return dot === -1 ? "html" : path.slice(dot + 1);
}

/**
 * @param {{ sources: {path: string, content: string}[], entryCss: string, entryPath: string, dir: string }} setup
 */
export async function createEngine(setup) {
	const { entryCss, dir } = setup;
	let sources = setup.sources;

	const compiler = await compile(entryCss, { base: dir, onDependency() {} });

	function scan() {
		// A fresh Scanner per call: the scanner is stateful and returns only
		// candidates it has not seen, so reusing one would make every rebuild
		// after the first report zero work.
		const scanner = new Scanner({});
		return scanner.scanFiles(
			sources.map((s) => ({ content: s.content, extension: extensionOf(s.path) })),
		);
	}

	async function build() {
		const candidates = scan();
		const css = compiler.build(candidates);
		return { css, classes: candidates.length };
	}

	return {
		build,
		replaceSource(path, content) {
			sources = sources.map((s) => (s.path === path ? { path, content } : s));
		},
		scan() {
			return scan().length;
		},
	};
}
