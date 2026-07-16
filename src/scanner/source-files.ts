/**
 * Lightweight source-file detection — no heavy dependencies (tinyglobby, etc.).
 * Kept separate so the Vite integration can import it without pulling in
 * Node-only glob machinery into browser bundles.
 */

const SOURCE_FILE_EXTENSIONS = Object.freeze([
	"html",
	"js",
	"jsx",
	"ts",
	"tsx",
	"md",
	"mdx",
	"vue",
	"svelte",
]);

export function isSourceFile(file: string): boolean {
	return SOURCE_FILE_EXTENSIONS.some((ext) => file.endsWith(`.${ext}`));
}
