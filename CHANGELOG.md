# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-09-01

### Added

- **Numeric font weights, checked against the fonts you load.** `font-<number>`
  now sets `font-weight` directly, for any weight from 1 to 1000 —
  `font-300`, `font-500`, `font-617`. A named `@weight` token of the same
  spelling still wins, and `font-[850]` is unchanged.

  The number is compared against the `weight` of every loaded `@font` face. A
  range (`weight: 300 900`, the variable-font case) accepts every number
  between its bounds; a list or a single value (`weight: 400,700`) accepts
  only those numbers. A weight that no face provides warns with the new
  `[RI-1504]`, and the message names the weights that are available.

  A class on its own carries no family, and a page can load several fonts, so
  that check is a union: one covering face is enough. It stays quiet with no
  `@font` block, and with a `system` slot, whose OS font has every weight.

  Where the family *is* named — a `font-<slot>` beside the weight in one
  `@apply` / `@a` / `@utility` class list — that family alone decides:

  ```css
  [data-slot="code"] {
  	@a font-mono font-550;   /* Fira Code does not provide weight 550. It has 400, 700. */
  }
  ```

  The last family in the list wins, and the two classes must share a variant
  prefix (`md:font-mono` does not set the family for a plain `font-550`). A
  weight no font provides is still reported once, by the union check. A class
  written in markup has no list — the scanner keeps only the set of names — so
  the union check governs there.

  Completions and the generated class types offer `font-100` … `font-900`
  beside the named `@weight` tokens, and read `font-<number>` as an open
  numeric template.

- **Three editor capabilities.** `rainbowindex/editor` gains `isSuppressible`
  (`diagnostic-suppression`), so an editor offers a `ri-disable` comment only
  where one would work; `weightIsLoaded` and `describeLoadedWeights`
  (`font-weight-coverage`), the `[RI-1504]` check, so it can answer which
  loaded fonts carry a weight; and `ThemeTokens.radii` / `ThemeTokens.fluidRanges`
  (`named-radii-and-fluid-ranges`), which named radii and named `@fluid` ranges
  had no token surface for. Gate on the capability strings, never on `version`.

- **`ri-disable` comments.** Two plain CSS comments silence a diagnostic, so a
  stylesheet carrying them stays valid CSS for every other tool.

  `/* ri-disable RI-1124 */` anywhere in the CSS entry silences that code
  everywhere. It is the only form that reaches the scanner and compile codes
  (14xx, 15xx), which carry no position in your CSS. One comment may name
  several codes: `/* ri-disable RI-1124, RI-1122 */`.

  `/* ri-disable-next-line RI-1124 */` silences one place. Inside a scale body
  it guards the entry that follows; outside a body it guards the next
  directive:

  ```css
  @rounded {
  	roof: 24px;
  	/* ri-disable-next-line RI-1124 */
  	full: 30px;
  	hut: 8px;   /* still checked */
  }
  ```

  Entry precision is available where the emitter knows the entry —
  `[RI-1035]`, `[RI-1121]`, `[RI-1122]`, `[RI-1124]`. Other codes fall back to
  the directive.

  `RI-00xx` and `RI-20xx` cannot be silenced: they report a broken build or a
  broken call, not a style choice. Naming one warns with the new `[RI-1040]`,
  as does a comment that names no readable code.

- **`compileProject()` reports what it silenced.** The result gains
  `suppressed`, the set of codes the entry's `ri-disable` comments named, so
  a caller that pushes warnings of its own can drop the ones the author
  hid. Every stage inside the compile already pushes through it.

- **Fluid endpoint pairs.** Fluid utilities take both ends of the ramp:
  `p-fluid-4/8` grows from step 4 to step 8 across the `@fluid` range, and
  `text-fluid-sm/3xl` ramps between two type steps. Arbitrary lengths and
  `(--var)` endpoints mix (`p-fluid-[0.5rem]/(--x)`), zero is a legal
  endpoint, and a descending pair (`p-fluid-8/4`) shrinks as the viewport
  grows. Fluid type also takes the line-height modifier now:
  `text-fluid-lg/7`, `text-fluid-sm/3xl/tight`.

