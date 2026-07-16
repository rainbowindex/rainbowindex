import { describe, expect, it, vi } from "vitest";
import {
	SYSTEM_STACKS,
	createFontFace,
	createFontSlot,
	fetchGoogleFontList,
	generateFallbackFontFace,
	generateFontCSS,
	generateWebFontFace,
	getGoogleFontMeta,
	getFontPreloadLinks,
	googleFontsUrl,
	isVariableFont,
	refreshFontWeightDefaults,
	resolveGoogleFonts,
	type FontFace,
	type FontSlot,
} from "../../src/integrations/font-providers/index.js";
import { resetGoogleFontCacheForTests } from "../helpers/google-font-cache.js";
import {
	getFontCacheFile,
	loadFontCache,
	saveFontCache,
} from "../../src/integrations/font-providers/google/cache.js";
import { fetchGoogleFontMetadata } from "../../src/integrations/font-providers/google/client.js";
import { googleFontInternals } from "../../src/integrations/font-providers/google/state.js";
import { mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFace(overrides: Partial<FontFace> = {}): FontFace {
	return createFontFace({ provider: "google", ...overrides });
}

function makeSlot(overrides: Partial<FontSlot> = {}): FontSlot {
	return createFontSlot({ slot: "sans", family: "Inter", kind: "google", ...overrides });
}

// ---------------------------------------------------------------------------
// SYSTEM_STACKS
// ---------------------------------------------------------------------------

describe("SYSTEM_STACKS", () => {
	it("has sans, serif, mono", () => {
		expect(SYSTEM_STACKS["sans"]).toBeDefined();
		expect(SYSTEM_STACKS["serif"]).toBeDefined();
		expect(SYSTEM_STACKS["mono"]).toBeDefined();
	});

	it("sans includes system fonts and emoji", () => {
		expect(SYSTEM_STACKS["sans"]).toContain("ui-sans-serif");
		expect(SYSTEM_STACKS["sans"]).toContain("system-ui");
		expect(SYSTEM_STACKS["sans"]).toContain("Apple Color Emoji");
	});

	it("serif includes emoji fonts", () => {
		expect(SYSTEM_STACKS["serif"]).toContain("ui-serif");
		expect(SYSTEM_STACKS["serif"]).toContain("Apple Color Emoji");
		expect(SYSTEM_STACKS["serif"]).toContain("Noto Color Emoji");
	});

	it("mono includes monospace fallbacks and emoji", () => {
		expect(SYSTEM_STACKS["mono"]).toContain("ui-monospace");
		expect(SYSTEM_STACKS["mono"]).toContain("monospace");
		expect(SYSTEM_STACKS["mono"]).toContain("Apple Color Emoji");
		expect(SYSTEM_STACKS["mono"]).toContain("Noto Color Emoji");
	});
});

// ---------------------------------------------------------------------------
// Google Fonts URL
// ---------------------------------------------------------------------------

describe("googleFontsUrl", () => {
	it("generates basic URL with single weight", () => {
		const url = googleFontsUrl("Inter", makeFace({ weight: "400", style: "normal" }));
		expect(url).toContain("fonts.googleapis.com/css2");
		expect(url).toContain("family=Inter");
		expect(url).toContain("wght@400");
		expect(url).toContain("display=swap");
	});

	it("handles variable weight range", () => {
		const url = googleFontsUrl("Inter", makeFace({ weight: "100 900" }));
		expect(url).toContain("100..900");
	});

	it("handles variable weight range with italic", () => {
		const url = googleFontsUrl("Inter", makeFace({ weight: "100 900", style: "normal italic" }));
		expect(url).toContain("ital,wght@0,100..900");
		expect(url).toContain("1,100..900");
	});

	it("handles comma-separated weights", () => {
		const url = googleFontsUrl("Inter", makeFace({ weight: "400,700", style: "normal" }));
		expect(url).toContain("wght@400;700");
	});

	it("classifies a spaced comma list as discrete weights, not a range", () => {
		// "400, 700" carries a space — the comma must win classification or the
		// URL becomes the malformed range "wght@400,..700".
		const url = googleFontsUrl("Inter", makeFace({ weight: "400, 700", style: "normal" }));
		expect(url).toContain("wght@400;700");
		expect(url).not.toContain("..");
	});

	it("spaced comma list with italic emits per-weight ital tuples", () => {
		const url = googleFontsUrl("Inter", makeFace({ weight: "400, 700", style: "italic" }));
		expect(url).toContain("ital,wght@0,400;1,400;0,700;1,700");
	});

	it("spaces in family name become +", () => {
		const url = googleFontsUrl("Open Sans", makeFace());
		expect(url).toContain("family=Open+Sans");
	});

	it("respects display strategy", () => {
		const url = googleFontsUrl("Inter", makeFace({ display: "optional" }));
		expect(url).toContain("display=optional");
	});
});

// ---------------------------------------------------------------------------
// generateFallbackFontFace
// ---------------------------------------------------------------------------

describe("generateFallbackFontFace", () => {
	it("generates @font-face with metrics overrides", () => {
		const metrics = {
			fallback: "Arial",
			sizeAdjust: 107.64,
			ascent: 90.49,
			descent: 22.48,
			lineGap: 0,
		};
		const css = generateFallbackFontFace("Inter", metrics);

		expect(css).toContain("@font-face");
		expect(css).toContain('"Inter Fallback"');
		expect(css).toContain('local("Arial")');
		expect(css).toContain("size-adjust: 107.64%");
		expect(css).toContain("ascent-override: 90.49%");
		expect(css).toContain("descent-override: 22.48%");
		expect(css).toContain("line-gap-override: 0%");
	});
});

// ---------------------------------------------------------------------------
// generateWebFontFace
// ---------------------------------------------------------------------------

describe("generateWebFontFace", () => {
	it("returns null for system provider", () => {
		expect(generateWebFontFace("Inter", makeFace({ provider: "system" }))).toBeNull();
	});

	it("generates google font @import", () => {
		const result = generateWebFontFace("Inter", makeFace({ provider: "google" }));
		expect(result).not.toBeNull();
		expect(result!.type).toBe("import");
		expect(result!.css).toContain("@import url(");
		expect(result!.css).toContain("fonts.googleapis.com");
	});

	it("generates local file @font-face", () => {
		const result = generateWebFontFace("Inter", makeFace({ provider: "/fonts/custom.woff2" }));
		expect(result).not.toBeNull();
		expect(result!.type).toBe("font-face");
		expect(result!.css).toContain("/fonts/custom.woff2");
	});

	it("includes weight and display for local files", () => {
		const result = generateWebFontFace(
			"Inter",
			makeFace({
				provider: "/fonts/custom.woff2",
				weight: "100 900",
				display: "optional",
			}),
		);
		expect(result).not.toBeNull();
		expect(result!.type).toBe("font-face");
		expect(result!.css).toContain("font-weight: 100 900");
		expect(result!.css).toContain("font-display: optional");
	});

	it("emits unicode-range when set on the face", () => {
		const result = generateWebFontFace(
			"Inter",
			makeFace({ provider: "/fonts/custom.woff2", unicodeRange: "U+0000-00FF" }),
		);
		expect(result!.css).toContain("unicode-range: U+0000-00FF");
	});
});

// ---------------------------------------------------------------------------
// generateFontCSS
// ---------------------------------------------------------------------------

describe("generateFontCSS", () => {
	it("system slot: no @font-face, just system stack variable", () => {
		const result = generateFontCSS(makeSlot({ kind: "system" }));
		expect(result.fontFaces).toHaveLength(0);
		expect(result.variables).toHaveLength(1);
		expect(result.variables[0]).toContain("--font-sans:");
		expect(result.variables[0]).toContain("ui-sans-serif");
	});

	it("system slot uses correct stack for slot", () => {
		const mono = generateFontCSS(makeSlot({ kind: "system", slot: "mono" }));
		expect(mono.variables[0]).toContain("ui-monospace");
	});

	it("manual slot: manual font stack", () => {
		const result = generateFontCSS(makeSlot({ kind: "manual", fallback: ["Arial", "sans-serif"] }));
		expect(result.fontFaces).toHaveLength(0);
		expect(result.variables[0]).toContain('"Inter"');
		expect(result.variables[0]).toContain("Arial");
	});

	it("manual slot with features", () => {
		const result = generateFontCSS(makeSlot({ kind: "manual", features: '"ss01" on' }));
		expect(result.variables).toHaveLength(2);
		expect(result.variables[1]).toContain("--font-sans--features");
	});

	it("manual slot with variation", () => {
		const result = generateFontCSS(makeSlot({ kind: "manual", variation: '"wght" 500' }));
		expect(result.variables).toHaveLength(2);
		expect(result.variables[1]).toContain("--font-sans--variations");
	});

	it("web font without metrics: no fallback @font-face, just @import + variable", () => {
		const result = generateFontCSS(makeSlot());
		expect(result.fontFaces).toHaveLength(0); // no metrics = no fallback font-face
		expect(result.imports).toHaveLength(1);
		expect(result.imports[0]).toContain("@import url(");
		expect(result.imports[0]).toContain("fonts.googleapis.com");
		expect(result.variables.length).toBeGreaterThanOrEqual(1);
		expect(result.variables[0]).toContain("--font-sans:");
		expect(result.variables[0]).toContain('"Inter"');
		expect(result.variables[0]).not.toContain('"Inter Fallback"');
	});

	it("web font with explicit metrics: generates fallback @font-face", () => {
		const result = generateFontCSS(
			makeSlot({
				sizeAdjust: 107.64,
				ascent: 90.49,
				descent: 22.48,
				lineGap: 0,
				metricsFallback: "Arial",
			}),
		);
		expect(result.fontFaces).toHaveLength(1); // fallback font-face
		expect(result.fontFaces[0]).toContain('"Inter Fallback"');
		expect(result.fontFaces[0]).toContain('local("Arial")');
		expect(result.fontFaces[0]).toContain("size-adjust: 107.64%");
		expect(result.imports).toHaveLength(1);
		expect(result.variables[0]).toContain('"Inter"');
		expect(result.variables[0]).toContain('"Inter Fallback"');
	});

	it("web font variable includes literal fallback stack", () => {
		const result = generateFontCSS(makeSlot({ fallback: [] }));
		expect(result.variables[0]).toContain("ui-sans-serif");
	});

	it("mono slot gets mono fallback stack", () => {
		const result = generateFontCSS(
			makeSlot({ slot: "mono", family: "JetBrains Mono", fallback: [] }),
		);
		expect(result.variables[0]).toContain("ui-monospace");
	});

	it("serif slot gets serif fallback stack", () => {
		const result = generateFontCSS(
			makeSlot({ slot: "serif", family: "Playfair Display", fallback: [] }),
		);
		expect(result.variables[0]).toContain("ui-serif");
	});

	it("custom fallback overrides default stack", () => {
		const result = generateFontCSS(makeSlot({ fallback: ["Helvetica", "Arial"] }));
		expect(result.variables[0]).toContain("Helvetica, Arial");
		expect(result.variables[0]).not.toContain("ui-sans-serif");
	});

	it("web font with features and variation", () => {
		const result = generateFontCSS(makeSlot({ features: '"cv01" on', variation: '"wght" 600' }));
		expect(result.variables).toHaveLength(3);
		expect(result.variables[1]).toContain("--font-sans--features");
		expect(result.variables[2]).toContain("--font-sans--variations");
	});

	it("metrics fallback defaults to first fallback entry when metricsFallback not set", () => {
		const result = generateFontCSS(
			makeSlot({
				fallback: ["Helvetica"],
				sizeAdjust: 100,
				ascent: 90,
				descent: 22,
				lineGap: 0,
			}),
		);
		expect(result.fontFaces).toHaveLength(1);
		expect(result.fontFaces[0]).toContain('local("Helvetica")');
	});

	it("local slot emits one @font-face per face, sharing the family", () => {
		const slot = createFontSlot({
			slot: "sans",
			family: "Satoshi",
			kind: "local",
			faces: [
				createFontFace({ provider: "/fonts/Satoshi.woff2", style: "normal" }),
				createFontFace({ provider: "/fonts/Satoshi-Italic.woff2", style: "italic" }),
			],
		});
		const result = generateFontCSS(slot);
		expect(result.fontFaces).toHaveLength(2);
		expect(result.fontFaces[0]).toContain('font-family: "Satoshi"');
		expect(result.fontFaces[1]).toContain('font-family: "Satoshi"');
		expect(result.fontFaces[1]).toContain("font-style: italic");
		expect(result.variables[0]).toContain("--font-sans:");
		expect(result.variables[0]).toContain('"Satoshi"');
	});

	it("warns (RI-1203) and normalizes a compound style on a local face", () => {
		const slot = createFontSlot({
			slot: "sans",
			family: "Satoshi",
			kind: "local",
			faces: [createFontFace({ provider: "/fonts/Satoshi.woff2", style: "normal italic" })],
		});
		const result = generateFontCSS(slot);
		expect(result.warnings.some((w) => w.includes("[RI-1203]"))).toBe(true);
		// the compound style collapses to its first keyword — valid CSS
		expect(result.fontFaces[0]).not.toContain("font-style: normal italic");
	});
});

// ---------------------------------------------------------------------------
// getFontPreloadLinks
// ---------------------------------------------------------------------------

describe("getFontPreloadLinks", () => {
	const localSlot = (family: string, src: string, preload: boolean) =>
		createFontSlot({
			slot: "sans",
			family,
			kind: "local",
			preload,
			faces: [createFontFace({ provider: src })],
		});

	it("returns empty for no preload", () => {
		const links = getFontPreloadLinks([makeSlot({ preload: false })]);
		expect(links).toHaveLength(0);
	});

	it("skips system slot", () => {
		const links = getFontPreloadLinks([makeSlot({ kind: "system", preload: true })]);
		expect(links).toHaveLength(0);
	});

	it("skips manual stack", () => {
		const links = getFontPreloadLinks([makeSlot({ kind: "manual", preload: true })]);
		expect(links).toHaveLength(0);
	});

	it("skips google fonts (CDN returns CSS, not font binary)", () => {
		const links = getFontPreloadLinks([makeSlot({ preload: true })]);
		expect(links).toHaveLength(0);
	});

	it("generates preload link for local file", () => {
		const links = getFontPreloadLinks([localSlot("Inter", "/fonts/my.woff2", true)]);
		expect(links).toHaveLength(1);
		expect(links[0].href).toContain("/fonts/my.woff2");
		expect(links[0].as).toBe("font");
		expect(links[0].type).toBe("font/woff2");
		expect(links[0].crossorigin).toBe(true);
	});

	it("derives the MIME type from the file extension", () => {
		const links = getFontPreloadLinks([
			localSlot("A", "/fonts/a.woff", true),
			localSlot("B", "/fonts/b.ttf", true),
			localSlot("C", "/fonts/c.otf", true),
			localSlot("D", "https://cdn.example.com/d", true),
		]);
		expect(links.map((l) => l.type)).toEqual(["font/woff", "font/ttf", "font/otf", "font/woff2"]);
	});

	it("handles multiple slots (only local files produce links)", () => {
		const links = getFontPreloadLinks([
			makeSlot({ preload: true }),
			localSlot("Custom", "/fonts/custom.woff2", true),
		]);
		expect(links).toHaveLength(1);
		expect(links[0].href).toBe("/fonts/custom.woff2");
	});

	it("honors per-face preload over the slot default", () => {
		const links = getFontPreloadLinks([
			createFontSlot({
				slot: "sans",
				family: "Satoshi",
				kind: "local",
				preload: false,
				faces: [
					createFontFace({ provider: "/fonts/Satoshi.woff2", preload: true }),
					createFontFace({ provider: "/fonts/Satoshi-Italic.woff2" }),
				],
			}),
		]);
		expect(links).toHaveLength(1);
		expect(links[0].href).toBe("/fonts/Satoshi.woff2");
	});
});

// ---------------------------------------------------------------------------
// createFontFace / createFontSlot
// ---------------------------------------------------------------------------

describe("createFontFace / createFontSlot", () => {
	it("createFontFace fills in non-google defaults", () => {
		const face = createFontFace({ provider: "" });
		expect(face.provider).toBe("");
		expect(face.weight).toBe("400");
		expect(face.style).toBe("normal");
		expect(face.subset).toBe("latin");
		expect(face.display).toBe("swap");
	});

	it("createFontFace defaults google to full variable range and both styles", () => {
		const face = createFontFace({ provider: "google" });
		expect(face.weight).toBe("100 900");
		expect(face.style).toBe("normal italic");
	});

	it("createFontSlot fills in defaults and a single manual face", async () => {
		await resetGoogleFontCacheForTests();
		const slot = createFontSlot({ slot: "sans", family: "Inter" });
		expect(slot.kind).toBe("manual");
		expect(slot.features).toBeNull();
		expect(slot.variation).toBeNull();
		expect(slot.fallback).toEqual([]);
		expect(slot.preload).toBe(false);
		expect(slot.sizeAdjust).toBeUndefined();
		expect(slot.faces).toHaveLength(1);
		expect(slot.faces[0].provider).toBe("");
	});

	it("google slot defaults do not depend on cached metadata", async () => {
		// Regression: the factory used to read the Google Fonts cache to derive the
		// default weight, which made behavior depend on whether the metadata fetch had
		// completed (surfacing as "font-weight: 400 only" for variable fonts like Roboto).
		await resetGoogleFontCacheForTests();
		const slot = createFontSlot({
			slot: "sans",
			family: "Roboto",
			kind: "google",
			faces: [createFontFace({ provider: "google" })],
		});
		expect(slot.kind).toBe("google");
		expect(slot.faces[0].weight).toBe("100 900");
		expect(slot.faces[0].style).toBe("normal italic");
	});

	it("derives kind from the first face's provider", () => {
		const slot = createFontSlot({
			slot: "mono",
			family: "Fira Code",
			faces: [createFontFace({ provider: "/fonts/FiraCode.woff2", weight: "300 700" })],
			preload: true,
		});
		expect(slot.slot).toBe("mono");
		expect(slot.family).toBe("Fira Code");
		expect(slot.kind).toBe("local");
		expect(slot.faces[0].weight).toBe("300 700");
		expect(slot.preload).toBe(true);
		expect(slot.faces[0].display).toBe("swap");
	});

	it("isVariableFont returns false without cache", async () => {
		await resetGoogleFontCacheForTests();
		expect(isVariableFont("Inter")).toBe(false);
	});
});

describe("fetchGoogleFontList", () => {
	it("retries on a subsequent call after an initial fetch failure", async () => {
		await resetGoogleFontCacheForTests();
		const originalFetch = globalThis.fetch;
		const originalOffline = process.env.RI_OFFLINE;
		const originalCacheDir = process.env.RI_CACHE_DIR;
		const originalFetchFonts = process.env.RI_FETCH_FONTS;
		const testCacheDir = `.ri-font-cache-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		process.env.RI_OFFLINE = undefined;
		process.env.RI_CACHE_DIR = testCacheDir;
		process.env.RI_FETCH_FONTS = "1";

		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			if (calls <= 3) {
				throw new Error("simulated network failure");
			}
			return new Response(JSON.stringify({ familyMetadataList: [] }), {
				status: 200,
				headers: { "content-length": "25", "content-type": "application/json" },
			});
		}) as typeof fetch;

		try {
			// First invocation exhausts its internal retries (3 attempts: 0, 1, 2) and fails.
			await fetchGoogleFontList();
			expect(calls).toBe(3);
			// Clearing the failure timestamp ends the cooldown; the next call retries.
			googleFontInternals.lastFetchFailureMs = 0;
			await fetchGoogleFontList();
			expect(calls).toBe(4);
		} finally {
			if (originalFetch) {
				globalThis.fetch = originalFetch;
			} else {
				(globalThis as { fetch?: typeof fetch }).fetch = undefined;
			}

			if (originalOffline === undefined) {
				process.env.RI_OFFLINE = undefined;
			} else {
				process.env.RI_OFFLINE = originalOffline;
			}
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			if (originalFetchFonts === undefined) {
				process.env.RI_FETCH_FONTS = undefined;
			} else {
				process.env.RI_FETCH_FONTS = originalFetchFonts;
			}
			await resetGoogleFontCacheForTests();
			// Clean up test cache directory
			try {
				const { rmSync } = await import("node:fs");
				rmSync(testCacheDir, { recursive: true, force: true });
			} catch {}
		}
	});

	it("emits fetch progress logs only when debug is enabled", async () => {
		await resetGoogleFontCacheForTests();
		const originalFetch = globalThis.fetch;
		const originalOffline = process.env.RI_OFFLINE;
		const originalFetchFonts = process.env.RI_FETCH_FONTS;
		const originalCacheDir = process.env.RI_CACHE_DIR;
		const originalDebug = process.env.DEBUG;
		const originalRIDebug = process.env.RI_DEBUG;
		const testCacheDirA = `.ri-font-cache-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-a`;
		const testCacheDirB = `.ri-font-cache-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-b`;

		process.env.RI_OFFLINE = "";
		process.env.RI_FETCH_FONTS = "1";
		process.env.DEBUG = "";
		process.env.RI_DEBUG = "";
		process.env.RI_CACHE_DIR = testCacheDirA;

		globalThis.fetch = (async () => {
			return new Response(JSON.stringify({ familyMetadataList: [] }), {
				status: 200,
				headers: { "content-length": "25", "content-type": "application/json" },
			});
		}) as typeof fetch;

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		try {
			await fetchGoogleFontList();
			expect(warnSpy).not.toHaveBeenCalledWith("[RI-DEBUG] Fetching Google Fonts metadata...");

			await resetGoogleFontCacheForTests();
			process.env.RI_CACHE_DIR = testCacheDirB;
			process.env.RI_DEBUG = "1";

			await fetchGoogleFontList();
			expect(warnSpy).toHaveBeenCalledWith("[RI-DEBUG] Fetching Google Fonts metadata...");
		} finally {
			warnSpy.mockRestore();
			if (originalFetch) {
				globalThis.fetch = originalFetch;
			} else {
				(globalThis as { fetch?: typeof fetch }).fetch = undefined;
			}
			if (originalOffline === undefined) {
				process.env.RI_OFFLINE = "";
			} else {
				process.env.RI_OFFLINE = originalOffline;
			}
			if (originalFetchFonts === undefined) {
				process.env.RI_FETCH_FONTS = "";
			} else {
				process.env.RI_FETCH_FONTS = originalFetchFonts;
			}
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = "";
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			if (originalDebug === undefined) {
				process.env.DEBUG = "";
			} else {
				process.env.DEBUG = originalDebug;
			}
			if (originalRIDebug === undefined) {
				process.env.RI_DEBUG = "";
			} else {
				process.env.RI_DEBUG = originalRIDebug;
			}
			await resetGoogleFontCacheForTests();
			try {
				const { rmSync } = await import("node:fs");
				rmSync(testCacheDirA, { recursive: true, force: true });
				rmSync(testCacheDirB, { recursive: true, force: true });
			} catch {}
		}
	});

	it("warns when offline mode has no cache to load", async () => {
		await resetGoogleFontCacheForTests();
		const originalOffline = process.env.RI_OFFLINE;
		const originalFetchFonts = process.env.RI_FETCH_FONTS;
		const originalCacheDir = process.env.RI_CACHE_DIR;
		const testCacheDir = `.ri-font-cache-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		process.env.RI_OFFLINE = "1";
		process.env.RI_FETCH_FONTS = "1";
		process.env.RI_CACHE_DIR = testCacheDir;

		try {
			await fetchGoogleFontList();
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[RI-1206]"));
		} finally {
			warnSpy.mockRestore();
			if (originalOffline === undefined) {
				process.env.RI_OFFLINE = undefined;
			} else {
				process.env.RI_OFFLINE = originalOffline;
			}
			if (originalFetchFonts === undefined) {
				process.env.RI_FETCH_FONTS = undefined;
			} else {
				process.env.RI_FETCH_FONTS = originalFetchFonts;
			}
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			await resetGoogleFontCacheForTests();
			try {
				const { rmSync } = await import("node:fs");
				rmSync(testCacheDir, { recursive: true, force: true });
			} catch {}
		}
	});

	it("warns when global fetch is unavailable", async () => {
		await resetGoogleFontCacheForTests();
		const originalFetch = globalThis.fetch;
		const originalOffline = process.env.RI_OFFLINE;
		const originalFetchFonts = process.env.RI_FETCH_FONTS;
		const originalCacheDir = process.env.RI_CACHE_DIR;
		const testCacheDir = `.ri-font-cache-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		process.env.RI_OFFLINE = "0";
		process.env.RI_FETCH_FONTS = "1";
		process.env.RI_CACHE_DIR = testCacheDir;
		(globalThis as { fetch?: typeof fetch }).fetch = undefined;

		try {
			await fetchGoogleFontList();
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[RI-1212]"));
		} finally {
			warnSpy.mockRestore();
			if (originalFetch) {
				globalThis.fetch = originalFetch;
			} else {
				(globalThis as { fetch?: typeof fetch }).fetch = undefined;
			}
			if (originalOffline === undefined) {
				process.env.RI_OFFLINE = undefined;
			} else {
				process.env.RI_OFFLINE = originalOffline;
			}
			if (originalFetchFonts === undefined) {
				process.env.RI_FETCH_FONTS = undefined;
			} else {
				process.env.RI_FETCH_FONTS = originalFetchFonts;
			}
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			await resetGoogleFontCacheForTests();
			try {
				const { rmSync } = await import("node:fs");
				rmSync(testCacheDir, { recursive: true, force: true });
			} catch {}
		}
	});

	it("warns on repeated fetch failure when no stale cache exists", async () => {
		await resetGoogleFontCacheForTests();
		const originalFetch = globalThis.fetch;
		const originalOffline = process.env.RI_OFFLINE;
		const originalFetchFonts = process.env.RI_FETCH_FONTS;
		const originalCacheDir = process.env.RI_CACHE_DIR;
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const testCacheDir = `.ri-font-cache-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

		process.env.RI_OFFLINE = "0";
		process.env.RI_FETCH_FONTS = "1";
		process.env.RI_CACHE_DIR = testCacheDir;
		globalThis.fetch = vi.fn(async () => {
			return new Response("{}", {
				status: 503,
				headers: {
					"content-length": "2",
					"content-type": "application/json",
				},
			});
		}) as typeof fetch;

		try {
			await fetchGoogleFontList();
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[RI-1205]"));
			expect(googleFontInternals.lastFetchFailureMs).toBeGreaterThan(0);
		} finally {
			warnSpy.mockRestore();
			if (originalFetch) {
				globalThis.fetch = originalFetch;
			} else {
				(globalThis as { fetch?: typeof fetch }).fetch = undefined;
			}
			if (originalOffline === undefined) {
				process.env.RI_OFFLINE = undefined;
			} else {
				process.env.RI_OFFLINE = originalOffline;
			}
			if (originalFetchFonts === undefined) {
				process.env.RI_FETCH_FONTS = undefined;
			} else {
				process.env.RI_FETCH_FONTS = originalFetchFonts;
			}
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			await resetGoogleFontCacheForTests();
			try {
				const { rmSync } = await import("node:fs");
				rmSync(testCacheDir, { recursive: true, force: true });
			} catch {}
		}
	});

	it("skips refetching during the cooldown window unless forced", async () => {
		await resetGoogleFontCacheForTests();
		const originalFetch = globalThis.fetch;
		const originalOffline = process.env.RI_OFFLINE;
		const originalFetchFonts = process.env.RI_FETCH_FONTS;

		process.env.RI_OFFLINE = "0";
		process.env.RI_FETCH_FONTS = "1";
		googleFontInternals.lastFetchFailureMs = Date.now();
		globalThis.fetch = vi.fn(async () => {
			throw new Error("should not be called");
		}) as typeof fetch;

		try {
			await fetchGoogleFontList();
			expect(globalThis.fetch).not.toHaveBeenCalled();
		} finally {
			if (originalFetch) {
				globalThis.fetch = originalFetch;
			} else {
				(globalThis as { fetch?: typeof fetch }).fetch = undefined;
			}
			if (originalOffline === undefined) {
				process.env.RI_OFFLINE = undefined;
			} else {
				process.env.RI_OFFLINE = originalOffline;
			}
			if (originalFetchFonts === undefined) {
				process.env.RI_FETCH_FONTS = undefined;
			} else {
				process.env.RI_FETCH_FONTS = originalFetchFonts;
			}
			await resetGoogleFontCacheForTests();
		}
	});
});

describe("fetchGoogleFontMetadata", () => {
	it("parses response metadata into a frozen cache map", async () => {
		const originalFetch = globalThis.fetch;

		globalThis.fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					familyMetadataList: [
						{
							family: "Inter",
							category: "sans-serif",
							axes: [
								{ tag: "wght", min: 100, max: 900 },
								{ tag: "wdth", min: 75, max: 125 },
							],
						},
						{
							family: "Roboto Mono",
							category: "monospace",
							axes: [{ tag: "wght", min: 400, max: 400 }],
						},
					],
				}),
				{
					status: 200,
					headers: {
						"content-length": "256",
						"content-type": "application/json",
					},
				},
			);
		}) as typeof fetch;

		try {
			const metadata = await fetchGoogleFontMetadata();
			const inter = metadata.get("Inter");
			const mono = metadata.get("Roboto Mono");

			expect(metadata.size).toBe(2);
			expect(inter).toMatchObject({
				family: "Inter",
				category: "sans-serif",
				variable: true,
			});
			expect(inter?.axes).toEqual([
				{ tag: "wght", start: 100, end: 900 },
				{ tag: "wdth", start: 75, end: 125 },
			]);
			expect(Object.isFrozen(inter)).toBe(true);
			expect(Object.isFrozen(inter?.axes)).toBe(true);
			expect(Object.isFrozen(inter?.axes[0])).toBe(true);
			expect(mono?.variable).toBe(false);
		} finally {
			if (originalFetch) {
				globalThis.fetch = originalFetch;
			} else {
				(globalThis as { fetch?: typeof fetch }).fetch = undefined;
			}
		}
	});

	it("rejects oversized content-length headers after retries", async () => {
		const originalFetch = globalThis.fetch;
		vi.useFakeTimers();
		let calls = 0;

		globalThis.fetch = vi.fn(async () => {
			calls++;
			return new Response("{}", {
				status: 200,
				headers: {
					"content-length": String(10 * 1024 * 1024 + 1),
					"content-type": "application/json",
				},
			});
		}) as typeof fetch;

		try {
			const pending = fetchGoogleFontMetadata();
			const assertion = expect(pending).rejects.toThrow(/\[RI-1207\].*too large/i);
			await vi.runAllTimersAsync();
			await assertion;
			expect(calls).toBe(3);
		} finally {
			vi.useRealTimers();
			if (originalFetch) {
				globalThis.fetch = originalFetch;
			} else {
				(globalThis as { fetch?: typeof fetch }).fetch = undefined;
			}
		}
	});

	it("rejects unexpected content types after retries", async () => {
		const originalFetch = globalThis.fetch;
		vi.useFakeTimers();
		let calls = 0;

		globalThis.fetch = vi.fn(async () => {
			calls++;
			return new Response("<html></html>", {
				status: 200,
				headers: {
					"content-length": "13",
					"content-type": "text/html",
				},
			});
		}) as typeof fetch;

		try {
			const pending = fetchGoogleFontMetadata();
			const assertion = expect(pending).rejects.toThrow(/\[RI-1207\].*Content-Type/i);
			await vi.runAllTimersAsync();
			await assertion;
			expect(calls).toBe(3);
		} finally {
			vi.useRealTimers();
			if (originalFetch) {
				globalThis.fetch = originalFetch;
			} else {
				(globalThis as { fetch?: typeof fetch }).fetch = undefined;
			}
		}
	});

	it("rejects HTTP failures after retries", async () => {
		const originalFetch = globalThis.fetch;
		vi.useFakeTimers();
		let calls = 0;

		globalThis.fetch = vi.fn(async () => {
			calls++;
			return new Response("{}", {
				status: 503,
				headers: {
					"content-length": "2",
					"content-type": "application/json",
				},
			});
		}) as typeof fetch;

		try {
			const pending = fetchGoogleFontMetadata();
			const assertion = expect(pending).rejects.toThrow(/\[RI-1205\].*HTTP 503/);
			await vi.runAllTimersAsync();
			await assertion;
			expect(calls).toBe(3);
		} finally {
			vi.useRealTimers();
			if (originalFetch) {
				globalThis.fetch = originalFetch;
			} else {
				(globalThis as { fetch?: typeof fetch }).fetch = undefined;
			}
		}
	});
});

