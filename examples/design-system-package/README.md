# `@rainbowindex-example/design-system`

A design-system package, as one would actually be published. It exists to prove
the [preset protocol](../../docs/preset-protocol.md) end to end, together with
[`design-system-consumer`](../design-system-consumer) next door.

Three files are the whole convention:

| File | What it does |
| --- | --- |
| `rainbow.css` | The tokens, as directives. Nothing else. |
| `package.json` → `exports["./rainbow.css"]` | Makes `@import "@scope/pkg/rainbow.css"` resolvable. |
| `package.json` → `rainbowindex.safelistSources` | Tells a consumer's scanner where this package's own classes live. |

## Why `rainbow.css` has no `@import "rainbowindex"`

Activation is the consuming project's business. A nested activation import
would activate twice, and the import inliner drops one anyway — so leaving it
out is both simpler and what the inliner expects. This file is directives only,
which is what makes it composable: a consumer can import it before or after
their own tokens, and the last definition wins.

## Why `safelistSources` is not optional

Every class this package renders lives in `lib/index.js` — inside the
consumer's `node_modules`, which their scanner does not walk. Without the
`safelistSources` entry those classes never reach the build, the components
render unstyled, and **nothing warns**: a class the scanner never saw is
indistinguishable from a class nobody used.

Point it at the built artifact a consumer installs, not at your source:

```json
"rainbowindex": { "safelistSources": ["./lib/**/*.js"] }
```

Patterns are relative to the package root and may not traverse out of it; an
entry that does is skipped with `[RI-1410]`.
