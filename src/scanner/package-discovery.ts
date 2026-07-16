/**
 * Auto-discovery of `safelist()` source globs from the consumer's installed
 * dependencies.
 *
 * A library opts in by declaring this in its own `package.json`:
 *
 *   {
 *     "rainbowindex": {
 *       "safelistSources": ["./dist/**\/*.{js,mjs}"]
 *     }
 *   }
 *
 * At compile time, this module reads the consumer's `package.json`, walks
 * each declared dependency (`dependencies` + `peerDependencies` —
 * `devDependencies` are intentionally skipped to avoid scanning toolchain
 * packages), resolves the dep's own `package.json`, and turns each glob
 * into an absolute path relative to the dep's install location.
 *
 * The returned patterns are merged with the user's `@source` directives by
 * the PostCSS plugin, so the same compilation flow handles both
 * user-authored and auto-discovered sources.
 *
 * Resolution uses a direct filesystem walk for the dep's `package.json`,
 * starting at `<cwd>/node_modules/<dep>/package.json` and walking up the
 * directory tree until found or root is reached. This intentionally
 * bypasses Node's `require.resolve("<dep>/package.json")` path — modern
 * packages with a strict `exports` field don't expose `./package.json`
 * (the JSON file itself isn't in the export map), so going through the
 * resolver throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. The filesystem walk
 * handles all common layouts: npm, yarn classic, yarn workspaces (hoisting
 * upward), and pnpm symlinks (`existsSync` follows the symlink at
 * `node_modules/<dep>`). Yarn PnP is out of scope.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { validateGlobPattern } from "./glob-utils.js";
import type { SourceDirective } from "../directives/foundation.js";

interface PackageJson {
	name?: string;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	rainbowindex?: {
		// `unknown` because dep-authored JSON is untrusted — validated at use.
		safelistSources?: unknown;
	};
}

/**
 * Result of a discovery pass — patterns to scan plus any warnings collected
 * along the way (malformed package.json, missing dep, etc.). Warnings are
 * returned rather than thrown so a single broken dep can't take down a
 * whole compilation.
 */
export interface SafelistDiscoveryResult {
	sources: SourceDirective[];
	warnings: string[];
}

const EMPTY: SafelistDiscoveryResult = Object.freeze({ sources: [], warnings: [] });

/**
 * Per-cwd memo for discovery results, keyed on the consumer package.json's
 * mtime. Discovery walks every dep's package.json synchronously and runs in
 * the PostCSS `Once` hook on every rebuild — re-walking is wasted I/O when
 * nothing changed. A changed dep set requires an install, which rewrites the
 * consumer's package.json and so bumps its mtime.
 */
const discoveryCache = new Map<string, { mtimeMs: number; result: SafelistDiscoveryResult }>();

/** Test-only: clear the per-cwd discovery memo. */
export function resetSafelistDiscoveryCache(): void {
	discoveryCache.clear();
}

/**
 * Discover safelist sources from every direct dependency of the project
 * rooted at `cwd`. Returns an empty result when `cwd` has no `package.json`
 * or no qualifying deps.
 */
export function discoverPackageSafelistSources(cwd: string): SafelistDiscoveryResult {
	const cwdAbs = resolve(cwd);
	let mtimeMs: number;
	try {
		mtimeMs = statSync(join(cwdAbs, "package.json")).mtimeMs;
	} catch {
		// No consumer package.json — nothing to discover. Not an error; rainbowindex
		// can be used outside a Node project (e.g. ad-hoc CLI invocation).
		return EMPTY;
	}
	const cached = discoveryCache.get(cwdAbs);
	if (cached && cached.mtimeMs === mtimeMs) return cached.result;

	const result = runDiscovery(cwdAbs);
	discoveryCache.set(cwdAbs, { mtimeMs, result });
	return result;
}

function runDiscovery(cwdAbs: string): SafelistDiscoveryResult {
	let consumer: PackageJson;
	try {
		consumer = readPackageJson(join(cwdAbs, "package.json"));
	} catch {
		return EMPTY;
	}

	const deps: string[] = [
		...Object.keys(consumer.dependencies ?? {}),
		...Object.keys(consumer.peerDependencies ?? {}),
	];
	if (deps.length === 0) return EMPTY;

	const sources: SourceDirective[] = [];
	const warnings: string[] = [];

	for (const depName of deps) {
		const depPkgPath = findDepPackageJson(cwdAbs, depName);
		if (!depPkgPath) {
			// Dep is declared but not installed under any walked `node_modules`.
			// Common during dev; not a warning.
			continue;
		}

		let depPkg: PackageJson;
		try {
			depPkg = readPackageJson(depPkgPath);
		} catch (err) {
			warnings.push(
				`[RI-1410] Could not read ${depName}/package.json during safelist discovery: ${errMessage(err)}`,
			);
			continue;
		}

		const patterns = depPkg.rainbowindex?.safelistSources;
		if (patterns == null) continue;
		if (!Array.isArray(patterns)) {
			warnings.push(
				`[RI-1410] Invalid rainbowindex.safelistSources in ${depName} — expected an array of glob strings.`,
			);
			continue;
		}
		if (patterns.length === 0) continue;

		// Resolve through any symlinks so pnpm-style layouts produce stable
		// absolute paths rather than `<cwd>/node_modules/<dep>/…` paths that
		// point into the `.pnpm` store via a symlink.
		const depRoot = realpathOrFallback(dirname(depPkgPath)).replace(/\\/g, "/");
		for (const pattern of patterns) {
			if (typeof pattern !== "string" || !pattern) {
				warnings.push(
					`[RI-1410] Invalid rainbowindex.safelistSources entry in ${depName} — expected a non-empty glob string.`,
				);
				continue;
			}
			// The resulting glob is marked `absolute: true`, which bypasses
			// validateGlobPattern downstream — so dep-authored patterns must pass
			// the same structural checks HERE (relative, no "..", no null bytes),
			// before they earn that trust.
			if (validateGlobPattern(pattern) !== null) {
				warnings.push(
					`[RI-1410] Invalid rainbowindex.safelistSources entry "${pattern}" in ${depName} — patterns must be relative to the package root and must not traverse parent directories.`,
				);
				continue;
			}
			// Resolve the glob against the dep's own root. tinyglobby accepts
			// absolute globs, so we just join + normalise to forward slashes.
			const absolute = posix.normalize(`${depRoot}/${pattern.replace(/^\.\//, "")}`);
			if (absolute !== depRoot && !absolute.startsWith(`${depRoot}/`)) {
				warnings.push(
					`[RI-1410] Invalid rainbowindex.safelistSources entry "${pattern}" in ${depName} — resolved outside the package root.`,
				);
				continue;
			}
			sources.push({ pattern: absolute, negated: false, inline: false, absolute: true });
		}
	}

	return { sources, warnings };
}

function readPackageJson(path: string): PackageJson {
	const raw = readFileSync(path, "utf8");
	return JSON.parse(raw) as PackageJson;
}

/**
 * Walk up from `cwd` looking for `node_modules/<depName>/package.json`.
 * Returns the first hit, or null if none found. Handles scoped packages
 * because `depName` carries its scope (`@scope/pkg`) and joins cleanly.
 */
function findDepPackageJson(cwd: string, depName: string): string | null {
	let dir = cwd;
	while (true) {
		const candidate = join(dir, "node_modules", depName, "package.json");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function realpathOrFallback(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function errMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
