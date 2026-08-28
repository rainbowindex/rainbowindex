# Diagnostics Reference

Every warning starts with a `[RI-NNNN]` code. This page lists all codes with cause and fix.

How diagnostics behave:

- Warnings are deduplicated per compile and capped at 200. The last 20 slots are reserved for high-severity codes. When a limit hits, one `[RI-1013]` notice marks it.
- Severity comes from the range: `RI-0xxx` and `RI-2xxx` are errors, all other ranges are warnings.
- Most codes warn. These throw and stop the build or the call: `RI-0001`, `RI-0002`, `RI-1605`, `RI-1606`, `RI-2003`, `RI-2007`, `RI-2008`.
- The `ri()` runtime warnings throttle to one per kind per 60 seconds.
- Dev-only messages (`RI-1301`, `RI-1302`, the console half of `RI-2003`) are silent when `NODE_ENV=production`.
- `[RI-DEBUG]` and `[RI-DEV]` messages have no number and never count against the cap. `RI_DEBUG=1` turns the first group on.

Where warnings surface:

| Surface | Channel |
| --- | --- |
| CLI | stderr. |
| PostCSS plugin | `result.warn()`. Read them from `result.warnings()`. |
| Vite plugin | Through PostCSS, plus the dev-server logger for plugin-level codes. |
| `ri()` runtime | `console.warn`, throttled. |
| Editor API | `session.diagnostics` with code, severity, and source span. |

## Ranges

| Range | Subsystem |
| --- | --- |
| 00xx | PostCSS plugin bootstrap. Thrown. |
| 10xx | Compilation and directives. |
| 11xx | Color directives and resolver catch-alls. |
| 12xx | Font system. |
| 13xx | Merge context registration. Dev only. |
| 14xx | Source scanner. |
| 15xx | Typography utilities. |
| 16xx | Integrations: Vite, PostCSS, CLI wiring. |
| 20xx | CSS functions, `ri()` runtime, and `compile()` validation. |

There is no 21xx range.

## 00xx — Plugin bootstrap (thrown)

| Code | Cause | Fix |
| --- | --- | --- |
| `RI-0001` | The PostCSS plugin failed with an unexpected error. The message carries file, line, column, and a hint. | Read the location. Correct the CSS near it, or correct the `@source` patterns or the `cwd` option. |
| `RI-0002` | The `cwd` option is empty, not a string, has null bytes, or is relative. | Pass an absolute path. |

## 10xx — Compilation and directives

| Code | Cause | Fix |
| --- | --- | --- |
| `RI-1001` | Reserved. Never emitted. Unknown utilities drop silently. | Use `validate()` from the editor API to learn why a class emits nothing. |
| `RI-1002` | An arbitrary utility `[prop:value]` did not resolve. | Use a known property and a well-formed value. For a variable, use `[--name:value]`. |
| `RI-1004` | Unknown variant. The class was dropped. | Correct the spelling, or register the variant with `@custom`. |
| `RI-1005` | Unknown utility in `@apply`, or circular `@apply` between custom utilities. | Correct the class name. Break the cycle. |
| `RI-1006` | `@apply` at the top level, more than 500 classes, or 5 expansion passes reached. | Move `@apply` inside a rule. Split large directives. |
| `RI-1009` | The CSS has `@apply`, and the CLI cannot expand it. | Use the PostCSS or Vite plugin. |
| `RI-1011` | A `//` comment in CSS. The rest of the line is skipped. | Use `/* ... */`. |
| `RI-1012` | A directive did not parse. It was skipped. | Balance the braces. Add the semicolons. |
| `RI-1013` | The warning cap was reached. | Correct the earlier warnings. A flood usually has one root cause. |
| `RI-1014` | A name has characters unsafe for type generation. | Rename the token. |
| `RI-1015` | An `@utility` body above 10,000 characters or with broken braces. Also an invalid PostCSS `sources` glob. | Shrink the body. Correct the braces or the glob. |
| `RI-1016` | An `@custom` selector above 2,000 characters. | Shorten it. |
| `RI-1017` | An invalid `@custom` name. | Start with a lowercase letter. Use letters, digits, hyphens, underscores. |
| `RI-1018` | `p-full` or `m-full`. It resolves to `100%`. | Use `p-[100%]` if that is the intent. |
| `RI-1019` | The CSS input is above 5 MB. Processing was skipped. | Split the stylesheet. Look for inlined assets. |
| `RI-1020` | An invalid `@spacing` base. The value is still used. | Use a CSS length such as `0.25rem`. |
| `RI-1021` | A non-integer `@weight` value. | Use an integer. |
| `RI-1022` | An invalid `@fluid` `min`. | Use a rem length. |
| `RI-1023` | An invalid `@fluid` `max`. | Use a rem length. |
| `RI-1024` | `@fluid` `max` is not above `min`. | Make `max` larger. |
| `RI-1025` | An invalid `@fluid` unit. | Use `vw`, `vi`, `vmin`, or `vmax`. |
| `RI-1026` | A `multiplier` on `@fluid text`, or a value of 1 or less. | Use it only on spacing, with a number above 1. |
| `RI-1027` | An unknown `@fluid` modifier. | Use `text` or `spacing`. |
| `RI-1028` | An `@register` name without `--`. | Add the `--` prefix. |
| `RI-1029` | A typed `@register` entry without `initial-value`. Browsers ignore it, so it was dropped. | Add `initial-value` or use `syntax: "*"`. |
| `RI-1030` | An `@register` name declared twice. The last wins. | Remove the earlier one. |
| `RI-1031` | An unknown `@register` entry, or no properties declared. | Use `syntax`, `inherits`, `initial-value`, or `--name: value` entries. |
| `RI-1032` | A custom utility name equals a built-in. The built-in wins. | Rename the custom utility. |
| `RI-1034` | A modifier on a directive that takes none. The body still applied. | Remove the modifier. |
| `RI-1035` | An invalid name or key. Allowed: letters, digits, hyphens, underscores. | Rename it. |
| `RI-1036` | A directive nested inside `@media` or a similar at-rule. It applies globally. | Move it to the top level. |
| `RI-1037` | `@slot` outside a `@custom` block. | Move it inside `@custom`, or write `[data-slot="name"] { ... }`. |
| `RI-1038` | An uppercase `@utility` name. Markup never triggers it. | Use a lowercase name. |

