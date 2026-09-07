<p align="center">
  <a href="https://rainbowindex.dev" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rainbowindex/rainbowindex/HEAD/.github/assets/logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/rainbowindex/rainbowindex/HEAD/.github/assets/logo-light.svg">
      <img alt="Rainbow Index" src="https://raw.githubusercontent.com/rainbowindex/rainbowindex/HEAD/.github/assets/logo-light.svg" width="161" height="41" style="max-width: 100%;">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/rainbowindex/rainbowindex/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/rainbowindex/rainbowindex/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://www.npmjs.com/package/rainbowindex"><img alt="npm" src="https://img.shields.io/npm/v/rainbowindex.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/npm/l/rainbowindex.svg"></a>
</p>

**Rainbow Index** compiles a design system out of CSS. Your tokens live in CSS
directives rather than a JavaScript config, and the compiler turns them into
utilities, a typed contract for your editor, and diagnostics when something is
wrong.

- **The theme is CSS.** `@color { brand: 0.18 330; }` declares a generative
  OKLCH palette; `@text`, `@breakpoint`, `@shadow` and the rest work the same
  way. No config file to keep in sync.
- **Nothing ships until you name it.** `text-lg` and `bg-blue-500` do not exist
  until a directive defines them, so the output is your system rather than a
  filtered copy of someone else's. One import brings Tailwind v4's scales.
- **It tells you when you are wrong.** Numbered diagnostics for a color that
  fails contrast, a class that can never match, a token that resolves to
  nothing.
- **Your editor knows your theme.** `rainbowindex/editor` enumerates ~3,900
  completions from your own CSS, and says what a class compiles to and why a
  merge dropped one.

