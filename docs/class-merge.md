# Class Merge: `ri()` and `createRi()`

`ri()` merges class strings with rightmost-wins conflict resolution. It replaces `clsx` for conditional composition and `tailwind-merge` for conflict resolution.

```ts
import { ri } from "rainbowindex";

ri("px-2 py-1", isActive && "bg-brand-500", "px-4");
// → "py-1 bg-brand-500 px-4"   (px-2 is dropped — px-4 wins)
```

Merge classes with `ri()`, never with `cn()` or plain string concatenation.

For a component's variants — "a button has a size and a tone" — build them with
[`recipe()`](recipe.md), which is this same merge with a typed surface over it.

## Inputs

```ts
type ClassInput = string | false | null | undefined | ClassInput[];
ri(...inputs: ClassInput[]): string;
```

- Strings, nested arrays, and falsy values are accepted. Falsy values contribute nothing.
- Objects and numbers are skipped, never stringified. The `clsx` object form `{ active: cond }` is not supported. Write `cond && "active"`.
- Spaces inside brackets do not split: `bg-[url('foo bar')]` stays one token.

## Conflict rules

- The engine scans right to left. A class is dropped only when every CSS property it sets is already claimed by a class to its right.
- A shorthand claims all its longhands: `ri("px-2 py-1", "p-4")` returns `"p-4"`.
- A longhand to the right never drops a shorthand to its left: `ri("p-4", "px-2")` returns `"p-4 px-2"`. The cascade settles it.
- Variants partition the namespace. `sm:hover:p-4` and `hover:sm:p-2` conflict, because variant order is canonicalized.
- The `!` suffix partitions the namespace too. An important class and a normal class never drop each other.
- Negative and positive forms conflict: `-mt-4` against `mt-2`.
- An arbitrary property claims its named property: `[border:1px_solid_red]` drops `border-t-2`.
- An unknown class always passes through. It is never dropped.
- A custom utility with several properties survives a partial override: `ri("card p-8")` keeps `card` when `card` also sets a background.
- Prefixes with two meanings resolve by value shape. `text-lg` is a size and `text-brand-500` is a color, so they do not conflict. No text scale ships, so `ri()` learns the size names when the theme compiles. Before the first compile, or with a name that no `@text` defines, `text-{name}` reads as a color.

## `ri()` versus `createRi()`

| Situation | Use | What you have to do |
| --- | --- | --- |
| Vite, anywhere — client, SSR, build | `ri()` | Nothing. The plugin publishes the theme. |
| Another bundler — Next.js, Webpack, Rspack, esbuild | `ri()` | `rainbowindex generate-snapshot`, then import the file once. |
| One Node compile that exits | `ri()` | Nothing. The compile publishes the theme. |
| Many themes in one process — multi-tenant, per-request themes | `createRi(snapshot)` | Build one merger per theme. |

`ri()` answers by asking the *published theme* what properties a class sets.
Since 0.6.0 every text size, weight, font slot, and color name is
project-defined, so this is not optional detail: with no theme published,
`ri("text-lg text-white")` reads `text-lg` as a color, decides the two conflict,
and returns just `text-white`.

A compile publishes a theme. A browser bundle never runs a compile, which is why
the client needs one of the two rows above.

### Vite: nothing to do

The plugin serves a virtual module holding your theme and prepends it to every
module that imports `rainbowindex`. ES imports evaluate in order, so the theme is
published before your code runs — in dev, in a build, and in SSR. Editing your
CSS entry republishes it over HMR.

### Other bundlers: generate the module

```sh
rainbowindex generate-snapshot
```

That writes `rainbowindex-snapshot.ts`. Import it once, as early as possible:

```ts
// app entry — before anything that calls ri()
import "./rainbowindex-snapshot";
```

Re-run it when the theme changes. Unchanged input rewrites the file
byte-identically, so it is safe to commit and safe to run in a build step.

### Many themes in one process

`createRi(snapshot)` binds a merger to one frozen snapshot with its own cache,
sharing no module state, so two requests rendering two themes cannot leak into
each other. The generated module exports one for you:

