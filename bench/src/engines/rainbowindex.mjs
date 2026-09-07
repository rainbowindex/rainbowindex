/**
 * rainbowindex adapter — the engine under test.
 *
 * Loaded through the package's public entry points (`rainbowindex` and
 * `rainbowindex/editor`) rather than through `src/`, so the harness measures
 * the built artifact a user installs, not the TypeScript sources.
 */

import { createRequire } from "node:module";
import { compileProject } from "rainbowindex";
import { extractClassesFromSource } from "rainbowindex/editor";

const require = createRequire(import.meta.url);

export const id = "rainbowindex";
export const label = "rainbowindex";
export const version = require("rainbowindex/package.json").version;
/** The CSS entry this engine is pointed at, written by the fixture generator. */
export const entryFile = "entry.rainbowindex.css";

/**
 * @param {{ sources: {path: string, content: string}[], entryCss: string, entryPath: string }} setup
 */
export async function createEngine(setup) {
	const { entryCss, entryPath } = setup;
	let sources = setup.sources;

	/** compileProject re-scans every source each call; that is its rebuild path. */
	async function build() {
		const result = await compileProject({ css: entryCss, cssPath: entryPath, sources });
		return { css: result.css, classes: result.classNames.length };
	}

	return {
		build,
		/**
		 * Replace one file's content, the way a watcher would after an edit.
		 * @param {string} path
		 * @param {string} content
		 */
		replaceSource(path, content) {
			sources = sources.map((s) => (s.path === path ? { path, content } : s));
		},
		/** Extraction only — no theme assembly, no CSS generation. */
		scan() {
			let total = 0;
			const warnings = [];
			for (const source of sources) {
				total += extractClassesFromSource(source, warnings).length;
			}
			return total;
		},
	};
}
