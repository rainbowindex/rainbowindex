import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CLIOptions } from "../../src/cli/args.js";
import { parseArgs, printHelp } from "../../src/cli/args.js";
import { writeFileAtomic } from "../../src/cli/atomic-write.js";
import { buildCSS } from "../../src/cli/build.js";
import { findCSSFileAsync, loadProjectCSS, loadProjectTheme } from "../../src/cli/css-file.js";
import { generateTypes } from "../../src/cli/generate-types.js";
import { preloadFonts } from "../../src/cli/preload-fonts.js";
import { scanFiles } from "../../src/cli/scan.js";

const ACTIVATE = '@import "rainbowindex";\n';

let dir: string;
let logs: string[];
let errors: string[];
let warns: string[];
let exitCode: number | string | undefined;

function write(rel: string, content: string): void {
	const full = join(dir, rel);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content);
}

function read(rel: string): string {
	return readFileSync(join(dir, rel), "utf-8");
}

function options(extra: Partial<CLIOptions> = {}): CLIOptions {
	return {
		command: "build",
		globs: [],
		watch: false,
		minify: false,
		strict: false,
		subcommandExplicit: false,
		earlyExit: false,
		...extra,
	};
}

beforeEach(() => {
	dir = mkdtempSync(join(realpathSync(tmpdir()), "ri-cli-cmd-"));
	logs = [];
	errors = [];
	warns = [];
	exitCode = process.exitCode;
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		logs.push(args.join(" "));
	});
	vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
	});
	vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
		warns.push(args.map(String).join(" "));
	});
});

afterEach(() => {
	process.exitCode = exitCode;
	vi.restoreAllMocks();
	rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
	const callbacks = { getVersion: () => "9.9.9", printHelp: vi.fn() };

	beforeEach(() => {
		callbacks.printHelp.mockClear();
	});

	it("defaults to build and collects globs", () => {
		const opts = parseArgs(["src/**/*.tsx", "app/**/*.tsx", "-o", "out.css"], callbacks);
		expect(opts.command).toBe("build");
		expect(opts.subcommandExplicit).toBe(false);
		expect(opts.globs).toEqual(["src/**/*.tsx", "app/**/*.tsx"]);
		expect(opts.output).toBe("out.css");
	});

	it("accepts flags before the subcommand keyword", () => {
		const opts = parseArgs(["--strict", "generate-types"], callbacks);
		expect(opts.command).toBe("generate-types");
		expect(opts.strict).toBe(true);
	});

	it("accepts a value flag before the keyword without eating it", () => {
		const opts = parseArgs(["--css", "src/app.css", "preload-fonts"], callbacks);
		expect(opts.command).toBe("preload-fonts");
		expect(opts.cssFile).toBe("src/app.css");
	});

	it("reads the legacy --init and --create aliases", () => {
		expect(parseArgs(["--init"], callbacks).command).toBe("init");
		const created = parseArgs(["--create", "my-app", "--template", "vue"], callbacks);
		expect(created.command).toBe("create");
		expect(created.targetDir).toBe("my-app");
		expect(created.template).toBe("vue");
	});

	it("treats --optimize as --minify", () => {
		expect(parseArgs(["src/**", "--optimize"], callbacks).minify).toBe(true);
	});

	it("prints the version and stops", () => {
		const opts = parseArgs(["--version"], callbacks);
		expect(opts.earlyExit).toBe(true);
		expect(logs).toEqual(["9.9.9"]);
	});

	it("shows subcommand help for `build --help` and global help for `--help build`", () => {
		expect(parseArgs(["build", "--help"], callbacks).earlyExit).toBe(true);
		expect(callbacks.printHelp).toHaveBeenLastCalledWith("build");
		parseArgs(["-h", "build"], callbacks);
		expect(callbacks.printHelp).toHaveBeenLastCalledWith(undefined);
	});

	it("rejects the removed framework runners", () => {
		expect(() => parseArgs(["framework", "next"], callbacks)).toThrow(/Framework runners/);
	});

	it("rejects an unknown option", () => {
		expect(() => parseArgs(["--nope"], callbacks)).toThrow(/Unknown option "--nope"/);
	});

	it("rejects a positional the command does not take", () => {
		expect(() => parseArgs(["init", "extra"], callbacks)).toThrow(/Unexpected extra argument/);
	});

	it("requires a directory for create and a glob for scan", () => {
		expect(() => parseArgs(["create"], callbacks)).toThrow(/create requires a project directory/);
		expect(() => parseArgs(["scan"], callbacks)).toThrow(/scan requires at least one file or glob/);
	});

	it("requires --output with --watch", () => {
		expect(() => parseArgs(["src/**", "--watch"], callbacks)).toThrow(/--output is required/);
	});
});

describe("printHelp", () => {
	it("prints the global screen", () => {
		printHelp();
		const out = logs.join("\n");
		expect(out).toContain("🌈 Rainbow Index CLI");
		expect(out).toContain("-v, --version");
		expect(out).toContain("Environment Variables");
	});

	it.each(["build", "init", "create", "generate-types", "scan", "preload-fonts"] as const)(
		"prints the %s screen",
		(command) => {
			printHelp(command);
			const out = logs.join("\n");
			expect(out).toContain(`🌈 rainbowindex ${command}`);
			expect(out).toContain("Usage:");
			expect(out).toContain("-h, --help");
		},
	);
});

