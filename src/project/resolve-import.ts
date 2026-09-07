/**
 * Node resolver for `@import` inlining — the only IO half of the feature.
 *
 * Kept apart from `imports.ts` so the inliner itself stays importable from the
 * editor entry and from browser bundles. Nothing here is reachable from those:
 * only the CLI, the PostCSS plugin, and `compileProject` construct a resolver.
 *
 * Two specifier shapes resolve:
 *
 * - `./tokens.css`, `../shared/theme.css` — relative to the importing file, or
 *   to `cwd` for the entry when it has no path of its own.
 * - `pkg/preset.css` — through `require.resolve`, so a package's `exports` map
 *   decides, exactly as it would for JavaScript. That is what makes
 *   `@import "rainbowindex/tailwind.css"` work without knowing where the
 *   package lives.
 *
 * Everything else — remote URLs, site-root paths — is filtered out by the
 * inliner before it ever calls this.
 */

import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { MAX_DIRECTIVE_INPUT_SIZE } from "../directives/index.js";
import type { ImportResolution, ImportResolver } from "./imports.js";

/** Per-file ceiling. The inliner separately caps the total across all files. */
const MAX_IMPORT_FILE_SIZE = MAX_DIRECTIVE_INPUT_SIZE;

function readIfSmallEnough(path: string): ImportResolution | null {
	const size = statSync(path).size;
	if (size > MAX_IMPORT_FILE_SIZE) return null;
	const content = readFileSync(path, "utf8");
	// A BOM at the head of an inlined file would land mid-stylesheet, where the
	// directive tokenizer would read it as part of the first token.
	return { path, content: content.charCodeAt(0) === 0xfeff ? content.slice(1) : content };
}

/**
 * Build a resolver rooted at `cwd`. Failures — missing file, unreadable file,
 * an oversized one, a bare specifier no package provides — all return null, and
 * the inliner turns that into one RI-1041 naming the specifier.
 */
export function createNodeImportResolver(options: { cwd: string }): ImportResolver {
	return (specifier: string, from: string | undefined): ImportResolution | null => {
		try {
			if (specifier.startsWith("./") || specifier.startsWith("../")) {
				const base = from === undefined ? options.cwd : dirname(from);
				return readIfSmallEnough(resolvePath(base, specifier));
			}
			// createRequire needs a file to resolve *from*; the path need not
			// exist, only its directory, which is how a bare specifier finds the
			// nearest node_modules.
			const anchor = from ?? resolvePath(options.cwd, "__ri_import_anchor__.js");
			return readIfSmallEnough(createRequire(anchor).resolve(specifier));
		} catch {
			return null;
		}
	};
}
