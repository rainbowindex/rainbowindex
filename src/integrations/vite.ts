import { type Dirent, existsSync } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { HmrContext, ModuleNode, Plugin, UserConfig, ViteDevServer } from "vite";
import { hasRIActivation } from "../directives/index.js";
import type { SerializedSnapshot } from "../merge/context.js";
import { inlineDirectiveImports } from "../project/imports.js";
import { createNodeImportResolver } from "../project/resolve-import.js";
import { snapshotFromCSS } from "../project/snapshot.js";
import { rewriteDirectiveBodies, usesLegacyDirectiveSyntax } from "../directives/postcss-safe.js";
import { parseFileDisables } from "../directives/suppress.js";
import { warningCode } from "../diagnostics.js";
import { devWarn } from "../runtime.js";
import { expandGroupsInStylesheet, extractClassesFromSource } from "../scanner/class-extraction.js";
import { isSourceFile } from "../scanner/source-files.js";
import {
	disableScanChangeTracking,
	enableScanChangeTracking,
	enableSourceFileListCache,
	invalidateSourceFileListCache,
	markSourceFileChanged,
} from "../scanner/sources.js";
import { codepointCompare } from "../shared.js";
import rainbowindex from "./postcss/index.js";

const CSS_FILE_RE = /\.(?:module\.)?css$/;

/**
 * The virtual module that carries the project's theme into the client bundle.
 *
 * `ri()` resolves a class by asking the published snapshot what properties it
 * sets. In a browser bundle no compile ever runs, so without this the snapshot
 * is empty and every project-defined text size, weight, font slot, and color
 * name is unknown — `ri("text-lg text-white")` reads `text-lg` as a color and
 * drops it. This module publishes the theme before any importer's body runs.
 */
const SNAPSHOT_ID = "virtual:rainbowindex/snapshot";
/** Vite's convention: a resolved virtual id is prefixed with a NUL byte. */
const RESOLVED_SNAPSHOT_ID = `\0${SNAPSHOT_ID}`;

/**
 * An import of the package itself — the only way a module reaches `ri()`.
 *
 * Tested against a module's code *after* every other plugin has transformed it,
 * so a `.svelte`/`.vue`/`.astro` component has already become JavaScript and
 * this sees the import its `<script>` block wrote. That ordering is the whole
 * reason injection is a separate `post` plugin: at `pre` the code is still SFC
 * markup, and a prepended `import` line lands in the template — Svelte compiles
 * it to a text node and renders it on the page, publishing nothing.
 */