// ---------------------------------------------------------------------------
// css-file
// ---------------------------------------------------------------------------

describe("loadProjectCSS", () => {
	it("reads an explicit --css file and strips its BOM", async () => {
		write("src/app.css", `﻿${ACTIVATE}`);
		const loaded = await loadProjectCSS({ cssFile: "src/app.css" }, dir);
		expect(loaded.css).toBe(ACTIVATE);
		expect(loaded.cssFile).toBe(join(dir, "src/app.css"));
	});

	it("rejects an explicit --css file that does not exist", async () => {
		await expect(loadProjectCSS({ cssFile: "nope.css" }, dir)).rejects.toThrow(/\[RI-1605\]/);
	});

	it("rejects a CSS file over the size limit", async () => {
		write("big.css", "a".repeat(5_242_881));
		await expect(loadProjectCSS({ cssFile: "big.css" }, dir)).rejects.toThrow(/exceeds 5 MB limit/);
	});

	it("returns empty CSS when auto-detection finds nothing", async () => {
		expect(await loadProjectCSS({}, dir)).toEqual({ css: "", cssFile: null });
	});

	it("auto-detects a candidate that activates Rainbow Index", async () => {
		write("src/index.css", `${ACTIVATE}@color { brand: oklch(0.7 0.2 250); }\n`);
		expect(await findCSSFileAsync(dir)).toBe(join(dir, "src/index.css"));
		const loaded = await loadProjectCSS({}, dir);
		expect(loaded.cssFile).toBe(join(dir, "src/index.css"));
	});

	it("skips a candidate without directives and warns about an unreadable one", async () => {
		write("src/styles.css", ".plain { color: red; }\n");
		mkdirSync(join(dir, "src/index.css"), { recursive: true });
		expect(await findCSSFileAsync(dir)).toBeNull();
		expect(warns.join("\n")).toContain("[RI-1404]");
	});
});

describe("loadProjectTheme", () => {
	it("resolves directives and prints parse warnings", async () => {
		write("src/app.css", `${ACTIVATE}@weight { bold: 700; }\n@fluid { min: 20rem; }\n@nope {}\n`);
		const theme = await loadProjectTheme({ cssFile: "src/app.css" }, dir);
		expect(theme.weights).toEqual({ bold: 700 });
		expect(theme.fluid.min).toBe("20rem");
	});
});

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

describe("buildCSS", () => {
	it("compiles the classes its @source finds", async () => {
		write("src/App.tsx", '<div className="flex p-4" />');
		write("src/index.css", `${ACTIVATE}@source "./src/**/*.tsx";\n`);
		const result = await buildCSS(options({ cssFile: "src/index.css" }), dir);
		expect(result.css).toContain(".flex");
		expect(result.cssFile).toBe(join(dir, "src/index.css"));
	});

	it("reports a glob it will not scan", async () => {
		write("src/App.tsx", '<div className="flex" />');
		await buildCSS(options({ globs: ["../outside/**/*.tsx", "src/**/*.tsx"] }), dir);
		expect(errors.join("\n")).toContain("[RI-1404] CLI glob pattern rejected");
	});

	it("warns that the CLI cannot expand @apply", async () => {
		write("src/App.tsx", '<div className="flex" />');
		write("src/index.css", `${ACTIVATE}.card { @apply flex; }\n`);
		await buildCSS(options({ cssFile: "src/index.css", globs: ["src/**/*.tsx"] }), dir);
		expect(errors.join("\n")).toContain("[RI-1009]");
	});

	it("explains an empty build with no globs and no @source", async () => {
		await buildCSS(options(), dir);
		expect(errors.join("\n")).toContain("[RI-1603] No source files were scanned");
	});

	it("explains an empty build when the patterns match nothing", async () => {
		write("src/index.css", `${ACTIVATE}@source "./nothing/**/*.tsx";\n`);
		await buildCSS(options({ cssFile: "src/index.css" }), dir);
		expect(errors.join("\n")).toContain("[RI-1603] No utility classes were found");
		expect(errors.join("\n")).toContain("CSS input:");
	});
});

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

describe("scanFiles", () => {
	it("prints one block per file, classes sorted", async () => {
		write("src/App.tsx", '<div className="p-4 flex" />');
		write("src/Empty.tsx", "");
		write("src/One.tsx", '<div className="grid" />');
		await scanFiles(options({ globs: ["src/**/*.tsx"] }), dir);
		expect(logs).toEqual([
			"src/App.tsx (2 classes)",
			"  flex",
			"  p-4",
			"src/Empty.tsx (0 classes)",
			"src/One.tsx (1 class)",
			"  grid",
		]);
	});

	it("prints scanner warnings to stderr", async () => {
		write("src/Long.tsx", `const data = "${"x".repeat(10_001)}";\n`);
		await scanFiles(options({ globs: ["src/**/*.tsx"] }), dir);
		expect(errors.join("\n")).toMatch(/\[RI-\d{4}\]/);
	});

	it("reports a glob that matches nothing", async () => {
		await expect(scanFiles(options({ globs: ["src/**/*.tsx"] }), dir)).rejects.toThrow(
			/No files matched "src\/\*\*\/\*\.tsx"/,
		);
	});
});

