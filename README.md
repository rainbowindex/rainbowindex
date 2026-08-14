<p align="center">
  <a href="https://rainbowindex.dev" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rainbowindex/rainbowindex/HEAD/.github/logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/rainbowindex/rainbowindex/HEAD/.github/logo-light.svg">
      <img alt="Rainbow Index" src="https://raw.githubusercontent.com/rainbowindex/rainbowindex/HEAD/.github/logo-light.svg" width="144" height="41" style="max-width: 100%;">
    </picture>
  </a>
</p>

**Rainbow Index** is a CSS-first system for building and maintaining consistent user interfaces.

The project began as a fork of [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss), then diverged with clear intent: to treat CSS as the primary source of truth for styling decisions and to provide tooling that translates design system definitions into predictable, inspectable output. Styling behavior is explicit and traceable, allowing developers to understand not only what is happening, but why.

We built the system around composable primitives rather than finished components. Instead of prescribing layout patterns or UI components, it focuses on utilities, directives, and tokens that can be combined without accumulating configuration debt.

Rainbow Index challenges several assumptions common in modern styling workflows. Configuration does not default to JavaScript. Flexibility is not achieved through layered indirection. Utility-based systems are not assumed to be verbose, opaque, or fragile.

The product is not a visual design tool, a component library, or a framework abstraction layer. It assumes familiarity with core CSS concepts and expects users to engage with the underlying model.

When tradeoffs arise, we consistently prioritize composability, user control, predictable performance, explicit behavior, and correctness over convenience or familiarity.

## Install

```sh
pnpm add rainbowindex
```

Requires Node `>=20.19`. The package is **ESM-only** — there is no CommonJS build, so `require("rainbowindex")` is only supported on runtimes that can `require()` ES modules (Node 20.19+); use `import` otherwise (e.g. an ESM `postcss.config.js`/`.mjs`). `postcss` is a required peer dependency, `vite` an optional one; `lightningcss`, `chokidar`, and `tinyglobby` are bundled as direct deps.

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

```css
/* src/styles.css */
@import "rainbowindex";
```

```tsx
// src/App.tsx
export default function App() {
	return <div className="flex gap-4 px-6 py-3 bg-blue-500 text-white">Hello</div>;
}
```

To scaffold a fresh app instead, use the CLI:

```sh
pnpm dlx rainbowindex create my-app --template react-ts
# or wire into an existing Vite app
pnpm dlx rainbowindex init
```

## CLI

The `rainbowindex` binary exposes five subcommands. The default is `build`.

```
rainbowindex <glob> [options]        Generate CSS from source files
rainbowindex init                    Wire Rainbow Index into the current Vite app
rainbowindex create <dir>            Scaffold a Vite app with Rainbow Index ready
rainbowindex generate-types          Generate TypeScript types for ri() autocomplete
rainbowindex preload-fonts           Generate <link rel="preload"> tags for resolved fonts
```

Common flags:

| Flag | Description |
| --- | --- |
| `-o`, `--output <file>` | Output CSS file path. Required with `--watch`. |
| `--watch` | Re-run on source-file changes (chokidar). |
| `--minify` | Minification + browser-fallback passes via LightningCSS. `--optimize` is an accepted alias. |
| `--css <file>` | CSS input with directives. Auto-detected if omitted. |
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
| `sources` | `string[]` | Glob patterns for files to scan. Can also be declared via `@source` in CSS. |
| `cwd` | `string` | Working directory. Defaults to `process.cwd()`. |

## Vite plugin

```ts
import rainbowindex from "rainbowindex/vite";
```

Auto-detects your CSS entry, injects a PostCSS config if none exists, supports HMR with file versioning. No options required for the common case.

## Class syntax

### Utilities

Roughly the same surface area as Tailwind: spacing, sizing, typography, color, layout, borders, effects, animations, and SVG. Use `rainbowindex generate-types` for autocomplete in your editor.

### Variants

Prefix any utility with one or more variants, separated by `:`.

```html
<button class="bg-blue-500 hover:bg-blue-600 dark:bg-blue-400 sm:px-6">…</button>
```

Supported variants:

- **Pseudo-classes** — `hover`, `focus`, `focus-visible`, `active`, `visited`, `disabled`, `enabled`, `checked`, `empty`, `first`, `last`, `odd`, `even`, `only`
- **Pseudo-elements** — `before`, `after`, `placeholder`, `file`, `marker`, `selection`, `first-line`, `first-letter`, `backdrop`
- **Media** — `dark`, `print`, `portrait`, `landscape`, `motion-safe`, `motion-reduce`, `starting`
- **Breakpoints** — `sm`, `md`, `lg`, `xl` (theme-driven, customizable via `@breakpoint`)
- **Container queries** — `@sm`, `@md`, …
- **Attribute selectors** — `data-[state=open]`, `aria-[pressed=true]`
- **Arbitrary** — `[selector]`, `[@media(...)]`

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
<div class="hover:text-red-500 hover:bg-blue-100 hover:underline">…</div>
<div class="hover:{text-red-500 bg-blue-100 underline}">…</div>
```

Groups stack and nest:

```html
<!-- Chained variants -->
<div class="sm:hover:{bg-gray-700 text-white}">…</div>

