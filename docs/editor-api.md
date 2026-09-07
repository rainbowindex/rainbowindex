# Editor API

`rainbowindex/editor` is a toolkit for editor integrations: validation, hover docs, completions, merge analysis, swatches, and source spans. It is pure computation. Strings go in, structures come out. The module graph has no `node:` imports, so it runs in browser hosts such as vscode.dev.

The host reads the files. The entry supplies the semantics.

The [VS Code extension](editor.md) is the reference consumer: everything it answers comes from this entry, and nothing it answers is decided by it.

## Version handshake

```ts
import { version, EDITOR_API_VERSION, editorCapabilities } from "rainbowindex/editor";
```

Feature-detect with `editorCapabilities`, not with the version. Integrations load whatever version the workspace installed. The capability list: `class-candidates`, `candidate-call-ids`, `candidate-origin-provenance`, `css-entry-detection`, `theme-analysis`, `class-inspection`, `variant-list`, `class-enumeration`, `merge-analysis`, `structured-diagnostics`, `color-swatches`, `editor-session`, `diagnostic-suppression`, `named-radii-and-fluid-ranges`, `font-weight-coverage`, `import-inlining`, `serializable-snapshot`, `stylesheet-rendering`, `class-sorting`, `candidate-spans-deduped`.

## The session

One session wraps one workspace theme:

```ts
import { createEditorSession } from "rainbowindex/editor";

const session = createEditorSession({ css: themeCss });

session.diagnostics;                     // positioned problems in the CSS input
session.inspector.validate("felx");      // { ok: false, reason: "unknown-utility", offender: "felx", suggestion: "flex" }
session.inspector.explain("sm:px-4");    // parsed structure + generated CSS + sort key
session.enumerate();                     // probe-verified completions + templates
session.analyzeMerge(["px-2", "px-4"]);  // which classes ri() drops, and who overrode them
session.swatch("brand", 500);            // light and dark oklch + hex
session.extractCandidates(source, path); // class tokens with exact source spans
session.tokens();                        // the theme's token inventory
session.snapshot();                      // a CompilationSnapshot for createRi()
session.render(["flex", "px-4"]);        // the stylesheet a build would emit
session.sortClasses(["pt-8", "p-4"]);    // ["p-4", "pt-8"] — the order the CSS uses
session.setCss(nextCss);                 // theme changed → all caches invalidate together
```

All theme-derived values cache together and invalidate together on `setCss()`. `setCss()` with identical text is a no-op.

### Reading imported files

The entry does no IO, so a session ignores `@import` unless you hand it a
resolver. Give it one and directives in imported files reach the theme:

```ts
const session = createEditorSession({
	css: themeCss,
	cssPath: "/app/src/index.css",
	resolveImport: (specifier, from) => {
		const path = resolveInYourHost(specifier, from);
		const doc = openDocuments.get(path);
		return doc ? { path, content: doc.text } : null;
	},
});

session.importedFiles; // ["/app/src/tokens.css"] — watch these too
```

The resolver is synchronous: the host already holds its open documents, and a
promise here would make every theme read async. Return `null` for anything you
cannot find — the session turns that into an `RI-1041` diagnostic rather than
throwing. Serve unsaved buffers from it and the theme tracks what the user is
typing, in a file they have not written yet.

`importedFiles` is what a session-invalidation watcher needs: editing an
imported token file must trigger `setCss()` on the entry, and without this list
a host has no way to know which files those are. Feature-detect with the
`import-inlining` capability.

## Rendering a stylesheet

`renderStylesheet` is the only export that produces CSS rather than answering a
question about it. It is the production compile and assembly — the same
`createCompiler()` and `assembleSections()` the PostCSS plugin and the CLI run:

```ts
import { analyzeProjectCSS, renderStylesheet, stripRIDirectives } from "rainbowindex/editor";

const { theme } = analyzeProjectCSS(themeCss);
const { css, sections, warnings } = renderStylesheet(theme, ["flex", "bg-brand-500"], {
	userCSS: stripRIDirectives(themeCss),
});
```

