import { describe, expect, it, test, vi } from "vitest";
import * as browser from "../../src/entries/browser.js";
import browserDefault, { defaultTheme, ri, safelist } from "../../src/entries/browser.js";
import { createThemeSnapshot } from "../../src/engine/index.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";

describe("rainbowindex/browser entry", () => {
	test("re-exports the client-safe surface", () => {
		expect(defaultTheme).toBeDefined();
		expect(safelist("flex", false, "px-4")).toBe("flex px-4");
		expect(ri("px-2 py-1", "p-4")).toBe("p-4");
	});

	test("default export fails loudly instead of resolving the PostCSS plugin", () => {
		// Browser bundles must not silently no-op when someone does
		// `import rainbowindex from "rainbowindex"` in client code.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(() => browserDefault()).toThrow(/RI-2003/);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("RI-2003"));
		warn.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// C1 — theme-aware ri() on the client
// ---------------------------------------------------------------------------

/**
 * The browser entry never runs a compile, so the module state ri() reads is
 * empty. Since 0.6.0 every text size, weight, font slot, and bare color name is
 * project-defined, so a client-side `ri("text-lg text-white")` classifies
 * `text-lg` as a color and drops it — silently, since devWarn is stripped from
 * production bundles.
 *
 * The fix is a snapshot that survives JSON: the build side serializes the
 * theme, the client hydrates and publishes it before any ri() call. This test
 * was written first, red by design, and went green when C1 landed. The
 * missing-API guard below stays: it names what a client needs, so removing one
 * of the three fails here rather than somewhere far away.
 */
interface SnapshotWireApi {
	serializeSnapshot: (snapshot: browser.CompilationSnapshot) => unknown;
	hydrateSnapshot: (data: unknown) => browser.CompilationSnapshot;
	publishSnapshot: (snapshot: browser.CompilationSnapshot) => void;
}

describe("client-side ri() honors a published theme snapshot", () => {
	it("client ri() keeps a project text size", () => {
		const api = browser as Partial<SnapshotWireApi>;
		const { serializeSnapshot, hydrateSnapshot, publishSnapshot } = api;
		expect(
			Boolean(serializeSnapshot && hydrateSnapshot && publishSnapshot),
			"rainbowindex/browser must export serializeSnapshot / hydrateSnapshot / " +
				"publishSnapshot — without all three a theme cannot reach the client.",
		).toBe(true);
		if (!(serializeSnapshot && hydrateSnapshot && publishSnapshot)) return;

		// The build side: a theme with one project-defined text size.
		const built = createThemeSnapshot(analyzeProjectCSS("@text { lg: 1.125rem, 1.5; }").theme);

		try {
			// Over the wire, then published by the client before the first ri() call.
			const wire = JSON.parse(JSON.stringify(serializeSnapshot(built))) as unknown;
			publishSnapshot(hydrateSnapshot(wire));

			// `text-lg` is a size and `text-white` a color: different properties, so
			// neither wins and both survive.
			expect(ri("text-lg text-white")).toBe("text-lg text-white");
		} finally {
			// Module-level state: restore the empty default so the tests above stay
			// independent of the order this file runs in.
			publishSnapshot(createThemeSnapshot(analyzeProjectCSS("").theme));
		}
	});
});
