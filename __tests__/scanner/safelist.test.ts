import { beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { safelist } from "../../src/safelist.js";
import { extractClassesFromSource } from "../../src/scanner/class-extraction.js";
import {
	discoverPackageSafelistSources,
	resetSafelistDiscoveryCache,
} from "../../src/scanner/package-discovery.js";
import { resolveSourceFilesAsync } from "../../src/scanner/sources.js";

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

describe("safelist() runtime", () => {
	test("joins string args with single spaces", () => {
		expect(safelist("a", "b", "c")).toBe("a b c");
	});

	test("filters falsy fragments", () => {
		expect(safelist("a", false, "b", null, "c", undefined, "")).toBe("a b c");
	});

	test("preserves internal whitespace within fragments", () => {
		expect(safelist("flex items-center", "px-4")).toBe("flex items-center px-4");
	});

	test("returns empty string for all-falsy input", () => {
		expect(safelist(false, null, undefined, "")).toBe("");
	});

	test("handles zero args", () => {
		expect(safelist()).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Scanner extraction
// ---------------------------------------------------------------------------

describe("scanner: safelist() call extraction", () => {
	test("extracts each literal-string arg as classes", () => {
		const src = `
			import { safelist } from "rainbowindex";
			const base = safelist("stroke-cap-round", "stroke-join-round", "stroke-3.2");
		`;
		const out = extractClassesFromSource({ path: "x.js", content: src });
		expect(out.has("stroke-cap-round")).toBe(true);
		expect(out.has("stroke-join-round")).toBe(true);
		expect(out.has("stroke-3.2")).toBe(true);
	});

	test("extracts space-separated tokens within a single literal", () => {
		const src = `safelist("fill-none stroke-current");`;
		const out = extractClassesFromSource({ path: "x.js", content: src });
		expect(out.has("fill-none")).toBe(true);
		expect(out.has("stroke-current")).toBe(true);
	});

	test("template literals without interpolation are extracted", () => {
		const src = "safelist(`rotate-90 -scale-x-100`);";
		const out = extractClassesFromSource({ path: "x.js", content: src });
		expect(out.has("rotate-90")).toBe(true);
		expect(out.has("-scale-x-100")).toBe(true);
	});

	test("variable args contribute no classes; literals at the call site do", () => {
		// `BASE` is a variable — not a literal — so the inner safelist call at
		// the second site contributes only the literal "rotate-90". The
		// classes inside `BASE` come from its own safelist() declaration on
		// the line above. Net result: only the literal-string args of each
		// call site end up in the safelist extraction.
		const src = `
			const BASE = safelist("stroke-3.2");
			const cls = safelist(BASE, "rotate-90");
		`;
		const out = extractClassesFromSource({ path: "x.js", content: src });
		expect(out.has("stroke-3.2")).toBe(true);
		expect(out.has("rotate-90")).toBe(true);
	});

	test("works in plain .js source (no JSX/TSX extractor)", () => {
		// Library dist files are usually plain .js / .mjs. The scanner must
		// detect safelist calls there too — not just in JSX/TSX.
		const src = `var x=safelist("fill-current","rotate-90");`;
		const out = extractClassesFromSource({ path: "dist/library.js", content: src });
		expect(out.has("fill-current")).toBe(true);
		expect(out.has("rotate-90")).toBe(true);
	});

	test("ignores unrelated calls named differently", () => {
		const src = `cn("foo", "bar"); clsx("baz");`;
		const out = extractClassesFromSource({ path: "x.js", content: src });
		// These would also be picked up by the existing CLASS_HELPERS path —
		// but the test confirms safelist() detection is name-scoped and not
		// triggered by `cn` / `clsx`.
		expect(out.has("foo")).toBe(true); // cn picks this up
		expect(out.has("baz")).toBe(true); // clsx picks this up
	});

	test("skips content that doesn't contain the substring", () => {
		// The fast-path `includes("safelist")` check should bail early.
		const src = `const x = "hover:bg-blue-500";`;
		const out = extractClassesFromSource({ path: "x.js", content: src });
		expect(out.has("hover:bg-blue-500")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Package auto-discovery
// ---------------------------------------------------------------------------

describe("discoverPackageSafelistSources", () => {
	beforeEach(() => {
		resetSafelistDiscoveryCache();
	});

	function setupFixture(layout: Record<string, string>): { dir: string; cleanup: () => void } {
		const dir = join(tmpdir(), `ri-safelist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		for (const [relPath, content] of Object.entries(layout)) {
			const full = join(dir, relPath);
			mkdirSync(join(full, ".."), { recursive: true });
			writeFileSync(full, content);
		}
		return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
	}

	test("returns empty when cwd has no package.json", () => {
		const dir = join(tmpdir(), `ri-safelist-empty-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		try {
			const result = discoverPackageSafelistSources(dir);
			expect(result.sources).toEqual([]);
			expect(result.warnings).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("collects patterns from a dep that advertises safelistSources", () => {
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({
				name: "consumer",
				dependencies: { "@scope/lib": "1.0.0" },
			}),
			"node_modules/@scope/lib/package.json": JSON.stringify({
				name: "@scope/lib",
				rainbowindex: { safelistSources: ["./dist/**/*.mjs"] },
			}),
			"node_modules/@scope/lib/dist/index.mjs": "// stub",
		});
		try {
			const result = discoverPackageSafelistSources(dir);
			expect(result.sources).toHaveLength(1);
			expect(result.sources[0]?.pattern).toContain("@scope/lib/dist/**/*.mjs");
			expect(result.sources[0]?.negated).toBe(false);
			expect(result.sources[0]?.inline).toBe(false);
			// `absolute: true` marks the pattern as a trusted, internally-generated
			// absolute path so the source-pattern validator doesn't reject it.
			expect(result.sources[0]?.absolute).toBe(true);
			expect(result.warnings).toEqual([]);
		} finally {
			cleanup();
		}
	});

	test("discovered patterns are additive — they don't suppress DEFAULT_PATTERNS", async () => {
		// Regression: discovered sources are non-inline non-negated, so a naive
		// `hasPositiveGlobs` check used to treat them as the consumer's own
		// @source declarations and skip the default `src/**` scan. Net effect:
		// the moment any installed dep advertised `safelistSources`, the
		// project's own classes silently disappeared from the build.
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({
				name: "consumer",
				dependencies: { lib: "1.0.0" },
			}),
			"src/Header.tsx": 'export const x = <div className="rotate-180 fill-current" />;',
			"node_modules/lib/package.json": JSON.stringify({
				name: "lib",
				rainbowindex: { safelistSources: ["./out/*.mjs"] },
			}),
			"node_modules/lib/out/library.mjs": 'export const C = "stroke-cap-round";',
		});
		try {
			const discovered = discoverPackageSafelistSources(dir);
			expect(discovered.sources).toHaveLength(1);
			// Pass ONLY discovered sources (mimicking a project with no
			// explicit @source directives, which is the docs/ case).
			const resolved = await resolveSourceFilesAsync(discovered.sources, dir);
			expect(resolved.warnings).toEqual([]);
			const files = resolved.files;
			// Default scan finds the consumer's own source…
			expect(
				files.some((f) => f.endsWith("src/Header.tsx")),
				`expected src/Header.tsx to be scanned via DEFAULT_PATTERNS — got files: ${files.join(", ")}`,
			).toBe(true);
			// …AND the discovered safelist source is included.
			expect(
				files.some((f) => f.endsWith("library.mjs")),
				`expected discovered library.mjs to be scanned — got files: ${files.join(", ")}`,
			).toBe(true);
		} finally {
			cleanup();
		}
	});

	test("explicit user @source still suppresses DEFAULT_PATTERNS (back-compat)", async () => {
		// The defaults-suppression behaviour is intentional for user-facing
		// @source — if the consumer says "scan exactly these patterns", we
		// honour them. Only the `absolute: true` internal marker is exempt.
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({ name: "consumer" }),
			"src/should-be-skipped.tsx": "// would match defaults",
			"app/included.tsx": 'export const x = "p-4";',
		});
		try {
			const resolved = await resolveSourceFilesAsync(
				[{ pattern: "app/**/*.tsx", negated: false, inline: false }],
				dir,
			);
			expect(resolved.files.some((f) => f.endsWith("included.tsx"))).toBe(true);
			expect(resolved.files.some((f) => f.endsWith("should-be-skipped.tsx"))).toBe(false);
		} finally {
			cleanup();
		}
	});

	test("discovered patterns survive validation and reach the glob", async () => {
		// Regression: validateGlobPattern rejects absolute paths for user-facing
		// @source directives. Discovered patterns are absolute by construction
		// (they point into node_modules outside the project's cwd) and must
		// bypass that rule. End-to-end: discovery → resolveSourceFilesAsync must
		// produce zero RI-1404 warnings and actually match files.
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({
				name: "consumer",
				dependencies: { lib: "1.0.0" },
			}),
			"node_modules/lib/package.json": JSON.stringify({
				name: "lib",
				rainbowindex: { safelistSources: ["./out/*.mjs"] },
			}),
			"node_modules/lib/out/library.mjs": "// stub",
		});
		try {
			const { sources, warnings } = discoverPackageSafelistSources(dir);
			expect(warnings).toEqual([]);
			expect(sources).toHaveLength(1);
			const resolved = await resolveSourceFilesAsync(sources, dir);
			expect(
				resolved.warnings.some((w) => w.includes("[RI-1404]")),
				`absolute discovered pattern should not be rejected — got warnings: ${resolved.warnings.join(", ")}`,
			).toBe(false);
			expect(resolved.files.length).toBeGreaterThan(0);
			expect(resolved.files[0]).toContain("library.mjs");
		} finally {
			cleanup();
		}
	});

	test("ignores deps without a rainbowindex field", () => {
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({
				name: "consumer",
				dependencies: { plain: "1.0.0" },
			}),
			"node_modules/plain/package.json": JSON.stringify({ name: "plain" }),
		});
		try {
			const result = discoverPackageSafelistSources(dir);
			expect(result.sources).toEqual([]);
			expect(result.warnings).toEqual([]);
		} finally {
			cleanup();
		}
	});

	test("collects from peerDependencies too", () => {
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({
				name: "consumer",
				peerDependencies: { peer: "1.0.0" },
			}),
			"node_modules/peer/package.json": JSON.stringify({
				name: "peer",
				rainbowindex: { safelistSources: ["./out/*.js"] },
			}),
			"node_modules/peer/out/library.js": "// stub",
		});
		try {
			const result = discoverPackageSafelistSources(dir);
			expect(result.sources).toHaveLength(1);
			expect(result.sources[0]?.pattern).toContain("peer/out/*.js");
		} finally {
			cleanup();
		}
	});

	test("warns and skips invalid safelistSources entries", () => {
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({
				name: "consumer",
				dependencies: { broken: "1.0.0" },
			}),
			"node_modules/broken/package.json": JSON.stringify({
				name: "broken",
				rainbowindex: { safelistSources: ["./valid/*.js", "", 42] },
			}),
		});
		try {
			const result = discoverPackageSafelistSources(dir);
			expect(result.sources).toHaveLength(1);
			expect(result.sources[0]?.pattern).toContain("broken/valid/*.js");
			expect(result.warnings.length).toBeGreaterThanOrEqual(2);
			expect(result.warnings.every((w) => w.startsWith("[RI-1410]"))).toBe(true);
		} finally {
			cleanup();
		}
	});

	test("works for deps whose strict `exports` blocks ./package.json", () => {
		// Regression: previously the discovery used `require.resolve(<dep>/package.json)`,
		// which throws ERR_PACKAGE_PATH_NOT_EXPORTED on any dep with a strict
		// `exports` field that omits "./package.json". The dep is still
		// installed and readable from disk — we just couldn't ask the
		// resolver where to find it. The current direct-filesystem walk
		// sidesteps this.
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({
				name: "consumer",
				dependencies: { strict: "1.0.0" },
			}),
			"node_modules/strict/package.json": JSON.stringify({
				name: "strict",
				exports: { ".": "./dist/index.mjs" },
				rainbowindex: { safelistSources: ["./dist/**/*.mjs"] },
			}),
			"node_modules/strict/dist/index.mjs": "// stub",
		});
		try {
			const result = discoverPackageSafelistSources(dir);
			expect(result.sources).toHaveLength(1);
			expect(result.sources[0]?.pattern).toContain("strict/dist/**/*.mjs");
		} finally {
			cleanup();
		}
	});

	test("walks up to a parent node_modules (hoisted dep layout)", () => {
		// Yarn workspaces / npm workspaces hoist most deps to the workspace
		// root. The consumer at <root>/app/ has no local node_modules entry
		// for the hoisted dep — discovery has to walk one level up.
		const { dir, cleanup } = setupFixture({
			"app/package.json": JSON.stringify({
				name: "app",
				dependencies: { hoisted: "1.0.0" },
			}),
			"node_modules/hoisted/package.json": JSON.stringify({
				name: "hoisted",
				rainbowindex: { safelistSources: ["./out/*.js"] },
			}),
			"node_modules/hoisted/out/library.js": "// stub",
		});
		try {
			const result = discoverPackageSafelistSources(join(dir, "app"));
			expect(result.sources).toHaveLength(1);
			expect(result.sources[0]?.pattern).toContain("hoisted/out/*.js");
		} finally {
			cleanup();
		}
	});

	test("silently skips deps that fail to resolve (declared but not installed)", () => {
		const { dir, cleanup } = setupFixture({
			"package.json": JSON.stringify({
				name: "consumer",
				dependencies: { missing: "1.0.0" },
			}),
		});
		try {
			const result = discoverPackageSafelistSources(dir);
			expect(result.sources).toEqual([]);
			// Not a warning — missing deps are a common state during dev.
			expect(result.warnings).toEqual([]);
		} finally {
			cleanup();
		}
	});
});