`sections` is the generated output in canonical order; `css` is that plus
`userCSS`, joined the way a build emits it. `userCSS` is optional and does two
things: `var(--color-brand-500)` written by hand counts as demand, so the token
survives pruning, and `--spacing(4)`-style CSS functions are compiled.
`authoredClassNames` narrows the warnings that only make sense for a class a
person typed (`RI-1002`), exactly as the build does for scanned files.

`session.render(classNames)` is the same call bound to the session's theme,
defaulting `userCSS` to the session's own entry with the directives stripped
and the `@import`s already inlined. Pass `userCSS: ""` for the generated output
alone.

Two steps of a real build are missing, both deliberately:

| Missing | Why | What you see |
| --- | --- | --- |
| Font resolution | Narrowing a Google family's weights is a network call, and this entry does no IO | The slot still emits its `@import` and its `--font-*` variable; only weights the provider would have trimmed remain |
| `@apply` expansion | The rewrite edits the user's own rules and belongs to PostCSS; pulling it in would double the entry's weight | An `@apply` in `userCSS` passes through verbatim |

Everything else — token pruning, `@property` registration, preflight,
`[data-theme]` overrides, rule ordering — is the production path, and a test
asserts byte-for-byte equality with `compileProject` for input that touches
neither exception.

Nothing here reaches `node:`: a test bundles the whole entry with
`platform: "browser"` and fails on the first builtin that turns up in the
graph, so a playground or a `vscode.dev` host can render without a server.
Feature-detect with the `stylesheet-rendering` capability.

## One candidate per class

`extractCandidates` (and the standalone `extractClassCandidates`) is a lexer,
not a parser. In JavaScript a colon is also a ternary and an object key, so it
emits both the joined token and the fragments around each colon:

```ts
extractClassCandidates({ content: `<div className="sm:hover:flex" />`, path: "a.tsx" });
// sm, sm:hover:flex, hover   ← three candidates, one class
extractClassCandidates({ content: `<div class="sm:hover:flex">`, path: "a.html" });
// sm:hover:flex              ← markup has no such ambiguity
```

That over-collection is free for a build — an invented class compiles to no
rule — and wrong for anything that maps a candidate back to a **place in the
source**. An editor that validated all three would underline `sm` inside
`sm:flex` as an unknown class.

`outermostCandidates` is the filter:

```ts
import { extractClassCandidates, outermostCandidates } from "rainbowindex/editor";

const candidates = outermostCandidates(extractClassCandidates({ content, path }));
```

It drops every candidate whose span lies inside another's — including inside a
variant group's `groupPrefix` span, which is what covers the stray `hover` in
`hover:{px-2 py-1}` — keeps the first of two candidates over an identical
span, and returns source order. Origins are untouched, so filter to
`attribute` / `helper` / `safelist` as well when prose and bare identifiers are
not wanted. Run it for underlines, quick fixes and hovers; skip it when you are
feeding a compiler, which wants everything.

Feature-detect with the `candidate-spans-deduped` capability.

## Sorting a class list

```ts
import { sortClasses } from "rainbowindex/editor";

sortClasses(theme, ["pt-8", "my-component", "p-4", "hover:underline"]);
// ["my-component", "p-4", "pt-8", "hover:underline"]
```

The order is the order the generated stylesheet writes the rules in: the same
`sortKey` `explain()` reports, then the same codepoint tie-break on the escaped
selector that `compile()` applies. So a sorted attribute reads the way the
cascade resolves — including which of two conflicting classes actually wins.

- Classes the compiler emits no rule for come **first**, in the order they were
  written. A CSS-module name, a component class, or a typo has no position in
  the cascade, and inventing one would lose the only ordering it has.
- Duplicates are kept. A formatter that silently drops a class is worse than one
  that leaves it where it was.
- Equal keys keep their input order, so sorting twice changes nothing.
- A variant group (`hover:{underline font-bold}`) is one token, and one token is
  all a sort can move. Run `expandVariantGroups` first to order the members.

> [!CAUTION]
> Do not sort a list that reaches `ri()`. `ri()` is right-most-wins over its
> arguments, so reordering changes which class survives. This is for a static
> class attribute, where the attribute's order carries no meaning and the CSS
> decides.

