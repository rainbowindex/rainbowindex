import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("package entrypoints", () => {
	it("exports, types, style, and bin paths target built dist artifacts", () => {
		const pkgPath = resolve(process.cwd(), "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
			style: string;
			exports: {
				".": { style: string; types: string; default: string };
				"./index.css": string;
				"./editor": { types: string; default: string };
				"./vite": { types: string; default: string };
				"./oxlint": { types: string; default: string };
			};
			bin: { rainbowindex: string };
		};

		expect(pkg.style).toBe("./dist/index.css");
		expect(pkg.exports["."].style).toBe("./dist/index.css");
		// "types" must precede every JS condition so TypeScript always finds declarations;
		// "browser" must precede "node"/"default" so bundlers pick the browser build.
		expect(Object.keys(pkg.exports["."])).toEqual(["types", "style", "browser", "node", "default"]);
		expect(pkg.exports["."].types).toBe("./dist/index.d.ts");
		expect(pkg.exports["."].default).toBe("./dist/index.mjs");
		expect(pkg.exports["./index.css"]).toBe("./dist/index.css");
		expect(pkg.exports["./editor"].types).toBe("./dist/editor.d.ts");
		expect(pkg.exports["./editor"].default).toBe("./dist/editor.mjs");
		expect(pkg.exports["./vite"].types).toBe("./dist/vite.d.ts");
		expect(pkg.exports["./vite"].default).toBe("./dist/vite.mjs");
		expect(pkg.exports["./oxlint"].types).toBe("./dist/oxlint.d.ts");
		expect(pkg.exports["./oxlint"].default).toBe("./dist/oxlint.mjs");
		expect(Object.keys(pkg.exports).sort()).toEqual([
			".",
			"./editor",
			"./index.css",
			"./oxlint",
			"./package.json",
			"./vite",
		]);
		expect(existsSync(resolve(process.cwd(), "dist/index.mjs"))).toBe(true);
		expect(existsSync(resolve(process.cwd(), "dist/vite.mjs"))).toBe(true);
		expect(existsSync(resolve(process.cwd(), "dist/editor.mjs"))).toBe(true);
		expect(existsSync(resolve(process.cwd(), "dist/oxlint.mjs"))).toBe(true);

		expect(pkg.bin.rainbowindex).toBe("dist/cli.mjs");
		expect(existsSync(resolve(process.cwd(), "dist/cli.mjs"))).toBe(true);
		expect(existsSync(resolve(process.cwd(), "dist/index.css"))).toBe(true);
	});
});
