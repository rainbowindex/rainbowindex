import { type Dirent, existsSync } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { HmrContext, ModuleNode, Plugin, UserConfig, ViteDevServer } from "vite";
import { hasRIActivation } from "../directives/index.js";
import { rewriteDirectiveBodies } from "../directives/postcss-safe.js";
import { parseFileDisables } from "../directives/suppress.js";
import { warningCode } from "../diagnostics.js";
import { devWarn } from "../runtime.js";
import { expandApplyGroups, extractClassesFromSource } from "../scanner/class-extraction.js";
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

export default function rainbowindexVite(): Plugin {
	let root = process.cwd();
	let logger: { info: (msg: string) => void; warn: (msg: string) => void } | undefined;
	const riCSSFiles = new Set<string>();
	const fileVersions = new Map<string, number>();
	// Sorted-unique candidate list per source file; an edit that leaves it
	// unchanged (logic or comments only) produces byte-identical CSS, so the
	// RI entries need no re-transform. Pruned alongside the CSS tracking maps.
	const candidateSignatures = new Map<string, string>();
	let hotUpdateCount = 0;
	const PRUNE_INTERVAL = 50;

	return {
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

		transform(code: string, id: string) {
			const file = id.split("?")[0];
			if (CSS_FILE_RE.test(file)) {
				fileVersions.set(file, (fileVersions.get(file) ?? 0) + 1);
				if (hasRIActivation(code)) {
					riCSSFiles.add(file);
					let safe = rewriteDirectiveBodies(code);
					// Expand variant group syntax inside @apply / @a bodies
					// (e.g. `@apply hover:{px-2 leading-none}` → `@apply hover:px-2 hover:leading-none`).
					// PostCSS reads `{` as the start of a CSS block, so unexpanded groups
					// would error out before any plugin runs.
					const expandWarnings: string[] = [];
					safe = expandApplyGroups(safe, expandWarnings, file);
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
	};

	async function pruneDeletedFiles(): Promise<void> {
		// fileVersions tracks every transformed CSS file, not just RI ones —
		// prune from the union or the map grows unboundedly in long dev sessions.
		const tracked = new Set([...riCSSFiles, ...fileVersions.keys(), ...candidateSignatures.keys()]);
		const checks = [...tracked].map(async (file) => {
			try {
				await access(file);
			} catch {
				riCSSFiles.delete(file);
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
	 */
	async function riStylesheetPatterns(root: string): Promise<string[]> {
		const files = await findCSSFilesOnDisk(root);
		const active = await Promise.all(
			files.map(async (file) => {
				try {
					return hasRIActivation(await readFile(file, "utf-8")) ? file : null;
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
			} else {
				riCSSFiles.delete(file);
			}
		} catch (_err) {
			if ((fileVersions.get(file) ?? 0) !== versionBefore) return;
			riCSSFiles.delete(file);
		}
	}
}
