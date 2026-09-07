# Examples

Five real apps, one per integration path, each declaring the same theme so they
can be diffed against each other, plus a two-package pair that proves the
design-system preset protocol. CI builds all of them on every change to
`src/` or `examples/`, which is the point: a framework integration breaks in
ways the unit suite cannot see.

| Example | Integration | What it shows |
| --- | --- | --- |
| [`vite-react`](vite-react) | Vite plugin | The shortest path, plus a `recipe()` button. Also why `` `bg-brand-${stop}` `` does not work. |
| [`react-router`](react-router) | Vite plugin | `ri()` where it earns its keep — an active nav link overriding a base class. |
| [`sveltekit`](sveltekit) | Vite plugin | `class:` directives, and `ri()` in a `$derived`. |
| [`astro`](astro) | Vite plugin | Classes declared in `.astro` frontmatter, not just markup. |
| [`nextjs`](nextjs) | PostCSS plugin | No Vite: `@source` for `app/`, and the generated snapshot for client `ri()`. |
| [`design-system-package`](design-system-package) | — | A publishable token package: `exports["./rainbow.css"]` and `safelistSources`. |
| [`design-system-consumer`](design-system-consumer) | CLI | Installs it in two lines, and fails its own build if either half of the protocol breaks. |

Read [docs/frameworks.md](../docs/frameworks.md) for the copy-pasteable version
of each.

## Running one

From the repository root:

```bash
pnpm build                                              # the examples need dist/
pnpm --filter @rainbowindex-example/vite-react run dev
```

Or build them all at once, which is what CI does:

```bash
pnpm examples:build
```

## They are not published

Each example is `private`, lives outside the root package's `files` list, and is
named `@rainbowindex-example/*` so it can never be mistaken for a shipped
package. They depend on `rainbowindex` as `workspace:*`, so they always build
against the working tree rather than a release.
