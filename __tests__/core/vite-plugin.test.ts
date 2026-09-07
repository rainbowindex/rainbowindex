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

/** One plugin's hooks, as the plain call signatures these tests use. */
type HookBag = {
	config: (config: { root?: string }) => Promise<Record<string, unknown>>;
	configureServer: (server: unknown) => void;
	resolveId: (id: string) => string | null;
	load: (id: string) => Promise<string | null>;
	transform: (code: string, id: string) => string | { code: string } | null;
	handleHotUpdate: (ctx: unknown) => Promise<unknown>;
};

const ACTIVE_CSS = `@import "rainbowindex";\n.a { color: red; }\n`;
const PLAIN_CSS = `.a { color: red; }\n`;
/** A stylesheet Oxfmt cannot parse — one of the four legacy forms. */
const LEGACY_CSS = `@import "rainbowindex";\n@color { brand: 0.18 330; !brand; }\n`;

/**
 * Drive the plugin pair as one hook bag.
 *
 * `rainbowindexVite()` returns two plugins — CSS at `pre`, snapshot injection
 * at `post` — because the two need opposite positions in Vite's pipeline. Every
 * hook but `transform` is defined on exactly one of them, so they merge
 * cleanly; `transform` runs both in order and threads the code between them,
 * which is what Vite does.
 */
