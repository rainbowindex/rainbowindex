# Utility Reference

This page lists every utility family by category. For variants, arbitrary values, alpha modifiers, and the `!` suffix, see [class-syntax.md](class-syntax.md).

Two rules apply everywhere:

1. **Directional utilities emit CSS logical properties.** `pl-4` emits `padding-inline-start`. `border-t` emits `border-block-start-width`. `top-0` emits `inset-block-start`. Add the `-physical-` infix for physical properties: `pl-physical-4` emits `padding-left`.
2. **Numeric spacing values multiply the spacing base.** `p-4` emits `calc(4 * var(--spacing))`. The default base is `0.25rem`. Decimals accept `.` or `_`: `p-1.5` and `p-1_5` are equal. `px` means `1px`.

Rainbow Index ships no named scale. Radii, shadows, text sizes, leading, tracking, breakpoints, weights, easing, blur, and animations are all empty until a directive names them — see [theming.md](theming.md). A class below that reads a named token resolves to nothing until you define it; the keyword and arbitrary forms always work.

## Spacing

| Family | Roots | Values |
| --- | --- | --- |
| Padding | `p`, `px`, `py`, `pt`, `pb`, `pl`, `pr`, `ps`, `pe`, `pbs`, `pbe` | Spacing scale, `px`, `0`, arbitrary, `(--var)`. No `auto`. No negatives. `p-full` emits `100%` with warning `[RI-1018]`. |
| Margin | `m`, `mx`, `my`, `mt`, `mb`, `ml`, `mr`, `ms`, `me`, `mbs`, `mbe` | Same as padding, plus `auto` and negatives. |
| Gap | `gap`, `gap-x`, `gap-y` | Spacing scale, arbitrary. No `auto`. No negatives. |
| Space between | `space-x`, `space-y`, `space-x-reverse`, `space-y-reverse` | Spacing scale, arbitrary, negatives. Applies to `& > :not(:last-child)`. |
| Inset | `inset`, `inset-x`, `inset-y`, `inset-s`, `inset-e`, `inset-bs`, `inset-be`, `top`, `bottom`, `left`, `right`, `start`, `end` | Spacing scale, `auto`, `full`, fractions such as `inset-1/2`, negatives, arbitrary. |
| Scroll margin | `scroll-m` and its directional forms | Spacing scale, `auto`, negatives, arbitrary. |
| Scroll padding | `scroll-p` and its directional forms | Spacing scale, arbitrary. No `auto`. No negatives. |
| Fluid spacing | Any padding, margin, gap, or inset root plus `-fluid-`: `p-fluid-4`, `gap-fluid-4` | A `clamp()` ramp across the `@fluid` viewport range. See [theming.md](theming.md). |
| Fluid spacing pair | `p-fluid-4/8`, `gap-fluid-0/6`, `p-fluid-[0.5rem]/(--x)` | Both endpoints stated: from the first to the second across the range. A descending pair shrinks as the viewport grows. Steps, arbitrary lengths, and `(--var)` mix. |
| Fluid range scope | `fluid-{name}` | Points every fluid utility on the element and its descendants at the named `@fluid` range. |

## Sizing

| Family | Roots | Values |
| --- | --- | --- |
| Width and height | `w-`, `h-`, `size-` | Spacing scale, fractions up to `11/12`, `auto`, `full`, `screen`, `svw`, `lvw`, `dvw`, `svh`, `lvh`, `dvh`, `min`, `max`, `fit`, arbitrary. `h-screen` emits `100vh`. `h-lh` emits `1lh`. |
| Logical sizing | `inline-`, `block-` | `inline-` takes the values of `w-`. `block-` takes the values of `h-`: `block-screen` emits `100vh`, and `block-lh` emits `1lh`. Bare `inline` and `block` stay display utilities. |
| Constraints | `min-w-`, `max-w-`, `min-h-`, `max-h-`, `min-inline-`, `max-inline-`, `min-block-`, `max-block-` | `max-w` adds the container ladder `xs` to `7xl` (20rem to 80rem) and `prose` (65ch). |

## Typography

No type scale ships. `text-{size}`, `leading-{name}`, and `tracking-{name}` resolve only for tokens that `@text`, `@leading`, and `@tracking` define. Every value form below still works without them.