## 11xx — Colors and resolver catch-alls

| Code | Cause | Fix |
| --- | --- | --- |
| `RI-1101` | An unparseable `@color` value, or more than 500 entries. | Use `chroma hue`, an alias, or a CSS color function. Trim the entries. |
| `RI-1102` | Chroma outside 0 to 0.4. The value was clamped. | Stay inside the range. |
| `RI-1103` | Removal of a key that does not exist, or an invalid dark mode value. | Check the key. Use `auto` or `off`. |
| `RI-1104` | An unknown `@color dark` option. | Use `mode`, `chroma-boost`, or `hue-shift`. |
| `RI-1105` | An alias points to an undefined color. | Define the source color. |
| `RI-1106` | A used stop has low APCA contrast against both paper and ink. | Pick a darker or lighter stop for text. |
| `RI-1107` | A circular alias chain. | Break the cycle. |
| `RI-1108` | An options block on a non-generative color. | Remove the block, or use the `chroma hue` form. |
| `RI-1110` | An internal resolver bug. | Report it upstream. |
| `RI-1120` | An unknown `@layer` option. | Use `order`, `utilities`, or `base`. |
| `RI-1121` | An invalid `--corner-scale`. | Use a positive number. |
| `RI-1122` | An unknown key in the `@rounded` body. | Use `--corner-scale`. Radii are numeric: `rounded-{n}` is `n * --spacing`. |

## 12xx — Fonts

| Code | Cause | Fix |
| --- | --- | --- |
| `RI-1201` | An unknown face source form. | Use `google`, or a path that starts with `/`, `.`, or `http`. |
| `RI-1202` | The removed inline `@font-<slot>` form. | Move into one `@font { ... }` block. |
| `RI-1203` | A compound style on a local face. The first keyword was used. | Split upright and italic into two faces. |
| `RI-1204` | A Google slot also declares local faces. The faces were ignored. | Pick one source. |
| `RI-1205` | The Google metadata fetch failed after 3 attempts. | Run once with network, or set explicit `weight` and `style`. |
| `RI-1206` | `RI_OFFLINE` is set and no cache exists. | Run once with network to fill the cache. |
| `RI-1207` | The metadata response is invalid or above 10 MB. | Usually transient. Retry, or pin explicit weights. |
| `RI-1208` | `RI_CACHE_DIR` is absolute. The font cache turns off, and the message surfaces inside a fetch warning. The build continues. | Use a relative path. |
| `RI-1209` | `RI_CACHE_DIR` has `..` segments. Same behavior as `RI-1208`. | Use a direct relative path. |
| `RI-1210` | The cache write failed. Every build then fetches again. | Point `RI_CACHE_DIR` at a writable path. |
| `RI-1211` | `RI_FONT_CACHE_TTL` above 30 days. Clamped. | Use 30 days or less. |
| `RI-1212` | Global `fetch()` is not available. | Use Node 18 or later. |
| `RI-1213` | The metadata fetch passed the 10-second build cap. | Retry with network, or set explicit weights. |
| `RI-1214` | Two faces share weight and style. The later wins. | Remove the duplicate. |
| `RI-1215` | A slot is defined twice. The last wins. | Remove the earlier definition. |
| `RI-1216` | More than 20 slots in one `@font` block. | Remove unused slots. |
| `RI-1217` | An unknown, unsafe, or malformed `@font` entry. | Follow the message. It names the exact entry. |
| `RI-1218` | A deprecated `@font` form. It still works. | Apply the named replacement. |
| `RI-1219` | `preload` on a non-local slot. No effect. | Remove it. Only local files can preload. |
| `RI-1220` | An invalid or partial `metrics` value. | Give all four percentages, one match font, or `none`. |