- **Named `@fluid` ranges and scope classes.** `@fluid compact { min: 20rem;
  max: 48rem; }` defines a range, the tokens `--fluid-compact-{min,max}`, and
  the scope class `fluid-compact`, which points every fluid utility on the
  element and its descendants at that range through the inherited
  `--fluid-scope-{min,max}` pair. A unit on a named range warns with
  `RI-1039`; an unknown range name on the class warns with `RI-1503`.

- **Container-query units in `@fluid`.** `unit` accepts `cqw`, `cqi`,
  `cqmin`, and `cqmax`, so fluid ramps can track a container instead of the
  viewport.

- **Named radii in `@rounded`.** A key without a `--` prefix now names a
  radius: `@rounded { roof: 24px; }` gives the class `rounded-roof` and the
  token `--rounded-roof`, and the name works with the side and corner
  suffixes (`rounded-tl-roof`). `--corner-scale` is still the only option;
  any other `--` key still warns with `[RI-1122]`. Radii without a name stay
  spacing multiples, so `rounded-4` is unchanged.

- **Utility blocks in every named scale.** A `name { … }` or `name-* { … }`
  block in a scale body defines a utility in that scale's class family, so the
  math sits next to the tokens it reads:

  ```css
  @rounded {
  	roof: 24px;
  	roof-minus-* {
  		border-radius: calc(var(--rounded-roof) - var(--value) * var(--spacing));
  	}
  }
  ```

  `rounded-roof-minus-2` subtracts two spacing steps from `--rounded-roof`.
  The block uses the `@utility` grammar and the name takes the family's
  prefix. `@rounded`, `@shadow`, `@blur`, `@z`, `@leading`, `@tracking`,
  `@opacity`, `@duration`, `@ease`, `@weight`, `@text` and `@animate` all
  accept them; `@weight` blocks land under `font-`.

  `@color` does not: a colour name feeds `bg-`, `text-`, `border-`, `ring-`
  and more, so a block would have no one family to land in. `@breakpoint`
  names variants rather than utilities, and `@spacing` holds a single base
  value.

  A colon is what separates a utility block from the two block grammars that
  already existed. `key: value { … }` stays what it was — `@color` options,
  `@animate` keyframes — and only a block with no key before it is a utility.

  Radius tokens are written to `:root` whether used or not, because a block
  body is raw CSS that no usage pass can read.

- **`@shadow` aliases.** A shadow value that is only another shadow's class
  name now emits a reference to it: `@shadow { md: …; card: shadow-md; }`
  gives `--shadow-card: var(--shadow-md)`. Using `shadow-card` pulls
  `--shadow-md` into `:root` alongside it, so an alias never renders against
  an undefined variable. The target may be defined in a later `@shadow`
  block. An alias to a token that does not exist warns with the new
  `[RI-1123]` and keeps its value verbatim.

### Removed

- **`@utility` no longer accepts a leading `.` on the name.** `@utility .card`
  used to be silently treated as `@utility card`. No other directive did
  this, and the dot was ignored without a word in `@source inline(".card")`,
  `safelist(".card")`, and `class=".card"` markup, so the one exception
  taught a rule that held nowhere else. A dotted name now warns with
  `[RI-1035]` and is skipped, like every other invalid name. Write
  `@utility card`.

- **The shipped shadow scales are gone.** No `shadow-*` tokens ship any more:
  the layered `px`–`2xl` scale and its building blocks (`line`, `drop`,
  `hi-1`–`hi-4`, `dark-line`, `ring`, `layer-1`–`layer-7`) are removed, along
  with the hardcoded `inset-shadow-*`, `text-shadow-*`, and `drop-shadow-*`
  size scales. A shadow is now a project decision, not a shipped opinion.
  Every value form still works — `shadow-none`, `shadow-{color}`,
  `shadow-[v]`, and the same forms for the other three families — and `ring`
  and `inset-ring` are untouched. Named sizes come back with
  `@shadow md: …;`, and bare `shadow` reads the `DEFAULT` token.
  Because the scale is empty by default, bare `shadow` is no longer a
  built-in static utility: it resolves only when the theme defines
  `DEFAULT` (or `md`).

