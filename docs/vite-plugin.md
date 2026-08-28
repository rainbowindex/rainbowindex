# Vite Plugin

The Vite plugin is the recommended integration for development. It injects the PostCSS plugin, finds your CSS entry, and recompiles the CSS when source files change.

## Setup

```ts
// vite.config.ts
import { defineConfig } from "vite";
import rainbowindex from "rainbowindex/vite";

export default defineConfig({
	plugins: [rainbowindex()],
});
```

```css
/* src/index.css */
@import "rainbowindex";
```

The plugin function takes no options. To pass options to the PostCSS plugin, create a `postcss.config.js` file and register the plugin there yourself. See [postcss-plugin.md](postcss-plugin.md).

## What the plugin does

The plugin is a thin layer. All CSS generation happens in the PostCSS plugin. The Vite plugin has five jobs:

1. **PostCSS injection.** If no `postcss.config.{js,mjs,ts,cjs}` file exists at the Vite root, the plugin injects the PostCSS plugin with default options. If one of those four files exists, the plugin injects nothing. Your file must then register the PostCSS plugin itself.
2. **CSS entry discovery.** When the dev server starts, the plugin looks for CSS files that activate Rainbow Index. If it finds none, it warns with `[RI-1602]` and points you to `rainbowindex init`.
3. **Directive rewrites.** Some directive-body syntax is not valid standard CSS. The plugin rewrites those bodies before PostCSS parses the file. It also expands variant groups inside `@apply`, because a raw `{` breaks the CSS parse. User CSS outside directive bodies is not touched.
4. **Hot updates.** When a source file changes, the plugin sends the tracked CSS files through PostCSS again. New utility classes appear without a full page reload.
5. **Formatter patterns.** The plugin adds every activated CSS file to `fmt.ignorePatterns`, so the Vite+ formatter skips files whose directive syntax it cannot parse. See [vite-plus.md](vite-plus.md).

## Activation

A CSS file activates Rainbow Index when it contains one of these, outside comments and strings:

- A Rainbow Index directive, for example `@color { ... }`. An `@import` is not required.
- `@import "rainbowindex"` or `@import "rainbowindex/index.css"`.

A CSS file without activation passes through unchanged.

## Dev versus build

The PostCSS injection, the directive rewrites, and the formatter patterns run in both dev and build. Production builds compile the same CSS as the dev server.

The entry discovery, the `[RI-1602]` warning, and hot updates run only on the dev server.

## Hot update details

- A change in a tracked CSS file re-reads the file and checks the activation again.
- A change in a source file with extension `html`, `js`, `jsx`, `ts`, `tsx`, `md`, `mdx`, `vue`, or `svelte` recompiles the tracked CSS.
- Other extensions do not recompile the CSS. Class names in a `.astro` or `.php` file do not appear in dev until you edit the CSS itself.

## Misuse guard

The default `rainbowindex` export is the PostCSS plugin, not the Vite plugin. If you put it in Vite's `plugins` array, the build fails with error `[RI-1606]` and tells you the correct import. This guard prevents a silent no-op.

```ts
// Wrong — fails with [RI-1606]
import rainbowindex from "rainbowindex";
export default defineConfig({ plugins: [rainbowindex()] });

// Correct
import rainbowindex from "rainbowindex/vite";
export default defineConfig({ plugins: [rainbowindex()] });
```

## Gotchas

- The injection check covers only `postcss.config.{js,mjs,ts,cjs}` at the Vite root. It does not detect `.postcssrc*` files, `postcss.config.mts`, a `postcss` key in `package.json`, or an inline `css.postcss` value in the Vite configuration. With one of those, the plugin can run twice or not at all. Move your PostCSS configuration to one of the four detected files.
- The injected PostCSS plugin uses `process.cwd()` as its working directory, not the Vite root. If you start Vite from a different directory, the source scan starts from the wrong place.
- The formatter patterns come from a disk scan on every configuration load, including `vp dev`, `vp build`, and `vp fmt`. The scan reads each CSS file it finds.
- The entry discovery runs only at dev-server start. A production build without an active CSS entry produces no warning from this plugin.
- The disk scan for CSS entries skips `node_modules`, `.git`, `dist`, and dot-directories. It does not follow directory symlinks.

## Diagnostic codes on this page

| Code | Meaning |
| --- | --- |
| `RI-1601` | The disk scan for CSS files failed in a directory. Dev only. |
| `RI-1602` | No active CSS entry was found at dev-server start. |
| `RI-1606` | The PostCSS default export was placed in Vite's `plugins` array. |

The full table is in [diagnostics.md](diagnostics.md).