```ts
import { ri } from "./rainbowindex-snapshot";  // bound, not the shared default
```

CAUTION: `createRi()` without an argument binds at creation time to the latest
snapshot. Create it after your compile, not before.

## Getting a snapshot

Three flows work. Pick one:

```ts
// A. Isolated compiler (recommended for SSR)
import { createCompiler } from "rainbowindex";

const compiler = createCompiler();
const result = compiler.compile(classNames, theme);
const ri = compiler.createRi();          // bound to this compile only
```

```ts
// B. Manual context
import {
	createCompilationContext, registerColorNames,
	finalizeCompilationContext, createRi,
} from "rainbowindex";

const ctx = createCompilationContext();
registerColorNames(ctx, ["accent"]);
const snapshot = finalizeCompilationContext(ctx);   // also updates the default ri()
const boundRi = createRi(snapshot);
```

```ts
// C. From a compiled project's theme
import { compileProject } from "rainbowindex";
import { createThemeSnapshot } from "rainbowindex/editor";
import { createRi } from "rainbowindex";

const result = await compileProject({ css });
const boundRi = createRi(createThemeSnapshot(result.theme));
```

Note: `compileProject()` does not update the default `ri()`. After it, the default `ri()` still does not know that project's custom utilities and colors. Use one of the three flows above, or `publishSnapshot(createThemeSnapshot(result.theme))` to install it as the default.

## The `[RI-2004]` warning

The default `ri()` warns once per process when it merges a class whose meaning
depends on a theme, and no theme has been published. The message names the class
it had to guess about.

It fires wherever it happens, browser included — a wrong merge is a wrong answer
everywhere. It does not fire for classes no theme can change (`flex`, `p-4`), nor
for a single class, which merges to itself.

To fix it: install the Vite plugin, or run `rainbowindex generate-snapshot` and
import the generated module once, or pass a snapshot to `createRi(snapshot)`.

Publishing any theme silences it, including an empty one. A single-theme app that
publishes at startup is correct, and is not warned at.

## Browser entry

Browser bundles resolve `rainbowindex` to a client-safe entry. It exports `ri`, `createRi`, `safelist`, the context functions, and `defaultTheme`. It does not export `compileProject`, `createCompiler`, or the PostCSS plugin. The default export throws `[RI-2003]` when called, so a wrong import fails loudly.

Use named imports in client code: `import { ri } from "rainbowindex"`.

The browser entry also exports `serializeSnapshot`, `hydrateSnapshot`, and
`publishSnapshot`. A snapshot holds Sets, which `JSON.stringify` turns into `{}`
without complaint, so `serializeSnapshot` is the only safe way to send one
across a server/client boundary:

```ts
// server
const wire = serializeSnapshot(createThemeSnapshot(theme));
// client, before anything calls ri()
publishSnapshot(hydrateSnapshot(wire));
```

`hydrateSnapshot` never throws on a malformed payload — a stale generated module
degrades to "this part of the theme is unknown" rather than breaking the bundle
at import time.

## Limits

| Limit | Value | Behavior |
| --- | --- | --- |
| Cache | 500 entries | The oldest quarter is evicted in a batch. |
| Cache key | 2,048 characters | Longer keys skip the cache. The merge stays correct. |
| Array depth | 10 | Deeper input is dropped with warning `[RI-2011]`. |
| Class length | 500 characters | Longer tokens are dropped with warning `[RI-2006]`. |
| Classes per call | 10,000 | Excess is dropped with warning `[RI-2012]`. |

Warnings throttle to one per 60 seconds per type.

## Diagnostic codes on this page

| Code | Meaning |
| --- | --- |
| `RI-2003` | The default export was called in a browser bundle. |
| `RI-2004` | The default `ri()` merged a theme-dependent class with no theme published. |
| `RI-2006` | A class token above 500 characters was dropped. |
| `RI-2011` | Array nesting above depth 10. |
| `RI-2012` | More than 10,000 class tokens in one call. |

The full table is in [diagnostics.md](diagnostics.md).
