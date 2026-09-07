/**
 * Shipping a theme to a client — serialize, hydrate, publish.
 *
 * `ri()` decides whether `text-lg` is a font size or a color by asking the
 * published snapshot. A compile publishes one; a browser bundle never compiles.
 * These tests cover the wire format that closes that gap, and the RI-2004
 * warning that fires when nothing published one.
 *
 * Publishing mutates module state, so anything that publishes restores the
 * empty default afterwards — otherwise test order would decide the answers.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createThemeSnapshot } from "../../src/engine/index.js";
import {
	hydrateSnapshot,
	publishSnapshot,
	serializeSnapshot,
	SNAPSHOT_FORMAT,
	type CompilationSnapshot,
	type SerializedSnapshot,
} from "../../src/merge/context.js";
import { createRi, ri } from "../../src/merge/index.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";

const themeFor = (css: string): CompilationSnapshot =>
	createThemeSnapshot(analyzeProjectCSS(css).theme);

/** The state a process has before any compile: no project tokens at all. */
const EMPTY = (): CompilationSnapshot => themeFor("");

/** Round-trip through JSON, the way a generated module or a bundler would. */
const overTheWire = (snapshot: CompilationSnapshot): CompilationSnapshot =>
	hydrateSnapshot(JSON.parse(JSON.stringify(serializeSnapshot(snapshot))));

const RICH_THEME = `
	@text { lg: 1.125rem, 1.5; xl: 1.25rem, 1.5; }
	@color { brand: 0.18 330; }
	@font { display: "Satoshi"; }
	@utility card { border-radius: 4px; box-shadow: 0 0 1px black; }
	@utility glow-* { box-shadow: 0 0 var(--value) gold; }
`;

afterEach(() => {
	publishSnapshot(EMPTY());
});

describe("the snapshot wire format", () => {
	it("survives JSON.stringify, which a raw snapshot does not", () => {
		const snapshot = themeFor(RICH_THEME);

		// The bug this exists to prevent: Sets serialize to {}, silently.
		const naive = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
		expect(naive.textSizes).toEqual({});

		expect(JSON.parse(JSON.stringify(serializeSnapshot(snapshot))).textSizes).toEqual(["lg", "xl"]);
	});

	it("round-trips deep-equal through JSON", () => {
		const snapshot = themeFor(RICH_THEME);
		expect(overTheWire(snapshot)).toEqual(snapshot);
	});

	it("round-trips an empty theme deep-equal", () => {
		const snapshot = EMPTY();
		expect(overTheWire(snapshot)).toEqual(snapshot);
	});

	it("serializes deterministically, so a generated module does not churn", () => {
		const a = serializeSnapshot(themeFor("@color { zed: 0.1 20; alpha: 0.1 20; }"));
		const b = serializeSnapshot(themeFor("@color { alpha: 0.1 20; zed: 0.1 20; }"));
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
		expect(a.colorNames).toEqual([...a.colorNames].sort());
	});

	it("keeps functional roots longest-first, the order the resolver needs", () => {
		const wire = serializeSnapshot(
			themeFor(
				"@utility glow-* { box-shadow: 0 0 1px gold; }\n@utility glow-outer-* { box-shadow: 0 0 2px gold; }",
			),
		);
		const roots = wire.customFunctionalProps.map(([root]) => root);
		expect(roots.indexOf("glow-outer")).toBeLessThan(roots.indexOf("glow"));
	});

	it("stamps the format it was written for", () => {
		expect(serializeSnapshot(themeFor("@text { lg: 1.125rem; }")).format).toBe(SNAPSHOT_FORMAT);
	});

	it("ignores a payload from another format rather than throwing in a client bundle", () => {
		// The one way producer and consumer can disagree: a generated module
		// committed or cached from an older release. Throwing here would throw at
		// import time inside someone's bundle, so it warns and forgets the theme
		// — which leaves `ri()` guessing, loudly, instead of guessing silently.
		const stale = { ...serializeSnapshot(themeFor("@text { lg: 1.125rem; }")), format: 0 };
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const snapshot = hydrateSnapshot(stale as unknown as SerializedSnapshot);
		expect(snapshot.textSizes.size).toBe(0);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("[RI-2007]"));
		warn.mockRestore();
	});

	it("treats anything without a format the same way", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		for (const junk of [null, undefined, 42, "nope", [], { textSizes: "no" }]) {
			const snapshot = hydrateSnapshot(junk as unknown as SerializedSnapshot);
			expect(snapshot.textSizes.size).toBe(0);
			expect(snapshot.colorNames.size).toBe(0);
			// The three built-in slots are not project state; they always exist.
			expect([...snapshot.fontFamilies].sort()).toEqual(["mono", "sans", "serif"]);
		}
		warn.mockRestore();
	});
});

