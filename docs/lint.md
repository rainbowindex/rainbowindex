# Lint rules

Three rules, all off until you enable them and none of them required to build.
Two read your compiled theme, which is what lets them say a class is *wrong*
rather than merely unusual.

| Rule | Reports |
| --- | --- |
| `prefer-ri` | An import of `clsx`, `classnames`, or `tailwind-merge`. |
| `no-unknown-class` | A class in a class position that compiles to nothing. |
| `no-conflicting-classes` | Two classes in **one** class string where the later one erases the earlier. |

```ts
// vite.config.ts
export default defineConfig({
	lint: {
		jsPlugins: [{ name: "rainbowindex", specifier: "rainbowindex/oxlint" }],
		rules: {
			"rainbowindex/prefer-ri": "error",
			"rainbowindex/no-unknown-class": "error",
			"rainbowindex/no-conflicting-classes": "warn",
		},
	},
});
```

The same rules ship for ESLint as a flat-config plugin. `prefer-ri` is Oxlint-only — it is a one-node import check that Oxlint's own rules already cover the shape of:

```js
// eslint.config.js
import rainbowindex from "rainbowindex/eslint";

export default [
	{
		files: ["src/**/*.{js,jsx,ts,tsx}"],
		plugins: { rainbowindex },
		rules: {
			"rainbowindex/no-unknown-class": "error",
			"rainbowindex/no-conflicting-classes": "warn",
		},
	},
];
```

## `prefer-ri`

`clsx`, `classnames` and `tailwind-merge` each merge classes against a Tailwind utility table, so they resolve conflicts against the wrong utility set and never see your theme. `ri()` does both jobs against the compiled theme.

## `no-unknown-class`

Runs every class the scanner finds in a class position through
`inspector.validate` — the same resolution the compiler performs — and reports
the ones that produce no CSS, with the reason and, when the name is within typo
distance of a real one, an editor suggestion that rewrites just the failing
fragment:

```jsx
<div className="flex felx" />
//                   ^^^^ Unknown utility "felx" — compiles to nothing. Did you mean "flex"?
```

It reports only classes in a class position — a `class`/`className` attribute,
an argument to a class helper, a `cva`/`tv` config, a safelist. A word in a
paragraph is not a misspelled utility, and the rule leaves it alone.

## `no-conflicting-classes`

Runs `analyzeMerge` over each class string and reports the classes it drops:

```jsx
<div className="px-2 px-4" />
//              ^^^^ overridden by "px-4" in the same class string, so it has no effect
```

**Within one string only.** `ri("px-2", override)` is what the function is
for — the second argument is meant to win — so classes in separate arguments
never conflict with each other. Two candidates belong to the same string
exactly when nothing but whitespace separates them in the source, which holds
for an attribute, a template literal and a helper argument alike.

## Finding your theme

Both theme-aware rules locate the project's CSS entry the way the editor
toolkit does: the standard candidate paths (`src/index.css`, `src/app.css`, …),
taking the first that actually activates Rainbow Index, with `@import`s
inlined. Point them somewhere else when your entry is not on that list:

```js
rules: { "rainbowindex/no-unknown-class": ["error", { css: "styles/app.css" }] }
```

One session is cached per entry and invalidated by mtime, on the entry and on
every file it imports, so a watching linter follows a token change without a
restart. A repository with no Rainbow Index entry lints clean: a rule with no
theme has nothing to say, and failing would be worse than silence.

## Why these run on the scanner, not the AST

Neither theme-aware rule walks the syntax tree looking for class positions. The
scanner already decides what a class position is — a `class`/`className`
attribute, an argument to a class helper, a `cva`/`tv` config, an `@source
inline` safelist — and a rule that re-derived that from the AST would drift from
the compiler it is meant to describe. Both rules run once per file over the
source text and take the scanner's own candidates, so *the classes the linter
checks and the classes the build compiles are the same set by construction*.

One filter sits in between: the scanner over-collects on purpose, and in
JavaScript it emits the fragments around each `:` alongside the joined token.
[`outermostCandidates`](editor-api.md#one-candidate-per-class) drops those, so
`sm` inside `sm:flex` is never reported as an unknown class.
