import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import type { CLIOptions } from "./args.js";
import { buildCSS, type BuildResult } from "./build.js";
import {
	DEFAULT_EXCLUDES,
	DEFAULT_PATTERNS,
	disableScanChangeTracking,
	enableScanChangeTracking,
	enableSourceFileListCache,
	invalidateSourceFileListCache,
	markSourceFileChanged,
} from "../scanner/sources.js";

/** Minify when requested. Lazy: loading lightningcss pulls in a native
 *  binding — only pay for it (and only risk its platform-support failure
 *  modes) when minifying. Shared by the stdout build path (entries/cli.ts)
 *  and buildAndWrite below. */
export async function minifyIfRequested(css: string, opts: CLIOptions): Promise<string> {
	if (!opts.minify) return css;
	const { optimizeCSS } = await import("./optimize.js");
	return optimizeCSS(css);
}

/** Build, optionally minify, and atomically write the output file. Shared by
 *  the one-shot `build -o` path (entries/cli.ts) and every watch rebuild. */
export async function buildAndWrite(
	opts: CLIOptions,
	cwd: string,
	outputFile: string,
): Promise<BuildResult> {
	const result = await buildCSS(opts, cwd);
	const css = await minifyIfRequested(result.css, opts);
	const outputPath = resolve(cwd, outputFile);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFileAtomic(outputPath, css);
	return result;
}

export async function watchMode(opts: CLIOptions, cwd: string): Promise<void> {
	if (!opts.output) {
		throw new Error("--output is required with --watch");
	}
	const outputFile = opts.output;

	const initialBuild = await buildAndWrite(opts, cwd, outputFile);
	console.log(`[rainbowindex] Built: ${opts.output}`);

	let chokidar: typeof import("chokidar");
	try {
		chokidar = await import("chokidar");
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		throw new Error(`Watch mode could not load "chokidar" (a bundled dependency): ${detail}`);
	}
	const watchPaths = opts.globs.length > 0 ? [...opts.globs] : [...DEFAULT_PATTERNS];
	if (initialBuild.cssFile) watchPaths.push(initialBuild.cssFile);

	const watcher = chokidar.watch(watchPaths, {
		cwd,
		ignored: [...DEFAULT_EXCLUDES],
		ignoreInitial: true,
		awaitWriteFinish: { stabilityThreshold: 50 },
	});

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	/** In-flight rebuild; null when idle. Doubles as the "building" flag and as
	 *  the promise cleanup awaits (it never rejects — runBuild catches). */
	let currentBuild: Promise<void> | null = null;
	/** A change arrived while a build was in flight — run exactly once more. */
	let dirty = false;
	let consecutiveErrors = 0;
	let errorsPaused = false;
	const MAX_CONSECUTIVE_ERRORS = 5;
	const MIN_REBUILD_INTERVAL_MS = 500;
	let lastBuildStart = 0;
	const currentWatchedPaths = new Set(watchPaths);
	const MAX_WATCHED_PATHS = 10_000;

	// Diff @source watch paths from the theme the build just resolved —
	// re-reading the CSS file here could observe different contents.
	const syncSourceWatchPaths = (theme: BuildResult["theme"]) => {
		const newPaths = theme.sources.filter((s) => !s.negated && !s.inline).map((s) => s.pattern);
		const newPathSet = new Set(newPaths);
		for (const p of currentWatchedPaths) {
			if (!newPathSet.has(p) && !watchPaths.includes(p)) {
				watcher.unwatch(p);
				currentWatchedPaths.delete(p);
			}
		}
		for (const p of newPaths) {
			if (!currentWatchedPaths.has(p)) {
				if (currentWatchedPaths.size >= MAX_WATCHED_PATHS) {
					console.warn(
						`[rainbowindex] Watched path count (${currentWatchedPaths.size}) exceeds ${MAX_WATCHED_PATHS} limit. This may cause EMFILE errors. Narrow your @source patterns or increase the OS file descriptor limit (ulimit -n).`,
					);
					break;
				}
				watcher.add(p);
				currentWatchedPaths.add(p);
			}
		}
	};
	syncSourceWatchPaths(initialBuild.theme);

	const runBuild = async (): Promise<void> => {
		lastBuildStart = Date.now();
		try {
			const result = await buildAndWrite(opts, cwd, outputFile);
			console.log(`[rainbowindex] Rebuilt: ${outputFile}`);
			consecutiveErrors = 0;
			errorsPaused = false;
			syncSourceWatchPaths(result.theme);
		} catch (err) {
			consecutiveErrors++;
			console.error("[rainbowindex] Build error:", err);
		} finally {
			currentBuild = null;
			if (dirty) {
				dirty = false;
				scheduleRebuild();
			}
		}
	};

	const scheduleRebuild = () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		// Debounce and rate-limit share the one timer: wait out the debounce
		// window, or longer so build starts stay MIN_REBUILD_INTERVAL_MS apart.
		const delay = Math.max(100, MIN_REBUILD_INTERVAL_MS - (Date.now() - lastBuildStart));
		debounceTimer = setTimeout(() => {
			if (currentBuild) {
				dirty = true;
				return;
			}
			if (errorsPaused) {
				// A save after the pause resumes building from a clean slate —
				// without resetting the counter the pause is permanent.
				errorsPaused = false;
				consecutiveErrors = 0;
			} else if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
				console.error(
					`[rainbowindex] Paused rebuilds after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Fix the issue and save a file to resume.`,
				);
				errorsPaused = true;
				return;
			}
			currentBuild = runBuild();
		}, delay);
	};

	// This watcher is what lets the scanner cache its glob result and trust its
	// per-file entries without a stat — the same bargain the Vite plugin makes.
	// Both caches are armed only now, after the initial build, so a one-shot
	// `rainbowindex` run in the same process never reads a cache nobody watches.
	// Paths arrive relative to `cwd` (chokidar was given one), so eviction
	// resolves them against it.
	enableSourceFileListCache();
	enableScanChangeTracking();

	watcher.on("change", (file: string) => {
		markSourceFileChanged(file, cwd);
		scheduleRebuild();
	});
	watcher.on("add", (file: string) => {
		invalidateSourceFileListCache();
		markSourceFileChanged(file, cwd);
		scheduleRebuild();
	});
	watcher.on("unlink", (file: string) => {
		invalidateSourceFileListCache();
		markSourceFileChanged(file, cwd);
		scheduleRebuild();
	});
	watcher.on("unlinkDir", invalidateSourceFileListCache);
	watcher.on("error", (err: unknown) => {
		console.error("[rainbowindex] Watcher error:", err);
	});

	let cleanupCalled = false;
	const cleanup = () => {
		if (cleanupCalled) return;
		cleanupCalled = true;
		if (debounceTimer) clearTimeout(debounceTimer);
		dirty = false;
		invalidateSourceFileListCache();
		disableScanChangeTracking();

		const doExit = () => {
			watcher
				.close()
				.then(() => {
					console.log("\n[rainbowindex] Watcher stopped.");
					process.exit(0);
				})
				.catch(() => {
					process.exit(1);
				});
		};

		if (currentBuild) {
			const timeout = new Promise<void>((r) => setTimeout(r, 5000));
			Promise.race([currentBuild, timeout]).then(doExit);
		} else {
			doExit();
		}
	};

	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);
}
