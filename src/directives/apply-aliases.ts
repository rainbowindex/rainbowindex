/**
 * Shared definitions for `@apply` and its at-rule aliases.
 *
 * Kept in a dedicated leaf module (no other imports) so the browser-safe
 * engine/utilities/merge code can pull these helpers without dragging in
 * parsers.ts or font-providers (which use node:crypto).
 */

/** At-rule names that are aliases for @apply. Single source of truth. */
export const APPLY_ALIASES: readonly string[] = Object.freeze(["a"]);

/** Pipe-joined alternation of @apply and its aliases for regex use. */
const APPLY_LIKE_NAMES = ["apply", ...APPLY_ALIASES].join("|");

/** Flagless (stateless) detector — hoisted because hasApplyLikeDirective runs
 *  once per custom-utility resolution; a per-call `new RegExp` is pure waste. */
const APPLY_LIKE_RE = new RegExp(`@(?:${APPLY_LIKE_NAMES})\\b`);

/** Detect whether a string contains an `@apply` (or alias) at-rule. Stateless. */
export function hasApplyLikeDirective(src: string): boolean {
	return APPLY_LIKE_RE.test(src);
}

/** g-flagged regex matching `@apply <classes>` (or alias) up to `;{}`, capturing
 *  the classes. Safe to share because every consumer uses `matchAll`, which
 *  clones the regex and never advances this instance's `lastIndex` — do not use
 *  it with bare `exec()`/`test()` loops. */
export const APPLY_LIKE_MATCH_RE = new RegExp(`@(?:${APPLY_LIKE_NAMES})\\s+([^;{}]+)`, "g");