| Family | Form | Values |
| --- | --- | --- |
| Font size | `text-{size}` | `@text` tokens. Each size also sets the line height. `text-[18px]` takes any value. |
| Line-height modifier | `text-lg/7`, `text-lg/[1.5]`, `text-lg/(--lh)` | The `leading-*` values except `px`: `@leading` tokens, arbitrary, `(--var)`. |
| Fluid type | `text-fluid-{size}` | A `clamp()` from one step below up to the size. Display sizes from `4xl` up interpolate from two steps below. |
| Fluid type pair | `text-fluid-sm/3xl` | Both sizes stated: from the first to the second across the `@fluid` range. The last size sets the line height. A trailing segment that is not a size is the line-height modifier: `text-fluid-lg/7`, `text-fluid-sm/3xl/tight`. |
| Font family | `font-{name}` | `sans`, `serif`, `mono`, plus `@font` slots. For an arbitrary family, use a quote, a comma list, or a hint: `font-["Open_Sans"]`, `font-[Open_Sans,sans-serif]`, `font-[family-name:Open_Sans]`. A bare `font-[Open_Sans]` goes to the weight path and emits an invalid weight. |
| Font weight | `font-{weight}` | Names from `@weight`, or a number from 1 to 1000: `font-500`, `font-617`. A number that no loaded font provides warns with `[RI-1504]`, and so does one that the family in the same `@apply` list lacks. `font-[850]` also works. |
| Font features | `font-features-[...]` | `font-feature-settings`. |
| Font stretch | `font-stretch-{value}` | Nine keywords, a number, a percentage, or arbitrary. |
| Leading | `leading-{value}` | `@leading` tokens, `px`, arbitrary. |
| Tracking | `tracking-{value}` | `@tracking` tokens, arbitrary. |
| Alignment | `text-left`, `text-center`, `text-right`, `text-justify`, `text-start`, `text-end` | Static. |
| Wrap | `text-wrap`, `text-nowrap`, `text-balance`, `text-pretty` | Static. |
| Transform | `uppercase`, `lowercase`, `capitalize`, `normal-case` | Static. |
| Overflow | `truncate`, `text-clip`, `text-ellipsis`, `line-clamp-{n|none|[v]}` | Static and numeric. |
| Decoration | `underline`, `overline`, `line-through`, `no-underline`, `decoration-{style}`, `decoration-{n}`, `decoration-{color}`, `underline-offset-{value}` | Numbers set the thickness. Colors set `text-decoration-color`. |
| Whitespace and breaks | `whitespace-*`, `break-*`, `wrap-*`, `hyphens-*` | Static sets. |
| Numeric figures | `tabular-nums`, `lining-nums`, `oldstyle-nums`, `ordinal`, `slashed-zero`, `proportional-nums`, `diagonal-fractions`, `stacked-fractions`, `normal-nums` | Composable. |
| Other | `italic`, `not-italic`, `antialiased`, `subpixel-antialiased`, `align-*`, `list-*`, `indent-{n}`, `tab-{n}`, `content-none`, `content-['...']` | — |

## Color

| Family | Roots | Notes |
| --- | --- | --- |
| Color setters | `text-`, `bg-`, `border-` (with logical sides), `outline-`, `accent-`, `caret-`, `fill-`, `stroke-`, `decoration-`, `divide-` | Values: theme colors, stops such as `brand-500`, `transparent`, `current`, `inherit`, `black`, `white`, arbitrary, `(--var)`. All accept an alpha modifier. |
| Gradients | `bg-linear-to-{dir}`, `bg-linear-{angle}`, `bg-conic-*`, `bg-radial-*` | An interpolation modifier follows a slash: `bg-linear-to-r/oklch`. |
| Gradient stops | `from-`, `via-`, `to-` | A color, a position such as `from-50%`, or arbitrary. `via-none` returns to two stops. |
| Background keywords | `bg-cover`, `bg-contain`, `bg-auto`, positions, repeats, `bg-fixed`, `bg-local`, `bg-scroll`, `bg-clip-*`, `bg-origin-*`, `bg-blend-*`, `bg-none` | A theme color with the same name wins over the keyword. |
| Background images | `bg-[url(...)]`, `bg-(image:--v)`, `bg-position-[v]`, `bg-size-[v]` | — |

Color stops such as `brand-500` exist only for generative colors and their aliases. An explicit color has no stops. See [theming.md](theming.md).

## Layout

