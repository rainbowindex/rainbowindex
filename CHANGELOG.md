# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-07-16

Initial public release. Rainbow Index began as a fork of Tailwind CSS v4; the
entries below list the capabilities this release adds **on top of** what
Tailwind CSS v4 provides. Shared functionality (utility classes, variants,
`@apply`, CSS-first theming, `@source`, arbitrary values, the Vite/PostCSS
plugins as such) is not repeated here.

### Added — runtime & programmatic API

- **`ri()` class merger** — built-in class composition with right-most-wins
  conflict resolution, replacing both `clsx` (conditional composition) and
  `tailwind-merge` (conflict resolution). Understands shorthand property
  claims (`p-4` owns all four padding sides), variant-order canonicalization
  (`sm:hover:` ≡ `hover:sm:`), `!important`, negative utilities, and
  arbitrary properties; bracket-aware tokenization with LRU caching.
- **`createRi(snapshot)`** — SSR- and multi-tenant-safe merger bound to a
  frozen compilation snapshot, for servers where concurrent requests may
  target different themes in one process. `ri()` emits a throttled
  `[RI-2004]` warning when it detects that situation.
- **Programmatic compilation API** — `compileProject()`, `createCompiler()`,
  `createCompilationContext()`, `finalizeCompilationContext()`, and
  registration helpers (`registerCustomUtility`, `registerCustomTextSizes`,
  `registerCustomFontFamilies`, `registerColorNames`) as a stable library
  surface for driving compilation and feeding the merge engine.
- **`safelist()` helper** — a runtime identity-join whose static string
  arguments are extracted by the scanner at build time, so component/icon
  libraries can ship class names that are always emitted.
- **Package-based safelist auto-discovery** — installed dependencies can
  declare `rainbowindex.safelistSources` globs in their own `package.json`
  to opt their published files into scanning, with no manual `@source`.
- **Browser entry guard** — importing the PostCSS-plugin default export in a
  browser bundle throws `[RI-2003]` with guidance to use named imports.

### Added — CLI

- **`rainbowindex generate-types`** — generates a `rainbowindex-env.d.ts`
  with a `RainbowClass` TypeScript union (colors × stops, spacing, text
  sizes, weights, variants, custom utilities) for editor autocomplete;
  `--strict` drops the string escape hatch; hand-edited files are backed up
  before overwrite.
- **`rainbowindex preload-fonts`** — emits `<link rel="preload" as="font">`
  tags for resolved font faces.
- **`rainbowindex init`** — wires Rainbow Index into an existing Vite app:
  detects the package manager, installs the dependency, patches
  `vite.config.*`, and creates or updates the CSS entry.
- **`rainbowindex create <dir>`** — scaffolds a fresh Vite app (default
  template `react-ts`) with Rainbow Index pre-wired.
- **`--optimize`** — LightningCSS pass with browser-fallback down-leveling
  in addition to minification.
- **Atomic output writes** — CSS output is written via temp-file + rename so
  interrupted builds never leave partial files.

### Added — theming directives

- **Generative color system (`@color`)** — declare a color as two numbers
  (`brand: 0.18 330;` — chroma + hue) and get a full 19-stop OKLCH palette
  with automatic dark mode via ramp mirroring, tuned for even perceived
  contrast. Also supports explicit values, light/dark pairs, aliases,
  per-color dark-override strategies, and contrast warnings.
- **Font system (`@font`)** — register font slots from Google Fonts, local
  files, or URLs in CSS; multi-face slots (upright + italic via an
  `italic:` shorthand), system/manual stacks, and metrics-adjusted fallback
  `@font-face` blocks (size-adjust/ascent/descent overrides) for zero
  cumulative layout shift. On-disk font metadata cache governed by
  `RI_OFFLINE`, `RI_FETCH_FONTS`, `RI_CACHE_DIR`, and `RI_FONT_CACHE_TTL`.
- **`@fluid`** — configurable fluid type/spacing range driving
  `text-fluid-*` and `*-fluid` spacing/inset utilities with curve keywords.
- **`@rounded` corner shapes** — border-radius tokens with corner-shape
  modifiers and `corner-round/scoop/bevel/notch/square/squircle` (plus
  `corner-[superellipse(N)]`) utilities mapping to the CSS `corner-shape`
  property.
- **`@animate`** — register named animations with inline `@keyframes`, plus
  compositional enter/exit utilities (`animate-in`/`animate-out` with
  `fade-`, `zoom-`, `spin-`, `blur-`, and `slide-` parts, each driving
  independent CSS variables) and preset accordion/collapsible keyframes.
- **`@register`** — declare typed custom properties (`@property`-style
  registrations with syntax and initial value) directly from CSS.
- **`@preflight`** — toggle preflight base styles from CSS.

### Added — class-string syntax

- **Variant groups** — `hover:{text-red-500 bg-blue-100 underline}` expands
  at scan time to the repeated-prefix form; groups stack and nest
  (`sm:hover:{…}`, `data-[state=open]:{…}`) with depth and output caps, and
  are also expanded inside `@apply` bodies.
- **Helper-call-aware scanner** — class literals are extracted from
  `clsx`/`cn`/`classnames`/`cx`/`twJoin`/`twMerge`/`cva`/`tv`/`classMap`/
  `safelist` call sites rather than treating source files as flat text.
- **Math-operator value parsing** — CSS math functions (`calc`, `min`,
  `max`, `clamp`, `mod`, trigonometric functions, `pow`, `round`, …) are
  recognized inside utility values.

### Added — integrations

- **Vite plugin extras** — auto-injects a PostCSS config only when none
  exists, auto-discovers the CSS entry on first dev-server listen (warning
  `[RI-1602]` if Rainbow Index never activates), tracks per-file versions
  for HMR, and pre-rewrites Rainbow-Index-specific directive syntax into
  PostCSS-parseable form before PostCSS runs.
- **PostCSS plugin `sources` option** — declare scan globs from
  `postcss.config.js` in addition to CSS `@source`, merged with
  package-discovered safelist sources.

### Added — diagnostics

- **`RI-NNNN` error-code system** — every warning carries a namespaced code
  (10xx compilation, 11xx color, 12xx fonts, 13xx merge, 14xx scanner, 15xx
  typography, 16xx integrations, 20xx CSS functions, 21xx runtime), with a
  parity test enforcing that every emitted code is documented.
- **Warning deduplication and severity budgeting** — warnings are deduped
  and capped per compile, with reserved slots so high-severity errors are
  never drowned out by informational warnings.
- **"Did you mean" suggestions** — optimal-string-alignment matching powers
  typo hints for unknown utilities, variants, and theme variables.
