import { existsSync, type Dirent } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { HmrContext, ModuleNode, Plugin, UserConfig, ViteDevServer } from "vite";
import rainbowindex from "./postcss/index.js";
import { hasRIActivation, isAtRuleNameChar } from "../directives/index.js";
import { findClosingBrace } from "../directives/foundation.js";
import { expandApplyGroups } from "../scanner/class-extraction.js";
import { isSourceFile } from "../scanner/source-files.js";
import { devWarn } from "../runtime.js";
import { isAtRuleBoundary } from "../shared.js";

const CSS_FILE_RE = /\.(?:module\.)?css$/;

// Directives whose bodies use the `!name;` removal syntax (parseKeyValueBody,
// parseColorBody, parseAnimateBody). @utility/@custom/@font and friends carry
// raw CSS in their bodies and must never be rewritten.
const REMOVAL_BODY_DIRECTIVES = new Set([
	"color",
	"text",
	"spacing",
	"breakpoint",
	"rounded",
	"shadow",
	"weight",
	"ease",
	"blur",
	"z",
	"animate",
	"leading",
	"tracking",
	"opacity",
	"duration",
]);
// @fluid bodies use bare curve keywords that PostCSS cannot parse as declarations.
const KEYWORD_BODY_DIRECTIVES = new Set(["fluid"]);

const REMOVAL_RE = /!([\w][\w-]*)\s*;/g;
const FLUID_KEYWORD_RE = /\b(no-parabolic|parabolic|no-shift|shift)\s*;?/g;
// Bare option flags inside a @color entry's `{ … }` block — `inline`,
// `parabolic`/`no-parabolic`. PostCSS cannot parse a lone keyword as a
// declaration, so each is rewritten to its `--ri-*` form (which parseColorBody
// also accepts). The lookbehind + `;`/`}` boundary restrict the match to a flag
// standing alone as its own statement, so a `dark: shift …` override value —
// whose `shift` is not a flag — is left intact.
const COLOR_FLAG_RE = /(?<=[{;\s]|^)(inline|no-parabolic|parabolic)\s*(?:;|(?=}))/g;

/** Apply `rewrite` to the depth-0 spans of a directive body, leaving nested
 *  blocks (e.g. @animate keyframes containing `!important`) untouched. */
function rewriteTopLevel(body: string, rewrite: (span: string) => string): string {
	if (!body.includes("{")) return rewrite(body);
	let out = "";
	let segStart = 0;
	let depth = 0;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (ch === "{") {
			if (depth === 0) {
				out += rewrite(body.slice(segStart, i));
				segStart = i;
			}
			depth++;
		} else if (ch === "}") {
			if (depth > 0) depth--;
			if (depth === 0) {
				out += body.slice(segStart, i + 1);
				segStart = i + 1;
			}
		}
	}
	out += depth === 0 ? rewrite(body.slice(segStart)) : body.slice(segStart);
	return out;
}

/** Map one matched @color flag keyword to its `--ri-*` declaration. */
function rewriteColorOptionFlag(_match: string, keyword: string): string {
	if (keyword === "inline") return "--ri-inline: true;";
	const negated = keyword.startsWith("no-");
	return `--ri-${negated ? keyword.slice(3) : keyword}: ${negated ? "false" : "true"};`;
}

/** Rewrite the bare option flags inside each @color entry's `{ … }` block to
 *  their `--ri-*` forms. The flags sit at depth 1 (the per-color options block),
 *  which rewriteTopLevel copies verbatim — so this targets those nested blocks
 *  directly. Depth-0 entries (e.g. an alias `muted: shift;`) are never visited,
 *  so a color value that happens to be a flag word is never mistaken for a flag. */
function rewriteColorOptionFlags(body: string): string {
	if (!body.includes("{")) return body;
	let out = "";
	let segStart = 0;
	let depth = 0;
	let blockStart = -1;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (ch === "{") {
			if (depth === 0) {
				out += body.slice(segStart, i + 1);
				blockStart = i + 1;
			}
			depth++;
		} else if (ch === "}") {
			if (depth > 0) depth--;
			if (depth === 0 && blockStart !== -1) {
				out += body.slice(blockStart, i).replace(COLOR_FLAG_RE, rewriteColorOptionFlag);
				out += "}";
				segStart = i + 1;
				blockStart = -1;
			}
		}
	}
	out += body.slice(segStart);
	return out;
}