- Display: `block`, `inline-block`, `inline`, `flex`, `inline-flex`, `grid`, `inline-grid`, `contents`, `hidden`, `table` and the `table-*` set, `flow-root`, `list-item`.
- Position: `static`, `relative`, `absolute`, `fixed`, `sticky`.
- Flex: `flex-row`, `flex-col` and reverses, wrap control, `flex-auto`, `flex-initial`, `flex-none`, `flex-{n}`, `flex-{n/m}`, `grow-*`, `shrink-*`, `basis-*`. `basis-*` and `flex-*` compute any fraction.
- Grid: `grid-cols-{n|none|subgrid|[v]}`, `grid-rows-*`, `grid-flow-*`, `col-span-*`, `col-start-*`, `col-end-*`, `col-{n}`, the same for rows, `auto-cols-*`, `auto-rows-*`.
- Alignment: `items-*`, `justify-*`, `justify-items-*`, `justify-self-*`, `content-*`, `self-*`, `place-*`, plus `-safe` forms such as `items-center-safe`.
- Order: `order-{first|last|none|n|[v]}`, negatable.
- Overflow and visibility: `overflow-*`, `overscroll-*`, `visible`, `invisible`, `collapse`.
- Stacking: `z-{n|auto|[v]}`. There is no default z scale. Numbers emit as written. Named tokens come from `@z`.
- Shape: `aspect-{auto|square|video|16/9|[v]}`, `columns-*`, `object-*` with corner names such as `object-top-left`.
- Interactivity: `cursor-*`, `pointer-events-*`, `select-*`, `touch-*`, `resize-*`, `appearance-*`, `field-sizing-*`, `scheme-*`, `forced-color-adjust-*`.
- Scroll: `scroll-auto`, `scroll-smooth`, the snap set, `scrollbar-{auto|thin|none}`, `scrollbar-gutter-*`, and the composable pair `scrollbar-thumb-{color}` and `scrollbar-track-{color}`.
- Tables: `border-collapse`, `border-separate`, `table-auto`, `table-fixed`, `caption-*`, `border-spacing-*`.
- Fragmentation: `break-before-*`, `break-after-*`, `break-inside-*`.
- Screen readers: `sr-only`, `not-sr-only`.
- Containment: `contain-*`, `isolate`, `isolation-auto`, `box-border`, `box-content`, `box-decoration-*`, `float-*`, `clear-*` with logical `start` and `end`.
- Container queries: `@container`, `@container-normal`, `@container/{name}`.
- Anchor positioning: `@anchor/{name}` sets `anchor-name`. `@anchor-to/{name}` sets `position-anchor`. `position-area-*` and `anchor-scope-*` complete the set.

## Borders

| Family | Values |
| --- | --- |
| Width | `border`, `border-{0|2|4|8|n|[v]}`, sides `border-{t|b|l|r|s|e|bs|be|x|y}`. A bare side is 1px. Sides emit logical properties. |
| Style | `border-{solid|dashed|dotted|double|hidden|none}`. |
| Radius | `rounded-{n}` (`calc(var(--spacing) * n * var(--ri-rounded-scale, 1))`), `rounded-none`, `rounded-full`, arbitrary. Sides and corners take logical names: `rounded-t-4`, `rounded-ss-2`. There is no named scale and no bare `rounded` — a radius always states its value. |
| Radius scale | `rounded-scale-{n|none|[v]}` sets `--ri-rounded-scale` on the element. |
| Corner shape | `corner-{round|scoop|bevel|notch|square|squircle}`, `corner-[superellipse(2)]`. |
| Dividers | `divide-x`, `divide-y` with widths, `divide-{style}`, `divide-{color}`, reverse forms. Applies to `& > :not(:last-child)`. |
| Outline | `outline`, `outline-{n}`, styles, `outline-none` (style none), `outline-hidden` (invisible 2px outline for forced-color modes), `outline-offset-{n}`, `outline-{color}`. |

## Effects

**Shadows and rings** compose. Each family writes its own slot variable, and one `box-shadow` combines them. A ring does not erase a shadow.

No shadow scale ships. `shadow-none`, `shadow-{color}`, and `shadow-[v]` always work; a named size such as `shadow-md` works only after `@shadow md: …;` defines it.

- `shadow-none`, `shadow-{color}`, `shadow-[v]`, plus `shadow` and `shadow-{name}` for your own `@shadow` tokens (bare `shadow` reads the `DEFAULT` token).
- `inset-shadow-none`, `inset-shadow-{color}`, `inset-shadow-[v]`.
- `ring` (1px), `ring-{n}`, `ring-{color}`, `inset-ring-*`. The default ring color is `currentColor`.
- `text-shadow-none`, `text-shadow-{color}`, `text-shadow-[v]`.

