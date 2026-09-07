/**
 * Finding a project's theme from inside a linter.
 *
 * A lint rule that knows what a class *means* needs the compiled theme, and a
 * linter gives it no build context — just a file and a working directory. So
 * this locates the CSS entry the way the editor toolkit does (the same
 * candidate list, the same activation test), reads it with the same `@import`
 * inliner a build uses, and hands back an `EditorSession`.
 *
 * One session is cached per resolved entry, because a lint run calls into it
 * once per file and rebuilding the theme each time would dominate the run. The
 * cache is invalidated by mtime — on the entry and on every file it imports —
 * so a watching linter picks up a token change without a restart.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { hasRIActivation } from "../../directives/activation.js";
import { createEditorSession, type EditorSession } from "../../editor/session.js";
import { CSS_ENTRY_CANDIDATES } from "../../project/css-entry.js";
import { createNodeImportResolver } from "../../project/resolve-import.js";

export interface ThemeSourceOptions {
	/**
	 * The project's CSS entry, absolute or relative to `cwd`. Set it when the
	 * entry is somewhere the candidate list does not look, or to skip the
	 * search entirely.
	 */
	css?: string;
	/** Where the search starts. Defaults to the linter's working directory. */
	cwd?: string;
}

/** The entry the candidate search settled on, or null when there is none. */
export function findCSSEntry(cwd: string): string | null {
	for (const candidate of CSS_ENTRY_CANDIDATES) {
		const path = resolvePath(cwd, candidate);
		if (!existsSync(path)) continue;
		// A stylesheet in the right place that activates nothing is somebody
		// else's; keep looking rather than compiling an empty theme from it.
		try {
			if (hasRIActivation(readFileSync(path, "utf8"))) return path;
		} catch {
			// Unreadable — treat as absent and try the next candidate.
		}
	}
	return null;
}

interface CachedSession {
	session: EditorSession;
	/** Entry plus every file it imports, with the mtime each was read at. */
	stamps: Map<string, number>;
}

const sessions = new Map<string, CachedSession>();

function mtimeOf(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		// A deleted import is a change like any other; a number no real mtime
		// can equal forces the rebuild that will report it.
		return -1;
	}
}

function stampsFor(session: EditorSession, entry: string): Map<string, number> {
	const stamps = new Map<string, number>([[entry, mtimeOf(entry)]]);
	for (const file of session.importedFiles) stamps.set(file, mtimeOf(file));
	return stamps;
}

function isStale(cached: CachedSession): boolean {
	for (const [path, stamp] of cached.stamps) {
		if (mtimeOf(path) !== stamp) return true;
	}
	return false;
}

/**
 * The session for a project, or null when no Rainbow Index entry was found.
 *
 * Returning null rather than throwing is the point: a rule that cannot find a
 * theme has nothing to say, and a linter run over a repository that does not
 * use Rainbow Index must stay silent rather than fail.
 */
export function getSession(options: ThemeSourceOptions = {}): EditorSession | null {
	const cwd = options.cwd ?? process.cwd();
	const entry = options.css
		? isAbsolute(options.css)
			? options.css
			: resolvePath(cwd, options.css)
		: findCSSEntry(cwd);
	if (entry === null) return null;

	const cached = sessions.get(entry);
	if (cached && !isStale(cached)) return cached.session;

	let css: string;
	try {
		css = readFileSync(entry, "utf8");
	} catch {
		sessions.delete(entry);
		return null;
	}
	const session = createEditorSession({
		css,
		cssPath: entry,
		resolveImport: createNodeImportResolver({ cwd }),
	});
	// Reading `importedFiles` forces the analysis, which is what fills it.
	sessions.set(entry, { session, stamps: stampsFor(session, entry) });
	return session;
}

/** Drop every cached session. For tests, and for a host that knows better. */
export function clearSessionCache(): void {
	sessions.clear();
}
