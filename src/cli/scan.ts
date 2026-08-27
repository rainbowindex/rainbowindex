import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { glob } from "tinyglobby";
import { extractClassesFromSource } from "../scanner/class-extraction.js";
import { codepointCompare } from "../shared.js";
import type { CLIOptions } from "./args.js";

/**
 * Debug view of the class scanner: print exactly what it extracts from each
 * file, so "why doesn't my class generate?" is answerable in seconds. Classes
 * go to stdout (grep-friendly), scanner warnings to stderr with their
 * [RI-NNNN] codes. No excludes are applied — passing a node_modules dist to
 * inspect a dependency's safelist is a supported use.
 */
export async function scanFiles(opts: CLIOptions, cwd: string): Promise<void> {
	const files = [...new Set(await glob(opts.globs, { cwd }))].sort(codepointCompare);
	if (files.length === 0) {
		throw new Error(`No files matched ${opts.globs.map((g) => `"${g}"`).join(", ")}.`);
	}
	for (const file of files) {
		const path = resolve(cwd, file);
		const warnings: string[] = [];
		const classes = extractClassesFromSource(
			{ path, content: await readFile(path, "utf-8") },
			warnings,
		);
		const sorted = [...classes].sort(codepointCompare);
		console.log(
			`${relative(cwd, path)} (${sorted.length} class${sorted.length === 1 ? "" : "es"})`,
		);
		for (const cls of sorted) {
			console.log(`  ${cls}`);
		}
		for (const warning of warnings) {
			console.error(`  ${warning}`);
		}
	}
}