## 13xx — Merge context (dev only)

| Code | Cause | Fix |
| --- | --- | --- |
| `RI-1301` | `registerCustomUtility()` got an empty name. Skipped. | Pass a name. |
| `RI-1302` | `registerCustomUtility()` got no properties. | Pass the CSS properties the utility sets. |

## 14xx — Scanner

| Code | Cause | Fix |
| --- | --- | --- |
| `RI-1401` | No source files matched the globs. | Correct the `@source` paths. |
| `RI-1402` | A glob failed or timed out after 30 seconds. | Correct the pattern. |
| `RI-1403` | The scanner failed to read a source file. | Check permissions and existence. |
| `RI-1404` | A pattern was rejected: absolute, empty, null byte, or `..`. Also an unreadable candidate CSS file. | Keep patterns relative and inside the project. |
| `RI-1405` | A source file above 1 MB. Skipped. | Exclude it or split it. |
| `RI-1406` | Inline `@source` content above 100 KB. Skipped. | Shrink it. |
| `RI-1407` | Variant-group input above 500,000 characters. | Split the input. |
| `RI-1408` | Variant-group output above 100,000 characters. | Use fewer or smaller groups. |
| `RI-1409` | Variant-group brace depth above 10. | Chain prefixes instead of braces. |
| `RI-1410` | A dependency's `safelistSources` field is invalid. | Fix that dependency's `package.json`. |
| `RI-1411` | Lines above 10,000 characters were skipped. | Exclude minified files or split the lines. |
| `RI-1412` | A class in a class list has whitespace inside its arbitrary value, so nothing can ever match it. The class was skipped. | Write `_` for a space: `bg-[url('a_b')]`. Write `\_` for a literal underscore. |

## 15xx — Typography utilities

| Code | Cause | Fix |
| --- | --- | --- |
| `RI-1501` | `text-fluid-*` on a font size that is not in rem. | Express the size in rem. |
| `RI-1502` | `text-fluid-*` on the smallest size. There is no step below. | Add a smaller step, or do not use fluid there. |

## 16xx — Integrations

| Code | Cause | Fix |
| --- | --- | --- |
| `RI-1601` | The Vite CSS scan failed in a directory. Dev only. | Check permissions. |
| `RI-1602` | The Vite plugin found no active CSS entry at dev-server start. | Add `@import "rainbowindex";`, or run `rainbowindex init`. |
| `RI-1603` | The CLI compiled zero utility classes. | Pass a glob, or add `@source` to the CSS. |
| `RI-1604` | A hand-edited `rainbowindex-env.d.ts` exists. It was saved as `.bak`, or the run stopped when the backup failed. | Recover from the backup. Do not hand-edit generated files. |
| `RI-1605` | The explicit `--css` file was not found. Thrown. | Correct the path. |
| `RI-1606` | The PostCSS default export was placed in Vite's `plugins` array. Thrown. | Import from `rainbowindex/vite`. |

## 20xx — CSS functions, `ri()` runtime, `compile()` validation

| Code | Cause | Fix |
| --- | --- | --- |
| `RI-2001` | A theme function references an unknown token. | Use an existing token. |
| `RI-2002` | A theme function in inline mode has a value that is not static. | Drop inline mode, or make the value static. |
| `RI-2003` | The default export was called in a browser bundle. Thrown. | Use named imports: `import { ri } from "rainbowindex"`. |
| `RI-2004` | The default `ri()` ran in a Node process. Throttled to one per 60 seconds. | Use `createRi(snapshot)` for isolation. |
| `RI-2005` | `--spacing()` got a non-numeric argument. Left unchanged. | Use a literal number, or `calc(x * var(--spacing))`. |
| `RI-2006` | A class token above 500 characters was dropped. | Shorten it. |
| `RI-2007` | `compile()` got a theme that is not an object. Thrown. | Pass a `ResolvedTheme`. |
| `RI-2008` | `compile()` got a non-iterable class list. Thrown. | Pass an iterable or a string. |
| `RI-2009` | CSS function substitution still ran after 3 of the 5 passes. A final variant fires when all 5 passes are used. | Break the circular theme references. |
| `RI-2010` | CSS function output above 1 MB. The last stable result was kept. | Slim the theme values involved. |
| `RI-2011` | `ri()` array nesting above depth 10. Excess dropped. | Flatten the arrays. |
| `RI-2012` | More than 10,000 classes in one `ri()` call. Excess dropped. | Reduce the input. |
