import { relative, resolve } from "node:path";

export type Subcommand =
	| "build"
	| "generate-types"
	| "generate-snapshot"
	| "generate-tokens"
	| "preload-fonts"
	| "init"
	| "create"
	| "migrate"
	| "scan";

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
	/** `migrate`'s positional: which tool to migrate from. */
	migrateSource?: string;
	/** `migrate --write`: apply the change instead of writing a preview. */
	write: boolean;
	/** True if the user typed a subcommand keyword (vs falling back to `build`). */
	subcommandExplicit: boolean;
	/** Set when --version or --help was handled; main() should exit early. */
	earlyExit: boolean;
}

/** One CLI flag: aliases, an optional value placeholder (defined ⇔ the flag
 *  consumes the next token), its help description, and how it lands on
 *  CLIOptions. Specs are shared by reference across commands so each
 *  description exists exactly once per meaning and cannot drift between the
 *  global and per-command help screens. */
interface FlagSpec {
	names: readonly string[];
	valueName?: string;
	/** Heading override for help output when listing every alias would be
	 *  redundant (e.g. --minify notes --optimize in its description). */
	helpLabel?: string;
	describe: string;
	apply(opts: CLIOptions, value?: string): void;
}

const WRITE: FlagSpec = {
	names: ["--write"],
	describe: "Apply the migration in place (default: write a preview beside it)",
	apply(opts) {
		opts.write = true;
	},
};

// `--css` and `-o` mean different things per command family, so each meaning
// keeps its own description while sharing the one apply target. A factory
// rather than six near-identical literals: the description is the only thing
// that ever differs, and spelling `apply` out again is how two of them came to
// drift from `applyCSSFile`.
const cssInput = (describe: string): FlagSpec => ({
	names: ["--css"],
	valueName: "<file>",
	describe,
	apply(opts, value) {
		opts.cssFile = value;
	},
});

const output = (describe: string): FlagSpec => ({
	names: ["-o", "--output"],
	valueName: "<file>",
	describe,
	apply(opts, value) {
		opts.output = value;
	},
});

const OUTPUT = output("Output CSS file path (omit to write to stdout)");

const WATCH: FlagSpec = {
	names: ["--watch"],
	describe: "Re-run on source-file changes (requires --output)",
	apply(opts) {
		opts.watch = true;
	},
};

const MINIFY: FlagSpec = {
	names: ["--minify", "--optimize"],
	helpLabel: "--minify",
	describe: "Minify + browser fallbacks via LightningCSS (alias: --optimize)",
	apply(opts) {
		opts.minify = true;
	},
};

const STRICT: FlagSpec = {
	names: ["--strict"],
	describe: "Drop the `string & {}` escape hatch from the union",
	apply(opts) {
		opts.strict = true;
	},
};

const TEMPLATE: FlagSpec = {
	names: ["--template"],
	valueName: "<name>",
	describe:
		"Vite template (default: react-ts)\nExamples: vanilla, vanilla-ts, react, react-ts, vue, vue-ts, svelte, svelte-ts",
	apply(opts, value) {
		opts.template = value;
	},
};

const CSS_INPUT = cssInput("CSS input with directives (auto-detected if omitted)");
const CSS_INPUT_TYPES = cssInput("CSS input with @color/@text/@utility/etc directives");
const CSS_INPUT_FONTS = cssInput("CSS input with @font directives");

const TOKENS_OUTPUT = output(
	"Token module path (default: rainbowindex-tokens.ts); tokens.json lands beside it",
);
const SNAPSHOT_OUTPUT = output("Snapshot module path (default: rainbowindex-snapshot.ts)");

const CSS_TARGET = cssInput("Stylesheet path to create/patch (default: src/index.css)");

/** Declarative model for one subcommand: which flags it accepts, what its
 *  positional arguments mean, and the hand-written help prose around the
 *  generated Options section. The parse loop and printHelp both read this
 *  table, so flag acceptance and help text cannot disagree. */
interface CommandSpec {
	summary: string;
	usage: string;
	/** Prose rendered between Usage and Options (init explains itself first). */
	intro?: string;
	flags: readonly FlagSpec[];
	positionals: "globs" | "targetDir" | "migrate" | "none";
	/** Hand-written prose rendered after the Options section. */
	body: string;
}

