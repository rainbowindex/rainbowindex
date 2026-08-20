import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
	vi.doUnmock("node:module");
	vi.doUnmock("postcss");
});

describe("error contracts", () => {
	it("parseArgs rejects missing --css value", async () => {
		const { parseArgs } = await import("../../src/cli/args.js");
		expect(() =>
			parseArgs(["--css"], {
				getVersion: () => "1.0.0",
				printHelp: () => {},
			}),
		).toThrow("Missing value for --css");
	});

	it("parseArgs rejects output paths outside the project root", async () => {
		const { parseArgs } = await import("../../src/cli/args.js");
		expect(() =>
			parseArgs(["src/**/*.tsx", "--output", "../dist/out.css"], {
				getVersion: () => "1.0.0",
				printHelp: () => {},
			}),
		).toThrow(/outside the project root/);
	});

	it("parseArgs rejects flags that belong to a different command", async () => {
		const { parseArgs } = await import("../../src/cli/args.js");
		expect(() =>
			parseArgs(["preload-fonts", "--watch"], {
				getVersion: () => "1.0.0",
				printHelp: () => {},
			}),
		).toThrow(/not supported by preload-fonts/);
	});

	it("parseArgs treats a subcommand keyword after a positional as a positional", async () => {
		const { parseArgs } = await import("../../src/cli/args.js");
		const opts = parseArgs(["src/**", "generate-types"], {
			getVersion: () => "1.0.0",
			printHelp: () => {},
		});
		expect(opts.command).toBe("build");
		expect(opts.globs).toEqual(["src/**", "generate-types"]);
	});

	it("parseArgs resolves the command from a keyword after flags", async () => {
		const { parseArgs } = await import("../../src/cli/args.js");
		const opts = parseArgs(["--strict", "generate-types"], {
			getVersion: () => "1.0.0",
			printHelp: () => {},
		});
		expect(opts.command).toBe("generate-types");
		expect(opts.strict).toBe(true);
	});

	it("parseArgs rejects a value flag at the end of argv", async () => {
		const { parseArgs } = await import("../../src/cli/args.js");
		expect(() =>
			parseArgs(["create", "my-app", "--template"], {
				getVersion: () => "1.0.0",
				printHelp: () => {},
			}),
		).toThrow("Missing value for --template");
	});

	it("createCompiler.compile rejects non-iterable classNames", async () => {
		const { createCompiler } = await import("../../src/engine/index.js");
		const { resolveDirectives } = await import("../../src/directives/index.js");
		const compiler = createCompiler();
		const theme = resolveDirectives([]);
		expect(() => compiler.compile(null as never, theme)).toThrow(
			/\[RI-2008\] compile\(\) expected classNames to be iterable/,
		);
	});

	it("createCompiler.compile rejects invalid theme objects", async () => {
		const { createCompiler } = await import("../../src/engine/index.js");
		const compiler = createCompiler();
		expect(() => compiler.compile(["flex"], null as never)).toThrow(
			/\[RI-2007\] compile\(\) expected theme to be a ResolvedTheme object/,
		);
	});

	it("optimizeCSS sanitizes unexpected transformer errors", async () => {
		vi.doMock("lightningcss", () => ({
			transform: () => {
				throw new Error("failed to read /Users/milo/Desktop/trying/secret/file.css");
			},
		}));
		const { optimizeCSS } = await import("../../src/cli/optimize.js");
		expect(() => optimizeCSS(".x{color:red}")).toThrow(/CSS optimization failed: .*<path>/);
	});
});
