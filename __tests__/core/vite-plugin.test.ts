import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rainbowindexVite from "../../src/integrations/vite.js";
import {
	invalidateSourceFileListCache,
	resolveSourceFilesAsync,
} from "../../src/scanner/sources.js";

// The plugin keeps all state in the closure returned by rainbowindexVite(), so
// every test builds a fresh instance and drives its hooks directly. Hook types
// on Vite's Plugin are ObjectHook unions; cast to the call signature we use.

type Plugin = ReturnType<typeof rainbowindexVite>;

const ACTIVE_CSS = `@import "rainbowindex";\n.a { color: red; }\n`;
const PLAIN_CSS = `.a { color: red; }\n`;

function hooks(plugin: Plugin) {
	return plugin as unknown as {
		config: (config: { root?: string }) => Promise<Record<string, unknown>>;
		configureServer: (server: unknown) => void;
		transform: (code: string, id: string) => string | null;
		handleHotUpdate: (ctx: unknown) => Promise<unknown>;
	};
}

/** Minimal ViteDevServer stand-in; `listening` fires the httpServer callback. */
function fakeServer(root: string, files: string[] = []) {
	const info = vi.fn();
	const warn = vi.fn();
	let onListening: (() => Promise<void>) | undefined;
	const fileToModulesMap = new Map<string, Set<unknown>>();
	for (const f of files) fileToModulesMap.set(f, new Set());
	const modulesByFile = new Map<string, Set<unknown>>();
	const watcherEvents = new Map<string, () => void>();
	return {
		info,
		warn,
		listen: async () => {
			await onListening?.();
		},
		modulesByFile,
		watcherEvents,
		server: {
			config: { root, logger: { info, warn } },
			watcher: {
				on: (event: string, cb: () => void) => {
					watcherEvents.set(event, cb);
				},
			},
			httpServer: {
				once: (event: string, cb: () => Promise<void>) => {
					if (event === "listening") onListening = cb;
				},
			},
			moduleGraph: {
				fileToModulesMap,
				getModulesByFile: (f: string) => modulesByFile.get(f),
			},
		},
	};
}

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "ri-vite-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
	// configureServer arms the module-level source-list cache; clear it so no
	// test inherits a list resolved against a previous tmpdir.
	invalidateSourceFileListCache();
	vi.restoreAllMocks();
});

describe("vite plugin — config hook", () => {
	it("injects the PostCSS plugin when the project has no postcss.config.*", async () => {
		const result = await hooks(rainbowindexVite()).config({ root: dir });
		const css = result.css as { postcss: { plugins: unknown[] } };
		expect(css.postcss.plugins).toHaveLength(1);
	});

	it("stays out of the way when a local postcss.config.* exists", async () => {
		await writeFile(join(dir, "postcss.config.js"), "export default {};");
		const result = await hooks(rainbowindexVite()).config({ root: dir });
		expect(result).toEqual({});
	});

	it("falls back to cwd when the resolved config carries no root", async () => {
		const result = await hooks(rainbowindexVite()).config({});
		// The repo root has no postcss.config.*, so injection still happens.
		expect(result.css).toBeDefined();
	});

	it("hides stylesheets that carry RI syntax from the Vite+ formatter", async () => {
		await mkdir(join(dir, "src", "css"), { recursive: true });
		await writeFile(join(dir, "src", "css", "index.css"), ACTIVE_CSS);
		await writeFile(join(dir, "src", "css", "plain.css"), PLAIN_CSS);
		const result = await hooks(rainbowindexVite()).config({ root: dir });
		expect(result.fmt).toEqual({ ignorePatterns: ["src/css/index.css"] });
	});

	it("adds no formatter block when no stylesheet carries RI syntax", async () => {
		await writeFile(join(dir, "index.css"), PLAIN_CSS);
		const result = await hooks(rainbowindexVite()).config({ root: dir });
		expect(result.fmt).toBeUndefined();
	});

	it("hides RI stylesheets even when a local PostCSS config suppresses injection", async () => {
		await writeFile(join(dir, "postcss.config.js"), "export default {};");
		await writeFile(join(dir, "index.css"), ACTIVE_CSS);
		const result = await hooks(rainbowindexVite()).config({ root: dir });
		expect(result.css).toBeUndefined();
		expect(result.fmt).toEqual({ ignorePatterns: ["index.css"] });
	});
});

