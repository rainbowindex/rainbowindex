import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ResolvedTheme } from "../directives/foundation.js";
import {
	extractDirectives,
	hasRIActivation,
	MAX_DIRECTIVE_INPUT_SIZE,
	resolveDirectives,
} from "../directives/index.js";

import { CSS_ENTRY_CANDIDATES } from "../project/css-entry.js";

export { CSS_ENTRY_CANDIDATES as CSS_CANDIDATES } from "../project/css-entry.js";

const MAX_CSS_FILE_SIZE = MAX_DIRECTIVE_INPUT_SIZE;

export async function findCSSFileAsync(cwd: string): Promise<string | null> {
	const candidates = CSS_ENTRY_CANDIDATES;
	const results = await Promise.all(
		candidates.map(async (candidate): Promise<string | null> => {
			const full = resolve(cwd, candidate);
			try {
				const fileSize = (await stat(full)).size;
				if (fileSize > MAX_CSS_FILE_SIZE) return null;
				const content = await readFile(full, "utf-8");
				return hasRIActivation(content) ? full : null;
			} catch (err: unknown) {
				if (
					err &&
					typeof err === "object" &&
					"code" in err &&
					(err as { code: string }).code === "ENOENT"
				) {
					return null;
				}
				console.warn(
					`[RI-1404] Could not read candidate CSS file "${full}" — ${err instanceof Error ? err.message : String(err)}`,
				);
				return null;
			}
		}),
	);
	return results.find((r) => r !== null) ?? null;
}

async function readCSSFileAsync(cssFile: string): Promise<string> {
	const fileSize = (await stat(cssFile)).size;
	if (fileSize > MAX_CSS_FILE_SIZE) {
		throw new Error(`CSS file "${cssFile}" exceeds ${MAX_CSS_FILE_SIZE / 1_048_576} MB limit.`);
	}
	const content = await readFile(cssFile, "utf-8");
	return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

/**
 * Resolve and read the CSS input for a subcommand. An explicit `--css` path
 * that does not exist is an error (RI-1605); failed auto-detection silently
 * yields an empty source so directive-less builds still work.
 */
export async function loadProjectCSS(
	opts: { cssFile?: string },
	cwd: string,
): Promise<{ css: string; cssFile: string | null }> {
	if (opts.cssFile) {
		const cssFile = resolve(cwd, opts.cssFile);
		if (!existsSync(cssFile)) {
			throw new Error(`[RI-1605] CSS input file not found: ${cssFile}`);
		}
		return { css: await readCSSFileAsync(cssFile), cssFile };
	}
	const cssFile = await findCSSFileAsync(cwd);
	if (!cssFile) return { css: "", cssFile: null };
	return { css: await readCSSFileAsync(cssFile), cssFile };
}

/**
 * Load the CSS input and resolve its directives to a theme, printing parse
 * warnings to stderr. Shared front half of `generate-types` / `preload-fonts`;
 * `build` routes warnings through the compilation pipeline instead.
 */
export async function loadProjectTheme(
	opts: { cssFile?: string },
	cwd: string,
): Promise<ResolvedTheme> {
	const { css } = await loadProjectCSS(opts, cwd);
	const parseWarnings: string[] = [];
	const directives = extractDirectives(css, parseWarnings);
	const theme = resolveDirectives(directives);
	for (const w of parseWarnings) console.error(w);
	return theme;
}
