/**
 * `rainbowindex migrate tailwind` — the IO half of the migrator.
 *
 * The translation is in `src/migrate/tailwind.ts` and touches no files. This
 * finds the entry, runs it, checks the result against the project's own class
 * names, and writes the report.
 *
 * **It does not overwrite anything unless asked.** The default is a dry run
 * that writes `migration-report.md` and prints a summary; `--write` applies the
 * change and keeps the original beside it. A migration you cannot read before
 * it happens is one nobody runs on a repository they care about.
 */

import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createClassInspector } from "../engine/inspector.js";
import { detectTailwind, migrateTailwindCSS, type ManualStep } from "../migrate/tailwind.js";
import { outermostCandidates } from "../editor/candidates.js";
import { inlineDirectiveImports } from "../project/imports.js";
import { analyzeProjectCSS } from "../project/analyze.js";
import { createNodeImportResolver } from "../project/resolve-import.js";
import { extractClassCandidates } from "../scanner/class-extraction.js";
import { resolveSourceFilesAsync } from "../scanner/sources.js";
import { writeFileAtomic } from "./atomic-write.js";
import type { CLIOptions } from "./args.js";

/** Where the migrator looks for the project's Tailwind entry. */
const ENTRY_CANDIDATES = [
	"src/index.css",
	"src/style.css",
	"src/styles.css",
	"src/app.css",
	"src/global.css",
	"src/globals.css",
	"app/globals.css",
	"styles/globals.css",
	"index.css",
	"style.css",
	"styles.css",
	"app.css",
	"global.css",
];

export interface MigrateResult {
	/** Exit code: non-zero when there is nothing to migrate. */
	code: number;
	/** What the terminal should show. */
	summary: string;
	/** Files written, relative to cwd. */
	written: string[];
}

function readJSON(path: string): Record<string, unknown> | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/** The Tailwind entry: the explicit `--css`, or the first candidate that has one. */
function findEntry(cwd: string, explicit?: string): string | null {
	if (explicit) {
		const path = resolve(cwd, explicit);
		return readFileSync(path, "utf8") ? path : null;
	}
	for (const candidate of ENTRY_CANDIDATES) {
		const path = resolve(cwd, candidate);
		let css: string;
		try {
			css = readFileSync(path, "utf8");
		} catch {
			continue;
		}
		if (detectTailwind({ css }).isTailwind) return path;
	}
	return null;
}

/**
 * Class names a person actually wrote, across the given globs.
 *
 * Not `collectProjectClasses`: the build path over-collects on purpose, and a
 * migration report that lists `export` and `const` as classes that "do not
 * resolve" is a report nobody reads twice. `outermostCandidates` plus the
 * authored origins is the same filter the lint rules use, and it is the one
 * that answers "did the migration break something you wrote".
 */
async function scanAuthoredClasses(
	globs: readonly string[],
	cwd: string,
): Promise<{ classes: Set<string>; files: string[] }> {
	if (globs.length === 0) return { classes: new Set(), files: [] };
	const { files } = await resolveSourceFilesAsync(
		globs.map((pattern) => ({ pattern, negated: false, inline: false, absolute: false })),
		cwd,
	);
	const classes = new Set<string>();
	for (const file of files) {
		let content: string;
		try {
			content = await readFile(file, "utf8");
		} catch {
			continue;
		}
		for (const candidate of outermostCandidates(extractClassCandidates({ content, path: file }))) {
			if (AUTHORED_ORIGINS.has(candidate.origin)) classes.add(candidate.value);
		}
	}
	return { classes, files };
}

/** Origins that mean "someone typed this in a class position". */
const AUTHORED_ORIGINS: ReadonlySet<string> = new Set(["attribute", "helper", "safelist"]);

function bullet(step: ManualStep): string {
	return `- \`${step.found}\`\n  - ${step.reason}${step.action ? `\n  - ${step.action}` : ""}`;
}

