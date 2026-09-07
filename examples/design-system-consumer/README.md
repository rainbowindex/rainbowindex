# `@rainbowindex-example/design-system-consumer`

An app that installs [`@rainbowindex-example/design-system`](../design-system-package)
and builds with the CLI. It is the proof half of the
[preset protocol](../../docs/preset-protocol.md) example: two lines of setup,
and a `verify.mjs` that fails the build if either half of the protocol stops
working.

```css
/* src/index.css */
@import "rainbowindex";
@import "@rainbowindex-example/design-system/rainbow.css";

@color {
	brand: 0.18 330;
}
```

That is all a consumer writes. No `@source` for `node_modules`, no plugin
configuration.

## What `verify.mjs` checks, and why

Both halves of the protocol fail *silently* — the build succeeds and the
stylesheet simply has less in it — so an example that only builds proves
nothing. The checks are split so a failure names the half that broke:

| Half | Checked with | Why that class |
| --- | --- | --- |
| The `@import` was resolved and read | `rounded-control`, `text-accent-700` | Written by hand in this app's own source, so the scanner finds them either way. They compile only if the package's directives reached the theme. |
| `safelistSources` was honoured | `bg-accent-500`, `bg-surface`, `ds-focus-ring` | These exist **only** inside the installed package's `lib/`. |
| The consumer's own theme still works | `text-brand-700`, `min-h-screen` | A package's tokens must not displace yours. |

Deleting `rainbowindex.safelistSources` from the package fails the second group
and nothing else; deleting the `@import` fails the first, and the second along
with it, because the package's classes need its tokens to compile.
