/**
 * Shorthand → longhand override closure, plus the derived lookup indexes the
 * merge dispatch and the parser share.
 *
 * The claim tables themselves live next door — static-props.ts (keyed by whole
 * class name), prefix-props.ts (keyed by prefix) — and the value predicates in
 * value-kinds.ts. This module is what the two tables add up to.
 */

import { BUILTIN_STATIC_PROPS } from "./static-props.js";
import { PREFIX_PROPS } from "./prefix-props.js";

/**
 * Shorthand CSS properties → the longhand properties they directly decompose
 * into. Entries list only DIRECT longhands; the exported OVERRIDES below is
 * this table's transitive closure, computed once at module init — so a
 * shorthand's claim set can never silently miss a transitive leaf (claim
 * expansion in merge/index.ts is single-level by design).
 */
const DIRECT_OVERRIDES: Record<string, readonly string[]> = Object.assign(Object.create(null), {
	padding: ["padding-inline", "padding-block"],
	"padding-inline": ["padding-inline-start", "padding-inline-end"],
	"padding-block": ["padding-block-start", "padding-block-end"],
	margin: ["margin-inline", "margin-block"],
	"margin-inline": ["margin-inline-start", "margin-inline-end"],
	"margin-block": ["margin-block-start", "margin-block-end"],
	gap: ["column-gap", "row-gap"],
	inset: ["inset-inline", "inset-block"],
	"inset-inline": ["inset-inline-start", "inset-inline-end"],
	"inset-block": ["inset-block-start", "inset-block-end"],
	"border-width": ["border-inline-width", "border-block-width"],
	"border-inline-width": ["border-inline-start-width", "border-inline-end-width"],
	"border-block-width": ["border-block-start-width", "border-block-end-width"],
	// Full `border` shorthand ([border:…] arbitrary properties / custom
	// utilities) — the closure reaches every width/style/color leaf.
	border: ["border-width", "border-style", "border-color"],
	"border-radius": [
		"border-start-start-radius",
		"border-start-end-radius",
		"border-end-start-radius",
		"border-end-end-radius",
	],
	overflow: ["overflow-x", "overflow-y"],
	"overscroll-behavior": ["overscroll-behavior-x", "overscroll-behavior-y"],
	"border-color": ["border-inline-color", "border-block-color"],
	"border-inline-color": ["border-inline-start-color", "border-inline-end-color"],
	"border-block-color": ["border-block-start-color", "border-block-end-color"],
	// Unlike width/color, the style intermediates have no OVERRIDES entries of
	// their own (nothing claims them alone), so this entry stays flat.
	"border-style": [
		"border-inline-style",
		"border-block-style",
		"border-block-start-style",
		"border-block-end-style",
		"border-inline-start-style",
		"border-inline-end-style",
	],
	"scroll-margin": ["scroll-margin-inline", "scroll-margin-block"],
	"scroll-margin-inline": ["scroll-margin-inline-start", "scroll-margin-inline-end"],
	"scroll-margin-block": ["scroll-margin-block-start", "scroll-margin-block-end"],
	"scroll-padding": ["scroll-padding-inline", "scroll-padding-block"],
	"scroll-padding-inline": ["scroll-padding-inline-start", "scroll-padding-inline-end"],
	"scroll-padding-block": ["scroll-padding-block-start", "scroll-padding-block-end"],
	flex: ["flex-grow", "flex-shrink", "flex-basis"],
	transition: [
		"transition-property",
		"transition-duration",
		"transition-timing-function",
		"transition-delay",
	],
	animation: [
		"animation-name",
		"animation-duration",
		"animation-timing-function",
		"animation-delay",
		"animation-iteration-count",
		"animation-direction",
		"animation-fill-mode",
		"animation-play-state",
	],
	"text-decoration": [
		"text-decoration-line",
		"text-decoration-style",
		"text-decoration-color",
		"text-decoration-thickness",
	],
	outline: ["outline-width", "outline-style", "outline-color"],
	"grid-column": ["grid-column-start", "grid-column-end"],
	"grid-row": ["grid-row-start", "grid-row-end"],
	background: [
		"background-color",
		"background-image",
		"background-size",
		"background-position",
		"background-repeat",
		"background-attachment",
		"background-origin",
		"background-clip",
	],
	"place-items": ["align-items", "justify-items"],
	"place-content": ["align-content", "justify-content"],
	"place-self": ["align-self", "justify-self"],
	// NOTE: `filter` and `backdrop-filter` deliberately have NO row here.
	// This table is keyed on the CSS property, and every composable member of
	// those families emits the shared shorthand as its second declaration — so
	// a row here made `grayscale` claim `--ri-blur`, and `ri("blur-sm
	// grayscale")` returned `"grayscale"`. The whole family annihilated itself,
	// which is the opposite of the composition the slot variables exist for.
	// The spellings that really do replace the chain claim the slots directly
	// instead; see FILTER_SLOTS.
});

