/**
 * Load a fixture tree into memory.
 *
 * The warm scenarios operate on an in-memory source list so they time
 * compilation rather than the filesystem; disk cost is identical for all three
 * engines and is measured by the cold scenario, which reads the tree itself.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const SOURCE_EXTENSIONS = new Set([
	"tsx",
	"ts",
	"jsx",
	"js",
	"html",
	"vue",
	"svelte",
	"astro",
	"mdx",
]);

/** @param {string} dir */
async function walk(dir, out) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			await walk(path, out);
			continue;
		}
		const dot = entry.name.lastIndexOf(".");
		if (dot !== -1 && SOURCE_EXTENSIONS.has(entry.name.slice(dot + 1))) out.push(path);
	}
	return out;
}

/**
 * @param {string} fixtureDir
 * @returns {Promise<{path: string, content: string}[]>}
 */
export async function loadSources(fixtureDir) {
	const paths = (await walk(join(fixtureDir, "src"), [])).sort();
	/** @type {{path: string, content: string}[]} */
	const sources = [];
	// Read in bounded batches; 50k concurrent opens is an EMFILE, not a benchmark.
	for (let i = 0; i < paths.length; i += 256) {
		const slice = paths.slice(i, i + 256);
		const contents = await Promise.all(slice.map((p) => readFile(p, "utf8")));
		for (let j = 0; j < slice.length; j++) sources.push({ path: slice[j], content: contents[j] });
	}
	return sources;
}

/** Total bytes of source the engines are asked to scan. */
export function sourceBytes(sources) {
	let total = 0;
	for (const s of sources) total += Buffer.byteLength(s.content);
	return total;
}
