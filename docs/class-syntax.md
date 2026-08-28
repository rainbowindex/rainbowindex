# Class Syntax

A Rainbow Index class has this shape:

```
[variant:]* [-] utility [-value] [/modifier] [!]
```

Examples: `flex`, `px-4`, `-mt-2`, `hover:bg-brand-500/50`, `sm:dark:flex`, `p-4!`.

- Variants come first and chain with `:`.
- A leading `-` makes the value negative.
- A `/modifier` after a color sets the alpha. After a text size, it sets the line height.
- A trailing `!` adds `!important`.

For the list of utility families, see [utilities.md](utilities.md).

## Variants

A variant limits when a utility applies. Chain as many as you need: `sm:hover:bg-brand-600`.

### Pseudo-classes

| Variant | Selector |
| --- | --- |
| `hover` | `:hover` |
| `focus` | `:focus` |
| `focus-visible` | `:focus-visible` |
| `focus-within` | `:focus-within` |
| `active` | `:active` |
| `visited` | `:visited` |
| `disabled` | `:disabled` |
| `enabled` | `:enabled` |
| `checked` | `:checked` |
| `indeterminate` | `:indeterminate` |
| `required` | `:required` |
| `optional` | `:optional` |
| `valid` | `:valid` |
| `invalid` | `:invalid` |
| `user-valid` | `:user-valid` |
| `user-invalid` | `:user-invalid` |
| `in-range` | `:in-range` |
| `out-of-range` | `:out-of-range` |
| `placeholder-shown` | `:placeholder-shown` |
| `autofill` | `:autofill` |
| `read-only` | `:read-only` |
| `empty` | `:empty` |
| `first` | `:first-child` |
| `last` | `:last-child` |
| `odd` | `:nth-child(odd)` |
| `even` | `:nth-child(even)` |
| `only` | `:only-child` |
| `first-of-type` | `:first-of-type` |
| `last-of-type` | `:last-of-type` |
| `only-of-type` | `:only-of-type` |
| `target` | `:target` |
| `default` | `:default` |
| `details-content` | `:details-content` |

### Pseudo-elements

| Variant | Selector |
| --- | --- |
| `before` | `::before` |
| `after` | `::after` |
| `placeholder` | `::placeholder` |
| `file` | `::file-selector-button` |
| `marker` | `::marker` |
| `selection` | `::selection` |
| `first-line` | `::first-line` |
| `first-letter` | `::first-letter` |
| `backdrop` | `::backdrop` |

### Media variants

| Variant | Condition |
| --- | --- |
| `dark` | `@media (prefers-color-scheme: dark)` |
| `light` | `@media (prefers-color-scheme: light)` |
| `portrait` | `@media (orientation: portrait)` |
| `landscape` | `@media (orientation: landscape)` |
| `print` | `@media print` |
| `motion-safe` | `@media (prefers-reduced-motion: no-preference)` |
| `motion-reduce` | `@media (prefers-reduced-motion: reduce)` |
| `contrast-more` | `@media (prefers-contrast: more)` |
| `contrast-less` | `@media (prefers-contrast: less)` |
| `forced-colors` | `@media (forced-colors: active)` |
| `inverted-colors` | `@media (inverted-colors: inverted)` |
| `pointer-fine` | `@media (pointer: fine)` |
| `pointer-coarse` | `@media (pointer: coarse)` |
| `pointer-none` | `@media (pointer: none)` |
| `any-pointer-fine` | `@media (any-pointer: fine)` |
| `any-pointer-coarse` | `@media (any-pointer: coarse)` |
| `any-pointer-none` | `@media (any-pointer: none)` |
| `noscript` | `@media (scripting: none)` |
| `starting` | `@starting-style` block inside the rule |

Dark mode uses the media query `prefers-color-scheme`. There is no class strategy for `dark:`. To make a class-based variant, define one with `@custom`. See [theming.md](theming.md).

### Special selectors

| Variant | Selector (`&` is the element) |
| --- | --- |
| `inert` | `&:is([inert], [inert] *)` |
| `rtl` | `&:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)` |
| `ltr` | `&:where(:dir(ltr), [dir="ltr"], [dir="ltr"] *)` |
| `open` | `&:is([open], :popover-open, :open)` |
| `*` | `:is(& > *)` — direct children |
| `**` | `:is(& *)` — all descendants |