export async function migrateProject(opts: CLIOptions, cwd: string): Promise<MigrateResult> {
	const source = opts.migrateSource ?? "tailwind";
	if (source !== "tailwind") {
		return {
			code: 1,
			summary: `Unknown migration source "${source}". The only one is \`tailwind\`.`,
			written: [],
		};
	}

	const entry = findEntry(cwd, opts.cssFile);
	if (entry === null) {
		return {
			code: 1,
			summary:
				'No Tailwind CSS entry found. Looked for a stylesheet with `@import "tailwindcss"` ' +
				`or \`@theme\` at: ${ENTRY_CANDIDATES.join(", ")}.\n` +
				"Point at it with --css <file>.",
			written: [],
		};
	}

	const original = readFileSync(entry, "utf8");
	const detection = detectTailwind({
		css: original,
		packageJson: readJSON(join(cwd, "package.json")) as never,
		files: readdirSync(cwd, { withFileTypes: true })
			.filter((e) => e.isFile())
			.map((e) => e.name),
	});
	if (!detection.isTailwind) {
		return {
			code: 1,
			summary: `${relative(cwd, entry)} does not look like a Tailwind v4 entry — no \`@import "tailwindcss"\`, no \`@theme\`, and no Tailwind package.`,
			written: [],
		};
	}

	const result = migrateTailwindCSS(original);

	// The preset carries Tailwind's own scales, and without it every `text-sm`
	// and `shadow-md` in the project reads as unresolved — a report that would
	// be alarming and wrong. It resolves through the consumer's installed
	// package, which may not be installed yet at migration time, so a failure
	// here is reported rather than silently counted against the migration.
	const inlined = inlineDirectiveImports(result.css, {
		resolve: createNodeImportResolver({ cwd }),
		from: entry,
	});
	const presetResolved = inlined.css !== result.css;
	const analysis = analyzeProjectCSS(inlined.css);
	const inspector = createClassInspector(analysis.theme);

	const { classes: authored, files } = await scanAuthoredClasses(opts.globs, cwd);
	const rejected = new Map<string, string[]>();
	if (presetResolved) {
		for (const className of authored) {
			const validation = inspector.validate(className);
			if (validation.ok) continue;
			const bucket = rejected.get(validation.reason) ?? [];
			bucket.push(className);
			rejected.set(validation.reason, bucket);
		}
	}

	const outPath = join(dirname(entry), `${basename(entry, ".css")}.rainbowindex.css`);
	const reportPath = join(cwd, "migration-report.md");
	const report = buildReport({
		entry: relative(cwd, entry),
		detection,
		result,
		rejected,
		scanned: authored.size,
		files: files.length,
		presetResolved,
	});

	const written: string[] = [];
	if (opts.write) {
		await writeFileAtomic(`${entry}.tailwind.bak`, original);
		await writeFileAtomic(entry, result.css);
		written.push(relative(cwd, `${entry}.tailwind.bak`), relative(cwd, entry));
	} else {
		await writeFileAtomic(outPath, result.css);
		written.push(relative(cwd, outPath));
	}
	await writeFileAtomic(reportPath, report);
	written.push(relative(cwd, reportPath));

	const tokens = result.translated.reduce((n, t) => n + t.entries, 0);
	const summary = [
		`Migrated ${relative(cwd, entry)} — ${tokens} tokens across ${result.translated.length} directives.`,
		result.darkVariant === "selector" ? "  dark: kept on the .dark class." : null,
		result.manual.length === 1
			? "  1 thing needs a person."
			: `  ${result.manual.length} things need a person.`,
		!presetResolved
			? "  Could not resolve rainbowindex/tailwind.css — install the package to have\n  your classes checked against the migrated theme."
			: rejected.size > 0
				? `  ${[...rejected.values()].flat().length} of ${authored.size} classes in your source do not resolve.`
				: authored.size > 0
					? `  All ${authored.size} classes in your source resolve.`
					: null,
		"",
		...written.map((file) => `  wrote ${file}`),
		"",
		opts.write
			? "Applied. The original is beside it as *.css.tailwind.bak."
			: "Nothing was overwritten. Re-run with --write to apply.",
	]
		.filter((line): line is string => line !== null)
		.join("\n");

	return { code: 0, summary, written };
}

