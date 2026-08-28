import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The entry runs main() only when argv[1] realpaths to its own module URL, so
// every case here points argv[1] at the entry itself and re-imports it under a
// cleared module registry. The `src/cli/*` command modules are mocked: this
// file covers the entry's dispatch, not the commands (each has its own suite).

const spies = vi.hoisted(() => ({
	initViteProject: vi.fn(async () => {}),
	createViteProject: vi.fn(async () => {}),
	generateTypes: vi.fn(async () => {}),
	preloadFonts: vi.fn(async () => {}),
	scanFiles: vi.fn(async () => {}),
	buildCSS: vi.fn(async () => ({ css: ".built{}", warnings: [] as string[] })),
	buildAndWrite: vi.fn(async () => {}),
	minifyIfRequested: vi.fn(async (css: string) => css),
	watchMode: vi.fn(async () => {}),
}));

vi.mock("../../src/cli/vite-setup.js", () => ({
	initViteProject: spies.initViteProject,
	createViteProject: spies.createViteProject,
}));
vi.mock("../../src/cli/generate-types.js", () => ({ generateTypes: spies.generateTypes }));
vi.mock("../../src/cli/preload-fonts.js", () => ({ preloadFonts: spies.preloadFonts }));
vi.mock("../../src/cli/scan.js", () => ({ scanFiles: spies.scanFiles }));
vi.mock("../../src/cli/build.js", () => ({ buildCSS: spies.buildCSS }));
vi.mock("../../src/cli/watch.js", () => ({
	buildAndWrite: spies.buildAndWrite,
	minifyIfRequested: spies.minifyIfRequested,
	watchMode: spies.watchMode,
}));

const ENTRY = fileURLToPath(new URL("../../src/entries/cli.ts", import.meta.url));

let argv: string[];
let exitCode: number | string | undefined;
let logs: string[];
let errors: string[];
let stdout: string[];

/** Re-evaluate the entry with a chosen argv, then let main()'s promise settle. */
async function runCLI(args: string[], entryPath: string | null = ENTRY): Promise<void> {
	process.argv = entryPath === null ? [process.execPath] : [process.execPath, entryPath];
	process.argv.push(...args);
	vi.resetModules();
	await import("../../src/entries/cli.js");
	// main() is fired with `void`, so the import resolves before it finishes.
	for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
	argv = process.argv;
	exitCode = process.exitCode;
	logs = [];
	errors = [];
	stdout = [];
	vi.clearAllMocks();
	vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
		logs.push(a.join(" "));
	});
	vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
		errors.push(a.join(" "));
	});
	vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
		stdout.push(String(chunk));
		return true;
	});
});

afterEach(() => {
	process.argv = argv;
	process.exitCode = exitCode;
	vi.restoreAllMocks();
});

describe("CLI entry — direct execution guard", () => {
	it("does nothing when argv[1] is absent", async () => {
		await runCLI([], null);
		expect(logs).toEqual([]);
		expect(spies.buildCSS).not.toHaveBeenCalled();
	});

	it("does nothing when argv[1] does not exist on disk (realpath throws)", async () => {
		await runCLI([], "/definitely/not/a/real/path/cli.mjs");
		expect(logs).toEqual([]);
		expect(spies.buildCSS).not.toHaveBeenCalled();
	});
});

describe("CLI entry — early exits", () => {
	it("prints help when called with no arguments", async () => {
		await runCLI([]);
		expect(logs.join("\n")).toContain("rainbowindex");
		expect(spies.buildCSS).not.toHaveBeenCalled();
	});

	it("--help exits before dispatching a command", async () => {
		await runCLI(["--help"]);
		expect(logs.join("\n")).toContain("Usage");
		expect(spies.buildCSS).not.toHaveBeenCalled();
	});

	it("--version prints the build-injected version placeholder", async () => {
		await runCLI(["--version"]);
		// __RI_VERSION__ is injected by tsup; running from source it is undefined.
		expect(logs).toContain("unknown");
		expect(spies.buildCSS).not.toHaveBeenCalled();
	});
});

describe("CLI entry — command dispatch", () => {
	it("init", async () => {
		await runCLI(["init"]);
		expect(spies.initViteProject).toHaveBeenCalledTimes(1);
		expect(spies.initViteProject.mock.calls[0][1]).toBe(process.cwd());
	});

	it("create", async () => {
		await runCLI(["create", "my-app"]);
		expect(spies.createViteProject).toHaveBeenCalledTimes(1);
	});

	it("generate-types", async () => {
		await runCLI(["generate-types"]);
		expect(spies.generateTypes).toHaveBeenCalledTimes(1);
	});

	it("preload-fonts", async () => {
		await runCLI(["preload-fonts"]);
		expect(spies.preloadFonts).toHaveBeenCalledTimes(1);
	});

	it("scan", async () => {
		await runCLI(["scan", "src/**/*.tsx"]);
		expect(spies.scanFiles).toHaveBeenCalledTimes(1);
	});

	it("build without --output writes the CSS to stdout", async () => {
		await runCLI(["build"]);
		expect(spies.buildCSS).toHaveBeenCalledTimes(1);
		expect(spies.minifyIfRequested).toHaveBeenCalledTimes(1);
		expect(stdout.join("")).toBe(".built{}");
		expect(spies.buildAndWrite).not.toHaveBeenCalled();
	});

	it("build --output writes the file and logs the path", async () => {
		await runCLI(["build", "-o", "out.css"]);
		expect(spies.buildAndWrite).toHaveBeenCalledTimes(1);
		expect(spies.buildAndWrite.mock.calls[0][2]).toBe("out.css");
		expect(logs.join("\n")).toContain("Built: out.css");
		expect(spies.buildCSS).not.toHaveBeenCalled();
	});

	it("build --watch hands off to watchMode and skips the one-shot build", async () => {
		await runCLI(["build", "--watch", "-o", "out.css"]);
		expect(spies.watchMode).toHaveBeenCalledTimes(1);
		expect(spies.buildAndWrite).not.toHaveBeenCalled();
		expect(spies.buildCSS).not.toHaveBeenCalled();
	});
});

describe("CLI entry — failure handling", () => {
	it("prints the message and sets a non-zero exit code when a command throws", async () => {
		spies.scanFiles.mockRejectedValueOnce(new Error("scan blew up"));
		await runCLI(["scan", "src/**/*.tsx"]);
		expect(errors).toContain("scan blew up");
		expect(process.exitCode).toBe(1);
	});

	it("stringifies a non-Error rejection", async () => {
		spies.scanFiles.mockRejectedValueOnce("plain string failure");
		await runCLI(["scan", "src/**/*.tsx"]);
		expect(errors).toContain("plain string failure");
		expect(process.exitCode).toBe(1);
	});
});
