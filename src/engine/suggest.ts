/**
 * Typo suggestion helpers using optimal string alignment (OSA) distance —
 * Levenshtein plus adjacent transpositions, so `felx` → `flex` is distance 1.
 * Shared between engine.ts and css-functions.ts.
 */

/** Initial dp row size — covers inputs up to 63 characters without
 *  reallocation. Longer inputs grow the rows once and keep the larger size. */
const DEFAULT_DP_BUF_SIZE = 64;

// Module-level dp rows reused across calls — findClosest is synchronous, so no
// concurrent use is possible. OSA needs one extra row over plain Levenshtein
// (the transposition term reads two rows back).
let rowPrevPrev = new Int32Array(DEFAULT_DP_BUF_SIZE);
let rowPrev = new Int32Array(DEFAULT_DP_BUF_SIZE);
let rowCur = new Int32Array(DEFAULT_DP_BUF_SIZE);

function osaDistance(a: string, b: string, maxDist: number): number {
	const m = a.length;
	const n = b.length;
	if (Math.abs(m - n) > maxDist) return maxDist + 1;
	let prevPrev = rowPrevPrev;
	let prev = rowPrev;
	let cur = rowCur;
	for (let i = 0; i <= m; i++) prev[i] = i;
	for (let j = 1; j <= n; j++) {
		cur[0] = j;
		let rowMin = j;
		for (let i = 1; i <= m; i++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let best = Math.min(cur[i - 1] + 1, prev[i] + 1, prev[i - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				const transposed = prevPrev[i - 2] + 1;
				if (transposed < best) best = transposed;
			}
			cur[i] = best;
			if (best < rowMin) rowMin = best;
		}
		// Early termination: adjacent row minima differ by at most 1, so if this
		// row exceeds maxDist the previous row's minimum is ≥ maxDist and every
		// later cell — including the two-rows-back transposition term, which
		// adds 1 — stays above maxDist. The final distance cannot recover.
		if (rowMin > maxDist) return maxDist + 1;
		const recycled = prevPrev;
		prevPrev = prev;
		prev = cur;
		cur = recycled;
	}
	return prev[m];
}

/**
 * Find the closest match to `input` from a list of candidates.
 * Returns null if no candidate is within `maxDistance`.
 */
export function findClosest(
	input: string,
	candidates: string[],
	maxDistance?: number,
): string | null {
	// Tight thresholds to avoid false suggestions on non-utility tokens.
	// Short strings (< 6 chars) get max 1, longer strings get max 2.
	const threshold = maxDistance ?? (input.length < 6 ? 1 : 2);
	if (input.length < 2 || candidates.length === 0) return null;

	// Rows are indexed 0..input.length (the inner loop dimension) — the outer
	// loop iterates over candidate length, so candidate length never matters.
	if (input.length + 1 > rowPrev.length) {
		rowPrevPrev = new Int32Array(input.length + 1);
		rowPrev = new Int32Array(input.length + 1);
		rowCur = new Int32Array(input.length + 1);
	}

	let best: string | null = null;
	let bestDist = threshold + 1;
	for (const c of candidates) {
		// Skip candidates with very different lengths — unlikely typos
		if (Math.abs(c.length - input.length) > threshold) continue;
		const d = osaDistance(input, c, bestDist - 1);
		if (d < bestDist) {
			bestDist = d;
			best = c;
			if (d === 0) break; // Exact match — no need to continue
		}
	}
	return best;
}