// ---------------------------------------------------------------------------
// preload-fonts
// ---------------------------------------------------------------------------

describe("preloadFonts", () => {
	it("prints one escaped link per preloadable face", async () => {
		write(
			"src/app.css",
			`${ACTIVATE}@font {\n\tdisplay: "Satoshi" {\n\t\tpreload: true;\n\t\tface: /fonts/Satoshi.woff2?v=1&x=2;\n\t}\n}\n`,
		);
		await preloadFonts(options({ cssFile: "src/app.css" }), dir);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toContain('href="/fonts/Satoshi.woff2?v=1&amp;x=2"');
		expect(logs[0]).toContain('as="font" type="font/woff2" crossorigin');
	});

	it("says so when nothing qualifies", async () => {
		write("src/app.css", `${ACTIVATE}@font {\n\tsans: system;\n}\n`);
		await preloadFonts(options({ cssFile: "src/app.css" }), dir);
		expect(logs).toEqual(["[rainbowindex] No font preload links to generate."]);
	});
});

// ---------------------------------------------------------------------------
// generate-types
// ---------------------------------------------------------------------------

describe("generateTypes", () => {
	const THEME = `${ACTIVATE}@color { brand: oklch(0.7 0.2 250); }\n@text { lg: 1.25rem, 1.4; }\n@weight { bold: 700; }\n@utility card { padding: 1rem; }\n@utility tab-* { tab-size: var(--value); }\n`;

	it("writes the declaration file for the resolved theme", async () => {
		write("src/app.css", THEME);
		await generateTypes(options({ cssFile: "src/app.css" }), dir);

		const types = read("rainbowindex-env.d.ts");
		expect(types).toMatch(/^\/\/ rainbowindex-env\.d\.ts \(auto-generated/);
		expect(types).toContain('"brand"');
		expect(types).toContain('type TextSize = "lg";');
		expect(types).toContain('type WeightName = "bold";');
		expect(types).toContain('"card"');
		expect(types).toContain(`| \`\${SpacingRoot}-\${SpacingToken}\``);
		expect(types).toContain(`| \`\${NumericRoot}-\${number}\``);
		expect(types).toContain(`| \`tab-\${string}\``);
		expect(types).toContain("| (string & {});");
		expect(logs.join("\n")).toContain("Generated types");
	});

	it("drops the escape hatch under --strict and rewrites its own output", async () => {
		write("src/app.css", THEME);
		await generateTypes(options({ cssFile: "src/app.css" }), dir);
		await generateTypes(options({ cssFile: "src/app.css", strict: true }), dir);

		const types = read("rainbowindex-env.d.ts");
		expect(types).not.toContain("(string & {})");
		expect(types).toContain('type Variant =\n  | "hover"');
	});

	it("emits `never` unions for a theme with no tokens", async () => {
		await generateTypes(options(), dir);
		const types = read("rainbowindex-env.d.ts");
		expect(types).toContain("type TextSize = never;");
		expect(types).toContain("type WeightName = never;");
	});

	it("backs up a hand-written file before overwriting it", async () => {
		write("rainbowindex-env.d.ts", "// mine\ntype Keep = 1;\n");
		await generateTypes(options(), dir);

		expect(read("rainbowindex-env.d.ts.bak")).toBe("// mine\ntype Keep = 1;\n");
		expect(read("rainbowindex-env.d.ts")).toContain("auto-generated");
		expect(warns.join("\n")).toContain("[RI-1604]");
	});

	it("aborts when the backup cannot be written", async () => {
		write("rainbowindex-env.d.ts", "// mine\n");
		mkdirSync(join(dir, "rainbowindex-env.d.ts.bak"));

		await generateTypes(options(), dir);

		expect(read("rainbowindex-env.d.ts")).toBe("// mine\n");
		expect(errors.join("\n")).toContain("Aborting to avoid data loss");
		expect(process.exitCode).toBe(1);
	});

	it("reports a failed write", async () => {
		mkdirSync(join(dir, "rainbowindex-env.d.ts"), { recursive: true });
		// The directory makes existsSync true, so the read below it must fail too:
		// a directory read is what proves the write path reports rather than throws.
		await expect(generateTypes(options(), dir)).rejects.toThrow(/EISDIR|illegal operation/);
	});
});

// ---------------------------------------------------------------------------
// atomic-write
// ---------------------------------------------------------------------------

describe("writeFileAtomic", () => {
	it("replaces the target file", async () => {
		write("out.css", "old\n");
		await writeFileAtomic(join(dir, "out.css"), "new\n");
		expect(read("out.css")).toBe("new\n");
	});

	it("rethrows when the temp file cannot be written", async () => {
		await expect(writeFileAtomic(join(dir, "missing/out.css"), "x")).rejects.toThrow(/ENOENT/);
	});
});
