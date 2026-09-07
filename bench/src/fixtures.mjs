/**
 * Seeded fixture generator.
 *
 * Produces a tree of source files with a realistic class distribution, so the
 * engines are timed on markup shaped like an application rather than on a flat
 * list of every utility exactly once. Generation is deterministic in the seed
 * and cached: a tree whose manifest already matches is left alone, so repeat
 * runs measure the engines and not the filesystem.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ARBITRARY, BASE_UTILITIES, VARIANTS } from "./vocabulary.mjs";
import { between, mulberry32, pick, pickZipf } from "./prng.mjs";

export const BENCH_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const FIXTURE_ROOT = join(BENCH_ROOT, "fixtures");

/**
 * Bump when the generator's output shape changes, so a stale cached tree from
 * an older harness is regenerated instead of silently benchmarked.
 */
const GENERATOR_VERSION = 1;

export const SIZES = Object.freeze({
	"1k": 1_000,
	"10k": 10_000,
	"50k": 50_000,
});

const EXTENSIONS = Object.freeze([
	{ ext: "tsx", weight: 60 },
	{ ext: "html", weight: 15 },
	{ ext: "vue", weight: 15 },
	{ ext: "svelte", weight: 10 },
]);

const TOTAL_WEIGHT = EXTENSIONS.reduce((sum, e) => sum + e.weight, 0);

/** @param {() => number} rand */
function pickExtension(rand) {
	let roll = rand() * TOTAL_WEIGHT;
	for (const entry of EXTENSIONS) {
		roll -= entry.weight;
		if (roll < 0) return entry.ext;
	}
	return EXTENSIONS[EXTENSIONS.length - 1].ext;
}

/**
 * Every distinct class the generator has written, in emission order. This is
 * the harness's ground truth: coverage is measured against what the fixtures
 * actually contain, not against any one engine's idea of what is in them, so
 * an engine whose scanner misses a shape shows up as lower coverage rather
 * than as a smaller denominator.
 *
 * @type {Set<string>}
 */
const emitted = new Set();

/**
 * One class string: a Zipf draw over the vocabulary, with a variant prefix a
 * quarter of the time and an arbitrary value occasionally.
 *
 * @param {() => number} rand
 */
function makeClass(rand) {
	const cls = drawClass(rand);
	emitted.add(cls);
	return cls;
}

/** @param {() => number} rand */
function drawClass(rand) {
	const roll = rand();
	if (roll < 0.03) return pick(rand, ARBITRARY);
	const base = pickZipf(rand, BASE_UTILITIES);
	if (roll < 0.28) {
		const variant = pickZipf(rand, VARIANTS);
		// A tenth of variant uses stack two, which is where composition costs show.
		// The outer draw is nudged off a collision: `focus:focus:x` is legal but
		// degenerate, and every engine dedupes it before it reaches the compiler.
		if (rand() < 0.1) {
			const outer = pickZipf(rand, VARIANTS);
			if (outer !== variant) return `${outer}:${variant}:${base}`;
			return `${VARIANTS[(VARIANTS.indexOf(variant) + 1) % VARIANTS.length]}:${variant}:${base}`;
		}
		return `${variant}:${base}`;
	}
	return base;
}

/** @param {() => number} rand */
function classAttr(rand) {
	const count = between(rand, 2, 6);
	const classes = [];
	for (let i = 0; i < count; i++) classes.push(makeClass(rand));
	return classes.join(" ");
}

const TAGS = Object.freeze(["div", "span", "section", "article", "button", "li", "p", "header"]);

/**
 * @param {() => number} rand
 * @param {number} index
 */
