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
export const COLOR_STOP_REF_RE = /var\(--color-([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)(?:-(\d+))?\)/g;

/** `var(--shadow-<name>)` references; group 1 is the token name. */
export const SHADOW_VAR_REF_RE = /var\(--shadow-([a-z0-9]+(?:-[a-z0-9]+)*)\)/g;

/** `var(--text-<name>)` / `var(--text-<name>-leading)`; group 1 is the size name. */
export const TEXT_VAR_REF_RE = /var\(--text-([a-z0-9]+(?:-[a-z0-9]+)*?)(?:-leading)?\)/g;

/** `var(--font-<slot>)` references; group 1 is the slot name. */
export const FONT_VAR_REF_RE = /var\(--font-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\)/g;

/** `var(--animate-<name>)` references; group 1 is the animation name. */
export const ANIMATE_VAR_REF_RE = /var\(--animate-([a-z0-9]+(?:-[a-z0-9]+)*)\)/g;
