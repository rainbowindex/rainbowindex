/**
 * Tailwind parity check.
 *
 * Asks Tailwind v4 for its own complete class list — 23,000-odd names, straight
 * from the design system that powers its IntelliSense — renders every one, and
 * reports which of them rainbowindex does not implement. This is the honest
 * version of "works with Tailwind classes": not a hand-written sample, but the
 * whole surface, recomputed on demand.
 *
 *   pnpm bench:parity              # summary + grouped gaps
 *   pnpm bench:parity --list       # every missing class, one per line
 *   pnpm bench:parity --json=out   # write the full report
 */

import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { compileProject } from "rainbowindex";
import * as tw from "@tailwindcss/node";
import { BENCH_ROOT, ENTRY_CSS } from "./fixtures.mjs";
import { classSelectorRe } from "./engines/shared.mjs";

const require = createRequire(import.meta.url);
const TAILWIND_VERSION = require("tailwindcss/package.json").version;

/**
 * Classes Tailwind renders but leaves out of `getClassList()` — the legacy
 * chain-enabling statics. IntelliSense hides them; they are still real classes
 * a migrating codebase will contain, so the sweep has to ask for them by name.
 */
const UNLISTED = Object.freeze(["transform", "filter", "backdrop-filter", "filter-none"]);

/** @param {string[]} argv */
function parseArgs(argv) {
	/** @type {Record<string, string>} */
	const out = {};
	for (const arg of argv) {
		const match = /^--([\w-]+)(?:=(.*))?$/.exec(arg);
		if (match) out[match[1]] = match[2] ?? "true";
		else throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
	}
	return out;
}

const args = parseArgs(process.argv.slice(2));

const designSystem = await tw.__unstable__loadDesignSystem(`@import "tailwindcss";`, {
	base: BENCH_ROOT,
});

const listed = designSystem.getClassList().map(([name]) => name);
const candidates = [...new Set([...listed, ...UNLISTED])];
// A name Tailwind lists but cannot render is not a class anyone can use, so it
// is not a gap either. Ask Tailwind to render each and keep what comes back.
const rendered = designSystem.candidatesToCss(candidates);
const names = candidates.filter((_, i) => rendered[i]);

// One build, not one per class: rainbowindex assembles the whole theme on every
// compileProject call, and 23,000 of those would take an hour to say the same
// thing.
const entryPath = join(BENCH_ROOT, "parity-entry.css");
await writeFile(entryPath, ENTRY_CSS.rainbowindex);
const result = await compileProject({
	css: readFileSync(entryPath, "utf8"),
	cssPath: entryPath,
	classNames: names,
});

await rm(entryPath, { force: true });

const missing = names.filter((name) => !classSelectorRe(name).test(result.css));
const parity = (100 * (names.length - missing.length)) / names.length;

/** Group by the first two dash-separated segments, so a family shows as a family. */
const groups = new Map();
for (const name of missing) {
	const key = name.replace(/^-/, "").split("-").slice(0, 2).join("-");
	groups.set(key, (groups.get(key) ?? 0) + 1);
}

console.log(
	`Tailwind v${TAILWIND_VERSION} classes rendered: ${names.length.toLocaleString("en-US")}`,
);
console.log(`rainbowindex implements:  ${(names.length - missing.length).toLocaleString("en-US")}`);
console.log(`missing:                  ${missing.length.toLocaleString("en-US")}`);
console.log(`parity:                   ${parity.toFixed(2)}%`);
console.log("");
console.log("gaps by family:");
for (const [key, count] of [...groups].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${String(count).padStart(4)}  ${key}`);
}

// A floor, not a target: the number only moves when someone changes the engine
// or Tailwind ships a new class, and both are worth a red build. Raise it when
// parity improves so a later regression cannot hide under the old floor.
if (args.min !== undefined) {
	const floor = Number(args.min);
	if (!Number.isFinite(floor)) throw new Error(`--min needs a number, got ${args.min}`);
	if (parity < floor) {
		console.error(
			`\nparity ${parity.toFixed(2)}% is below the --min floor of ${floor}%. ` +
				`${missing.length} classes missing; run with --list to see them.`,
		);
		process.exitCode = 1;
	}
}

if (args.list) {
	console.log("");
	for (const name of missing) console.log(name);
}

if (args.json) {
	const path = args.json === "true" ? join(BENCH_ROOT, "results", "parity.json") : args.json;
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify(
			{
				total: names.length,
				implemented: names.length - missing.length,
				missing,
				groups: Object.fromEntries([...groups].sort((a, b) => b[1] - a[1])),
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(`\nwritten: ${path}`);
}
