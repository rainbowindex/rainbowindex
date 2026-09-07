/**
 * Two lint rules over the editor API, in the shape both Oxlint and ESLint read.
 *
 * Neither rule walks the AST for class positions, and that is deliberate. The
 * scanner already decides what a class position is — a `class`/`className`
 * attribute, an argument to a class helper, a `cva`/`tv` config, a safelist —
 * and a rule that re-derived that from the AST would drift from the compiler
 * it is supposed to be describing. So both rules run once per file over the
 * source text, take the scanner's own candidates with their exact spans, and
 * report on those. A class the build compiles and a class the linter checks are
 * then the same set by construction.
 *
 * The rule objects use only the slice of the linter API the two hosts share:
 * `create(context)`, `context.report({ message, node, loc })`, and a visitor
 * keyed by node type. ESLint suggestions are attached where the host supports
 * them, and ignored where it does not.
 */

import { outermostCandidates } from "../../editor/candidates.js";
import type { ClassCandidate } from "../../scanner/class-extraction.js";
import { extractClassCandidates } from "../../scanner/class-extraction.js";
import { isSourceFile } from "../../scanner/source-files.js";
import { getSession, type ThemeSourceOptions } from "./theme.js";

// ---------------------------------------------------------------------------
// The slice of the linter API these rules use
// ---------------------------------------------------------------------------

export interface LintPosition {
	line: number;
	column: number;
}

export interface LintLoc {
	start: LintPosition;
	end: LintPosition;
}

export interface LintFix {
	range: [number, number];
	text: string;
}

export interface LintFixer {
	replaceTextRange(range: [number, number], text: string): LintFix;
}

export interface LintSuggestion {
	desc: string;
	fix(fixer: LintFixer): LintFix;
}

export interface LintReport {
	message: string;
	node?: unknown;
	loc?: LintLoc;
	suggest?: LintSuggestion[];
}

export interface LintSourceCode {
	getText(): string;
	getLocFromIndex(index: number): LintPosition;
}

export interface LintContext {
	report(report: LintReport): void;
	/** ESLint ≥ 8.40 and Oxlint both expose this; older ESLint used a getter. */
	sourceCode?: LintSourceCode;
	getSourceCode?(): LintSourceCode;
	filename?: string;
	getFilename?(): string;
	options?: readonly unknown[];
	cwd?: string;
}

/** Node type → handler. A rule with nothing to do returns an empty one. */
export type LintVisitor = Partial<Record<string, (node: unknown) => void>>;

