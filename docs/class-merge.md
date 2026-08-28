# Class Merge: `ri()` and `createRi()`

`ri()` merges class strings with rightmost-wins conflict resolution. It replaces `clsx` for conditional composition and `tailwind-merge` for conflict resolution.

```ts
import { ri } from "rainbowindex";

ri("px-2 py-1", isActive && "bg-brand-500", "px-4");
// → "py-1 bg-brand-500 px-4"   (px-2 is dropped — px-4 wins)
```

Merge classes with `ri()`, never with `cn()` or plain string concatenation.

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
- Prefixes with two meanings resolve by value shape. `text-lg` is a size and `text-brand-500` is a color, so they do not conflict.

## `ri()` versus `createRi()`

| Situation | Use |
| --- | --- |
| Browser bundle, client components | `ri()` |
| Vite build, PostCSS one-shot | `ri()` |
| One Node compile that exits | `ri()` |
| Concurrent SSR — one server, many requests | `createRi(snapshot)` |
| Multi-tenant compiles — many themes in one process | `createRi(snapshot)` |
| Edge functions with shared module state | `createRi(snapshot)` |

`ri()` reads module-level state from the most recent compile. When two requests merge classes against two different themes in one process, that shared state leaks. `createRi(snapshot)` binds a merger to one frozen snapshot with its own cache.

CAUTION: `createRi()` without an argument binds at creation time to the latest snapshot. Create it after your compile, not before.

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

Note: `compileProject()` does not update the default `ri()`. After it, the default `ri()` still does not know that project's custom utilities and colors. Use one of the three flows above.

## The `[RI-2004]` warning

The default `ri()` warns with `[RI-2004]` on any call in a Node process, at most once per 60 seconds. The warning is not tied to a compile in progress. It reminds you that the default export uses shared module state. Switch to `createRi(snapshot)` or `compiler.createRi()` to make it stop.

## Browser entry

Browser bundles resolve `rainbowindex` to a client-safe entry. It exports `ri`, `createRi`, `safelist`, the context functions, and `defaultTheme`. It does not export `compileProject`, `createCompiler`, or the PostCSS plugin. The default export throws `[RI-2003]` when called, so a wrong import fails loudly.

Use named imports in client code: `import { ri } from "rainbowindex"`.

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
| `RI-2004` | The default `ri()` ran in a Node process. Shared-state reminder. |
| `RI-2006` | A class token above 500 characters was dropped. |
| `RI-2011` | Array nesting above depth 10. |
| `RI-2012` | More than 10,000 class tokens in one call. |

The full table is in [diagnostics.md](diagnostics.md).
