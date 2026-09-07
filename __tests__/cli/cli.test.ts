import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `ri-cli-test-${Date.now()}`);
const distCLIPath = join(import.meta.dirname, "../../dist/cli.mjs");

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
			`<div className="flex items-center p-4 bg-primary-500 text-white text-lg rounded-2 shadow-sm gap-2 hover:bg-primary-600">
				<span className="font-bold tracking-tight">E2E</span>
			</div>`,
		);
		writeFileSync(
			join(testDir, "src/e2e-full.css"),
			`@source "./src/e2e-full.tsx";
@color { primary: 0.18 220; }
@text { base: 1rem/1.5; lg: 1.125rem/1.75; }
@spacing { base: 0.25rem; }
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
		expect(output).toContain(".rounded-2");
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

// ---------------------------------------------------------------------------
// Quick start, end to end
// ---------------------------------------------------------------------------

/**
 * The documented path, walked exactly as `README.md` and `docs/getting-started.md`
 * tell a new user to walk it: `rainbowindex init`, then one of the two starts,
 * then a build.
 *
 * The unit suite builds themes in memory, which is why it stayed green through a
 * release where the Tailwind-familiar start silently loaded no theme at all —
 * `@import "rainbowindex/tailwind.css"` was matched as an activation marker and
 * never resolved, so every named token compiled to nothing with no warning. A
 * test that constructs a theme by hand cannot see that. This one resolves the
 * specifier the way a real project does, through `node_modules` and the package
 * `exports` map, so it fails when the documented path breaks for any reason —
 * resolution, inlining, stripping, or emission.
 *
 * Runs under `test:artifacts`, i.e. after `pnpm build`: the bare specifier
 * resolves to `dist/tailwind.css`.
 */
describe("CLI quick start", () => {
	const repoRoot = join(import.meta.dirname, "../..");

	/** A bare Vite project with the package linked in, as an install leaves it. */
	function scaffold(dir: string): void {
		mkdirSync(join(dir, "src"), { recursive: true });
		mkdirSync(join(dir, "node_modules"), { recursive: true });
		// What `pnpm add rainbowindex` leaves behind: a symlink Node resolves
		// through to the package's own `exports` map. Without it the bare
		// specifier cannot resolve and the test would prove nothing.
		symlinkSync(repoRoot, join(dir, "node_modules/rainbowindex"), "junction");
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify(
				{
					name: "vite-app",
					private: true,
					devDependencies: { vite: "^8.0.0", rainbowindex: "workspace:*" },
				},
				null,
				2,
			),
		);
		writeFileSync(
			join(dir, "vite.config.ts"),
			'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n',
		);
		writeFileSync(join(dir, "src/main.tsx"), 'import "./index.css";\n');
	}

	/** Build, returning stdout and stderr separately so warnings can be asserted. */
	function build(dir: string): { stdout: string; stderr: string } {
		const result = spawnSync(
			process.execPath,
			[distCLIPath, "src/**/*.tsx", "--css", "src/index.css", "-o", "out.css"],
			{ cwd: dir, encoding: "utf-8", timeout: 30000 },
		);
		expect(result.error).toBeUndefined();
		expect(result.status, `CLI exited ${result.status}\n${result.stderr}`).toBe(0);
		return { stdout: result.stdout, stderr: result.stderr };
	}

	/** The markup from the README's quick start, verbatim in spirit. */
	const APP = `export default function App() {
	return (
		<div className="sm:flex gap-4 px-6 py-3 text-lg font-bold rounded-lg rounded shadow-md shadow bg-blue-600 text-white">
			Hello
		</div>
	);
}
`;

	test("the Tailwind-familiar start renders the classes it advertises", () => {
		const dir = join(tmpdir(), `ri-cli-quickstart-preset-${Date.now()}`);
		try {
			scaffold(dir);

			// Step 1 of the docs: wire the project up.
			const initOutput = runCLIIn(dir, "init", "--css", "src/index.css");
			expect(initOutput).toContain("Initialized Vite project");
			expect(readFileSync(join(dir, "src/index.css"), "utf-8")).toContain(
				'@import "rainbowindex";',
			);

			// Step 2: the second line of the Tailwind-familiar start.
			writeFileSync(
				join(dir, "src/index.css"),
				`${readFileSync(join(dir, "src/index.css"), "utf-8")}@import "rainbowindex/tailwind.css";\n`,
			);
			writeFileSync(join(dir, "src/App.tsx"), APP);

			const { stderr } = build(dir);
			const css = readFileSync(join(dir, "out.css"), "utf-8");

			// Silence matters as much as the output: the failure this test exists
			// for produced no warning at all, and an import that fails to resolve
			// would say so with RI-1041.
			expect(stderr).toBe("");

			for (const rule of [
				".sm\\:flex",
				".text-lg",
				".font-bold",
				".shadow-md",
				".rounded-lg",
				".bg-blue-600",
			]) {
				expect(css, `${rule} missing from the emitted stylesheet`).toContain(`${rule} {`);
			}
			// Bare `rounded` reads the preset's DEFAULT radius (C2b).
			expect(css).toContain(".rounded {");
			// The preset's tokens reached `:root`, not just its rules.
			expect(css).toContain("--color-blue-600:");
			expect(css).toContain("--text-lg:");
			// Bare `shadow` is the sharp one. It used to compile to
			// `var(--shadow-DEFAULT)` with the token pruned away behind it — a
			// rule that painted nothing while `validate()` called the class fine.
			// It now inlines the value with a colour slot, so the check is that
			// the rule carries a real shadow rather than that a token exists.
			expect(css).toMatch(
				/\.shadow \{\s*--ri-shadow: 0 1px 3px 0 var\(--ri-shadow-color, rgb\(0 0 0 \/ 0\.1\)\)/,
			);
			// Directives are read, never emitted. A comment in the preset that
			// names one used to stop the strip pass and leak the rest verbatim.
			expect(css).not.toMatch(
				/^@(?:color|text|weight|leading|rounded|shadow|blur|ease|animate|breakpoint|utility)\b/m,
			);
			// Line-anchored: the preset's header comment quotes both import lines
			// as documentation, and a comment is ordinary CSS that passes through.
			// What must not survive is either one as a live at-rule.
			expect(css).not.toMatch(/^@import\s+["']rainbowindex/m);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the same classes render nothing without the preset", () => {
		// The control. Without this, the test above would still pass if the
		// engine grew default scales of its own, and would stop testing the
		// preset at all.
		const dir = join(tmpdir(), `ri-cli-quickstart-bare-${Date.now()}`);
		try {
			scaffold(dir);
			runCLIIn(dir, "init", "--css", "src/index.css");
			writeFileSync(join(dir, "src/App.tsx"), APP);

			build(dir);
			const css = readFileSync(join(dir, "out.css"), "utf-8");

			for (const rule of [".text-lg", ".font-bold", ".shadow-md", ".rounded-lg", ".rounded"]) {
				expect(
					css,
					`${rule} resolved with no theme — the preset is no longer load-bearing`,
				).not.toContain(`${rule} {`);
			}
			// `sm:` has no breakpoint to hang on, so the variant itself is unknown.
			expect(css).not.toContain(".sm\\:flex");
			// What does work with no theme still works: the computed forms.
			expect(css).toContain(".gap-4 {");
			expect(css).toContain(".px-6 {");
			expect(css).toContain(".text-white {");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the from-scratch start renders the tokens the project declares", () => {
		const dir = join(tmpdir(), `ri-cli-quickstart-scratch-${Date.now()}`);
		try {
			scaffold(dir);
			runCLIIn(dir, "init", "--css", "src/index.css");
			writeFileSync(
				join(dir, "src/index.css"),
				`${readFileSync(join(dir, "src/index.css"), "utf-8")}
@color {
	brand: 0.18 330;
}

@text { body: 1rem, 1.5; }
@breakpoint { sm: 40rem; }
`,
			);
			writeFileSync(
				join(dir, "src/App.tsx"),
				`export default function App() {
	return <div className="sm:flex gap-4 px-6 py-3 text-body bg-brand-500 text-white">Hello</div>;
}
`,
			);

			const { stderr } = build(dir);
			const css = readFileSync(join(dir, "out.css"), "utf-8");

			expect(stderr).toBe("");
			expect(css).toContain(".sm\\:flex {");
			expect(css).toContain(".text-body {");
			expect(css).toContain(".bg-brand-500 {");
			expect(css).toContain("--color-brand-500:");
			expect(css).toContain("@media (min-width: 40rem)");
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

describe("CLI generate-tokens", () => {
	const dir = join(tmpdir(), `ri-tokens-${Date.now()}`);

	beforeAll(() => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "app.css"),
			`@import "rainbowindex";
@color { brand: 0.18 330; surface: oklch(0.98 0.01 260); }
@text { body: 1rem, 1.5; display: 3rem, 1.1; }
@breakpoint { sm: 40rem; }
@shadow { card: 0 4px 8px rgb(0 0 0 / 0.15); }
@rounded { roof: 24px; }
`,
		);
		runCLIIn(dir, "generate-tokens", "--css", "app.css");
	});

	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	test("writes both files", () => {
		expect(existsSync(join(dir, "rainbowindex-tokens.ts"))).toBe(true);
		expect(existsSync(join(dir, "tokens.json"))).toBe(true);
	});

	test("the module exports var() references, not literals", () => {
		const ts = readFileSync(join(dir, "rainbowindex-tokens.ts"), "utf-8");
		// A `var()` keeps following the cascade, so a `[data-theme]` override or
		// a dark-mode flip still changes what the token resolves to. A baked
		// literal would freeze whichever mode happened to be active at build.
		expect(ts).toContain('"500": "var(--color-brand-500)"');
		expect(ts).toContain('surface: "var(--color-surface)"');
		expect(ts).toContain('display: "var(--text-display)"');
		expect(ts).toContain('card: "var(--shadow-card)"');
		expect(ts).toContain('roof: "var(--rounded-roof)"');
		expect(ts).toContain("as const");
	});

	test("a generative palette carries every canonical stop, an explicit color does not", () => {
		const ts = readFileSync(join(dir, "rainbowindex-tokens.ts"), "utf-8");
		// Not pruned by usage: what reads this file is code the scanner never
		// sees, so a stop no class mentions still has to be reachable.
		expect(ts).toContain('"50": "var(--color-brand-50)"');
		expect(ts).toContain('"950": "var(--color-brand-950)"');
		expect(ts).not.toContain("var(--color-surface-500)");
	});

	test("stops are ordered numerically, matching how JavaScript orders the JSON", () => {
		const ts = readFileSync(join(dir, "rainbowindex-tokens.ts"), "utf-8");
		const stops = [...ts.matchAll(/"(\d+)": "var\(--color-brand-\d+\)"/g)].map((m) => Number(m[1]));
		expect(stops.length).toBeGreaterThan(5);
		expect(stops).toEqual([...stops].sort((a, b) => a - b));
	});

	test("omits namespaces the theme never declared", () => {
		const ts = readFileSync(join(dir, "rainbowindex-tokens.ts"), "utf-8");
		// The generated type should say what this theme has, not what the engine
		// could support — an empty `{}` group is noise in every completion list.
		expect(ts).not.toContain("blur:");
		expect(ts).not.toContain("tracking:");
	});

	test("the JSON is W3C Design Tokens with resolved values", () => {
		const json = JSON.parse(readFileSync(join(dir, "tokens.json"), "utf-8"));
		// A design tool has no cascade, so `var()` would be meaningless there.
		expect(json.color.brand["500"]).toEqual({ $type: "color", $value: expect.any(String) });
		expect(json.color.brand["500"].$value).toMatch(/^#[0-9a-f]{6}$/);
		expect(json.breakpoint.sm).toEqual({ $type: "dimension", $value: "40rem" });
		expect(json.text.display).toEqual({ $type: "dimension", $value: "3rem" });
		expect(json.shadow.card.$type).toBe("shadow");
	});

	test("re-running on an unchanged theme rewrites nothing", () => {
		const before = [
			readFileSync(join(dir, "rainbowindex-tokens.ts"), "utf-8"),
			readFileSync(join(dir, "tokens.json"), "utf-8"),
		];
		runCLIIn(dir, "generate-tokens", "--css", "app.css");
		expect([
			readFileSync(join(dir, "rainbowindex-tokens.ts"), "utf-8"),
			readFileSync(join(dir, "tokens.json"), "utf-8"),
		]).toEqual(before);
	});

	test("-o moves the module and the JSON lands beside it", () => {
		mkdirSync(join(dir, "gen"), { recursive: true });
		runCLIIn(dir, "generate-tokens", "--css", "app.css", "-o", "gen/theme.ts");
		expect(existsSync(join(dir, "gen/theme.ts"))).toBe(true);
		expect(existsSync(join(dir, "gen/tokens.json"))).toBe(true);
	});

	test("declaration order does not reach the output", () => {
		// Determinism is the point of sorting: two themes that declare the same
		// tokens in different orders have to produce byte-identical files, or a
		// committed token file churns every time someone reorders their CSS.
		const a = join(tmpdir(), `ri-tokens-a-${Date.now()}`);
		const b = join(tmpdir(), `ri-tokens-b-${Date.now()}`);
		try {
			mkdirSync(a, { recursive: true });
			mkdirSync(b, { recursive: true });
			const forward = `@import "rainbowindex";
@color { alpha: 0.18 30; beta: 0.18 90; gamma: 0.18 150; }
@breakpoint { sm: 40rem; md: 48rem; lg: 64rem; }
`;
			const reversed = `@import "rainbowindex";
@color { gamma: 0.18 150; beta: 0.18 90; alpha: 0.18 30; }
@breakpoint { lg: 64rem; md: 48rem; sm: 40rem; }
`;
			writeFileSync(join(a, "app.css"), forward);
			writeFileSync(join(b, "app.css"), reversed);
			runCLIIn(a, "generate-tokens", "--css", "app.css");
			runCLIIn(b, "generate-tokens", "--css", "app.css");

			for (const file of ["rainbowindex-tokens.ts", "tokens.json"]) {
				expect(readFileSync(join(b, file), "utf-8"), file).toBe(
					readFileSync(join(a, file), "utf-8"),
				);
			}
			// And the order really is sorted, not merely equal.
			const ts = readFileSync(join(a, "rainbowindex-tokens.ts"), "utf-8");
			expect(ts.indexOf("alpha:")).toBeLessThan(ts.indexOf("beta:"));
			expect(ts.indexOf("beta:")).toBeLessThan(ts.indexOf("gamma:"));
			expect(ts.indexOf("lg:")).toBeLessThan(ts.indexOf("md:"));
		} finally {
			rmSync(a, { recursive: true, force: true });
			rmSync(b, { recursive: true, force: true });
		}
	});

	test("is listed in --help", () => {
		expect(runCLIIn(dir, "--help")).toContain("generate-tokens");
	});
});

// ---------------------------------------------------------------------------
// migrate tailwind
// ---------------------------------------------------------------------------

/**
 * The migrator end to end, on a project shaped like a real Tailwind v4 app.
 *
 * `__tests__/core/migrate-tailwind.test.ts` proves the translation; this
 * proves the command — entry detection, the preset resolving through an
 * installed package, the dual build against real source files, what gets
 * written, and above all that **nothing is overwritten without `--write`**.
 */
describe("migrate tailwind", () => {
	const project = join(tmpdir(), `ri-migrate-${Date.now()}`);

	const ENTRY = `@import "tailwindcss";
@plugin "@tailwindcss/typography";
@custom-variant dark (&:where(.dark, .dark *));

@theme {
	--color-brand-500: oklch(0.66 0.21 329);
	--color-brand-700: oklch(0.49 0.15 329);
	--font-display: "Satoshi", sans-serif;
	--text-hero: 3rem;
	--text-hero--line-height: 1.1;
	--radius-card: 0.75rem;
	--breakpoint-tablet: 48rem;
	--animate-shimmer: shimmer 2s linear infinite;

	@keyframes shimmer {
		from { background-position: 200% 0; }
		to { background-position: -200% 0; }
	}
}

.prose { max-width: 65ch; }
`;

	const APP = `export const App = () => (
  <div className="flex items-center gap-3 rounded-card bg-brand-500 px-4 py-2 text-hero font-display tablet:gap-6 dark:bg-brand-700 animate-shimmer prose-lg">
    <span className="text-sm font-bold shadow-md">Hi</span>
  </div>
);
`;

	beforeAll(() => {
		mkdirSync(join(project, "src"), { recursive: true });
		mkdirSync(join(project, "node_modules"), { recursive: true });
		// The preset resolves through the consumer's installed package, exactly
		// as it does in a real migration.
		symlinkSync(
			join(import.meta.dirname, "../.."),
			join(project, "node_modules/rainbowindex"),
			"dir",
		);
		writeFileSync(
			join(project, "package.json"),
			JSON.stringify({
				name: "tw-app",
				private: true,
				devDependencies: { "@tailwindcss/vite": "^4.0.0", tailwindcss: "^4.0.0" },
			}),
		);
		writeFileSync(join(project, "src/index.css"), ENTRY);
		writeFileSync(join(project, "src/App.tsx"), APP);
	});

	afterAll(() => {
		try {
			rmSync(project, { recursive: true, force: true });
		} catch {}
	});

	test("translates without touching the original", () => {
		const out = runCLIIn(project, "migrate", "tailwind", "src/**/*.tsx");
		expect(out).toContain("Migrated src/index.css");
		expect(out).toContain("Nothing was overwritten");

		// The entry is untouched, and the preview sits beside it.
		expect(readFileSync(join(project, "src/index.css"), "utf-8")).toBe(ENTRY);
		const migrated = readFileSync(join(project, "src/index.rainbowindex.css"), "utf-8");
		expect(migrated).toContain('@import "rainbowindex";');
		expect(migrated).toContain('@import "rainbowindex/tailwind.css";');
		expect(migrated).toContain("brand-500: oklch(0.66 0.21 329);");
		expect(migrated).toContain("hero: 3rem, 1.1;");
		expect(migrated).toContain("variant: selector(.dark);");
		// The project's own CSS survives.
		expect(migrated).toContain(".prose { max-width: 65ch; }");
	});

	test("checks the project's real classes against the migrated theme", () => {
		const out = runCLIIn(project, "migrate", "tailwind", "src/**/*.tsx");
		// Only `prose-lg` should fail — it comes from the typography plugin,
		// which the report already lists as needing a person.
		expect(out).toMatch(/1 of \d+ classes in your source do not resolve/);

		const report = readFileSync(join(project, "migration-report.md"), "utf-8");
		expect(report).toContain("`prose-lg`");
		expect(report).toContain("@plugin");
		expect(report).not.toContain("`text-sm`");
		expect(report).not.toContain("`shadow-md`");
		// Scanner noise must not appear as a failing class.
		expect(report).not.toContain("`const`");
		expect(report).not.toContain("`export`");
	});

	test("the migrated entry builds", () => {
		runCLIIn(project, "migrate", "tailwind", "src/**/*.tsx");
		const css = runCLIIn(project, "build", "src/**/*.tsx", "--css", "src/index.rainbowindex.css");
		for (const rule of [
			".bg-brand-500",
			".rounded-card",
			".text-hero",
			".font-display",
			".shadow-md",
			".animate-shimmer",
		]) {
			expect(css, rule).toContain(`${rule} {`);
		}
		// The dark strategy came across: `dark:` follows the class, not the media
		// query, which is what the Tailwind project had.
		expect(css).toContain(".dark");
	});

	test("--write applies it and keeps the original", () => {
		const out = runCLIIn(project, "migrate", "tailwind", "--write");
		expect(out).toContain("Applied.");
		expect(readFileSync(join(project, "src/index.css"), "utf-8")).toContain(
			'@import "rainbowindex";',
		);
		expect(readFileSync(join(project, "src/index.css.tailwind.bak"), "utf-8")).toBe(ENTRY);
	});

	test("says so when there is nothing to migrate", () => {
		const empty = join(tmpdir(), `ri-migrate-empty-${Date.now()}`);
		mkdirSync(join(empty, "src"), { recursive: true });
		writeFileSync(join(empty, "src/index.css"), '@import "rainbowindex";\n');
		const result = spawnSync(process.execPath, [distCLIPath, "migrate", "tailwind"], {
			cwd: empty,
			encoding: "utf-8",
		});
		expect(result.status).not.toBe(0);
		expect(`${result.stdout}${result.stderr}`).toContain("No Tailwind CSS entry found");
		rmSync(empty, { recursive: true, force: true });
	});

	test("rejects an unknown source", () => {
		const result = spawnSync(process.execPath, [distCLIPath, "migrate", "bootstrap"], {
			cwd: project,
			encoding: "utf-8",
		});
		expect(result.status).not.toBe(0);
		expect(`${result.stdout}${result.stderr}`).toContain('Unknown migration source "bootstrap"');
	});
});