/**
 * Rewrite PostCSS-unparseable RI syntax (`!name;` removals, bare @fluid curve
 * keywords, @color option flags) into the custom-property forms the directive
 * parsers recognize (`--ri-rm: name;`, `--ri-parabolic: true;`, `--ri-inline: true;`).
 *
 * Scoped to the bodies of the directives that define that syntax so user CSS
 * is never touched — a file-wide replace would destroy `color: red !important;`
 * and keyframe/animation names like `shift`.
 */
function rewriteDirectiveBodies(code: string): string {
	let out = "";
	let last = 0;
	let i = 0;
	while (i < code.length) {
		const at = code.indexOf("@", i);
		if (at === -1) break;
		if (!isAtRuleBoundary(code, at)) {
			i = at + 1;
			continue;
		}
		let nameEnd = at + 1;
		while (nameEnd < code.length && isAtRuleNameChar(code.charCodeAt(nameEnd))) nameEnd++;
		const name = code.slice(at + 1, nameEnd);
		const removals = REMOVAL_BODY_DIRECTIVES.has(name);
		const keywords = KEYWORD_BODY_DIRECTIVES.has(name);
		if (!removals && !keywords) {
			i = nameEnd;
			continue;
		}
		// Skip the (optional) modifier up to the body brace; semicolon-form
		// directives have no body to rewrite.
		let braceIdx = nameEnd;
		while (braceIdx < code.length) {
			const ch = code[braceIdx];
			if (ch === "{" || ch === ";" || ch === "}") break;
			braceIdx++;
		}
		if (code[braceIdx] !== "{") {
			i = braceIdx + 1;
			continue;
		}
		const close = findClosingBrace(code, braceIdx);
		const bodyStart = braceIdx + 1;
		const bodyEnd = close === -1 ? code.length : close;
		let rewritten = rewriteTopLevel(code.slice(bodyStart, bodyEnd), (span) => {
			let s = span;
			if (removals) s = s.replace(REMOVAL_RE, "--ri-rm: $1;");
			if (keywords) {
				s = s.replace(FLUID_KEYWORD_RE, (_, kw: string) => {
					const negated = kw.startsWith("no-");
					return `--ri-${negated ? kw.slice(3) : kw}: ${negated ? "false" : "true"};`;
				});
			}
			return s;
		});
		// @color option flags live inside the per-entry `{ … }` block (depth 1),
		// which rewriteTopLevel leaves untouched — rewrite them separately.
		if (name === "color") rewritten = rewriteColorOptionFlags(rewritten);
		out += code.slice(last, bodyStart) + rewritten;
		last = bodyEnd;
		i = bodyEnd;
	}
	if (last === 0) return code;
	return out + code.slice(last);
}
// Directories never worth recursing for an RI CSS entry; skipping node_modules
// is what keeps the cold-start disk fallback from walking the whole dep tree.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);
const POSTCSS_CONFIG_FILES = [
	"postcss.config.js",
	"postcss.config.mjs",
	"postcss.config.ts",
	"postcss.config.cjs",
] as const;

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
	let hotUpdateCount = 0;
	const PRUNE_INTERVAL = 50;

	return {
		name: "rainbowindex",
		enforce: "pre",

		async config(config: UserConfig) {
			root = config.root ?? process.cwd();
			if (!hasLocalPostCSSConfig(root)) {
				return {
					css: {
						postcss: {
							plugins: [rainbowindex()],
						},
					},
				};
			}

			return {};
		},

		configureServer(server: ViteDevServer) {
			root = server.config?.root ?? process.cwd();
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
					safe = expandApplyGroups(safe, expandWarnings);
					for (const w of expandWarnings) {
						(logger?.warn ?? console.warn)(`[rainbowindex] ${w}`);
					}
					return safe !== code ? safe : null;
				}
				riCSSFiles.delete(file);
			}
			return null;
		},

		async handleHotUpdate({ file, server, modules }: HmrContext) {
			if (++hotUpdateCount % PRUNE_INTERVAL === 0) {
				await pruneDeletedFiles();
			}

			if (CSS_FILE_RE.test(file)) {
				await checkCSSFileAsync(file);
				return;
			}

			if (!isSourceFile(file)) return;

			const extraModules: ModuleNode[] = [];
			for (const cssFile of riCSSFiles) {
				const mods = server.moduleGraph.getModulesByFile(cssFile);
				if (mods) {
					for (const mod of mods) {
						if (!modules.includes(mod)) {
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
		const tracked = new Set([...riCSSFiles, ...fileVersions.keys()]);
		const checks = [...tracked].map(async (file) => {
			try {
				await access(file);
			} catch {
				riCSSFiles.delete(file);
				fileVersions.delete(file);
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