function jsxFile(rand, index) {
	const rows = between(rand, 6, 20);
	const lines = [
		`import { useState } from "react";`,
		``,
		`export function Component${index}({ items }: { items: string[] }) {`,
		`\tconst [open, setOpen] = useState(false);`,
		`\treturn (`,
		`\t\t<div className="${classAttr(rand)}">`,
	];
	for (let i = 0; i < rows; i++) {
		const tag = pick(rand, TAGS);
		const roll = rand();
		if (roll < 0.12) {
			// A conditional expression — two class strings on one attribute.
			lines.push(
				`\t\t\t<${tag} className={open ? "${classAttr(rand)}" : "${classAttr(rand)}"}>`,
				`\t\t\t\t{items[${i}]}`,
				`\t\t\t</${tag}>`,
			);
			continue;
		}
		if (roll < 0.22) {
			// A clsx()-style helper call, the shape a scanner must look inside.
			lines.push(
				`\t\t\t<${tag} className={clsx("${classAttr(rand)}", open && "${classAttr(rand)}")}>`,
				`\t\t\t\t{items[${i}]}`,
				`\t\t\t</${tag}>`,
			);
			continue;
		}
		if (roll < 0.28) {
			// A template literal.
			lines.push(
				`\t\t\t<${tag} className={\`${classAttr(rand)} \${open ? "${makeClass(rand)}" : ""}\`}>`,
				`\t\t\t\t{items[${i}]}`,
				`\t\t\t</${tag}>`,
			);
			continue;
		}
		lines.push(`\t\t\t<${tag} className="${classAttr(rand)}">{items[${i}]}</${tag}>`);
	}
	lines.push(`\t\t</div>`, `\t);`, `}`, ``);
	return lines.join("\n");
}

/**
 * @param {() => number} rand
 * @param {number} index
 */
function htmlFile(rand, index) {
	const rows = between(rand, 6, 20);
	const lines = [`<section class="${classAttr(rand)}" id="s${index}">`];
	for (let i = 0; i < rows; i++) {
		const tag = pick(rand, TAGS);
		lines.push(`\t<${tag} class="${classAttr(rand)}">row ${i}</${tag}>`);
	}
	lines.push(`</section>`, ``);
	return lines.join("\n");
}

/**
 * @param {() => number} rand
 * @param {number} index
 */
function vueFile(rand, index) {
	const rows = between(rand, 5, 16);
	const lines = [
		`<script setup lang="ts">`,
		`import { ref } from "vue";`,
		`const open = ref(false);`,
		`const cls = "${classAttr(rand)}";`,
		`</script>`,
		``,
		`<template>`,
		`\t<div :class="cls" class="${classAttr(rand)}">`,
	];
	for (let i = 0; i < rows; i++) {
		const tag = pick(rand, TAGS);
		lines.push(`\t\t<${tag} class="${classAttr(rand)}">item ${index}-${i}</${tag}>`);
	}
	lines.push(`\t</div>`, `</template>`, ``);
	return lines.join("\n");
}

/**
 * @param {() => number} rand
 * @param {number} index
 */
function svelteFile(rand, index) {
	const rows = between(rand, 5, 16);
	const lines = [`<script lang="ts">`, `\texport let items: string[] = [];`, `</script>`, ``];
	lines.push(`<div class="${classAttr(rand)}">`);
	for (let i = 0; i < rows; i++) {
		const tag = pick(rand, TAGS);
		lines.push(`\t<${tag} class="${classAttr(rand)}">{items[${i}] ?? "${index}"}</${tag}>`);
	}
	lines.push(`</div>`, ``);
	return lines.join("\n");
}

/**
 * @param {() => number} rand
 * @param {number} index
 * @param {string} ext
 */
function renderFile(rand, index, ext) {
	if (ext === "tsx") return jsxFile(rand, index);
	if (ext === "html") return htmlFile(rand, index);
	if (ext === "vue") return vueFile(rand, index);
	return svelteFile(rand, index);
}

/** The one glob all three engines are pointed at, so none of them is timed on
 *  a different file set than the others. */
export const SOURCE_GLOB = "./src/**/*.{tsx,html,vue,svelte}";

/**
 * The CSS entry each engine is pointed at. One file per engine because the
 * three spell "load the default theme" differently; the utilities they are
 * then asked to compile are identical.
 *
 * Tailwind gets `source(none)` and an explicit `@source`, because its default
 * is to walk the whole directory the entry lives in — which would have it
 * scanning `manifest.json`, a file holding every class in the tree, and
 * comparing its output against two engines that never saw it. The `@source`
 * lines are read by the CLI tier; the library tier injects the same files
 * directly and both `compileProject` and `compile` ignore the glob there.
 */
