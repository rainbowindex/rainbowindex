import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["__tests__/**/*.test.ts"],
		testTimeout: 30_000,
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "json-summary"],
			exclude: ["dist/**", "__tests__/**"],
		},
	},
});