- **The last shipped scales are gone: breakpoints, weights, easing, blur,
  animations, and the fluid range.** The package now ships exactly two
  defaults — the colour palette and the `0.25rem` spacing base. Everything
  else is a project decision:

  | Gone | Was | Comes back with |
  | --- | --- | --- |
  | `sm:` `md:` `lg:` `xl:` and `@sm:` `@md:` … | 40/48/64/80rem | `@breakpoint { sm: 40rem; … }` |
  | `font-thin` … `font-black` | 100–900 | `@weight { bold: 700; … }` |
  | `ease-in`, `ease-out`, `ease-in-out` | cubic-beziers | `@ease { in: cubic-bezier(0.4, 0, 1, 1); … }` |
  | `blur-xs` … `blur-3xl`, bare `blur` | 2px–64px, 8px | `@blur { md: 12px; … }` |
  | `animate-spin`, `animate-pulse`, `animate-bounce`, `animate-ping` | four loops | `@animate { spin: spin 1s linear infinite { … } }` |
  | `p-fluid-*`, `text-fluid-*`, `fluid-<name>` | 20rem–80rem ramp | `@fluid { min: 20rem; max: 80rem; }` |

  The keyword and arbitrary forms are untouched: `blur-none`, `blur-[3px]`,
  `ease-linear`, `ease-[cubic-bezier(…)]`, `animate-none`, `animate-[…]`,
  `font-[850]`, and the whole enter/exit system (`animate-in`, `fade-in-50`,
  `slide-in-from-top-4`, `blur-in-8`) need no tokens and keep working.
  `max-w-sm` is a container width, not a breakpoint, and is unchanged.

  Two consequences worth naming. A `@fluid` range no longer half-exists: with
  no `min`/`max` the `--fluid-*` tokens are not written and every fluid
  utility resolves to nothing, rather than ramping across a range nobody
  chose. And `@fluid text`/`@fluid spacing`/named ranges no longer inherit a
  shipped range to fill their gaps — a bound that is absent is simply not
  configured, so `[RI-1022]`/`[RI-1023]` now fire only on a bound you
  actually wrote.

- **The shipped type scale is gone.** No `--text-*` tokens ship any more: the
  14-step `2xs`–`9xl` text scale, the `leading-*` scale (`3`–`10`, `none`,
  `tight`, `snug`, `normal`, `relaxed`, `loose`), and the `tracking-*` scale
  (`tighter`–`widest`) are removed. Type is now a project decision, not a
  shipped opinion. Every value form still works — `text-[18px]`,
  `text-lg/[1.5]`, `leading-px`, `leading-[1.5]`, `tracking-[0.1em]` — and
  `text-{color}` is untouched. Named sizes come back with `@text lg: 1.25rem,
  1.4;`, `@leading tight: 1.25;`, and `@tracking wide: 0.025em;`.
  `text-fluid-{size}` needs at least two `@text` steps to interpolate
  between, and the `text-lg/7` modifier reads `@leading` tokens.

- **`DEFAULT_TEXT_SIZES` is no longer exported.** `ri()` classified
  `text-{name}` as a size against a hardcoded list that never matched the
  shipped scale (it held `base`, which the scale lacked, and lacked `md`,
  which the scale had). The merger now learns every size name from the
  compiled theme, the way it already learns custom colors and font slots.
  Before the first compile, `text-{name}` reads as a color.

### Fixed

- **A rejected utility block no longer corrupts the entries beside it.** A
  block is cut from the directive body whether or not its name survived, but
  the body was only swapped in when at least one block parsed. So a scale whose
  blocks were *all* rejected kept its raw `{ … }` text, and the key/value
  parsers — which do not read braces — took the block's own declarations for
  scale entries: `@shadow { bad.name-* { box-shadow: … } }` defined a shadow
  called `box-shadow`. Ten of the twelve block-taking scales were affected;
  `@rounded` and `@animate` parse braces themselves and were not.

- **A circular `@shadow` alias chain is reported.** `a: shadow-b; b: shadow-a`
  and the self-alias `a: shadow-a` were accepted and rewritten into `var()`
  references that point at each other, which CSS treats as guaranteed-invalid —
  the shadow resolved to nothing, with nothing said. Both now warn with the new
  `[RI-1125]` and keep their value verbatim, the way `@color` has always
  reported the same shape with `[RI-1107]`. A chain that is not a cycle still
  resolves.