const RI_IMPORT_RE = /from\s*["']rainbowindex["']/;

// Directories never worth recursing for an RI CSS entry; skipping node_modules
// is what keeps the cold-start disk fallback from walking the whole dep tree.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);
const POSTCSS_CONFIG_FILES = [
	"postcss.config.js",
	"postcss.config.mjs",
	"postcss.config.ts",
	"postcss.config.cjs",
] as const;

/**
 * A Vite config patch that can also carry Vite+ blocks. Vite+ reads `fmt` off
 * the *resolved* Vite config, so a plugin contributes to it from the config
 * hook; the key is not part of Vite's own `UserConfig`. Plain Vite ignores it.
 */
type ViteConfigPatch = Omit<UserConfig, "plugins"> & {
	fmt?: { ignorePatterns: string[] };
};

function isIgnorableDirectoryReadError(err: unknown): boolean {
	return (
		!!err &&
		typeof err === "object" &&
		"code" in err &&
		((err as { code?: string }).code === "ENOENT" ||
			(err as { code?: string }).code === "ENOTDIR" ||
			(err as { code?: string }).code === "EACCES" ||
			(err as { code?: string }).code === "EPERM")
	);
}

function hasLocalPostCSSConfig(root: string): boolean {
	return POSTCSS_CONFIG_FILES.some((name) => existsSync(resolve(root, name)));
}

/**
 * A pair, because the two halves need opposite ends of Vite's pipeline.
 *
 * `rainbowindex` runs `pre`: it has to read a CSS entry before Vite inlines its
 * `@import` at-rules. `rainbowindex:snapshot` runs `post`: it has to prepend an
 * import to real JavaScript, after every framework compiler has turned a
 * component into some. Vite flattens a returned array, so `plugins:
 * [rainbowindex()]` is unchanged for the caller.
 */
export default function rainbowindexVite(): Plugin[] {
	let root = process.cwd();
	let logger: { info: (msg: string) => void; warn: (msg: string) => void } | undefined;
	const riCSSFiles = new Set<string>();
	/** Text of each RI CSS entry, for building the client snapshot. */
	const riCSSSources = new Map<string, string>();
	let devServer: ViteDevServer | undefined;
	const fileVersions = new Map<string, number>();
	// Sorted-unique candidate list per source file; an edit that leaves it
	// unchanged (logic or comments only) produces byte-identical CSS, so the
	// RI entries need no re-transform. Pruned alongside the CSS tracking maps.
	const candidateSignatures = new Map<string, string>();
	let hotUpdateCount = 0;
	const PRUNE_INTERVAL = 50;

	/**
	 * Import the theme ahead of any module that reaches `ri()`.
	 *
	 * A separate plugin because it is the mirror image of the CSS one: that
	 * has to run `pre`, before Vite inlines `@import`; this has to run `post`,
	 * after every framework compiler, so the code it prepends a line to is
	 * JavaScript rather than component markup.
	 *
	 * ES imports evaluate in order, so the snapshot is published before the
	 * module's body runs — no `ri()` call can see an empty one. Dev, build and
	 * SSR alike: an SSR render is just as theme-blind as a browser bundle.
	 */
	const injectSnapshot: Plugin = {
		name: "rainbowindex:snapshot",
		enforce: "post",

		transform(code: string, id: string) {
			if (id === RESOLVED_SNAPSHOT_ID || !RI_IMPORT_RE.test(code)) return null;
			// No newline: every line of the original keeps its number, so a stack
			// trace and a breakpoint still point where the author looks. Only
			// line 1's columns shift, which is why the map is still declared.
			return {
				code: `import ${JSON.stringify(SNAPSHOT_ID)};${code}`,
				map: { mappings: "" },
			};
		},
	};

	return [
		{
			name: "rainbowindex",
			enforce: "pre",

			async config(config: UserConfig) {
				root = config.root ?? process.cwd();
				const patch: ViteConfigPatch = {};

				const ignorePatterns = await riStylesheetPatterns(root);
				if (ignorePatterns.length > 0) {
					patch.fmt = { ignorePatterns };
				}

				if (!hasLocalPostCSSConfig(root)) {
					patch.css = {
						postcss: {
							plugins: [rainbowindex()],
						},
					};
				}

				return patch;
			},

			configureServer(server: ViteDevServer) {
				root = server.config?.root ?? process.cwd();
				// Held so a theme edit can invalidate the published client snapshot.
				devServer = server;
				// The resolved source-file list may only be cached while file
				// adds/deletes invalidate it — this watcher is what makes that safe.
				enableSourceFileListCache();
				server.watcher?.on("add", invalidateSourceFileListCache);
				server.watcher?.on("unlink", invalidateSourceFileListCache);
				server.watcher?.on("unlinkDir", invalidateSourceFileListCache);
				server.httpServer?.once("close", invalidateSourceFileListCache);
				// Same bargain for the per-file scan cache: with this watcher evicting
				// what changes, the scanner can trust a surviving entry and skip its
				// stat(). handleHotUpdate evicts too — it runs before the CSS
				// re-transform that reads the cache — and this covers the files Vite
				// keeps no module for, such as plain .html.
				enableScanChangeTracking();
				server.watcher?.on("change", (file: string) => markSourceFileChanged(file));
				server.httpServer?.once("close", disableScanChangeTracking);
				logger = {
					info: (msg) => server.config.logger?.info?.(msg, { timestamp: true }),
					warn: (msg) => server.config.logger?.warn?.(msg, { timestamp: true }),
				};
				if (hasLocalPostCSSConfig(root)) {
					logger.info("[rainbowindex] Using local PostCSS config — skipped auto-injection.");
				} else {
					logger.info("[rainbowindex] Injected PostCSS plugin (no local postcss.config.* found).");
				}
				server.httpServer?.once("listening", async () => {
					const cssFiles: string[] = [];
					const fileMap = server.moduleGraph.fileToModulesMap;
					if (fileMap) {
						for (const [file] of fileMap) {
							if (CSS_FILE_RE.test(file)) {
								cssFiles.push(file);
							}
						}
					}
					if (cssFiles.length === 0) {
						const diskCSS = await findCSSFilesOnDisk(root);
						cssFiles.push(...diskCSS);
					}
					await Promise.all(cssFiles.map((file) => checkCSSFileAsync(file)));
					if (riCSSFiles.size === 0) {
						logger?.warn(
							`[RI-1602] rainbowindex Vite plugin is registered but no CSS entry with \`@import "rainbowindex"\` was found under ${root}. Create one (e.g. src/index.css) and import it from your app entry, then restart the dev server. Or run \`rainbowindex init\` to wire it up automatically.`,
						);
					} else {
						const list = [...riCSSFiles]
							.map((f) => relative(root, f).replaceAll("\\", "/"))
							.join(", ");
						logger?.info(`[rainbowindex] CSS entries: ${list}`);
					}
				});
			},

			resolveId(id: string) {
				return id === SNAPSHOT_ID ? RESOLVED_SNAPSHOT_ID : null;
			},

			async load(id: string) {
				if (id !== RESOLVED_SNAPSHOT_ID) return null;
				// In a build this module is the first import of the first entry, so it
				// can be loaded before any CSS file has passed through `transform` —
				// the theme would then be empty, silently. Seed from disk when that
				// happens; the dev server takes the same path on cold start.
				if (riCSSSources.size === 0) await seedCSSSourcesFromDisk();
				// Built from the CSS entry text alone — `analyzeProjectCSS` resolves
				// directives with no source scan, so this cannot depend on which
				// source files happen to have been scanned yet.
				const snapshot = buildClientSnapshot();
				return (
					`import { hydrateSnapshot, publishSnapshot } from "rainbowindex";\n` +
					`publishSnapshot(hydrateSnapshot(${JSON.stringify(snapshot)}));\n` +
					`if (import.meta.hot) import.meta.hot.accept();\n`
				);
			},

			transform(code: string, id: string) {
				const file = id.split("?")[0];
				if (CSS_FILE_RE.test(file)) {
					fileVersions.set(file, (fileVersions.get(file) ?? 0) + 1);
					if (hasRIActivation(code)) {
						riCSSFiles.add(file);
						// Stored raw. This plugin is `enforce: "pre"`, so it runs ahead of
						// Vite's own CSS plugin and `code` still holds its `@import`
						// at-rules — buildClientSnapshot resolves them.
						if (riCSSSources.get(file) !== code) {
							riCSSSources.set(file, code);
							invalidateClientSnapshot();
						}
						let safe = rewriteDirectiveBodies(code);
						// Expand variant group syntax inside @apply / @a bodies
						// (e.g. `@apply hover:{px-2 leading-none}` → `@apply hover:px-2 hover:leading-none`).
						// PostCSS reads `{` as the start of a CSS block, so unexpanded groups
						// would error out before any plugin runs.
						const expandWarnings: string[] = [];
						safe = expandGroupsInStylesheet(safe, expandWarnings, file);
						// This pass runs before the compile, so it holds no analysis to
						// read the entry's `ri-disable` codes from — but the entry is the
						// text in hand, so parse them straight out of it.
						const suppressed = parseFileDisables(code);
						for (const w of expandWarnings) {
							const warned = warningCode(w);
							if (warned !== null && suppressed.has(warned)) continue;
							(logger?.warn ?? console.warn)(`[rainbowindex] ${w}`);
						}
						return safe !== code ? safe : null;
					}
					riCSSFiles.delete(file);
					if (riCSSSources.delete(file)) invalidateClientSnapshot();
				}

				return null;
			},

			async handleHotUpdate(ctx: HmrContext) {
				const { file, server, modules } = ctx;
				if (++hotUpdateCount % PRUNE_INTERVAL === 0) {
					await pruneDeletedFiles();
				}

				if (CSS_FILE_RE.test(file)) {
					await checkCSSFileAsync(file);
					return;
				}

				if (!isSourceFile(file)) return;

				markSourceFileChanged(file);

				// A first sighting or a failed read invalidates conservatively; an
				// unchanged signature skips the CSS re-transform and leaves Vite's
				// default HMR for the file itself untouched.
				const previous = candidateSignatures.get(file);
				let signature: string | undefined;
				try {
					const content = await ctx.read();
					signature = [...extractClassesFromSource({ path: file, content })]
						.sort(codepointCompare)
						.join(" ");
				} catch {
					candidateSignatures.delete(file);
				}
				if (signature !== undefined) {
					candidateSignatures.set(file, signature);
					if (previous === signature) return;
				}

				const extraModules: ModuleNode[] = [];
				const hmrModules = new Set(modules);
				for (const cssFile of riCSSFiles) {
					const mods = server.moduleGraph.getModulesByFile(cssFile);
					if (mods) {
						for (const mod of mods) {
							if (!hmrModules.has(mod)) {
								extraModules.push(mod);
							}
						}
					}
				}

				if (extraModules.length > 0) {
					return [...modules, ...extraModules];
				}
			},
		},
		injectSnapshot,
	];

	/**
	 * Read every activating CSS file under the root into `riCSSSources`.
	 *
	 * Only for the case where the snapshot is needed before Vite has transformed
	 * any CSS. `transform` remains the authority: whatever it sees later
	 * overwrites this, which matters because Vite inlines a file's own `@import`
	 * at-rules and a raw disk read does not.
	 */
	async function seedCSSSourcesFromDisk(): Promise<void> {
		const files = await findCSSFilesOnDisk(root);
		await Promise.all(
			files.map(async (file) => {
				try {
					const content = await readFile(file, "utf-8");
					if (!hasRIActivation(content)) return;
					riCSSFiles.add(file);
					riCSSSources.set(file, content);
				} catch {
					// Unreadable: the compile reports it; the theme just omits it.
				}
			}),
		);
	}

	/**
	 * The theme every RI entry adds up to, in path order so two entries defining
	 * the same token resolve the same way on every machine.
	 */
	function buildClientSnapshot(): SerializedSnapshot {
		// `@import` is resolved here, not at capture time, because all three
		// capture paths (transform, the disk seed, the watcher) feed this one
		// function — inlining anywhere else leaves a way in that skips it.
		//
		// Without this the client snapshot is built from un-inlined text, so a
		// theme living behind an import publishes as empty and `ri()` goes back
		// to guessing — the exact bug C1 exists to fix, reappearing for the
		// documented `@import "rainbowindex/tailwind.css"` start.
		const resolveImport = createNodeImportResolver({ cwd: root });
		const css = [...riCSSSources.keys()]
			.sort(codepointCompare)
			.map((file) => {
				const text = riCSSSources.get(file) ?? "";
				try {
					return inlineDirectiveImports(text, { resolve: resolveImport, from: file }).css;
				} catch {
					// A resolver fault must never take the dev server down. The
					// snapshot is then thinner than it could be, which degrades to
					// the pre-C1 behaviour rather than to a crash.
					return text;
				}
			})
			.join("\n");
		return snapshotFromCSS(css);
	}

	/**
	 * Drop the published virtual module so the next request rebuilds it.
	 *
	 * Guarded like the watcher and httpServer accesses above: a host can hand
	 * `configureServer` a partial server, and a theme edit must never be the
	 * thing that takes the dev server down.
	 */
	function invalidateClientSnapshot(): void {
		const graph = devServer?.moduleGraph;
		if (!graph) return;
		const mod = graph.getModuleById(RESOLVED_SNAPSHOT_ID);
		if (mod) graph.invalidateModule(mod);
	}

	async function pruneDeletedFiles(): Promise<void> {
		// fileVersions tracks every transformed CSS file, not just RI ones —
		// prune from the union or the map grows unboundedly in long dev sessions.
		const tracked = new Set([...riCSSFiles, ...fileVersions.keys(), ...candidateSignatures.keys()]);
		const checks = [...tracked].map(async (file) => {
			try {
				await access(file);
			} catch {
				riCSSFiles.delete(file);
				if (riCSSSources.delete(file)) invalidateClientSnapshot();
				fileVersions.delete(file);
				candidateSignatures.delete(file);
			}
		});
		await Promise.all(checks);
	}

	async function collectCSSFiles(dir: string, results: string[]): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (err) {
			if (!isIgnorableDirectoryReadError(err)) {
				const msg = err instanceof Error ? err.message : String(err);
				devWarn(`[RI-1601] Failed to scan CSS files in "${dir}": ${msg}`);
			}
			return;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				// Symlinked directories report isDirectory() === false, so each real
				// path is visited exactly once — no dedup set needed.
				if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
				await collectCSSFiles(join(dir, entry.name), results);
			} else if (entry.isFile() && CSS_FILE_RE.test(entry.name)) {
				results.push(join(dir, entry.name));
			}
		}
	}

	/**
	 * Stylesheets that carry RI syntax, as root-relative POSIX paths.
	 *
	 * Directive bodies are not valid CSS: `@font` and `@animate` entries put a
	 * block after a declaration, token scales remove with `!name;`, `@fluid`
	 * and `@color` take bare keywords, and `@apply` bodies take variant groups.
	 * A strict CSS parser stops at the first one, so Oxfmt — the formatter
	 * behind `vp fmt` and `vp check` — fails the whole run before it can lint
	 * or type check. The paths feed `fmt.ignorePatterns`, which keeps those
	 * files out of the formatter and leaves every other file formatted.
	 *
	 * **Only the files that need it.** Every one of those four forms now has a
	 * spelling that is valid CSS,
	 * so a stylesheet written the canonical way is hidden from nothing — which
	 * is the whole point of the RFC. `usesLegacyDirectiveSyntax` errs toward
	 * hiding: a file it cannot read confidently keeps the ignore.
	 */
	async function riStylesheetPatterns(root: string): Promise<string[]> {
		const files = await findCSSFilesOnDisk(root);
		const active = await Promise.all(
			files.map(async (file) => {
				try {
					const code = await readFile(file, "utf-8");
					if (!hasRIActivation(code)) return null;
					return usesLegacyDirectiveSyntax(code) ? file : null;
				} catch {
					// An unreadable file cannot be formatted either — leave it out
					// rather than fail the config hook.
					return null;
				}
			}),
		);
		return active
			.filter((file) => file !== null)
			.map((file) => relative(root, file).replaceAll("\\", "/"));
	}

	async function findCSSFilesOnDisk(root: string): Promise<string[]> {
		const results: string[] = [];
		await collectCSSFiles(root, results);
		return results;
	}

	async function checkCSSFileAsync(file: string): Promise<void> {
		const versionBefore = fileVersions.get(file) ?? 0;
		try {
			const raw = await readFile(file, "utf-8");
			if ((fileVersions.get(file) ?? 0) !== versionBefore) return;
			if (hasRIActivation(raw)) {
				riCSSFiles.add(file);
				// This runs before the CSS re-transform, so publishing the new
				// theme here is what makes a token edit reach the client in the
				// same hot update rather than one behind.
				if (riCSSSources.get(file) !== raw) {
					riCSSSources.set(file, raw);
					invalidateClientSnapshot();
				}
			} else {
				riCSSFiles.delete(file);
				if (riCSSSources.delete(file)) invalidateClientSnapshot();
			}
		} catch (_err) {
			if ((fileVersions.get(file) ?? 0) !== versionBefore) return;
			riCSSFiles.delete(file);
			if (riCSSSources.delete(file)) invalidateClientSnapshot();
		}
	}
}
