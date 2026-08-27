# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-08-27

### Added

- **`rainbowindex scan <file|glob…>`** — prints every class candidate the
  scanner extracts from each file, with scanner warnings on stderr. Answers
  "why doesn't my class generate?" directly: a class missing from the list
  was never seen by the scanner (check the markup), while a class listed
  there that still produces no rule fails later (check the build warnings).
- **RI-1411 — skipped over-long lines are now reported.** The scanner drops
  lines above the minified-input guard, previously in silence. It now warns
  once per file with the path and line count. Suppressed for `node_modules`
  paths, where minified dists are the guard's intended target.
- **RI-1038 — uppercase `@utility` names warn.** The markup scanner only
  matches lowercase tokens, so `@utility cardHeader` could never trigger
  from `class="cardHeader"`. The utility still works through `@a`/`@apply`
  and inline `@source`, so it is kept — but no longer silently unreachable.

### Changed

- **Fallback stacks moved from preflight into `@font`.** The
  `--sans-fallback` / `--serif-fallback` / `--mono-fallback` variables were
  emitted into every project and referenced by nothing. A manual `@font`
  slot that declares no fallbacks now gets the default system stack appended
  to its `--font-<slot>` value instead (`sans: "Chartwell";` →
  `"Chartwell", ui-sans-serif, system-ui, …`); a slot that declares its own
  fallbacks is untouched. Font tokens no longer depend on a preflight
  category that users can switch off.
- **Focus ring uses literal lengths.** `:focus-visible` drew its outline at
  `var(--spacing)` (4px by default) and offset at half that, so changing the
  spacing scale silently resized every focus ring. Now a flat 2px width and
  2px offset.
- **Placeholder color follows the text color** —
  `color-mix(in oklab, currentColor 48%, transparent)` instead of a
  hardcoded gray that ignored the theme in dark mode.
- **Scanner line-length guard raised from 2,000 to 10,000 characters.** Real
  minified files run far above this, while hand-written long lines (inline
  SVG path data, long attribute stacks) sit below it. `MAX_LINE_LENGTH` is
  exported so tooling and tests derive from it instead of hardcoding.
- **Default source patterns scan every root HTML file** (`*.html`, not just
  `index.html`), so Vite multi-page apps are covered without an explicit
  `@source`. `dist`, `build`, and `public` remain excluded.

### Removed

- **Preflight `select-reset`.** It styled rather than reset, and shipped
  three defects: its chevron was a `currentColor` SVG in a `background-image`,
  which resolves to black and disappears on dark backgrounds; the bare
  `select` selector also hit `<select multiple>`, giving listboxes a floating
  chevron and 2.5rem of padding; and `appearance: none` stripped the native
  control on every platform. Style selects in your own CSS.
- **Preflight `:focus:not(:focus-visible) { outline: none }`** — no current
  browser draws an outline for plain `:focus`, so the rule was dead.

### Fixed

- **Quoted class attributes on over-long lines are no longer lost.** A
  `className="…"` sharing a line with multi-KB inline SVG path data
  generated nothing: the whole-file scan skipped the line for length, and
  the attribute collector stripped the quotes and then searched only for
  string literals *nested inside* the value, of which a plain quoted
  attribute has none. Quoted attribute values are now tokenized directly, in
  the one shared collector — so JSX, HTML, Vue, Svelte, and object-literal
  (`{ className: "…" }`) syntax are all fixed together. Non-quoted
  expression values keep their existing semantics.
- **List margins are reset.** `list-reset` removed bullets and padding while
  `ol`, `ul`, and `menu` kept the browser's `margin-block: 1em`, leaving
  unexplained gaps around navigation and menus.
- **`fieldset` and `legend` are reset** — their default margin and padding
  survived while every other form control was flush.

## [0.4.1] - 2026-08-25

### Added

- **Automatic zero-CLS font fallbacks.** Any `@font` slot whose family is in
  the built-in metrics table (~100 common Google + system families, generated
  from `@capsizecss/metrics` at development time — no new runtime dependency)
  now gets a metrics-adjusted local fallback `@font-face` automatically. The
  fallback font is picked from the slot's stack, or by the web font's
  category (Arial / Times New Roman / Courier New). Opt out with
  `metrics: none;`, pick the matched local font with `metrics: "Segoe UI";`,
  or keep full manual control with
  `metrics: "Arial" <size-adjust> <ascent> <descent> <line-gap>;`.