describe("vite plugin — configureServer", () => {
	it("reports which CSS entries activate Rainbow Index", async () => {
		const entry = join(dir, "index.css");
		await writeFile(entry, ACTIVE_CSS);
		const f = fakeServer(dir, [entry, join(dir, "other.css")]);
		hooks(rainbowindexVite()).configureServer(f.server);
		await f.listen();

		expect(f.info).toHaveBeenCalledWith(
			expect.stringContaining("Injected PostCSS plugin"),
			expect.anything(),
		);
		expect(f.info).toHaveBeenCalledWith(
			expect.stringContaining("CSS entries: index.css"),
			expect.anything(),
		);
	});

	it("announces that a local PostCSS config suppressed auto-injection", async () => {
		await writeFile(join(dir, "postcss.config.mjs"), "export default {};");
		await writeFile(join(dir, "index.css"), ACTIVE_CSS);
		const f = fakeServer(dir, [join(dir, "index.css")]);
		hooks(rainbowindexVite()).configureServer(f.server);
		await f.listen();
		expect(f.info).toHaveBeenCalledWith(
			expect.stringContaining("Using local PostCSS config"),
			expect.anything(),
		);
	});

	it("warns RI-1602 when no CSS entry activates Rainbow Index", async () => {
		await writeFile(join(dir, "index.css"), PLAIN_CSS);
		const f = fakeServer(dir, [join(dir, "index.css")]);
		hooks(rainbowindexVite()).configureServer(f.server);
		await f.listen();
		expect(f.warn).toHaveBeenCalledWith(expect.stringContaining("[RI-1602]"), expect.anything());
	});

	it("falls back to a disk scan when the module graph holds no CSS yet", async () => {
		// Cold start: nothing transformed, so the graph is empty and the plugin
		// walks the project directory instead.
		await mkdir(join(dir, "src", "styles"), { recursive: true });
		await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
		await mkdir(join(dir, ".hidden"), { recursive: true });
		await writeFile(join(dir, "src", "styles", "app.module.css"), ACTIVE_CSS);
		await writeFile(join(dir, "node_modules", "pkg", "dep.css"), ACTIVE_CSS);
		await writeFile(join(dir, ".hidden", "skip.css"), ACTIVE_CSS);
		await writeFile(join(dir, "notes.txt"), "not css");

		const f = fakeServer(dir, []);
		hooks(rainbowindexVite()).configureServer(f.server);
		await f.listen();

		const entries = f.info.mock.calls
			.map((c) => String(c[0]))
			.find((m) => m.includes("CSS entries"));
		expect(entries).toContain("src/styles/app.module.css");
		expect(entries).not.toContain("node_modules");
		expect(entries).not.toContain(".hidden");
	});

	it("survives a missing project root without throwing", async () => {
		const f = fakeServer(join(dir, "gone"), []);
		hooks(rainbowindexVite()).configureServer(f.server);
		await expect(f.listen()).resolves.toBeUndefined();
		expect(f.warn).toHaveBeenCalledWith(expect.stringContaining("[RI-1602]"), expect.anything());
	});

	it("warns RI-1601 when a directory cannot be read for a non-ignorable reason", async () => {
		// A self-referential symlink makes readdir fail with ELOOP — not one of the
		// codes the walk treats as "just skip it", so the user gets a diagnostic.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const loop = join(dir, "loop");
		await symlink(loop, loop);
		const f = fakeServer(loop, []);
		hooks(rainbowindexVite()).configureServer(f.server);
		await f.listen();
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[RI-1601]"));
	});
});

describe("vite plugin — transform", () => {
	it("forgets a CSS file that dropped its rainbowindex import", () => {
		const plugin = rainbowindexVite();
		const t = hooks(plugin).transform;
		const id = "/app/src/index.css";
		expect(t(`@color { brand: 0.18 330 { inline; }; }`, id)).toContain("--ri-inline");
		// Re-transform without activation: the file leaves the tracked set, so a
		// later source edit no longer forces it to reload.
		expect(t(PLAIN_CSS, id)).toBeNull();
	});

	it("ignores the query string when keying a CSS module id", () => {
		const out = hooks(rainbowindexVite()).transform(
			`@color { brand: 0.18 330 { inline; }; }`,
			"/app/src/index.css?direct",
		);
		expect(out).toContain("--ri-inline");
	});

	it("ignores non-CSS ids", () => {
		expect(hooks(rainbowindexVite()).transform(ACTIVE_CSS, "/app/src/main.ts")).toBeNull();
	});

	it("surfaces variant-group expansion warnings through the Vite logger", async () => {
		const plugin = rainbowindexVite();
		const f = fakeServer(dir, []);
		hooks(plugin).configureServer(f.server);
		// 11 nested groups exceeds MAX_VARIANT_GROUP_DEPTH (10).
		const deep = `hover:{${"focus:{".repeat(11)}px-2${"}".repeat(11)}}`;
		hooks(plugin).transform(`@import "rainbowindex";\n.x { @apply ${deep}; }\n`, "/a/x.css");
		expect(f.warn).toHaveBeenCalledWith(
			expect.stringContaining("[RI-1409] /a/x.css:"),
			expect.anything(),
		);
	});

	// This pass runs before the compile, so it has no analysis to read the
	// entry's suppressions from — it must read them out of the text in hand.
	it("honours a `ri-disable` comment in the entry it is transforming", () => {
		const plugin = rainbowindexVite();
		const f = fakeServer(dir, []);
		hooks(plugin).configureServer(f.server);
		const deep = `hover:{${"focus:{".repeat(11)}px-2${"}".repeat(11)}}`;
		hooks(plugin).transform(
			`@import "rainbowindex";\n/* ri-disable RI-1409 */\n.x { @apply ${deep}; }\n`,
			"/a/x.css",
		);
		expect(f.warn).not.toHaveBeenCalledWith(
			expect.stringContaining("[RI-1409]"),
			expect.anything(),
		);
	});

	it("falls back to console.warn for expansion warnings before a server exists", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const deep = `hover:{${"focus:{".repeat(11)}px-2${"}".repeat(11)}}`;
		hooks(rainbowindexVite()).transform(
			`@import "rainbowindex";\n.x { @apply ${deep}; }\n`,
			"/a/x.css",
		);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[RI-1409]"));
	});
});