### Breakpoints and container queries

| Variant | Condition |
| --- | --- |
| `sm` / `md` / `lg` / `xl` | `@media (min-width: 40rem / 48rem / 64rem / 80rem)` |
| `@sm`, `@md`, ... | `@container (min-width: <breakpoint>)` |
| `@sidebar/sm` | `@container sidebar (min-width: 40rem)` |
| `min-[600px]` | `@media (width >= 600px)` |
| `max-[40rem]` | `@media (width < 40rem)` — exclusive |

There is no `2xl` breakpoint by default. Change the set with the `@breakpoint` directive.

`min-[...]` and `max-[...]` accept only a number with one of these units: `px`, `em`, `rem`, `ch`, `vw`, `vh`, `svw`, `svh`, `dvw`, `dvh`, `cqw`, `cqh`. Percentages, `calc()`, and negatives are not accepted. There is no arbitrary container size. Instead of `@[600px]`, write `[@container(min-width:600px)]`.

### Attribute and relational variants

| Pattern | Selector |
| --- | --- |
| `data-open` | `[data-open]` |
| `data-[state=open]` | `[data-state=open]` |
| `aria-checked` | `[aria-checked="true"]` |
| `aria-[pressed=true]` | `[aria-pressed=true]` |
| `group-hover` | `.group:hover &` |
| `group-[sel]` | `.group:is(sel) &` |
| `peer-focus` | `.peer:focus ~ &` |
| `peer-[sel]` | `.peer:is(sel) ~ &` |
| `in-[sel]` | `:where(sel) &` |
| `has-[sel]` | `&:has(sel)` |
| `not-hover` | `:not(:hover)` |
| `not-[sel]` | `:not(sel)` |
| `nth-[2n+1]` | `:nth-child(2n+1)` |
| `nth-last-[...]` | `:nth-last-child(...)` |
| `nth-of-type-[...]` | `:nth-of-type(...)` |
| `nth-last-of-type-[...]` | `:nth-last-of-type(...)` |
| `supports-[cond]` | `@supports (cond)` |

Notes:

- The bracket content of `data-[...]` comes after `data-`. Write `data-[state=open]`, not `data-[data-state=open]`.
- `group-` and `peer-` accept the pseudo-class names from the table above, or a `[...]` selector.
- Named groups are not supported. `group-hover/sidebar` does not parse as a variant. The class is dropped silently as an unknown utility.
- `nth-[...]` accepts `odd`, `even`, or an `An+B` expression. The `of <selector>` form is not supported.

### Arbitrary variants

Wrap a selector or an at-rule in `[...]`:

- `[&_p]` — `&` becomes the element selector, `_` becomes a space. Result: `& p`.
- `[>div]`, `[+svg]`, `[~span]` — relative combinators.
- `[p]`, `[.active]` — self match, emitted as `:is(p)`.
- `[@media(width>=600px)]` — an at-rule wrapper. Only `@media`, `@supports`, `@container`, and `@layer` are allowed.

The limit is 500 characters. Content with `{`, `}`, `;`, or unbalanced parentheses rejects the class.

## Variant order

Variants apply left to right:

- Selector parts concatenate in written order. `hover:before:flex` emits `:hover::before`. Put pseudo-elements last.
- At-rules nest with the leftmost variant outside. `sm:dark:flex` puts the `sm` media query around the `dark` media query.

One unknown variant drops the whole class and warns with `[RI-1004]`. The other classes are not affected.

## Arbitrary values

Put any CSS value in brackets: `w-[37rem]`, `bg-[#1a73e8]`, `w-[calc(100%-2rem)]`.

- An underscore becomes a space. `\_` stays a literal underscore. A real space is never legal: `bg-[url('a b')]` splits into two tokens and matches nothing, so the scanner drops it and warns with `[RI-1412]`. Write `bg-[url('a_b')]`.
- Math operators inside `calc()` and its family get spaces back: `w-[calc(100%-2rem)]` emits `calc(100% - 2rem)`.
- The limit is 500 characters. An empty `[]` rejects the class.
- Unsafe content is stripped for injection defense: `;`, `{`, `}`, `expression(`, at-rule keywords, and script URLs. If nothing safe remains, the class is dropped.