- **`FluidUnit` admits the container-query units.** `@fluid { unit: cqw; }`
  validated and emitted correctly, but the exported type still listed only the
  four viewport units, so a `FluidConfig` held a value its own type rejected.

- **An empty weight in a `@font` face is no longer read as weight zero.**
  `Number("")` is `0` and finite, so the trailing comma in `weight: 400,700,`
  produced a face covering weight 0 and listed it in the `[RI-1504]` inventory.
  A range is also read either way round now, so `weight: 900 300` describes the
  same span as `300 900`.

- **Named radii reach completions.** `@rounded { roof: 24px; }` compiled
  `rounded-roof` and resolved it on hover, but class enumeration never read
  `theme.radii`, so the name was offered by neither the completion list nor the
  generated types — unlike every sibling scale, which reads its own record.

- **`ri-disable` now reaches the scanner codes on every surface.** The
  file-wide comment is the only form that can silence a scan warning
  (`RI-14xx`), because those codes carry no position in your CSS — but the
  scanned build path pushed them without consulting it, so
  `/* ri-disable RI-1408 */` worked headless and did nothing under the CLI,
  PostCSS, and Vite. The scan warnings now enter through the same filter as
  every other stage. Vite's `@apply` expansion runs before any compile, so it
  reads the codes straight out of the entry it holds.

- **A `ri-disable-next-line` comment outside a directive body reports its own
  mistakes.** Only directive bodies were read for pragma errors, so a typo or
  an unsilenceable code in a top-level comment was ignored without the
  `[RI-1040]` it promises. Such a comment is read once now, and an in-body
  comment still warns exactly once.

- **A named scale entry no longer loses to the built-in it shadows.**
  `@shadow { none: … }`, `@blur { none: … }` and `@duration { initial: … }`
  parsed and resolved, then the generator's own keyword branch answered
  first and the value was dropped without a word. Every named scale now
  resolves theme-first, matching `@z`, `@leading`, `@opacity`, and `@ease`,
  which already did.

- **`[RI-1408]` no longer fires on large files that hold no variant groups.**
  The expansion budget counted plain pass-through text toward its 100,000
  character limit, so any scanned file over that size warned as soon as it
  held a single `{` — which every JavaScript and TypeScript file does. The
  budget now counts only what expansion adds, so it measures the growth it
  was written to bound. Input (500,000, `[RI-1407]`) and brace depth (10,
  `[RI-1409]`) are unchanged.
- **A single oversized variant group is measured before it is built.** The
  budget was only read between groups, so one group — its prefix copied onto
  every member — could allocate far past the limit before anything stopped
  it. Each group is now sized first and left verbatim when it does not fit.

### Changed

- **Clashing with a built-in class name now warns with the new `[RI-1124]`.**
  `@rounded { full: 30px; }` takes over `rounded-full`; the warning names the
  class so the takeover is a choice, not a surprise. It fires for every named
  scale, and only for names the consumer actually wrote — replacing a default
  token such as `@color { red: … }` or `@blur { sm: … }` stays quiet. The set
  of built-in names is read from the generators themselves rather than from a
  hand-kept list, so it cannot drift. Where the built-in belongs to another
  family and keeps the class — `blur-in` is an enter-animation utility that
  only shares the `blur-` prefix — the warning says so instead of claiming a
  takeover that did not happen.

- **`ri()` resolves a named animation as an animation.** `animate-{name}`
  merged through a hand-kept list of the shipped names, so a name from
  `@animate` — and now every animation name, since none ships — was not
  classified at all and could not replace another. The `animate-` prefix now
  carries `animation`, the way `ease-` and `blur-` already carried theirs.

- **`[RI-1004]` no longer names `sm/md/lg/xl` as built-in variants.** No
  breakpoint ships, so the suggestion pointed at variants that do not exist
  until `@breakpoint` names them. It now says so.

- **Variant-group diagnostics name their source file.** `[RI-1407]`,
  `[RI-1408]` and `[RI-1409]` now read `[RI-1408] src/App.tsx: …`, matching
  `[RI-1411]`. Under PostCSS and Vite these warnings carried no location at
  all, so a project-wide warning gave nothing to search for. Warnings
  deduplicate on the full text, so a repeated breach now reports once per
  file instead of once per project.

