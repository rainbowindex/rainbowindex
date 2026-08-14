/**
 * Scanner source discovery — @source pattern resolution and async file scanning.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { glob } from "tinyglobby";
import type { SourceDirective } from "../directives/foundation.js";
import { codepointCompare, withTimeout } from "../shared.js";
import { pushWarningsDeduped } from "../warnings.js";
import { validateGlobPattern } from "./glob-utils.js";
import { extractClassesFromSource } from "./class-extraction.js";
import { discoverPackageSafelistSources } from "./package-discovery.js";

export const DEFAULT_PATTERNS = Object.freeze([
	"index.html",
	"src/**/*.{html,js,jsx,ts,tsx,mdx,vue,svelte}",
]);

export const DEFAULT_EXCLUDES = Object.freeze([
	"node_modules/**",
	"dist/**",
	"build/**",
	"coverage/**",
	"public/**",
	"**/*.config.*",
	"**/*.d.ts",
]);

/** Skip files larger than 1 MB to prevent OOM on accidentally matched binary/generated files. */
const MAX_FILE_SIZE = 1_048_576;
/** Maximum total size for one inline @source directive's class content (100 KB). */
const MAX_INLINE_SOURCE_SIZE = 102_400;

const GLOB_TIMEOUT_MS = 30_000;
const GLOB_TIMEOUT_MESSAGE = `glob() timed out after ${GLOB_TIMEOUT_MS / 1000}s — check for network filesystem issues or overly broad @source patterns`;

type ResolveResult = { files: string[]; warnings: string[] };

