import { getFontPreloadLinks } from "../integrations/font-providers/index.js";
import type { CLIOptions } from "./args.js";
import { loadProjectTheme } from "./css-file.js";

export async function preloadFonts(opts: CLIOptions, cwd: string): Promise<void> {
	const theme = await loadProjectTheme(opts, cwd);

	const links = getFontPreloadLinks(theme.fonts);
	if (links.length === 0) {
		console.log("[rainbowindex] No font preload links to generate.");
		return;
	}

	for (const link of links) {
		const safeHref = link.href
			.replace(/&/g, "&amp;")
			.replace(/"/g, "&quot;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/'/g, "&#39;");
		console.log(
			`<link rel="preload" href="${safeHref}" as="${link.as}" type="${link.type}" crossorigin>`,
		);
	}
}
