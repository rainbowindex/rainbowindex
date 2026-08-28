# Getting Started

Rainbow Index is a CSS-first system for consistent user interfaces. You configure it in CSS, not in a JavaScript file. It compiles utility classes from your source files, with a theme you declare through directives.

## Requirements

- Node 20.19 or later.
- The package is ESM-only. There is no CommonJS build.
- `postcss` is a required peer dependency. `vite` is an optional one.

## Install

```bash
pnpm add rainbowindex
```

### From GitHub Packages

Each release is also on GitHub Packages as `@rainbowindex/rainbowindex`. Point the scope at the registry in your project's `.npmrc`:

```ini
@rainbowindex:registry=https://npm.pkg.github.com
```

That registry authenticates every read. Put a classic personal access token with the `read:packages` scope in your `~/.npmrc`:

```ini
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
```

Install under the alias, so every import in these docs works unchanged:

```bash
pnpm add rainbowindex@npm:@rainbowindex/rainbowindex
```

## Quick start with Vite

The Vite plugin is the fastest path. It injects the PostCSS configuration and finds your CSS entry.

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

@color {
	brand: 0.18 330;
}
```

```tsx
// src/App.tsx
export default function App() {
	return <div className="flex gap-4 px-6 py-3 bg-brand-500 text-white">Hello</div>;
}
```

Import `src/index.css` from your app entry, then start the dev server.

Note: the default palette has one neutral color, `theme`. Names such as `blue-500` do not exist until you declare them with `@color`. The names `black`, `white`, `paper`, `ink`, `transparent`, `current`, and `inherit` always work. See [theming.md](theming.md).

## Scaffold a new app

```bash
pnpm dlx rainbowindex create my-app --template react-ts
```

## Wire an existing Vite app

```bash
pnpm dlx rainbowindex init
```

The command installs the package, patches your Vite configuration, and adds the CSS import. See [cli.md](cli.md).

## Without Vite

Use the PostCSS plugin directly, or the CLI:

```bash
rainbowindex "src/**/*.{ts,tsx}" -o dist/styles.css --watch
```

The CLI cannot expand `@apply`. Use the PostCSS plugin for that. See [postcss-plugin.md](postcss-plugin.md) and [cli.md](cli.md).

## Editor autocomplete

```bash
rainbowindex generate-types
```

The command writes `rainbowindex-env.d.ts` with the class types for your theme. Add the file to your `tsconfig.json` includes.

## Merge classes at runtime

```ts
import { ri } from "rainbowindex";

ri("px-2 py-1", isActive && "bg-brand-500", "px-4");
// → "py-1 bg-brand-500 px-4"
```

See [class-merge.md](class-merge.md).

## Where to go next

- [class-syntax.md](class-syntax.md) — variants, arbitrary values, and modifiers.
- [utilities.md](utilities.md) — every utility family.
- [theming.md](theming.md) — all directives and the default theme.
- [fonts.md](fonts.md) — the font system.
