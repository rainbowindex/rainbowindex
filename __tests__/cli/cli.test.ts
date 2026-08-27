import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `ri-cli-test-${Date.now()}`);
const distCLIPath = join(process.cwd(), "dist/cli.mjs");

beforeAll(() => {
	mkdirSync(join(testDir, "src"), { recursive: true });
	mkdirSync(join(testDir, "dist"), { recursive: true });
	writeFileSync(
		join(testDir, "src/App.tsx"),
		`<div className="flex items-center p-4 bg-theme-500 text-white">
      <h1 className="text-xl font-bold">Hello</h1>
    </div>`,
	);
	writeFileSync(
		join(testDir, "src/styles.css"),
		`@source "./src/**/*.tsx";
`,
	);
});

afterAll(() => {
	try {
		rmSync(testDir, { recursive: true, force: true });
	} catch {}
});

function runCLI(...args: string[]): string {
	return execFileSync(process.execPath, [distCLIPath, ...args], {
		cwd: testDir,
		encoding: "utf-8",
		timeout: 30000,
	});
}

function runCLIIn(cwd: string, ...args: string[]): string {
	return execFileSync(process.execPath, [distCLIPath, ...args], {
		cwd,
		encoding: "utf-8",
		timeout: 30000,
	});
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Packaged-runtime regression
// ---------------------------------------------------------------------------

describe("CLI packaged-runtime", () => {
	/** Run the dist artifact via `node` to validate packaged runtime. */
	function runDistCLI(...args: string[]): string {
		return execFileSync(process.execPath, [distCLIPath, ...args], {
			cwd: testDir,
			encoding: "utf-8",
			timeout: 15000,
		});
	}

	test("runs the built artifact without crashing (no top-level node:module import failure)", () => {
		// Regression: engine.ts previously imported createRequire at top level,
		// which could crash in runtimes without node:module support. The CLI
		// must still work after this was changed to lazy/dynamic detection.
		//
		// This test runs the built dist artifact via `node` (not vite-node on
		// source) to validate the actual packaged runtime behavior, including
		// tsup-injected constants and bundled module resolution.
		const output = runDistCLI("--version");
		// __RI_VERSION__ is injected at build time — the built artifact should
		// report a real semver version, not "unknown".
		expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("--help works in packaged runtime", () => {
		// Regression: ensure bundled artifact loads all modules without
		// missing export or circular dependency errors on startup.
		const output = runDistCLI("--help");
		expect(output).toContain("Usage:");
		expect(output).toContain("--output");
	});

	test("build produces CSS from the packaged artifact", () => {
		// Regression: validates that runtime policy helpers and bundled module
		// resolution all work end-to-end in the dist build.
		const output = runDistCLI("src/**/*.tsx", "--css", "src/styles.css");
		expect(output).toContain(".flex");
		expect(output).toContain(":root");
	});

	test("build writes to output file from packaged artifact", () => {
		const outputFile = join(testDir, "dist/packaged-output.css");
		runDistCLI("src/**/*.tsx", "--css", "src/styles.css", "-o", "dist/packaged-output.css");
		expect(existsSync(outputFile)).toBe(true);
		const css = readFileSync(outputFile, "utf-8");
		expect(css).toContain(".flex");
		expect(css).toContain(".p-4");
	});

	test("generate-types works in packaged runtime", () => {
		// Regression: type generation exercises directive parsing, theme
		// resolution, and file I/O — all of which touch bundled modules.
		const typesPath = join(testDir, "rainbowindex-env.d.ts");
		try {
			rmSync(typesPath);
		} catch {}
		runDistCLI("generate-types", "--css", "src/styles.css");
		expect(existsSync(typesPath)).toBe(true);
		const content = readFileSync(typesPath, "utf-8");
		expect(content).toContain("type RainbowClass");
	});

	test("preload-fonts works in packaged runtime", () => {
		// Regression: preload-fonts exercises the font system module path
		// (fonts.ts → directives.ts) which historically broke when bundled
		// module resolution changed import ordering.
		const output = runDistCLI("preload-fonts", "--css", "src/styles.css");
		expect(output).toContain("No font preload links");
	});

	test("CSS function processing works in packaged runtime", () => {
		// Regression: CSS functions (--theme, --spacing, --alpha) exercise
		// the css-functions.ts → suggest.ts → theme.ts module chain which
		// previously broke due to bundled circular dependency resolution.
		writeFileSync(
			join(testDir, "src/cssfn.css"),
			`@source "./src/**/*.tsx";
.test { padding: --spacing(4); }
`,
		);
		const output = runDistCLI("src/**/*.tsx", "--css", "src/cssfn.css");
		expect(output).toContain("calc(4 * var(--spacing))");
	});

	test("CSS function processing via postcss succeeds in packaged runtime", () => {
		// Validates the packaged artifact can still parse declarations with
		// PostCSS and compile --spacing() end-to-end.
		writeFileSync(
			join(testDir, "src/postcss-check.css"),
			`@source "./src/**/*.tsx";\n.check { padding: --spacing(2); }\n`,
		);
		const output = runDistCLI("src/**/*.tsx", "--css", "src/postcss-check.css");
		expect(output).toContain("calc(2 * var(--spacing))");
		expect(output).not.toContain("ERR_MODULE_NOT_FOUND");
		expect(output).not.toContain("at Module");
	});

	test("output directory creation works for nested paths (shared with --watch initial build)", () => {
		// Validates that the packaged artifact creates missing output directories
		// via mkdir({ recursive: true }). This code path is shared between the
		// non-watch `-o` path (main() early directory creation) and the --watch
		// initial build (watchMode() first write). The --watch startup itself
		// cannot be tested here since it blocks indefinitely waiting for file
		// changes — the shared mkdir logic is the critical regression target.
		const nestedOutput = "dist/packaged-nested/deep/output.css";
		const nestedDir = join(testDir, "dist/packaged-nested");
		try {
			rmSync(nestedDir, { recursive: true, force: true });
		} catch {}
		expect(existsSync(nestedDir)).toBe(false);

		runDistCLI("src/**/*.tsx", "--css", "src/styles.css", "-o", nestedOutput);

		const outputPath = join(testDir, nestedOutput);
		expect(existsSync(outputPath)).toBe(true);
		const css = readFileSync(outputPath, "utf-8");
		expect(css).toContain(".flex");
	});
});

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

describe("CLI help", () => {
	test("shows help with --help", () => {
		const output = runCLI("--help");
		expect(output).toContain("rainbowindex");
		expect(output).toContain("Usage:");
		expect(output).toContain("--output");
		expect(output).toContain("rainbowindex init");
		expect(output).toContain("rainbowindex create <dir>");
	});

	test("shows help with no args", () => {
		const output = runCLI();
		expect(output).toContain("Usage:");
	});
});

// ---------------------------------------------------------------------------
// Build command
// ---------------------------------------------------------------------------

describe("CLI build", () => {
	test("outputs CSS to stdout", () => {
		const output = runCLI("src/**/*.tsx", "--css", "src/styles.css");
		expect(output).toContain(".flex");
		expect(output).toContain(".p-4");
		expect(output).toContain(".text-white");
		expect(output).toContain(":root");
	});

	test("writes CSS to output file", () => {
		const outputFile = join(testDir, "dist/output.css");
		runCLI("src/**/*.tsx", "--css", "src/styles.css", "-o", "dist/output.css");

		expect(existsSync(outputFile)).toBe(true);
		const css = readFileSync(outputFile, "utf-8");
		expect(css).toContain(".flex");
		expect(css).toContain(".p-4");
	});

	test("auto-detects CSS file", () => {
		const output = runCLI("src/**/*.tsx");
		expect(output).toContain(".flex");
	});

	test("auto-detects src/style.css in Vite projects", () => {
		const dir = join(tmpdir(), `ri-cli-style-${Date.now()}`);
		try {
			mkdirSync(join(dir, "src"), { recursive: true });
			writeFileSync(join(dir, "src/App.tsx"), `<div className="bg-brand-500"></div>`);
			writeFileSync(
				join(dir, "src/style.css"),
				`@source "./src/**/*.tsx";
@color { brand: 0.18 220; }
`,
			);
			const output = runCLIIn(dir, "src/**/*.tsx");
			expect(output).toContain("--color-brand-500");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("minify removes comments", () => {
		const output = runCLI("src/**/*.tsx", "--css", "src/styles.css", "--minify");
		expect(output).not.toContain("/* preflight:");
	});

	test("--optimize is accepted as a --minify alias", () => {
		const output = runCLI("src/**/*.tsx", "--css", "src/styles.css", "--optimize");
		expect(output).not.toContain("/* preflight:");
	});

	test("minify preserves required math whitespace in nested functions", () => {
		writeFileSync(join(testDir, "src/math.css"), `.calc { width: calc(var(--foo) - 1rem); }`);
		const output = runCLI("src/**/*.tsx", "--css", "src/math.css", "--minify");
		expect(output).toContain("calc(var(--foo) - 1rem)");
		expect(output).not.toContain("calc(var(--foo)-1rem)");
	});

	test("respects directives from CSS file", () => {
		const output = runCLI("src/**/*.tsx", "--css", "src/styles.css");
		expect(output).toContain("--color-theme-");
	});

	test("fails fast on oversized CSS input", () => {
		writeFileSync(
			join(testDir, "src/oversized-build.css"),
			`@source "./src/**/*.tsx";\n${"a".repeat(5_242_881)}`,
		);
		expect(() => runCLI("src/**/*.tsx", "--css", "src/oversized-build.css")).toThrow(
			/exceeds 5 MB limit/,
		);
	});

	test("end-to-end pipeline: preflight + colors + spacing + typography", () => {
		// Realistic multi-directive CSS file exercising the full compilation pipeline
		writeFileSync(
			join(testDir, "src/e2e-full.tsx"),
			`<div className="flex items-center p-4 bg-primary-500 text-white text-lg rounded-md shadow-sm gap-2 hover:bg-primary-600">
				<span className="font-bold tracking-tight">E2E</span>
			</div>`,
		);
		writeFileSync(
			join(testDir, "src/e2e-full.css"),
			`@source "./src/e2e-full.tsx";
@color { primary: 0.18 220; }
@text { base: 1rem/1.5; lg: 1.125rem/1.75; }
@spacing { base: 0.25rem; }
@rounded { md: 0.375rem; }
@shadow { sm: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
`,
		);
		const output = runCLI("src/e2e-full.tsx", "--css", "src/e2e-full.css");
		// Preflight should be present
		expect(output).toContain("box-sizing: border-box");
		// Color variables
		expect(output).toContain("--color-primary-500");
		// Utility classes
		expect(output).toContain(".flex");
		expect(output).toContain(".p-4");
		expect(output).toContain(".text-lg");
		expect(output).toContain(".rounded-md");
		expect(output).toContain(".shadow-sm");
		expect(output).toContain(".gap-2");
		// Hover variant
		expect(output).toContain("hover");
		expect(output).toContain("--color-primary-600");
		// Spacing variable
		expect(output).toContain("--spacing");
	});
});

// ---------------------------------------------------------------------------
// Generate types command
// ---------------------------------------------------------------------------

describe("CLI generate-types", () => {
	test("generates type definitions file", () => {
		const typesPath = join(testDir, "rainbowindex-env.d.ts");
		try {
			rmSync(typesPath);
		} catch {}

		runCLI("generate-types", "--css", "src/styles.css");

		expect(existsSync(typesPath)).toBe(true);
		const content = readFileSync(typesPath, "utf-8");
		expect(content).toContain("type ColorName");
		expect(content).toContain("type TextSize");
		expect(content).toContain("type RainbowClass");
		expect(content).toContain("export function ri");
	});

	test("strict mode removes string escape hatch", () => {
		runCLI("generate-types", "--strict", "--css", "src/styles.css");
		const content = readFileSync(join(testDir, "rainbowindex-env.d.ts"), "utf-8");
		expect(content).not.toContain("string & {}");
	});

	test("non-strict mode includes string escape hatch", () => {
		runCLI("generate-types", "--css", "src/styles.css");
		const content = readFileSync(join(testDir, "rainbowindex-env.d.ts"), "utf-8");
		expect(content).toContain("string & {}");
	});

	test("rejects oversized CSS input", () => {
		writeFileSync(
			join(testDir, "src/oversized-types.css"),
			`@source "./src/**/*.tsx";\n${"b".repeat(5_242_881)}`,
		);
		expect(() => runCLI("generate-types", "--css", "src/oversized-types.css")).toThrow(
			/exceeds 5 MB limit/,
		);
	});
});

// ---------------------------------------------------------------------------
// Preload fonts command
// ---------------------------------------------------------------------------

describe("CLI preload-fonts", () => {
	test("outputs no links when no fonts configured", () => {
		const output = runCLI("preload-fonts", "--css", "src/styles.css");
		expect(output).toContain("No font preload links");
	});

	test("no preload links for CDN fonts (google)", () => {
		writeFileSync(join(testDir, "src/fonts.css"), `@font { sans: "Inter" from google; }\n`);
		const output = runCLI("preload-fonts", "--css", "src/fonts.css");
		expect(output).toContain("No font preload links");
	});
});

// ---------------------------------------------------------------------------
// Output directory creation
// ---------------------------------------------------------------------------

describe("CLI output directory", () => {
	test("creates output directory when it does not exist", () => {
		const nestedDir = join(testDir, "deep/nested/dir");
		const outputFile = "deep/nested/dir/output.css";
		// Ensure directory doesn't exist
		try {
			rmSync(join(testDir, "deep"), { recursive: true, force: true });
		} catch {}
		expect(existsSync(nestedDir)).toBe(false);

		runCLI("src/**/*.tsx", "--css", "src/styles.css", "-o", outputFile);

		expect(existsSync(join(testDir, outputFile))).toBe(true);
		const css = readFileSync(join(testDir, outputFile), "utf-8");
		expect(css).toContain(".flex");
	});
});

// ---------------------------------------------------------------------------
// Glob pattern validation
// ---------------------------------------------------------------------------

describe("CLI glob validation", () => {
	test("rejects glob patterns with null bytes", () => {
		writeFileSync(join(testDir, "src/nullbyte.css"), `@source "./src/\x00**/*.tsx";\n`);
		const output = runCLI("src/**/*.tsx", "--css", "src/nullbyte.css");
		// Should still produce output (warning, not crash)
		expect(output).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Missing-postcss normalization
// ---------------------------------------------------------------------------

describe("CLI postcss-missing normalization", () => {
	test("CLI CSS function output is clean (no postcss error leaks)", () => {
		// Regression: when postcss IS available, the CLI should process
		// --spacing() without any ERR_MODULE_NOT_FOUND artifacts in output.
		writeFileSync(
			join(testDir, "src/postcss-norm.css"),
			`@source "./src/**/*.tsx";\n.norm { padding: --spacing(3); }\n`,
		);
		const output = runCLI("src/**/*.tsx", "--css", "src/postcss-norm.css");
		expect(output).toContain("calc(3 * var(--spacing))");
		expect(output).not.toContain("ERR_MODULE_NOT_FOUND");
		expect(output).not.toContain("MODULE_NOT_FOUND");
		expect(output).not.toContain("Cannot find module");
	});
});

// ---------------------------------------------------------------------------
// --watch startup flow
// ---------------------------------------------------------------------------

describe("CLI --watch startup", () => {
	test("--watch performs initial build and writes output before entering watch loop", () => {
		// Regression: validates the --watch startup path — initial build, mkdir,
		// and first write — by spawning the CLI with --watch and killing it after
		// confirming the output file was written. This exercises the watchMode()
		// entry path that was previously only covered indirectly via the shared
		// mkdir test.
		const watchOutput = "dist/watch-startup-test.css";
		const watchOutputPath = join(testDir, watchOutput);
		try {
			rmSync(watchOutputPath);
		} catch {}

		const child = spawn(
			process.execPath,
			[distCLIPath, "src/**/*.tsx", "--css", "src/styles.css", "-o", watchOutput, "--watch"],
			{ cwd: testDir, stdio: ["pipe", "pipe", "pipe"] },
		);

		return new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				child.kill("SIGTERM");
				reject(new Error("--watch did not produce initial output within 10s"));
			}, 10000);

			// Poll for the output file — watch mode writes it after initial build
			const poll = setInterval(() => {
				if (existsSync(watchOutputPath)) {
					clearInterval(poll);
					clearTimeout(timeout);
					const css = readFileSync(watchOutputPath, "utf-8");
					expect(css).toContain(".flex");
					expect(css).toContain(":root");
					child.kill("SIGTERM");
					// Give the process time to exit gracefully
					setTimeout(() => resolve(), 200);
				}
			}, 100);

			child.on("error", (err) => {
				clearInterval(poll);
				clearTimeout(timeout);
				reject(err);
			});

			child.on("exit", () => {
				clearInterval(poll);
				clearTimeout(timeout);
				// If we already resolved, this is a no-op
				if (existsSync(watchOutputPath)) {
					resolve();
				}
			});
		});
	}, 15000);
});

describe("CLI init", () => {
	test("wires Rainbow Index into an existing Vite project", () => {
		const dir = join(tmpdir(), `ri-cli-init-${Date.now()}`);
		try {
			mkdirSync(join(dir, "src"), { recursive: true });
			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify(
					{
						name: "vite-app",
						private: true,
						devDependencies: {
							vite: "^8.0.0",
							rainbowindex: "workspace:*",
						},
					},
					null,
					2,
				),
			);
			writeFileSync(join(dir, "src/main.tsx"), 'import "./style.css";\nconsole.log("hello");\n');
			writeFileSync(join(dir, "src/style.css"), "body { color: red; }\n");
			writeFileSync(
				join(dir, "vite.config.ts"),
				'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n',
			);

			const output = runCLIIn(dir, "init");
			const config = readFileSync(join(dir, "vite.config.ts"), "utf-8");
			const css = readFileSync(join(dir, "src/style.css"), "utf-8");

			expect(output).toContain("Initialized Vite project");
			expect(config).toContain('import rainbowindex from "rainbowindex/vite";');
			expect(config).toContain("plugins: [rainbowindex()]");
			expect(css).toContain('@import "rainbowindex";');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("creates missing Vite config and stylesheet entry", () => {
		const dir = join(tmpdir(), `ri-cli-init-missing-${Date.now()}`);
		try {
			mkdirSync(join(dir, "src"), { recursive: true });
			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify(
					{
						name: "vite-app",
						private: true,
						devDependencies: {
							vite: "^8.0.0",
							rainbowindex: "workspace:*",
						},
					},
					null,
					2,
				),
			);
			writeFileSync(join(dir, "src/main.tsx"), 'console.log("hello");\n');

			runCLIIn(dir, "init");

			const config = readFileSync(join(dir, "vite.config.ts"), "utf-8");
			const css = readFileSync(join(dir, "src/index.css"), "utf-8");
			const entry = readFileSync(join(dir, "src/main.tsx"), "utf-8");

			expect(config).toContain('import rainbowindex from "rainbowindex/vite";');
			expect(config).toContain("plugins: [rainbowindex()]");
			expect(css).toContain('@import "rainbowindex";');
			expect(entry).toContain('import "./index.css";');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("CLI create helper", () => {
	test("scaffolds a Vite app and wires Rainbow Index", async () => {
		const { createViteProject } = await import("../../src/cli/vite-setup.js");
		const dir = join(tmpdir(), `ri-cli-create-${Date.now()}`);
		const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

		try {
			mkdirSync(dir, { recursive: true });

			await createViteProject(
				{
					targetDir: "my-app",
					template: "react-ts",
				},
				dir,
				{
					packageManager: "pnpm",
					runner: {
						async run(command, args, cwd) {
							calls.push({ command, args, cwd });

							if (command === "pnpm" && args[0] === "create") {
								const target = join(cwd, args[2]);
								mkdirSync(join(target, "src"), { recursive: true });
								writeFileSync(
									join(target, "package.json"),
									JSON.stringify(
										{
											name: "my-app",
											private: true,
											devDependencies: {
												vite: "^8.0.0",
											},
										},
										null,
										2,
									),
								);
								writeFileSync(join(target, "src/main.ts"), 'console.log("hello");\n');
								return;
							}

							if (command === "pnpm" && args[0] === "add") {
								const packagePath = join(cwd, "package.json");
								const packageJSON = JSON.parse(readFileSync(packagePath, "utf-8")) as {
									devDependencies?: Record<string, string>;
								};
								packageJSON.devDependencies = {
									...(packageJSON.devDependencies ?? {}),
									rainbowindex: "workspace:*",
								};
								writeFileSync(packagePath, JSON.stringify(packageJSON, null, 2));
								return;
							}

							throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
						},
					},
				},
			);

			const target = join(dir, "my-app");
			const config = readFileSync(join(target, "vite.config.ts"), "utf-8");
			const css = readFileSync(join(target, "src/index.css"), "utf-8");
			const entry = readFileSync(join(target, "src/main.ts"), "utf-8");
			const packageJSON = JSON.parse(readFileSync(join(target, "package.json"), "utf-8")) as {
				devDependencies?: Record<string, string>;
			};

			expect(calls).toEqual([
				{
					command: "pnpm",
					args: ["create", "vite", "my-app", "--template", "react-ts"],
					cwd: dir,
				},
				{
					command: "pnpm",
					args: ["add", "-D", "rainbowindex"],
					cwd: target,
				},
			]);
			expect(config).toContain('import rainbowindex from "rainbowindex/vite";');
			expect(config).toContain("plugins: [rainbowindex()]");
			expect(css).toContain('@import "rainbowindex";');
			expect(entry).toContain('import "./index.css";');
			expect(packageJSON.devDependencies?.rainbowindex).toBe("workspace:*");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("CLI scan", () => {
	test("prints extracted classes per file", () => {
		const out = runCLI("scan", "src/App.tsx");
		expect(out).toContain("src/App.tsx");
		expect(out).toContain("  flex");
		expect(out).toContain("  bg-theme-500");
	});

	test("errors without positionals and on zero matches", () => {
		expect(() => runCLI("scan")).toThrow();
		expect(() => runCLI("scan", "src/Nope.tsx")).toThrow();
	});
});