`session.sortClasses(classes)` is the same function bound to a session's theme
and its cached inspector — the form a per-keystroke editor command wants. The
standalone `sortClasses(theme, classes)` memoizes one inspector per theme
object, so it is equally cheap when called repeatedly with the same theme.
Feature-detect with the `class-sorting` capability.

## Guarantees

These are contracts, covered by tests:

- `inspector.validate(cls).ok` is true exactly when the compiler emits a rule for `cls`.
- Every enumerated class was probed through the real resolver. `validate()` accepts each one.
- `analyzeMerge(classes).output` is identical to the result of `ri()` for the same token list.
- Swatches use the same OKLCH math as the emitted CSS variables.

## Validation and explanation

```ts
const inspector = session.inspector;

inspector.validate("bg-brand-500");  // { ok: true }
inspector.validate("hover:felx!");
// { ok: false, reason: "unknown-utility", offender: "felx", suggestion: "flex" }

inspector.explain("px-4");
// {
//   parsed: { utility: "px", value: "4", variants: [], ... },
//   declarations: [{ property: "padding-inline", value: "calc(4 * var(--spacing))" }],
//   selector: ".px-4",
//   css: ".px-4 {\n  padding-inline: calc(4 * var(--spacing));\n}",
//   sortKey: 101
// }
```

- The `reason` values: `unknown-utility`, `unknown-variant`, `invalid-arbitrary`.
- `offender` is the failing token. An editor underlines it.
- `suggestion` appears only when a known name is within typo distance: 1 edit for short tokens, 2 for longer ones.
- `explain()` returns `null` for an invalid class.
- Validation results cache per class string. The cache clears wholesale at 10,000 entries.

## Enumeration

```ts
const { classes, templates } = session.enumerate();
```

`classes` holds every finite, concrete class for the theme, sorted by name. The default theme yields 3,919 classes. The count grows with the theme. `templates` holds the 95 families with infinite values, such as the spacing scale — offer those as snippets, for example `p-4`.

## Merge analysis

```ts
session.analyzeMerge(["px-2", "py-1", "p-4"]);
// { output: "p-4", kept: [2], dropped: [
//   { index: 0, className: "px-2", overriddenBy: [2] },
//   { index: 1, className: "py-1", overriddenBy: [2] } ] }
```

The input is pre-tokenized: one class per element, no whitespace splits, no falsy filter. `session.analyzeMerge` binds the session theme. The bare `analyzeMerge(classes, snapshot?)` import needs a snapshot for deterministic results — without one it falls back to module state.

## Swatches and tokens

```ts
session.swatch("brand", 500);
// { light: { css: "oklch(...)", hex: "#d558d0" }, dark: { css: "oklch(...)", hex: "#..." } }
```

- The `stop` defaults to 500.
- The result is `null` for unknown names, keyword colors, and aliases deeper than 8 hops.
- `dark` is `null` when dark mode is off or the color is fixed.
- `hex` is `null` when the value is not an `oklch()` or hex literal.

`session.tokens()` lists the theme inventory: colors with kinds, the canonical stops, spacing base, text sizes, breakpoints, and the other scales.

## Source spans

```ts
const candidates = session.extractCandidates('<div class="flex px-2">', "a.html");
// [{ value: "class", origin: "plain", start: 5, end: 10 },
//  { value: "flex", origin: "attribute", start: 12, end: 16 },
//  { value: "px-2", origin: "attribute", start: 17, end: 21 }]
```

The scanner over-collects by design: `"class"` itself becomes a candidate. Filter with `inspector.validate()` when you need real classes only.

Each candidate carries its `[start, end)` span, its origin, the helper name when relevant, and a `callId` that groups tokens of one helper call. For a variant-group member, `value` holds the expanded class and `groupPrefix` marks the prefix span.

## Candidate origins

