import { sveltekit } from "@sveltejs/kit/vite";
import rainbowindex from "rainbowindex/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [sveltekit(), rainbowindex()],
});
