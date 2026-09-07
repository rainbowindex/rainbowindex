/**
 * `outermostCandidates` — the candidates that correspond to what was typed.
 *
 * The scanner over-collects on purpose. It is a lexer, not a parser, and a
 * class it invents costs nothing: an unknown utility compiles to no rule. So
 * in JavaScript, where `:` is also a ternary and an object key, it emits both
 * the joined token and the fragments around each colon —
 * `sm:hover:focus:flex` arrives as four candidates, three of whose spans sit
 * inside the fourth. The HTML extractor, which has no such ambiguity, emits
 * one.
 *
 * For a build that asymmetry is invisible. For anything that maps a candidate
 * back to a *place in the source* — an underline, a quick fix, a hover — it is
 * a defect: an editor would report `sm` in `sm:flex` as an unknown class,
 * which is both wrong and impossible to act on. This is the filter that turns
 * the scanner's candidate stream into one entry per class the author wrote.
 *
 * Kept out of the scanner deliberately. The extra candidates are the
 * over-collection working as designed, and the compile path is entitled to
 * them; it is the editor path that wants one candidate per class.
 */

import type { ClassCandidate } from "../scanner/class-extraction.js";

interface Span {
	start: number;
	end: number;
}

/** Last index in `sorted` whose start satisfies the comparison, or -1. */
function lastIndexWithStart(starts: readonly number[], value: number, inclusive: boolean): number {
	let low = 0;
	let high = starts.length - 1;
	let found = -1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (inclusive ? starts[mid] <= value : starts[mid] < value) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return found;
}

/**
 * Drop every candidate whose source span lies inside another candidate's span.
 *
 * A candidate is dropped when some other span strictly contains it — another
 * candidate's own span, or the `groupPrefix` span a variant-group member
 * points back at, which is what covers the stray `hover` in
 * `hover:{px-2 py-1}`. Two candidates over the identical span keep the first
 * in input order. Everything kept is returned in source order.
 *
 * Origins are untouched: filter to `attribute` / `helper` / `safelist` first
 * if prose and bare identifiers are not wanted either.
 */
export function outermostCandidates(candidates: readonly ClassCandidate[]): ClassCandidate[] {
	if (candidates.length < 2) return [...candidates];

	const spans: Span[] = [];
	for (const candidate of candidates) {
		spans.push({ start: candidate.start, end: candidate.end });
		if (candidate.groupPrefix) spans.push(candidate.groupPrefix);
	}
	spans.sort((a, b) => a.start - b.start || a.end - b.end);
	const starts = spans.map((span) => span.start);
	// prefixMaxEnd[i] — the furthest any span among spans[0..i] reaches.
	const prefixMaxEnd: number[] = new Array(spans.length);
	let running = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < spans.length; i++) {
		running = Math.max(running, spans[i].end);
		prefixMaxEnd[i] = running;
	}

	const seenSpans = new Set<string>();
	const kept: ClassCandidate[] = [];
	for (const candidate of candidates) {
		// A span that starts at or before this one and ends *past* it contains
		// it; so does one that starts strictly before and merely reaches its
		// end. Together those are exactly "strictly contains".
		const atOrBefore = lastIndexWithStart(starts, candidate.start, true);
		const before = lastIndexWithStart(starts, candidate.start, false);
		const reachAtOrBefore = atOrBefore === -1 ? Number.NEGATIVE_INFINITY : prefixMaxEnd[atOrBefore];
		const reachBefore = before === -1 ? Number.NEGATIVE_INFINITY : prefixMaxEnd[before];
		if (reachAtOrBefore > candidate.end || reachBefore >= candidate.end) continue;

		const key = `${candidate.start}:${candidate.end}`;
		if (seenSpans.has(key)) continue;
		seenSpans.add(key);
		kept.push(candidate);
	}
	kept.sort((a, b) => a.start - b.start);
	return kept;
}
