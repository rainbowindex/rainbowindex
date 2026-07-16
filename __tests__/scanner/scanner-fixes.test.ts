import { describe, expect, test } from "vitest";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractDirectives, resolveDirectives } from "../../src/directives/index.js";
import { extractClasses, extractClassesFromSource } from "../../src/scanner/class-extraction.js";
import {
	discoverPackageSafelistSources,
	resetSafelistDiscoveryCache,
} from "../../src/scanner/package-discovery.js";
import { resolveSourceFilesAsync, scanSourceFilesAsync } from "../../src/scanner/sources.js";

function makeTempDir(name: string): { dir: string; cleanup: () => void } {
	const dir = join(
		tmpdir(),
		`ri-scanner-fixes-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// Inline @source size cap (RI-1406) + RI-1401 suppression for inline-only input
// ---------------------------------------------------------------------------

describe("inline @source cap", () => {
	test("caps summed class content length, keeping other inline directives", async () => {
		const { dir, cleanup } = makeTempDir("inline-cap");
		try {
			const { classes, warnings } = await scanSourceFilesAsync(
				[
					{
						pattern: "",
						classes: ["x".repeat(102_401)],
						negated: false,
						inline: true,
					},
					{ pattern: "", classes: ["underline", "font-bold"], negated: false, inline: true },
				],
				dir,
			);
			expect(warnings.some((w) => w.includes("[RI-1406]"))).toBe(true);
			expect(classes).toContain("underline");
			expect(classes).toContain("font-bold");
			expect(classes.size).toBe(2);
		} finally {
			cleanup();
		}
	});

	test("inline-only sources that produce classes suppress RI-1401", async () => {
		const { dir, cleanup } = makeTempDir("inline-no-1401");
		try {
			const { classes, warnings } = await scanSourceFilesAsync(
				[{ pattern: "", classes: ["flex"], negated: false, inline: true }],
				dir,
			);
			expect(classes).toContain("flex");
			expect(warnings.some((w) => w.includes("[RI-1401]"))).toBe(false);
		} finally {
			cleanup();
		}
	});

	test("an explicit user glob that matches nothing still warns RI-1401", async () => {
		const { dir, cleanup } = makeTempDir("explicit-1401");
		try {
			const { warnings } = await scanSourceFilesAsync(
				[
					{ pattern: "", classes: ["flex"], negated: false, inline: true },
					{ pattern: "missing/**/*.tsx", negated: false, inline: false },
				],
				dir,
			);
			expect(warnings.some((w) => w.includes("[RI-1401]"))).toBe(true);
		} finally {
			cleanup();
		}
	});
});

// ---------------------------------------------------------------------------
// Variant-group expansion warnings surface through the scan result
// ---------------------------------------------------------------------------

describe("expansion warnings surface in scan warnings", () => {
	test("depth trip (RI-1409) in a scanned file reaches scanSourceFilesAsync warnings, deduped", async () => {
		const { dir, cleanup } = makeTempDir("depth-trip");
		try {
			mkdirSync(join(dir, "src"), { recursive: true });
			const overlyNested = "a:{a:{a:{a:{a:{a:{a:{a:{a:{a:{a:{x}}}}}}}}}}}";
			writeFileSync(
				join(dir, "src", "App.tsx"),
				`<div className="${overlyNested}" />\n<span className="${overlyNested}" />`,
			);
			const { warnings } = await scanSourceFilesAsync(
				[{ pattern: "src/**/*.tsx", negated: false, inline: false }],
				dir,
			);
			expect(warnings.filter((w) => w.includes("[RI-1409]"))).toHaveLength(1);
		} finally {
			cleanup();
		}
	});

	test("oversized expansion input (RI-1407) in a scanned file reaches scan warnings", async () => {
		const { dir, cleanup } = makeTempDir("input-cap");
		try {
			mkdirSync(join(dir, "src"), { recursive: true });
			// > 500 KB of short lines (each survives the per-line filter) that
			// contain `{` so expansion runs on the whole filtered source.
			writeFileSync(join(dir, "src", "App.tsx"), "hover:{p-1}\n".repeat(50_000));
			const { warnings } = await scanSourceFilesAsync(
				[{ pattern: "src/**/*.tsx", negated: false, inline: false }],
				dir,
			);
			expect(warnings.some((w) => w.includes("[RI-1407]"))).toBe(true);
		} finally {
			cleanup();
		}
	});
});

// ---------------------------------------------------------------------------
// Safelist discovery hardening (RI-1410)
// ---------------------------------------------------------------------------

describe("safelist discovery hardening", () => {
	function setupFixture(layout: Record<string, string>): { dir: string; cleanup: () => void } {
		const { dir, cleanup } = makeTempDir("discovery");
		for (const [relPath, content] of Object.entries(layout)) {
			const full = join(dir, relPath);
			mkdirSync(join(full, ".."), { recursive: true });
			writeFileSync(full, content);
		}
		return { dir, cleanup };
	}

	test("string-valued safelistSources warns instead of iterating per character", () => {
		resetSafelistDiscoveryCache();
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({
				name: "consumer",
				dependencies: { stringy: "1.0.0" },
			}),
			"node_modules/stringy/package.json": JSON.stringify({
				name: "stringy",
				rainbowindex: { safelistSources: "./dist/**/*.js" },
			}),
		});
		try {
			const result = discoverPackageSafelistSources(dir);
			expect(result.sources).toEqual([]);
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain("[RI-1410]");
			expect(result.warnings[0]).toContain("stringy");
		} finally {
			cleanup();
		}
	});

	test("rejects absolute and parent-traversing patterns from deps", () => {
		resetSafelistDiscoveryCache();
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({
				name: "consumer",
				dependencies: { sneaky: "1.0.0" },
			}),
			"node_modules/sneaky/package.json": JSON.stringify({
				name: "sneaky",
				rainbowindex: {
					safelistSources: ["../../../**/*.js", "/etc/**", "./ok/../../escape/**", "./out/*.js"],
				},
			}),
			"node_modules/sneaky/out/library.js": "// stub",
		});
		try {
			const result = discoverPackageSafelistSources(dir);
			expect(result.sources).toHaveLength(1);
			expect(result.sources[0]?.pattern).toContain("sneaky/out/*.js");
			expect(result.warnings).toHaveLength(3);
			for (const warning of result.warnings) {
				expect(warning).toContain("[RI-1410]");
				expect(warning).toContain("sneaky");
			}
		} finally {
			cleanup();
		}
	});

	test("memoizes per cwd until the consumer package.json mtime changes", () => {
		resetSafelistDiscoveryCache();
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({
				name: "consumer",
				dependencies: { lib: "1.0.0" },
			}),
			"node_modules/lib/package.json": JSON.stringify({
				name: "lib",
				rainbowindex: { safelistSources: ["./out/*.js"] },
			}),
			"node_modules/lib/out/library.js": "// stub",
		});
		try {
			const first = discoverPackageSafelistSources(dir);
			expect(first.sources).toHaveLength(1);

			// Mutate the DEP's manifest without touching the consumer's — the
			// memo must keep serving the previous result (object identity).
			writeFileSync(
				join(dir, "node_modules/lib/package.json"),
				JSON.stringify({
					name: "lib",
					rainbowindex: { safelistSources: ["./out/*.js", "./extra/*.js"] },
				}),
			);
			const second = discoverPackageSafelistSources(dir);
			expect(second).toBe(first);

			// Bumping the consumer package.json mtime invalidates the memo.
			const future = new Date(Date.now() + 10_000);
			utimesSync(join(dir, "package.json"), future, future);
			const third = discoverPackageSafelistSources(dir);
			expect(third.sources).toHaveLength(2);
		} finally {
			resetSafelistDiscoveryCache();
			cleanup();
		}
	});
});

// ---------------------------------------------------------------------------
// cva/tv metadata pruning provenance
// ---------------------------------------------------------------------------

describe("variant metadata pruning provenance", () => {
	test("a variant key used as a real class elsewhere in the file survives", () => {
		const classes = extractClassesFromSource({
			path: "/tmp/src/chip.tsx",
			content: `
				const chip = tv({
					variants: { rounded: { true: "rounded-full" } },
					defaultVariants: { rounded: true },
				});
				export const Tag = () => <span className="rounded border" />;
			`,
		});
		expect(classes).toContain("rounded");
		expect(classes).toContain("rounded-full");
		expect(classes).toContain("border");
		expect(classes).not.toContain("variants");
		expect(classes).not.toContain("defaultVariants");
		expect(classes).not.toContain("true");
	});

	test("quoted occurrences inside the helper config stay prunable", () => {
		const classes = extractClassesFromSource({
			path: "/tmp/src/button.tsx",
			content: `
				const button = cva("inline-flex", {
					variants: { intent: { primary: "bg-red-500" } },
					defaultVariants: { intent: "primary" },
				});
			`,
		});
		expect(classes).toContain("inline-flex");
		expect(classes).toContain("bg-red-500");
		expect(classes).not.toContain("intent");
		expect(classes).not.toContain("primary");
	});
});

// ---------------------------------------------------------------------------
// Single-line minified sources
// ---------------------------------------------------------------------------

describe("single-line minified handling", () => {
	test("drops the over-long line but keeps helper-call extraction", () => {
		const padding = "x".repeat(2_100);
		const content = `var pad="${padding}";var raw="m-2 bare-token";var a=cn("p-4 flex");var b=safelist("stroke-cap-round");`;
		expect(content.includes("\n")).toBe(false);
		const classes = extractClassesFromSource({ path: "/tmp/dist/lib.min.js", content });
		// Helper calls are collected from the raw content, outside the
		// line-length guard — minified library dists keep working.
		expect(classes).toContain("p-4");
		expect(classes).toContain("flex");
		expect(classes).toContain("stroke-cap-round");
		// Bare string literals on the dropped line are not extracted.
		expect(classes).not.toContain("m-2");
	});

	test("treats a single over-long line the same as one inside a multiline file", () => {
		const longLine = `class="${"x".repeat(2_100)} p-4"`;
		expect(extractClasses(longLine).size).toBe(0);
		expect(extractClasses(`${longLine}\n<div class="m-2">`)).toContain("m-2");
	});
});

// ---------------------------------------------------------------------------
// Variant strip / extractor parity
// ---------------------------------------------------------------------------

describe("variant prefix strip parity", () => {
	test("dotted variant prefixes strip before the JS-access filter runs", () => {
		// `ui.state:` matches the extractor's variant grammar (dot included);
		// the strip regex must remove it so the base-name filters see the true
		// base and reject the property access.
		const classes = extractClasses('const v = ui.state:rest["aria-invalid"];');
		expect(classes).not.toContain('ui.state:rest["aria-invalid"]');
	});
});

// ---------------------------------------------------------------------------
// Glob resolution — explicit node_modules includes + deterministic ordering
// ---------------------------------------------------------------------------

describe("glob resolution", () => {
	test("explicit node_modules @source beats the default exclude", async () => {
		const { dir, cleanup } = makeTempDir("nm-include");
		try {
			mkdirSync(join(dir, "node_modules/some-lib/dist"), { recursive: true });
			writeFileSync(
				join(dir, "node_modules/some-lib/dist/index.js"),
				'var c=safelist("stroke-cap-round");',
			);
			const { classes, warnings } = await scanSourceFilesAsync(
				[{ pattern: "node_modules/some-lib/dist/**/*.js", negated: false, inline: false }],
				dir,
			);
			expect(warnings.some((w) => w.includes("[RI-1401]"))).toBe(false);
			expect(classes).toContain("stroke-cap-round");
		} finally {
			cleanup();
		}
	});

	test("node_modules includes still respect other excludes and user negations", async () => {
		const { dir, cleanup } = makeTempDir("nm-negated");
		try {
			mkdirSync(join(dir, "node_modules/some-lib/dist"), { recursive: true });
			writeFileSync(join(dir, "node_modules/some-lib/dist/keep.js"), "// keep");
			writeFileSync(join(dir, "node_modules/some-lib/dist/skip.js"), "// skip");
			const { files } = await resolveSourceFilesAsync(
				[
					{ pattern: "node_modules/some-lib/dist/**/*.js", negated: false, inline: false },
					{ pattern: "node_modules/some-lib/dist/skip.js", negated: true, inline: false },
				],
				dir,
			);
			expect(files.some((f) => f.endsWith("keep.js"))).toBe(true);
			expect(files.some((f) => f.endsWith("skip.js"))).toBe(false);
		} finally {
			cleanup();
		}
	});

	test("a brace-expansion @source glob resolves files end-to-end from CSS", async () => {
		const { dir, cleanup } = makeTempDir("brace-glob");
		try {
			mkdirSync(join(dir, "src"), { recursive: true });
			writeFileSync(join(dir, "src", "Button.tsx"), '<button class="p-4">');
			writeFileSync(join(dir, "src", "classes.ts"), 'const c = safelist("stroke-cap-round");');
			writeFileSync(join(dir, "src", "skip.css"), ".x { color: red; }");
			const theme = resolveDirectives(
				extractDirectives('@import "rainbowindex";\n@source "src/**/*.{ts,tsx}";'),
			);
			expect(theme.sources).toEqual([
				{ pattern: "src/**/*.{ts,tsx}", negated: false, inline: false },
			]);
			const { classes, warnings } = await scanSourceFilesAsync([...theme.sources], dir);
			expect(warnings.some((w) => w.includes("[RI-1401]"))).toBe(false);
			expect(classes).toContain("p-4");
			expect(classes).toContain("stroke-cap-round");
		} finally {
			cleanup();
		}
	});

	test("resolved files are codepoint-sorted for deterministic downstream order", async () => {
		const { dir, cleanup } = makeTempDir("sorted");
		try {
			mkdirSync(join(dir, "src"), { recursive: true });
			// Written in reverse-alphabetical order on purpose.
			writeFileSync(join(dir, "src", "zebra.tsx"), '<div class="z-10">');
			writeFileSync(join(dir, "src", "alpha.tsx"), '<div class="p-1">');
			const { files } = await resolveSourceFilesAsync(
				[{ pattern: "src/**/*.tsx", negated: false, inline: false }],
				dir,
			);
			expect(files).toHaveLength(2);
			expect(files).toEqual([...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
			expect(files[0]?.endsWith("alpha.tsx")).toBe(true);
			expect(files[1]?.endsWith("zebra.tsx")).toBe(true);
		} finally {
			cleanup();
		}
	});
});