describe("vite plugin — handleHotUpdate", () => {
	it("re-checks a changed CSS file instead of touching the module graph", async () => {
		const entry = join(dir, "index.css");
		await writeFile(entry, ACTIVE_CSS);
		const plugin = rainbowindexVite();
		const f = fakeServer(dir, []);
		hooks(plugin).configureServer(f.server);
		const result = await hooks(plugin).handleHotUpdate({
			file: entry,
			server: f.server,
			modules: [],
		});
		expect(result).toBeUndefined();
	});

	it("ignores files the scanner does not treat as sources", async () => {
		const plugin = rainbowindexVite();
		const f = fakeServer(dir, []);
		const result = await hooks(plugin).handleHotUpdate({
			file: join(dir, "README.md"),
			server: f.server,
			modules: [],
		});
		expect(result).toBeUndefined();
	});

	it("adds the tracked CSS modules when a source file changes", async () => {
		const entry = join(dir, "index.css");
		await writeFile(entry, ACTIVE_CSS);
		const plugin = rainbowindexVite();
		const f = fakeServer(dir, [entry]);
		hooks(plugin).configureServer(f.server);
		await f.listen();

		const cssModule = { id: entry };
		f.modulesByFile.set(entry, new Set([cssModule]));
		const changed = { id: "/app/src/App.tsx" };
		const result = (await hooks(plugin).handleHotUpdate({
			file: join(dir, "App.tsx"),
			server: f.server,
			modules: [changed],
		})) as unknown[];
		expect(result).toEqual([changed, cssModule]);
	});

	it("does not duplicate a CSS module Vite already listed", async () => {
		const entry = join(dir, "index.css");
		await writeFile(entry, ACTIVE_CSS);
		const plugin = rainbowindexVite();
		const f = fakeServer(dir, [entry]);
		hooks(plugin).configureServer(f.server);
		await f.listen();

		const cssModule = { id: entry };
		f.modulesByFile.set(entry, new Set([cssModule]));
		const result = await hooks(plugin).handleHotUpdate({
			file: join(dir, "App.tsx"),
			server: f.server,
			modules: [cssModule],
		});
		expect(result).toBeUndefined();
	});

	it("prunes deleted files from its tracking sets every 50th update", async () => {
		const entry = join(dir, "index.css");
		await writeFile(entry, ACTIVE_CSS);
		const plugin = rainbowindexVite();
		const f = fakeServer(dir, [entry]);
		hooks(plugin).configureServer(f.server);
		await f.listen();

		const cssModule = { id: entry };
		f.modulesByFile.set(entry, new Set([cssModule]));
		// Still tracked before the file goes away.
		expect(
			await hooks(plugin).handleHotUpdate({
				file: join(dir, "App.tsx"),
				server: f.server,
				modules: [],
			}),
		).toEqual([cssModule]);

		await rm(entry);
		// The prune runs on the 50th call; 1 was already spent above.
		for (let i = 0; i < 49; i++) {
			await hooks(plugin).handleHotUpdate({
				file: join(dir, "App.tsx"),
				server: f.server,
				modules: [],
			});
		}
		expect(
			await hooks(plugin).handleHotUpdate({
				file: join(dir, "App.tsx"),
				server: f.server,
				modules: [],
			}),
		).toBeUndefined();
	});

	it("drops a CSS entry that was deleted between transform and re-check", async () => {
		const entry = join(dir, "index.css");
		await writeFile(entry, ACTIVE_CSS);
		const plugin = rainbowindexVite();
		const f = fakeServer(dir, [entry]);
		hooks(plugin).configureServer(f.server);
		await f.listen();

		await rm(entry);
		await hooks(plugin).handleHotUpdate({ file: entry, server: f.server, modules: [] });

		f.modulesByFile.set(entry, new Set([{ id: entry }]));
		const result = await hooks(plugin).handleHotUpdate({
			file: join(dir, "App.tsx"),
			server: f.server,
			modules: [],
		});
		expect(result).toBeUndefined();
	});
});

