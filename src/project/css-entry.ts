/**
 * Default CSS entry candidates — the paths the CLI, the Vite plugin, and
 * editor tooling probe (in order) when locating the project's Rainbow Index
 * CSS input. Pure data, no filesystem access: IO-free consumers (editor
 * tooling) reuse the exact detection order with their own file access and
 * confirm a hit with `hasRIActivation()` on the file's contents.
 */
export const CSS_ENTRY_CANDIDATES: readonly string[] = Object.freeze([
	"src/index.css",
	"src/style.css",
	"src/styles.css",
	"src/app.css",
	"src/global.css",
	"index.css",
	"style.css",
	"styles.css",
	"app.css",
	"global.css",
]);
