/**
 * Class strings for the incremental-rebuild scenario.
 *
 * Every iteration must present a class no iteration before it did, or the
 * engines' candidate caches turn the second and later rebuilds into no-ops and
 * the scenario measures nothing. Arbitrary values are the one shape guaranteed
 * to be unbounded and unique, and all three engines compile them from scratch.
 */

/** @param {number} nth */
export function makeClass(nth) {
	// Cycle the property so the work is not always the same resolver, and vary
	// the value so no two iterations share a candidate.
	const props = ["w", "h", "top", "left", "p", "m", "gap", "text"];
	const prop = props[nth % props.length];
	return `${prop}-[${1000 + nth}px]`;
}