describe("publishing a snapshot changes what the default ri() knows", () => {
	it("keeps a project text size beside a color", () => {
		// The shipped bug: with no theme, `text-lg` is classified as a color and
		// loses to `text-white`.
		expect(ri("text-lg text-white")).toBe("text-white");

		publishSnapshot(overTheWire(themeFor("@text { lg: 1.125rem, 1.5; }")));
		expect(ri("text-lg text-white")).toBe("text-lg text-white");
	});

	it("keeps a project font slot beside a weight", () => {
		expect(ri("font-display font-bold")).toBe("font-bold");

		publishSnapshot(overTheWire(themeFor('@font { display: "Satoshi"; }')));
		expect(ri("font-display font-bold")).toBe("font-display font-bold");
	});

	it("resolves a custom utility's property claims", () => {
		publishSnapshot(overTheWire(themeFor("@utility card { border-radius: 4px; }")));
		// `card` claims border-radius, so a later rounded-* wins it outright.
		expect(ri("card rounded-4")).toBe("rounded-4");
	});

	it("clears the cached results of the previous theme", () => {
		publishSnapshot(overTheWire(themeFor("@text { lg: 1.125rem, 1.5; }")));
		expect(ri("text-lg text-white")).toBe("text-lg text-white");

		// Same input, different theme: a stale cache entry would answer wrongly.
		publishSnapshot(EMPTY());
		expect(ri("text-lg text-white")).toBe("text-white");
	});
});

describe("createRi stays isolated from what is published", () => {
	it("two bound instances disagree, and neither follows the module state", () => {
		const light = createRi(overTheWire(themeFor("@text { lg: 1.125rem, 1.5; }")));
		const none = createRi(EMPTY());

		publishSnapshot(overTheWire(themeFor('@font { display: "Satoshi"; }')));

		// Bound to its own theme: unaffected by the publish, and by each other.
		expect(light("text-lg text-white")).toBe("text-lg text-white");
		expect(none("text-lg text-white")).toBe("text-white");
		// The published theme knows the font slot but not the text size.
		expect(ri("font-display font-bold")).toBe("font-display font-bold");
		expect(ri("text-lg text-white")).toBe("text-white");
	});

	it("a concurrent publish does not change an in-flight instance's answers", async () => {
		const bound = createRi(overTheWire(themeFor("@text { lg: 1.125rem, 1.5; }")));
		const answers = await Promise.all(
			Array.from({ length: 20 }, async (_, i) => {
				if (i % 2 === 0) publishSnapshot(overTheWire(themeFor(`@color { c${i}: 0.1 20; }`)));
				return bound("text-lg text-white");
			}),
		);
		expect(new Set(answers)).toEqual(new Set(["text-lg text-white"]));
	});
});

describe("RI-2004 — merging against no published theme", () => {
	/**
	 * The warning fires once per process, and publishing even an empty theme
	 * turns the check off entirely — so a shared module instance can only ever
	 * show the first outcome. Each of these gets a virgin module graph instead,
	 * which is the only state a real client bundle is ever in.
	 */
	async function freshRi(): Promise<{
		ri: (...inputs: string[]) => string;
		warn: ReturnType<typeof vi.spyOn>;
		restore: () => void;
	}> {
		vi.resetModules();
		const merge = await import("../../src/merge/index.js");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		return { ri: merge.ri, warn, restore: () => warn.mockRestore() };
	}

	afterEach(() => {
		vi.resetModules();
	});

	it("warns once, naming the class it had to guess about", async () => {
		const { ri: freshMerge, warn, restore } = await freshRi();
		freshMerge("text-lg", "text-white");
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain("[RI-2004]");
		expect(warn.mock.calls[0][0]).toContain("text-lg");

		// Once per process: a second offender does not warn again.
		freshMerge("font-display", "font-bold");
		expect(warn).toHaveBeenCalledTimes(1);
		restore();
	});

	it("warns for a class the built-in tables do not claim", async () => {
		const { ri: freshMerge, warn, restore } = await freshRi();
		// `card` is a custom utility under some theme, a typo under none.
		freshMerge("card", "rounded-4");
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain("card");
		restore();
	});

	it("stays quiet for classes whose meaning no theme can change", async () => {
		const { ri: freshMerge, warn, restore } = await freshRi();
		// Built-in statics and prefixes resolve identically under every theme.
		freshMerge("flex", "p-4", "block", "mt-2 mb-2", "bg-red-500 hover:bg-red-600");
		expect(warn).not.toHaveBeenCalled();
		restore();
	});

	it("stays quiet for a single class, which merges to itself", async () => {
		const { ri: freshMerge, warn, restore } = await freshRi();
		freshMerge("text-lg");
		expect(warn).not.toHaveBeenCalled();
		restore();
	});

	it("stays quiet once a theme is published, even an empty one", async () => {
		vi.resetModules();
		const [merge, context, engine, project] = await Promise.all([
			import("../../src/merge/index.js"),
			import("../../src/merge/context.js"),
			import("../../src/engine/index.js"),
			import("../../src/project/analyze.js"),
		]);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		// A single-theme app that publishes at startup is correct, and the old
		// behavior — warning on every SSR call regardless — punished it.
		context.publishSnapshot(engine.createThemeSnapshot(project.analyzeProjectCSS("").theme));
		merge.ri("text-lg", "text-white");
		merge.ri("card", "rounded-4");
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});