It compiles [100% of Tailwind v4's class surface](#tailwind-class-coverage), so
moving over is mostly copy-paste — and
`rainbowindex migrate tailwind` translates the theme for you, then tells you
which of your classes stop resolving ([docs/migrating.md](docs/migrating.md)). [Why Rainbow Index?](docs/why.md) compares it
against Tailwind, UnoCSS, Panda and StyleX — losses included.

The documentation is in [docs/](docs/README.md).
[docs/frameworks.md](docs/frameworks.md) has copy-paste setup for Vite, React
Router, SvelteKit, Astro and Next.js.

## Install

```sh
pnpm add rainbowindex
```

Requires Node `>=20.19`. The package is **ESM-only** — there is no CommonJS build, so `require("rainbowindex")` is only supported on runtimes that can `require()` ES modules (Node 20.19+); use `import` otherwise (e.g. an ESM `postcss.config.js`/`.mjs`). `postcss` is a required peer dependency, `vite` an optional one; `lightningcss`, `chokidar`, and `tinyglobby` are bundled as direct deps.

Every release is also published to GitHub Packages under an owner-scoped name.
That registry authenticates every read, so it needs two lines of `.npmrc` — see
[Install](docs/getting-started.md#from-github-packages).

## Quick start (Vite)

The fastest path is the Vite plugin, which auto-injects PostCSS config and discovers your CSS entry on first dev-server listen.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import rainbowindex from "rainbowindex/vite";

export default defineConfig({
	plugins: [rainbowindex()],
});
```

Then pick a starting theme.

**Tailwind-familiar.** One extra import brings Tailwind v4's default scales — 26 color families, the `sm` through `2xl` breakpoints, `text-xs` through `text-9xl`, and the weight, leading, tracking, radius, shadow, blur, easing, and animation names.

```css
/* src/styles.css */
@import "rainbowindex";
@import "rainbowindex/tailwind.css";
```

```tsx
// src/App.tsx
export default function App() {
	return <div className="sm:flex gap-4 px-6 py-3 text-lg font-bold rounded-lg shadow-md bg-blue-600 text-white">Hello</div>;
}
```

**From scratch.** Name the tokens your design system has, and nothing else.

```css
/* src/styles.css */
@import "rainbowindex";

@color {
	brand: 0.18 330;
}

@text { body: 1rem, 1.5; }
@breakpoint { sm: 40rem; }
```

```tsx
// src/App.tsx
export default function App() {
	return <div className="sm:flex gap-4 px-6 py-3 text-body bg-brand-500 text-white">Hello</div>;
}
```

### What does not ship by default

The package ships two scales: the neutral `theme` color and the `0.25rem` spacing base. Breakpoints, text sizes, weights, leading, tracking, radii, shadows, blur, easing, animations, and fluid ranges all start empty, so `sm:flex`, `text-lg`, `font-bold`, `shadow-md`, and `rounded-lg` render nothing until a directive names them. The fixed color names `black`, `white`, `paper`, `ink`, `transparent`, `current`, and `inherit` always work; `blue-500` does not exist until you declare it.

The forms that compute rather than look up need no theme at all: `p-4`, `rounded-4`, `font-600`, `z-10`, `text-[18px]`, `blur-none`.

`rainbowindex/tailwind.css` is the escape hatch, not the default. It is a plain directive file — read it, copy the blocks you want, or import it whole. Import it after the package, and override any token by declaring it again below. Importing it costs only what you use: every token is pruned to what the build actually references, so a page that names four colors emits four.

To scaffold a fresh app instead, use the CLI:

```sh
pnpm dlx rainbowindex create my-app --template react-ts
# or wire into an existing Vite app
pnpm dlx rainbowindex init
```

## CLI

The `rainbowindex` binary exposes seven subcommands. The default is `build`.

```
rainbowindex <glob> [options]        Generate CSS from source files
rainbowindex init                    Wire Rainbow Index into the current Vite app
rainbowindex create <dir>            Scaffold a Vite app with Rainbow Index ready
rainbowindex generate-types          Generate TypeScript types for ri() autocomplete
rainbowindex generate-snapshot       Generate the theme snapshot that makes client ri() theme-aware
rainbowindex preload-fonts           Print <link rel="preload"> tags for local faces marked preload
rainbowindex scan <glob>             Print the class names the scanner extracts from files
```

Common flags:

| Flag | Description |
| --- | --- |
| `-o`, `--output <file>` | Output CSS file path. Required with `--watch`. |
| `--watch` | Re-run on source-file changes (chokidar). |
| `--minify` | Minification + browser-fallback passes via LightningCSS. `--optimize` is an accepted alias. |
| `--css <file>` | CSS input with directives. Auto-detected if omitted. For `init`/`create`: the stylesheet to create or patch (default `src/index.css`). |
| `--strict` | Drop the string escape hatch in generated types. |
| `--template <name>` | Vite template to scaffold (default: `react-ts`). |

Example:

```sh
rainbowindex "src/**/*.{ts,tsx}" -o dist/styles.css --watch
```

## PostCSS plugin

The package's default Node export is a PostCSS plugin.

```js
// postcss.config.js
import rainbowindex from "rainbowindex";

export default {
	plugins: [rainbowindex({ sources: ["src/**/*.{ts,tsx,html}"] })],
};
```

Options:

| Option | Type | Description |
| --- | --- | --- |
| `sources` | `string[]` | Glob patterns for files to scan. Can also be declared via `@source` in CSS. Any positive glob (here or via `@source`) replaces the default scan patterns. |
| `cwd` | `string` | Working directory. Defaults to `process.cwd()`. |

## Vite plugin

```ts
import rainbowindex from "rainbowindex/vite";
```

Auto-detects your CSS entry, injects a PostCSS config if none exists, supports HMR with file versioning. The plugin takes no options — to pass PostCSS options, create a `postcss.config.js` and register the PostCSS plugin there yourself.

## Vite+

[Vite+](https://viteplus.dev) works out of the box. Four deprecated directive spellings are not valid CSS, so Oxfmt — the formatter behind `vp fmt` and `vp check` — cannot parse a stylesheet that still uses them. The Vite plugin adds only those files to `fmt.ignorePatterns`; a stylesheet written the canonical way is hidden from nothing.

See [docs/vite-plus.md](docs/vite-plus.md).

## Component variants

`recipe()` is a typed variant layer whose output is ordinary class names — the
`cva`/`tv` shape, merged through `ri()` so conflicts resolve against your
compiled theme instead of a Tailwind utility table.

```ts
import { recipe } from "rainbowindex/recipe";

const button = recipe({
	base: "inline-flex items-center rounded-card font-medium",
	variants: {
		tone: { solid: "bg-brand-600 text-white", quiet: "text-brand-700" },
		size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4" },
	},
	defaultVariants: { tone: "solid", size: "md" },
});

button({ size: "sm" });   // → "inline-flex … bg-brand-600 text-white h-8 px-3 text-sm"
button({ size: "xl" });   // ✗ Type error: "xl" is not a size
```

The classes live in the config, where the scanner already reads them. See
[docs/recipe.md](docs/recipe.md).

## Editor support

**Rainbow Index for VS Code**, on the Marketplace and thin over
`rainbowindex/editor`: completions from *your* theme (a `@color` you added five
seconds ago completes), hover showing the generated rule and the colour's light
and dark hex, diagnostics on a class that compiles to nothing, colour chips you
can drag, an element tree and a theme explorer, go-to-definition, rename, and a
sort command that matches the order the stylesheet emits. It loads the copy of
the package your workspace installed, so upgrading the package upgrades what
your editor knows. Source at https://github.com/miloag/extension — see [docs/editor.md](docs/editor.md).

## Lint rules

Three opt-in rules, for Oxlint and ESLint. Two of them read your compiled theme,
so they can tell you a class is wrong rather than merely unfamiliar:
`no-unknown-class` reports a class that compiles to nothing (with the typo
suggestion as an editor fix), and `no-conflicting-classes` reports a class that
another class in the same string erases. `prefer-ri` reports an import of
`clsx`, `classnames` or `tailwind-merge`.

```ts
// vite.config.ts
export default defineConfig({
	lint: {
		jsPlugins: [{ name: "rainbowindex", specifier: "rainbowindex/oxlint" }],
		rules: {
			"rainbowindex/no-unknown-class": "error",
			"rainbowindex/no-conflicting-classes": "warn",
			"rainbowindex/prefer-ri": "error",
		},
	},
});
```

See [docs/lint.md](docs/lint.md) for the ESLint flat-config form and the options.

## Class syntax

### Utilities

The same utility families as Tailwind — spacing, sizing, typography, color, layout, borders, effects, animations, and SVG — but not the same named tokens. `text-lg` and `shadow-md` resolve only once a directive names them, or once you import the preset (see [What does not ship by default](#what-does-not-ship-by-default)). The numeric, keyword, and arbitrary forms need no theme: `p-4`, `rounded-4`, `font-600`, `text-[18px]`, `blur-none`. Use `rainbowindex generate-types` for autocomplete in your editor.

### Variants

Prefix any utility with one or more variants, separated by `:`.

```html
<button class="bg-brand-500 hover:bg-brand-600 dark:bg-brand-400 sm:px-6">…</button>
```

Supported variants:

- **Pseudo-classes** — `hover`, `focus`, `focus-visible`, `active`, `visited`, `disabled`, `enabled`, `checked`, `empty`, `first`, `last`, `odd`, `even`, `only`
- **Pseudo-elements** — `before`, `after`, `placeholder`, `file`, `marker`, `selection`, `first-line`, `first-letter`, `backdrop`
- **Media** — `dark`, `print`, `portrait`, `landscape`, `motion-safe`, `motion-reduce`, `starting`
- **Breakpoints** — every name from `@breakpoint`; none ships
- **Container queries** — the same names with an `@` prefix
- **Attribute selectors** — `data-[state=open]`, `aria-[pressed=true]`
- **Arbitrary** — `[selector]`, `[@media(...)]`

This list is a subset — the full variant tables are in [docs/class-syntax.md](docs/class-syntax.md).

### Arbitrary values

```html
<div class="w-[37rem] bg-[#1a73e8] data-[state=open]:opacity-100"></div>
```

CSS variable shorthand:

```html
<div class="bg-(--brand-color) text-(--brand-text)"></div>
```

### Variant groups

When multiple utilities share the same variant prefix, group them with `{…}` instead of repeating the prefix:

```html
<!-- These two lines are equivalent -->
<div class="hover:text-brand-500 hover:bg-brand-100 hover:underline">…</div>
<div class="hover:{text-brand-500 bg-brand-100 underline}">…</div>
```

Prefixes chain:

```html
<!-- Chained variants -->
<div class="sm:hover:{bg-theme-700 text-white}">…</div>

<!-- Multiple groups in one class string -->
<div class="focus:{outline-2 outline-brand-500} disabled:{opacity-50 cursor-not-allowed}">…</div>
```

Expansion happens at scan-time, so the runtime never sees the grouped form. Only plain prefixes work — bracketed variants like `data-[state=open]:` cannot prefix a group, and braces do not nest (chain the prefixes instead). Expansion input is capped at 500,000 characters, output at 100,000.

## Theming with CSS directives

Customization happens in your CSS input, not a JS config. The engine recognizes:

| Directive | Purpose |
| --- | --- |
| `@color` | Define color tokens. Supports generative (`chroma hue`), explicit (`oklch(...)`, `#rrggbb`), light/dark pairs, and aliases. |
| `@spacing` | Set the spacing base unit. |
| `@text` | Define text size tokens (`size, line-height`). |
| `@font` | Register font families inside a single `@font { … }` block. Local files are repeatable `face:` entries (e.g. upright + italic). Known families get an automatic zero-CLS metrics fallback (`metrics: none` opts out). Plain `@font-face` rules are standard CSS and pass through untouched. |
| `@rounded` | Corner shape (`round`, `squircle`, `superellipse(N)`, etc), and named radii. Unnamed radii are spacing multiples: `rounded-4`. |
| `@fluid` | Configure fluid type/spacing range. |
| `@animate` | Register named animations with inline `@keyframes`. |
| `@utility` | Define a custom utility (static or functional `name-*`). |
| `@apply` | Compose utilities into a single rule. |
| `@custom` | Define a custom variant. |
| `@slot` | Slot marker inside `@custom` block form. |
| `@source` | Declare additional source globs from CSS. Supports `not "..."` and `inline("...")`. |
| `@preflight` | Toggle preflight base styles. |
| `@breakpoint`, `@shadow`, `@weight`, `@ease`, `@blur`, `@z`, `@leading`, `@tracking`, `@opacity`, `@duration` | Key-value token scales; `key: initial;` removes a token. |
| `@register` | Emit CSS `@property` registrations. |
| `@layer` | Place the generated output in cascade layers (intercepted, own grammar). |
| `@media`, `@import`, other standard at-rules | Standard CSS — passed through untouched. |

A named scale can also hold utilities. A `name { … }` block with no colon before it defines a utility in that scale's class family, so `@shadow { lifted-* { … } }` makes `shadow-lifted-*`. See [theming.md](docs/theming.md#utility-blocks).

Example:

```css
@import "rainbowindex";

@color {
	brand: 0.18 330;                   /* generative: chroma hue */
	brand-soft: oklch(0.92 0.04 330);  /* explicit */
	surface: oklch(0.98 0.01 260) / oklch(0.15 0.01 260);  /* light/dark pair */
}

@spacing { base: 0.5rem; }

@text {
	display: 4rem, 1.05;
	body: 1rem, 1.5;
}

@font {
	sans: "Inter", ui-sans-serif, sans-serif from google { weight: 400 700; }
	display: "Satoshi" {
		weight: 300 900;
		face: /fonts/Satoshi.woff2;
		face: /fonts/Satoshi-Italic.woff2 { style: italic; }
	}
}

@source "emails/**/*.html";
@source not "src/**/legacy/*";
```

The package ships two defaults: the `colors` palette and the `spacing` base. Every other scale — `text`, `leading`, `tracking`, `shadows`, `radii`, `breakpoints`, `weights`, `easing`, `blur`, `animations`, `fluid`, `z`, `opacity`, `duration` — starts empty, and its directive defines the named tokens. Numeric and keyword class forms are computed, so they work with no theme at all.

That is the default because a token you did not define is a token nobody has to reason about. When you want Tailwind's names instead, `@import "rainbowindex/tailwind.css";` after the package import supplies them, written in the same directives documented above — so you can open the file and copy the blocks you want rather than importing all of it.

## `ri()` — runtime class merger

`ri()` merges class strings with right-most-wins conflict resolution. It replaces both `clsx` (for conditional composition) and `tailwind-merge` (for conflict resolution).

```ts
import { ri } from "rainbowindex";

ri("px-2 py-1", isActive && "bg-brand-500", "px-4");
// → "py-1 bg-brand-500 px-4"   (px-2 is dropped — px-4 wins)
```

Accepted inputs:

```ts
type ClassInput = string | false | null | undefined | ClassInput[];
ri(...inputs: ClassInput[]): string;
```

Conflict resolution understands shorthands: `p-4` claims all four padding sides, but only drops if every side is overwritten by a class to its right.

### `ri()` vs `createRi()` — which one do I use?

| Situation | Use | What you have to do |
| --- | --- | --- |
| Vite — client, SSR, build | **`ri()`** | Nothing. |
| Any other bundler (Next.js, Webpack, Rspack, esbuild) | **`ri()`** | `rainbowindex generate-snapshot`, then import it once. |
| Single Node compile that exits | **`ri()`** | Nothing. |
| Many themes in one process (multi-tenant, per-request themes) | **`createRi(snapshot)`** | One merger per theme. |

`ri()` answers by asking the *published theme* what properties a class sets.
Since 0.6.0 every text size, weight, font slot, and color name is
project-defined, so a client with no theme published reads `text-lg` as a color
and returns just `text-white` for `ri("text-lg text-white")`.

A compile publishes a theme. A browser bundle never compiles — so the Vite
plugin publishes one for it automatically, and every other bundler gets the
same result from a generated module:

```sh
rainbowindex generate-snapshot   # writes rainbowindex-snapshot.ts
```

```ts
// app entry, before anything that calls ri()
import "./rainbowindex-snapshot";
```

If two requests can be merging classes against two different themes in the same
process, bind each to its own frozen snapshot with `createRi(snapshot)` — the
generated module exports one.

```ts
// Anywhere ri() is single-compile-safe (browser, Vite, PostCSS):
import { ri } from "rainbowindex";

const className = ri("px-2 py-1", isActive && "bg-brand-500", "px-4");
```

```ts
// SSR / multi-tenant — bind a merger to one compile, isolated per theme:
import { compileProject, createRi } from "rainbowindex";
import { createThemeSnapshot } from "rainbowindex/editor";

// At server startup (once per theme):
const result = await compileProject({ css });
const ri = createRi(createThemeSnapshot(result.theme));

// In your request handler:
function render(req, res) {
	const html = `<div class="${ri("px-2 py-1", req.dark && "dark:bg-slate-900")}">…</div>`;
	res.send(html);
}
```

The default `ri()` warns `[RI-2004]` once per process when it merges a
theme-dependent class with no theme published, naming the class it had to guess
about. Publishing any theme silences it — a single-theme app that publishes at
startup is correct, and is not warned at.

## Editor tooling API

`rainbowindex/editor` is an IO-free toolkit for editor integrations — pure
computation (strings in, structures out) with no `node:*` imports anywhere in
its module graph, so it runs in browser-based editor hosts (vscode.dev)
exactly as it does in Node. The host reads files; the entry supplies the
semantics. Feature-detect via `editorCapabilities` rather than versions —
integrations load whatever version the workspace has installed.

```ts
import { createEditorSession } from "rainbowindex/editor";

const session = createEditorSession({ css: themeCss });

session.diagnostics;                    // positioned problems in the CSS input
session.inspector.validate("felx");     // { ok: false, reason: "unknown-utility", suggestion: "flex" }
session.inspector.explain("sm:px-4");   // parsed structure + generated CSS + sort key
session.enumerate();                    // ~3,900 probe-verified completions + templates
session.analyzeMerge(["px-2", "px-4"]); // which classes ri() drops, and who overrode them
session.swatch("brand", 500);           // light/dark oklch + hex for completions
session.extractCandidates(source, path); // class tokens with exact source spans
session.setCss(nextCss);                // theme changed → all caches invalidate together
```

Everything the session wraps is also exported à la carte —
`analyzeProjectCSS`, `createClassInspector`, `listVariants`,
`enumerateClassNames`, `analyzeMerge` + `createThemeSnapshot`,
`resolveColorSwatch` / `listThemeTokens`, `extractClassCandidates`, and the
CSS-entry detection helpers (`CSS_ENTRY_CANDIDATES`, `hasRIActivation`).
Guarantees worth knowing: `validate(cls).ok` exactly when the compiler emits
a rule for `cls`; every enumerated class is probe-verified against the real
resolver; `analyzeMerge(...).output` is identical to `ri()`'s result; and
swatches use the same OKLCH math as the emitted CSS variables.

## Environment variables

| Variable | Effect |
| --- | --- |
| `RI_DEBUG=1` | Enable debug logging. |
| `RI_OFFLINE=1` | Skip network calls; use cached font data only. |
| `RI_FETCH_FONTS=0` | Disable Google Fonts metadata requests. |
| `RI_CACHE_DIR` | Override font cache directory (default: `node_modules/.cache/rainbowindex`). |
| `RI_FONT_CACHE_TTL` | Font cache max age in seconds (default: `604800` — 7 days). |

## Diagnostics

Warnings carry `RI-NNNN` codes. Ranges:

| Range | Subsystem |
| --- | --- |
| 00xx | PostCSS plugin bootstrap (thrown) |
| 10xx | Compilation & directives |
| 11xx | Color directives & resolver catch-alls |
| 12xx | Font system |
| 13xx | Merge / compilation context |
| 14xx | Source scanner |
| 15xx | Typography utilities |
| 16xx | Integration plugins (Vite, PostCSS, CLI wiring) |
| 20xx | CSS functions, `ri()` runtime & `compile()` validation |

See [docs/diagnostics.md](docs/diagnostics.md) for the full code → cause → fix table.

Warnings are deduplicated and capped at 200 per compile, with 20 slots reserved for high-severity errors.

## Benchmarks

Measured 2026-09-06 on an Apple M4 (10 cores), Node 24.20.0, against a generated
10,000-file codebase (12.75 MB of source, 13,507 distinct classes) with
rainbowindex loading its Tailwind preset so all three engines compile the same
strings.

| Engine | Cold build | Rebuild (unchanged) | Rebuild (1 file) | Scan only | Output | Peak RSS |
| --- | --- | --- | --- | --- | --- | --- |
| rainbowindex 0.6.0 | 845 ms | 583 ms | 585 ms | 539 ms | **977 KB** | **354 MB** |
| Tailwind CSS 4.3.3 | **330 ms** | **40 ms** | **90 ms** | **39 ms** | 1.01 MB | 391 MB |
| UnoCSS 66.8.1 | 1.29 s | 503 ms | 502 ms | 440 ms | 1.00 MB | 427 MB |

Read that honestly: **Rainbow Index produces the smallest stylesheet of the
three and is the slowest to rebuild.** Almost all of the gap is the scanner —
`539 ms` of a `585 ms` rebuild — because Tailwind's is compiled Rust
(`@tailwindcss/oxide`) and this one is JavaScript. On a cold build, where the
scan is a smaller share of the work, the gap to Tailwind closes to about 2.6×.

Against UnoCSS it is three scenarios each: Rainbow Index wins cold build, output
size and peak memory; UnoCSS wins both rebuilds and the scan.

### Tailwind class coverage

```bash
pnpm bench:parity
```

This asks Tailwind v4 for its own complete class list — the 23,289 names its
IntelliSense uses — renders every one, and reports which Rainbow Index does not
implement.

**100.00%.** Every one of the 23,289 renders. The last 297 outstanding were
`ring-offset-*` (296) and `ring-inset`; both are implemented, and the sweep is
what says so — it is recomputed on demand rather than quoted from a table
someone maintains by hand. What still differs is how a handful of them compile,
not whether they do: see
[differences from Tailwind](docs/utilities.md#differences-from-tailwind).

The harness, the method, and where the comparison stops being fair are all in
[bench/README.md](bench/README.md); full results, including the 1,000-file tree,
are in [bench/results/](bench/results/). Reproduce with:

```bash
pnpm bench --sizes=1k,10k
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the test layout, how to add a utility, and how `RI-NNNN` codes are allocated. Security reports go through [SECURITY.md](SECURITY.md).

[docs/stability.md](docs/stability.md) says what is already treated as a contract before 1.0, what warning a change gives you, and which runtimes are supported.

## License

MIT — see [LICENSE](LICENSE). Rainbow Index began as a fork of Tailwind CSS v4 and carries work derived from tailwind-merge and tw-animate-css; their notices are in [NOTICE.md](NOTICE.md).