function hooks(plugins: Plugin) {
	const bag = Object.fromEntries(
		plugins.flatMap((plugin) =>
			Object.entries(plugin)
				.filter(([key, value]) => key !== "transform" && typeof value === "function")
				.map(([key, value]) => [key, (value as (...a: unknown[]) => unknown).bind(plugin)]),
		),
	) as Partial<HookBag>;

	bag.transform = (code: string, id: string) => {
		let out: string | { code: string } | null = null;
		let current = code;
		for (const plugin of plugins) {
			const result = (plugin as unknown as Partial<HookBag>).transform?.(current, id) ?? null;
			if (result === null) continue;
			out = result;
			current = typeof result === "string" ? result : result.code;
		}
		return out;
	};

	return bag as HookBag;
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
	// Modules the plugin created by id (the snapshot virtual module), and the
	// ids it asked to invalidate — the theme-edit path is asserted on these.
	const modulesById = new Map<string, { id: string }>();
	const invalidated: string[] = [];
	return {
		info,
		warn,
		listen: async () => {
			await onListening?.();
		},
		modulesByFile,
		modulesById,
		invalidated,
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
				getModuleById: (id: string) => modulesById.get(id),
				invalidateModule: (mod: { id: string }) => invalidated.push(mod.id),
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

	it("hides a stylesheet Oxfmt cannot parse from the Vite+ formatter", async () => {
		await mkdir(join(dir, "src", "css"), { recursive: true });
		await writeFile(join(dir, "src", "css", "index.css"), LEGACY_CSS);
		await writeFile(join(dir, "src", "css", "plain.css"), PLAIN_CSS);
		const result = await hooks(rainbowindexVite()).config({ root: dir });
		expect(result.fmt).toEqual({ ignorePatterns: ["src/css/index.css"] });
	});

	it("leaves a canonical stylesheet in the formatter", async () => {
		// The point of the canonical forms. This file activates Rainbow Index and
		// uses none of the four deprecated forms, so there is nothing Oxfmt cannot
		// read — and a project's own stylesheets stop being the only unformatted
		// files in it.
		await writeFile(join(dir, "index.css"), ACTIVE_CSS);
		const result = await hooks(rainbowindexVite()).config({ root: dir });
		expect(result.fmt).toBeUndefined();
	});

	it("adds no formatter block when no stylesheet carries RI syntax", async () => {
		await writeFile(join(dir, "index.css"), PLAIN_CSS);
		const result = await hooks(rainbowindexVite()).config({ root: dir });
		expect(result.fmt).toBeUndefined();
	});

	it("hides a legacy stylesheet even when a local PostCSS config suppresses injection", async () => {
		await writeFile(join(dir, "postcss.config.js"), "export default {};");
		await writeFile(join(dir, "index.css"), LEGACY_CSS);
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

describe("vite plugin — the client theme snapshot", () => {
	const THEMED_CSS = `@import "rainbowindex";\n@text { lg: 1.125rem, 1.5; }\n@color { brand: 0.18 330; }\n`;
	const SNAPSHOT_ID = "virtual:rainbowindex/snapshot";
	const RESOLVED_ID = `\0${SNAPSHOT_ID}`;

	/** A plugin that has seen one themed CSS entry, as a dev server would. */
	async function themedPlugin(css: string = THEMED_CSS) {
		const entry = join(dir, "index.css");
		await writeFile(entry, css);
		const plugin = rainbowindexVite();
		const f = fakeServer(dir, [entry]);
		hooks(plugin).configureServer(f.server);
		await f.listen();
		hooks(plugin).transform(css, entry);
		return { plugin, f, entry };
	}

	it("resolves the virtual id to a NUL-prefixed module id", async () => {
		const { plugin } = await themedPlugin();
		expect(hooks(plugin).resolveId(SNAPSHOT_ID)).toBe(RESOLVED_ID);
		expect(hooks(plugin).resolveId("some-other-module")).toBeNull();
	});

	it("serves a module that publishes the entry's theme", async () => {
		const { plugin } = await themedPlugin();
		const code = (await hooks(plugin).load(RESOLVED_ID)) ?? "";
		expect(code).toContain('from "rainbowindex"');
		expect(code).toContain("publishSnapshot(hydrateSnapshot(");
		// The theme itself, not a placeholder: the project's own tokens.
		expect(code).toContain('"lg"');
		expect(code).toContain('"brand"');
		// Self-accepting, so a theme edit does not reload the whole page.
		expect(code).toContain("import.meta.hot.accept()");
	});

	it("publishes a theme that lives behind an @import", async () => {
		// Every other case here writes its theme inline in the entry, which is
		// why this went unseen: the plugin is `enforce: "pre"`, so it sees the
		// entry BEFORE Vite inlines its imports, and the snapshot was built from
		// that raw text. The documented start puts the whole theme behind
		// `@import "rainbowindex/tailwind.css"`, so `ri()` was handed an empty
		// snapshot and went back to guessing — the very bug C1 exists to fix.
		await writeFile(join(dir, "tokens.css"), `@text { imported: 2rem, 1.5; }\n`);
		const { plugin } = await themedPlugin(
			`@import "rainbowindex";\n@import "./tokens.css";\n@color { brand: 0.18 330; }\n`,
		);
		const code = (await hooks(plugin).load(RESOLVED_ID)) ?? "";
		expect(code).toContain('"imported"');
		expect(code).toContain('"brand"');
	});

	it("survives an import it cannot resolve rather than taking the server down", async () => {
		// A resolver fault in `load` would be a dev-server crash, so the snapshot
		// degrades to what it can see instead of throwing.
		const { plugin } = await themedPlugin(
			`@import "rainbowindex";\n@import "./nope.css";\n@color { brand: 0.18 330; }\n`,
		);
		const code = (await hooks(plugin).load(RESOLVED_ID)) ?? "";
		expect(code).toContain('"brand"');
	});

	it("serves nothing for any other id", async () => {
		const { plugin } = await themedPlugin();
		expect(await hooks(plugin).load("\0virtual:something-else")).toBeNull();
	});

	it("merges several CSS entries in path order, so the theme is deterministic", async () => {
		const plugin = rainbowindexVite();
		const f = fakeServer(dir);
		hooks(plugin).configureServer(f.server);
		await f.listen();
		// Fed out of path order on purpose.
		hooks(plugin).transform(
			`@import "rainbowindex";\n@color { zed: 0.1 20; }\n`,
			join(dir, "z.css"),
		);
		hooks(plugin).transform(
			`@import "rainbowindex";\n@color { alpha: 0.1 20; }\n`,
			join(dir, "a.css"),
		);
		const code = (await hooks(plugin).load(RESOLVED_ID)) ?? "";
		expect(code).toContain('"alpha"');
		expect(code).toContain('"zed"');
		expect(code.indexOf('"alpha"')).toBeLessThan(code.indexOf('"zed"'));
	});

	it("prepends the snapshot import to a module that imports the package", async () => {
		const { plugin } = await themedPlugin();
		const code = `import { ri } from "rainbowindex";\nexport const A = () => ri("text-lg");\n`;
		const result = hooks(plugin).transform(code, join(dir, "App.tsx"));
		expect(result).not.toBeNull();
		const out = typeof result === "string" ? result : (result?.code ?? "");
		// Before the module body: ES imports evaluate in order, so the theme is
		// published before any ri() call in this module can run.
		expect(out.startsWith(`import "${SNAPSHOT_ID}";`)).toBe(true);
		expect(out).toContain(code);
	});

	it("shifts no line, so a stack trace still points where the author looks", async () => {
		const { plugin } = await themedPlugin();
		const code = `import { ri } from "rainbowindex";\nconst a = 1;\nthrow new Error("x");\n`;
		const result = hooks(plugin).transform(code, join(dir, "App.tsx"));
		const out = typeof result === "string" ? result : (result?.code ?? "");
		const lineOf = (src: string, needle: string) =>
			src.split("\n").findIndex((l) => l.includes(needle));
		expect(lineOf(out, "throw new Error")).toBe(lineOf(code, "throw new Error"));
		expect(out.split("\n").length).toBe(code.split("\n").length);
	});

	it.each(["App.tsx", "App.jsx", "app.ts", "app.js", "app.mjs", "app.cts"])(
		"prepends it in %s",
		async (name) => {
			const { plugin } = await themedPlugin();
			const result = hooks(plugin).transform(
				`import { ri } from "rainbowindex";\n`,
				join(dir, name),
			);
			expect(result).not.toBeNull();
		},
	);

	// Injection runs at `enforce: "post"`, so what it sees for a component file
	// is the framework compiler's JavaScript output, never the SFC source. At
	// `pre` this prepended a line to markup: Svelte compiled it to a text node
	// and rendered `import "virtual:rainbowindex/snapshot";` onto the page while
	// publishing nothing. The extension is not the question — the code is.
	it.each(["App.vue", "App.svelte", "App.astro"])("prepends it in compiled %s", async (name) => {
		const { plugin } = await themedPlugin();
		const compiled = `import { ri } from "rainbowindex";\nexport default function render() { return ri("text-lg"); }\n`;
		const result = hooks(plugin).transform(compiled, join(dir, name));
		const out = typeof result === "string" ? result : (result?.code ?? "");
		expect(out.startsWith(`import "${SNAPSHOT_ID}";`)).toBe(true);
	});

	it("leaves untouched a component still in its source form", async () => {
		const { plugin } = await themedPlugin();
		// No compiler has run yet, so there is no import here to find — and a
		// prepended line would land in the template rather than the script.
		const source = `<script>\n  let n = 1;\n</script>\n<div class="p-4">{n}</div>\n`;
		expect(hooks(plugin).transform(source, join(dir, "App.svelte"))).toBeNull();
	});

	it("leaves modules that never import the package alone", async () => {
		const { plugin } = await themedPlugin();
		expect(hooks(plugin).transform(`export const A = 1;\n`, join(dir, "App.tsx"))).toBeNull();
		expect(
			hooks(plugin).transform(`import { x } from "other-pkg";\n`, join(dir, "App.tsx")),
		).toBeNull();
	});

	it("does not inject into the virtual module itself", async () => {
		const { plugin } = await themedPlugin();
		const code = (await hooks(plugin).load(RESOLVED_ID)) ?? "";
		expect(hooks(plugin).transform(code, RESOLVED_ID)).toBeNull();
	});

	// A module that already imports the snapshot gets a second import of the
	// same specifier, which ES module semantics evaluate once. Sniffing the
	// text to avoid it bought nothing and misfired on any module that merely
	// mentioned the id — in a comment, or in a string it generates.
	it("is harmless on a module that already imports the snapshot", async () => {
		const { plugin } = await themedPlugin();
		const once = `import "${SNAPSHOT_ID}";\nimport { ri } from "rainbowindex";\n`;
		const result = hooks(plugin).transform(once, join(dir, "App.tsx"));
		const out = typeof result === "string" ? result : (result?.code ?? "");
		expect(out.split(SNAPSHOT_ID).length - 1).toBe(2);
	});

	it("finds the theme on disk when loaded before any CSS is transformed", async () => {
		// In a build this module is the first import of the first entry, so
		// Rollup can load it before index.css has been through `transform`. That
		// silently shipped an empty theme, and the class merge was wrong in the
		// exact way the whole feature exists to prevent.
		await writeFile(join(dir, "index.css"), THEMED_CSS);
		const plugin = rainbowindexVite();
		await hooks(plugin).config({ root: dir });

		const code = (await hooks(plugin).load(RESOLVED_ID)) ?? "";
		expect(code).toContain('"lg"');
		expect(code).toContain('"brand"');
	});

	it("prefers what transform saw over what is on disk", async () => {
		// Vite inlines a CSS file's own @import at-rules before `transform`, so
		// the transformed text is the whole theme and the raw file is not.
		await writeFile(join(dir, "index.css"), THEMED_CSS);
		const plugin = rainbowindexVite();
		await hooks(plugin).config({ root: dir });
		hooks(plugin).transform(
			`@import "rainbowindex";\n@text { fromtransform: 1rem, 1.5; }\n`,
			join(dir, "index.css"),
		);

		const code = (await hooks(plugin).load(RESOLVED_ID)) ?? "";
		expect(code).toContain('"fromtransform"');
		expect(code).not.toContain('"lg"');
	});

	it("invalidates the published module when the theme changes", async () => {
		const { plugin, f, entry } = await themedPlugin();
		f.modulesById.set(RESOLVED_ID, { id: RESOLVED_ID });
		f.invalidated.length = 0;

		await writeFile(entry, `${THEMED_CSS}@text { xl: 1.25rem, 1.5; }\n`);
		await hooks(plugin).handleHotUpdate({ file: entry, server: f.server, modules: [] });

		expect(f.invalidated).toContain(RESOLVED_ID);
		// And the next load serves the new theme.
		expect((await hooks(plugin).load(RESOLVED_ID)) ?? "").toContain('"xl"');
	});

	it("does not invalidate when a CSS edit leaves the theme text unchanged", async () => {
		const { plugin, f, entry } = await themedPlugin();
		f.modulesById.set(RESOLVED_ID, { id: RESOLVED_ID });
		f.invalidated.length = 0;

		await hooks(plugin).handleHotUpdate({ file: entry, server: f.server, modules: [] });
		expect(f.invalidated).toEqual([]);
	});

	it("drops a CSS entry's theme when it stops activating Rainbow Index", async () => {
		const { plugin, f, entry } = await themedPlugin();
		f.modulesById.set(RESOLVED_ID, { id: RESOLVED_ID });
		f.invalidated.length = 0;

		await writeFile(entry, PLAIN_CSS);
		await hooks(plugin).handleHotUpdate({ file: entry, server: f.server, modules: [] });

		expect(f.invalidated).toContain(RESOLVED_ID);
		expect((await hooks(plugin).load(RESOLVED_ID)) ?? "").not.toContain('"lg"');
	});
});
