/**
 * CLI-level benchmark: the three shipped command-line tools, end to end.
 *
 * This is a different measurement from `run.mjs`, not a duplicate of it. The
 * library tier hands every engine the same in-memory file list, which skips the
 * part each engine does for itself in real use: expanding a glob and reading the
 * tree. Here they each do their own, from `argv` to a written stylesheet.
 *
 * Uses [hyperfine](https://github.com/sharkdp/hyperfine) when it is on PATH —
 * it warms the filesystem cache, discards outliers and reports a proper
 * confidence interval. Without it the harness spawns the same commands itself
 * and reports the minimum, which is coarser; the results record says which was
 * used so no one compares numbers across the two.
 *
 *   pnpm bench:cli --sizes=1k
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BENCH_ROOT, SIZES, SOURCE_GLOB, ensureFixtures } from "./fixtures.mjs";

const OUT_DIR = ".bench-out";
/** pnpm links every workspace binary here, the workspace package included. */
const BIN_DIR = join(BENCH_ROOT, "node_modules/.bin");

/** The shims are `.CMD` on Windows and extensionless everywhere else. */
function bin(name) {
	return join(BIN_DIR, process.platform === "win32" ? `${name}.CMD` : name);
}

/**
 * One command per engine, all writing inside the fixture tree — the
 * rainbowindex CLI refuses an output path outside the project root, and the
 * other two are pointed at the same place so nothing is measuring a different
 * filesystem.
 *
 * @param {string} dir
 */
function commands(dir) {
	return [
		{
			id: "rainbowindex",
			label: "rainbowindex",
			bin: bin("rainbowindex"),
			args: [SOURCE_GLOB, "--css", "entry.rainbowindex.css", "-o", `${OUT_DIR}/rainbowindex.css`],
			out: join(dir, OUT_DIR, "rainbowindex.css"),
		},
		{
			id: "tailwind",
			label: "Tailwind CSS",
			bin: bin("tailwindcss"),
			args: ["-i", "entry.tailwind.css", "-o", `${OUT_DIR}/tailwind.css`],
			out: join(dir, OUT_DIR, "tailwind.css"),
		},
		{
			id: "unocss",
			label: "UnoCSS",
			bin: bin("unocss"),
			// The UnoCSS CLI takes its glob positionally; `content.filesystem`
			// in the config is for the Vite plugin, not for this binary.
			args: [SOURCE_GLOB, "--config", "uno.config.mjs", "-o", `${OUT_DIR}/unocss.css`],
			out: join(dir, OUT_DIR, "unocss.css"),
		},
	];
}

function hasHyperfine() {
	const probe = spawnSync("hyperfine", ["--version"], { stdio: "ignore" });
	return probe.status === 0;
}

/**
 * @param {{bin: string, args: string[]}} command
 * @param {string} cwd
 */
function runOnce(command, cwd) {
	return new Promise((resolve, reject) => {
		const started = performance.now();
		const child = spawn(command.bin, command.args, {
			cwd,
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (d) => {
			stderr += d;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(
					new Error(`${command.bin} ${command.args.join(" ")} exited ${code}\n${stderr.trim()}`),
				);
				return;
			}
			resolve(performance.now() - started);
		});
	});
}

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
const sizes = (args.sizes ?? "1k")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const runs = Number(args.runs ?? 5);
for (const size of sizes) {
	if (!(size in SIZES)) throw new Error(`unknown size ${JSON.stringify(size)}`);
}

const useHyperfine = args.hyperfine !== "false" && hasHyperfine();
console.log(
	useHyperfine
		? "timing with hyperfine"
		: "hyperfine not on PATH — timing with repeated spawns (minimum of N)",
);

/** @type {Record<string, any>[]} */
const rows = [];

for (const size of sizes) {
	const { dir } = await ensureFixtures(size);
	await mkdir(join(dir, OUT_DIR), { recursive: true });
	for (const command of commands(dir)) {
		// One unmeasured run: it proves the command works and warms the page
		// cache, so the first timed sample is not the only one paying for I/O.
		await runOnce(command, dir);
		const bytes = (await stat(command.out)).size;

		let ms;
		let method;
		if (useHyperfine) {
			const quoted = [command.bin, ...command.args].map((a) => JSON.stringify(a)).join(" ");
			const jsonPath = join(dir, OUT_DIR, `${command.id}.hyperfine.json`);
			const result = spawnSync(
				"hyperfine",
				["--warmup", "1", "--runs", String(runs), "--export-json", jsonPath, quoted],
				{ cwd: dir, stdio: ["ignore", "ignore", "inherit"] },
			);
			if (result.status !== 0) throw new Error(`hyperfine failed for ${command.id}`);
			const report = JSON.parse(await readFile(jsonPath, "utf8"));
			ms = report.results[0].mean * 1000;
			method = "hyperfine-mean";
			await rm(jsonPath, { force: true });
		} else {
			let best = Number.POSITIVE_INFINITY;
			for (let i = 0; i < runs; i++) best = Math.min(best, await runOnce(command, dir));
			ms = best;
			method = "spawn-min";
		}

		console.log(
			`  ${size} ${command.label.padEnd(14)} ${ms.toFixed(0)} ms  ${(bytes / 1024).toFixed(0)} KB`,
		);
		rows.push({ size, engine: command.id, label: command.label, ms, method, outputBytes: bytes });
	}
	await rm(join(dir, OUT_DIR), { recursive: true, force: true });
}

const date = new Date().toISOString().slice(0, 10);
const resultsDir = join(BENCH_ROOT, "results");
await mkdir(resultsDir, { recursive: true });
await writeFile(
	join(resultsDir, `${date}.cli.json`),
	`${JSON.stringify({ date, runs, method: useHyperfine ? "hyperfine" : "spawn", rows }, null, "\t")}\n`,
);
console.log(`written: results/${date}.cli.json`);
