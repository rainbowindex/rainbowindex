import { EventEmitter } from "node:events";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CLIOptions } from "../../src/cli/args.js";

// chokidar is faked so the watcher is driven by hand: no real file events, no
// open handles, and the debounce is the only clock the test waits on. Its
// cleanup path is deliberately untested — it calls process.exit().

class FakeWatcher extends EventEmitter {
	added: string[] = [];
	removed: string[] = [];
	closed = false;
	add(path: string): void {
		this.added.push(path);
	}
	unwatch(path: string): void {
		this.removed.push(path);
	}
	async close(): Promise<void> {
		this.closed = true;
	}
}

const fake = vi.hoisted(() => ({
	watcher: null as { paths: unknown; options: unknown } | null,
	instance: null as unknown,
}));

vi.mock("chokidar", () => ({
	watch: (paths: unknown, options: unknown) => {
		fake.watcher = { paths, options };
		return fake.instance;
	},
}));

const { buildAndWrite, minifyIfRequested, watchMode } = await import("../../src/cli/watch.js");

let dir: string;
let logs: string[];
let errors: string[];
let watcher: FakeWatcher;
let signalListeners: { sigint: number; sigterm: number };

function write(rel: string, content: string): void {
	const full = join(dir, rel);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content);
}

function options(extra: Partial<CLIOptions> = {}): CLIOptions {
	return {
		command: "build",
		globs: ["src/**/*.tsx"],
		output: "dist/out.css",
		watch: true,
		minify: false,
		strict: false,
		subcommandExplicit: false,
		earlyExit: false,
		...extra,
	};
}

/** Drive one debounced rebuild: fire the event, wait for the log it produces. */
async function rebuild(event: string, file: string, expected: RegExp): Promise<void> {
	const before = [...logs, ...errors].filter((line) => expected.test(line)).length;
	watcher.emit(event, file);
	for (let i = 0; i < 200; i++) {
		if ([...logs, ...errors].filter((line) => expected.test(line)).length > before) return;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error(`no line matching ${expected} after ${event} (saw: ${[...logs, ...errors]})`);
}

beforeEach(() => {
	dir = mkdtempSync(join(realpathSync(tmpdir()), "ri-cli-watch-"));
	logs = [];
	errors = [];
	watcher = new FakeWatcher();
	fake.instance = watcher;
	fake.watcher = null;
	signalListeners = {
		sigint: process.listenerCount("SIGINT"),
		sigterm: process.listenerCount("SIGTERM"),
	};
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		logs.push(args.join(" "));
	});
	vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	});
});

afterEach(() => {
	// watchMode never returns its cleanup handler, so drop what it registered.
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		const keep = signal === "SIGINT" ? signalListeners.sigint : signalListeners.sigterm;
		const listeners = process.listeners(signal);
		for (const listener of listeners.slice(keep)) process.off(signal, listener);
	}
	vi.restoreAllMocks();
	rmSync(dir, { recursive: true, force: true });
});

describe("minifyIfRequested", () => {
	it("returns the CSS untouched when --minify is off", async () => {
		const css = ".a {\n\tcolor: red;\n}\n";
		expect(await minifyIfRequested(css, options())).toBe(css);
	});

	it("minifies when --minify is on", async () => {
		const out = await minifyIfRequested(".a {\n\tcolor: red;\n}\n", options({ minify: true }));
		expect(out).toBe(".a{color:red}");
	});
});

describe("buildAndWrite", () => {
	it("creates the output directory and writes the compiled CSS", async () => {
		write("src/App.tsx", '<div className="flex p-4" />');
		const result = await buildAndWrite(options(), dir, "dist/nested/out.css");
		expect(readFileSync(join(dir, "dist/nested/out.css"), "utf-8")).toContain(".flex");
		expect(result.cssFile).toBeNull();
	});
});

describe("watchMode", () => {
	it("requires an output path", async () => {
		await expect(watchMode(options({ output: undefined }), dir)).rejects.toThrow(
			"--output is required with --watch",
		);
	});

	it("builds once, then rebuilds on every watched event", async () => {
		write("src/App.tsx", '<div className="flex" />');
		write("src/index.css", '@source "./src/**/*.tsx";\n');

		await watchMode(options({ cssFile: "src/index.css" }), dir);

		expect(logs.join("\n")).toContain("Built: dist/out.css");
		expect(existsSync(join(dir, "dist/out.css"))).toBe(true);
		// @source patterns from the resolved theme join the watch list.
		expect(watcher.added).toContain("./src/**/*.tsx");
		expect(fake.watcher?.paths).toEqual(["src/**/*.tsx", join(dir, "src/index.css")]);

		write("src/App.tsx", '<div className="grid" />');
		await rebuild("change", "src/App.tsx", /Rebuilt/);
		expect(readFileSync(join(dir, "dist/out.css"), "utf-8")).toContain(".grid");

		await rebuild("add", "src/New.tsx", /Rebuilt/);
		await rebuild("unlink", "src/New.tsx", /Rebuilt/);
		watcher.emit("unlinkDir", "src");
		watcher.emit("error", new Error("watcher exploded"));
		expect(errors.join("\n")).toContain("watcher exploded");
	});

	it("drops a watched path the CSS no longer names", async () => {
		write("src/App.tsx", '<div className="flex" />');
		write("src/index.css", '@source "./src/**/*.tsx";\n');
		await watchMode(options({ cssFile: "src/index.css" }), dir);
		expect(watcher.added).toContain("./src/**/*.tsx");

		write("src/index.css", "/* no sources */\n");
		await rebuild("change", "src/index.css", /Rebuilt/);
		expect(watcher.removed).toContain("./src/**/*.tsx");
	});

	it("reports build errors, pauses after five, and resumes on the next save", async () => {
		write("src/App.tsx", '<div className="flex" />');
		write("src/index.css", "/* entry */\n");
		await watchMode(options({ cssFile: "src/index.css", globs: [] }), dir);
		// No globs: the watcher falls back to the default patterns.
		expect(fake.watcher?.paths).toContain(join(dir, "src/index.css"));

		rmSync(join(dir, "src/index.css"));
		for (let i = 0; i < 5; i++) {
			await rebuild("change", "src/App.tsx", /Build error/);
		}
		await rebuild("change", "src/App.tsx", /Paused rebuilds/);

		write("src/index.css", "/* back */\n");
		await rebuild("change", "src/App.tsx", /Rebuilt/);
	});
});
