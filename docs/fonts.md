# Fonts

The `@font` directive registers font slots: `sans`, `serif`, `mono`, or custom names such as `display`. Each slot emits:

- A `--font-<slot>` variable with the full fallback chain. The `font-<slot>` utility reads it.
- For a Google slot: one `@import` of the Google Fonts stylesheet.
- For a local slot: one `@font-face` per `face:` entry.
- For a known family: an automatic metrics-adjusted fallback face that removes layout shift when the web font loads.

Only the `@font { ... }` block form is a directive. A standard `@font-face` rule is normal CSS and passes through untouched.

## Grammar

Each slot declaration is `slot: <preamble> [{ body }];`. The limit is 20 slots per block. When two blocks define the same slot, the last one wins with warning `[RI-1215]`.

### Preamble

| Form | Result |
| --- | --- |
| `system` | The built-in system stack. No loading. |
| `"<Family>", <fallback>, ...` | A manual stack. No loading, unless the body has `face:` entries. |
| `"<Family>", <fallback>, ... from google` | A Google Fonts slot. |

Quotes are optional. Fallbacks come after the family, comma-separated, in the preamble. Family names accept only letters, digits, spaces, `.`, `_`, and `-`. This restriction is an injection defense.

### Body keys

| Key | Value | Default |
| --- | --- | --- |
| `face` | `<src> [{ overrides }]`, repeatable | — |
| `weight` | `100 900` (range), `400,700` (list), or `400` | Google: `100 900`. Other: `400`. |
| `style` | `normal`, `italic`, `oblique <range>` | Google: `normal italic`. Other: `normal`. |
| `display` | Any `font-display` value | `swap` |
| `unicode-range` | A CSS unicode range | unset |
| `preload` | `true`, `yes`, or `on` | off |
| `features` | A `font-feature-settings` value | unset |
| `variation` | A `font-variation-settings` value | unset |
| `metrics` | See below | automatic |

`weight`, `style`, `display`, `unicode-range`, and `preload` are face defaults. A `face:` entry's own block overrides them.

### Examples

```css
@font {
	/* Google slot with fallbacks and a weight range */
	sans: "Inter", ui-sans-serif, sans-serif from google { weight: 400 700; }

	/* Local slot with an upright face and an italic face */
	display: "Satoshi" {
		weight: 300 900;
		face: /fonts/Satoshi.woff2;
		face: /fonts/Satoshi-Italic.woff2 { style: italic; }
	}

	/* System stack */
	mono: system;
}
```

Rules for `face:` entries:

- The source must start with `/`, `.`, or `http`. Any other form warns with `[RI-1201]` and emits nothing.
- The format comes from the extension: `.woff2`, `.woff`, `.ttf`, `.otf`. Unknown extensions count as woff2.
- A Google slot cannot also have `face:` entries. The faces are ignored with warning `[RI-1204]`.
- Two faces with the same weight and style warn with `[RI-1214]`. The later face wins.

## Metrics fallback (zero layout shift)

For Google and local slots, the engine can emit a fallback `@font-face` that adjusts a local font to the web font's metrics. The page then keeps its layout while the web font loads. The built-in table covers 104 families.

| Value | Meaning |
| --- | --- |
| omitted | Automatic, when the family is in the table. |
| `metrics: none` | No fallback face. |
| `metrics: "Arial"` | Automatic numbers, matched against this local font. |
| `metrics: "Arial" 107.64 90.49 22.48 0` | Manual: size-adjust, ascent, descent, line-gap. All four are required. |
| `metrics: 107.64 90.49 22.48 0` | Manual numbers with the default match font. |

Keep the `metrics:` entry on one line. A wrapped value splits and warns with `[RI-1217]`.

An unknown family with no explicit fallback gets no fallback face and no warning. With four manual numbers, the table is not consulted, and any local font name works.

## Google Fonts and the network

The build fetches the Google Fonts metadata once, from `https://fonts.google.com/metadata/fonts`. The metadata narrows each family's weight axis, so the generated URL matches what the family supports. The result is cached on disk.

- The fetch runs only when the theme has a Google slot.
- Per attempt: a 5-second timeout, with 3 attempts. The whole resolve stops after 10 seconds and the build continues with defaults.
- After a failure, a 30-second cooldown blocks the next attempt in the same process.
- The cache file is `node_modules/.cache/rainbowindex/google.json`. The default lifetime is 7 days, with a 30-day maximum.

CAUTION: The first build with a Google slot needs the network or a filled cache. Without metadata, a static font gets a `wght@100..900` URL, and Google rejects it. Set an explicit `weight` to stay safe offline.

Content Security Policy: a Google slot emits an `@import` to `fonts.googleapis.com`. A strict site must allow `fonts.googleapis.com` in `style-src` and `fonts.gstatic.com` in `font-src`, or use local files.

The environment variables `RI_OFFLINE`, `RI_FETCH_FONTS`, `RI_CACHE_DIR`, and `RI_FONT_CACHE_TTL` control this behavior. See [environment-variables.md](environment-variables.md).

## Preload

Mark a local face with `preload: true`, then generate the tags:

```bash
rainbowindex preload-fonts --css src/index.css > preload.html
```

Each qualifying face prints one line:

```
<link rel="preload" href="/fonts/Satoshi.woff2" as="font" type="font/woff2" crossorigin>
```

Only local-file and raw-URL faces qualify. A Google face never produces a tag, because Google serves CSS, not the font binary. `preload` on a Google or system slot warns with `[RI-1219]`. The command makes no network requests.

## Deprecated forms

These forms still parse but warn with `[RI-1218]` and will be removed:

| Old form | Replacement |
| --- | --- |
| `@face { src: ...; }` block | `face: <src> { ... }` |
| `italic: <src>;` | `face: <src> { style: italic; }` |
| `from "<path>"` | `face: <path>;` |
| `from system` | `system` |
| `fallback: a, b;` | Fallbacks in the preamble. |
| `metricsFallback` and the four number keys | One `metrics:` entry. |
| `unicodeRange:` | `unicode-range:` |

The pre-0.5 inline form `@font-sans "Inter" from google;` is removed and skipped with warning `[RI-1202]`.

## Gotchas

- A custom slot name falls back to the sans system stack. For a serif-like or mono-like custom slot, list explicit fallbacks.
- A manual stack never ships a bare family. The system stack is appended when you list no fallbacks.
- Slot preambles can wrap across lines. Body entries cannot.

## Diagnostic codes on this page

The 12xx range covers the font system.

| Code | Meaning |
| --- | --- |
| `RI-1201` | Unknown face source form. The face was skipped. |
| `RI-1202` | The removed inline `@font-<slot>` form. |
| `RI-1204` | A Google slot also declares local faces. |
| `RI-1205` | The Google metadata fetch failed. |
| `RI-1206` | `RI_OFFLINE` is set and no cache file exists. |
| `RI-1210` | The font cache write failed. |
| `RI-1214` | Two faces share weight and style. |
| `RI-1215` | The same slot was defined twice. |
| `RI-1216` | More than 20 slots in one block. |
| `RI-1217` | Unknown or unsafe `@font` entry. |
| `RI-1218` | A deprecated `@font` form. |
| `RI-1219` | `preload` on a non-local slot. |
| `RI-1220` | Invalid or partial `metrics` value. |

The full table is in [diagnostics.md](diagnostics.md).