const COMMANDS: Record<Subcommand, CommandSpec> = {
	build: {
		summary: "Generate CSS from source files",
		usage: "  rainbowindex <glob...> [options]\n  rainbowindex --css <file> [options]",
		flags: [OUTPUT, WATCH, MINIFY, CSS_INPUT],
		positionals: "globs",
		body: `Inputs:
  Pass one or more globs to scan for class names. If no globs are passed and
  a CSS file with @source directives is found, those are used instead.

Examples:
  rainbowindex "src/**/*.tsx" -o dist/styles.css
  rainbowindex "src/**/*.tsx" --watch -o dist/styles.css
  rainbowindex --css src/styles.css -o dist/styles.css --minify`,
	},
	init: {
		summary: "Wire Rainbow Index into the current Vite app",
		usage: "  rainbowindex init [options]",
		intro: `What this does:
  1. Installs rainbowindex as a dev dependency (if not already installed).
  2. Creates or patches vite.config.* to register the Vite plugin.
  3. Creates or updates a CSS entry file with @import "rainbowindex".
  4. Adds the CSS import to your entry file (src/main.tsx, src/main.ts, …).`,
		flags: [CSS_TARGET],
		positionals: "none",
		body: `Notes:
  Detects pnpm / yarn / bun / npm from lockfiles, package.json#packageManager,
  and npm_config_user_agent. Requires an existing Vite project — if you do not
  have one yet, use \`rainbowindex create <dir>\`.

Examples:
  rainbowindex init
  rainbowindex init --css src/styles.css`,
	},
	create: {
		summary: "Scaffold a Vite app with Rainbow Index ready",
		usage: "  rainbowindex create <dir> [options]",
		flags: [TEMPLATE, CSS_TARGET],
		positionals: "targetDir",
		body: `What this does:
  1. Runs \`create vite\` for the given template.
  2. Runs \`rainbowindex init\` inside the new directory.

Examples:
  rainbowindex create my-app
  rainbowindex create my-app --template vue-ts`,
	},
	migrate: {
		summary: "Translate a Tailwind v4 project into Rainbow Index directives",
		usage: "  rainbowindex migrate tailwind [glob...] [options]",
		intro: `What this does:
  1. Finds the Tailwind CSS entry and translates its @theme into directives.
  2. Adds @import "rainbowindex/tailwind.css" so the familiar class names
     keep resolving, and keeps your dark-mode strategy.
  3. Scans the globs you pass and reports every class the new theme rejects.
  4. Writes migration-report.md with what still needs a person.`,
		flags: [CSS_INPUT, WRITE],
		positionals: "migrate",
		body: `Safety:
  Nothing is overwritten without --write. By default the translated entry is
  written beside the original as <name>.rainbowindex.css so you can read it
  first. With --write, the original is kept as <name>.css.tailwind.bak.

Examples:
  rainbowindex migrate tailwind
  rainbowindex migrate tailwind "src/**/*.{ts,tsx}"
  rainbowindex migrate tailwind --css app/globals.css --write`,
	},
	"generate-types": {
		summary: "Generate TypeScript types for ri() autocomplete",
		usage: "  rainbowindex generate-types [options]",
		flags: [CSS_INPUT_TYPES, STRICT],
		positionals: "none",
		body: `Output:
  Writes \`rainbowindex-env.d.ts\` to the current working directory. Include it
  in tsconfig.json#include (or the equivalent) so the editor picks it up.

Examples:
  rainbowindex generate-types
  rainbowindex generate-types --strict --css src/styles.css`,
	},
	"generate-snapshot": {
		summary: "Generate a theme snapshot module so client ri() is theme-aware",
		usage: "  rainbowindex generate-snapshot [options]",
		flags: [CSS_INPUT_TYPES, SNAPSHOT_OUTPUT],
		positionals: "none",
		body: `Why:
  \`ri()\` asks the published theme whether \`text-lg\` is a size or a color. A
  browser bundle runs no compile, so without a published theme it guesses, and
  a size can be read as a color and dropped. The Vite plugin handles this on
  its own — this command is for every other bundler.

Output:
  Writes \`rainbowindex-snapshot.ts\` to the current working directory. Import
  it once, as early as possible in your entry point:

    import "./rainbowindex-snapshot";

  It also exports \`ri\` bound to that snapshot, for multi-tenant rendering.
  Re-run it when the theme changes; unchanged input rewrites nothing.

Examples:
  rainbowindex generate-snapshot
  rainbowindex generate-snapshot --css src/styles.css -o src/theme.ts`,
	},
	"generate-tokens": {
		summary: "Generate typed token exports and a W3C Design Tokens file",
		usage: "  rainbowindex generate-tokens [options]",
		flags: [CSS_INPUT_TYPES, TOKENS_OUTPUT],
		positionals: "none",
		body: `Why:
  A class is the right way to style an element and the wrong way to hand a
  chart library a series color or a canvas a fill. Those need the token's
  value. This writes the theme as data, so that code can read it without
  re-declaring the palette in JavaScript.

Output:
  \`rainbowindex-tokens.ts\` — \`tokens.color.brand[500]\`, typed \`as const\`, so a
  typo is a compile error and the editor completes the names. The values are
  \`var()\` references rather than literals, so they still follow the cascade.

  \`tokens.json\` beside it — the same theme in the W3C Design Tokens format,
  with values resolved to hex, which is what Style Dictionary and Figma
  importers read. A design tool has no cascade to resolve a \`var()\` against.

  Both are sorted and derived from the CSS entry alone, so re-running on an
  unchanged theme rewrites nothing.

Examples:
  rainbowindex generate-tokens
  rainbowindex generate-tokens --css src/styles.css -o src/tokens.ts`,
	},
	scan: {
		summary: "Show what the class scanner extracts (debugging)",
		usage: "  rainbowindex scan <file|glob...>",
		flags: [],
		positionals: "globs",
		body: `Output:
  One line per extracted class candidate, per file. Scanner warnings (skipped
  over-long lines, unreadable files) print to stderr with [RI-NNNN] codes.
  A class missing here was never seen by the scanner — check how it appears
  in the markup. A class listed here that still does not generate fails
  later — check the build warnings.

Examples:
  rainbowindex scan src/components/icons/logo.tsx
  rainbowindex scan "src/**/*.tsx"`,
	},
	"preload-fonts": {
		summary: 'Generate <link rel="preload"> tags',
		usage: "  rainbowindex preload-fonts [options]",
		flags: [CSS_INPUT_FONTS],
		positionals: "none",
		body: `Output:
  Prints <link rel="preload"> tags to stdout, one per @font face marked
  preload. Only local-file and raw-URL faces qualify — Google serves CSS, not
  the font binary, so a Google or system slot never produces a tag.

Examples:
  rainbowindex preload-fonts --css src/styles.css > preload.html`,
	},
};