- **A rebuild reads only the files that changed.** `rainbowindex --watch`
  and the Vite dev server now let the watcher own cache invalidation. The
  source file list is cached until a file is added or removed — the CLI
  watcher joins the Vite plugin, which already cached it — and a file's
  scanned classes are trusted until the watcher reports that file changed,
  so a rebuild no longer runs a `stat()` on every source file to learn that
  one of them moved. The union of scanned classes is also kept between
  rebuilds as a multiset, and only the files whose result changed are folded
  again: re-unioning from scratch costs one set insert per class occurrence,
  which on a 2000-file project is roughly 480,000 inserts to rediscover the
  same few hundred names. A one-shot build arms neither cache — with no
  watcher to evict entries, it would serve whatever it read last.

- **`compileProject()` reuses its analysis when the CSS is byte-identical.**
  The memo that the CLI, PostCSS, and Vite builds already shared now sits
  with the analysis itself, so the headless API gets it too. Repeat compiles
  of one entry keep a single theme object, which is what every downstream
  cache is keyed on — custom utilities, variants, and the per-class compile
  memo. Warnings and diagnostics are still copied per call, so a caller that
  mutates them cannot corrupt the memo.

## [0.5.1] - 2026-08-28

### Fixed

- **Inline SVG path data is no longer scanned for classes.** Raising the
  line-length guard to 10,000 characters in 0.5.0 let a multi-KB `d="…"`
  attribute reach the whole-file token scan, where path data tokenizes
  cleanly against the class grammar: one 10 KB icon component went from 33
  candidates to 845, the extra 812 being fragments like `9.17-57.2` and
  `40c-.35-1.1-1.04`. They matched no utility and carried the `plain` origin
  editors skip, so nothing rendered wrong and nothing was reported — each
  one just cost a compile lookup and a cache entry on every build. `d` and
  `points` values are now blanked before extraction, in every file type.
  Only quoted values are matched, so `d={expr}` bindings still yield their
  classes.
- **A JavaScript term is no longer reported as a class.** Candidate origins
  were assigned purely by span containment, so any token the whole-file scan
  matched inside a helper call or class attribute inherited that context's
  origin. The token scan's grammar also matches bare identifiers, so
  `ri(mode === "default" ? "fill-white" : "fill-black")` reported `mode` with
  `origin: "helper"` — and editors, which read a certain origin as "this is a
  class", flagged it as an unknown class. A candidate now inherits a context's
  origin only when a context-aware collector tokenized it; containment still
  decides which context wins. Extracted values are unchanged, so no generated
  CSS moves.
- **Bare unquoted class attributes keep their `attribute` origin.**
  `collectAssignedValues` now tokenizes an undelimited value (`class=flex` in
  HTML, Vue and Svelte) the same way it already tokenized a quoted one. Without
  this they would have lost provenance and demoted to `plain`.
- **`@apply` no longer emits a rule with no selector.** A rule carrying both
  the `group` marker and a `group-*` variant resolved its group root to
  itself, so stripping the root prefix off the resolved selector left nothing:
  `.self { @apply group group-hover:underline; }` emitted a bare
  ` { text-decoration-line: underline; }`, which a browser discards as a parse
  error, taking the declarations with it. The group root is the element, so
  the variant now targets the element — `.self:hover`. The same shape reached
  by climbing rather than matching in place, a nested `&` block inside the
  group root, is fixed with it.
- **RI-1002 no longer fires for a bracket token the scanner merely read.** An
  unresolved arbitrary value is a typo worth reporting when the author wrote
  the class, but the scanner reads whole files, comments and prose included,
  where `min-[437px]` is just text — and every such token warned. Classes
  written by hand still warn: `@source inline(...)`, `@apply`, and a
  caller-supplied `classNames` list. Provenance is not baked into the compile
  memo, so a class that is both scanned and authored warns once rather than
  never.

### Added

- **RI-1412 — whitespace in an arbitrary value now warns.** A class name
  cannot contain whitespace: `class`, `@a`/`@apply`, and `safelist()` all
  split on it, so `bg-[url('a b')]` reaches the browser as the two tokens
  `bg-[url('a` and `b')]` and matches nothing. The scanner has always dropped
  these, silently, leaving no CSS and no reason why. The warning names the
  class and points at the `_` escape (`bg-[url('a_b')]` emits `url('a b')`).
  It fires only where a collector treats its input as a class list — an
  attribute value, a helper argument, a `safelist()` argument — so ordinary
  JS and prose stay quiet, `styles["my class"]` in a `className` expression
  included. Extracted values are unchanged.
