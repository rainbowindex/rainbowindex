# PostCSS Plugin

The package's default export is a PostCSS plugin. It compiles your directives, scans your source files, and writes the generated CSS in front of your own CSS. The Vite plugin injects it for you. Use it directly when you run PostCSS without Vite.

## Setup

```js
// postcss.config.js (ESM)
import rainbowindex from "rainbowindex";

export default {
	plugins: [rainbowindex({ sources: ["src/**/*.{ts,tsx,html}"] })],
};
```

The package is ESM-only. Use an ESM `postcss.config.js` or a `.mjs` file.

## Options

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `sources` | `string[]` | none | Extra glob patterns to scan for class names. An invalid pattern warns with `[RI-1015]` and is skipped. |
| `cwd` | `string` | `process.cwd()` | Base directory for glob resolution. Must be an absolute path, or the plugin throws `[RI-0002]`. |

CAUTION: When you set `sources`, or when the CSS contains a positive `@source` glob, the default scan patterns turn off. List every pattern that you need.

## How the plugin processes your CSS

1. The plugin reads the full CSS text. CSS above 5 MB warns with `[RI-1019]`, and the plugin does nothing else.
2. CSS without Rainbow Index activation passes through byte-identical. Activation means a Rainbow Index directive or an `@import` of `"rainbowindex"` or `"rainbowindex/index.css"`.
3. The plugin scans the source files and compiles the theme, the utilities, and the variants.
4. The plugin removes the directive at-rules and the Rainbow Index imports from your CSS. Your other CSS stays.
5. The plugin expands `@apply` (see below).
6. The plugin puts the generated CSS sections before your CSS.
7. The plugin resolves Rainbow Index CSS functions inside declaration values.
8. Warnings surface through `result.warn`, deduplicated, with a limit of 200 per compile.

An unexpected error is rethrown as `[RI-0001]` with the file, line, and column, plus a hint about the probable cause.

## Where class names come from

The plugin scans files from three sources, in this order:

1. `@source` directives in the CSS. See [source-scanning.md](source-scanning.md).
2. The `sources` option.
3. Dependency safelists. A dependency can declare `"rainbowindex": { "safelistSources": ["./dist/*.mjs"] }` in its own `package.json`. The plugin then scans those files inside the package.

When neither `@source` nor `sources` gives a positive glob, the defaults apply: `*.html` and `src/**/*.{html,js,jsx,ts,tsx,mdx,vue,svelte}`, with the standard excludes (`node_modules/**`, `dist/**`, `build/**`, `coverage/**`, `public/**`, `**/*.config.*`, `**/*.d.ts`).

## `@apply` expansion

The `@apply` at-rule composes utilities into one CSS rule. `@a` is its only alias. Expansion runs inside this plugin, so the CLI alone cannot do it.

```css
[data-slot="hero"] {
	@a grid gap-4 p-8 hover:shadow-lg hover:bg-theme-600;
}
```

Rules of expansion:

- Write plain classes. The variant-group form `hover:{...}` is not valid here. The raw `{` is a CSS parse error before this plugin runs. Only the Vite plugin rewrites those groups before the parse. See [vite-plugin.md](vite-plugin.md).
- All variants that work in class attributes also work in `@apply`, and `@custom` variants too.
- Classes sort by property group, like standalone utility rules. Inside one property group, the written order stays, and the last declaration wins. `@apply px-2 px-4` and `@apply px-4 px-2` give different results.
- An unknown utility warns with `[RI-1005]` and is skipped. An unknown variant warns with `[RI-1004]` and skips that class.
- `@apply` at the top level, outside a rule, warns with `[RI-1006]` and is removed.
- The `group` class is a marker. It emits no declarations and marks the rule as a group root. `group-*` variants resolve against the nearest group root and are emitted at the document root with full selectors.

Limits: 500 classes per directive and 5 expansion passes for nested `@apply`.

## Caching

- If the CSS text is byte-identical to the previous compile, the plugin reuses the parsed theme.
- Dependency safelist discovery is cached per working directory, keyed on the `package.json` modification time.
- Duplicate classes across `@apply` rules resolve once per compile.

## No watch dependencies

The plugin does not register PostCSS `dependency` messages. Under `postcss --watch`, webpack, or any watcher that relies on those messages, an edit in a scanned source file does not rebuild the CSS. Only a CSS edit does.

For development, use the Vite plugin, which recompiles on source changes, or the CLI with `--watch`. See [vite-plugin.md](vite-plugin.md) and [cli.md](cli.md).

## Limits

- CSS input: 5 MB.
- Scanned source file: 1 MB per file. Larger files are skipped.
- Inline `@source` content: 100 KB.
- Glob timeout: 30 seconds.
- Warnings: 200 per compile, with 20 slots reserved for high-severity errors.

## Diagnostic codes on this page

| Code | Meaning |
| --- | --- |
| `RI-0001` | The plugin failed with an unexpected error. |
| `RI-0002` | The `cwd` option is invalid or not absolute. |
| `RI-1004` | Unknown variant in `@apply`. |
| `RI-1005` | Unknown utility in `@apply`, or circular `@apply`. |
| `RI-1006` | Top-level `@apply`, too many classes, or depth limit reached. |
| `RI-1015` | Invalid `sources` glob pattern. |
| `RI-1019` | The CSS input is above 5 MB. |
| `RI-1037` | `@slot` outside a `@custom` block. |
| `RI-1410` | Invalid `safelistSources` entry in a dependency. |

The full table is in [diagnostics.md](diagnostics.md).
