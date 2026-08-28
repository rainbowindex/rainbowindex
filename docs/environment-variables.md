# Environment Variables

| Variable | Values | Effect |
| --- | --- | --- |
| `RI_DEBUG` | any non-empty value | Turn on `[RI-DEBUG]` logs: font fetch progress and fallback decisions. |
| `RI_OFFLINE` | `1` or `true` | Never touch the network. Load the font cache and ignore its age. Without a cache file, warn with `[RI-1206]` and continue with defaults. |
| `RI_FETCH_FONTS` | `0` or `false` to disable | Do not fetch Google Fonts metadata. A stale cache is still loaded. Without a cache, continue with defaults, without a warning. |
| `RI_CACHE_DIR` | a relative path | The font cache directory. Default: `node_modules/.cache/rainbowindex`. An absolute path or a `..` segment turns the cache off with `[RI-1208]` or `[RI-1209]`, and the build continues. |
| `RI_FONT_CACHE_TTL` | seconds | The font cache lifetime. Default: `604800` (7 days). The maximum is 30 days. `0` means always expired. |
| `NODE_ENV` | `production` | Silence the dev-only warnings: `[RI-1301]`, `[RI-1302]`, the console half of `[RI-2003]`, and `[RI-DEV]` messages. |

The font variables matter only for builds with a Google font slot. See [fonts.md](fonts.md) for when the network is touched.

For a hermetic CI build with Google fonts:

```bash
RI_OFFLINE=1 rainbowindex "src/**/*.tsx" -o dist/styles.css
```

Fill the cache once with network access first, and keep `node_modules/.cache/rainbowindex/google.json` available to the build.