- **`face:` entries** — local font files are now declared as repeatable
  `face: <src> [{ overrides }]` entries, one grammar for every face:
  `display: "Satoshi" { face: /Satoshi.woff2; face: /Satoshi-Italic.woff2 { style: italic; } }`.
- **Fallback stacks work with `from google`** —
  `sans: "Inter", ui-sans-serif, sans-serif from google;` now parses as a
  google slot with fallbacks (previously it silently became a manual stack).
- **@font now warns instead of ignoring silently**: unknown option keys
  (RI-1217), `preload` on non-local slots where it can have no effect
  (RI-1219), and partial or invalid `metrics` values (RI-1220).

### Changed

- The `@font` parser was rebuilt on the shared entry scanner: one pass, no
  regex preambles, no re-serialization. Public API (`parseFontBody`,
  `parseNestedFontBlock`) is unchanged.
- **Incremental rebuilds only re-do changed work** — the scanner keeps a
  per-file cache keyed on mtime + size, so a CLI watch or Vite HMR rebuild
  re-reads and re-extracts only the files that actually changed instead of
  the whole project. The CSS entry analysis is memoized on the entry text
  (stable theme identity across rebuilds), Google-font resolution keeps its
  identity when metadata is unchanged, and per-class compilation results
  (rule, warnings, token usage) are replayed across rebuilds from a
  theme-keyed cache. A one-file edit in a large project now costs
  O(changed files) instead of O(project).
- **`ri()` conditional args hit the cache fast path** — falsy arguments
  (`ri("flex", isActive && "bg-blue-500")`) no longer force re-tokenization
  on every call: the raw-key cache skips falsy primitives, making cached
  conditional-pattern calls ~4x faster.
- **Cheaper compile passes** — duplicate class names across `@apply` rules
  resolve once per pass, the `@slot`/`@apply` walks no longer traverse the
  generated utility CSS, custom `@utility` bodies parse once per body text
  instead of once per variant form, and the editor candidate collector's
  context assignment went from quadratic to a sorted sweep. As part of the
  compile-result replay, engine-level compilation warnings are now
  deduplicated (final project output already was).
- **Internal restructuring (behavior-preserving)** — the directive body
  parsers were split by grammar family: `@color` and `@font` now own their
  own modules, and the generic key-value/entry grammars sit together in the
  directives foundation. The `parsers` import surface is unchanged.

### Deprecated

- The older `@font` forms still parse and desugar into the new model, but
  warn (RI-1218) and will be removed in a future release: `@face { src: …; }`
  blocks and the `italic:` shorthand (use `face:`), `from "<path>"` (use
  `face:`), `from system` (use bare `system`), the `fallback:` key (list
  fallbacks in the slot preamble), the five-key metrics cluster
  `metricsFallback`/`sizeAdjust`/`ascent`/`descent`/`lineGap` (use
  `metrics:`), and the `unicodeRange` spelling (use `unicode-range`).

### Removed

- **`@font` `subset:`** — the Google css2 API takes no subset hint, so the
  key never affected the emitted URL. It now warns (RI-1218) and is ignored.
- **`FontSlot` / `FontFace` fields** — the five slot-level metrics fields
  (`metricsFallback`, `sizeAdjust`, `ascent`, `descent`, `lineGap`) are
  replaced by a single `metrics?: FontMetricsConfig | null`; slot-level
  `preload` moved onto the faces; `FontFace.subset` is gone. Stylesheets are
  unaffected — this only touches code importing those types directly.

### Fixed

- **`ri()` stroke-width vs stroke-color conflict — for real this time.** The
  v0.4.0 changelog described this fix, but the implementation did not ship in
  that release: `ri("stroke-2 stroke-red-500")` still dropped `stroke-2`. The
  `stroke` prefix is now actually width-vs-color dual-mode (mirroring
  `border`/`outline`): decimal and non-color arbitrary values claim
  `stroke-width`, color values claim `stroke`. Same-property conflicts
  (`stroke-2` vs `stroke-4`, `stroke-red-500` vs `stroke-blue-500`) still
  merge as before. The emission↔claim parity suite no longer carries a
  stroke exception, and regression tests pin the merged output.