describe("google font cache", () => {
	it("rejects absolute RI_CACHE_DIR values", async () => {
		const originalCacheDir = process.env.RI_CACHE_DIR;
		process.env.RI_CACHE_DIR = "/tmp/ri-font-cache";
		await resetGoogleFontCacheForTests();
		try {
			expect(() => getFontCacheFile()).toThrow(/\[RI-1208\]/);
		} finally {
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			await resetGoogleFontCacheForTests();
		}
	});

	it("rejects RI_CACHE_DIR traversal segments", async () => {
		const originalCacheDir = process.env.RI_CACHE_DIR;
		process.env.RI_CACHE_DIR = "../outside";
		await resetGoogleFontCacheForTests();
		try {
			expect(() => getFontCacheFile()).toThrow(/\[RI-1209\]/);
		} finally {
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			await resetGoogleFontCacheForTests();
		}
	});

	it("loadFontCache accepts valid checksum payloads and rejects tampered ones", async () => {
		const originalCacheDir = process.env.RI_CACHE_DIR;
		const originalCwd = process.cwd();
		const root = join(
			tmpdir(),
			`ri-google-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		const relCacheDir = ".ri-cache";
		const cacheFile = join(root, relCacheDir, "google.json");
		const validEntries = [
			{
				family: "Inter",
				variable: true,
				category: "sans-serif",
				axes: [{ tag: "wght", start: 100, end: 900 }],
			},
		];
		mkdirSync(join(root, relCacheDir), { recursive: true });
		process.chdir(root);
		process.env.RI_CACHE_DIR = relCacheDir;

		try {
			await resetGoogleFontCacheForTests();
			const entriesJson = JSON.stringify(validEntries);
			const crypto = await import("node:crypto");
			const checksum = crypto.createHash("sha256").update(entriesJson).digest("hex");
			writeFileSync(cacheFile, JSON.stringify({ checksum, entries: validEntries }));

			await expect(loadFontCache(true)).resolves.toBe(true);
			expect(googleFontInternals.googleFontState.cache.get("Inter")?.variable).toBe(true);

			await resetGoogleFontCacheForTests();
			writeFileSync(cacheFile, JSON.stringify({ checksum: "bad", entries: validEntries }));
			await expect(loadFontCache(true)).resolves.toBe(false);
		} finally {
			process.chdir(originalCwd);
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			await resetGoogleFontCacheForTests();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("loadFontCache filters invalid entries and rejects bare-array payloads", async () => {
		const originalCacheDir = process.env.RI_CACHE_DIR;
		const originalCwd = process.cwd();
		const root = join(
			tmpdir(),
			`ri-google-filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		const relCacheDir = ".ri-cache";
		const cacheFile = join(root, relCacheDir, "google.json");
		mkdirSync(join(root, relCacheDir), { recursive: true });
		process.chdir(root);
		process.env.RI_CACHE_DIR = relCacheDir;

		const entries = [
			{
				family: "Inter",
				variable: true,
				category: "sans-serif",
				axes: [
					{ tag: "wght", start: 100, end: 900 },
					{ tag: "wdth", start: 75, end: 125 },
					{ tag: "bad", start: "oops", end: 1 },
				],
			},
			{
				family: "../invalid",
				variable: true,
				category: "sans-serif",
				axes: [],
			},
			{
				family: "Missing Bits",
				variable: "yes",
				category: "sans-serif",
			},
		];

		try {
			await resetGoogleFontCacheForTests();
			const entriesJson = JSON.stringify(entries);
			const crypto = await import("node:crypto");
			const checksum = crypto.createHash("sha256").update(entriesJson).digest("hex");
			writeFileSync(cacheFile, JSON.stringify({ checksum, entries }));

			await expect(loadFontCache(true)).resolves.toBe(true);
			expect(googleFontInternals.googleFontState.cache.size).toBe(1);
			expect(googleFontInternals.googleFontState.cache.get("Inter")?.axes).toEqual([
				{ tag: "wght", start: 100, end: 900 },
				{ tag: "wdth", start: 75, end: 125 },
			]);

			// A bare entries array (a format saveFontCache never wrote) bypasses
			// the checksum, so it must be rejected outright.
			await resetGoogleFontCacheForTests();
			writeFileSync(cacheFile, entriesJson);
			await expect(loadFontCache(true)).resolves.toBe(false);
		} finally {
			process.chdir(originalCwd);
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			await resetGoogleFontCacheForTests();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("loadFontCache respects expiry and clamps oversized TTL values", async () => {
		const originalCacheDir = process.env.RI_CACHE_DIR;
		const originalTTL = process.env.RI_FONT_CACHE_TTL;
		const originalCwd = process.cwd();
		const root = join(
			tmpdir(),
			`ri-google-expiry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		const relCacheDir = ".ri-cache";
		const cacheFile = join(root, relCacheDir, "google.json");
		const validEntries = [
			{
				family: "Inter",
				variable: true,
				category: "sans-serif",
				axes: [{ tag: "wght", start: 100, end: 900 }],
			},
		];
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		mkdirSync(join(root, relCacheDir), { recursive: true });
		process.chdir(root);
		process.env.RI_CACHE_DIR = relCacheDir;
		process.env.RI_FONT_CACHE_TTL = String(31 * 24 * 60 * 60);

		try {
			await resetGoogleFontCacheForTests();
			const entriesJson = JSON.stringify(validEntries);
			const crypto = await import("node:crypto");
			const checksum = crypto.createHash("sha256").update(entriesJson).digest("hex");
			writeFileSync(cacheFile, JSON.stringify({ checksum, entries: validEntries }));
			const staleTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
			utimesSync(cacheFile, staleTime, staleTime);

			await expect(loadFontCache()).resolves.toBe(false);
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[RI-1211]"));
		} finally {
			warnSpy.mockRestore();
			process.chdir(originalCwd);
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			if (originalTTL === undefined) {
				process.env.RI_FONT_CACHE_TTL = undefined;
			} else {
				process.env.RI_FONT_CACHE_TTL = originalTTL;
			}
			await resetGoogleFontCacheForTests();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("saveFontCache writes checksum payloads to disk", async () => {
		const originalCacheDir = process.env.RI_CACHE_DIR;
		const originalCwd = process.cwd();
		const root = join(
			tmpdir(),
			`ri-google-save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		const relCacheDir = ".ri-cache";
		mkdirSync(root, { recursive: true });
		process.chdir(root);
		process.env.RI_CACHE_DIR = relCacheDir;

		try {
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
							axes: [{ tag: "wght", start: 100, end: 900 }],
						},
					],
				]),
			};

			await saveFontCache();

			const payload = JSON.parse(readFileSync(join(root, relCacheDir, "google.json"), "utf-8")) as {
				checksum: string;
				entries: unknown[];
			};
			expect(payload.checksum).toMatch(/^[a-f0-9]{64}$/);
			expect(payload.entries).toHaveLength(1);
		} finally {
			process.chdir(originalCwd);
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			await resetGoogleFontCacheForTests();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("saveFontCache leaves no temp files behind on success or failure", async () => {
		const originalCacheDir = process.env.RI_CACHE_DIR;
		const originalCwd = process.cwd();
		const root = join(
			tmpdir(),
			`ri-google-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		const relCacheDir = ".ri-cache";
		mkdirSync(root, { recursive: true });
		process.chdir(root);
		process.env.RI_CACHE_DIR = relCacheDir;
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const cacheDir = join(root, relCacheDir);
		const listTempFiles = () =>
			readdirSync(cacheDir).filter((name) => name.startsWith(".google-") && name.endsWith(".tmp"));

		try {
			await resetGoogleFontCacheForTests();
			googleFontInternals.googleFontState = {
				fetched: true,
				cache: new Map([["Inter", { family: "Inter", variable: true, category: "sans-serif" }]]),
			};

			await saveFontCache();
			expect(listTempFiles()).toEqual([]);

			// Failure path: a directory squatting on the destination makes the
			// rename fail — the temp file must still be cleaned up (RI-1210 warned).
			await resetGoogleFontCacheForTests();
			googleFontInternals.googleFontState = {
				fetched: true,
				cache: new Map([["Inter", { family: "Inter", variable: true, category: "sans-serif" }]]),
			};
			rmSync(join(cacheDir, "google.json"));
			mkdirSync(join(cacheDir, "google.json"));
			await saveFontCache();
			expect(listTempFiles()).toEqual([]);
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[RI-1210]"));
		} finally {
			warnSpy.mockRestore();
			process.chdir(originalCwd);
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			await resetGoogleFontCacheForTests();
			rmSync(root, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// refreshFontWeightDefaults — explicit weight preservation
// ---------------------------------------------------------------------------

describe("refreshFontWeightDefaults", () => {
	it("is a no-op when Google Fonts metadata has not been loaded", async () => {
		await resetGoogleFontCacheForTests();
		const slot = makeSlot();
		// Google defaults: weight "100 900", style "normal italic". Without
		// metadata, refreshFontWeightDefaults has no basis to narrow them.
		const result = refreshFontWeightDefaults([slot]);
		expect(result[0].faces[0].weight).toBe("100 900");
		expect(result[0].faces[0].style).toBe("normal italic");
	});

	it("narrows weight to the actual wght axis when metadata is loaded", async () => {
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
						axes: [
							{ tag: "wght", start: 200, end: 800 },
							{ tag: "ital", start: 0, end: 1 },
						],
					},
				],
			]),
		};
		const result = refreshFontWeightDefaults([makeSlot()]);
		expect(result[0].faces[0].weight).toBe("200 800");
		expect(result[0].faces[0].style).toBe("normal italic");
		expect(getGoogleFontMeta("Inter")?.family).toBe("Inter");
	});

	it("narrows weight to 400 for static-weight fonts", async () => {
		await resetGoogleFontCacheForTests();
		googleFontInternals.googleFontState = {
			fetched: true,
			cache: new Map([
				[
					"Lobster",
					{
						family: "Lobster",
						variable: false,
						category: "display",
						axes: [],
					},
				],
			]),
		};
		const result = refreshFontWeightDefaults([makeSlot({ slot: "display", family: "Lobster" })]);
		expect(result[0].faces[0].weight).toBe("400");
	});

	it("narrows style to 'normal' when the font has no ital axis", async () => {
		await resetGoogleFontCacheForTests();
		googleFontInternals.googleFontState = {
			fetched: true,
			cache: new Map([
				[
					"Roboto Slab",
					{
						family: "Roboto Slab",
						variable: true,
						category: "serif",
						axes: [{ tag: "wght", start: 100, end: 900 }],
					},
				],
			]),
		};
		const result = refreshFontWeightDefaults([makeSlot({ slot: "serif", family: "Roboto Slab" })]);
		expect(result[0].faces[0].style).toBe("normal");
	});

	it("respects _weightExplicit", () => {
		const slot = makeSlot();
		slot.faces[0].weight = "400";
		slot.faces[0]._weightExplicit = true;
		googleFontInternals.googleFontState = {
			fetched: true,
			cache: new Map([
				[
					"Inter",
					{
						family: "Inter",
						variable: true,
						category: "sans-serif",
						axes: [{ tag: "wght", start: 100, end: 900 }],
					},
				],
			]),
		};

		const result = refreshFontWeightDefaults([slot]);

		expect(result[0].faces[0].weight).toBe("400");
		expect(slot.faces[0].weight).toBe("400");
	});

	it("respects _styleExplicit", () => {
		const slot = makeSlot({ family: "Lobster" });
		slot.faces[0].style = "normal italic";
		slot.faces[0]._styleExplicit = true;
		googleFontInternals.googleFontState = {
			fetched: true,
			cache: new Map([
				[
					"Lobster",
					{
						family: "Lobster",
						variable: false,
						category: "display",
						axes: [],
					},
				],
			]),
		};

		const result = refreshFontWeightDefaults([slot]);

		// Metadata says no ital axis, but user explicitly requested italic — respect it.
		expect(result[0].faces[0].style).toBe("normal italic");
	});

	it("skips non-google slots", () => {
		const slot = makeSlot({ kind: "system" });
		const result = refreshFontWeightDefaults([slot]);
		expect(result[0].faces[0].weight).toBe("400");
		expect(result[0].faces[0].style).toBe("normal");
	});
});

describe("resolveGoogleFonts", () => {
	it("returns the original array when no google fonts are present", async () => {
		const fonts = [makeSlot({ kind: "system" })];
		await expect(resolveGoogleFonts(fonts)).resolves.toBe(fonts);
	});

	it("resolves google font weights through resolveGoogleFonts", async () => {
		await resetGoogleFontCacheForTests();
		const root = join(
			tmpdir(),
			`ri-google-resolve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		const relCacheDir = ".ri-cache";
		const cacheFile = join(root, relCacheDir, "google.json");
		const originalCacheDir = process.env.RI_CACHE_DIR;
		const originalFetchFonts = process.env.RI_FETCH_FONTS;
		const originalCwd = process.cwd();
		const resolver = resolveGoogleFonts;
		const fonts = [makeSlot()];
		const validEntries = [
			{
				family: "Inter",
				variable: true,
				category: "sans-serif",
				axes: [{ tag: "wght", start: 100, end: 900 }],
			},
		];

		mkdirSync(join(root, relCacheDir), { recursive: true });
		process.chdir(root);
		process.env.RI_CACHE_DIR = relCacheDir;
		process.env.RI_FETCH_FONTS = "0";

		try {
			await resetGoogleFontCacheForTests();
			const entriesJson = JSON.stringify(validEntries);
			const crypto = await import("node:crypto");
			const checksum = crypto.createHash("sha256").update(entriesJson).digest("hex");
			writeFileSync(cacheFile, JSON.stringify({ checksum, entries: validEntries }));

			const resolved = await resolver(fonts);
			expect(resolved[0].faces[0].weight).toBe("100 900");
		} finally {
			process.chdir(originalCwd);
			if (originalCacheDir === undefined) {
				process.env.RI_CACHE_DIR = undefined;
			} else {
				process.env.RI_CACHE_DIR = originalCacheDir;
			}
			if (originalFetchFonts === undefined) {
				process.env.RI_FETCH_FONTS = undefined;
			} else {
				process.env.RI_FETCH_FONTS = originalFetchFonts;
			}
			await resetGoogleFontCacheForTests();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
