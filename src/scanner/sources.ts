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

// Root-level "*.html" (not just index.html) so Vite multi-page apps with
// about.html etc. at the root are scanned by default; dist/build/public are
// excluded below.
export const DEFAULT_PATTERNS = Object.freeze([
	"*.html",
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

// A cached file list is only correct while something reacts to file adds and
// deletes, so caching is opt-in: the Vite plugin arms it and invalidates from
// its watcher, while one-shot builds and postcss-cli --watch (which has no
// watcher hook) keep the always-fresh glob.
const SOURCE_LIST_CACHE_MAX_ENTRIES = 50;
let sourceListCacheEnabled = false;
const sourceListCache = new Map<string, string[]>();
// Guards against a glob that was already in flight when an invalidation
// arrived: its result predates the file add/delete and must not be cached,
// or the stale list would be served until the next watcher event.
let sourceListCacheGeneration = 0;

export function enableSourceFileListCache(): void {
	sourceListCacheEnabled = true;
}

export function invalidateSourceFileListCache(): void {
	sourceListCacheGeneration++;
	sourceListCache.clear();
}

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
	// The include split is derived from the patterns themselves, so cwd plus the
	// flat pattern lists fully determine the glob result.
	const cacheKey = sourceListCacheEnabled
		? [
				cwd,
				includePatterns.join("\u0000"),
				nodeModulesIncludePatterns.join("\u0000"),
				excludePatterns.join("\u0000"),
			].join("\u0001")
		: null;
	try {
		const generationAtStart = sourceListCacheGeneration;
		let files = cacheKey !== null ? sourceListCache.get(cacheKey) : undefined;
		if (files === undefined) {
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
			files = [...new Set(matched.map((f) => resolve(cwd, f)))].sort(codepointCompare);
			if (cacheKey !== null && sourceListCacheGeneration === generationAtStart) {
				if (sourceListCache.size >= SOURCE_LIST_CACHE_MAX_ENTRIES) sourceListCache.clear();
				sourceListCache.set(cacheKey, files);
			}
		}
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

// Per-file scan cache keyed by absolute path. An mtimeMs+size match replays
// the previous result verbatim (classes, warnings, failure), so watch-mode
// rebuilds re-read only the files that actually changed. Deleted files drop
// out naturally — the glob stops matching them, so stale entries are never
// consulted.
// ponytail: whole-map clear at 20k entries — swap for LRU eviction if
// projects that large churn in practice.
const SCAN_CACHE_MAX_ENTRIES = 20_000;
const scanCache = new Map<string, { mtimeMs: number; size: number; result: FileScanResult }>();

// Same opt-in shape as the file-list cache, one step further: with a live
// watcher evicting edited files, an entry that survives in scanCache is known
// current, so the per-file stat() that would prove it can be skipped. A
// 2000-file rebuild stats 2000 files to learn that one changed. Off by default —
// a one-shot build has nobody to evict, and would serve whatever it read last.
let scanChangeTrackingEnabled = false;

export function enableScanChangeTracking(): void {
	scanChangeTrackingEnabled = true;
}

/**
 * Drop `file` from the scan cache — the watcher saw it change, so its classes
 * must be read again. `cwd` resolves watcher-relative paths (chokidar reports
 * them relative when constructed with a cwd); absolute paths need no cwd.
 */
export function markSourceFileChanged(file: string, cwd?: string): void {
	scanCache.delete(cwd === undefined ? file : resolve(cwd, file));
}

/** Watcher gone — every cache entry loses its guarantee, so drop the lot. */
export function disableScanChangeTracking(): void {
	scanChangeTrackingEnabled = false;
	scanCache.clear();
}

/**
 * Running union of the per-file scan results, held as a multiset so a rebuild
 * pays only for the files that changed. Re-unioning from scratch costs one
 * Set.add per class occurrence — 480k adds to rediscover the same 420 classes
 * on a 2000-file project — and an edit to one file would pay all of it.
 *
 * `counts` is what makes the incremental step sound: a class stays in the union
 * until the last file mentioning it stops doing so. `results` is index-aligned
 * with the scanned file list, and scanOneFile returns cached results by
 * identity, so `results[i] !== previous[i]` marks exactly the files to re-fold.
 */
let fileUnion: {
	results: FileScanResult[];
	counts: Map<string, number>;
	classes: Set<string>;
} | null = null;

/** Fold one file's classes into the multiset; `delta` is +1 to add, -1 to drop. */
function applyToUnion(
	union: { counts: Map<string, number>; classes: Set<string> },
	result: FileScanResult | undefined,
	delta: 1 | -1,
): void {
	if (!result?.classes) return;
	for (const cls of result.classes) {
		const next = (union.counts.get(cls) ?? 0) + delta;
		if (next > 0) {
			union.counts.set(cls, next);
			if (delta === 1) union.classes.add(cls);
		} else {
			union.counts.delete(cls);
			union.classes.delete(cls);
		}
	}
}

async function scanOneFile(file: string): Promise<FileScanResult> {
	const warnings: string[] = [];
	// A watcher-armed hit needs no stat: markSourceFileChanged() already removed
	// every entry an edit invalidated.
	if (scanChangeTrackingEnabled) {
		const tracked = scanCache.get(file);
		if (tracked) return tracked.result;
	}
	try {
		const stats = await withTimeout(stat(file), FILE_IO_TIMEOUT_MS, "stat() timed out");
		const cached = scanCache.get(file);
		if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
			return cached.result;
		}
		let result: FileScanResult;
		if (stats.size > MAX_FILE_SIZE) {
			result = {
				classes: null,
				warnings,
				failure: `[RI-1405] Skipping source file "${file}" (${stats.size} bytes) — exceeds ${MAX_FILE_SIZE} byte limit.`,
			};
		} else {
			const content = await withTimeout(
				readFile(file, "utf-8"),
				FILE_IO_TIMEOUT_MS,
				"readFile() timed out",
			);
			result = {
				classes: extractClassesFromSource({ path: file, content }, warnings),
				warnings,
				failure: null,
			};
		}
		if (scanCache.size >= SCAN_CACHE_MAX_ENTRIES) scanCache.clear();
		scanCache.set(file, { mtimeMs: stats.mtimeMs, size: stats.size, result });
		return result;
	} catch (err) {
		return {
			classes: null,
			warnings,
			failure: `[RI-1403] Could not read source file "${file}" — skipping. (${err instanceof Error ? err.message : String(err)})`,
		};
	}
}

/** Every class a scan produced, and the subset the user wrote by hand. Warnings
 *  that accuse a class of being a typo belong to the authored subset only. */
export interface ScannedClasses {
	classes: Set<string>;
	authored: Set<string>;
}

export async function scanSourceFilesAsync(
	sources: SourceDirective[],
	cwd: string,
): Promise<ScannedClasses & { warnings: string[] }> {
	const { classes: allClasses, warnings: inlineWarnings } = collectInlineClasses(sources);
	// `@source inline(...)` classes are authored — the user typed them. Copy the
	// set now, before file scanning merges its own finds into `allClasses`.
	const authored = new Set(allClasses);
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

	// Warnings stay on the per-result loop: it is one cheap pass over mostly
	// empty arrays, and its push order and budget accounting depend on what
	// `allWarnings` already holds from inline/resolve warnings.
	const seen = new Set(allWarnings);
	for (const result of results) {
		if (result.failure) {
			allWarnings.push(result.failure);
			seen.add(result.failure);
			continue;
		}
		pushWarningsDeduped(allWarnings, result.warnings, seen);
	}

	// Classes are the expensive half, and unlike warnings they fold into an
	// order-independent set — so the union carries over between rebuilds and
	// only the files whose result object changed are re-folded. A file list of a
	// different length restarts it: the index alignment the diff relies on is
	// gone. Any other reshuffle is still correct, because the multiset is a sum
	// over slots — it just re-folds more slots than it needs to.
	if (fileUnion === null || fileUnion.results.length !== results.length) {
		fileUnion = { results, counts: new Map(), classes: new Set() };
		for (const result of results) applyToUnion(fileUnion, result, 1);
	} else {
		const previous = fileUnion.results;
		for (let i = 0; i < results.length; i++) {
			if (previous[i] === results[i]) continue;
			applyToUnion(fileUnion, previous[i], -1);
			applyToUnion(fileUnion, results[i], 1);
		}
		fileUnion.results = results;
	}
	// Folded into `allClasses` rather than kept there: that set already carries
	// this call's inline-@source classes, which vary with `sources`.
	for (const cls of fileUnion.classes) allClasses.add(cls);

	return { classes: allClasses, authored, warnings: allWarnings };
}

/**
 * Shared source collection for the PostCSS plugin and the CLI. The merge
 * order is the cross-surface contract: user `@source` first, surface-provided
 * sources next, auto-discovered dep safelists last — predictable for
 * debugging, identical patterns dedupe at glob expansion time, and identical
 * input produces byte-identical output on both surfaces.
 *
 * `suppressed` carries the entry's `ri-disable` codes. Scan warnings (RI-14xx)
 * report no position in the CSS, so the file-wide comment is the only form that
 * can reach them, and this is the funnel where they enter a project's warnings.
 */
export async function collectProjectClasses(
	themeSources: readonly SourceDirective[],
	surfaceSources: readonly SourceDirective[],
	cwd: string,
	warnings: string[],
	warningSeen: Set<string>,
	suppressed?: ReadonlySet<string>,
): Promise<ScannedClasses> {
	const discovered = discoverPackageSafelistSources(cwd);
	pushWarningsDeduped(warnings, discovered.warnings, warningSeen, suppressed);
	const allSources = [...themeSources, ...surfaceSources, ...discovered.sources];
	const scanResult = await scanSourceFilesAsync(allSources, cwd);
	pushWarningsDeduped(warnings, scanResult.warnings, warningSeen, suppressed);
	return { classes: scanResult.classes, authored: scanResult.authored };
}
