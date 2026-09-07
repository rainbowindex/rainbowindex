import rainbowindex from "rainbowindex/vite";
import { defineConfig } from "astro/config";

// Astro builds on Vite, so the Vite plugin goes in `vite.plugins` and there is
// no Astro-specific integration to install. `.astro` files are scanned for
// classes in both the markup and the frontmatter.
export default defineConfig({
	vite: { plugins: [rainbowindex()] },
});
