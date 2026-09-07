# Preset protocol

How a package ships design tokens that a Rainbow Index project can install.

There is no plugin API and no registry. A design-system package is an ordinary
npm package that does two things: it exports a stylesheet of directives, and it
says where its own classes live. A consumer writes one `@import`.

```css
/* the consumer's CSS entry */
@import "rainbowindex";
@import "@scope/tokens/rainbow.css";
```

That is the whole setup. A working pair — the package and an app that installs
it — is in
[`examples/design-system-package`](https://github.com/rainbowindex/rainbowindex/tree/main/examples/design-system-package)
and
[`examples/design-system-consumer`](https://github.com/rainbowindex/rainbowindex/tree/main/examples/design-system-consumer).

## What the package ships

### 1. A stylesheet of directives, in `exports`

```json
{
	"name": "@scope/tokens",
	"exports": {
		".": "./lib/index.js",
		"./rainbow.css": "./rainbow.css"
	},
	"files": ["lib", "rainbow.css"]
}
```

```css
/* rainbow.css */
@color {
	surface: oklch(0.98 0.005 265) / oklch(0.19 0.01 265);
	accent: 0.16 20;
}

@rounded {
	control: 0.625rem;
}

@utility ds-focus-ring {
	outline: 2px solid var(--color-accent-500);
	outline-offset: 2px;
}
```

The consumer's analyzer resolves the bare specifier through the package
`exports` map and reads the file's directives as if they had been written in
the entry. This is the [`@import` resolution](cli.md#import) that every surface
shares — the CLI, the PostCSS plugin, the Vite plugin, and the editor session.

**Do not put `@import "rainbowindex"` in it.** Activation is the consuming
project's business, and a nested activation import would activate twice. The
inliner drops one anyway, so leaving it out is both simpler and what the
inliner expects. Directives only: that is what makes the file composable, so a
consumer can import it before or after their own tokens and the last definition
wins.

**Comment your stylesheet freely — the comments do not reach the consumer.**
The inliner drops comments from a *package* import and keeps them in the
project's own files, and package-ness is inherited, so a preset's own relative
imports are covered too. The rule follows from who each audience is: your notes
are addressed to whoever opens your package, and the consumer's build output is
read by whoever opens *their* stylesheet. Rainbow Index's own Tailwind preset is
the case that set the policy — being nothing but directives and section
headings, it contributed only its headings, 4.3 KB of them, to every unminified
consumer build.

Explanatory comments therefore cost your consumers nothing, so write them. For
the one kind of comment that *must* reach the consumer — a licence header, an
attribution notice — use the `/*!` form, which survives:

```css
/*! @scope/tokens v2.1.0 — MIT. https://example.com/licence */
@color {
	accent: 0.16 20;
}
```

That is the same marker every CSS minifier honours, so the notice survives your
consumer's minifier too, not just this step.

### 2. Where its own classes live

```json
{
	"rainbowindex": {
		"safelistSources": ["./lib/**/*.js"]
	}
}
```

Every class the package's components render lives inside the consumer's
`node_modules`, which their scanner does not walk. Without this entry those
classes never reach the build, the components render unstyled, and **nothing
warns** — a class the scanner never saw is indistinguishable from a class
nobody used.

Point it at the built artifact a consumer installs, not at your source.
Patterns are relative to the package root and may not traverse out of it; an
entry that does is skipped with [`RI-1410`](diagnostics.md). See
[source-scanning.md](source-scanning.md#dependency-safelists) for the scan
rules.

Discovery walks the consumer's `dependencies` and `peerDependencies`.
`devDependencies` are skipped by design, so a package meant to be consumed must
not rely on being one.

## What the consumer writes

One import. No `@source` for `node_modules`, no plugin configuration, no
allow-list.

Ordering is ordinary CSS ordering: the last definition of a token wins, so a
consumer overrides a package token by declaring it after the import.

```css
@import "rainbowindex";
@import "@scope/tokens/rainbow.css";

@color {
	/* the package's accent, but ours */
	accent: 0.18 330;
}
```

## Composing several packages

Imports are inlined in source order, depth-first, with a cycle guard and a
depth cap of 8. Two packages that both define `accent` resolve the way two
`@color` blocks in one file would: the later import wins. Nothing merges
structurally, so a package cannot partially extend another's palette — it
either declares a token or it does not.

## What a package cannot do

- **Ship compiled CSS as its tokens.** The protocol carries *directives*. A
  package that ships a built stylesheet of `--color-*` declarations gives a
  consumer no theme to compile against: `bg-accent-500` will not resolve, and
  `ri()` will not know `accent` is a color.
- **Change the consumer's activation.** Importing a package stylesheet does not
  activate Rainbow Index on its own; the consumer's entry does that.
- **Register a plugin.** There is no plugin hook. The extension points are the
  directives — `@utility`, `@custom`, `@register` — and they are the same ones a
  consumer has.
- **Scan a `devDependency`.** See above.

## Checking it works

Both halves fail silently: the build succeeds and the stylesheet has less in
it. The example consumer's `verify.mjs` is the pattern worth copying — assert
against the built CSS, and separate the halves so a failure says which one
broke:

- **The import was read.** Assert a class that your *own* source uses and only
  the package's directives can compile — a named radius, a stop from the
  package's ramp.
- **`safelistSources` was honoured.** Assert a class that exists only inside the
  installed package.
