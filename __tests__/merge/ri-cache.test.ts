import { describe, expect, test } from "vitest";
import { defaultRiCache, RI_CACHE_MAX, RiCache } from "../../src/merge/context.js";
import { ri } from "../../src/merge/index.js";

// ---------------------------------------------------------------------------
// Two-generation ri() cache contract: plain-Map.get hits in the current
// generation, promotion from the previous one, a ~2x-max size bound, and a
// clear() that empties both generations.
// ---------------------------------------------------------------------------

describe("RiCache", () => {
	test("get returns what put stored, misses return undefined", () => {
		const cache = new RiCache(4);
		cache.put("a", "A");
		expect(cache.get("a")).toBe("A");
		expect(cache.get("missing")).toBeUndefined();
		expect(cache.has("a")).toBe(true);
		expect(cache.has("missing")).toBe(false);
	});

	test("hits promote entries across generation swaps; cold keys age out", () => {
		const cache = new RiCache(4);
		cache.put("a", "A");
		cache.put("b", "B");
		cache.put("c", "C");
		cache.put("d", "D"); // generation swap: a–d become the previous generation
		expect(cache.get("a")).toBe("A"); // promoted into the current generation
		cache.put("e", "E");
		cache.put("f", "F");
		cache.put("g", "G"); // second swap: the un-promoted a–d generation drops
		expect(cache.get("a")).toBe("A"); // survived via promotion
		expect(cache.get("b")).toBeUndefined(); // aged out with the dropped generation
	});

	test("never grows past twice the bound", () => {
		const cache = new RiCache(4);
		for (let i = 0; i < 40; i++) cache.put(`k${i}`, String(i));
		expect(cache.size).toBeLessThanOrEqual(8);
	});

	test("clear empties both generations", () => {
		const cache = new RiCache(2);
		cache.put("a", "A");
		cache.put("b", "B"); // swap: a–b move to the previous generation
		cache.put("c", "C");
		expect(cache.size).toBe(3);
		cache.clear();
		expect(cache.size).toBe(0);
		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("c")).toBeUndefined();
	});
});

describe("ri() default cache", () => {
	test("repeated identical calls hit the cache and stay correct", () => {
		const first = ri("p-2 bg-red-500", "p-4");
		expect(first).toBe("bg-red-500 p-4");
		expect(defaultRiCache.has("p-2 bg-red-500\x00p-4")).toBe(true);
		expect(ri("p-2 bg-red-500", "p-4")).toBe(first);
	});

	test("stays bounded when filled past twice the max", () => {
		for (let i = 0; i < RI_CACHE_MAX * 2 + 50; i++) ri(`zz-${i}`);
		expect(defaultRiCache.size).toBeLessThanOrEqual(RI_CACHE_MAX * 2);
	});
});