export const ENTRY_CSS = Object.freeze({
	rainbowindex: `@import "rainbowindex/tailwind.css";\n@source "${SOURCE_GLOB}";\n`,
	tailwind: `@import "tailwindcss" source(none);\n@source "${SOURCE_GLOB}";\n`,
});

/** UnoCSS is configured in JS, so its "entry" is a config file. */
const UNO_CONFIG = `import { defineConfig } from "unocss";
import { presetWind4 } from "@unocss/preset-wind4";

export default defineConfig({
	presets: [presetWind4()],
	content: { filesystem: ["${SOURCE_GLOB.replace(/^\.\//, "")}"] },
});
`;

/**
 * Generate (or reuse) the fixture tree for one size.
 *
 * @param {keyof typeof SIZES | string} size
 * @param {{ seed?: number, force?: boolean }} [options]
 * @returns {Promise<{ dir: string, files: number, generated: boolean }>}
 */
export async function ensureFixtures(size, options = {}) {
	const count = SIZES[size];
	if (count === undefined) {
		throw new Error(
			`unknown fixture size ${JSON.stringify(size)} — expected one of ${Object.keys(SIZES).join(", ")}`,
		);
	}
	const seed = options.seed ?? 0x5eed;
	const dir = join(FIXTURE_ROOT, size);
	const manifestPath = join(dir, "manifest.json");
	const want = { version: GENERATOR_VERSION, seed, count, size };

	if (!options.force && existsSync(manifestPath)) {
		try {
			const have = JSON.parse(await readFile(manifestPath, "utf8"));
			if (have.version === want.version && have.seed === want.seed && have.count === want.count) {
				return { dir, files: count, generated: false };
			}
		} catch {
			// An unreadable manifest means regenerate; the tree is rebuilt below.
		}
	}

	await rm(dir, { recursive: true, force: true });
	// Fan out over subdirectories: 50k files in one directory is a filesystem
	// benchmark, not a compiler one.
	const perDir = 200;
	const dirCount = Math.ceil(count / perDir);
	for (let d = 0; d < dirCount; d++) {
		await mkdir(join(dir, "src", `mod${String(d).padStart(4, "0")}`), { recursive: true });
	}

	const rand = mulberry32(seed);
	emitted.clear();
	/** @type {Promise<void>[]} */
	let batch = [];
	for (let i = 0; i < count; i++) {
		const ext = pickExtension(rand);
		const sub = `mod${String(Math.floor(i / perDir)).padStart(4, "0")}`;
		const file = join(dir, "src", sub, `File${String(i).padStart(5, "0")}.${ext}`);
		batch.push(writeFile(file, renderFile(rand, i, ext)));
		// Cap concurrent open handles; EMFILE at 50k is otherwise routine.
		if (batch.length >= 256) {
			await Promise.all(batch);
			batch = [];
		}
	}
	await Promise.all(batch);

	for (const [engine, css] of Object.entries(ENTRY_CSS)) {
		await writeFile(join(dir, `entry.${engine}.css`), css);
	}
	await writeFile(join(dir, "uno.config.mjs"), UNO_CONFIG);
	await writeFile(
		manifestPath,
		`${JSON.stringify({ ...want, classes: [...emitted].sort() }, null, "\t")}\n`,
	);
	return { dir, files: count, generated: true };
}

// Running this module directly generates the requested sizes, for CI warm-up.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
	const sizes = requested.length > 0 ? requested : ["1k", "10k"];
	for (const size of sizes) {
		const result = await ensureFixtures(size);
		console.log(
			`${size}: ${result.files} files ${result.generated ? "generated" : "cached"} in ${result.dir}`,
		);
	}
}

/**
 * The distinct classes a generated tree contains, read back from its manifest.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function fixtureClasses(dir) {
	const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
	if (!Array.isArray(manifest.classes)) {
		throw new Error(`${dir}/manifest.json has no class list — regenerate with --force`);
	}
	return manifest.classes;
}
