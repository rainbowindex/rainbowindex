# Rainbow Index Documentation

Rainbow Index is a CSS-first system for consistent user interfaces. These pages document the package for its consumers.

## Start here

| Page | What it covers |
| --- | --- |
| [getting-started.md](getting-started.md) | Install, quick start with Vite, scaffold, first theme. |
| [why.md](why.md) | How it compares to Tailwind, UnoCSS, Panda and StyleX — including what it loses. |
| [migrating.md](migrating.md) | Coming from Tailwind v4: `rainbowindex migrate tailwind`. |

## Write classes

| Page | What it covers |
| --- | --- |
| [class-syntax.md](class-syntax.md) | The class grammar: variants, arbitrary values, alpha modifiers, `!`, variant groups. |
| [utilities.md](utilities.md) | Every utility family, by category, and the differences from Tailwind. |

## Configure

| Page | What it covers |
| --- | --- |
| [theming.md](theming.md) | All CSS directives, dark mode, and the default theme. |
| [fonts.md](fonts.md) | The `@font` directive, Google Fonts, metrics fallbacks, preload. |
| [source-scanning.md](source-scanning.md) | How class names are found: `@source`, defaults, safelists. |
| [preset-protocol.md](preset-protocol.md) | How a package ships design tokens a project can `@import`. |
| [environment-variables.md](environment-variables.md) | `RI_DEBUG`, `RI_OFFLINE`, and the font cache controls. |

## Integrate

| Page | What it covers |
| --- | --- |
| [frameworks.md](frameworks.md) | Copy-paste setup for Vite, React Router, SvelteKit, Astro and Next.js. |
| [vite-plugin.md](vite-plugin.md) | The recommended dev integration. |
| [vite-plus.md](vite-plus.md) | `vp check`, and why a directive file is hidden from the formatter. |
| [lint.md](lint.md) | The three lint rules, for Oxlint and ESLint. |
| [editor.md](editor.md) | The VS Code extension, and building your own integration. |
| [postcss-plugin.md](postcss-plugin.md) | The core plugin, its options, and `@apply` expansion. |
| [cli.md](cli.md) | The nine commands: `build`, `init`, `create`, `migrate`, `generate-types`, `generate-snapshot`, `generate-tokens`, `preload-fonts`, `scan`. |

## Program against it

| Page | What it covers |
| --- | --- |
| [class-merge.md](class-merge.md) | `ri()` and `createRi()`: conflict resolution and SSR safety. |
| [recipe.md](recipe.md) | `recipe()`: typed component variants whose output is class names. |
| [node-api.md](node-api.md) | `compileProject`, `createCompiler`, contexts, and `safelist`. |
| [editor-api.md](editor-api.md) | `rainbowindex/editor`: validation, completions, swatches, spans. |

## Reference

| Page | What it covers |
| --- | --- |
| [diagnostics.md](diagnostics.md) | Every `RI-NNNN` code with cause and fix. |
| [stability.md](stability.md) | What is a contract before 1.0, the deprecation policy, supported runtimes. |
