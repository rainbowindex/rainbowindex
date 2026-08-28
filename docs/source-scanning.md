# Source Scanning

The scanner finds your source files, extracts class candidates from them, and feeds the class set to the compiler. Classes come from three places, merged in this order:

1. `@source` directives in your CSS.
2. Surface globs: the CLI positional globs, or the PostCSS `sources` option.
3. Dependency safelists, discovered automatically.

## Default discovery

When you give no positive glob, the scanner uses the defaults:

- `*.html` at the project root.
- `src/**/*.{html,js,jsx,ts,tsx,mdx,vue,svelte}`.

CAUTION: One positive glob replaces the defaults completely. If you add `@source "emails/**/*.html";`, the `src/**` scan stops. Add the patterns you still need. Negated `@source not` patterns and `inline(...)` entries do not replace the defaults.

These excludes always apply, also to your own globs: `node_modules/**`, `dist/**`, `build/**`, `coverage/**`, `public/**`, `**/*.config.*`, `**/*.d.ts`.

Exception: a positive pattern that starts with `node_modules/` escapes the `node_modules/**` exclude. `@source "node_modules/some-lib/dist/**/*.js"` works.

## `@source`

```css
@source "src/**/*.{ts,tsx}";              /* add a scan glob */
@source not "src/components/legacy/**";   /* exclude */
@source inline("underline text-brand-500"); /* force-include classes */
```

Pattern rules:

- Patterns are relative to the working directory.
- Absolute paths, empty patterns, and `..` segments are rejected with warning `[RI-1404]`. There is no way to scan files outside the project root.
- `inline(...)` content splits on whitespace. Each token is added verbatim, with no filter and no variant-group expansion.

## What gets extracted

The scanner is lexer-based, not AST-based. It finds class-shaped tokens anywhere in a matched file, comments included. The extractor depends on the file type:

| File type | Extra passes beyond the token scan |
| --- | --- |
| `.html` | Quoted `class=` attribute values. |
| `.vue` | `:class` and `v-bind:class` expressions, static `class=`. |
| `.svelte` | `class:` directive names, `class=` expressions. |
| `.js` `.jsx` `.ts` `.tsx` `.md` `.mdx` | `className=`, `class=`, `tw=`, `classList=`, helper calls, `cva()`/`tv()` configs, `classMap()` keys. |
| Other extensions | The token scan only. |

Recognized helper calls: `clsx`, `cn`, `classnames`, `classNames`, `cx`, `ri`, `twJoin`, `twMerge`, plus `cva` and `tv`. The recognition is name-based. A renamed import is not followed.

The token scan understands variants, negatives, arbitrary values, fractions, the `!` suffix, and variant groups. It drops tokens that cannot be classes: mixed-case names, brackets with spaces, and JavaScript property access such as `arr[0]`.

It cannot drop a bare lowercase identifier, because `mode` and `flex` have the same shape and `@utility mode` would make `mode` a real class. Those tokens are still collected — they simply never match a utility, so they cost nothing in the output. Editor tooling tells them apart with the candidate origin; see [editor-api.md](editor-api.md#candidate-origins).

`.md` files are not in the default patterns. Add them with `@source`. `.astro` and other unknown extensions get only the token scan.

### Whitespace inside brackets

A class name cannot hold whitespace. A class attribute, `@apply`, and `safelist()` all split on it, so `bg-[url('a b')]` arrives as the two tokens `bg-[url('a` and `b')]` and matches nothing. The scanner drops such a token and warns with `[RI-1412]`. Write `_` for a space and `\_` for a literal underscore:

```html
<div class="bg-[url('a_b')] grid-cols-[1fr_2fr]"></div>
```

The warning needs a class-list context: a class attribute, a recognized helper call, or `safelist()`. The whole-file token scan alone never reports, because `styles["my class"]` and ordinary prose have the same shape. One class warns once, even when an attribute and a helper call inside it both see it.

## `safelist()`

Force classes into the output from code:

```ts
import { safelist } from "rainbowindex";

const ICON_BASE = safelist("stroke-cap-round", "stroke-join-round");
```

At runtime, the function joins its string arguments and drops falsy values. At build time, the scanner extracts the literal string arguments from every file type, even inside minified code. Static strings are extracted at the call site. A template literal contributes its static text chunks. The `${...}` parts are skipped.

## Dependency safelists

A library can advertise its scan globs in its own `package.json`:

```json
{
	"name": "@scope/lib",
	"rainbowindex": { "safelistSources": ["./dist/**/*.mjs"] }
}
```

The scanner walks the consumer's `dependencies` and `peerDependencies`, and scans those globs inside each package. `devDependencies` are skipped by design — add a manual `@source "node_modules/<dep>/..."` for a dev dependency. Patterns must stay inside the package root, or the entry is skipped with warning `[RI-1410]`.

## Caching

Scan results cache per file, keyed on path plus modification time plus size. Watch rebuilds re-read only changed files. Read errors are not cached, so recovery works. The cache clears completely at 20,000 entries.

## Limits

| Limit | Value | On breach |
| --- | --- | --- |
| Source file size | 1 MB | File skipped, `[RI-1405]`. |
| Inline `@source` content | 100 KB | Directive skipped, `[RI-1406]`. |
| Line length in the token scan | 10,000 characters | Line dropped, `[RI-1411]`. Quoted class attributes and helper calls on the line still work. |
| Variant-group expansion | 500,000 in, 100,000 out, depth 10 | `[RI-1407]`, `[RI-1408]`, `[RI-1409]`. |
| Glob resolution | 30 seconds | `[RI-1402]`. |
| File read | 10 seconds | `[RI-1403]`. |

There is no binary detection. The size and line limits are the only guards against generated files.

## Diagnostic codes on this page

| Code | Meaning |
| --- | --- |
| `RI-1401` | No source files matched the globs. |
| `RI-1402` | A glob failed or timed out. |
| `RI-1403` | The scanner failed to read a source file. |
| `RI-1404` | An `@source` or CLI pattern was rejected. |
| `RI-1405` | A source file is above 1 MB. |
| `RI-1406` | Inline `@source` content is above 100 KB. |
| `RI-1410` | A dependency's `safelistSources` entry is invalid. |
| `RI-1411` | Lines above 10,000 characters were skipped. |
| `RI-1412` | A class list holds a class with whitespace inside its brackets. |

The full table is in [diagnostics.md](diagnostics.md).
