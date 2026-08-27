import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractClassesFromSource } from "../../src/scanner/class-extraction.js";
import { isSourceFile } from "../../src/scanner/source-files.js";
import {
	DEFAULT_PATTERNS,
	resolveSourceFilesAsync,
	scanSourceFilesAsync,
} from "../../src/scanner/sources.js";
import { buildCSS } from "../../src/cli/build.js";
import { CSS_CANDIDATES, findCSSFileAsync } from "../../src/cli/css-file.js";

const tempDirs: string[] = [];

function makeTempDir(name: string): string {
	const dir = join(
		tmpdir(),
		`ri-default-discovery-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("default discovery constants", () => {
	test("uses shared source and CSS defaults", () => {
		expect(DEFAULT_PATTERNS).toEqual(["*.html", "src/**/*.{html,js,jsx,ts,tsx,mdx,vue,svelte}"]);
		expect(CSS_CANDIDATES).toEqual([
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
		expect(isSourceFile("/tmp/src/App.tsx")).toBe(true);
		expect(isSourceFile("/tmp/src/App.vue")).toBe(true);
		expect(isSourceFile("/tmp/src/page.astro")).toBe(false);
	});
});

describe("default discovery", () => {
	test("resolveSourceFilesAsync uses shared defaults when no explicit globs are passed", async () => {
		const dir = makeTempDir("resolve");
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "src", "App.tsx"), '<div className="flex">');

		const { files } = await resolveSourceFilesAsync([], dir);
		expect(files.some((file) => file.endsWith("src/App.tsx"))).toBe(true);
	});

	test("scanSourceFilesAsync extracts classes from default source files", async () => {
		const dir = makeTempDir("scan");
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(
			join(dir, "src", "App.tsx"),
			`<div classList={{ hidden: collapsed(), "bg-theme-500": danger() }} />`,
		);

		const { classes } = await scanSourceFilesAsync([], dir);
		expect(classes).toContain("hidden");
		expect(classes).toContain("bg-theme-500");
	});

	test("findCSSFileAsync auto-detects src stylesheets", async () => {
		const dir = makeTempDir("css-file");
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "src", "styles.css"), '@source inline("flex");\n');

		await expect(findCSSFileAsync(dir)).resolves.toBe(join(dir, "src", "styles.css"));
	});

	test("buildCSS auto-detects src/styles.css for CLI behavior", async () => {
		const dir = makeTempDir("build");
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "src", "App.tsx"), `<div className="hidden bg-theme-500"></div>`);
		writeFileSync(join(dir, "src", "styles.css"), '@import "rainbowindex";\n');

		const { css, cssFile } = await buildCSS(
			{
				command: "build",
				globs: [],
				watch: false,
				minify: false,
				strict: false,
				subcommandExplicit: false,
				earlyExit: false,
			},
			dir,
		);

		expect(css).toContain(".hidden");
		expect(css).toContain(".bg-theme-500");
		expect(cssFile).toBe(join(dir, "src", "styles.css"));
	});
});

describe("supported source extractors", () => {
	test("extracts Vue class bindings", () => {
		const classes = extractClassesFromSource({
			path: "/tmp/src/App.vue",
			content: `<template><div :class="{ hidden: collapsed, 'bg-red-500': danger }" /></template>`,
		});

		expect(classes).toContain("hidden");
		expect(classes).toContain("bg-red-500");
	});

	test("extracts Svelte class directives", () => {
		const classes = extractClassesFromSource({
			path: "/tmp/src/routes/+page.svelte",
			content: `<div class:active={selected} class="flex"></div>`,
		});

		expect(classes).toContain("active");
		expect(classes).toContain("flex");
	});

	test("extracts Solid classList object keys", () => {
		const classes = extractClassesFromSource({
			path: "/tmp/src/routes/index.tsx",
			content: `<div classList={{ hidden: collapsed(), "bg-red-500": danger() }} />`,
		});

		expect(classes).toContain("hidden");
		expect(classes).toContain("bg-red-500");
	});

	test("extracts cva base and variant classes without treating variant names as utilities", () => {
		const classes = extractClassesFromSource({
			path: "/tmp/src/components/button.tsx",
			content: `
				const button = cva("inline-flex items-center", {
					variants: {
						intent: {
							primary: "bg-red-500 text-white",
							secondary: "border border-red-500",
						},
					},
					defaultVariants: {
						intent: "primary",
					},
					compoundVariants: [
						{ intent: "secondary", class: "hover:bg-red-50" },
					],
				});
			`,
		});

		expect(classes).toContain("inline-flex");
		expect(classes).toContain("items-center");
		expect(classes).toContain("bg-red-500");
		expect(classes).toContain("text-white");
		expect(classes).toContain("border");
		expect(classes).toContain("border-red-500");
		expect(classes).toContain("hover:bg-red-50");
		expect(classes).not.toContain("primary");
		expect(classes).not.toContain("secondary");
		expect(classes).not.toContain("intent");
	});

	test("extracts Lit classMap object keys", () => {
		const classes = extractClassesFromSource({
			path: "/tmp/src/components/card.ts",
			content: `html\`<div class=\${classMap({ hidden: collapsed, "bg-red-500": danger })}></div>\`;`,
		});

		expect(classes).toContain("hidden");
		expect(classes).toContain("bg-red-500");
	});
});