- **Directive rewriter no longer duplicates unclosed blocks** — an
  unterminated `{` inside a `@color` body made the Vite-plugin pre-pass
  re-emit the text before it (`@color { accent: 0.18 330 { inline` came out
  with the entry doubled). The rewriter's two hand-rolled brace walks were
  replaced by one shared walker built on the same brace matcher the directive
  scan already uses, which also makes quotes and comments inside blocks
  behave consistently across the rewrite passes.

## [0.4.0] - 2026-08-20

### Added

- **GitHub Packages publishing** — every release is now also published to
  GitHub Packages as `@rainbowindex/rainbowindex` (that registry requires an
  owner-scoped name). The README documents installing it under the usual
  name via `pnpm add rainbowindex@npm:@rainbowindex/rainbowindex`, so all
  documented imports and CLI invocations work unchanged.

### Changed

- **Stricter CLI argument validation** — the CLI is now driven by a
  declarative command table that knows which flags and positionals each
  command accepts. Flags used under the wrong command, stray positional
  arguments, and flags missing their value are rejected with an error
  instead of being silently ignored.
- **Internal restructuring** (behavior-preserving, net ≈ −4,500 lines) —
  the merge, scanner, and effects modules were split into focused modules;
  the spacing/border prefix→property maps are now single-sourced from the
  merge conflict table with a machine-checked parity test; `@apply` reuses
  the engine's cascade ordering; the CLI and PostCSS builds share one
  orchestration path with parallelized font fetches; and all internal
  import cycles were broken. Public entry points are unchanged.

### Fixed

- **`ri()` stroke-width vs stroke-color conflict** — width-shaped `stroke-*`
  classes (`stroke-2`, `stroke-1.5`, `stroke-[3px]`) were claiming the
  `stroke` color property in the merge conflict table, so
  `ri("stroke-2 stroke-red-500")` dropped `stroke-2` even though the two
  classes set different CSS properties. The `stroke` prefix is now
  width-vs-color dual-mode (mirroring `border`/`outline`): decimal and
  non-color arbitrary values claim `stroke-width`, color values claim
  `stroke`. Same-property conflicts (`stroke-2` vs `stroke-4`,
  `stroke-red-500` vs `stroke-blue-500`) still merge as before.
- **Watch mode double rebuild** — debouncing and rate-limiting now share a
  single timer, so a burst of file changes landing inside the rate-limit
  window schedules one rebuild instead of a redundant second one.
- **`@color` entries without a colon** — a colon-less fragment in an
  `@color` block now produces a warning and is skipped on its own; it no
  longer swallowed the entry that followed it.

## [0.3.0] - 2026-08-14

### Added — editor tooling API (phase 2)

- **`ClassCandidate.callId`** — helper/safelist candidates now carry the
  identity of the call they were collected from: candidates from the same
  call share one id, distinct calls get distinct ids. This is the grouping
  key merge tooling needs to run `analyzeMerge()` over one `ri(…)` call's
  classes without mixing neighbouring calls. Feature-detect via the new
  `"candidate-call-ids"` entry in `editorCapabilities`.
- **`ri()` joins the scanned class helpers** — the scanner now walks `ri(…)`
  calls like `clsx`/`cn`/`twMerge`, so their arguments get `helper` origin,
  a helper name, and a call id (previously they were only caught by the
  whole-file literal scan as `plain` candidates). `CLASS_HELPER_NAMES`
  includes `"ri"` accordingly.
- **Value typos get suggestions** — the class inspector's suggestion corpus
  now includes the enumerated completion universe, so `validate()` suggests
  concrete neighbours for functional-value typos (`bg-blu-500` →
  `bg-blue-500`, `bg-thme-500` → `bg-theme-500`) instead of staying silent.

### Fixed

- **`--optimize` CLI flag** — the README documented `--optimize` but the CLI
  rejected it with "Unknown option". It is now accepted as an alias of
  `--minify` (both run the same LightningCSS minification +
  browser-fallback pass).

## [0.2.2] - 2026-08-13

