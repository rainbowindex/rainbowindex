import { relative, resolve } from "node:path";

export type Subcommand = "build" | "generate-types" | "preload-fonts" | "init" | "create";

export interface CLIOptions {
	command: Subcommand;
	globs: string[];
	output?: string;
	watch: boolean;
	minify: boolean;
	cssFile?: string;
	strict: boolean;
	template?: string;
	targetDir?: string;
	/** True if the user typed a subcommand keyword (vs falling back to `build`). */
	subcommandExplicit: boolean;
	/** Set when --version or --help was handled; main() should exit early. */
	earlyExit: boolean;
}

export function parseArgs(
	argv: string[],
	callbacks: {
		getVersion: () => string;
		printHelp: (subcommand?: Subcommand) => void;
	},
): CLIOptions {
	if (argv[0] === "framework") {
		throw new Error(
			'Framework runners were removed. Use your project\'s Vite scripts directly, such as "pnpm dev" or "pnpm build".',
		);
	}

	const opts: CLIOptions = {
		command: "build",
		globs: [],
		watch: false,
		minify: false,
		strict: false,
		subcommandExplicit: false,
		earlyExit: false,
	};

	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];

		if (arg === "build" && !opts.subcommandExplicit && opts.globs.length === 0) {
			// Accept an explicit `build` keyword so `rainbowindex build --help` shows
			// build-specific help. It's still the default command, so omitting it works.
			opts.command = "build";
			opts.subcommandExplicit = true;
			i++;
			continue;
		}
		if (arg === "generate-types") {
			opts.command = "generate-types";
			opts.subcommandExplicit = true;
			i++;
			continue;
		}
		if (arg === "init" || arg === "--init") {
			opts.command = "init";
			opts.subcommandExplicit = true;
			i++;
			continue;
		}
		if (arg === "create" || arg === "--create") {
			opts.command = "create";
			opts.subcommandExplicit = true;
			i++;
			continue;
		}
		if (arg === "preload-fonts") {
			opts.command = "preload-fonts";
			opts.subcommandExplicit = true;
			i++;
			continue;
		}
		if (arg === "-o" || arg === "--output") {
			if (i + 1 >= argv.length) {
				throw new Error(`Missing value for ${arg}`);
			}
			opts.output = argv[++i];
			i++;
			continue;
		}
		if (arg === "--css") {
			if (i + 1 >= argv.length) {
				throw new Error("Missing value for --css");
			}
			opts.cssFile = argv[++i];
			i++;
			continue;
		}
		if (arg === "--template") {
			if (i + 1 >= argv.length) {
				throw new Error("Missing value for --template");
			}
			opts.template = argv[++i];
			i++;
			continue;
		}
		if (arg === "--watch") {
			opts.watch = true;
			i++;
			continue;
		}
		if (arg === "--minify") {
			opts.minify = true;
			i++;
			continue;
		}
		if (arg === "--strict") {
			opts.strict = true;
			i++;
			continue;
		}
		if (arg === "--version" || arg === "-v") {
			console.log(callbacks.getVersion());
			opts.earlyExit = true;
			return opts;
		}
		if (arg === "--help" || arg === "-h") {
			callbacks.printHelp(opts.subcommandExplicit ? opts.command : undefined);
			opts.earlyExit = true;
			return opts;
		}
		if (arg.startsWith("-")) {
			throw new Error(`Unknown option "${arg}". Run rainbowindex --help for usage.`);
		}

		if (opts.command === "create") {
			if (opts.targetDir) {
				throw new Error(`Unexpected extra argument "${arg}" for create.`);
			}
			opts.targetDir = arg;
			i++;
			continue;
		}

		if (opts.command === "init") {
			throw new Error(`Unexpected extra argument "${arg}" for init.`);
		}

		opts.globs.push(arg);
		i++;
	}

	if (opts.command === "create" && !opts.targetDir) {
		throw new Error("create requires a project directory. Example: rainbowindex create my-app");
	}

	if (opts.watch && !opts.output) {
		throw new Error(
			'--output is required with --watch. Example: rainbowindex "src/**/*.tsx" --watch -o dist/styles.css',
		);
	}

	if (opts.output) {
		const resolved = resolve(process.cwd(), opts.output);
		const rel = relative(process.cwd(), resolved);
		if (rel.startsWith("..") || resolve(rel) === rel) {
			throw new Error(
				`Output path "${opts.output}" resolves outside the project root. Use a relative path within the project directory.`,
			);
		}
	}

	return opts;
}

