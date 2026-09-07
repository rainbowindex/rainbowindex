# Framework guides

Every integration is one of two things: the **Vite plugin**, or the **PostCSS
plugin**. Pick the one your framework already uses and copy the files below.
Working versions of all five live in [`examples/`](https://github.com/rainbowindex/rainbowindex/tree/main/examples) — alongside a [design-system package and its consumer](preset-protocol.md) — and CI builds
each of them on every change.

| Framework | Integration | Example |
| --- | --- | --- |
| [Vite + React](#vite--react) | Vite plugin | [`examples/vite-react`](https://github.com/rainbowindex/rainbowindex/tree/main/examples/vite-react) |
| [React Router](#react-router) | Vite plugin | [`examples/react-router`](https://github.com/rainbowindex/rainbowindex/tree/main/examples/react-router) |
| [SvelteKit](#sveltekit) | Vite plugin | [`examples/sveltekit`](https://github.com/rainbowindex/rainbowindex/tree/main/examples/sveltekit) |
| [Astro](#astro) | Vite plugin | [`examples/astro`](https://github.com/rainbowindex/rainbowindex/tree/main/examples/astro) |
| [Next.js](#nextjs) | PostCSS plugin | [`examples/nextjs`](https://github.com/rainbowindex/rainbowindex/tree/main/examples/nextjs) |

Every example declares the same theme, so you can diff them against each other:

```css
/* styles.css */
@import "rainbowindex";
@import "rainbowindex/tailwind.css";

@color {
	brand: 0.18 330;
}
```

## Two things that catch people out

**Your source directory may not be `src/`.** The default scan globs are
`*.html` and `src/**/*.{html,js,jsx,ts,tsx,mdx,vue,svelte,astro}`. A framework
that puts code elsewhere — Next.js's `app/`, for one — needs to say so, or the
stylesheet compiles with none of your classes in it:

```css
@source "./**/*.{ts,tsx}";
```

Nothing warns about this, because "no classes found" is also what an empty
project looks like. If your build produces a stylesheet with the base layer and
none of your utilities, this is why.

**Class names have to exist in the source text.** The scanner reads files; it
does not run them. `` className={`bg-brand-${stop}`} `` is invisible to it.
Interpolate whole class names, or list the ones you build dynamically with
`@source inline("bg-brand-100 bg-brand-500")`.

## Vite + React

The Vite plugin wires PostCSS and finds your CSS entry on the first dev-server
listen. There is no `postcss.config.js` and no content configuration.

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import rainbowindex from "rainbowindex/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), rainbowindex()],
});
```

Import the stylesheet once from your entry:

```tsx
// src/main.tsx
import "./styles.css";
```

That is the whole integration. `ri()` works in the browser without further
setup — the plugin publishes the theme snapshot for you.

## React Router

React Router is a Vite app, so it is the Vite plugin again, unchanged:

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import rainbowindex from "rainbowindex/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), rainbowindex()],
});
```

`ri()` earns its place in a router, where an active state has to beat a base
class rather than sit beside it:

```tsx
const link = (active: boolean) =>
	ri("rounded-lg px-3 py-1.5 font-medium text-gray-600", active && "bg-brand-500 text-white");

<NavLink to="/" className={({ isActive }) => link(isActive)} end>
	Home
</NavLink>;
```

Without `ri()`, both `text-gray-600` and `text-white` ship and the stylesheet's
order decides which wins — not the argument order you wrote.

For framework mode (`@react-router/dev`), the config above is unchanged; the
plugin does not care which Vite app it is in.

## SvelteKit

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import rainbowindex from "rainbowindex/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [sveltekit(), rainbowindex()],
});
```

Import the stylesheet from your root layout:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
	import "../styles.css";
	let { children } = $props();
</script>

{@render children()}
```

Svelte's `class:` directives are scanned as well as plain `class` attributes,
so `class:active={isActive}` contributes `active` to the build.

## Astro

Astro builds on Vite, so the plugin goes in `vite.plugins`. There is no Astro
integration to install.

```js
// astro.config.mjs
import rainbowindex from "rainbowindex/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
	vite: { plugins: [rainbowindex()] },
});
```

`.astro` files are scanned in both halves — the markup **and** the JavaScript
frontmatter — so a class list built above the fence resolves:

```astro
---
import "../styles.css";
const card = "rounded-xl border border-gray-200 bg-white p-6 shadow-md";
---

<div class={card}>…</div>
```

## Next.js

Next.js has no Vite, so the integration is the PostCSS plugin.

```js
// postcss.config.mjs
import rainbowindex from "rainbowindex";

export default { plugins: [rainbowindex()] };
```

**Tell it where your code is.** Next puts source in `app/` or `src/app/`, and
only the second is covered by the defaults:

```css
/* app/styles.css */
@import "rainbowindex";
@import "rainbowindex/tailwind.css";

@source "./**/*.{ts,tsx}";

@color {
	brand: 0.18 330;
}
```

**Generate a snapshot so `ri()` knows your theme.** The Vite plugin does this
automatically; PostCSS cannot, so it is a build step:

```json
{
	"scripts": {
		"prebuild": "rainbowindex generate-snapshot --css app/styles.css -o app/rainbowindex-snapshot.ts",
		"build": "next build"
	}
}
```

**Import the bound `ri` from that snapshot, not from `rainbowindex`.** This is
the one place Next.js differs from every other framework here. The generated
module publishes the theme into module state, and importing it once from your
root layout is enough in a single module graph — but Next bundles the client
boundary separately, so a `"use client"` component can end up reading module
state that the server-side publish never wrote. The snapshot's own `ri` export
carries the theme with it and cannot be separated from it:

```tsx
"use client";

import { ri } from "./rainbowindex-snapshot";

export function Toggle({ on }: { on: boolean }) {
	return <button className={ri("bg-brand-500 text-white", on && "bg-brand-700")} />;
}
```

Get this wrong and the build prints `[RI-2004] ri() merged … with no theme
published` — a warning worth reading rather than silencing, because without the
theme `ri()` cannot tell a text size from a color and drops classes it should
have kept.
