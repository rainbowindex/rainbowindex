import { defineConfig } from "tsup";
import { copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
const external = [
	...Object.keys(pkg.dependencies || {}),
	...Object.keys(pkg.peerDependencies || {}),
];

export default defineConfig([
	{
		entry: {
			index: "src/entries/index.ts",
			browser: "src/entries/browser.ts",
			cli: "src/entries/cli.ts",
			editor: "src/entries/editor.ts",
			vite: "src/integrations/vite.ts",
			oxlint: "src/integrations/oxlint.ts",
		},
		format: ["esm"],
		outExtension: () => ({ js: ".mjs", dts: ".d.ts" }),
		dts: {
			compilerOptions: {
				// tsup injects a default `baseUrl` into its DTS build, which TS 6 rejects (TS5101).
				ignoreDeprecations: "6.0",
			},
		},
		splitting: true,
		outDir: "dist",
		clean: true,
		external,
		target: "node20",
		define: {
			__RI_VERSION__: JSON.stringify(pkg.version),
		},
		onSuccess: async () => {
			copyFileSync(resolve("src/index.css"), resolve("dist/index.css"));
		},
	},
]);