### Added — editor tooling API (phase 1)

- **`rainbowindex/editor` entry** — a new IO-free subpath export for editor
  integrations (VS Code and beyond). Pure computation only: no filesystem,
  network, or module-level mutation, so it runs in browser-based editor hosts
  (vscode.dev) as-is. Ships a version handshake (`version`,
  `EDITOR_API_VERSION`, `editorCapabilities`) so extensions can
  feature-detect whatever version the workspace has installed.
- **`extractClassCandidates()`** — position-aware variant of the source
  scanner. Returns every class candidate with its absolute source span, its
  collection origin (`attribute` / `helper` / `safelist` / `plain`, with the
  helper name when applicable), and — for variant-group members — the span of
  the group prefix plus the member token inside the braces, so editors can
  squiggle and edit individual members of `hover:{…}` groups. The value set
  is guaranteed identical to `extractClassesFromSource()`; build output is
  byte-for-byte unchanged.
- **CSS entry detection exports** — `CSS_ENTRY_CANDIDATES` (the CLI/Vite
  probe order, now a pure shared module) plus re-exported `hasRIActivation()`
  and `RI_IMPORT_SPECIFIERS`, letting editor hosts locate the project's CSS
  input with their own file access.
- **Scanner context exports** — `CLASS_HELPER_NAMES` / `VARIANT_HELPER_NAMES`
  so completion-context detection in editors matches the scanner's behavior.
- **`analyzeProjectCSS()`** — the theme-only front half of `compileProject`
  (CSS input string → `ResolvedTheme` + directives + warnings), now exported
  for editors. No file IO, no font resolution — cheap enough to re-run on
  every CSS-entry change.
- **`createClassInspector(theme)`** — single-class validation and
  explanation running the exact resolution the compiler performs, giving the
  intentionally-silent RI-1001 a voice in editors. `validate()` reports
  `unknown-utility` / `unknown-variant` / `invalid-arbitrary` with the
  offending fragment and an OSA-distance typo suggestion (`felx` → `flex`,
  including custom `@utility` and `@custom` names); `explain()` returns the
  parsed structure, root declarations, escaped selector, full rule CSS, and
  sort key. Instances cache per-theme state and resolutions, so
  per-keystroke validation is cheap. Guaranteed: `validate(cls).ok` exactly
  when `compile([cls])` emits a rule.
- **`listVariants(theme)`** — enumerates every concrete variant the theme
  resolves (pseudo-classes, pseudo-elements, media, breakpoints, container
  queries, special selectors, custom `@custom` variants) plus the open-ended
  pattern families (`data-`, `aria-`, `group-`, …), each tagged with a kind
  and what it wraps. Every concrete entry is guaranteed to resolve.
- **`parseUtility()` / `findClosest()`** — the class parser (structured
  `ParsedUtility`) and the OSA typo suggester, exported for editor use.
- **`createEditorSession({ css })`** — the façade an editor holds per
  workspace: theme analysis, inspector, enumeration, token introspection,
  merge snapshot, candidate extraction, and swatches behind one object whose
  caches invalidate together on `setCss()`.
- **Color swatches** — `resolveColorSwatch(theme, name, stop)` resolves a
  theme color to concrete light/dark values using the same OKLCH math as the
  emitted CSS variables (the dark-mirror computation is now shared via
  `computeDarkStop`), plus `oklchToHex`/`cssColorToHex` conversion for
  completion swatches; handles generative palettes, explicit values, hex,
  light/dark pairs, aliases, and the semantic paper/ink colors.
  `listThemeTokens(theme)` returns one render-ready view of every token
  namespace for sidebar chips.
- **Structured diagnostics with source spans** — `analyzeProjectCSS()` now
  additionally returns `diagnostics`: the same messages as `warnings`, in the
  same order, each with the parsed `RI-NNNN` code, a severity derived from
  the documented code-range convention (0xxx/2xxx → error), and a
  [start, end) span into the CSS input where the emitter knew one. Directive
  parse problems (`RI-1011/1012/1036/1202`) anchor at their exact site;
  resolver problems anchor at the directive whose body produced them (via
  new opt-in attribution in `resolveDirectives`); post-loop validations stay
  unattributed. `Diagnostic`, `severityForCode()`, `warningCode()`, and
  `diagnosticFromWarning()` ship from `rainbowindex/editor` so editors can
  structure any legacy warning stream. The string arrays remain unchanged
  everywhere.
