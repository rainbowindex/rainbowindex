# Command-Line Interface

The package installs one binary: `rainbowindex`. The binary has six commands. `build` is the default command. The CLI does not read stdin. CSS output goes to stdout unless you set `--output`. Warnings go to stderr.

| Command | Purpose |
| --- | --- |
| `build` (default) | Generate CSS from source files. |
| `init` | Connect Rainbow Index to the current Vite app. |
| `create <dir>` | Scaffold a new Vite app with Rainbow Index. |
| `generate-types` | Generate TypeScript types for editor autocomplete. |
| `preload-fonts` | Print `<link rel="preload">` tags for local font faces. |
| `scan` | Print the class names that the scanner finds in files. |

Run `rainbowindex --help` for global help. Run `rainbowindex <command> --help` for help on one command. Put the command word before `--help`. The form `rainbowindex --help build` prints the global help, not the command help.

The command word must be the first token that is not a flag. If a glob comes first, a later command word becomes a file name. For example, `rainbowindex "src/**" generate-types` scans a file with the name `generate-types`.

## Flags

| Flag | Commands | Default | Purpose |
| --- | --- | --- | --- |
| `-o`, `--output <file>` | `build` | stdout | Output CSS file path. The path must stay inside the working directory. Required with `--watch`. |
| `--watch` | `build` | off | Rebuild when a source file changes. |
| `--minify` | `build` | off | Minify the output and add browser fallbacks with LightningCSS. `--optimize` is an alias. |
| `--css <file>` | `build`, `generate-types`, `preload-fonts` | auto-detected | CSS input file with directives. |
| `--css <file>` | `init`, `create` | `src/index.css` | Stylesheet to create or patch with `@import "rainbowindex";`. |
| `--strict` | `generate-types` | off | Remove the `(string & {})` escape hatch from the generated class type. |
| `--template <name>` | `create` | `react-ts` | Vite template name. |
| `-v`, `--version` | all | — | Print the version and exit. |
| `-h`, `--help` | all | — | Print help and exit. |

Note: the `--css` flag has two meanings. For `build`, `generate-types`, and `preload-fonts` it names the CSS input to read. For `init` and `create` it names the stylesheet to create or patch.

A flag from a different command causes an error that points to the help of the command you ran. The minify targets are Chrome 96, Firefox 91, and Safari 15.4.

## CSS input auto-detection

If you do not set `--css`, the CLI probes these paths in order and picks the first active file:

```
src/index.css, src/style.css, src/styles.css, src/app.css, src/global.css,
index.css, style.css, styles.css, app.css, global.css
```

A file is active when it contains a Rainbow Index directive, or `@import "rainbowindex"`, or `@import "rainbowindex/index.css"`. Directives inside comments or strings do not count.

If no active file is found, the build continues with empty CSS input. If an explicit `--css` path does not exist, the build stops with error `[RI-1605]`.

The CSS input limit is 5 MB. An explicit file above the limit causes an error. The auto-detection skips files above the limit without a message.

## build

`rainbowindex <glob> [options]` compiles the CSS for the classes found in the files that match the globs.

```bash
rainbowindex "src/**/*.tsx" -o dist/styles.css
```

Quote the globs. If you do not, the shell expands them.

Without `-o`, the CLI writes the CSS to stdout:

```bash
rainbowindex "src/**/*.tsx" --css src/styles.css --minify > out.css
```

With `-o`, the CLI creates the output directory, writes a temporary file, and then renames it over the target. A stopped build never leaves a truncated CSS file. On success the CLI prints `[rainbowindex] Built: <file>`.

The CLI does not run PostCSS. It cannot expand `@apply` and warns with `[RI-1009]`. Use the Vite plugin or the PostCSS plugin for `@apply`. See [vite-plugin.md](vite-plugin.md) and [postcss-plugin.md](postcss-plugin.md).

If zero utility classes compile, the CLI warns with `[RI-1603]`. This warning usually means that the globs match no files, or that no globs and no `@source` were given.

## build --watch

Watch mode requires `--output`:

```bash
rainbowindex "src/**/*.tsx" --watch -o dist/styles.css
```

The CLI runs the first build, then watches for file changes. It watches:

- The globs you gave. If you gave none, it watches `*.html` and `src/**/*.{html,js,jsx,ts,tsx,mdx,vue,svelte}`.
- The CSS input file.
- Every positive `@source` pattern from the CSS. The CLI reads the patterns again after each rebuild, so `@source` edits apply live.

It ignores `node_modules/**`, `dist/**`, `build/**`, `coverage/**`, `public/**`, `**/*.config.*`, and `**/*.d.ts`.

Watch behavior:

