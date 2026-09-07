/**
 * `@import` inlining for the directive analyzer.
 *
 * The analyzer reads directives out of one CSS string. Until an import is
 * inlined, a `@color` block living in `./tokens.css` — or in a preset shipped
 * by a package — is invisible to it: only the Vite path ever saw imported
 * text, because Vite resolves CSS imports before PostCSS plugins run.
 *
 * This module closes that gap for every other surface. It is deliberately
 * IO-free: the caller supplies a resolver, so the same code serves the CLI
 * (filesystem), the PostCSS plugin (filesystem), and an editor host (its own
 * open-document map) without any of them dragging `node:fs` into a browser
 * bundle. `resolve-import.ts` holds the Node resolver.
 *
 * What is replaced, and what is left alone:
 *
 * - `@import "./tokens.css";` and `@import "pkg/preset.css";` — inlined.
 * - `@import "rainbowindex";` — left in place at the entry, since that is what
 *   activates the compiler; dropped inside an imported file, so a preset that
 *   imports the package cannot activate it twice. `rainbowindex/tailwind.css`
 *   activates too, but it is a stylesheet of directives rather than a marker,
 *   so it is inlined like any other package preset.
 * - `@import url("https://…")`, `@import "/site.css"` — left alone. Those are
 *   URLs for the browser to fetch, not files on disk.
 * - `@import "a.css" screen;`, `… layer(x);`, `… supports(…);` — left alone
 *   and warned (RI-1045). Their contents apply conditionally, and directives
 *   have no conditional form, so silently hoisting them would be a lie.
 *
 * Inlining is for READING. Whether the inlined text is also emitted is the
 * caller's business: the PostCSS plugin builds its output from the AST, so
 * nothing is duplicated there, while the CLI and `compileProject` join the
 * inlined user CSS into their output once, in import order.
 *
 * One thing the inliner changes rather than copies: comments inside a PACKAGE
 * import are dropped, and comments in the project's own files are not. A
 * package's stylesheet is consumed as CSS, and its notes are addressed to
 * whoever opens that package — the Tailwind preset alone was contributing
 * 4.3 KB of section headings to every unminified build. Package-ness is
 * inherited down the subtree, so a package's own relative imports are stripped
 * too. See `stripCSSComments` and docs/preset-protocol.md.
 */

import {
	readImportTarget,
	RI_MARKER_IMPORT_SPECIFIERS,
	scanAtRules,
} from "../directives/activation.js";
import { MAX_DIRECTIVE_INPUT_SIZE } from "../directives/index.js";
import { stripCSSComments } from "../css/strip.js";

/** A file the resolver found: its identity, and its text. */
export interface ImportResolution {
	/**
	 * Identity of the resolved file — an absolute path for the Node resolver.
	 * Used for cycle detection and as the base for the file's own imports, so
	 * it must be stable: the same file has to produce the same string.
	 */
	path: string;
	content: string;
}

/**
 * Turn an `@import` specifier into a file, or null when it cannot be found.
 * `from` is the identity of the importing file, or undefined at the entry.
 */
export type ImportResolver = (
	specifier: string,
	from: string | undefined,
) => ImportResolution | null;

export interface InlineImportsOptions {
	resolve: ImportResolver;
	/** Identity of the CSS being inlined, so its relative imports resolve. */
	from?: string;
	/** How deep the import graph may nest before RI-1043. */
	maxDepth?: number;
	/** Ceiling on total inlined bytes before RI-1044. */
	maxBytes?: number;
}

export interface InlineImportsResult {
	css: string;
	warnings: string[];
	/**
	 * Every file inlined, in first-visit order. A watcher adds these to what it
	 * watches; without them, editing an imported token file changes nothing.
	 */
	files: string[];
}

/** Nesting cap. Eight is far past any real design-system layering. */
const DEFAULT_MAX_DEPTH = 8;

/**
 * Only the marker imports. An activation specifier that is itself a stylesheet
 * — `rainbowindex/tailwind.css` — must fall through to the resolver instead,
 * or its directives never reach the analyzer.
 */
