# Theming

You customize Rainbow Index in your CSS input, not in a JavaScript configuration. Directives are at-rules that start with `@`. The engine reads them, merges them onto the default theme, and removes them from the output.

A CSS file activates Rainbow Index when it contains a directive or an import of `"rainbowindex"` or `"rainbowindex/index.css"`. The shipped `rainbowindex/index.css` contains only `@preflight;`.

Facts that apply to all directives:

- Later directives win over earlier ones. Removals apply before overrides inside one directive.
- `!key;` inside a scale body removes a token.
- A directive nested inside `@media` or `@supports` still applies globally and warns with `[RI-1036]`.
- Standard CSS at-rules pass through untouched: `@font-face`, `@keyframes`, `@property`, `@import` of other files, `@media`, `@supports`, `@container`, `@page`, and more.
- The CSS input limit is 5 MB.

## Directive list

| Directive | Purpose |
| --- | --- |
| `@color` | Color tokens and dark-mode configuration. |
| `@text` | Text size tokens. |
| `@spacing` | The spacing base unit. |
| `@breakpoint` | Breakpoint tokens. |
| `@rounded` | Corner shape. |
| `@shadow` | Shadow tokens. |
| `@weight` | Font weight tokens. |
| `@ease` | Easing tokens. |
| `@blur` | Blur tokens. |
| `@z` | Named z-index tokens. |
| `@leading` | Line-height tokens. |
| `@tracking` | Letter-spacing tokens. |
| `@opacity` | Named alpha tokens. |
| `@duration` | Named duration tokens. |
| `@animate` | Named animations with keyframes. |
| `@fluid` | Fluid type and spacing ranges. |
| `@font` | Font slots. See [fonts.md](fonts.md). |
| `@preflight` | Base style control. |
| `@utility` | Custom utilities. |
| `@custom` | Custom variants. `@slot` marks the insertion point. |
| `@source` | Scan globs. See [source-scanning.md](source-scanning.md). |
| `@layer` | Cascade-layer placement of the output. |
| `@register` | CSS `@property` registration. |
| `@apply` / `@a` | Utility composition inside a rule. See [postcss-plugin.md](postcss-plugin.md). |

## `@color`

Each entry has a name and a value. Entries end with `;` or a newline. The limit is 500 entries per block.

```css
@color {
	brand: 0.18 330;                                       /* generative: chroma hue */
	surface: oklch(0.98 0.01 260) / oklch(0.15 0.01 260);  /* light/dark pair */
	accent: brand;                                          /* alias */
	border: theme-282/52;                                   /* stop reference with alpha */
	clear: transparent;                                     /* keyword */
	!theme;                                                 /* remove the default neutral */
}
```

Value forms:

| Form | Meaning |
| --- | --- |
| `<chroma> <hue>` | A generative palette with stops 1 to 999. Chroma clamps to 0 to 0.4. |
| `oklch(...)`, `#rrggbb`, `rgb(...)`, and other color functions | One explicit value. |
| `light / dark` with a spaced slash | A light and dark pair. `light-dark(a, b)` is equal. |
| `transparent`, `currentColor`, `inherit` | A keyword. Inlined, no variable. |
| `<name>-<stop>` | A reference to a stop of another color. |
| `<name>-<stop>/<alpha>` | The same, with alpha. |
| `<name>` | An alias to another color. |

A generative color gives you class stops: `bg-brand-500`, `text-brand-276`, any integer 1 to 999. An explicit color, a pair, or a keyword has no stops. Reference those bare: `bg-surface`.

**The default palette has one color: `theme`, a neutral gray.** Palette names such as `blue` or `red` do not exist until you declare them. The special names `transparent`, `current`, `inherit`, `black`, `white`, `paper`, and `ink` always work.

Options block on a generative entry:

```css
@color {
	punchy: 0.18 330 { inline; dark: shift chroma +0.02 hue +10; };
}
```

| Option | Effect |
| --- | --- |
| `dark: mirror` | Mirrored-luminance dark stops. This is the default. |
| `dark: fixed` | The same value in light and dark. |
| `dark: shift chroma <n> hue <n>` | Mirror plus per-color deltas. |
| `inline` | The palette joins `[data-theme="<name>"]` override blocks. |
| `parabolic` / `no-parabolic` | Chroma bell across the ramp on or off. |

Global dark configuration:

```css
@color dark { mode: auto; chroma-boost: 0.015; hue-shift: -4; }
```

| Key | Effect | Default |
| --- | --- | --- |
| `mode` | `auto` or `off`. | `auto` |
| `chroma-boost` | Added to the chroma of every dark stop. `0` keeps the light chroma. | `0` |
| `hue-shift` | Added to the hue of every dark stop. | `0` |