describe("vite plugin — candidate-signature HMR gate", () => {
	async function trackedPlugin() {
		const entry = join(dir, "index.css");
		await writeFile(entry, ACTIVE_CSS);
		const plugin = rainbowindexVite();
		const f = fakeServer(dir, [entry]);
		hooks(plugin).configureServer(f.server);
		await f.listen();
		const cssModule = { id: entry };
		f.modulesByFile.set(entry, new Set([cssModule]));
		const update = (content: string) =>
			hooks(plugin).handleHotUpdate({
				file: join(dir, "App.tsx"),
				server: f.server,
				modules: [],
				read: async () => content,
			});
		return { cssModule, update, plugin, f };
	}

	it("skips the RI CSS reload when an edit changes no candidates", async () => {
		const { cssModule, update } = await trackedPlugin();
		// First sight seeds the signature and invalidates conservatively.
		expect(await update(`const n = 1;\n<div className="p-4" />`)).toEqual([cssModule]);
		// Reformat-only edit: same candidate set, no CSS re-transform.
		expect(await update(`<div  className="p-4" />\nconst n = 1;\n`)).toBeUndefined();
	});

	it("reloads the RI CSS when an edit adds a candidate", async () => {
		const { cssModule, update } = await trackedPlugin();
		expect(await update(`<div className="p-4" />`)).toEqual([cssModule]);
		expect(await update(`<div className="p-4 mt-2" />`)).toEqual([cssModule]);
	});

	it("invalidates conservatively when the file cannot be read", async () => {
		const { cssModule, update, plugin, f } = await trackedPlugin();
		expect(await update(`<div className="p-4" />`)).toEqual([cssModule]);
		const result = await hooks(plugin).handleHotUpdate({
			file: join(dir, "App.tsx"),
			server: f.server,
			modules: [],
			read: async () => {
				throw new Error("gone");
			},
		});
		expect(result).toEqual([cssModule]);
	});
});

describe("vite plugin — source-file-list cache", () => {
	it("reuses the resolved list while armed and refreshes on a watcher add", async () => {
		await mkdir(join(dir, "src"), { recursive: true });
		const first = join(dir, "src", "App.tsx");
		await writeFile(first, "export {};");
		const f = fakeServer(dir, []);
		hooks(rainbowindexVite()).configureServer(f.server);
		invalidateSourceFileListCache();

		expect((await resolveSourceFilesAsync([], dir)).files).toEqual([first]);

		const added = join(dir, "src", "New.tsx");
		await writeFile(added, "export {};");
		// Still the cached list: the new file stays invisible until the watcher
		// invalidates — proof the glob did not rerun.
		expect((await resolveSourceFilesAsync([], dir)).files).toEqual([first]);

		f.watcherEvents.get("add")?.();
		expect((await resolveSourceFilesAsync([], dir)).files).toEqual([first, added]);
	});

	it("refreshes the armed list on a watcher unlink", async () => {
		await mkdir(join(dir, "src"), { recursive: true });
		const keep = join(dir, "src", "App.tsx");
		const gone = join(dir, "src", "Old.tsx");
		await writeFile(keep, "export {};");
		await writeFile(gone, "export {};");
		const f = fakeServer(dir, []);
		hooks(rainbowindexVite()).configureServer(f.server);
		invalidateSourceFileListCache();

		expect((await resolveSourceFilesAsync([], dir)).files).toEqual([keep, gone]);

		await rm(gone);
		expect((await resolveSourceFilesAsync([], dir)).files).toEqual([keep, gone]);

		f.watcherEvents.get("unlink")?.();
		expect((await resolveSourceFilesAsync([], dir)).files).toEqual([keep]);
	});

	it("does not cache a glob that was in flight when an invalidation arrived", async () => {
		await mkdir(join(dir, "src"), { recursive: true });
		const first = join(dir, "src", "App.tsx");
		await writeFile(first, "export {};");
		const f = fakeServer(dir, []);
		hooks(rainbowindexVite()).configureServer(f.server);
		invalidateSourceFileListCache();

		// The glob promises are created synchronously, so the watcher event below
		// lands while the glob is still in flight — its pre-event snapshot must
		// not be cached.
		const inFlight = resolveSourceFilesAsync([], dir);
		f.watcherEvents.get("add")?.();
		expect((await inFlight).files).toEqual([first]);

		const added = join(dir, "src", "New.tsx");
		await writeFile(added, "export {};");
		// A stale cached in-flight result would hide the new file here.
		expect((await resolveSourceFilesAsync([], dir)).files).toEqual([first, added]);
	});
});
