import { describe, expect, test } from "vitest";
import { defaultRiCache } from "../../src/merge/context.js";
import { ri } from "../../src/merge/index.js";

type ClassInput = Parameters<typeof ri>[number];

// ---------------------------------------------------------------------------
// Raw-key cache fast path with falsy arguments
//
// Falsy args (false/null/undefined/''/0/NaN) are dropped by flattenInputs, so
// they must contribute nothing to the raw cache key — and calls containing
// them must produce output identical to the flatten path (forced here via an
// array argument, which always bails to flattening).
// ---------------------------------------------------------------------------

const FALSY: ClassInput[] = [
	false,
	null,
	undefined,
	"",
	0 as unknown as ClassInput,
	Number.NaN as unknown as ClassInput,
];

describe("ri() falsy-arg fast path", () => {
	test("conditional pattern equals the plain call", () => {
		expect(ri("flex", false && "x")).toBe(ri("flex"));
		expect(ri("flex", false && "x")).toBe("flex");
	});

	test("every falsy type, in every position, matches the flatten path", () => {
		for (const falsy of FALSY) {
			// falsy leading / middle / trailing — array form forces the flatten path
			expect(ri(falsy, "p-2 bg-red-500", "p-4")).toBe(ri(["p-2 bg-red-500", "p-4"]));
			expect(ri("p-2 bg-red-500", falsy, "p-4")).toBe(ri(["p-2 bg-red-500", "p-4"]));
			expect(ri("p-2 bg-red-500", "p-4", falsy)).toBe(ri(["p-2 bg-red-500", "p-4"]));
			expect(ri("p-2 bg-red-500", falsy, "p-4")).toBe("bg-red-500 p-4");
		}
	});

	test("falsy args do not poison the cache entry of the plain call", () => {
		// Prime the cache through the falsy-arg spelling, then read via the plain one.
		expect(ri("mx-2", false, "mx-4")).toBe("mx-4");
		expect(ri("mx-2", "mx-4")).toBe("mx-4");
		// And the reverse order: prime plain, read falsy.
		expect(ri("my-2", "my-4")).toBe("my-4");
		expect(ri("my-2", null, "my-4")).toBe("my-4");
	});

	test("repeat calls (cache hits) stay correct", () => {
		const first = ri("flex", undefined, "items-center");
		const second = ri("flex", undefined, "items-center");
		expect(first).toBe("flex items-center");
		expect(second).toBe(first);
	});

	test("all-falsy and empty calls return empty string", () => {
		expect(ri()).toBe("");
		expect(ri(...FALSY)).toBe("");
		expect(ri("")).toBe("");
	});

	test("arrays still work (flatten path)", () => {
		expect(ri("flex", ["p-2", "p-4"])).toBe("flex p-4");
		expect(ri(["flex", [false, "items-center"]])).toBe("flex items-center");
	});

	test("truthy non-string args are skipped, not stringified", () => {
		expect(ri("flex", 5 as unknown as ClassInput)).toBe("flex");
		expect(ri("flex", { p: 4 } as unknown as ClassInput)).toBe("flex");
	});

	test("falsy-arg calls populate the raw-key cache (fast path taken)", () => {
		// Multi-token first arg so the raw key ("mk-1 mk-2\x00mk-3") differs from
		// the token-join key the flatten path would store ("mk-1\x00mk-2\x00mk-3") —
		// this fails if falsy args ever knock the call off the fast path again.
		ri("mk-1 mk-2", false, undefined, "mk-3");
		expect(defaultRiCache.has("mk-1 mk-2\x00mk-3")).toBe(true);
	});

	test("raw keys keep argument boundaries (no concatenation collisions)", () => {
		// Prime "zz-a9" first: if falsy-skipping ever dropped the \x00 separator,
		// the second call would collide with it and return the cached "zz-a9".
		expect(ri("zz-a9")).toBe("zz-a9");
		expect(ri("zz-a", false, "9")).toBe("zz-a 9");
	});

	test("oversized keys bypass the cache but merge correctly", () => {
		// 5 args of ~445 chars: each token stays under the 500-char class limit,
		// but the joined raw key (~2200 chars) exceeds RI_CACHE_KEY_MAX_LEN (2048).
		const parts = Array.from({ length: 5 }, (_, i) => `zz-${i}-${"x".repeat(440)}`);
		expect(ri(parts[0], false, parts[1], parts[2], parts[3], parts[4])).toBe(parts.join(" "));
		expect(defaultRiCache.has(parts.join("\x00"))).toBe(false);
	});
});
