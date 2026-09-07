# Benchmark harness

A reproducible comparison of **rainbowindex**, **Tailwind CSS v4** and **UnoCSS**
on the same generated codebase, so claims about speed come with a way to check
them.

```bash
pnpm bench                        # 1k and 10k trees, all three engines
pnpm bench --sizes=1k,10k,50k     # add the large tree (slow; see below)
pnpm bench --engines=rainbowindex # one engine, for a before/after
pnpm bench:cli --sizes=1k         # the shipped CLIs, end to end
```

Results land in `results/<date>.json` (machine-readable), `results/<date>.md`
(the table) and `results/latest.md`. The table is also printed to stdout.

## What is measured

| Scenario | Meaning |
| --- | --- |
| Cold build | Fresh process: read the tree off disk, construct the engine, produce the stylesheet. The fastest of N runs — noise on a cold start only ever adds. |
| Rebuild (unchanged) | An already-warm engine asked to build the same input again, the state a dev server is in when you save a file that changed nothing relevant. |
| Rebuild (1 file) | One file's classes change on **every** iteration, so no iteration but the first can be served from a candidate cache. |
| Scan only | Each engine's own public extraction path, with no CSS generated. |
| Output | The stylesheet, minified by one shared LightningCSS pass against one browser baseline, so the byte counts compare. |
| Peak RSS | `process.resourceUsage().maxRSS` for the cold-build process. |
| Coverage | The share of the classes actually present in the fixtures that the engine emitted a rule for. |

## Why it is built this way

**One process per measurement.** Every engine memoizes something at module
scope, so a cold build is only cold once per process — timing three engines in
one process measures whichever ran first. `run.mjs` spawns `measure.mjs` afresh
for each sample. Peak RSS likewise only means anything when one engine is the
sole occupant of the heap.

**A generated tree, not a curated class list.** Fixtures are seeded
(mulberry32, seed `0x5eed`) and deterministic, with a Zipf-skewed draw over a
286-utility vocabulary: a handful of utilities on nearly every element and a
long tail, which is what real markup looks like. A flat list of every utility
exactly once would understate every engine's cache hit rate. The tree is 60%
`.tsx`, 15% `.html`, 15% `.vue`, 10% `.svelte`, and the JSX includes the shapes
a scanner has to look inside: `clsx()` calls, template literals and conditional
expressions.

**Coverage is measured against ground truth, not against an engine.** The
generator records every class it wrote into `manifest.json`. An engine that
does not implement one of them shows up as coverage below 100% — not as a
smaller stylesheet that could be mistaken for efficiency. Today rainbowindex
sits just under 100% on this vocabulary, on `ring-inset`; `pnpm bench:parity
--list` names every class it misses across the whole Tailwind surface, which
the timed run's integer counts deliberately do not.

**All three see the same files.** Every entry declares the same `@source` glob,
and Tailwind is given `source(none)` so it does not walk the whole directory —
its default would otherwise have it scanning `manifest.json`, a file that
contains every class in the tree, while the other two never saw it.

**The incremental scenario has to defeat the caches.** All three engines cache
compiled candidates, so replaying the same edit would time a cache lookup. Each
iteration introduces an arbitrary value no iteration before it used.

## Sizes

| Size | Files | Source | On disk | Generation |
| --- | --- | --- | --- | --- |
| `1k` | 1,000 | 1.3 MB | ~4 MB | under a second |
| `10k` | 10,000 | 13 MB | ~39 MB | a second |
| `50k` | 50,000 | 64 MB | ~196 MB | about three seconds |

On disk is much larger than the source because 50,000 small files each round up
to a filesystem block. The engines only ever see the source bytes.

Trees are cached: a tree whose `manifest.json` already matches the seed, count
and generator version is left alone, so repeat runs measure the engines and not
the filesystem. `pnpm bench` generates what it needs. The trees are
`.gitignore`d — they are reproducible from the seed, and 50,000 generated files
do not belong in a diff.

## Parity

```bash
pnpm bench:parity              # summary, gaps grouped by family
pnpm bench:parity --list       # every missing class
pnpm bench:parity --json       # results/parity.json
pnpm bench:parity --min=100    # exit 1 if parity has dropped
```

A speed comparison between two engines that compile different sets of classes
is not a comparison. This asks Tailwind's own design system for its complete
class list — the same list its IntelliSense uses, currently 23,289 renderable
names — renders every one, and reports which Rainbow Index does not implement.

It is deliberately separate from the timed run: it takes a while, it does not
change from one machine to the next, and it answers a different question. That
machine-independence is also why `--min` is safe to fail CI on while a timing
regression is not — the weekly workflow gates on it.

Currently **100.00%** — all 23,289. `ring-offset-*` and `ring-inset` were the
last 297 outstanding and are implemented, so `--min=100` is the setting that
keeps it there: any drop is now a regression rather than a known omission.

## The CLI tier

`pnpm bench:cli` measures the three shipped command-line tools from `argv` to a
written stylesheet. This is a different measurement, not a duplicate: the
library tier hands every engine the same in-memory file list, which skips the
part each does for itself in real use — expanding a glob and reading the tree.

It uses [hyperfine](https://github.com/sharkdp/hyperfine) when it is on `PATH`,
and otherwise spawns the commands itself and reports the minimum. The results
file records which, so no one compares numbers across the two methods.

## Fairness, and where it runs out

The harness tries to be honest rather than flattering, so the caveats belong
here:

- **rainbowindex is measured with its Tailwind preset loaded**
  (`@import "rainbowindex/tailwind.css"`), which is the configuration that makes
  the three comparable. Its own native theme is smaller and emits fewer tokens;
  those numbers would not be a like-for-like comparison and are not reported.
- **UnoCSS core has no filesystem scanner.** `@unocss/cli` globs and reads, then
  hands content to the generator, so the library tier calls the same
  `applyExtractors` the generator itself calls. That is its scan path, but it is
  reached differently from the other two.
- **Tailwind's scanner is Rust** (`@tailwindcss/oxide`); the other two scan in
  JavaScript. The `Scanner` is stateful and returns only candidates it has not
  seen, so the adapter constructs a fresh one per scan — otherwise every rebuild
  after the first would report no work.
- **These are single-machine numbers.** The environment is recorded in every
  results file. Compare runs from one machine; do not compare across two.

## Layout

```
src/prng.mjs        seeded PRNG and the Zipf draw
src/vocabulary.mjs  the utility vocabulary the fixtures are built from
src/fixtures.mjs    the generator, the cache, and the ground-truth manifest
src/sources.mjs     loading a tree into memory
src/engines/        one adapter per engine, behind a common interface
src/mutate.mjs      the class strings the incremental scenario edits in
src/measure.mjs     one (engine, size, phase), in a process of its own
src/run.mjs         orchestrator: spawns measurements, writes results
src/table.mjs       markdown rendering
src/cli-bench.mjs   the CLI tier
src/parity.mjs      the Tailwind class-surface sweep
```
