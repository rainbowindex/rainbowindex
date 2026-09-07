/**
 * Benchmark orchestrator.
 *
 * Spawns `measure.mjs` once per (engine, size, phase) so no engine is timed in
 * a process another has already warmed, collects the JSON each run emits, and
 * writes both a machine-readable record and a markdown table.
 *
 *   pnpm bench                          # 1k and 10k, all three engines
 *   pnpm bench --sizes=1k,10k,50k       # add the large tree
 *   pnpm bench --engines=rainbowindex   # one engine, for a before/after
 *   pnpm bench --cold-runs=5 --bench-ms=3000
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, arch, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BENCH_ROOT, SIZES, ensureFixtures } from "./fixtures.mjs";
import { renderMarkdown } from "./table.mjs";

const MEASURE = fileURLToPath(new URL("./measure.mjs", import.meta.url));
const RESULT_PREFIX = "##BENCH##";
const ALL_ENGINES = Object.freeze(["rainbowindex", "tailwind", "unocss"]);

/**
 * @typedef {object} BenchDocument
 * @property {string} date
 * @property {string[]} sizes
 * @property {number} coldRuns
 * @property {{id: string, label: string, version: string}[]} engines
 * @property {Record<string, unknown>[]} rows
 * @property {{node: string, platform: string, arch: string, cpu: string, cpus: number}} env
 */

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

/**
 * Run one measurement child and return the JSON it emitted.
 *
 * @param {string[]} args
 * @returns {Promise<Record<string, any>>}
 */
function measure(args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [MEASURE, ...args], {
			cwd: BENCH_ROOT,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => {
			stdout += d;
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`measure ${args.join(" ")} exited ${code}\n${stderr.trim()}`));
				return;
			}
			const line = stdout.split("\n").find((l) => l.startsWith(RESULT_PREFIX));
			if (!line) {
				reject(new Error(`measure ${args.join(" ")} printed no result\n${stdout}${stderr}`));
				return;
			}
			resolve(JSON.parse(line.slice(RESULT_PREFIX.length)));
		});
	});
}

const args = parseArgs(process.argv.slice(2));
const sizes = (args.sizes ?? "1k,10k")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const engines = (args.engines ?? ALL_ENGINES.join(","))
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const coldRuns = Number(args["cold-runs"] ?? 3);
const benchMs = args["bench-ms"] ?? "1500";

for (const size of sizes) {
	if (!(size in SIZES)) {
		throw new Error(
			`unknown size ${JSON.stringify(size)} — expected one of ${Object.keys(SIZES).join(", ")}`,
		);
	}
}
for (const engine of engines) {
	if (!ALL_ENGINES.includes(engine)) {
		throw new Error(
			`unknown engine ${JSON.stringify(engine)} — expected one of ${ALL_ENGINES.join(", ")}`,
		);
	}
}

// Generate every tree up front so no engine pays for it inside a timed run.
for (const size of sizes) {
	const fixture = await ensureFixtures(size);
	console.log(
		`fixtures ${size}: ${fixture.files.toLocaleString("en-US")} files ${fixture.generated ? "generated" : "cached"}`,
	);
}

/** @type {Record<string, any>[]} */
const rows = [];
/** @type {Map<string, {id: string, label: string, version: string}>} */
const engineInfo = new Map();

for (const size of sizes) {
	for (const engine of engines) {
		process.stdout.write(`  ${size} ${engine} cold`);
		/** @type {Record<string, any> | null} */
		let best = null;
		for (let run = 0; run < coldRuns; run++) {
			const sample = await measure([`--engine=${engine}`, `--size=${size}`, "--phase=cold"]);
			process.stdout.write(` ${sample.coldMs.toFixed(0)}ms`);
			// Fastest wins: a cold start has a floor and no ceiling, so the
			// minimum is the sample least polluted by whatever else the machine
			// was doing. Peak RSS is taken from the same run for consistency.
			if (best === null || sample.coldMs < best.coldMs) best = sample;
		}
		process.stdout.write(" | warm");
		const warm = await measure([
			`--engine=${engine}`,
			`--size=${size}`,
			"--phase=warm",
			`--bench-ms=${benchMs}`,
		]);
		for (const [name, task] of Object.entries(warm.tasks)) {
			process.stdout.write(` ${name}=${task.medianMs.toFixed(1)}ms`);
		}
		process.stdout.write("\n");

		engineInfo.set(engine, { id: engine, label: best.label, version: best.version });
		rows.push({ ...best, tasks: warm.tasks, warmMaxRssKb: warm.maxRssKb });
	}
}

/**
 * Fold this run's rows into whatever the day already recorded.
 *
 * A run is often partial — one engine while iterating on it, one size because
 * the large tree takes a while — and a partial run should refine the day's
 * results, not replace them. Rows are keyed on (size, engine): a fresh
 * measurement of a pair supersedes the earlier one, and every pair this run did
 * not touch is carried through untouched.
 *
 * @param {string} path
 * @param {BenchDocument} fresh
 * @returns {Promise<BenchDocument>}
 */
async function mergeWithExisting(path, fresh) {
	/** @type {BenchDocument | null} */
	let previous = null;
	try {
		previous = JSON.parse(await readFile(path, "utf8"));
	} catch {
		return fresh;
	}
	if (!previous || !Array.isArray(previous.rows)) return fresh;

	const key = (row) => `${row.size}\u0000${row.engine}`;
	/** @type {Map<string, Record<string, any>>} */
	const rows = new Map();
	for (const row of previous.rows) rows.set(key(row), row);
	for (const row of fresh.rows) rows.set(key(row), row);

	/** @type {Map<string, {id: string, label: string, version: string}>} */
	const engines = new Map();
	for (const engine of [...(previous.engines ?? []), ...fresh.engines]) {
		engines.set(engine.id, engine);
	}

	// Order sizes smallest-first however they arrived, so the document reads the
	// same whether the large tree was measured before the small one or after.
	const order = Object.keys(SIZES);
	const sizes = [...new Set([...(previous.sizes ?? []), ...fresh.sizes])].sort(
		(a, b) => order.indexOf(a) - order.indexOf(b),
	);

	return {
		...fresh,
		sizes,
		engines: ALL_ENGINES.filter((id) => engines.has(id)).map((id) => engines.get(id)),
		rows: [...rows.values()].sort(
			(a, b) => order.indexOf(a.size) - order.indexOf(b.size) || a.engine.localeCompare(b.engine),
		),
	};
}

const cpuList = cpus();
/** @type {BenchDocument} */
const fresh = {
	date: new Date().toISOString().slice(0, 10),
	sizes,
	coldRuns,
	engines: [...engineInfo.values()],
	rows,
	env: {
		node: process.versions.node,
		platform: platform(),
		arch: arch(),
		cpu: cpuList[0]?.model ?? "unknown",
		cpus: cpuList.length,
	},
};

const resultsDir = join(BENCH_ROOT, "results");
await mkdir(resultsDir, { recursive: true });
const jsonPath = join(resultsDir, `${fresh.date}.json`);
const doc = await mergeWithExisting(jsonPath, fresh);
const markdown = renderMarkdown(doc);
await writeFile(jsonPath, `${JSON.stringify(doc, null, "\t")}\n`);
await writeFile(join(resultsDir, `${doc.date}.md`), markdown);
await writeFile(join(resultsDir, "latest.md"), markdown);

console.log("");
console.log(markdown);
console.log(`written: results/${doc.date}.json, results/${doc.date}.md, results/latest.md`);
