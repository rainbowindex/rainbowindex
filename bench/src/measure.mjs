/**
 * Measure one (engine, size) pair, in a process of its own.
 *
 * Isolation is the point. A cold build is only cold once per process — every
 * engine memoizes something at module scope — so the orchestrator spawns this
 * script afresh for each cold sample. Peak RSS likewise only means anything
 * when one engine is the sole occupant of the heap.
 *
 * Usage: node src/measure.mjs --engine=<id> --size=<1k|10k|50k> --phase=<cold|warm>
 * Emits one line of JSON on stdout, prefixed with `##BENCH##`.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Bench } from "tinybench";
import { transform } from "lightningcss";
import { ensureFixtures, fixtureClasses } from "./fixtures.mjs";
import { loadSources, sourceBytes } from "./sources.mjs";
import { countMatched } from "./engines/shared.mjs";
import { makeClass } from "./mutate.mjs";

const RESULT_PREFIX = "##BENCH##";

/** @param {string[]} argv */
function parseArgs(argv) {
	/** @type {Record<string, string>} */
	const out = {};
	for (const arg of argv) {
		const match = /^--([\w-]+)(?:=(.*))?$/.exec(arg);
		if (match) out[match[1]] = match[2] ?? "true";
	}
	return out;
}

const args = parseArgs(process.argv.slice(2));
const engineId = args.engine;
const size = args.size;
const phase = args.phase ?? "cold";
const warmupMs = Number(args["warmup-ms"] ?? 250);
const benchMs = Number(args["bench-ms"] ?? 1_000);

if (!engineId || !size) {
	console.error("usage: measure.mjs --engine=<id> --size=<1k|10k|50k> [--phase=cold|warm]");
	process.exit(2);
}

const engineModule = await import(`./engines/${engineId}.mjs`);
const { dir } = await ensureFixtures(size);

/** Build one engine instance over a freshly loaded copy of the tree. */
async function instantiate() {
	const sources = await loadSources(dir);
	const entryPath = engineModule.entryFile ? join(dir, engineModule.entryFile) : null;
	const entryCss = entryPath === null ? "" : await readFile(entryPath, "utf8");
	const engine = await engineModule.createEngine({ sources, entryCss, entryPath, dir });
	return { engine, sources };
}

/** Minify with one minifier for all three, so the byte counts compare. */
function minifiedBytes(css) {
	const { code } = transform({
		filename: "out.css",
		code: Buffer.from(css),
		minify: true,
		// Targets matter: a browserslist that permits nesting leaves nested rules
		// unflattened for one engine and not another. Pin one modern baseline.
		targets: { chrome: 111 << 16, firefox: 113 << 16, safari: (16 << 16) | (4 << 8) },
	});
	return code.length;
}

/** @type {Record<string, unknown>} */
const result = {
	engine: engineId,
	label: engineModule.label,
	version: engineModule.version,
	size,
	phase,
};

if (phase === "cold") {
	// Everything from "the process has started" to "the stylesheet exists":
	// reading the tree off disk, constructing the engine, and the first build.
	const t0 = performance.now();
	const { engine, sources } = await instantiate();
	const built = await engine.build();
	const coldMs = performance.now() - t0;

	const truth = await fixtureClasses(dir);
	result.coldMs = coldMs;
	result.files = sources.length;
	result.sourceBytes = sourceBytes(sources);
	result.candidates = built.classes;
	result.cssBytes = Buffer.byteLength(built.css);
	result.minifiedBytes = minifiedBytes(built.css);
	result.covered = countMatched(built.css, truth);
	result.coverageOf = truth.length;
	// Read last: maxRSS is a high-water mark, so it must include the build.
	result.maxRssKb = process.resourceUsage().maxRSS;
} else {
	const { engine, sources } = await instantiate();
	// Warm the engine the way a dev server is warm when you save a file.
	await engine.build();

	const bench = new Bench({ warmupTime: warmupMs, time: benchMs });

	bench.add("rebuild-unchanged", async () => {
		await engine.build();
	});

	// One file's classes change on every iteration, so no iteration but the
	// first can be served from a cache keyed on what it has already compiled.
	let edit = 0;
	const victim = sources[Math.floor(sources.length / 2)];
	bench.add("rebuild-incremental", async () => {
		engine.replaceSource(victim.path, mutate(victim.content, edit++));
		await engine.build();
	});

	bench.add("scan", async () => {
		await engine.scan();
	});

	await bench.run();

	result.tasks = {};
	for (const task of bench.tasks) {
		const latency = task.result?.latency;
		if (!latency) continue;
		result.tasks[task.name] = {
			meanMs: latency.mean,
			medianMs: latency.p50,
			p99Ms: latency.p99,
			samples: latency.samplesCount,
			rmeMs: latency.rme,
		};
	}
	result.maxRssKb = process.resourceUsage().maxRSS;
}

/**
 * Rewrite one class attribute so the file carries a class nothing has compiled
 * yet. Appending would grow the file without bound over a bench run; this keeps
 * its size stable so later iterations are not quietly scanning more text.
 *
 * @param {string} content
 * @param {number} nth
 */
function mutate(content, nth) {
	return content.replace(/class(Name)?="([^"]*)"/, (_whole, name, classes) => {
		const replaced = `${classes.split(" ").slice(1).join(" ")} ${makeClass(nth)}`.trim();
		return `class${name ?? ""}="${replaced}"`;
	});
}

process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`);
