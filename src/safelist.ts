/**
 * `safelist()` — declare utility classes that must be emitted regardless of
 * whether the consumer's source files reference them directly.
 *
 * At runtime this is a plain identity-join: pass any number of strings (and
 * falsy values, which are filtered) and receive a single space-joined string
 * suitable for `className`. The function performs no global registration, has
 * no side effects, and is tree-shake-safe.
 *
 * The build-time meaning comes from the scanner: when the source-file
 * extractor encounters a `safelist(...)` call, it extracts every literal
 * string argument as a class declaration — so the classes get emitted in the
 * final CSS even though the consumer's source never names them literally.
 *
 * Primary use case is component libraries that ship classNames inside their
 * bundled code (e.g. a curated icon set whose strokes are described by
 * utility classes). The library wraps its declarations in `safelist(...)`,
 * the consumer's setup points the scanner at the library's `dist/`, and the
 * classes flow through unchanged. The Vite plugin auto-discovers libraries
 * that opt in via a `rainbowindex.safelistSources` field in their
 * `package.json`, so consumers typically don't have to add `@source` lines
 * by hand.
 *
 *   const ICON_BASE = safelist("stroke-cap-round", "stroke-join-round");
 *   const SidebarLeft = defineIcon({
 *     primitives: SIDEBAR,
 *     className: safelist(ICON_BASE, "-scale-x-100"),
 *   });
 *
 * Scanner contract:
 * - Only STATIC string literals at the call site are extracted. Values
 *   passed through variables (`safelist(ICON_BASE, ...)`) won't be re-read
 *   at the outer call site, but the original `safelist("stroke-cap-round",
 *   ...)` that produced `ICON_BASE` is itself extracted, so the classes are
 *   still covered.
 * - Template literals with no `${…}` interpolation are extracted; templates
 *   with interpolation are skipped.
 * - Falsy arguments are dropped at runtime so conditional fragments compose
 *   naturally: `safelist("flex", side === "left" && "flex-row-reverse")`.
 */
export function safelist(...parts: ReadonlyArray<string | false | null | undefined>): string {
	let out = "";
	for (const part of parts) {
		if (!part) continue;
		if (out) out += " ";
		out += part;
	}
	return out;
}
