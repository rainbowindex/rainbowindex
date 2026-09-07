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

Without the alias, the package resolves under its scoped name and every
specifier grows the scope: `@rainbowindex/rainbowindex`,
`@rainbowindex/rainbowindex/vite`, and so on.

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

### Two ways to start

**Tailwind-familiar.** One extra import brings Tailwind v4's default theme — 26 color families, the `sm` through `2xl` breakpoints, `text-xs` through `text-9xl`, and the weight, leading, tracking, radius, shadow, blur, easing, and animation names.

```css
/* src/index.css */
@import "rainbowindex";
@import "rainbowindex/tailwind.css";
```

```tsx
// src/App.tsx
export default function App() {
	return <div className="sm:flex gap-4 px-6 py-3 text-lg font-bold rounded-lg shadow-md bg-blue-600 text-white">Hello</div>;
}
```

Import the preset after the package. Later blocks win, so anything you declare below it overrides it. Importing the preset alone also activates the compiler, but you lose the preflight that `rainbowindex` carries — import both.

**From scratch.** Declare the tokens your design system has, and nothing else.

```css
/* src/index.css */
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

Either way, import `src/index.css` from your app entry, then start the dev server.

### What does not ship by default

Rainbow Index ships two scales: the neutral `theme` color and the `0.25rem` spacing base. Text sizes, breakpoints, weights, leading, tracking, radii, shadows, blur, easing, animations, and fluid ranges are empty until a directive names them, so `text-lg`, `sm:flex`, `font-bold`, `shadow-md`, and `rounded-lg` compile to nothing in a fresh project. Color names work the same way: `blue-500` does not exist until you declare it, while `black`, `white`, `paper`, `ink`, `transparent`, `current`, and `inherit` always do. See [theming.md](theming.md).

The forms that compute rather than look up work everywhere: `p-4`, `rounded-4`, `font-600`, `z-10`, `text-[18px]`, `blur-none`.

The preset is a plain directive file, not a compiled blob — read it, copy the blocks you want, or import it whole. Importing it costs only what you use: colors, text sizes, shadows, blur, easing, and the rest are all pruned to what the build actually references, and a token kept alive only because another token's value names it comes along too.

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
- [utilities.md](utilities.md#differences-from-tailwind) — what the preset cannot paper over.
- [fonts.md](fonts.md) — the font system.