/**
 * Shorthand CSS properties → ALL longhand properties they override — the
 * transitive closure of DIRECT_OVERRIDES (merge/index.ts expands claims one
 * level, so each entry must carry every reachable leaf). Null prototype —
 * see BUILTIN_STATIC_PROPS.
 */
const OVERRIDES: Record<string, readonly string[]> = (() => {
	const closed: Record<string, readonly string[]> = Object.create(null);
	for (const key of Object.keys(DIRECT_OVERRIDES)) {
		const seen = new Set<string>();
		const stack = [...DIRECT_OVERRIDES[key]];
		while (stack.length > 0) {
			const prop = stack.pop();
			if (prop === undefined || seen.has(prop)) continue;
			seen.add(prop);
			const next = DIRECT_OVERRIDES[prop];
			if (next !== undefined) stack.push(...next);
		}
		closed[key] = Object.freeze([...seen]);
	}
	return closed;
})();

// Freeze all three data maps to prevent accidental mutation.
Object.freeze(OVERRIDES);

/** Consumed by utilities/metadata.ts to derive STATIC_UTILITIES (single source of truth). */
export const BUILTIN_STATIC_KEYS = new Set(Object.keys(BUILTIN_STATIC_PROPS));
/** Consumed by utilities/metadata.ts to derive MULTI_SEGMENT_PREFIXES (single source of truth). */
export const PREFIX_PROP_KEYS = new Set(Object.keys(PREFIX_PROPS));
/** Sorted prefix list (longest first) for greedy matching. Internal to PREFIX_FIRST_SEGMENT_MAP. */
const SORTED_PREFIXES = Object.keys(PREFIX_PROPS).sort((a, b) => b.length - a.length);

/**
 * Group prefixes by first segment (before the first dash, or the full prefix
 * if no dash) for O(1) first-segment dispatch instead of an O(N) linear scan.
 * Bucket order preserves input order — callers pass longest-first lists so
 * greedy longest-prefix matching holds. Arrays are frozen because ReadonlyArray
 * only protects TypeScript callers. Shared by the merge dispatch below and the
 * parser's MULTI_SEGMENT_PREFIX_MAP (utilities/parser.ts).
 */
export function buildFirstSegmentMap(
	prefixes: Iterable<string>,
): ReadonlyMap<string, readonly string[]> {
	const map = new Map<string, string[]>();
	for (const prefix of prefixes) {
		const dashIdx = prefix.indexOf("-");
		const firstSeg = dashIdx === -1 ? prefix : prefix.slice(0, dashIdx);
		const existing = map.get(firstSeg);
		if (existing) {
			existing.push(prefix);
		} else {
			map.set(firstSeg, [prefix]);
		}
	}
	const frozen = new Map<string, readonly string[]>();
	for (const [key, arr] of map) {
		frozen.set(key, Object.freeze(arr));
	}
	return frozen;
}

/**
 * First-segment dispatch over every PREFIX_PROPS key, longest-first. For a
 * utility like "border-t-2", the first segment is "border", which maps to
 * ["border-spacing", "border-t", ..., "border"]; the caller then checks each
 * candidate with startsWith for greedy longest-prefix matching.
 */
export const PREFIX_FIRST_SEGMENT_MAP: ReadonlyMap<string, readonly string[]> =
	buildFirstSegmentMap(SORTED_PREFIXES);

export { OVERRIDES };