/** Flag name → takes-a-value, unioned over every command. Value tokens must be
 *  skipped identically whether or not the flag is valid for the resolved
 *  command, so the command pre-scan and the "known under another command"
 *  error share this one map. */
const FLAG_TAKES_VALUE = new Map<string, boolean>();
for (const spec of Object.values(COMMANDS).flatMap((command) => command.flags)) {
	for (const name of spec.names) {
		FLAG_TAKES_VALUE.set(name, spec.valueName !== undefined);
	}
}

function asSubcommand(token: string): Subcommand | null {
	return Object.hasOwn(COMMANDS, token) ? (token as Subcommand) : null;
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
		write: false,
		subcommandExplicit: false,
		earlyExit: false,
	};

	// Resolve the command up front from the first non-flag token (or a legacy
	// --init/--create alias) so flags may appear on either side of the keyword.
	// A keyword after a positional is a positional for every command:
	// `rainbowindex "src/**" generate-types` scans a file literally named
	// generate-types instead of silently switching commands.
	let keywordIndex = -1;
	for (let j = 0; j < argv.length; j++) {
		const token = argv[j];
		if (token === "--init" || token === "--create") {
			opts.command = token.slice(2) as Subcommand;
			opts.subcommandExplicit = true;
			keywordIndex = j;
			break;
		}
		if (token.startsWith("-")) {
			if (FLAG_TAKES_VALUE.get(token)) j++;
			continue;
		}
		const command = asSubcommand(token);
		if (command) {
			opts.command = command;
			opts.subcommandExplicit = true;
			keywordIndex = j;
		}
		break;
	}

	const spec = COMMANDS[opts.command];
	for (let i = 0; i < argv.length; i++) {
		if (i === keywordIndex) continue;
		const arg = argv[i];

		if (arg === "--version" || arg === "-v" || arg === "--help" || arg === "-h") {
			// A keyword after the early-exit flag was never reached under the old
			// sequential parse — un-resolve it so `--help build` keeps the global
			// help while `build --help` shows build-specific help.
			if (keywordIndex > i) {
				opts.command = "build";
				opts.subcommandExplicit = false;
			}
			if (arg === "--version" || arg === "-v") {
				console.log(callbacks.getVersion());
			} else {
				callbacks.printHelp(opts.subcommandExplicit ? opts.command : undefined);
			}
			opts.earlyExit = true;
			return opts;
		}

		if (arg.startsWith("-")) {
			const flag = spec.flags.find((f) => f.names.includes(arg));
			if (flag) {
				if (flag.valueName !== undefined) {
					if (i + 1 >= argv.length) {
						throw new Error(`Missing value for ${arg}`);
					}
					flag.apply(opts, argv[++i]);
				} else {
					flag.apply(opts);
				}
				continue;
			}
			if (FLAG_TAKES_VALUE.has(arg)) {
				// Valid flag for a different command — error rather than silently
				// ignore it (e.g. `preload-fonts --watch` would be a no-op watcher).
				throw new Error(
					`${arg} is not supported by ${opts.command}. Run rainbowindex ${opts.command} --help for usage.`,
				);
			}
			throw new Error(`Unknown option "${arg}". Run rainbowindex --help for usage.`);
		}

		if (spec.positionals === "globs") {
			opts.globs.push(arg);
			continue;
		}
		if (spec.positionals === "targetDir" && !opts.targetDir) {
			opts.targetDir = arg;
			continue;
		}
		if (spec.positionals === "migrate") {
			// The first positional names the tool; everything after it is a glob
			// to check the migrated theme against.
			if (opts.migrateSource === undefined) opts.migrateSource = arg;
			else opts.globs.push(arg);
			continue;
		}
		throw new Error(`Unexpected extra argument "${arg}" for ${opts.command}.`);
	}

	if (opts.command === "migrate" && opts.migrateSource === undefined) {
		throw new Error(
			"migrate requires a source. The only one is `tailwind`: rainbowindex migrate tailwind",
		);
	}
	if (opts.command === "create" && !opts.targetDir) {
		throw new Error("create requires a project directory. Example: rainbowindex create my-app");
	}

	if (opts.command === "scan" && opts.globs.length === 0) {
		throw new Error(
			'scan requires at least one file or glob. Example: rainbowindex scan "src/**/*.tsx"',
		);
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

/** Column where flag descriptions start ("  " + names + padding). */
const HELP_DESCRIBE_COLUMN = 25;

function renderFlagLines(flags: readonly FlagSpec[]): string {
	const lines: string[] = [];
	for (const flag of flags) {
		const label = flag.helpLabel ?? flag.names.join(", ");
		const heading = `  ${label}${flag.valueName ? ` ${flag.valueName}` : ""}`;
		const [first, ...rest] = flag.describe.split("\n");
		lines.push(`${heading.padEnd(HELP_DESCRIBE_COLUMN)}${first}`);
		for (const continuation of rest) {
			lines.push(`${" ".repeat(HELP_DESCRIBE_COLUMN)}${continuation}`);
		}
	}
	return lines.join("\n");
}

const HELP_LINE = `${"  -h, --help".padEnd(HELP_DESCRIBE_COLUMN)}Show this help`;
const VERSION_LINE = `${"  -v, --version".padEnd(HELP_DESCRIBE_COLUMN)}Show version`;

/** Flags shown in the global help, in the historical order. Descriptions come
 *  from the same specs the per-command screens use, so they cannot drift. */
const GLOBAL_HELP_FLAGS: readonly FlagSpec[] = [OUTPUT, WATCH, MINIFY, CSS_INPUT, TEMPLATE, STRICT];

export function printHelp(subcommand?: Subcommand): void {
	if (subcommand) {
		const spec = COMMANDS[subcommand];
		const sections = [
			`🌈 rainbowindex ${subcommand} — ${spec.summary}`,
			`Usage:\n${spec.usage}`,
			...(spec.intro ? [spec.intro] : []),
			`Options:\n${[renderFlagLines(spec.flags), HELP_LINE].filter(Boolean).join("\n")}`,
			spec.body,
		];
		console.log(`\n${sections.join("\n\n")}\n`);
		return;
	}
	console.log(`
🌈 Rainbow Index CLI

Usage:
  rainbowindex <glob> [options]        Generate CSS from source files
  rainbowindex init                    Wire Rainbow Index into the current Vite app
  rainbowindex create <dir>            Scaffold a Vite app with Rainbow Index ready
  rainbowindex migrate tailwind        Translate a Tailwind v4 project into directives
  rainbowindex generate-types          Generate TypeScript types for ri()
  rainbowindex generate-snapshot       Generate the theme snapshot for client ri()
  rainbowindex generate-tokens         Generate typed token exports + tokens.json
  rainbowindex preload-fonts           Generate font preload link tags
  rainbowindex scan <file...>          Show what the class scanner extracts

Run \`rainbowindex <subcommand> --help\` for subcommand-specific options.

Options:
${renderFlagLines(GLOBAL_HELP_FLAGS)}
${VERSION_LINE}
${HELP_LINE}

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