<!-- Multiple groups in one class string -->
<div class="focus:{outline-2 outline-blue-500} disabled:{opacity-50 cursor-not-allowed}">…</div>

<!-- The data-attribute case -->
<div class="data-[active]:{relative px-2} data-[slot=sidebar]:{fixed leading-none}">…</div>
```

Expansion happens at scan-time, so the runtime never sees the grouped form. Nesting is capped at depth 10; expanded output is capped at 1MB.

## Theming with CSS directives

Customization happens in your CSS input, not a JS config. The engine recognizes:

| Directive | Purpose |
| --- | --- |
| `@color` | Define color tokens. Supports generative (`chroma hue`), explicit (`oklch(...)`, `#rrggbb`), light/dark pairs, and aliases. |
| `@spacing` | Set the spacing base unit. |
| `@text` | Define text size tokens (`size, line-height`). |
| `@font`, `@font-face` | Register font families inside a single `@font { … }` block. One slot can own multiple `@face` faces (e.g. upright + italic) or use the `italic:` shorthand. |
| `@rounded` | Border-radius tokens; modifier sets corner shape (`round`, `squircle`, `superellipse(N)`, etc). |
| `@fluid` | Configure fluid type/spacing range. |
| `@animate` | Register named animations with inline `@keyframes`. |
| `@utility` | Define a custom utility (static or functional `name-*`). |
| `@apply` | Compose utilities into a single rule. |
| `@custom` | Define a custom variant. |
| `@slot` | Slot marker inside `@custom` block form. |
| `@source` | Declare additional source globs from CSS. Supports `not "..."` and `inline("...")`. |
| `@preflight` | Toggle preflight base styles. |
| `@layer`, `@media`, `@custom-media`, `@import` | Standard CSS plus a few extensions. |

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
	sans: "Inter" from google { weight: 400 700; }
	display: "Satoshi" from "/fonts/Satoshi.woff2" {
		weight: 300 900;
		italic: "/fonts/Satoshi-Italic.woff2";   /* second face, font-style: italic */
	}
}

@source "../emails/**/*.html";
@source not "../**/legacy/*";
```

Default theme keys: `colors`, `spacing`, `text`, `breakpoints`, `rounded`, `shadows`, `weights`, `easing`, `fluid`, `animations`, `blur`, `z`.

## `ri()` — runtime class merger

`ri()` merges class strings with right-most-wins conflict resolution. It replaces both `clsx` (for conditional composition) and `tailwind-merge` (for conflict resolution).

```ts
import { ri } from "rainbowindex";

ri("px-2 py-1", isActive && "bg-blue-500", "px-4");
// → "py-1 bg-blue-500 px-4"   (px-2 is dropped — px-4 wins)
```

Accepted inputs:

```ts
type ClassInput = string | false | null | undefined | ClassInput[];
ri(...inputs: ClassInput[]): string;
```

Conflict resolution understands shorthands: `p-4` claims all four padding sides, but only drops if every side is overwritten by a class to its right.

### `ri()` vs `createRi()` — which one do I use?

| Situation | Use |
| --- | --- |
| Browser bundle / client components | **`ri()`** |
| Vite build / PostCSS one-shot | **`ri()`** |
| Single Node compile that exits | **`ri()`** |
| Concurrent SSR (one server, many requests) | **`createRi(snapshot)`** |
| Multi-tenant compile (different themes in the same process) | **`createRi(snapshot)`** |
| Edge / serverless functions sharing module state across invocations | **`createRi(snapshot)`** |

`ri()` reads module-level state published by the most recent compile. That's
fast and ergonomic in any environment where there is exactly one compile
per process. If two requests can be merging classes against two different
themes in the same Node process, that shared state will leak — use
`createRi(snapshot)` to bind each request to its own frozen snapshot.

```ts
// Anywhere ri() is single-compile-safe (browser, Vite, PostCSS):
import { ri } from "rainbowindex";

const className = ri("px-2 py-1", isActive && "bg-blue-500", "px-4");
```

```ts
// SSR / multi-tenant — capture the snapshot at compile time, bind per-request:
import { compileProject, createRi, finalizeCompilationContext } from "rainbowindex";

// At server startup (once per theme):
const ctx = await compileProject({ cwd, css });
const snapshot = finalizeCompilationContext(ctx);
const ri = createRi(snapshot);

// In your request handler:
function render(req, res) {
	const html = `<div class="${ri("px-2 py-1", req.dark && "dark:bg-slate-900")}">…</div>`;
	res.send(html);
}
```

If you call `ri()` while a compilation is still in progress (e.g. inside a
server-rendering pass that triggers a fresh compile), the runtime emits a
throttled `[RI-2004]` warning. That's your signal to switch to `createRi()`.

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
session.enumerate();                    // ~3,400 probe-verified completions + templates
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
| 10xx | Compilation & directives |
| 11xx | Color directives |
| 12xx | Font system |
| 13xx | Merge / compilation context |
| 14xx | Source scanner |
| 15xx | Typography utilities |
| 16xx | Integration plugins (Vite, PostCSS, CLI wiring) |
| 20xx | CSS function processing |
| 21xx | `ri()` runtime |

See the [diagnostics reference](https://rainbowindex.dev/docs/diagnostics) for the full code → cause → fix table.

Warnings are deduplicated and capped at 200 per compile, with 20 slots reserved for high-severity errors.