export interface LintRule {
	meta: {
		type: "problem" | "suggestion";
		docs: { description: string };
		hasSuggestions?: boolean;
		schema?: readonly unknown[];
	};
	create(context: LintContext): LintVisitor;
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function sourceCodeOf(context: LintContext): LintSourceCode | null {
	return context.sourceCode ?? context.getSourceCode?.() ?? null;
}

/**
 * The path handed to the scanner, which picks its extractor from the
 * extension: `.html` reads markup, `.vue`/`.svelte`/`.astro` read both halves,
 * everything else reads JS with JSX.
 *
 * A linter does not always have a real path. ESLint's RuleTester reports
 * `<input>`, `--stdin` reports `<text>`, and an editor's unsaved buffer can
 * report anything. An unrecognized extension would silently extract nothing,
 * which is the worst failure a lint rule can have — clean output, no coverage.
 * So an unrecognized name is linted as `.tsx`: the superset grammar, and what
 * a JS linter is looking at whenever it does not say otherwise.
 */
function scanPathFor(context: LintContext): string {
	const filename = context.filename ?? context.getFilename?.() ?? "<input>";
	return isSourceFile(filename) ? filename : `${filename}.tsx`;
}

function optionsOf(context: LintContext): ThemeSourceOptions {
	const first = context.options?.[0];
	const options: ThemeSourceOptions =
		first && typeof first === "object" ? { ...(first as ThemeSourceOptions) } : {};
	options.cwd ??= context.cwd ?? process.cwd();
	return options;
}

/**
 * Origins that mean "a person put a class here". The scanner also reports
 * bare identifiers and prose it could not rule out, which are the right thing
 * to compile (over-collecting is free) and the wrong thing to lint: a word in
 * a paragraph is not a misspelled utility.
 */
const AUTHORED_ORIGINS: ReadonlySet<string> = new Set(["attribute", "helper", "safelist"]);

function authoredCandidates(source: string, path: string): ClassCandidate[] {
	// `outermostCandidates` first, then the origin filter: the fragments the JS
	// lexer emits around each `:` carry the same origin as the class they sit
	// inside, so filtering by origin alone would keep every one of them and
	// report `sm` in `sm:flex` as an unknown utility.
	return outermostCandidates(extractClassCandidates({ content: source, path })).filter(
		(candidate) => AUTHORED_ORIGINS.has(candidate.origin),
	);
}

function locOf(sourceCode: LintSourceCode, candidate: ClassCandidate): LintLoc {
	return {
		start: sourceCode.getLocFromIndex(candidate.start),
		end: sourceCode.getLocFromIndex(candidate.end),
	};
}

/** The `schema` both hosts read for the shared `{ css, cwd }` option. */
const THEME_OPTION_SCHEMA = [
	{
		type: "object",
		properties: { css: { type: "string" }, cwd: { type: "string" } },
		additionalProperties: false,
	},
] as const;

// ---------------------------------------------------------------------------
// no-unknown-class
// ---------------------------------------------------------------------------

export const noUnknownClassRule: LintRule = {
	meta: {
		type: "problem",
		docs: {
			description: "Every class in a class position must compile against the project theme.",
		},
		hasSuggestions: true,
		schema: THEME_OPTION_SCHEMA,
	},
	create(context) {
		const sourceCode = sourceCodeOf(context);
		if (sourceCode === null) return {};
		const session = getSession(optionsOf(context));
		if (session === null) return {};

		return {
			Program(node: unknown): void {
				const text = sourceCode.getText();
				for (const candidate of authoredCandidates(text, scanPathFor(context))) {
					const result = session.inspector.validate(candidate.value);
					if (result.ok) continue;

					const detail =
						result.reason === "unknown-variant"
							? `Unknown variant "${result.offender}"`
							: result.reason === "invalid-arbitrary"
								? `Invalid arbitrary value in "${result.offender}"`
								: `Unknown utility "${result.offender}"`;
					const hint = result.suggestion ? ` Did you mean "${result.suggestion}"?` : "";

					context.report({
						message: `${detail} — "${candidate.value}" compiles to nothing.${hint}`,
						node,
						loc: locOf(sourceCode, candidate),
						suggest: suggestionFor(text, candidate, result.offender, result.suggestion),
					});
				}
			},
		};
	},
};

/**
 * A rename suggestion, when the source can be edited without guessing.
 *
 * `validate` names the failing *fragment*, not the whole class: for
 * `hover:felx` the offender is `felx`. Replacing the class's whole span would
 * drop the variant, so the fix rewrites the offender in place — and only when
 * it occurs exactly once in the span, so `p-px-px` never gets a fix that lands
 * on the wrong half.
 */
function suggestionFor(
	text: string,
	candidate: ClassCandidate,
	offender: string,
	suggestion: string | undefined,
): LintSuggestion[] | undefined {
	if (suggestion === undefined) return undefined;
	const slice = text.slice(candidate.start, candidate.end);
	const at = slice.indexOf(offender);
	if (at === -1 || slice.indexOf(offender, at + 1) !== -1) return undefined;
	const range: [number, number] = [candidate.start + at, candidate.start + at + offender.length];
	return [
		{
			desc: `Replace "${offender}" with "${suggestion}"`,
			fix: (fixer) => fixer.replaceTextRange(range, suggestion),
		},
	];
}

// ---------------------------------------------------------------------------
// no-conflicting-classes
// ---------------------------------------------------------------------------

/**
 * Split candidates into the runs that share one class string.
 *
 * Conflicts only matter *within* one literal. `ri("px-2", override)` is the
 * whole point of the function — the second argument is meant to win — while
 * `ri("px-2 px-4")` is someone who did not notice. The discriminator is in the
 * source text: two candidates belong to the same string exactly when nothing
 * but whitespace separates them. That holds for a class attribute, a template
 * literal and a helper argument alike, and needs no AST.
 */
function classRuns(text: string, candidates: readonly ClassCandidate[]): ClassCandidate[][] {
	const runs: ClassCandidate[][] = [];
	let current: ClassCandidate[] = [];
	let previousEnd = -1;
	for (const candidate of candidates) {
		const gap = previousEnd === -1 ? null : text.slice(previousEnd, candidate.start);
		if (gap !== null && gap.trim() === "") {
			current.push(candidate);
		} else {
			if (current.length > 0) runs.push(current);
			current = [candidate];
		}
		previousEnd = candidate.end;
	}
	if (current.length > 0) runs.push(current);
	return runs;
}

export const noConflictingClassesRule: LintRule = {
	meta: {
		type: "problem",
		docs: {
			description: "One class string must not contain classes that override each other.",
		},
		schema: THEME_OPTION_SCHEMA,
	},
	create(context) {
		const sourceCode = sourceCodeOf(context);
		if (sourceCode === null) return {};
		const session = getSession(optionsOf(context));
		if (session === null) return {};

		return {
			Program(node: unknown): void {
				const text = sourceCode.getText();
				for (const run of classRuns(text, authoredCandidates(text, scanPathFor(context)))) {
					if (run.length < 2) continue;
					const analysis = session.analyzeMerge(run.map((candidate) => candidate.value));
					for (const drop of analysis.dropped) {
						const winners = drop.overriddenBy
							.map((index) => `"${run[index]?.value ?? "?"}"`)
							.join(", ");
						context.report({
							message: `"${drop.className}" is overridden by ${winners} in the same class string, so it has no effect.`,
							node,
							loc: locOf(sourceCode, run[drop.index]),
						});
					}
				}
			},
		};
	},
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** The rules both entry points expose, under the names both hosts use. */
export const rules: Readonly<Record<string, LintRule>> = Object.freeze({
	"no-unknown-class": noUnknownClassRule,
	"no-conflicting-classes": noConflictingClassesRule,
});
