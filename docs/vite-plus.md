# Vite+

[Vite+](https://viteplus.dev) is one CLI (`vp`) over Vite, Vitest, Oxlint, Oxfmt, Rolldown, and tsdown. Rainbow Index works with it, with one adjustment that the Vite plugin makes for you.

## The problem: the formatter cannot parse directives

`vp fmt` and `vp check` format CSS with [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html), which parses CSS strictly. Four Rainbow Index forms are not valid CSS, so the parse stops on the first one it meets:

| Form | Example | Where it appears |
| --- | --- | --- |
| A block after a declaration | `sans: "Sans" { … }` | `@font`, `@animate` |
| A removal | `!brand;` | `@color` and every key-value scale |
| A bare keyword | `parabolic;`, `inline;` | `@fluid`, `@color` option blocks |
| A variant group | `@a hover:{px-2 py-1};` | `@apply` and its aliases |

The failure is not a warning. `vp check` reports `Syntax error: component value is expected` and exits before it can lint or type check.

This is the same syntax the plugin rewrites before PostCSS reads a file — see [vite-plugin.md](vite-plugin.md). PostCSS cannot parse these forms either.

## The fix: the plugin hides those files from the formatter

The Vite plugin scans the project at config time, finds every CSS file that [activates Rainbow Index](vite-plugin.md#activation), and adds those paths to `fmt.ignorePatterns`. Vite+ reads its `fmt` block from the resolved Vite configuration, so a plugin can contribute to it. Nothing else changes: every other file still gets formatted, and your own `fmt` settings are kept — Vite merges the two lists.

```ts
// vite.config.ts — nothing to add
import { defineConfig } from "vite-plus";
import rainbowindex from "rainbowindex/vite";

export default defineConfig({
	plugins: [rainbowindex()],
});
```

The scan reuses the plugin's CSS discovery, so it skips `node_modules`, `.git`, `dist`, and dot-directories. It reads only CSS files. On a project with a handful of stylesheets it costs one to two milliseconds per configuration load.

Plain Vite ignores the extra `fmt` key, so the same configuration works with and without Vite+.

## Without the Vite plugin

The PostCSS plugin and the CLI do not read `vite.config.ts`, so add the pattern yourself:

```ts
// vite.config.ts
export default defineConfig({
	fmt: { ignorePatterns: ["src/**/*.css"] },
});
```

`vp fmt` also reads `.gitignore` and `.prettierignore`. A project without a Vite configuration can list the stylesheet in `.prettierignore` instead. Vite+ prefers `ignorePatterns`, and prints a migration hint when it finds a `.prettierignore`.

## Lint rules

The package ships an Oxlint plugin with one rule. `prefer-ri` reports an import of `clsx`, `classnames`, or `tailwind-merge`. Each one merges classes against a Tailwind utility table, so it resolves conflicts against the wrong utility set and never sees your theme. `ri()` does both jobs against the compiled theme.

```ts
// vite.config.ts
export default defineConfig({
	lint: {
		jsPlugins: [{ name: "rainbowindex", specifier: "rainbowindex/oxlint" }],
		rules: { "rainbowindex/prefer-ri": "error" },
	},
});
```

The rule is off until you enable it. The plugin has no dependencies and works with ESLint-compatible hosts that accept the same plugin shape.

## Limits

- **Monorepos.** Oxfmt matches `ignorePatterns` against the directory that holds the configuration file. When the Vite root is below that directory, the injected paths do not match. Add the patterns to the root `vite.config.ts` yourself, or use [`fmt.overrides`](https://viteplus.dev/guide/monorepo).
- **Formatting is off, not fixed.** A stylesheet with directives is never formatted. No CSS formatter parses these forms today: Prettier accepts the `@font` and `@animate` blocks but rejects the other two forms.
- **Leave `fmt.sortTailwindcss` off.** It sorts class attributes with the Tailwind algorithm and a Tailwind configuration file. Rainbow Index has its own utility order and its own class grammar, so the result is wrong, and a variant group inside a class string does not survive.
- **The scan runs on every configuration load.** That includes `vp dev`, `vp build`, `vp fmt`, `vp lint`, and the editor. A repository with thousands of CSS files pays for the walk each time.