`mode: off` emits the `@color` tokens with their light values only. The built-in `paper` and `ink` tokens and the default shadow tokens keep `light-dark()` and still adapt to dark mode.

If a used stop has less than 60 APCA contrast against both white and black, the compile warns with `[RI-1106]`. Text in that color is not readable on either pole.

## How dark mode works

- Every color token is emitted once, in `:root`, as `light-dark(lightValue, darkValue)`. There is no `.dark` class and no duplicated dark block.
- The preflight sets `html { color-scheme: light dark; }`, so the browser follows the OS. `html[data-appearance="dark"]` and `html[data-appearance="light"]` force one side.
- The `dark:` variant compiles to `@media (prefers-color-scheme: dark)`. CAUTION: `data-appearance="dark"` flips the `light-dark()` tokens, but it does not activate `dark:` utilities while the OS is in light mode.
- A color with the `inline` option gets `[data-theme="<name>"]` blocks that remap the `theme` palette. Set `<html data-theme="brand">` to swap palettes.

## `@text`

```css
@text {
	display: 4rem, 1.05;
	body: 1rem, 1.5;
}
```

The form is `name: <font-size>[, <line-height>];`. The line height defaults to `1.5`. The default scale has 14 sizes, `2xs` to `9xl`. The middle size is `md`, not `base`.

## `@spacing`

```css
@spacing { base: 0.5rem; }
```

The only key is `base`. The default is `0.25rem`. The value must match `<number><rem|em|px|%>`. An invalid value warns with `[RI-1020]` but is still used.

## Scale directives

`@breakpoint`, `@shadow`, `@ease`, `@blur`, `@z`, `@leading`, `@tracking`, `@opacity`, and `@duration` all share one grammar: `key: value;` entries merge onto the defaults, and `!key;` removes a token.

```css
@breakpoint { tablet: 50rem; !xl; }
@z { modal: 100; }
```

`@z`, `@opacity`, and `@duration` have no default tokens. The numeric class forms are computed instead: `z-10` emits `10`, `opacity-50` emits `50%`, `duration-200` emits `200ms`. These directives add named tokens.

`@weight` values parse as integers. A value that does not start with a number warns with `[RI-1021]` and is skipped. A decimal is truncated to its integer part without a warning.

## `@rounded`

```css
@rounded squircle {
	--corner-scale: 1.3;
}
```

The modifier sets the corner shape: `round`, `scoop`, `bevel`, `notch`, `square`, `squircle`, or `superellipse(N)`. `--corner-scale` overrides the radius compensation for the shape. Any other key in the body warns with `[RI-1122]`.

There are no radius tokens. A radius is a spacing multiple: `rounded-4` is `calc(var(--spacing) * 4 * var(--ri-rounded-scale, 1))`. To change every radius at once, change `@spacing`. To change them under one element, set `--ri-rounded-scale` with `rounded-scale-*`.

## `@animate`

```css
@animate {
	shimmer: 2s linear infinite {
		from { background-position: 200% 0; }
		to { background-position: -200% 0; }
	}
}
```

The form is `name: <animation-shorthand> { <keyframes> }`. The name becomes `animate-shimmer`, and the keyframes are emitted when the class is used. An entry without a keyframes block is dropped without a warning.

## `@fluid`

```css
@fluid { min: 20rem; max: 80rem; }
@fluid text { unit: vw; }
@fluid spacing { multiplier: 2.5; }
```

| Key | Constraint | Default |
| --- | --- | --- |
| `min` | rem value | `20rem` |
| `max` | rem value, more than `min` | `80rem` |
| `unit` | `vw`, `vi`, `vmin`, `vmax` | text: `vi`, spacing: `vw` |
| `multiplier` | number more than 1, not valid for `text` | `2` |

`text-fluid-*` and `*-fluid-*` utilities read this range. See [utilities.md](utilities.md).

## `@preflight`

| Form | Effect |
| --- | --- |
| `@preflight;` | All six categories on. |
| `@preflight off;` | All off. |
| `@preflight { forms: off; }` | Selective. Merges with earlier `@preflight` bodies. |

The categories: `core` (box model and resets), `typography`, `content` (media and lists), `forms`, `interactive` (focus and dialog), and `modern` (the color-scheme wiring and modern properties). The shipped `rainbowindex/index.css` already contains `@preflight;`.

## `@utility`

```css
@utility card {
	@apply rounded-4 shadow-md;
	background: white;
	&:hover { background: whitesmoke; }
}
@utility {
	flex-center { display: flex; align-items: center; }
}
@utility tab-size-* { tab-size: var(--value); }
```

