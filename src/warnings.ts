/**
 * Warning deduplication and budgeting.
 *
 * ## Warning Code Allocation Scheme (RI-NNNN)
 *
 * High-severity codes (RI-00xx, RI-20xx) are detected by isHighSeverity()
 * and reserved a slot in the per-compile budget so they cannot be drowned
 * out by informational warnings.
 *
 * A parity test in __tests__/core/warnings.test.ts asserts that every code
 * emitted in src/ is documented below, and every documented code (except
 * the explicit RI-1001 silent reservation) is emitted somewhere in src/.
 *
 * RI-00xx — Fatal / plugin bootstrap errors (thrown, not pushed)
 *   0001  PostCSS plugin failed (wraps the underlying error as { cause })
 *   0002  Invalid PostCSS plugin options.cwd
 *
 * RI-10xx — Core compilation & directives
 *   1001  (reserved) Unknown utility — intentionally silent
 *   1002  Unresolved arbitrary utility
 *   1004  Unknown variant
 *   1005  Unknown utility in @apply
 *   1006  @apply at top level
 *   1009  @apply not supported in CLI mode
 *   1011  Single-line comment / unparseable directive
 *   1012  Directive parse error
 *   1013  Warning limit reached (emitted by pushWarningsDeduped)
 *   1014  Unsafe name for TypeScript generation
 *   1015  @utility body size limit / glob validation
 *   1016  @custom selector size limit
 *   1017  @custom variant name invalid
 *   1018  Spacing value likely typo (exceeds threshold)
 *   1019  CSS input size limit exceeded
 *   1020  Invalid @spacing base value
 *   1021  Invalid @weight value
 *   1022  Invalid @fluid min unit
 *   1023  Invalid @fluid max unit
 *   1024  Invalid @fluid range
 *   1025  Invalid @fluid unit
 *   1026  Invalid @fluid multiplier
 *   1027  Unknown @fluid modifier
 *   1028  Invalid @register property name (must start with --)
 *   1029  @register typed syntax with no initial-value (dropped)
 *   1030  Duplicate @register property name (last wins)
 *   1031  @register declared no properties, or had an unrecognized entry key
 *   1032  @utility name shadowed by a built-in static utility of the same name
 *   1034  Directive modifier ignored (directive takes no modifier / unknown modifier)
 *   1035  Invalid directive entry key or @utility name (skipped)
 *   1036  RI directive nested inside a conditional at-rule applies unconditionally
 *   1037  @slot used outside @custom (only valid inside @custom)
 *   1038  @utility name contains uppercase (never matched by the markup scanner)
 *
 * RI-11xx — Color directives + directive-resolver catch-alls
 *   1101  Invalid @color value
 *   1102  @color chroma out of range
 *   1103  Invalid @color removal / dark mode value
 *   1104  Unknown @color dark option
 *   1105  Alias referencing non-existent color
 *   1106  Color stop has low APCA contrast against both paper and ink
 *   1107  Circular alias chain
 *   1108  dark/options block on a non-generative @color value is ignored
 *   1110  Unknown directive type reached the resolver — internal bug signal
 *   1120  Unknown @layer option key
 *   1121  Invalid --corner-scale value in @rounded
 *
 * RI-12xx — Font system
 *   1201  Unknown font provider
 *   1202  @font-<slot> removed — configure fonts inside @font { … }
 *   1203  Compound font-style on a local @font face — split into @face blocks
 *   1204  Provider font (google/system) combined with local @face faces
 *   1205  Google Fonts fetch failure
 *   1206  RI_OFFLINE with no cache
 *   1207  Google Fonts response too large
 *   1208  RI_CACHE_DIR absolute path
 *   1209  RI_CACHE_DIR traversal depth
 *   1210  Font cache write failure
 *   1211  RI_FONT_CACHE_TTL exceeded maximum
 *   1212  Global fetch() not available
 *   1213  Google Fonts metadata fetch timeout
 *   1214  Duplicate @font faces (same weight + style) in a slot
 *   1215  Duplicate @font slot definition (last wins)
 *   1216  @font slot definitions exceeded the limit (truncated)
 *   1217  Malformed or unknown @font entry (unknown key, stray value, spurious or unterminated block, missing family/src, unsafe value) — ignored
 *   1218  Deprecated @font syntax (still desugared, will be removed)
 *   1219  @font preload on a non-local slot has no effect
 *   1220  @font metrics problem (invalid value, partial overrides, no effect, or family not in the metrics table)
 *
 * RI-13xx — Merge / compilation context
 *   1301  registerCustomUtility() empty name
 *   1302  registerCustomUtility() no properties
 *
 * RI-14xx — Source scanner
 *   1401  No source files found
 *   1402  Invalid glob pattern
 *   1403  Could not read source file
 *   1404  @source pattern rejected
 *   1405  Source file size limit exceeded
 *   1406  Inline @source content size limit exceeded
 *   1407  Variant group expansion input exceeds character limit
 *   1408  Variant group expansion output exceeds character limit
 *   1409  Variant group nesting exceeds max depth
 *   1410  Safelist discovery — could not read dep package.json or invalid safelistSources entry
 *   1411  Over-long lines skipped by the class scanner (minified-input guard)
 *
 * RI-15xx — Typography utilities
 *   1501  text-fluid requires rem font size
 *   1502  text-fluid no smaller size to interpolate
 *
 * RI-16xx — Integration plugins (Vite, PostCSS, CLI wiring)
 *   1601  Vite plugin: failed to scan a CSS directory
 *   1602  Vite plugin: no CSS entry found while RI activation detected
 *   1603  CLI build produced zero rules (likely missing @source / glob arg)
 *   1604  CLI: rainbowindex-env.d.ts has hand edits — backup written
 *   1605  CLI: explicit --css input file not found
 *   1606  PostCSS plugin placed in Vite's `plugins: []` — use rainbowindex/vite
 *
 * RI-20xx — CSS functions, ri() runtime & compile() validation
 *   2001  Could not resolve --theme() variable
 *   2002  Could not inline --theme() variable
 *   2003  Default export (PostCSS plugin) used in a browser bundle
 *   2004  ri() called in SSR with shared module-level state (use createRi)
 *   2005  --spacing() non-numeric argument
 *   2006  Class name exceeds length limit (dropped)
 *   2007  compile() theme type check
 *   2008  compile() classNames type check
 *   2009  CSS function substitution depth limit
 *   2010  CSS function output size limit
 *   2011  ri() input nesting exceeds depth limit
 *   2012  ri() input exceeds class count limit
 */

