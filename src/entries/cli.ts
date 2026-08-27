#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, printHelp } from "../cli/args.js";
import { buildCSS } from "../cli/build.js";
import { generateTypes } from "../cli/generate-types.js";
import { preloadFonts } from "../cli/preload-fonts.js";
import { buildAndWrite, minifyIfRequested, watchMode } from "../cli/watch.js";
import { scanFiles } from "../cli/scan.js";
import { createViteProject, initViteProject } from "../cli/vite-setup.js";

declare const __RI_VERSION__: string;

function getVersion(): string {
	return typeof __RI_VERSION__ !== "undefined" ? __RI_VERSION__ : "unknown";
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		printHelp();
		return;
	}

	const opts = parseArgs(args, { getVersion, printHelp });
	if (opts.earlyExit) return;
	const cwd = process.cwd();

	switch (opts.command) {
		case "init":
			await initViteProject(opts, cwd);
			break;
		case "create":
			await createViteProject(opts, cwd);
			break;
		case "generate-types":
			await generateTypes(opts, cwd);
			break;
		case "preload-fonts":
			await preloadFonts(opts, cwd);
			break;
		case "scan":
			await scanFiles(opts, cwd);
			break;
		case "build": {
			if (opts.watch) {
				await watchMode(opts, cwd);
				return;
			}

			if (opts.output) {
				await buildAndWrite(opts, cwd, opts.output);
				console.log(`[rainbowindex] Built: ${opts.output}`);
			} else {
				const { css } = await buildCSS(opts, cwd);
				process.stdout.write(await minifyIfRequested(css, opts));
			}
			break;
		}
	}
}

// Node realpaths the ESM main module (--preserve-symlinks-main is off by
// default) but argv[1] keeps the symlink path package managers install under
// node_modules/.bin — compare realpaths or the installed bin silently no-ops.
const isDirectExecution = (() => {
	const entry = process.argv[1];
	if (entry === undefined) return false;
	try {
		return import.meta.url === pathToFileURL(realpathSync(resolve(entry))).href;
	} catch {
		return false;
	}
})();

if (isDirectExecution) {
	void main().catch((err: unknown) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exitCode = 1;
	});
}