- **`"expression"` candidate origin.** A string literal that is an operand of
  `==`/`!=` (so also `===`/`!==`) cannot be a class list: in
  `mode === "default"`, `"default"` is a value being compared. Such literals
  are still extracted — dropping them would change generated CSS — but they
  now report `origin: "expression"` instead of `"helper"`/`"attribute"`.
  Editors should treat it like `"plain"` and never report it as a bad class.
  Assignment is deliberately not matched: `const base = "px-2"` is an ordinary
  class list.
- **`candidate-origin-provenance` capability.** Feature-detect both behaviours
  above through `editorCapabilities`, never a version compare.
- **Functional custom utilities — `@utility name-* { … }`.** The body reads
  `var(--value)` and the class suffix replaces it, nested blocks included:
  `@utility glow-* { box-shadow: 0 0 var(--value) gold; }` answers `glow-4`
  and `glow-[3px]`, with `[2px_4px]` decoding to `2px 4px`. An exact static
  name beats a functional match, so `@utility card` and `@utility card-*`
  coexist; the longest root wins between functional entries (`a-b-*` over
  `a-*` for `a-b-4`); and neither a bare root (`glow`) nor a negated class
  (`-glow-4`) matches. A suffix carrying `;`, `{`, or `}` is rejected rather
  than allowed to break out of the declaration. `ri()` treats two suffixes of
  one root as conflicting, so `ri("glow-4 glow-8")` keeps `glow-8`.
- **Consumer documentation in [`docs/`](docs/README.md).** One page per
  subject — getting started, class syntax, utilities, theming, fonts, source
  scanning, class merging, diagnostics, environment variables — and one per
  integration surface — CLI, PostCSS plugin, Vite plugin, Vite+, Node API,
  editor API. The README keeps the overview and links out.
- **Vite+ support.** The Vite plugin now adds every stylesheet that activates
  Rainbow Index to `fmt.ignorePatterns`, so `vp check` no longer stops at
  `Syntax error: component value is expected` before it can lint or type
  check. Directive bodies are not valid CSS — a `@font` entry carries a block
  after a declaration, a scale removes a token with `!name;`, `@fluid` takes
  bare keywords, and `@apply` takes variant groups — and Oxfmt parses CSS
  strictly. Vite+ reads its `fmt` block off the resolved Vite config, so the
  plugin contributes the patterns from its `config` hook; plain Vite ignores
  the extra key. Projects without the Vite plugin add the patterns by hand.
  See [docs/vite-plus.md](docs/vite-plus.md).
- **`rainbowindex/oxlint`.** A new entry point with one Oxlint rule,
  `prefer-ri`, which reports an import of `clsx`, `classnames`, or
  `tailwind-merge`. Each merges classes against a Tailwind utility table, so
  it resolves conflicts against the wrong utility set and never sees the
  theme. The rule is off until a project enables it, and the plugin has no
  dependencies.

### Changed

- **`ri()` caches results in two generations instead of an LRU.** The old
  cache moved every hit to the end of a `Map` so insertion order tracked
  recency, which made the steady state — the same class lists on every render
  — pay a delete and a re-insert per call. The new cache keeps a current and a
  previous generation: a hit in the current one is a single `Map.get`, and
  when the current fills it becomes the previous and a fresh one starts. A hit
  on a previous entry promotes it, so hot keys survive the swap while cold
  ones age out with the dropped generation. The cache now holds at most twice
  `RI_CACHE_MAX` (500) entries instead of evicting the oldest quarter at the
  cap, and `evictLRU` is gone with the design that needed it.
- **The per-class compile memo is bounded.** Keyed on theme identity, it grew
  for the life of the process, so a long dev session could hold every class
  ever compiled against a still-live theme. It now clears wholesale at 50,000
  entries. Steady state is the project's whole scanned vocabulary, which sits
  far below the cap — a lower one would clear mid-compile on every rebuild and
  defeat the memo.
