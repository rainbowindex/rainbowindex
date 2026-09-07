/**
 * Deterministic PRNG for fixture generation.
 *
 * The fixtures must be byte-identical for a given seed on every machine, or a
 * benchmark run is not comparable with the one before it. `Math.random()` is
 * seedless, so this is mulberry32 — 32 bits of state, uniform enough for
 * picking class names, and about as fast as a multiply.
 */

/** @param {number} seed */
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function next() {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Zipf-distributed index into `[0, n)`: real markup reuses a handful of
 * utilities on almost every element and reaches for the rest rarely, so a
 * uniform draw would overstate every engine's cache miss rate.
 *
 * @param {() => number} rand
 * @param {number} n
 * @param {number} [s] skew; 1.1 puts ~30% of draws on the first 10 entries
 */
export function zipf(rand, n, s = 1.1) {
	// Inverse-transform on the continuous approximation of the Zipf CDF.
	const u = rand();
	const idx = Math.floor((n + 1) ** (u ** (1 / s))) - 1;
	return Math.min(n - 1, Math.max(0, idx));
}

/**
 * @template T
 * @param {() => number} rand
 * @param {readonly T[]} items
 * @returns {T}
 */
export function pick(rand, items) {
	return items[Math.floor(rand() * items.length)];
}

/**
 * @template T
 * @param {() => number} rand
 * @param {readonly T[]} items
 * @returns {T}
 */
export function pickZipf(rand, items) {
	return items[zipf(rand, items.length)];
}

/**
 * @param {() => number} rand
 * @param {number} lo inclusive
 * @param {number} hi inclusive
 */
export function between(rand, lo, hi) {
	return lo + Math.floor(rand() * (hi - lo + 1));
}