const RI_MARKER_TARGETS = new Set<string>(RI_MARKER_IMPORT_SPECIFIERS);

/** Targets the browser fetches. Inlining these would need the network. */
function isRemoteTarget(target: string): boolean {
	return (
		target.startsWith("//") ||
		/^[a-z][a-z0-9+.-]*:/i.test(target) ||
		// A leading "/" is a URL path relative to the site root, not a file path.
		target.startsWith("/")
	);
}

/**
 * Index just past the `;` that ends a statement at-rule starting at `from`.
 * Returns -1 when a `{` arrives first, which means this is a block at-rule and
 * not an import we should touch. Strings, comments, and parens are skipped, so
 * `url(a;b.css)` does not end the statement early.
 */
function findStatementEnd(src: string, from: number): number {
	let i = from;
	let depth = 0;
	while (i < src.length) {
		const ch = src[i];
		if (ch === "/" && src[i + 1] === "*") {
			const end = src.indexOf("*/", i + 2);
			i = end === -1 ? src.length : end + 2;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const quote = ch;
			i++;
			while (i < src.length && src[i] !== quote) {
				if (src[i] === "\\") i++;
				i++;
			}
			i++;
			continue;
		}
		if (ch === "(") {
			depth++;
			i++;
			continue;
		}
		if (ch === ")") {
			if (depth > 0) depth--;
			i++;
			continue;
		}
		if (depth === 0) {
			if (ch === ";") return i + 1;
			if (ch === "{") return -1;
		}
		i++;
	}
	return src.length;
}

interface InlineContext {
	resolve: ImportResolver;
	maxDepth: number;
	maxBytes: number;
	warnings: string[];
	files: string[];
	/** Files on the current import chain — a repeat here is a true cycle. */
	stack: Set<string>;
	/** Files already inlined anywhere, so a diamond is read once, not twice. */
	visited: Set<string>;
	bytes: number;
	/** Set once the byte budget is spent; stops further resolution attempts. */
	exhausted: boolean;
}

/** One replacement to splice into the text: [start, end) becomes `text`. */
interface Edit {
	start: number;
	end: number;
	text: string;
}

/**
 * A package specifier, as opposed to one of the project's own files.
 *
 * `isRemoteTarget` has already taken everything with a scheme and everything
 * rooted at `/`, so the only remaining distinction is the leading dot. What
 * hangs on it is comment stripping — see `stripCSSComments`.
 */
function isPackageSpecifier(target: string): boolean {
	return !target.startsWith(".");
}