- Rebuilds start at most once per 500 ms, with a 100 ms debounce.
- A build error prints `[rainbowindex] Build error: ...` and does not stop the watcher.
- After 5 build errors in a row, rebuilds pause. Save a file to resume.
- The watcher path limit is 10,000. Above the limit, the CLI warns and does not add new paths.
- On SIGINT or SIGTERM, the CLI waits up to 5 seconds for the current build, then exits with code 0.

## generate-types

`rainbowindex generate-types` writes `rainbowindex-env.d.ts` to the working directory. The output path is fixed. The file declares the class-name types for `ri()` autocomplete, from your resolved theme.

Add the file to the `include` list of your `tsconfig.json`.

Without `--strict`, the class type ends with `| (string & {})`. Any string then stays legal, and known classes get autocomplete. With `--strict`, only known classes are legal.

If a file with that name exists and is not auto-generated, the CLI saves it as `rainbowindex-env.d.ts.bak` first and warns with `[RI-1604]`. If the backup write fails, the CLI stops with exit code 1 and does not overwrite.

A token name with unsafe characters is skipped with warning `[RI-1014]`. Safe names match `/^[a-zA-Z0-9_-]+$/`.

```bash
rainbowindex generate-types --strict --css src/styles.css
```

## preload-fonts

`rainbowindex preload-fonts` prints one `<link rel="preload">` tag per qualifying font face to stdout.

A face qualifies only when both conditions are true:

1. The face is marked `preload` in the `@font` block.
2. The face comes from a local file or a raw URL.

Google fonts and system fonts never produce a tag. Google serves CSS, not font binaries, so the font file URL is not known without a network request. When zero faces qualify, the CLI prints `[rainbowindex] No font preload links to generate.` and exits with code 0.

See [fonts.md](fonts.md) for the `preload` marker.

## scan

`rainbowindex scan <file-or-glob>...` shows what the scanner extracts from each file. Use it to find out why a class is missing from the output.

```bash
rainbowindex scan "src/**/*.tsx"
```

For each file, the CLI prints the file path, the class count, and each class on its own line. Scanner warnings go to stderr.

`scan` applies no excludes. A scan of files inside `node_modules` is supported. At least one file or glob is required. Zero matches is an error.

## init

`rainbowindex init` connects Rainbow Index to an existing Vite app. The directory must look like a Vite project: a `vite` dependency, a script that runs `vite`, or a `vite.config.*` file. If it does not, the command stops and points you to `create`.

The command does these steps:

1. Detects your package manager from the lockfile, then from `package.json#packageManager`, then from the npm user agent. The fallback is `npm`.
2. Installs `rainbowindex` as a dev dependency if it is absent.
3. Adds `rainbowindex()` from `rainbowindex/vite` to the `plugins` array of your Vite configuration. If no configuration file exists, it creates one. If the patch fails, the command stops and prints a snippet to paste by hand.
4. Finds your stylesheet and adds `@import "rainbowindex";` at the top. If no stylesheet exists, it creates one (default `src/index.css`). If it created the stylesheet, it also imports it from your entry file.

The command does not change files that are already correct. A second run prints `[rainbowindex] Rainbow Index was already wired for Vite.`

## create

`rainbowindex create <dir>` scaffolds a new Vite app and runs the `init` flow inside it.

```bash
rainbowindex create my-app --template vue-ts
```

The target directory must be new or empty. The CLI runs `create vite` with your package manager and passes `--template` through without validation. A bad template name fails in the Vite scaffolder. Known names include `vanilla`, `vanilla-ts`, `react`, `react-ts`, `vue`, `vue-ts`, `svelte`, and `svelte-ts`.

## Exit codes

| Code | Condition |
| --- | --- |
| 0 | Success. Help, version, and "no font preload links" also exit 0. |
| 1 | Any error. The message goes to stderr. |

## Environment variables

The CLI reads the same environment variables as the rest of the package. See [environment-variables.md](environment-variables.md).

## Limits

- CSS input limit: 5 MB.
- Scanned source file limit: 1 MB per file. Larger files are skipped.
- Glob resolution timeout: 30 seconds.
- Warnings per compile: 200, with 20 slots reserved for high-severity errors.

## Diagnostic codes on this page

| Code | Meaning |
| --- | --- |
| `RI-1009` | The CSS input contains `@apply`, and the CLI cannot expand it. |
| `RI-1014` | A token name has unsafe characters for type generation. |
| `RI-1404` | A glob or `@source` pattern was rejected, or a candidate CSS file was unreadable. |
| `RI-1603` | Zero utility classes compiled. |
| `RI-1604` | An existing hand-written `rainbowindex-env.d.ts` was saved as `.bak`. |
| `RI-1605` | The explicit `--css` file was not found. |

The full table is in [diagnostics.md](diagnostics.md).