// ---------------------------------------------------------------------------
// Warning deduplication helper
// ---------------------------------------------------------------------------

/**
 * Maximum number of warnings to accumulate per compilation pass.
 * Prevents unbounded memory growth from pathological input (e.g. thousands
 * of invalid class names). A final summary warning is appended when the cap
 * is reached.
 */
export const MAX_WARNINGS = 200;

/**
 * Number of warning slots reserved for high-severity warnings (RI-0xxx errors,
 * RI-2xxx compile/runtime errors). Low-severity warnings (RI-1xxx informational)
 * are capped at MAX_WARNINGS - RESERVED_HIGH_SEVERITY_SLOTS to prevent a flood
 * of minor warnings from masking critical issues.
 */
const RESERVED_HIGH_SEVERITY_SLOTS = 20;

/** Returns true if a warning message is high-severity (error-class codes). */
function isHighSeverity(msg: string): boolean {
	// RI-0xxx: fatal/bootstrap errors, RI-2xxx: compile/runtime errors
	return /\[RI-0\d{3}\]|\[RI-2\d{3}\]/.test(msg);
}

/**
 * Push warnings into an array, skipping exact duplicates.
 * `seen` is the caller-owned companion Set for O(1) dedup lookups — it must
 * track `target`'s contents across calls.
 * Stops accumulating once MAX_WARNINGS is reached.
 *
 * Implements tiered budgeting: low-severity warnings are capped earlier
 * (at MAX_WARNINGS - RESERVED_HIGH_SEVERITY_SLOTS) to ensure high-severity
 * warnings always have room.
 */
export function pushWarningsDeduped(target: string[], source: string[], seen: Set<string>): void {
	const dedup = seen;
	for (const w of source) {
		if (target.length >= MAX_WARNINGS - 1) {
			const capMsg = `[RI-1013] Warning limit reached (${MAX_WARNINGS}). Further warnings suppressed.`;
			if (!dedup.has(capMsg)) {
				target.push(capMsg);
				dedup.add(capMsg);
			}
			return;
		}
		// Reserve slots for high-severity warnings — low-severity warnings
		// are capped earlier to prevent them from exhausting the budget.
		if (!isHighSeverity(w) && target.length >= MAX_WARNINGS - RESERVED_HIGH_SEVERITY_SLOTS - 1) {
			const truncMsg =
				"[RI-1013] Low-severity warning budget exhausted. Some informational warnings suppressed to reserve capacity for critical issues.";
			if (!dedup.has(truncMsg)) {
				target.push(truncMsg);
				dedup.add(truncMsg);
			}
			continue;
		}
		if (dedup.has(w)) continue;
		target.push(w);
		dedup.add(w);
	}
}
