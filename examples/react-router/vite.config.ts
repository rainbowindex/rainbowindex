import react from "@vitejs/plugin-react";
import rainbowindex from "rainbowindex/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), rainbowindex()],
});
