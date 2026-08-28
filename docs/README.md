# Rainbow Index Documentation

Rainbow Index is a CSS-first system for consistent user interfaces. These pages document the package for its consumers.

## Start here

| Page | What it covers |
| --- | --- |
| [getting-started.md](getting-started.md) | Install, quick start with Vite, scaffold, first theme. |

## Write classes

| Page | What it covers |
| --- | --- |
| [class-syntax.md](class-syntax.md) | The class grammar: variants, arbitrary values, alpha modifiers, `!`, variant groups. |
| [utilities.md](utilities.md) | Every utility family, by category, with the differences from Tailwind. |

## Configure

| Page | What it covers |
| --- | --- |
| [theming.md](theming.md) | All CSS directives, dark mode, and the default theme. |
| [fonts.md](fonts.md) | The `@font` directive, Google Fonts, metrics fallbacks, preload. |
| [source-scanning.md](source-scanning.md) | How class names are found: `@source`, defaults, safelists. |
| [environment-variables.md](environment-variables.md) | `RI_DEBUG`, `RI_OFFLINE`, and the font cache controls. |

## Integrate

| Page | What it covers |
| --- | --- |
| [vite-plugin.md](vite-plugin.md) | The recommended dev integration. |
| [vite-plus.md](vite-plus.md) | `vp check`, the formatter, and the Oxlint plugin. |
| [postcss-plugin.md](postcss-plugin.md) | The core plugin, its options, and `@apply` expansion. |
| [cli.md](cli.md) | The six commands: `build`, `init`, `create`, `generate-types`, `preload-fonts`, `scan`. |

## Program against it

| Page | What it covers |
| --- | --- |
| [class-merge.md](class-merge.md) | `ri()` and `createRi()`: conflict resolution and SSR safety. |
| [node-api.md](node-api.md) | `compileProject`, `createCompiler`, contexts, and `safelist`. |
| [editor-api.md](editor-api.md) | `rainbowindex/editor`: validation, completions, swatches, spans. |

## Reference

| Page | What it covers |
| --- | --- |
| [diagnostics.md](diagnostics.md) | Every `RI-NNNN` code with cause and fix. |
