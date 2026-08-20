import { describe, expect, it } from "vitest";
import { scanBracketAware } from "../../src/brackets.js";
// evictLRU is the merge runtime's cache-eviction policy — it lives with the
// ri() cache it serves, not with the bracket scanner it used to share a file with.
import { evictLRU } from "../../src/merge/index.js";

describe("evictLRU", () => {
	it("does nothing while the cache is still below max size", () => {
		const cache = new Map([
			["a", 1],
			["b", 2],
			["c", 3],
		]);
		evictLRU(cache, 4);
		expect([...cache.entries()]).toEqual([
			["a", 1],
			["b", 2],
			["c", 3],
		]);
	});

	it("evicts the oldest 25% of entries once max size is reached", () => {
		const cache = new Map([
			["a", 1],
			["b", 2],
			["c", 3],
			["d", 4],
		]);
		evictLRU(cache, 4);
		expect([...cache.keys()]).toEqual(["b", "c", "d"]);
	});

	it("evicts multiple entries for larger caches", () => {
		const cache = new Map(Array.from({ length: 8 }, (_, i) => [`k${i}`, i] as const));
		evictLRU(cache, 8);
		expect([...cache.keys()]).toEqual(["k2", "k3", "k4", "k5", "k6", "k7"]);
	});
});

describe("scanBracketAware", () => {
	it("tracks depth while scanning left to right", () => {
		const seen: Array<[string, number, number]> = [];
		scanBracketAware("a[b(c)d]e", (ch, index, depth) => {
			seen.push([ch, index, depth]);
		});
		expect(seen).toEqual([
			["a", 0, 0],
			["[", 1, 1],
			["b", 2, 1],
			["(", 3, 2],
			["c", 4, 2],
			[")", 5, 1],
			["d", 6, 1],
			["]", 7, 0],
			["e", 8, 0],
		]);
	});

	it("never drops below zero depth when encountering unmatched closers", () => {
		const depths: number[] = [];
		scanBracketAware("a])b", (_ch, _index, depth) => {
			depths.push(depth);
		});
		expect(depths).toEqual([0, 0, 0, 0]);
	});

	it("skips escaped characters while scanning left to right", () => {
		const seen: Array<[string, number, number]> = [];
		scanBracketAware(String.raw`a\[b\]c[d]`, (ch, index, depth) => {
			seen.push([ch, index, depth]);
		});
		expect(seen).toEqual([
			["a", 0, 0],
			["b", 3, 0],
			["c", 6, 0],
			["[", 7, 1],
			["d", 8, 1],
			["]", 9, 0],
		]);
	});

	it("tracks depth correctly in reverse scans", () => {
		const seen: Array<[string, number, number]> = [];
		scanBracketAware(
			"a[b(c)d]e",
			(ch, index, depth) => {
				seen.push([ch, index, depth]);
			},
			{ reverse: true },
		);
		expect(seen).toEqual([
			["e", 8, 0],
			["]", 7, 1],
			["d", 6, 1],
			[")", 5, 2],
			["c", 4, 2],
			["(", 3, 1],
			["b", 2, 1],
			["[", 1, 0],
			["a", 0, 0],
		]);
	});

	it("never drops below zero depth on unmatched openers in reverse scans", () => {
		const depths: number[] = [];
		scanBracketAware(
			"a[b",
			(_ch, _index, depth) => {
				depths.push(depth);
			},
			{ reverse: true },
		);
		// b (0), [ would close an unopened bracket — clamped to 0, a (0)
		expect(depths).toEqual([0, 0, 0]);
	});

	it("treats escaped closing brackets as literal in reverse scans", () => {
		const seen: Array<[string, number, number]> = [];
		scanBracketAware(
			String.raw`a\\]b[c]`,
			(ch, index, depth) => {
				seen.push([ch, index, depth]);
			},
			{ reverse: true },
		);
		expect(seen).toEqual([
			["]", 7, 1],
			["c", 6, 1],
			["[", 5, 0],
			["b", 4, 0],
			["]", 3, 1],
			["a", 0, 1],
		]);
	});

	it("supports early exit when the callback returns true", () => {
		const seen: string[] = [];
		scanBracketAware("abc[def]", (ch) => {
			seen.push(ch);
			return ch === "[";
		});
		expect(seen).toEqual(["a", "b", "c", "["]);
	});
});