function collectPatterns(sources: SourceDirective[]): {
	includePatterns: string[];
	nodeModulesIncludePatterns: string[];
	excludePatterns: string[];
	warnings: string[];
	hasUserPositiveGlobs: boolean;
} {
	const includePatterns: string[] = [];
	const nodeModulesIncludePatterns: string[] = [];
	const excludePatterns: string[] = [...DEFAULT_EXCLUDES];
	// Defaults kick in only when the USER hasn't supplied any positive @source
	// globs. Internally-generated discovered patterns (marked `absolute: true`)
	// are additive — they must not suppress the consumer's default `src/**`
	// scan, otherwise their own classes (the ones outside any wrapped
	// safelist()) vanish from the output the moment a single dep advertises
	// `safelistSources`.
	const hasUserPositiveGlobs = sources.some((s) => !s.inline && !s.negated && !s.absolute);

	if (!hasUserPositiveGlobs) {
		includePatterns.push(...DEFAULT_PATTERNS);
	}

	const warnings: string[] = [];
	for (const src of sources) {
		if (src.inline) continue;
		// `absolute: true` flags trusted, internally-generated patterns
		// (e.g. auto-discovered safelist sources from a dep's package.json).
		// User-facing @source patterns from CSS still flow through full
		// validation, which rejects absolute paths and parent traversal.
		if (!src.absolute) {
			const err = validateGlobPattern(src.pattern);
			if (err) {
				warnings.push(`[RI-1404] @source pattern rejected: ${err}`);
				continue;
			}
		}
		if (src.negated) {
			excludePatterns.push(src.pattern);
		} else if (src.absolute || src.pattern.replace(/^\.\//, "").startsWith("node_modules/")) {
			// Ignores always beat positives in tinyglobby, so patterns that point
			// into node_modules would silently match nothing against the default
			// node_modules exclude. That covers an explicit user
			// `@source "node_modules/…"` and every auto-discovered dep safelist
			// (absolute by construction, rooted at the dep's install dir). The
			// exclude compares paths relative to `cwd`, so it hits whenever the
			// dep's realpath sits inside the project — the normal npm/yarn/pnpm
			// layout. Resolve these in a second glob pass that drops only that
			// one exclude.
			nodeModulesIncludePatterns.push(src.pattern);
		} else {
			includePatterns.push(src.pattern);
		}
	}

	return {
		includePatterns,
		nodeModulesIncludePatterns,
		excludePatterns,
		warnings,
		hasUserPositiveGlobs,
	};
}

export async function resolveSourceFilesAsync(
	sources: SourceDirective[],
	cwd: string,
	hasInlineClasses = false,
): Promise<ResolveResult> {
	const {
		includePatterns,
		nodeModulesIncludePatterns,
		excludePatterns,
		warnings,
		hasUserPositiveGlobs,
	} = collectPatterns(sources);
	const allIncludes = [...includePatterns, ...nodeModulesIncludePatterns];
	if (allIncludes.length === 0) return { files: [], warnings };
	try {
		// The two passes are independent; the Set + sort below makes the merged
		// result order-insensitive, so they can run concurrently.
		const globPasses: Promise<string[]>[] = [];
		if (includePatterns.length > 0) {
			globPasses.push(
				withTimeout(
					glob(includePatterns, { cwd, ignore: excludePatterns }),
					GLOB_TIMEOUT_MS,
					GLOB_TIMEOUT_MESSAGE,
				),
			);
		}
		if (nodeModulesIncludePatterns.length > 0) {
			const relaxedExcludes = excludePatterns.filter((p) => p !== "node_modules/**");
			globPasses.push(
				withTimeout(
					glob(nodeModulesIncludePatterns, { cwd, ignore: relaxedExcludes }),
					GLOB_TIMEOUT_MS,
					GLOB_TIMEOUT_MESSAGE,
				),
			);
		}
		const matched = (await Promise.all(globPasses)).flat();
		// Glob yields filesystem-traversal order, which would leak into rule
		// order downstream — sort for deterministic output across machines.
		const files = [...new Set(matched.map((f) => resolve(cwd, f)))].sort(codepointCompare);
		// Zero matches is expected (not warning-worthy) when the user supplied
		// only inline @source content and the searched globs were just the
		// defaults they never asked for. An explicit user glob that matches
		// nothing still warns, inline content or not.
		if (files.length === 0 && !(hasInlineClasses && !hasUserPositiveGlobs)) {
			warnings.push(
				`[RI-1401] No source files found matching ${allIncludes.map((p) => `"${p}"`).join(", ")} — check @source paths or project structure.`,
			);
		}
		return { files, warnings };
	} catch (err) {
		warnings.push(
			`[RI-1402] Invalid glob pattern — skipping. Check @source syntax. (${err instanceof Error ? err.message : String(err)})`,
		);
		return { files: [], warnings };
	}
}

function collectInlineClasses(sources: SourceDirective[]): {
	classes: Set<string>;
	warnings: string[];
} {
	const classes = new Set<string>();
	const warnings: string[] = [];
	for (const src of sources) {
		if (!src.inline) continue;
		const items = src.classes ?? [];
		let contentLength = 0;
		for (const cls of items) contentLength += cls.length;
		if (contentLength > MAX_INLINE_SOURCE_SIZE) {
			warnings.push(
				`[RI-1406] Inline @source content exceeds ${MAX_INLINE_SOURCE_SIZE} byte limit (${contentLength} bytes) — skipping.`,
			);
			continue;
		}
		for (const cls of items) {
			if (cls) classes.add(cls);
		}
	}
	return { classes, warnings };
}

type FileScanResult = {
	classes: Set<string> | null;
	warnings: string[];
	/** RI-1403/RI-1405 message when the file could not be scanned. */
	failure: string | null;
};

const FILE_IO_TIMEOUT_MS = 10_000;

async function scanOneFile(file: string): Promise<FileScanResult> {
	const warnings: string[] = [];
	try {
		const fileSize = await withTimeout(
			stat(file).then((s) => s.size),
			FILE_IO_TIMEOUT_MS,
			"stat() timed out",
		);
		if (fileSize > MAX_FILE_SIZE) {
			return {
				classes: null,
				warnings,
				failure: `[RI-1405] Skipping source file "${file}" (${fileSize} bytes) — exceeds ${MAX_FILE_SIZE} byte limit.`,
			};
		}
		const content = await withTimeout(
			readFile(file, "utf-8"),
			FILE_IO_TIMEOUT_MS,
			"readFile() timed out",
		);
		return {
			classes: extractClassesFromSource({ path: file, content }, warnings),
			warnings,
			failure: null,
		};
	} catch (err) {
		return {
			classes: null,
			warnings,
			failure: `[RI-1403] Could not read source file "${file}" — skipping. (${err instanceof Error ? err.message : String(err)})`,
		};
	}
}

export async function scanSourceFilesAsync(
	sources: SourceDirective[],
	cwd: string,
): Promise<{ classes: Set<string>; warnings: string[] }> {
	const { classes: allClasses, warnings: inlineWarnings } = collectInlineClasses(sources);
	const allWarnings: string[] = [...inlineWarnings];
	const { files, warnings: resolveWarnings } = await resolveSourceFilesAsync(
		sources,
		cwd,
		allClasses.size > 0,
	);
	allWarnings.push(...resolveWarnings);

	// Sliding-window pool: each worker pulls the next unclaimed index as it
	// finishes, so one slow read can't stall a whole batch the way fixed
	// Promise.all batches did. Results land in per-index slots and merge in
	// file order below, keeping classes and warnings deterministic regardless
	// of completion order.
	const CONCURRENCY_LIMIT = 32;
	const results: FileScanResult[] = new Array(files.length);
	let nextIndex = 0;
	const worker = async (): Promise<void> => {
		while (nextIndex < files.length) {
			const index = nextIndex++;
			results[index] = await scanOneFile(files[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY_LIMIT, files.length) }, worker));

	const seen = new Set(allWarnings);
	for (const result of results) {
		if (result.failure) {
			allWarnings.push(result.failure);
			seen.add(result.failure);
			continue;
		}
		if (result.classes) {
			for (const cls of result.classes) {
				allClasses.add(cls);
			}
		}
		pushWarningsDeduped(allWarnings, result.warnings, seen);
	}

	return { classes: allClasses, warnings: allWarnings };
}

/**
 * Shared source collection for the PostCSS plugin and the CLI. The merge
 * order is the cross-surface contract: user `@source` first, surface-provided
 * sources next, auto-discovered dep safelists last — predictable for
 * debugging, identical patterns dedupe at glob expansion time, and identical
 * input produces byte-identical output on both surfaces.
 */
export async function collectProjectClasses(
	themeSources: readonly SourceDirective[],
	surfaceSources: readonly SourceDirective[],
	cwd: string,
	warnings: string[],
	warningSeen: Set<string>,
): Promise<Set<string>> {
	const discovered = discoverPackageSafelistSources(cwd);
	pushWarningsDeduped(warnings, discovered.warnings, warningSeen);
	const allSources = [...themeSources, ...surfaceSources, ...discovered.sources];
	const scanResult = await scanSourceFilesAsync(allSources, cwd);
	pushWarningsDeduped(warnings, scanResult.warnings, warningSeen);
	return scanResult.classes;
}
