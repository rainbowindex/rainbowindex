/**
 * Marker classes — `group`, `peer`, and their named forms.
 *
 * A marker is worn by an element so a relational variant has something to
 * anchor on: `group-hover:underline` compiles to `.group:hover &`, which only
 * matches when an ancestor carries `group`. The marker itself has no
 * declarations — Tailwind emits nothing for it either — which is exactly why it
 * cannot live among the utility resolvers. A resolver returning null means "no
 * such class", and a marker is a class.
 */

/**
 * A named anchor is one identifier.
 *
 * Shared with `splitRelationalName` in the variant resolver so the two can
 * never disagree: a name that `group-hover/item:` accepts as an anchor is
 * exactly a name that `group/item` validates as a marker.
 */
export const RELATIONAL_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** The two relational roots. */
const MARKER_ROOTS: ReadonlySet<string> = new Set(["group", "peer"]);

/** True for `group`, `peer`, `group/item`, `peer/sidebar`. */
export function isMarkerUtility(utility: string): boolean {
	const slash = utility.indexOf("/");
	if (slash === -1) return MARKER_ROOTS.has(utility);
	// The name pattern forbids a second slash, so `group/a/b` and a bare
	// `group/` are both rejected here rather than resolving to a broken anchor.
	return (
		MARKER_ROOTS.has(utility.slice(0, slash)) && RELATIONAL_NAME_RE.test(utility.slice(slash + 1))
	);
}
