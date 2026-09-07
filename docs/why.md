# Why Rainbow Index?

Rainbow Index compiles a design system out of CSS. That sentence is the whole
argument, and this page is the honest version of it — including the places where
another tool is simply better and you should use that one.

Every number here was measured, not recalled. Download counts are npm's for the
week of 2026-08-23, editor-extension counts are the marketplaces', and the
performance figures come from [`bench/`](https://github.com/rainbowindex/rainbowindex/blob/main/bench/README.md), which you can run
yourself.

## The short version

Pick Rainbow Index if you want your **design tokens to live in CSS**, want the
compiler to **tell you when a token is wrong** rather than emit it anyway, and
are willing to trade rebuild speed and ecosystem size for that.

Pick something else if you need a large plugin ecosystem, a mature editor
extension today, or type-checked style props. Those are real, and Rainbow Index
does not have them.

## The comparison

| | Rainbow Index | Tailwind CSS v4 | UnoCSS | Panda CSS | StyleX |
| --- | --- | --- | --- | --- | --- |
| **Tokens live in** | CSS directives | CSS (`@theme`), or a JS config via `@config` | a JS/TS config | a TS config | JS/TS `defineVars` files |
| **Typed contracts** | `generate-types` for classes, `generate-tokens` for the token tree; `--strict` closes them | hand-written `.d.ts` for its JS API; none from your tokens | none — runtime enumeration instead | `panda codegen`: ~33k lines, tokens, recipes, JSX props | TS inference over your own objects, plus style-prop contracts |
| **Generative color** | yes — one hue/chroma pair becomes a full ramp | no — 26 hand-authored ramps | no — 308 literal values | no — 22 hand-authored ramps | no palette system |
| **Contrast checking** | automatic APCA at build time | none | none | manual WCAG 2 picker in Studio | none |
| **Font-metric fallbacks** | generates `size-adjust` faces | no | no | no | no |
| **Diagnostics** | 115 numbered `RI-NNNN` codes, each documented | prose; positions on some errors; editor-side codes | ~a dozen prose strings; most failures silent | TypeScript's codes, plus one LSP diagnostic | Babel code frames, plus 9 named ESLint rules |
| **Class merging** | first-party, on class strings | none — `tailwind-merge` (82.5M/wk) is the answer | not solved first-party | merges style objects; `cx` does **not** resolve conflicts | first-party and structural, by design |
| **First-party editor extension** | **no** — an API, no extension | yes, 14.5M installs | yes, 421k installs, plus an LSP binary | yes, 5.2k installs | no (a DevTools extension instead) |
| **Weekly downloads** | new | 125.6M | 478k | 428k | 1.9M |
| **Output model** | utility classes, no runtime | utility classes, no runtime | utility classes, no runtime | atomic classes; `css()` runs in the browser | compiled-away atomic; ~850 B gzip runtime |

StyleX does not belong in a utility-class comparison and the table above bends
to fit it. It has no class vocabulary to enumerate, so "class coverage" and
"arbitrary values" have no StyleX answer — see [below](#stylex).

## Where Rainbow Index loses

### Tailwind CSS

**Speed, and it is not close.** Tailwind's scanner is a Rust crate shipped as
prebuilt binaries. On a 10,000-file codebase its unchanged rebuild is 40 ms
against Rainbow Index's 583 ms — about 15×. Cold build is 330 ms against 845 ms.
Rainbow Index's scanner is JavaScript, and there is no route to closing that gap
without rewriting it.

**Ecosystem.** 125.6M weekly downloads against a package nobody has installed
yet, nine years of accumulated answers, an official IntelliSense extension with
14.5M installs, and an automated v3→v4 upgrade codemod.

Rainbow Index compiles 100% of Tailwind v4's own class list, so the syntax you
know keeps working — but that is a migration path, not a reason to leave.

One thing to be clear about: **Tailwind v4 did not drop the JS config.**
`@config "./tailwind.config.js"` still loads a full legacy config, plugins
included. If you like configuring in JavaScript, that is not a reason to switch.

### UnoCSS

**Editor tooling.** A first-party VS Code extension since 2021 with 421k
installs, backed by a standalone language server any LSP client can run — hover
showing the generated CSS, color swatches, fuzzy completion over the live
config. It also mounts a dev-server inspector at `/__unocss` that shows exactly
which rule matched which token. Rainbow Index has an editor API and a VS Code
extension built on it, but nothing for any other editor.

**Input syntaxes with no equivalent here.** Attributify (`p="y-2 x-4"`), tagify,
and shortcuts.

**Extensibility in JavaScript.** `@unocss/core` ships zero rules — rules,
variants, extractors and transformers are all pluggable, so a preset can define
a design language with no resemblance to Tailwind's. Rainbow Index extends
through CSS (`@utility`, including functional `name-*` forms, and `@custom` for
variants), but its built-in generators are fixed and there is no plugin API.

### Panda CSS

**Typed contracts, at a scale Rainbow Index does not reach.** Both generate
types — `rainbowindex generate-types` writes closed token and variant unions
(`--strict` makes an unknown class a compile error), and `generate-tokens`
writes the token tree itself, so `tokens.color.brand[500]` completes and
`brnad` does not compile. But `panda codegen` emits around 33,000 lines:
per-recipe variant interfaces, typed JSX props, typed pattern signatures. If
your team wants the type system to be the design system's enforcement layer,
Panda is further along.

**Docs and guides.** 19 framework install guides, a token-usage analyzer, and a
Studio site that renders your theme. Rainbow Index has documentation and no site.

### StyleX

Different model, not a competitor on the same axis: styles are objects in your
TypeScript, compiled to hashed atomic classes, and the authored call disappears.

**Type-constrained style props.** A component can declare exactly which CSS
properties a caller may pass, and TypeScript enforces it. No utility-class
system can express this — a `class` string is opaque to the type system — and
Rainbow Index is no exception.

**Merging that cannot be wrong.** Because compiled styles are keyed by property
identity, the last style that sets a property wins, structurally. Rainbow
Index's `ri()` resolves conflicts well, but it is resolving a string.

**Production evidence.** Meta's launch post states StyleX styles every major
Meta product, Facebook and Instagram among them. That was 2023, and it is still
the strongest maturity claim any of these tools makes.

## Where Rainbow Index is genuinely different

Not "better" — different, and only worth it if these matter to you.

**Your tokens are CSS.** `@color { brand: 0.18 330; }` is the whole declaration,
and it generates the ramp:

```css
--color-brand-100: light-dark(oklch(0.937 0.0475 329.117), oklch(0.233 0.0475 329.117));
--color-brand-500: light-dark(oklch(0.663 0.209 329.365), oklch(0.663 0.209 329.365));
--color-brand-900: light-dark(oklch(0.233 0.0687 329.372), oklch(0.937 0.0525 329.372));
```

Perceptually even steps, a light/dark pair per stop, from two numbers. None of
the other four generate a palette; all four ship one you filter down.

**The compiler argues with you.** 115 numbered diagnostics, each with a cause
and a fix in [diagnostics.md](diagnostics.md). A color whose stop fails APCA
contrast against your own paper and ink says so at build time. A class whose
arbitrary value contains whitespace — and therefore can never match an element —
says so instead of vanishing. None of the other four have numbered codes; two of
them fail silently.

To be fair about the comparison: Tailwind's CLI does print file, line and column
for CSS parse errors, and Rainbow Index's mostly prints a line number at best.
The difference is the index, not the position.

**Fonts come with metrics.** `@font` generates a metrics-adjusted local fallback
`@font-face`, so the fallback occupies the same space as the webfont and the
layout does not shift when it loads. None of the other four do this.

**Nothing ships until you name it.** The package ships two scales. `text-lg`
does not exist until you declare it. That is a cost — you have to declare things
— and it is the point: the stylesheet is your system rather than a subset of
someone else's defaults.

## When not to use it

- You need a mature editor extension **today**. Use Tailwind or UnoCSS.
- You want the type system to enforce the design system. Use Panda or StyleX.
- Rebuild speed on a very large codebase is your binding constraint. Use
  Tailwind.
- You want a large plugin ecosystem and lots of Stack Overflow answers. Use
  Tailwind.