| Origin | Meaning | Trust it as a class? |
| --- | --- | --- |
| `attribute` | A class attribute value tokenized by the attribute collector. | Yes |
| `helper` | An argument literal of a recognized class helper. | Yes |
| `safelist` | A `safelist(...)` argument literal. | Yes |
| `expression` | A string literal in a JS position that cannot be a class list. | No |
| `plain` | Only the whole-file token scan found it. | No |

An origin is earned, not inferred from position. The whole-file token scan's grammar also matches bare JavaScript identifiers, so a token it alone found stays `plain` however deeply it is nested:

```tsx
ri(mode === "default" ? "fill-white" : "fill-black")
// mode      -> plain        (an identifier, not a class)
// "default" -> expression   (an operand of ===, not a class list)
// fill-white, fill-black -> helper
```

`expression` marks a literal that is an operand of `==`/`!=` (so also `===`/`!==`). Assignment is not matched, because `const base = "px-2"` is an ordinary class list. The value is still extracted — dropping it would change the generated CSS — but an editor must not report it as a bad class.

CAUTION: Do not test `origin !== "plain"` to mean "this is a class". That was never reliable and now misses `expression` too. Test for the origins you trust.

Feature-detect both rules with the `candidate-origin-provenance` capability. Without it the installed copy assigns origins by containment alone, and bare identifiers report `helper`.

The `path` selects the extractor by extension. Without a path, the whole-file token scan runs, plus the `safelist(...)` collector, which runs for every input.

## À la carte exports

Everything the session wraps is also exported directly:

| Export | Purpose |
| --- | --- |
| `analyzeProjectCSS(css)` | Directives, theme, warnings, and positioned diagnostics. |
| `inlineDirectiveImports(css, opts)` | Replace `@import` with the text it names, using your resolver. |
| `createClassInspector(theme)` | The validator and explainer. |
| `listVariants(theme)` | All variants with kind and wrapper. |
| `enumerateClassNames(theme)` | The completion universe. |
| `UTILITY_VALUE_SPACES` | Root → the value kinds that root accepts. |
| `analyzeMerge(classes, snapshot?)` | Merge analysis. |
| `createThemeSnapshot(theme)` | A snapshot for `createRi()`. |
| `serializeSnapshot`, `hydrateSnapshot`, `publishSnapshot` | Ship a snapshot to a client as JSON, and install it as the default `ri()`'s theme. |
| `resolveColorSwatch(theme, name, stop?)` | One swatch. |
| `listThemeTokens(theme)` | The token inventory. |
| `extractClassCandidates(input, warnings?)` | Spanned candidates. |
| `extractClassesFromSource(input, warnings?)` | The candidate value set, with the per-extension passes. |
| `extractClasses(source, warnings?)` | The candidate value set from the token scan only, with no path. |
| `expandVariantGroups(input, warnings?)` | Group expansion. |
| `parseUtility(raw)` | The class parser. |
| `findClosest(input, candidates, maxDistance?)` | Typo suggestions. |
| `diagnosticFromWarning`, `warningCode`, `severityForCode` | Diagnostic helpers. |
| `hasRIActivation(src)` | Does this CSS activate Rainbow Index? |
| `CSS_ENTRY_CANDIDATES` | The 10 probe paths for CSS entry detection. |
| `RI_IMPORT_SPECIFIERS` | The accepted import specifiers. |
| `CLASS_HELPER_NAMES`, `VARIANT_HELPER_NAMES` | The scanned helper names. |
| `isSourceFile(file)` | Extension check. |
| `oklchToHex`, `cssColorToHex`, `CANONICAL_COLOR_STOPS` | Color helpers. |
| `version`, `EDITOR_API_VERSION`, `editorCapabilities` | Handshake. |

Severity rule for diagnostics: codes `RI-0xxx` and `RI-2xxx` are errors. All others are warnings.

## Gotchas

- The exported `defaultTheme` is the base `Theme`, not a `ResolvedTheme`. For a ready default theme, use `analyzeProjectCSS("").theme`.
- The scanner skips lines above 10,000 characters in the whole-file scan and reports `[RI-1411]`. Quoted class attributes on those lines are still read.
- `callId` values compare only inside one extraction result.
- Diagnostics mirror warnings one to one, so the 200-warning limit applies to both.
