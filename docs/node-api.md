# Node API

The main entry exports a programmatic API next to the PostCSS plugin. Use it for headless compiles, server rendering, and custom tooling.

## Exports

| Export | Purpose |
| --- | --- |
| `default` | The PostCSS plugin. See [postcss-plugin.md](postcss-plugin.md). |
| `ri`, `createRi` | The class merger. See [class-merge.md](class-merge.md). |
| `compileProject` | An in-memory compile. Sources are strings, not files. |
| `createCompiler` | An isolated compiler instance for concurrent use. |
| `createCompilationContext` | A fresh mutable merge context. |
| `finalizeCompilationContext` | Freeze a context and publish it to `ri()`. |
| `registerCustomUtility` | Add a custom class to conflict resolution. |
| `registerCustomTextSizes` | Classify `text-{name}` as a size, not a color. |
| `registerCustomFontFamilies` | Classify `font-{name}` as a family, not a weight. |
| `registerColorNames` | Classify a bare color name as a color. |
| `defaultTheme` | The frozen built-in theme. |
| `safelist` | Mark classes that must always compile. |

Exported types: `RainbowIndexOptions`, `Theme`, `ColorDefinition`, `FluidConfig`, `TextSize`, `CompilationContext`, `CompilationSnapshot`, `CompileProjectOptions`, `CompileProjectResult`, `CompilationResult`, `CompiledRule`.

## `compileProject`

An in-memory compile. The source content comes from strings, not from a file scan.

```ts
import { compileProject } from "rainbowindex";

const result = await compileProject({
	css: '@color { brand: 0.18 330; }',
	sources: [{ content: '<div class="text-white p-4"></div>' }],
});

result.css;        // the full stylesheet
result.classNames; // includes "text-white" and "p-4", plus stray tokens such as
                   // "class" — the scanner over-collects, and strays compile to nothing
result.warnings;   // deduplicated RI-NNNN warnings
```

Options:

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `css` | `string` | required | The CSS input with directives. |
| `sources` | `Iterable<{ path?: string; content: string }>` | none | In-memory source files. Classes come from `content`. |
| `classNames` | `Iterable<string>` | none | Class names to compile directly. |
| `resolveFonts` | function | Google resolver | Replace it to avoid network requests. |
| `processCssFunctions` | `boolean` | `true` | Resolve Rainbow Index CSS functions in the user CSS. |

The result: `{ css, sections, userCSS, classNames, theme, directives, warnings }`. The `css` field is a lazy getter. Read fields directly instead of spreading the object.

Notes:

- There is no `cwd` option and no file scan.
- The result is not a compilation context. Do not pass it to `finalizeCompilationContext`. For a merge snapshot, use `createThemeSnapshot(result.theme)` from `rainbowindex/editor`.
- One exception to "no files": with a Google font slot, the default font resolver fetches metadata over the network and reads and writes the cache at `node_modules/.cache/rainbowindex/google.json`. `RI_OFFLINE=1` still reads that cache. Pass your own `resolveFonts` for zero filesystem and network access.

## `createCompiler`

An isolated compiler for concurrent server rendering. It touches no shared state.

```ts
import { createCompiler } from "rainbowindex";

const compiler = createCompiler();
const result = compiler.compile(classNames, theme);  // CompilationResult
const ri = compiler.createRi();                      // bound to this compile
```

`compile()` accepts any iterable of class names. A bare string counts as a whitespace-separated list. A non-iterable argument throws `TypeError [RI-2008]`. A non-object theme throws `TypeError [RI-2007]`.

The `CompilationResult` holds `rules` (each with `selector`, `sortKey`, `css`), `keyframes`, `properties`, the used-token sets, and `warnings`.

## The compilation context

The context flow teaches the merger about your custom classes:

```ts
import {
	createCompilationContext,
	registerCustomUtility,
	registerColorNames,
	finalizeCompilationContext,
} from "rainbowindex";

const ctx = createCompilationContext();
registerCustomUtility(ctx, "card", ["background-color", "border-radius", "box-shadow"]);
registerColorNames(ctx, ["accent"]);
const snapshot = finalizeCompilationContext(ctx);
```

`finalizeCompilationContext` deep-copies the context, publishes it as the state that the default `ri()` reads, clears the `ri()` cache, and returns the frozen snapshot.

`registerCustomUtility` with an empty name is skipped with dev warning `[RI-1301]`. An empty property list warns with `[RI-1302]`, and the utility never joins conflict resolution.

## `safelist`

```ts
import { safelist } from "rainbowindex";

const classes = safelist("bg-brand-500", condition && "hidden");
```

At runtime, `safelist` joins its string arguments and filters falsy values. At build time, the scanner extracts its literal string arguments as classes that always compile, even when no markup uses them. Static strings are extracted, and a template literal contributes its static text. The `${...}` parts are skipped. See [source-scanning.md](source-scanning.md).

## Browser entry

Browser bundles get a client-safe entry: `ri`, `createRi`, `safelist`, the context functions, `defaultTheme`, and the types. `compileProject`, `createCompiler`, and the PostCSS plugin are absent. The default export throws `[RI-2003]`.

## Diagnostic codes on this page

| Code | Meaning |
| --- | --- |
| `RI-1301` | `registerCustomUtility` got an empty name. |
| `RI-1302` | `registerCustomUtility` got no properties. |
| `RI-2003` | The default export was called in a browser bundle. |
| `RI-2007` | `compile()` got a non-object theme. |
| `RI-2008` | `compile()` got a non-iterable class list. |

The full table is in [diagnostics.md](diagnostics.md).
