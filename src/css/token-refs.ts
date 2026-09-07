/**
 * Canonical token-reference regexes shared by the token-layer assembler
 * (assembly.ts) and the engine's usage-pruning scanner (engine/index.ts).
 * Both sides must recognize the same reference shapes, or pruning and
 * `:root` emission drift apart.
 *
 * `g`-flag / lastIndex contract: every consumer iterates these with
 * `String.prototype.matchAll()`, which requires the `g` flag and clones the
 * regex before iterating — the shared instances' `lastIndex` is never
 * mutated, so module-level sharing is safe. Do not drive them with
 * `exec()`/`test()` loops without resetting `lastIndex` to 0 first.
 */

/**
 * `var(--color-<hue>)` / `var(--color-<hue>-<stop>)` references.
 * Group 1 is the hue; group 2 is the numeric stop and is `undefined` for
 * stop-less refs (explicit/pair colors such as `var(--color-paper)`) —
 * consumers that only care about stops must skip matches without group 2.
 */
export const COLOR_STOP_REF_RE =
	/var\(--color-([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)(?:-(\d+))?\s*[,)]/g;

/**
 * `var(--color-<name>)` references; group 1 is the WHOLE token name.
 *
 * The sibling above splits a reference into hue and stop, which is what a
 * generative palette needs. An explicit `@color` entry has no such split — the
 * theme keys it under the undivided name `red-500` — so pruning those needs the
 * name exactly as written. `var(--color-red-500)` yields `red-500` here and
 * `red` + `500` there; both readings are correct for their own consumer.
 *
 * The class is `[\\w-]+` — deliberately wider than the hue pattern above, and
 * matched to `IDENT_KEY_RE`, which is what validates an `@color` key. A name
 * that pattern admits but this one missed would be a variable pruned out from
 * under live CSS that still references it.
 *
 * Both this and the pattern above end at `,` or `)`, not at `)` alone: a
 * `var()` may carry a fallback, and `var(--color-surface, red)` references the
 * variable every bit as much as `var(--color-surface)` does. Matching only the
 * bare form left the fallback spelling unrecorded — invisible while every color
 * was emitted anyway, and a deleted variable once pruning arrived.
 */
export const COLOR_VAR_REF_RE = /var\(--color-([\w-]+)\s*[,)]/g;

/**
 * `var(--shadow-<name>)` references; group 1 is the token name.
 *
 * `DEFAULT` is spelled out because it is the one uppercase token name the
 * engine emits: bare `shadow` resolves to `var(--shadow-DEFAULT)` when a theme
 * names one. Without it here the scanner would not count that reference, the
 * token would be pruned from `:root`, and bare `shadow` would silently paint
 * the `0 0 #0000` fallback — worse than having no `DEFAULT` at all, since
 * `resolveShadow` otherwise falls back to `md`. `@rounded` and `@blur` read
 * their `DEFAULT` the same way but inline the literal value, so only shadows
 * reach this regex.
 */
export const SHADOW_VAR_REF_RE = /var\(--shadow-(DEFAULT|[a-z0-9]+(?:-[a-z0-9]+)*)\)/g;

/** `var(--text-<name>)` / `var(--text-<name>-leading)`; group 1 is the size name. */
export const TEXT_VAR_REF_RE = /var\(--text-([a-z0-9]+(?:-[a-z0-9]+)*?)(?:-leading)?\)/g;

/** `var(--font-<slot>)` references; group 1 is the slot name. */
export const FONT_VAR_REF_RE = /var\(--font-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\)/g;

/** `var(--animate-<name>)` references; group 1 is the animation name. */
export const ANIMATE_VAR_REF_RE = /var\(--animate-([a-z0-9]+(?:-[a-z0-9]+)*)\)/g;