- **`@apply` resolution is cached per theme, not per invocation.** Every
  rebuild re-resolved every `@apply` class from scratch, although the scan
  analysis and pipeline memos keep the theme object stable across rebuilds, so
  the old results were still valid. The cache is a `WeakMap` keyed on the
  theme and dies with it. The `[RI-1005]` walk of a custom utility body is
  cached alongside: its warnings are now replayed into every class that hits
  the utility rather than emitted once per compile, so they survive a rebuild
  in which the class that first triggered the walk is gone. The plugin still
  dedupes repeats downstream.
- **The resolved source-file list is cached while a watcher runs.** Each
  rebuild re-globbed the project to find the same files. A cached list is only
  correct while something reacts to file adds and deletes, so caching is
  opt-in: the Vite plugin arms it and clears it from the dev-server watcher
  (`add`, `unlink`, `unlinkDir`). One-shot builds and `postcss-cli --watch`,
  which has no watcher hook, keep the always-fresh glob. A glob already in
  flight when an invalidation arrives is not cached.
- **A source edit that changes no class no longer re-transforms the CSS.** The
  Vite plugin now keeps a sorted candidate list per source file and compares it
  on every hot update. An edit to logic, comments, or copy leaves that list
  identical, and identical candidates produce byte-identical CSS — so the
  Rainbow Index stylesheets stay out of the update and only the edited module
  reloads. A first sighting or an unreadable file invalidates conservatively.
- **`preload-fonts --help` names the faces that produce a tag.** Only local
  file and raw-URL faces marked `preload` do. Google serves CSS rather than the
  font binary, so a Google or system slot never emits one — but the help text
  claimed `@font-face` was covered too. Text only; the command is unchanged.

### Removed

- **The named radius scale.** `rounded-2xs` through `rounded-xl`, the bare
  `rounded` / `rounded-t` / `rounded-tl` shorthands, the `--rounded-*`
  variables, the `--rounded-roof` anchor, and the token body of `@rounded` are
  all gone. A radius is now a spacing multiple: `rounded-4` is
  `calc(var(--spacing) * 4 * var(--ri-rounded-scale, 1))`. `rounded-none`,
  `rounded-full`, `rounded-scale-*`, arbitrary values, and every logical side
  and corner (`rounded-t-4`, `rounded-ss-2`) are unchanged.

  Two scales set the same shape, so they drifted apart: the named tokens hung
  off `--rounded-roof` while the numeric forms hung off `--spacing`, and
  `rounded-lg` next to `rounded-4` mixed two rhythms in one component. One
  scale, anchored to spacing, keeps the whole system in step.

  Migration: replace each named token with the spacing step you want. A
  `@rounded` body that sets radius tokens now warns with `[RI-1122]`; keep
  `--corner-scale` and drop the rest. `--roof` is gone — set the radius you
  want on the element.

### Notes for integrators

`ResolvedTheme` lost `rounded` and `roundedRoof`, `Theme` lost `rounded`,
`listThemeTokens()` no longer returns a `rounded` record, and
`CompilationResult` lost `usedRounded`. Nothing prunes `--rounded-*` any more,
because the token layer no longer emits it. `roundedShape` and
`roundedShapeScale` stay — `@rounded <shape>` is unchanged.

`CandidateOrigin` gained a member. Code that switches on it exhaustively must
handle `"expression"`; code that tests `origin !== "plain"` to mean "this is a
class" was already wrong and is now wrong in a new way — test for the origins
you trust instead.

`CompilationSnapshot` gained `customFunctionalProps`, the roots of functional
`@utility` entries and the properties each one claims. `createThemeSnapshot()`
fills it in; a snapshot built by hand needs the field.

`createCompiler().compile()` takes an optional third argument, the set of
classes the caller wrote by hand. Omit it and every class counts as authored,
which is what a caller assembling its own list wants. `compileProject()`
applies the same split on its own: `classNames` is authored, `sources` content
is scanned.

`getCustomUtility(theme, name)` is replaced by
`matchCustomUtility(utility, value, negative, theme)`, which returns the
matching entry and the text a functional body substitutes for `var(--value)`.
The `@apply` walk and the declaration expansion both go through it, so they
can never disagree about which utility a class hit. The old function resolved
static entries only. Neither name is exported from the package entry, so only
code importing the internal module path is affected.

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
