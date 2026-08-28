/**
 * Rebuild memoization — theme identity across byte-identical rebuilds
 * (project/scan.ts), effective-theme identity under font resolution
 * (project/pipeline.ts + refreshFontWeightDefaults), and the per-(theme,
 * class) compile memo (engine/index.ts). Every test here is a
 * cache-correctness test: identical output on hits, full invalidation on
 * css/theme/class-set changes, and no leakage of caller mutations back into
 * cached state.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ResolvedTheme } from "../../src/directives/index.js";
import { createCompiler, renderCSS } from "../../src/engine/index.js";
import { googleFontInternals } from "../../src/integrations/font-providers/google/state.js";
import {
	createFontSlot,
	refreshFontWeightDefaults,
} from "../../src/integrations/font-providers/index.js";
import { analyzeProjectCSS } from "../../src/project/pipeline.js";
import { compileScannedProject } from "../../src/project/scan.js";
import { resetGoogleFontCacheForTests } from "../helpers/google-font-cache.js";

describe("per-class compile memo", () => {
	const classes = ["p-4", "text-lg", "rounded-4", "shadow-md", "hover:p-2", "notavariant:p-4"];

	it("recompiling with the same theme reuses rules and replays warnings/token usage", () => {
		const theme = analyzeProjectCSS("").theme;
		const compiler = createCompiler();
		const r1 = compiler.compile(classes, theme);
		const r2 = compiler.compile(classes, theme);

		expect(r1.rules.length).toBeGreaterThan(0);
		expect(renderCSS(r2)).toBe(renderCSS(r1));
		// Rule objects are memoized per (theme, class) — identity is reused.
		expect(r2.rules[0]).toBe(r1.rules[0]);
		// Warnings must be re-emitted on cache hits, not only on first compile.
		expect(r1.warnings.some((w) => w.includes("[RI-1004]"))).toBe(true);
		expect(r2.warnings).toEqual(r1.warnings);
		// Token usage and support blocks must be replayed on cache hits.
		expect(r1.usedTextSizes.size + r1.usedShadows.size).toBeGreaterThan(0);
		expect(r2.usedTextSizes).toEqual(r1.usedTextSizes);
		expect(r2.usedShadows).toEqual(r1.usedShadows);
		expect(r2.usedColorStops).toEqual(r1.usedColorStops);
		expect(r2.usedFonts).toEqual(r1.usedFonts);
		expect(r2.usedAnimations).toEqual(r1.usedAnimations);
		expect(r2.keyframes).toEqual(r1.keyframes);
		expect(r2.properties).toEqual(r1.properties);
	});

	it("mutations of a returned result do not leak into later compiles", () => {
		const theme = analyzeProjectCSS("").theme;
		const compiler = createCompiler();
		const r1 = compiler.compile(["p-4"], theme);
		const ruleCount = r1.rules.length;
		r1.rules.push({ selector: ".junk", sortKey: 0, css: ".junk {}" });
		r1.warnings.push("junk");
		r1.usedShadows.add("junk");
		const r2 = compiler.compile(["p-4"], theme);
		expect(r2.rules.length).toBe(ruleCount);
		expect(r2.warnings).toEqual([]);
		expect(r2.usedShadows.has("junk")).toBe(false);
	});

	it("class-set changes with a stable theme compile correctly", () => {
		const theme = analyzeProjectCSS("").theme;
		const compiler = createCompiler();
		const r1 = compiler.compile(["p-4"], theme);
		expect(renderCSS(r1)).not.toContain(".m-2");
		const r2 = compiler.compile(["p-4", "m-2"], theme);
		expect(renderCSS(r2)).toContain(".p-4");
		expect(renderCSS(r2)).toContain(".m-2");
		const r3 = compiler.compile(["m-2"], theme);
		expect(renderCSS(r3)).not.toContain(".p-4");
	});

	it("distinct theme objects do not share cached entries", () => {
		const t1 = analyzeProjectCSS("").theme;
		const t2 = analyzeProjectCSS("@color { brand: 0.18 330; }").theme;
		const compiler = createCompiler();
		expect(compiler.compile(["bg-brand-500"], t1).rules).toHaveLength(0);
		expect(compiler.compile(["bg-brand-500"], t2).rules).toHaveLength(1);
		expect(compiler.compile(["bg-brand-500"], t1).rules).toHaveLength(0);
	});
});

describe("compileScannedProject analysis memo", () => {
	const dir = mkdtempSync(join(tmpdir(), "ri-compile-memo-"));
	writeFileSync(join(dir, "index.html"), '<div class="p-4 bg-brand-500"></div>');
	const baseCSS = '@import "rainbowindex";\n@source "./index.html";';
	const brandCSS = `${baseCSS}\n@color { brand: 0.18 330; }`;
	const options = (css: string) => ({
		css,
		cwd: dir,
		onInvalidPattern: () => undefined,
		// Hermetic: never reach the Google Fonts machinery from these tests.
		resolveFonts: (fonts: ResolvedTheme["fonts"]) => fonts,
	});

	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it("byte-identical rebuilds reuse theme identity and produce identical output", async () => {
		const a = await compileScannedProject(options(baseCSS));
		const b = await compileScannedProject(options(baseCSS));
		expect(b.compiled.css).toBe(a.compiled.css);
		expect(b.compiled.theme).toBe(a.compiled.theme);
		expect(b.compiled.warnings).toEqual(a.compiled.warnings);
	});

	it("a css text change invalidates the memo", async () => {
		const a = await compileScannedProject(options(baseCSS));
		const b = await compileScannedProject(options(brandCSS));
		expect(b.compiled.theme).not.toBe(a.compiled.theme);
		expect(a.compiled.css).not.toContain(".bg-brand-500");
		expect(b.compiled.css).toContain(".bg-brand-500");
		// And back again: the original input still produces the original output.
		const c = await compileScannedProject(options(baseCSS));
		expect(c.compiled.css).toBe(a.compiled.css);
	});

	it("stable resolved-fonts identity keeps effective theme identity across rebuilds", async () => {
		let stable: ResolvedTheme["fonts"] | null = null;
		const resolveFonts = (fonts: ResolvedTheme["fonts"]) => (stable ??= [...fonts]);
		const a = await compileScannedProject({ ...options(baseCSS), resolveFonts });
		const b = await compileScannedProject({ ...options(baseCSS), resolveFonts });
		expect(b.compiled.theme).toBe(a.compiled.theme);
	});

	it("a class-set change with unchanged css keeps theme identity and picks up new classes", async () => {
		const a = await compileScannedProject(options(baseCSS));
		writeFileSync(join(dir, "index.html"), '<div class="p-4 bg-brand-500 m-2"></div>');
		const b = await compileScannedProject(options(baseCSS));
		expect(b.compiled.theme).toBe(a.compiled.theme);
		expect(a.compiled.css).not.toContain(".m-2");
		expect(b.compiled.css).toContain(".m-2");
	});
});

describe("refreshFontWeightDefaults identity", () => {
	it("returns the original array when metadata changes nothing", async () => {
		await resetGoogleFontCacheForTests();
		const fonts = [createFontSlot({ slot: "sans", family: "Inter", kind: "google" })];
		expect(refreshFontWeightDefaults(fonts)).toBe(fonts);
	});

	it("returns an identity-stable narrowed array per metadata state", async () => {
		await resetGoogleFontCacheForTests();
		googleFontInternals.googleFontState = {
			fetched: true,
			cache: new Map([
				[
					"Inter",
					{
						family: "Inter",
						variable: true,
						category: "sans-serif",
						axes: [{ tag: "wght", start: 200, end: 800 }],
					},
				],
			]),
		};
		const fonts = [createFontSlot({ slot: "sans", family: "Inter", kind: "google" })];
		const first = refreshFontWeightDefaults(fonts);
		expect(first).not.toBe(fonts);
		expect(first[0].faces[0].weight).toBe("200 800");
		// Same input array + same metadata state → same output array.
		expect(refreshFontWeightDefaults(fonts)).toBe(first);
		// A metadata state swap invalidates the memo.
		googleFontInternals.googleFontState = { fetched: true, cache: new Map() };
		expect(refreshFontWeightDefaults(fonts)).toBe(fonts);
		await resetGoogleFontCacheForTests();
	});
});
