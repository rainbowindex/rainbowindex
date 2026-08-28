# Editor API

`rainbowindex/editor` is a toolkit for editor integrations: validation, hover docs, completions, merge analysis, swatches, and source spans. It is pure computation. Strings go in, structures come out. The module graph has no `node:` imports, so it runs in browser hosts such as vscode.dev.

The host reads the files. The entry supplies the semantics.

## Version handshake

```ts
import { version, EDITOR_API_VERSION, editorCapabilities } from "rainbowindex/editor";
```

Feature-detect with `editorCapabilities`, not with the version. Integrations load whatever version the workspace installed. The capability list: `class-candidates`, `candidate-call-ids`, `candidate-origin-provenance`, `css-entry-detection`, `theme-analysis`, `class-inspection`, `variant-list`, `class-enumeration`, `merge-analysis`, `structured-diagnostics`, `color-swatches`, `editor-session`.

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
session.setCss(nextCss);                 // theme changed → all caches invalidate together
```

All theme-derived values cache together and invalidate together on `setCss()`. `setCss()` with identical text is a no-op.

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

`classes` holds every finite, concrete class for the theme, sorted by name. The default theme yields 3,537 classes. The count grows with the theme. `templates` holds the 88 families with infinite values, such as the spacing scale — offer those as snippets, for example `p-4`.

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
| `createClassInspector(theme)` | The validator and explainer. |
| `listVariants(theme)` | All variants with kind and wrapper. |
| `enumerateClassNames(theme)` | The completion universe. |
| `UTILITY_VALUE_SPACES` | Root → the value kinds that root accepts. |
| `analyzeMerge(classes, snapshot?)` | Merge analysis. |
| `createThemeSnapshot(theme)` | A snapshot for `createRi()`. |
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
