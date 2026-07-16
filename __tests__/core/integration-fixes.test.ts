import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildCSS } from "../../src/cli/build.js";
import type { CLIOptions } from "../../src/cli/args.js";
import { resetSafelistDiscoveryCache } from "../../src/scanner/package-discovery.js";
import { compileProject } from "../../src/project/index.js";

const tempDirs: string[] = [];

function makeFixture(name: string, layout: Record<string, string>): string {
	const dir = join(
		tmpdir(),
		`ri-integration-fixes-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	for (const [relPath, content] of Object.entries(layout)) {
		const full = join(dir, relPath);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content);
	}
	tempDirs.push(dir);
	return dir;
}

function buildOpts(overrides: Partial<CLIOptions> = {}): CLIOptions {
	return {
		command: "build",
		globs: [],
		watch: false,
		minify: false,
		strict: false,
		subcommandExplicit: false,
		earlyExit: false,
		...overrides,
	};
}

afterEach(() => {
	resetSafelistDiscoveryCache();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("buildCSS — explicit --css misses (RI-1605)", () => {
	it("throws RI-1605 with the resolved path when an explicit --css file does not exist", async () => {
		const dir = makeFixture("missing-css", {});
		await expect(buildCSS(buildOpts({ cssFile: "missing.css" }), dir)).rejects.toThrow(
			`[RI-1605] CSS input file not found: ${join(dir, "missing.css")}`,
		);
	});

	it("still falls back silently when auto-detection finds no CSS file", async () => {
		const dir = makeFixture("no-css", {
			"src/App.tsx": '<div className="p-4" />',
		});
		const { css, cssFile } = await buildCSS(buildOpts(), dir);
		expect(cssFile).toBeNull();
		expect(css).toContain(".p-4");
	});
});

describe("buildCSS — dep safelist discovery parity with the PostCSS plugin", () => {
	it("includes classes from deps advertising rainbowindex.safelistSources", async () => {
		const dir = makeFixture("safelist-parity", {
			"package.json": JSON.stringify({
				name: "consumer",
				dependencies: { lib: "1.0.0" },
			}),
			"src/App.tsx": '<div className="p-4" />',
			"node_modules/lib/package.json": JSON.stringify({
				name: "lib",
				rainbowindex: { safelistSources: ["./dist/*.mjs"] },
			}),
			"node_modules/lib/dist/library.mjs": 'export const C = safelist("underline");',
		});
		const { css } = await buildCSS(buildOpts(), dir);
		// The consumer's own sources still compile…
		expect(css).toContain(".p-4");
		// …and the dep-advertised safelist classes are compiled too, matching
		// what the PostCSS plugin emits for the same project.
		expect(css).toContain(".underline");
	});
});

describe("compileProject — variant group expansion warnings", () => {
	it("surfaces RI-1409 when an inline source nests variant groups too deep", async () => {
		const deep = "hover:{focus:{active:{first:{last:{odd:{even:{sm:{md:{lg:{xl:{flex}}}}}}}}}}}";
		const result = await compileProject({
			css: "",
			sources: [{ content: `<div class="${deep}" />` }],
		});
		expect(result.warnings.some((w) => w.includes("[RI-1409]"))).toBe(true);
	});

	it("expands in-budget variant groups without warnings", async () => {
		const result = await compileProject({
			css: "",
			sources: [{ content: '<div class="hover:{flex hidden}" />' }],
		});
		expect(result.warnings.filter((w) => w.includes("[RI-140"))).toEqual([]);
		expect(result.css).toContain(".hover\\:flex:hover");
	});
});