function inlineInto(
	css: string,
	from: string | undefined,
	depth: number,
	ctx: InlineContext,
	inPackage: boolean,
): string {
	const edits: Edit[] = [];

	scanAtRules(css, (name, atPos, nameEnd) => {
		if (name !== "import") return undefined;
		const stmtEnd = findStatementEnd(css, nameEnd);
		if (stmtEnd === -1) return undefined;
		const { target, nextIndex } = readImportTarget(css, nameEnd);
		if (target === null) return stmtEnd;

		// Anything after the target — a media query, layer(), supports() — makes
		// the import conditional.
		const preludeEnd = css[stmtEnd - 1] === ";" ? stmtEnd - 1 : stmtEnd;
		const tail = css.slice(Math.min(nextIndex, preludeEnd), preludeEnd).trim();

		if (RI_MARKER_TARGETS.has(target)) {
			// The entry's own activation import stays; a nested one is redundant
			// and would activate a second time.
			if (depth > 0) edits.push({ start: atPos, end: stmtEnd, text: "" });
			return stmtEnd;
		}
		if (isRemoteTarget(target)) return stmtEnd;

		if (tail !== "") {
			ctx.warnings.push(
				`[RI-1045] Conditional @import "${target}" (${tail}) was left in place; directives inside it are not read. Move the directives to an unconditional @import.`,
			);
			return stmtEnd;
		}
		if (ctx.exhausted) return stmtEnd;

		if (depth >= ctx.maxDepth) {
			ctx.warnings.push(
				`[RI-1043] @import "${target}" nests deeper than ${ctx.maxDepth} levels and was left in place. Flatten the import chain.`,
			);
			return stmtEnd;
		}

		const resolved = ctx.resolve(target, from);
		if (resolved === null) {
			ctx.warnings.push(
				`[RI-1041] Could not resolve @import "${target}"${from ? ` from "${from}"` : ""}. The at-rule was left in place and its directives were not read. Check the path, or install the package.`,
			);
			return stmtEnd;
		}
		if (ctx.stack.has(resolved.path)) {
			ctx.warnings.push(
				`[RI-1042] Circular @import "${target}" — "${resolved.path}" already imports the file importing it. The repeat was dropped.`,
			);
			edits.push({ start: atPos, end: stmtEnd, text: "" });
			return stmtEnd;
		}
		// A file reached twice by different paths is read once. Reading it again
		// would duplicate its declarations in the CLI's emitted user CSS.
		if (ctx.visited.has(resolved.path)) {
			edits.push({ start: atPos, end: stmtEnd, text: "" });
			return stmtEnd;
		}
		if (ctx.bytes + resolved.content.length > ctx.maxBytes) {
			ctx.exhausted = true;
			ctx.warnings.push(
				`[RI-1044] Inlined @import files exceed the ${ctx.maxBytes / 1_048_576} MB limit at "${target}". It and any later import were left in place. Split the stylesheet.`,
			);
			return stmtEnd;
		}

		ctx.visited.add(resolved.path);
		ctx.files.push(resolved.path);
		ctx.bytes += resolved.content.length;
		ctx.stack.add(resolved.path);
		// Package-ness is inherited: a package's own relative imports are still
		// that package's files, so the whole subtree below the boundary is
		// stripped.
		//
		// The inheritance is about doing it ONCE, not about the result. The
		// outermost boundary strips the whole assembled subtree and
		// `stripCSSComments` is idempotent, so dropping `inPackage` and judging
		// every hop on its own specifier produces byte-identical output — it just
		// re-strips already-stripped text once per nested package. Recorded
		// because that mutation survives the suite, and no input distinguishes
		// the two; a test asserting otherwise would be asserting nothing.
		const entersPackage = !inPackage && isPackageSpecifier(target);
		const text = inlineInto(
			resolved.content,
			resolved.path,
			depth + 1,
			ctx,
			inPackage || entersPackage,
		);
		ctx.stack.delete(resolved.path);
		edits.push({ start: atPos, end: stmtEnd, text: entersPackage ? stripCSSComments(text) : text });
		return stmtEnd;
	});

	if (edits.length === 0) return css;
	// scanAtRules walks forward, so edits are already in ascending order.
	let out = "";
	let cursor = 0;
	for (const edit of edits) {
		out += css.slice(cursor, edit.start) + edit.text;
		cursor = edit.end;
	}
	return out + css.slice(cursor);
}

/**
 * Replace resolvable `@import` at-rules with the text they name, recursively,
 * so the directive analyzer sees one stylesheet.
 *
 * Returns the input unchanged when there is nothing to inline, which keeps the
 * analyzer's single-entry memo hitting on repeat builds.
 */
export function inlineDirectiveImports(
	css: string,
	options: InlineImportsOptions,
): InlineImportsResult {
	const ctx: InlineContext = {
		resolve: options.resolve,
		maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
		maxBytes: options.maxBytes ?? MAX_DIRECTIVE_INPUT_SIZE,
		warnings: [],
		files: [],
		stack: new Set(options.from === undefined ? [] : [options.from]),
		visited: new Set(options.from === undefined ? [] : [options.from]),
		bytes: 0,
		exhausted: false,
	};
	const out = inlineInto(css, options.from, 0, ctx, false);
	return { css: out, warnings: ctx.warnings, files: ctx.files };
}