- **`analyzeMerge(classes, snapshot?)`** — explains `ri()`'s right-most-wins
  conflict resolution for a pre-tokenized class list: the merged `output`,
  which indices survive, and — for every dropped class — the ascending
  indices of the survivors that claimed its properties (joint domination
  like `text-lg` overridden by `[font-size:16px]` + `leading-tight` lists
  both winners). Runs the exact scan `ri()` runs, via an optional trace that
  costs the hot path one falsy check per property. Powers "this class is
  overridden" editor diagnostics.
- **`createThemeSnapshot(theme)`** — builds a `CompilationSnapshot` straight
  from a resolved theme (custom text sizes, font slots, color names, custom
  utility property claims) without a compile pass, for theme-accurate
  `analyzeMerge()`/`createRi()` in editors. The registration logic is now
  shared with the compile loop (`registerThemeOnContext`).
- **`enumerateClassNames(theme)`** — the finite completion universe: every
  static utility, every theme-token expansion (colors × stops, text sizes,
  rounded, shadows, weights, …), and custom `@utility` entries, ~3,400
  classes on the default theme in ~12 ms. Candidates come from a generous
  per-root value-space table (`UTILITY_VALUE_SPACES`) and are then probed
  through the real utility resolver, so every enumerated class is valid by
  construction; infinite families (the spacing scale, numeric values,
  functional custom utilities) are returned as templates. Tests enforce the
  reverse direction: every dispatch root must declare a value space, and
  every merge-table static must enumerate.

### Changed

- **`generate-types` rewritten on top of `enumerateClassNames`** — the CLI's
  generated `rainbowindex-env.d.ts` now covers the full utility surface
  (previously a hand-maintained subset: 8 color roots, spacing, text, fonts,
  sizing) and a complete `Variant` union driven by `listVariants`. Plain
  classes are checked against the enumerated finite union plus
  spacing/numeric templates; variant-prefixed classes validate the variant
  name (misspelled variants like `hver:` are now compile errors in strict
  mode).
- **Fixed: generated types failed to compile** — the previous
  `rainbowindex-env.d.ts` defined `RainbowClass` with a circular
  `Exclude<RainbowClass, …>` self-reference, which TypeScript rejects
  (TS2456), silently breaking `ri()` autocomplete in strict projects. The
  new two-tier `RainbowBase`/`RainbowClass` shape compiles cleanly (~0.7 s
  for a ~3,400-literal union).
- `[RI-1501]`/`[RI-1502]` (fluid typography) now flow into compile warnings
  when a warning sink is present instead of only the dev console; the dev
  console remains the fallback.
- Internal: activation detection moved from `directives/index.ts` into a pure
  leaf module (`directives/activation.ts`) so the editor entry and browser
  bundles don't pull the directive resolver's Node-only font machinery into
  their module graph. All existing import paths keep working via re-exports.
- Internal: `analyzeProjectCSS` moved from `project/pipeline.ts` into a pure
  leaf module (`project/analyze.ts`), and `compileUtility` gained an optional
  failure-detail out-param — both re-exported/behavior-identical, byte-for-
  byte identical CSS output.
- Internal: the pure font model (types + slot/face factories) moved from the
  `font-providers` barrel into `font-providers/model.ts`; directive parsing
  now imports it (and the font-family safety constants) from leaf modules,
  making the editor entry's module graph structurally free of `node:*`
  imports rather than relying on tree-shaking. The barrel re-exports the
  model, so existing importers are unaffected.

## [0.2.1] - 2026-07-28

### Added — diagnostics

- **Vite misuse guard (`[RI-1606]`)** — the default `rainbowindex` export is
  the PostCSS plugin; placing it in Vite's `plugins: []` array previously did
  nothing (no CSS, no error). It now carries an inert Vite-plugin facade that
  throws `[RI-1606]` when Vite resolves config, pointing to
  `import rainbowindex from "rainbowindex/vite"`. The guard is never dispatched
  by PostCSS, so raw PostCSS usage is unaffected.

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
