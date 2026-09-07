import react from "@vitejs/plugin-react";
import rainbowindex from "rainbowindex/vite";
import { defineConfig } from "vite";

// The Vite plugin wires PostCSS and finds the CSS entry on the first dev-server
// listen. Nothing else is needed — no postcss.config.js, no content globs.
export default defineConfig({
	plugins: [react(), rainbowindex()],
});