- The functional form `@utility name-*` reads its value from the class suffix. The build replaces each `var(--value)` in the body, nested blocks included: `tab-size-4` emits `tab-size: 4`. Bracket suffixes carry arbitrary values (`tab-size-[2ch]`, underscores decode to spaces). The longest defined name wins, an exact static name beats a functional match, and negative classes (`-tab-size-4`) do not match.
- Bodies accept declarations, `@apply`, nested selectors, and nested at-rules.
- The body limit is 10,000 characters.
- A name equal to a built-in static utility is dead and warns with `[RI-1032]`. The built-in wins.
- An uppercase name warns with `[RI-1038]`. The scanner only matches lowercase classes in markup.

## `@custom` and `@slot`

```css
@custom hocus (&:hover, &:focus);

@custom any-hover {
	@media (any-hover: hover) { @slot; }
}
```

The inline form takes a selector list. The block form puts the utility rule where `@slot;` stands. The name must start with a lowercase letter. The selector limit is 2,000 characters. `@slot` outside a `@custom` block warns with `[RI-1037]` and is removed.

Use the variant like any other: `hocus:underline`.

## `@source`

```css
@source "emails/**/*.html";
@source not "src/**/legacy/*";
@source inline("underline text-brand-500");
```

Patterns must stay inside the working directory. A `..` segment is rejected.

See [source-scanning.md](source-scanning.md) for the full rules.

## `@layer`

```css
@layer utilities;                /* wrap all output in one layer */
@layer {
	order: base, components, utilities;
	utilities: utilities;
	base: base;
}
```

The simple form wraps all generated output in one cascade layer. The body form declares the layer order and places the utility and base sections. The last `@layer` directive wins. This directive is intercepted, so it is not the standard CSS `@layer` pass-through.

## `@register`

```css
@register --glow, --lift {
	syntax: "<length>";
	inherits: false;
	initial-value: 0px;
}
```

Emits CSS `@property` rules. Defaults: `syntax: "*"`, `inherits: false`. A typed syntax without `initial-value` is dropped with warning `[RI-1029]`, because browsers ignore such a registration. A name must start with `--`.

## Default theme reference

| Scale | Default tokens |
| --- | --- |
| Colors | `theme` only, a generative neutral. Plus the fixed names `black`, `white`, `paper`, `ink`, `transparent`, `current`, `inherit`. |
| Text | `2xs` 0.625rem to `9xl` 8.5rem, 14 sizes, middle size `md` at 1rem/1.5. |
| Spacing | `base: 0.25rem`. |
| Breakpoints | `sm` 40rem, `md` 48rem, `lg` 64rem, `xl` 80rem. No `2xl`. |
| Rounded | No tokens. A radius is a spacing multiple: `rounded-4`. Plus `none` and `full`. |
| Shadows | `px`, `2xs`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `none`. Layered and light-dark adaptive. |
| Weights | `thin` 100 to `black` 900. |
| Easing | `in`, `out`, `in-out`, `linear`. |
| Blur | `xs` 2px to `3xl` 64px, bare `blur` 8px. |
| Leading | `3` to `10`, plus `none`, `tight`, `snug`, `normal`, `relaxed`, `loose`. |
| Tracking | `tighter` to `widest`. |
| Animations | `spin`, `pulse`, `bounce`, `ping`, `accordion-down/up`, `collapsible-down/up`, `caret-blink`. |
| Z, opacity, duration | Empty. Numeric class forms are computed. |
| Fluid | `min: 20rem`, `max: 80rem`. |

Token emission is pruned by usage. Only the color stops, text sizes, fonts, shadows, and animations that your classes use reach `:root`.

The output order is: imports, `@property` rules, `@font-face` rules, `:root`, `[data-theme]` overrides, corner shape, keyframes, preflight, utilities.

## Limits

- CSS input: 5 MB.
- `@color`: 500 entries per block.
- `@font`: 20 slots per block.
- `@utility` body: 10,000 characters.
- `@custom` selector: 2,000 characters.
- Color stops: integers 1 to 999. For the poles, use `paper` and `ink`.

## Diagnostic codes on this page

The 10xx range covers compilation and directives. The 11xx range covers colors. The most common ones:

| Code | Meaning |
| --- | --- |
| `RI-1011` | A `//` line comment. The rest of the line is skipped. |
| `RI-1012` | A directive did not parse and was skipped. |
| `RI-1020` | Invalid `@spacing` base. |
| `RI-1032` | A custom utility name equals a built-in. |
| `RI-1036` | A directive is nested inside a standard at-rule. |
| `RI-1101` | Invalid `@color` value, or too many entries. |
| `RI-1105` | An alias points to an undefined color. |
| `RI-1106` | A used color stop has low contrast against both paper and ink. |

The full table is in [diagnostics.md](diagnostics.md).