function buildReport(input: {
	entry: string;
	detection: ReturnType<typeof detectTailwind>;
	result: ReturnType<typeof migrateTailwindCSS>;
	rejected: Map<string, string[]>;
	scanned: number;
	files: number;
	presetResolved: boolean;
}): string {
	const { entry, detection, result, rejected, scanned } = input;
	const lines: string[] = [
		"# Tailwind → Rainbow Index",
		"",
		`Entry: \`${entry}\``,
		`Detected by: ${detection.signals.map((s) => `\`${s}\``).join(", ")}`,
		"",
	];

	if (detection.legacyConfig) {
		lines.push(
			"> [!WARNING]",
			`> \`${detection.legacyConfig}\` is a Tailwind v3 JavaScript config. It was **not** read.`,
			"> Anything defined only there has to be moved into the CSS entry by hand.",
			"",
		);
	}

	lines.push("## Translated", "", "| Directive | Tokens |", "| --- | --- |");
	for (const { directive, entries } of result.translated) {
		lines.push(`| \`${directive}\` | ${entries} |`);
	}
	lines.push("");

	if (result.darkVariant !== null) {
		lines.push(
			"## Dark mode",
			"",
			result.darkVariant === "selector"
				? "Your `dark` custom variant used a class, so the theme now says\n`@color dark { variant: selector(.dark); }` — `dark:` and the colour tokens\nboth follow `.dark`, as they did."
				: "Your `dark` custom variant used `prefers-color-scheme`, which is already the\ndefault here. Nothing was added.",
			"",
		);
	}

	lines.push("## Needs a person", "");
	if (result.manual.length === 0) {
		lines.push("Nothing. Every construct in the entry had a counterpart.", "");
	} else {
		lines.push(...result.manual.map(bullet), "");
	}

	lines.push("## Classes in your source", "");
	if (!input.presetResolved) {
		lines.push(
			"> [!NOTE]",
			"> `rainbowindex/tailwind.css` could not be resolved, so this check was",
			"> skipped. Install the package (`pnpm add -D rainbowindex`) and re-run —",
			"> without the preset every class from Tailwind's own scales would read as",
			"> unresolved, which would be alarming and wrong.",
			"",
		);
	} else if (scanned === 0) {
		lines.push(
			'No source files were scanned. Pass globs — `rainbowindex migrate tailwind "src/**/*.tsx"`',
			"— to have every class checked against the migrated theme.",
			"",
		);
	} else if (rejected.size === 0) {
		lines.push(`All ${scanned} classes found in your source resolve against the new theme.`, "");
	} else {
		const total = [...rejected.values()].flat().length;
		lines.push(
			`${total} of ${scanned} classes across ${input.files} file${input.files === 1 ? "" : "s"} do not resolve. Grouped by why:`,
			"",
			...[...rejected].map(
				([reason, classes]) =>
					`### ${reason} (${classes.length})\n\n${classes
						.slice(0, 40)
						.map((c) => `- \`${c}\``)
						.join("\n")}${classes.length > 40 ? `\n- …and ${classes.length - 40} more` : ""}`,
			),
			"",
		);
	}

	lines.push(
		"## Differences to expect",
		"",
		"These are by design, not migration defects:",
		"",
		"- **Directional utilities emit logical properties.** `pl-4` is",
		"  `padding-inline-start`, not `padding-left`. Identical in LTR; mirrored in RTL.",
		"- **`opacity-50` emits `50%`**, where Tailwind emits `0.5`. Same rendering.",
		"- **Colour tokens are one `light-dark()` declaration**, not a `:root` block plus",
		"  a `.dark` block. See [theming.md](https://rainbowindex.dev/theming).",
		"- **Only what you name exists.** The preset import restores Tailwind's scales;",
		"  drop it and the theme is exactly your own directives.",
		"",
	);

	return `${lines.join("\n")}\n`;
}
