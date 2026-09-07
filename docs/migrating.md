# Migrating from Tailwind

```bash
pnpm add -D rainbowindex
pnpm rainbowindex migrate tailwind "src/**/*.{ts,tsx}"
```

Nothing is overwritten. The translated entry is written beside the original as
`<name>.rainbowindex.css`, and `migration-report.md` says what came across, what
did not, and which of your classes stop resolving. Read both, then re-run with
`--write` to apply.

## What it does

Tailwind v4 puts its theme in CSS and so does Rainbow Index, which makes most of
the translation a rename:

| Tailwind | Rainbow Index |
| --- | --- |
| `--color-brand-500` | `@color { brand-500: … }` |
| `--font-display` | `@font { display: … }` |
| `--font-weight-bold` | `@weight { bold: … }` |
| `--text-lg` + `--text-lg--line-height` | `@text { lg: <size>, <leading>; }` |
| `--tracking-tight`, `--leading-snug` | `@tracking`, `@leading` |
| `--breakpoint-tablet` | `@breakpoint { tablet: … }` |
| `--radius-card` | `@rounded { card: … }` |
| `--shadow-card`, `--blur-soft`, `--ease-snap` | `@shadow`, `@blur`, `@ease` |
| `--animate-shimmer` + its `@keyframes` | `@animate { shimmer: <shorthand> { … } }` |
| `--spacing` | `@spacing { base: … }` |
| a bare `--shadow`, `--radius`, `--blur` | the scale's `DEFAULT` |
| `@custom-variant name (…)` | `@custom name (…)` |
| `@utility`, `@source` | unchanged |

It also adds `@import "rainbowindex/tailwind.css"` — the
[Tailwind-default preset](getting-started.md) — so every class name you already
write keeps resolving. Drop that line later and the theme is exactly your own
directives.

### Dark mode

`@custom-variant dark (&:where(.dark, .dark *))` becomes
`@color dark { variant: selector(.dark); }`. Both `dark:` utilities *and* your
colour tokens then follow the `.dark` class, which is what the Tailwind project
had. A `prefers-color-scheme` dark variant is already the default here, so
nothing is added for it. See [theming.md](theming.md).

## What it does not do

Everything below is reported in `migration-report.md`, with what to do instead —
never dropped quietly.

- **Plugins.** `@plugin "@tailwindcss/typography"` has no equivalent. Reimplement
  what it added with `@utility` and `@custom`.
- **A v3 JavaScript config.** `tailwind.config.js` is not read. If your theme
  still lives there, move it into the CSS entry first — Tailwind v4 can read
  both, so do that migration under Tailwind before this one.
- **Namespaces with no counterpart.** `--container-*` (the ladder is built in),
  `--inset-shadow-*`, `--drop-shadow-*`, `--text-shadow-*` (define an
  `@utility` per name), `--perspective-*`, `--aspect-*`, `--max-width-*` (use an
  arbitrary value).
- **`@variant`** applied to a rule body. Write the variant on the class instead.

## The class check

Pass globs and every class you wrote is validated against the migrated theme:

```
1 of 16 classes in your source do not resolve. Grouped by why:

### unknown-utility (1)

- `prose-lg`
```

Only classes in a real class position are checked — a `class`/`className`
attribute, a class helper, a `cva`/`tv`/`recipe` config — so a word in a
paragraph is never reported as a broken utility.

If `rainbowindex/tailwind.css` cannot be resolved (the package is not installed
yet), the check is skipped and the report says so, rather than reporting every
class from Tailwind's own scales as unresolved.

## Differences to expect

These are design choices, not migration defects:

- **Directional utilities emit logical properties.** `pl-4` is
  `padding-inline-start`, not `padding-left`. Identical in LTR, mirrored in RTL.
  This is the one difference that can change rendering, and only in an RTL
  document.
- **`opacity-50` emits `50%`** where Tailwind emits `0.5`. Same rendering.
- **Colour tokens are one `light-dark()` declaration**, not a `:root` block plus
  a `.dark` block.
- **Nothing ships unnamed.** The preset restores Tailwind's scales; without it,
  only what you declare exists.

Rainbow Index compiles [100% of Tailwind v4's class
surface](https://github.com/rainbowindex/rainbowindex#tailwind-class-coverage) —
all 23,289 names, measured rather than claimed. What differs is how some of them
compile, listed above, not whether they compile.

## After

```bash
rainbowindex migrate tailwind "src/**/*.{ts,tsx}" --write
pnpm remove tailwindcss @tailwindcss/vite
```

Then swap the plugin in `vite.config.ts` — see
[frameworks.md](frameworks.md) — and run
[`rainbowindex init`](cli.md) if you would rather it did that for you.