const SUBCOMMAND_HELP: Record<Subcommand, string> = {
	build: `
🌈 rainbowindex build — Generate CSS from source files

Usage:
  rainbowindex <glob...> [options]
  rainbowindex --css <file> [options]

Options:
  -o, --output <file>    Output CSS file path (omit to write to stdout)
  --watch                Re-run on source-file changes (requires --output)
  --minify               Minify output via LightningCSS
  --css <file>           CSS input with directives (auto-detected if omitted)
  -h, --help             Show this help

Inputs:
  Pass one or more globs to scan for class names. If no globs are passed and
  a CSS file with @source directives is found, those are used instead.

Examples:
  rainbowindex "src/**/*.tsx" -o dist/styles.css
  rainbowindex "src/**/*.tsx" --watch -o dist/styles.css
  rainbowindex --css src/styles.css -o dist/styles.css --minify
`,
	init: `
🌈 rainbowindex init — Wire Rainbow Index into the current Vite app

Usage:
  rainbowindex init [options]

What this does:
  1. Installs rainbowindex as a dev dependency (if not already installed).
  2. Creates or patches vite.config.* to register the Vite plugin.
  3. Creates or updates a CSS entry file with @import "rainbowindex".
  4. Adds the CSS import to your entry file (src/main.tsx, src/main.ts, …).

Options:
  --css <file>           Stylesheet path to create/patch (default: src/index.css)
  -h, --help             Show this help

Notes:
  Detects pnpm / yarn / bun / npm from lockfiles, package.json#packageManager,
  and npm_config_user_agent. Requires an existing Vite project — if you do not
  have one yet, use \`rainbowindex create <dir>\`.

Examples:
  rainbowindex init
  rainbowindex init --css src/styles.css
`,
	create: `
🌈 rainbowindex create — Scaffold a Vite app with Rainbow Index ready

Usage:
  rainbowindex create <dir> [options]

Options:
  --template <name>      Vite template (default: react-ts)
                         Examples: vanilla, vanilla-ts, react, react-ts, vue, vue-ts, svelte, svelte-ts
  --css <file>           Stylesheet path inside the new app (default: src/index.css)
  -h, --help             Show this help

What this does:
  1. Runs \`create vite\` for the given template.
  2. Runs \`rainbowindex init\` inside the new directory.

Examples:
  rainbowindex create my-app
  rainbowindex create my-app --template vue-ts
`,
	"generate-types": `
🌈 rainbowindex generate-types — Generate TypeScript types for ri() autocomplete

Usage:
  rainbowindex generate-types [options]

Options:
  --css <file>           CSS input with @color/@text/@utility/etc directives
  --strict               Drop the \`string & {}\` escape hatch from the union
  -h, --help             Show this help

Output:
  Writes \`rainbowindex-env.d.ts\` to the current working directory. Include it
  in tsconfig.json#include (or the equivalent) so the editor picks it up.

Examples:
  rainbowindex generate-types
  rainbowindex generate-types --strict --css src/styles.css
`,
	"preload-fonts": `
🌈 rainbowindex preload-fonts — Generate <link rel="preload"> tags

Usage:
  rainbowindex preload-fonts [options]

Options:
  --css <file>           CSS input with @font directives
  -h, --help             Show this help

Output:
  Prints <link rel="preload"> tags to stdout for fonts declared in the @font
  block (faces marked preload), or via @font-face.

Examples:
  rainbowindex preload-fonts --css src/styles.css > preload.html
`,
};

export function printHelp(subcommand?: Subcommand): void {
	if (subcommand) {
		console.log(SUBCOMMAND_HELP[subcommand]);
		return;
	}
	console.log(`
🌈 Rainbow Index CLI

Usage:
  rainbowindex <glob> [options]        Generate CSS from source files
  rainbowindex init                    Wire Rainbow Index into the current Vite app
  rainbowindex create <dir>            Scaffold a Vite app with Rainbow Index ready
  rainbowindex generate-types          Generate TypeScript types for ri()
  rainbowindex preload-fonts           Generate font preload link tags

Run \`rainbowindex <subcommand> --help\` for subcommand-specific options.

Options:
  -o, --output <file>    Output CSS file path
  --watch                Watch for changes
  --minify               Minify output via LightningCSS
  --css <file>           CSS file with directives (default: auto-detect)
  --template <name>      Vite template for create (default: react-ts)
  --strict               No string escape hatch in generated types
  -v, --version          Show version
  -h, --help             Show this help

Environment Variables:
  RI_CACHE_DIR           Override font metadata cache directory (default: node_modules/.cache/rainbowindex)
  RI_FONT_CACHE_TTL      Font cache max age in seconds (default: 604800 = 7 days)
  RI_FETCH_FONTS=0       Disable network requests for Google Fonts metadata (default: enabled)
  RI_OFFLINE=1           Skip network requests, use cached font data only
  RI_DEBUG=1             Enable debug logging

Diagnostics:
  Warnings carry [RI-NNNN] codes. Full table: https://rainbowindex.dev/docs/diagnostics

Examples:
  rainbowindex init
  rainbowindex create my-app --template react-ts
  rainbowindex "src/**/*.tsx" -o dist/styles.css
  rainbowindex "src/**/*.tsx" --watch -o dist/styles.css
  rainbowindex generate-types --strict
`);
}
