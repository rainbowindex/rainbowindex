# Contributing

Thanks for looking. Rainbow Index is a small project with one maintainer, so
the fastest path from idea to merged change is: open an issue first for
anything larger than a bug fix, then send one focused pull request.

## Setup

```sh
pnpm install
pnpm check
```

`pnpm install` needs pnpm `>=10.21` — the version in `packageManager` installs
itself, so plain `pnpm install` picks it up. Node `>=20.19` is required; CI runs
`20.19` and `24`.

`pnpm check` is the single gate. It runs, in order:

| Step | Command |
| --- | --- |
| Formatting | `pnpm format:check` |
| Types | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Unit tests | `pnpm test` |
| Built-artifact tests | `pnpm test:artifacts` (builds first) |

Fixers: `pnpm format` and `pnpm lint:fix`. `pnpm test:watch` while you work.

Set `RI_OFFLINE=1` to run without network access. Font weight resolution falls
back to bundled metadata, which is what CI does — if a test only passes online,
that is a bug in the test.

## Repository layout

```
src/
  cli/           argv parsing and the `rainbowindex` subcommands
  css/           CSS-level helpers (alpha, escaping, fluid, preflight)
  directives/    @color, @text, @font, @utility, @custom, … parsing
  editor/        editor session, inspection, enumeration
  engine/        compile loop: candidates in, stylesheet out
  entries/       public entry points (index, browser, editor, vite, oxlint)
  integrations/  Vite plugin, PostCSS plugin, font providers
  merge/         ri() — class merging and the compilation snapshot it reads
  project/       headless project pipeline (analyze → scan → finalize)
  scanner/       class extraction from source files
  theme/         resolved theme shape and defaults
  utilities/     the utility generators
```

## Tests

Tests live in `__tests__/`, mirroring those areas:

| Directory | Covers |
| --- | --- |
| `__tests__/core/` | engine, directives, utilities, editor, integrations |
| `__tests__/merge/` | `ri()` and merge analysis |
| `__tests__/scanner/` | class extraction |
| `__tests__/cli/` | the built CLI (`pnpm test:artifacts` only) |
| `__tests__/golden/` | whole-stylesheet fixtures — see below |
| `__tests__/font-providers/` | Google Fonts resolution |
| `__tests__/helpers/` | shared theme fixtures |

`__tests__/cli/cli.test.ts` and `__tests__/package.test.ts` run against `dist/`
and are excluded from `pnpm test`; `pnpm test:artifacts` builds and runs them.

### Golden tests

`__tests__/golden/` asserts the *whole* emitted stylesheet for a handful of
fixtures, so a change to any declaration shows up as a readable diff instead of
silently passing tests that only assert fragments.

A fixture is a directory under `__tests__/golden/fixtures/<name>/`:

```
input.css        the CSS entry
sources/         optional source files whose classes get scanned
expected.css     the committed output
```

Adding a fixture needs no test code — the suite discovers directories. After an
intentional change to emitted CSS:

```sh
pnpm test:golden:update
```

Read the resulting `expected.css` diff before committing it. That diff is the
change; if it contains something you did not intend, the fix is in `src/`, not
in the fixture.

## Adding a utility

Every built-in utility root is one row in
[`src/utilities/roots.ts`](src/utilities/roots.ts). A row binds the root to its
resolvers (in probe order) *and* to the `spec` — the value space editor
enumeration will try for it. Both live in the same row so `PREFIX_DISPATCH` and
`UTILITY_VALUE_SPACES` cannot drift apart.

1. Add the row, with a `spec`. `spec` may over-approximate: every enumeration
   candidate is probed through the real resolver, which stays the authority. Use
   `{ kinds: [] }` for a statics-only root.
2. Implement the generator in the matching `src/utilities/*.ts`.
3. If the utility sets CSS properties that can conflict with another class,
   register those properties so `ri()` resolves the conflict — see
   `src/merge/props.ts`.
4. Run `pnpm test`. `__tests__/core/enumerate.test.ts` and
   `__tests__/core/utility-contracts.test.ts` are the tripwires: they enumerate
   the table and fail when a root has no spec, when a static utility has no
   property mapping, or when enumeration emits something the resolver rejects.
5. Document it in `docs/utilities.md`.

Row order is load-bearing: it fixes `PREFIX_DISPATCH` key insertion order, which
drives cross-root enumeration dedup. Append rather than reorder unless you mean
to change that.

## Diagnostic codes

Warnings carry an `RI-NNNN` code. Allocate the next free number inside the range
for the subsystem:

| Range | Subsystem |
| --- | --- |
| 00xx | PostCSS plugin bootstrap (thrown) |
| 10xx | Compilation & directives |
| 11xx | Color directives & resolver catch-alls |
| 12xx | Font system |
| 13xx | Merge / compilation context |
| 14xx | Source scanner |
| 15xx | Typography utilities |
| 16xx | Integration plugins (Vite, PostCSS, CLI wiring) |
| 20xx | CSS functions, `ri()` runtime & `compile()` validation |

A new code needs a row in [`docs/diagnostics.md`](docs/diagnostics.md) giving
cause and fix, and a decision on whether `ri-disable` may suppress it
(`isSuppressible` in `src/directives/suppress.ts`). Codes are part of the public
surface: never renumber one, and never change what an existing code means.

## Documentation

Docs are checked, not just written. `__tests__/core/docs-sync.test.ts` asserts
that the capability list in `docs/editor-api.md` matches `editorCapabilities`
in `src/entries/editor.ts`. Adding a capability without a doc line fails CI.

## The Tailwind preset

`src/presets/tailwind.css` is generated, not hand-written. It transcribes
Tailwind v4's default theme into directives, and
`scripts/generate-tailwind-preset.mjs` is the only thing that should ever
write it:

```bash
node scripts/generate-tailwind-preset.mjs                   # fetch upstream
node scripts/generate-tailwind-preset.mjs path/to/theme.css # from a local file
```

Read the diff before committing. A Tailwind release that adds a color family
shows up as new `@color` blocks; one that renames a namespace shows up as a
block that silently disappeared, which is why the generator only understands
the namespaces it lists.

Two things are added by hand in the generator rather than read from upstream,
because Tailwind implements them as utilities rather than tokens: `leading-none`
and `container`. If you add a third, say so in a comment next to it.

The values are Tailwind's, so `NOTICE.md` has to keep saying so — MIT's notice
clause is the reason that section exists.

`__tests__/core/tailwind-preset.test.ts` is the gate: a 437-class table that
must all validate, a list of known gaps asserted red, and a check that the
preset's `@utility` blocks still match the engine's own composition chains.
`__tests__/golden/fixtures/tailwind-preset/` diffs the whole emitted stylesheet.

## Changelog

Every user-visible change needs an entry in
[`CHANGELOG.md`](CHANGELOG.md) under an `## [Unreleased]` heading, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) sections (`Added`,
`Changed`, `Removed`, `Fixed`). The release workflow reads the section for the
version being released and fails the release if it finds none, so an entry is
not optional.

Write entries for someone upgrading: what changed, what they have to do about
it. Removals and behavior changes get the most detail.

## Pull requests

- Branch from `main`; one logical change per branch.
- `pnpm check` green locally before you push. CI runs the same gate on Node
  20.19 and 24.
- Version bumps and releases are the maintainer's; do not bump `version` in a
  PR.

## Security

Do not open a public issue for a vulnerability — see [SECURITY.md](SECURITY.md).
