# Editor support

**Rainbow Index for VS Code** — a published extension, thin over
[`rainbowindex/editor`](editor-api.md), the same module the compiler's own
tests use. What your editor tells you and what your build does cannot disagree,
because they read the same theme through the same code.

Install **Rainbow Index** from the Marketplace
(`rainbowindex.rainbowindex-code`). Source:
[github.com/miloag/extension](https://github.com/miloag/extension).

## What it does

| Feature | What you get |
| --- | --- |
| Completion | Every class your theme resolves, with your own `@color`/`@utility` names ranked above the generic ones. Variants come with their colon; open-ended families arrive as snippets. |
| Hover | The generated rule, what each variant in the chain wraps, and — for a colour class — the light and dark hex. |
| Diagnostics | A class that compiles to nothing, underlined with a did-you-mean fix. Classes `ri()` conflict resolution would drop render faded. Directive problems anchor to the offending at-rule, and every warning carries its `RI-…` code with a fix that writes the `ri-disable` comment. |
| Colours | A chip beside every colour class and every `@color` value. Dragging the picker offers the nearest classes in your palette rather than raw hex. |
| Syntax | Injection grammars light up directives, `@apply` lists, functional blocks and suppression pragmas — in stylesheets and in `<style>` blocks. |
| Theme Explorer | Your resolved theme as a tree: colours as real light/dark swatches, the type scale, spacing, breakpoints, radii, shadows, weights, motion. |
| Elements | Every element of the document with its classes grouped by origin — inline, programmatic, and the stylesheet rules that target it. |
| Navigate | Go to Definition on a custom utility, variant or colour; Find References across the workspace; Rename with a completeness guard. |
| Refactor | Extract inline utilities into an `@utility`; collapse and expand variant groups; sort classes into the order the stylesheet emits them. |
| Build | Tasks for `build` and `watch`, a Generate Types command, and a project initializer. |

Every one of them reads *your* theme. There is no bundled class list.

## How it finds your theme

The same way the CLI does — the [candidate paths](cli.md#css-input-auto-detection)
(`src/index.css`, `src/app.css`, …), taking the first that actually activates
Rainbow Index. `rainbowindex.cssEntry` overrides it when the guess is wrong. A
folder with no entry gets no diagnostics and no completions rather than wrong
ones.

Three consequences worth knowing:

- **An imported token file counts.** Directives living in a file the entry
  `@import`s are read, package presets included, so editing `src/tokens.css`
  updates completions in your components. This needs a copy of the package
  carrying the `import-inlining` capability; the `{}` indicator says
  `@import contents unread` when yours is older, rather than leaving the file
  silently contributing nothing.
- **An unsaved buffer wins over the file on disk.** Type a new `@color` and it
  completes before you save — in the entry, or in anything it imports.
- **Each workspace folder is its own project.** In a multi-root window a file is
  answered against the theme of the folder it lives in, with that folder's own
  entry and its own installed copy of the package.

## The installed copy answers

The extension prefers `rainbowindex/editor` from **your workspace** over the
copy it bundles. That is why the editor API is capability-versioned: it checks
`editorCapabilities` and gates features on what is actually there, rather than
silently offering less or answering about a version you do not have. The `{}`
language status indicator names the version and the entry driving it.

Upgrading the package upgrades the editor experience.

## Known limits

- **A class assembled at runtime is invisible**, exactly as it is to the build:
  `` `bg-brand-${stop}` `` is not a class the scanner can see. See
  [source-scanning.md](source-scanning.md).
- **Diagnostics cover class positions only** — a `class`/`className` attribute,
  an argument to a class helper, a `cva`/`tv`/`recipe` config, an `@apply`. A
  word in a paragraph is not a misspelled utility.
- **Very large files are skipped.** Over 1 MB analysis is disabled for the file,
  and the status indicator says so.

## Other editors

There is no first-party integration for other editors yet.
[`rainbowindex/editor`](editor-api.md) is the toolkit one would be built on:
pure computation, no `node:` imports, capability-versioned, and the host keeps
all file access. It is what the VS Code extension itself runs on, so anything
built against it answers exactly what the build does.
