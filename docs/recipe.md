# Recipes

A component library needs to say "a button has a size and a tone, and these are
the only valid values" without giving up plain CSS. `recipe()` is that layer,
and its output is an ordinary class string.

```ts
import { recipe } from "rainbowindex/recipe";

export const button = recipe({
	base: "inline-flex items-center justify-center rounded-card font-medium transition",
	variants: {
		tone: {
			solid: "bg-brand-600 text-white hover:bg-brand-700",
			quiet: "text-brand-700 hover:bg-brand-50",
			danger: "bg-red-600 text-white hover:bg-red-700",
		},
		size: {
			sm: "h-8 px-3 text-sm",
			md: "h-10 px-4",
			lg: "h-12 px-6 text-lg",
		},
		block: { true: "w-full" },
	},
	compoundVariants: [{ tone: "solid", size: "sm", class: "shadow-sm" }],
	defaultVariants: { tone: "solid", size: "md" },
});

button();                            // base + solid + md
button({ size: "sm" });              // base + solid + sm + shadow-sm
button({ tone: "quiet", block: true });
button({ size: "xl" });              // ✗ Type error: "xl" is not a size
```

Nothing is styled at runtime and nothing is injected. The classes live in the
config, where the scanner already reads them — `recipe` sits beside `cva` and
`tv` in the variant-helper list, so a build finds them with no configuration.

## Why not `cva` or `tv`

Both are good libraries, and both merge with a table of Tailwind utilities.
That table does not know your theme: a `@utility` you defined never resolves, a
`@color` name is not a color to it, and a class this project supports and
Tailwind does not is invisible. `recipe()` merges through
[`ri()`](class-merge.md), which resolves conflicts against the compiled theme,
so `p-2` and `p-8` behave the same way in a recipe as they do everywhere else:

```ts
const padded = recipe({ base: "p-2", variants: { size: { lg: "p-8" } } });
padded({ size: "lg" }); // → "p-8", not "p-2 p-8"
```

`cva` and `tv` keep working: they are still on the scanner's helper list, and a
project can use all three. Only the merge differs.

## Props

Each variant group becomes one optional prop.

| You write | The prop accepts |
| --- | --- |
| `size: { sm: …, md: … }` | `"sm" \| "md"` |
| `block: { true: … }` | `boolean` |
| `block: { true: …, false: … }` | `boolean` |

A group whose only option names are `true` and `false` takes a boolean, which
is what a React component wants to forward. Everything else takes its option
names, and a name that is not one of them is a type error.

Two props are not variants:

```ts
button({ size: "sm", class: "mt-4", className: "self-end" });
```

`class` and `className` are the caller's own classes. They merge last, so a
per-call override always wins over whatever the recipe produced. Both spellings
are accepted and both are applied.

### Opting out of a default

`undefined` means "not passed", so the default applies. `null` means "none",
and suppresses the default:

```ts
button({ size: undefined }); // md — the default
button({ size: null });      // no size classes at all
```

## Merge order

1. `base`
2. each variant group, **in the order the groups are declared**
3. each compound rule, in array order
4. the caller's `class` and `className`

Later wins, because that is what `ri()` does. So a compound rule always beats
the plain variants it refines, and the caller always beats the recipe.

## Compound variants

A compound rule applies when every variant it names has the value it names.
Defaults count — the rule below fires for `button({ size: "sm" })` because
`tone` defaults to `solid`:

```ts
compoundVariants: [
	{ tone: "solid", size: "sm", class: "shadow-sm" },
	{ size: ["sm", "md"], class: "gap-1" },   // an array matches any of its values
];
```

A group the caller left unset — and that has no default — matches nothing: a
compound rule states a combination, and an absent variant is not part of one.

Naming a group the recipe does not define is a mistake that reads as if it
works, so it warns: [`RI-2013`](diagnostics.md), at definition, in development
only.

## Typing a component's props

```tsx
import { type PropsOf, recipe } from "rainbowindex/recipe";

type ButtonProps = PropsOf<typeof button> & React.ComponentProps<"button">;

export function Button({ tone, size, block, class: _c, className, ...rest }: ButtonProps) {
	return <button className={button({ tone, size, block, className })} {...rest} />;
}
```

`PropsOf` gives exactly the variant props plus `class`/`className`, so a typo
in a call site is caught at the call site.

## Extending a recipe

A recipe exposes the config it was built from:

```ts
const outlinedButton = recipe({
	...button.config,
	base: [button.config.base, "border border-current"],
});
```

That is the object you passed, not a copy. Treat it as read-only.

## SSR and client bundles

By default a recipe merges through the module-level `ri()`, which reads the
theme the compile published. That is correct in the browser (the Vite plugin
publishes it), in a single-theme SSR process, and in the build.

Two cases need a bound merge, and both take the same option:

```ts
import { createRi } from "rainbowindex";

const button = recipe(config, { merge: createRi(snapshot) });
```

- **Multi-tenant SSR**, where one process compiles more than one theme. See
  [class-merge.md](class-merge.md).
- **A Next.js `"use client"` component**, where the client-boundary bundle does
  not reliably see the module state `publishSnapshot` wrote. Pass the bound
  `ri` your generated snapshot exports — see [frameworks.md](frameworks.md).

## What it does not do

- **No slots.** `tv()` can style several elements from one config; `recipe()`
  returns one string. Compose two recipes instead.
- **No responsive prop values.** A per-breakpoint object as a prop value is
  not supported; write the variant classes with the breakpoint prefixes they
  need (`sm:h-8 lg:h-12`).
- **No runtime style injection.** The output is class names, always.