A type hint steers ambiguous values: `border-[length:1rem]` forces the width path, `border-[color:var(--x)]` forces the color path. Valid hints: `length`, `color`, `url`, `image`, `number`, `percentage`, `angle`, `time`, `position`, `family-name`, `line-width`, `any`.

## Arbitrary properties

Set any property directly: `[color:red]`, `[--my-var:value]`, `[-webkit-box-decoration-break:clone]`.

A value with `;`, `{`, or `}` rejects the whole class. Variants and `!` compose with this form: `hover:[--ring-color:red]!`.

## CSS-variable shorthand

`bg-(--brand-color)` emits `background-color: var(--brand-color)`.

- Fallback: `bg-(--x,red)` emits `var(--x,red)`.
- Type hint: `bg-(color:--my-color)`.

## Negative values

A leading `-` negates the value: `-mt-4` emits `margin-block-start: calc(4 * var(--spacing) * -1)`. Padding, gap, and scroll padding reject negatives and emit nothing.

## Important

A trailing `!` adds `!important` to every declaration: `p-4!`. The `!` goes after the modifier: `hover:bg-brand-500/50!`. A leading `!` is not valid syntax and produces no rule.

## Alpha modifiers

On a color utility, `/value` sets the alpha:

```html
<div class="bg-brand-500/50 text-ink/[0.55] border-brand-200/(--o)"></div>
```

- `bg-brand-500/50` emits `color-mix(in oklab, var(--color-brand-500) 50%, transparent)`.
- A bracket number of 1 or less is a fraction: `/[0.5]` is 50%. A larger number is a percentage.
- Values clamp to the range 0 to 100. An alpha of 100 emits the plain color.
- Named alpha tokens come from the `@opacity` directive. The default theme has none.
- An invalid modifier is ignored. The color renders without alpha.

## Variant groups

When several utilities share one variant prefix, group them with `{...}`:

```html
<!-- These two lines are equal -->
<div class="hover:text-brand-500 hover:bg-brand-100 hover:underline"></div>
<div class="hover:{text-brand-500 bg-brand-100 underline}"></div>
```

Chained prefixes work: `sm:hover:{bg-theme-700 text-white}` expands to `sm:hover:bg-theme-700 sm:hover:text-white`.

Expansion happens at scan time. The compiler and the browser never see the braces.

Rules and limits:

- A group prefix accepts only letters, digits, `_`, `@`, and `-` in each segment. `hover:`, `dark:`, `@md:`, and `sm:hover:` work.
- Bracketed variants cannot prefix a group. `data-[state=open]:{...}`, `aria-[...]:{...}`, `[&_p]:{...}`, `*:{...}`, and `**:{...}` do not expand. Write those classes without a group.
- Braces do not nest. `sm:{hover:{a b} c}` does not expand the inner group. Chain the prefixes instead.
- Input limit 500,000 characters (`[RI-1407]`). Output limit 100,000 characters (`[RI-1408]`). Brace depth limit 10 (`[RI-1409]`).

## Error behavior

A bad class never stops the compile:

- An unknown utility is dropped without a warning.
- An unknown variant drops the class with warning `[RI-1004]`.
- An arbitrary value that cannot resolve drops the class with warning `[RI-1002]`. The warning is suppressed for bracket content that looks like JavaScript.

## Diagnostic codes on this page

| Code | Meaning |
| --- | --- |
| `RI-1002` | An arbitrary utility did not resolve. |
| `RI-1004` | Unknown variant. The class was dropped. |
| `RI-1407` | Variant-group input above 500,000 characters. |
| `RI-1408` | Variant-group output above 100,000 characters. |
| `RI-1409` | Variant-group brace depth above 10. |
| `RI-1412` | Whitespace inside an arbitrary value. The class was dropped. |

The full table is in [diagnostics.md](diagnostics.md).
