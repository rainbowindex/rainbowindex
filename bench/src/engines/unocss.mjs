/**
 * UnoCSS adapter, with `presetWind4` — the preset that targets Tailwind v4's
 * utility surface, so the three engines are asked for the same classes.
 *
 * UnoCSS core has no filesystem scanner of its own (`@unocss/cli` globs and
 * reads, then hands content to the generator), so `scan()` here calls the
 * public `applyExtractors`, which is the same code path `generate()` runs.
 */

import { createRequire } from "node:module";
import { createGenerator } from "@unocss/core";
import { presetWind4 } from "@unocss/preset-wind4";

const require = createRequire(import.meta.url);

export const id = "unocss";
export const label = "UnoCSS";
export const version = require("@unocss/core/package.json").version;
/** UnoCSS is configured in JS, not CSS; it reads no entry file. */
export const entryFile = null;

/**
 * @param {{ sources: {path: string, content: string}[] }} setup
 */
export async function createEngine(setup) {
	let sources = setup.sources;
	const uno = await createGenerator({ presets: [presetWind4()] });

	async function build() {
		const tokens = new Set();
		for (const source of sources) {
			for (const token of await uno.applyExtractors(source.content, source.path)) {
				tokens.add(token);
			}
		}
		const result = await uno.generate(tokens, { preflights: true, minify: false });
		return { css: result.css, classes: result.matched.size };
	}

	return {
		build,
		replaceSource(path, content) {
			sources = sources.map((s) => (s.path === path ? { path, content } : s));
		},
		async scan() {
			let total = 0;
			for (const source of sources) {
				total += (await uno.applyExtractors(source.content, source.path)).size;
			}
			return total;
		},
	};
}
