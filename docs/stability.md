# Stability

What you can build on, what may still move, and how a change reaches you.

Rainbow Index is **pre-1.0**. That is not a disclaimer to skip: four consecutive
minors have removed or changed behaviour, and until 1.0 a minor may do it again.
This page says which parts of the surface are already treated as a contract
anyway, what warning you get before one of them changes, and what 1.0 will
freeze.

## Versioning today

`MAJOR.MINOR.PATCH`, with the pre-1.0 reading:

| Bump | What it may contain |
| --- | --- |
| `0.x.0` minor | New features. Removals and behaviour changes, after the deprecation period below where one applies. |
| `0.x.y` patch | Fixes only. No removals, no new required configuration. |

Pin a minor (`~0.7.0`) if you need the surface to hold still; take a caret
(`^0.7.0`) if you would rather have the fixes. From 1.0 onward the ordinary
semver reading applies and the table above goes away.

## The deprecation policy

Anything in [What is stable](#what-is-stable) gets **two minors** between the
warning and the removal:

1. The replacement ships, and the old form keeps working.
2. Using the old form emits a numbered diagnostic naming the replacement.
3. Two minors later, the old form is removed, and the release notes say so under
   `Removed`.

Two exceptions, both narrow. A **security fix** may remove something in a patch.
A form that has **never worked** — one that emits invalid CSS, or that no
version has compiled — is a bug, and fixing a bug is not a deprecation.

## What is stable

These are the parts an integration, a design system, or a migration can code
against. Each is covered by tests, and each is subject to the policy above.

### The class grammar

`[variant:]*utility[-value][/modifier][!]`, arbitrary values in `[]`, arbitrary
properties as `[property:value]`, variant groups as `variant:{a b}`. The grammar
is stable; which *utilities* exist is not — a family may be added at any time,
and one may be removed under the policy. See
[class-syntax.md](class-syntax.md).

### Directive names and their block syntax

`@color`, `@text`, `@spacing`, `@breakpoint`, `@rounded`, `@shadow`,
`@weight`, `@ease`, `@blur`, `@z`, `@leading`, `@tracking`, `@opacity`,
`@duration`, `@animate`, `@fluid`, `@font`, `@preflight`, `@utility`,
`@custom` (with `@slot`), `@source`, `@layer`, `@register`, and `@apply` (with
its `@a` alias). A directive's name and the meaning of its entries are stable.
See [theming.md](theming.md).

Four of the current spellings are **not valid CSS**: a block after a
declaration inside `@font` and
`@animate`, the `!name;` removal form, bare keyword options in `@fluid` and
`@color`, and variant groups inside `@apply`. If those change, both spellings
will be accepted for two minors, as the policy requires.

### `RI-NNNN` diagnostic codes

A code's **meaning** is stable: once `RI-1124` names a shadowed `@color` entry,
it will not be reassigned to something else. Message text is not stable — it is
prose, and prose gets clearer. Match on the code, never on the words. The range
table and the full code list are in [diagnostics.md](diagnostics.md).

A code may be retired (the condition stops existing); its number is then never
reused.

### The `exports` map

| Entry point | What it is |
| --- | --- |
| `rainbowindex` | `compileProject`, `createCompiler`, `ri`, `createRi`, snapshot helpers |
| `rainbowindex/index.css` | The activation stylesheet |
| `rainbowindex/tailwind.css` | The optional Tailwind-default preset |
| `rainbowindex/editor` | The IO-free editor toolkit |
| `rainbowindex/vite` | The Vite plugin |
| `rainbowindex/oxlint` | The Oxlint plugin |
| `rainbowindex/package.json` | Itself |

Adding an entry point is a minor. Removing or repointing one follows the
deprecation policy. The map has no wildcard, so a deep path into `dist/` does
not resolve at all; reaching a build artifact some other way is unsupported and
will break without notice.

### The editor API

`rainbowindex/editor` carries its own contract, because an editor integration
loads whatever version the workspace installed rather than one it chose:

- `EDITOR_API_VERSION` is `1`. It bumps only on a **breaking** change to that
  entry.
- `editorCapabilities` is the roster to feature-detect against. Entries are
  added as capabilities ship; **an entry is never removed or renamed while the
  capability exists.** Gate on the capability, not on `version`.
- The entry's module graph contains no `node:` import, and a test bundles it for
  a browser on every run to keep that true.

See [editor-api.md](editor-api.md).

### The CLI

Command names, their flags, and their exit codes. New flags are a minor;
changing what an existing flag does follows the policy. Terminal output is
prose and is not a contract — parse the files a command writes, not its
stdout. See [cli.md](cli.md).

## What is not stable

- **Emitted CSS, byte for byte.** Selector escaping, declaration order, section
  layout and which tokens survive pruning all change as the compiler improves.
  What is stable is the *rendered result* and the sort order's meaning:
  shorthands before longhands, variants after their base. A golden-file test of
  your own output will fail on a minor; that is expected.
- **Which classes exist.** `bench:parity` tracks the Tailwind surface, and the
  set grows. A class that never compiled may start compiling in any release.
- **Warning text**, as above.
- **`dist/` internals.** Chunk names, module boundaries, anything not in the
  `exports` map.
- **`bench/`, `examples/`.** Private workspace packages. They are not
  published and carry no compatibility promise.

## Supported runtimes

### Node

`>=20.19`, as `engines` states. The package is **ESM-only**: there is no
CommonJS build, so `require("rainbowindex")` works only where `require()` of an
ES module does (Node 20.19+). CI runs the suite on 20.19 and 24.

Raising the floor is a minor, and only to a version whose predecessor has
reached end of life.

### Browsers

The generated stylesheet uses `light-dark()`, `@property`, `color-mix()`,
`oklch()` and CSS nesting. Unminified, that puts the floor at roughly
**Chrome/Edge 123, Firefox 128, Safari 17.5** — the point where all five are
available.

`rainbowindex build --minify` runs LightningCSS at Chrome 96, Firefox 91 and
Safari 15.4, which lowers most of it: `light-dark()` becomes a
`prefers-color-scheme` pair, `oklch()` gains hex fallbacks under
`@supports (color: lab(…))`, and nesting is flattened. One thing it cannot
lower is `color-mix()` over a `var()` — the arguments are not known statically —
and that is exactly what an alpha modifier on a theme color
(`bg-brand-500/50`) emits. So **the practical floor for minified output is
`color-mix()` support: Chrome 111, Firefox 113, Safari 16.2**, and only for a
project that uses no alpha modifiers does it drop lower.

Any browser floor is a documented number, not a compiler assumption: nothing
feature-detects at build time, so a project that must go lower should avoid the
features above rather than expect a fallback.

## How a change reaches you

- [`CHANGELOG.md`](https://github.com/rainbowindex/rainbowindex/blob/main/CHANGELOG.md)
  follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Every
  release has `Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` sections
  as they apply, and every entry says what to do about it. A `Removed` bullet
  always names the release that first warned.
- A deprecation warns through the diagnostic system, so it reaches you in the
  build log, in `result.warnings()`, and in your editor — not only in release
  notes nobody reads.
- Releases are tagged; every tag resolves to a commit on `main`.

## What 1.0 will freeze

1.0 is the point at which the sections above stop being "treated as a contract"
and become one under ordinary semver. Before it ships:

- The standard-CSS syntax RFC is decided and implemented, so a directive file
  formats under Prettier and Oxfmt with no ignore rule.
- The class grammar and directive set are final for the major.
- The deprecation policy's two-minor window applies to every removal without
  exception beyond the two named above.

Until then, read the `Removed` section before upgrading a minor. It is short,
and it is where the surprises are.