**Filters** compose the same way:

- `blur-{none|[v]}`, plus names from `@blur`. Bare `blur` reads the `DEFAULT` token.
- `brightness-*`, `contrast-*`, `saturate-*`, `grayscale`, `invert`, `sepia`, `hue-rotate-*`, `drop-shadow-{none|color|[v]}`, `filter-none`, `filter-[v]`.
- The full `backdrop-*` mirror set, plus `backdrop-opacity-*`.

**Transitions**: `transition`, `transition-{all|colors|opacity|shadow|transform|none|[v]}`, `transition-{normal|discrete}`. `duration-{n}` and `delay-{n}` set both the transition and the animation timing. `ease-{linear|[v]}`, plus names from `@ease`. `opacity-{n}` emits a percentage: `opacity-50` emits `opacity: 50%`.

**Transforms** emit the modern individual properties:

- `translate-*`, `translate-x/y/z-*`, negatable.
- `rotate-{n}`, `rotate-x/y/z-*`, `rotate-none`.
- `scale-{n}`, `scale-x/y/z-*`, `scale-3d`, `scale-none`.
- `skew-{n}`, `skew-x/y-{n}`.
- `transform-{none|gpu|cpu|flat|3d|content|border|fill|stroke|view}`, `origin-*`, `perspective-*`, `perspective-origin-*`.
- `zoom-{n|[v]}` emits the CSS `zoom` property.

**Masks**: the composable `mask-*` system — composite, clip, mode, origin, position, repeat, size, and type statics, gradient families `mask-linear-*`, `mask-conic-*`, `mask-radial-*`, edge fades `mask-{t|r|b|l}-from/to-*`, axis fades `mask-x/y-from/to-*`, and `mask-none`.

**Blend**: `mix-blend-{mode}` with 18 modes.

## Animations

- `animate-none` and `animate-[v]`, plus names from `@animate`.
- Enter and exit: `animate-in`, `animate-out`, with `fade-in-{n}`, `fade-out-{n}`, `zoom-in-{n}`, `zoom-out-{n}`, `spin-in-{n}`, `spin-out-{n}`, `blur-in-{n}`, `blur-out-{n}`, `slide-in-from-{top|bottom|left|right}-{n}`, `slide-out-to-*`.
- Timing: `animate-duration-{n}`, `animate-delay-{n}`, `animate-ease-{token}`, `animate-{infinite|once|twice}`, `animate-fill-*`, direction statics, `animate-{running|paused}`.

```html
<div class="animate-in fade-in-50 zoom-in-95 slide-in-from-top-4 animate-duration-300"></div>
```

## SVG

- `fill-{color|none}`, `stroke-{color|none}`, `stroke-{n}` for the width. Decimals work: `stroke-1.5`.
- `stroke-cap-{butt|round|square}`, `stroke-join-{arcs|bevel|miter|miter-clip|round}`.
- `stroke-dash-{none|dotted|dashed|long|dense|loose|dot-dash|[v]}`, `stroke-offset-{n}`, `stroke-miter-{n}`.
- `stroke-opacity-{0..100|[v]}`. `stroke-opacity-50` emits `0.5`.
- `paint-{normal|stroke|fill|markers}` and the combined `paint-order` forms.
- `vector-{none|non-scaling-stroke|non-scaling-size|non-rotation|fixed-position}`.

## Resolution order

A prefix that two categories claim resolves in a fixed order. `text-` probes typography before color. `bg-` probes color before keywords. Bare `inline` and `block` belong to display. When no generator matches, custom `@utility` definitions are the last step.

An invalid class emits no CSS and no error. Use `rainbowindex scan` or the editor API to inspect a class. See [cli.md](cli.md) and [editor-api.md](editor-api.md).

## Diagnostic codes on this page

| Code | Meaning |
| --- | --- |
| `RI-1018` | `full` was used with a spacing-scale utility: padding, margin, gap, space, inset, or scroll margin and padding. It resolves to `100%`. |
| `RI-1501` | `text-fluid-*` needs a rem-based font size. |
| `RI-1502` | `text-fluid-*` has no smaller size to interpolate from. |
| `RI-1503` | `fluid-<name>` has no `@fluid` range of that name. |

The full table is in [diagnostics.md](diagnostics.md).
