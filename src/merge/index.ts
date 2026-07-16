/**
 * ri() — class merge function.
 * Replaces both tailwind-merge and clsx.
 *
 * Re-exported from the package's main and browser entries as `ri()`.
 * Right-to-left scan: rightmost class wins when two classes set the same CSS property.
 *
 * ## Concurrency
 *
 * The default `ri()` export uses module-level state published by
 * `finalizeCompilationContext()`. This is safe for single-compilation
 * environments (typical browser usage, single Vite build, PostCSS).
 *
 * In multi-tenant / SSR / concurrent-compilation environments, use
 * `createRi(snapshot)` instead — it captures a frozen snapshot of the
 * compilation state and uses its own independent cache:
 *
 *   const snapshot = finalizeCompilationContext(ctx);
 *   const ri = createRi(snapshot);
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClassInput = string | false | null | undefined | ClassInput[];

// ---------------------------------------------------------------------------
// Conflict resolution data (imported from props.ts)
// ---------------------------------------------------------------------------

import {
	BUILTIN_STATIC_PROPS,
	PREFIX_PROPS,
	OVERRIDES,
	PREFIX_FIRST_SEGMENT_MAP,
	isColorValue,
	isImageValue,
	isFontFamilyValue,
	isGradientPositionValue,
	isMaskStopPositionValue,
	isMaskRadialSizeValue,
} from "./props.js";
import { scanBracketAware, evictLRU } from "../brackets.js";
import { devWarn, IS_DEV } from "../runtime.js";

// ---------------------------------------------------------------------------
// Dual-mode utilities
// ---------------------------------------------------------------------------

// Default text sizes used as initial state and reset baseline.
// Also used by engine.ts (BUILTIN_TEXT_SIZES) — single source of truth.
export const DEFAULT_TEXT_SIZES = [
	"xs",
	"sm",
	"base",
	"lg",
	"xl",
	"2xl",
	"3xl",
	"4xl",
	"5xl",
] as const;
const DEFAULT_FONT_FAMILIES = ["sans", "serif", "mono"];

/**
 * Data-driven dispatch table for dual-mode prefix utilities.
 * Each entry defines how to resolve a prefix that can map to different CSS
 * properties depending on the value (e.g. text-lg → font-size vs text-red → color).
 *
 * `resolve` receives the value part and context sets, returns the CSS properties.
 */
interface DualModeEntry {
	resolve: (
		value: string,
		textSizes: ReadonlySet<string>,
		fontFamilies: ReadonlySet<string>,
		colorNames: ReadonlySet<string>,
	) => readonly string[];
}

/** Strip an optional `/line-height` modifier (text-lg/7 → lg), respecting brackets/parens. */
function stripTextModifier(value: string): string {
	// Cheap gate: no slash at all → nothing to strip (the common case).
	if (value.indexOf("/") === -1) return value;
	let slash = -1;
	scanBracketAware(value, (ch, i, depth) => {
		if (ch === "/" && depth === 0) {
			slash = i;
			return true;
		}
	});
	return slash === -1 ? value : value.slice(0, slash);
}

/**
 * Mask gradient stop families: [prefix, var sides, end]. The `*-from`/`*-to`
 * utilities are position-or-color dual-mode and share their family's canonical
 * `mask-image`, so same-family from/to coexist via their unique stop vars while
 * same-end repeats dedupe. Axis families (x = right+left, y = top+bottom) also
 * touch `mask-composite`.
 */
const MASK_STOP_FAMILIES: ReadonlyArray<readonly [string, readonly string[], "from" | "to"]> = [
	["mask-linear-from", ["linear"], "from"],
	["mask-linear-to", ["linear"], "to"],
	["mask-t-from", ["top"], "from"],
	["mask-t-to", ["top"], "to"],
	["mask-r-from", ["right"], "from"],
	["mask-r-to", ["right"], "to"],
	["mask-b-from", ["bottom"], "from"],
	["mask-b-to", ["bottom"], "to"],
	["mask-l-from", ["left"], "from"],
	["mask-l-to", ["left"], "to"],
	["mask-x-from", ["right", "left"], "from"],
	["mask-x-to", ["right", "left"], "to"],
	["mask-y-from", ["top", "bottom"], "from"],
	["mask-y-to", ["top", "bottom"], "to"],
	["mask-radial-from", ["radial"], "from"],
	["mask-radial-to", ["radial"], "to"],
	["mask-conic-from", ["conic"], "from"],
	["mask-conic-to", ["conic"], "to"],
];

const MASK_STOP_DUAL_MODES: Record<string, DualModeEntry> = {};
for (const [prefix, sides, end] of MASK_STOP_FAMILIES) {
	// Per-family arrays are precomputed once at module init — the resolver runs
	// per ri() call and must not allocate. The color case is exactly the
	// family's PREFIX_PROPS entry (single source of truth).
	const positionProps: string[] = ["mask-image"];
	if (sides.length > 1) positionProps.push("mask-composite");
	for (const side of sides) positionProps.push(`--ri-mask-${side}-${end}-position`);
	Object.freeze(positionProps);
	const colorProps = PREFIX_PROPS[prefix];
	MASK_STOP_DUAL_MODES[prefix] = {
		resolve: (value) => (isMaskStopPositionValue(value) ? positionProps : colorProps),
	};
}

// Precomputed per-branch prop arrays — dual-mode resolvers run per ri() call
// and must not allocate. Branches matching the prefix's PREFIX_PROPS entry
// return it directly (single source of truth with the parser-parity table).
const TEXT_SIZE_PROPS: readonly string[] = Object.freeze(["font-size", "line-height"]);
// A font-family slot (font-sans, font-serif, …) also carries the slot's
// feature/variation settings (emitted by the font-<slot> utility), so
// selecting one slot must reset all three properties.
const FONT_FAMILY_PROPS: readonly string[] = Object.freeze([
	"font-family",
	"font-feature-settings",
	"font-variation-settings",
]);
const MASK_RADIAL_SIZE_PROPS: readonly string[] = Object.freeze(["--ri-mask-radial-size"]);
const BG_IMAGE_PROPS: readonly string[] = Object.freeze(["background-image"]);
const BORDER_COLOR_PROPS: readonly string[] = Object.freeze(["border-color"]);
const OUTLINE_COLOR_PROPS: readonly string[] = Object.freeze(["outline-color"]);
const OUTLINE_STYLE_PROPS: readonly string[] = Object.freeze(["outline-style"]);
const DECORATION_COLOR_PROPS: readonly string[] = Object.freeze(["text-decoration-color"]);

// Hoisted dual-mode value tests — resolve() runs per ri() token.
const RE_SIGNED_INT = /^-?\d+$/;
const RE_UNSIGNED_INT = /^\d+$/;
const WS_SPLIT_RE = /\s+/;

/** Color-vs-default dual mode shared by the composable shadow/ring families. */
function colorOrDefault(prefix: string, colorProps: readonly string[]): DualModeEntry {
	const defaultProps = PREFIX_PROPS[prefix];
	return {
		resolve: (value, _textSizes, _fontFamilies, colorNames) =>
			isColorValue(value, undefined, colorNames) ? colorProps : defaultProps,
	};
}

const DUAL_MODE_PREFIXES: Readonly<Record<string, DualModeEntry>> = {
	...MASK_STOP_DUAL_MODES,
	// mask-radial-[<size>] sets the size var; mask-radial-[<value>] is a full image.
	"mask-radial": {
		resolve: (value) =>
			isMaskRadialSizeValue(value) ? MASK_RADIAL_SIZE_PROPS : PREFIX_PROPS["mask-radial"],
	},
	text: {
		resolve: (value, textSizes, _fontFamilies, colorNames) => {
			// Strip an optional `/line-height` modifier (text-lg/7) before the size check.
			const base = stripTextModifier(value);
			if (
				textSizes.has(base) ||
				(base.startsWith("[") && !isColorValue(base, textSizes, colorNames))
			) {
				return TEXT_SIZE_PROPS;
			}
			return PREFIX_PROPS.text;
		},
	},
	font: {
		resolve: (value, _textSizes, fontFamilies) => {
			// Font-stack-shaped arbitraries (font-[Georgia,_serif]) emit font-family,
			// mirroring typography.ts — everything else is a weight.
			if (fontFamilies.has(value) || isFontFamilyValue(value)) return FONT_FAMILY_PROPS;
			return PREFIX_PROPS.font;
		},
	},
	border: {
		resolve: (value, _textSizes, _fontFamilies, colorNames) =>
			isColorValue(value, undefined, colorNames) ? BORDER_COLOR_PROPS : PREFIX_PROPS.border,
	},
	outline: {
		resolve: (value, _textSizes, _fontFamilies, colorNames) => {
			if (isColorValue(value, undefined, colorNames)) return OUTLINE_COLOR_PROPS;
			if (RE_SIGNED_INT.test(value) || (value.startsWith("[") && !isColorValue(value)))
				return PREFIX_PROPS.outline;
			return OUTLINE_STYLE_PROPS;
		},
	},
	decoration: {
		resolve: (value, _textSizes, _fontFamilies, colorNames) => {
			// `length:`-hinted custom property / arbitrary → thickness
			if (value.startsWith("(length:") || value.startsWith("[length:"))
				return PREFIX_PROPS.decoration;
			// bare custom property (decoration-(--c)) → color
			if (value.startsWith("(")) return DECORATION_COLOR_PROPS;
			if (RE_UNSIGNED_INT.test(value) || (value.startsWith("[") && !isColorValue(value)))
				return PREFIX_PROPS.decoration;
			if (isColorValue(value, undefined, colorNames)) return DECORATION_COLOR_PROPS;
			return PREFIX_PROPS.decoration;
		},
	},
	bg: {
		// Image-first to mirror colorGenerator's dispatch: the engine emits
		// background-image for image-shaped values (bg-[url(#x)] contains "#",
		// so a color-first check would misclassify it) and background-color
		// for everything else — never the full `background` shorthand.
		resolve: (value) => (isImageValue(value) ? BG_IMAGE_PROPS : PREFIX_PROPS.bg),
	},
	shadow: colorOrDefault("shadow", Object.freeze(["--ri-shadow-color"])),
	"inset-shadow": colorOrDefault("inset-shadow", Object.freeze(["--ri-inset-shadow-color"])),
	ring: colorOrDefault("ring", Object.freeze(["--ri-ring-color"])),
	"inset-ring": colorOrDefault("inset-ring", Object.freeze(["--ri-inset-ring-color"])),
	"text-shadow": colorOrDefault("text-shadow", Object.freeze(["--ri-text-shadow-color"])),
	"drop-shadow": colorOrDefault("drop-shadow", Object.freeze(["--ri-drop-shadow-color"])),
	from: {
		resolve: (value) =>
			isGradientPositionValue(value) ? PREFIX_PROPS["from-position"] : PREFIX_PROPS.from,
	},
	via: {
		resolve: (value) =>
			isGradientPositionValue(value) ? PREFIX_PROPS["via-position"] : PREFIX_PROPS.via,
	},
	to: {
		resolve: (value) =>
			isGradientPositionValue(value) ? PREFIX_PROPS["to-position"] : PREFIX_PROPS.to,
	},
};

/**
 * Directional border prefixes (border-t, border-x, …) with width-vs-color dual
 * mode. Values are the precomputed color-side props; the width side falls back
 * to the prefix's PREFIX_PROPS entry.
 */
const DIRECTIONAL_BORDER_COLOR_PROPS: ReadonlyMap<string, readonly string[]> = new Map(
	[
		"border-t",
		"border-b",
		"border-l",
		"border-r",
		"border-s",
		"border-e",
		"border-bs",
		"border-be",
		"border-x",
		"border-y",
	].map((prefix) => [prefix, Object.freeze([PREFIX_PROPS[prefix][0].replace("width", "color")])]),
);

// ---------------------------------------------------------------------------
// Compilation context — encapsulates all mutable state for a single
// compilation pass.  The engine creates one via createCompilationContext(),
// mutates it during compilation, then finalizes it so ri() can read the
// snapshot without interference from concurrent compilations.
// ---------------------------------------------------------------------------

export interface CompilationContext {
	customStaticProps: Record<string, string[]>;
	textSizes: Set<string>;
	fontFamilies: Set<string>;
	colorNames: Set<string>;
}

/** Finalized snapshot — read by ri() via resolveProps(). Immutable between compilations. */
let _customStaticProps: Readonly<Record<string, string[]>> = {};
let _textSizes: ReadonlySet<string> = new Set(DEFAULT_TEXT_SIZES);
let _fontFamilies: ReadonlySet<string> = new Set(DEFAULT_FONT_FAMILIES);
let _colorNames: ReadonlySet<string> = new Set();

/**
 * Frozen snapshot of compilation state for SSR-safe ri() instances.
 * Created by finalizeCompilationContext() and consumed by createRi().
 */
export interface CompilationSnapshot {
	readonly customStaticProps: Readonly<Record<string, string[]>>;
	readonly textSizes: ReadonlySet<string>;
	readonly fontFamilies: ReadonlySet<string>;
	readonly colorNames: ReadonlySet<string>;
}

/** Latest snapshot, used by createRi() to capture state at finalization time. */
let _latestSnapshot: CompilationSnapshot | null = null;

// ---------------------------------------------------------------------------
// LRU cache for ri() — avoids re-computing conflict resolution for repeated calls
// ---------------------------------------------------------------------------

const RI_CACHE_MAX = 500;
/** Maximum cache key length — oversized inputs bypass the cache to prevent memory waste. */
const RI_CACHE_KEY_MAX_LEN = 2048;
/** Global LRU cache for the default ri() export. Cleared on every
 *  finalizeCompilationContext() call so stale entries from previous
 *  compilations (with different custom utilities) are never returned.
 *  SSR/multi-tenant environments should use createRi(), which gets
 *  its own isolated cache. */
const _riCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Prefix extraction
// ---------------------------------------------------------------------------

/**
 * Extract the utility prefix and value from a class name (without variant prefix).
 * Returns the CSS properties this utility sets, or null if unknown.
 */
// (custom state is declared above with the snapshot pattern)

function resolvePropsWith(
	utility: string,
	customStaticProps: Readonly<Record<string, string[]>>,
	textSizes: ReadonlySet<string>,
	fontFamilies: ReadonlySet<string>,
	colorNames: ReadonlySet<string>,
): readonly string[] | null {
	// 0. Arbitrary property: [padding:1rem] → extract the CSS property
	if (utility.charCodeAt(0) === 91 /* '[' */) {
		const colonIdx = utility.indexOf(":");
		if (colonIdx !== -1) {
			const prop = utility.slice(1, colonIdx).trim();
			if (prop) return [prop];
		}
	}

	// Negative utility (-mt-4) — claims the same properties as its positive
	// form so the two conflict. Mirrors the parser, which only treats a leading
	// dash as negation when a lowercase letter follows.
	let name = utility;
	if (name.charCodeAt(0) === 45 /* '-' */ && name.length > 1) {
		const next = name.charCodeAt(1);
		if (next >= 97 /* 'a' */ && next <= 122 /* 'z' */) name = name.slice(1);
	}

	// 1. Try custom utility match first (overrides builtins)
	// Use Object.hasOwn to avoid matching inherited keys (constructor, __proto__,
	// etc.) — custom tables are built from user keys with a normal prototype.
	if (Object.hasOwn(customStaticProps, name)) return customStaticProps[name];

	// 2. Try built-in static match (null-prototype table — bare lookup is safe)
	const builtin = BUILTIN_STATIC_PROPS[name];
	if (builtin !== undefined) return builtin;

	// 3. Try prefix-based match (longest prefix wins)
	// Uses first-segment dispatch via PREFIX_FIRST_SEGMENT_MAP for O(1) lookup
	// of candidate prefixes instead of O(N) linear scan over all prefixes.
	const firstDash = name.indexOf("-");
	const firstSeg = firstDash === -1 ? name : name.slice(0, firstDash);
	const candidates = PREFIX_FIRST_SEGMENT_MAP.get(firstSeg);
	if (candidates) {
		for (const prefix of candidates) {
			// `name === prefix || name.startsWith(prefix + "-")` without building
			// the per-candidate template string — this loop runs per ri() token.
			if (!name.startsWith(prefix)) continue;
			const exact = name.length === prefix.length;
			if (!exact && name.charCodeAt(prefix.length) !== 45 /* '-' */) continue;
			const value = exact ? "" : name.slice(prefix.length + 1);

			// Dual-mode dispatch: data-driven resolution for prefixes that
			// map to different CSS properties depending on the value.
			const dualMode = DUAL_MODE_PREFIXES[prefix] as DualModeEntry | undefined;
			if (dualMode) {
				return dualMode.resolve(value, textSizes, fontFamilies, colorNames);
			}

			// Directional border dual-mode: border-t-{width} vs border-t-{color}
			const directionalColor = DIRECTIONAL_BORDER_COLOR_PROPS.get(prefix);
			if (directionalColor && isColorValue(value, undefined, colorNames)) {
				return directionalColor;
			}

			return PREFIX_PROPS[prefix];
		}
	}

	return null;
}

/** Convenience wrapper using module-level globals (used by the default ri()). */
function resolveProps(utility: string): readonly string[] | null {
	return resolvePropsWith(utility, _customStaticProps, _textSizes, _fontFamilies, _colorNames);
}

// ---------------------------------------------------------------------------
// Variant extraction
// ---------------------------------------------------------------------------

/**
 * Find the index of the last top-level colon separating the variant prefix
 * from the utility ("sm:hover:p-4" → index of the colon before "p-4"), or -1
 * when the class has no variant. Index-based so the common no-variant path
 * allocates nothing.
 */
function findVariantSplit(cls: string): number {
	// Cheap gate: no colon at all → no variant (the overwhelmingly common case).
	if (cls.indexOf(":") === -1) return -1;
	// Find the last colon that's outside brackets.
	// Uses the shared scanBracketAware primitive for consistent bracket-depth
	// tracking across the codebase (parser.ts, merge.ts, scanner.ts).
	let lastColon = -1;
	scanBracketAware(
		cls,
		(ch, i, depth) => {
			if (ch === ":" && depth === 0) {
				lastColon = i;
				return true; // stop scanning
			}
		},
		{ reverse: true },
	);
	return lastColon;
}

/**
 * Canonicalize a variant prefix for claim keys: "sm:hover:" and "hover:sm:"
 * target the same declarations, so they must claim the same namespace. Output
 * text keeps the original spelling — only the claim key is normalized. The
 * sort runs only on the rare multi-variant path; the cheap gate exits when the
 * trailing colon is the first one (single variant, possibly bracketed colons).
 */
function canonicalVariantPrefix(variantPrefix: string): string {
	if (variantPrefix.indexOf(":") === variantPrefix.length - 1) return variantPrefix;
	const segments: string[] = [];
	let start = 0;
	scanBracketAware(variantPrefix, (ch, i, depth) => {
		if (ch === ":" && depth === 0) {
			segments.push(variantPrefix.slice(start, i));
			start = i + 1;
		}
	});
	// A single segment means the extra colons were bracketed (data-[a:b]:).
	if (segments.length < 2) return variantPrefix;
	segments.sort();
	return `${segments.join(":")}:`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Core merge algorithm shared by ri() and createRi().
 * Right-to-left scan: rightmost class wins conflicts.
 */
function mergeUncached(
	classes: string[],
	resolve: (utility: string) => readonly string[] | null,
): string {
	const claimed = new Set<string>();
	const result: string[] = [];

	for (let i = classes.length - 1; i >= 0; i--) {
		const cls = classes[i];
		const splitIdx = findVariantSplit(cls);
		const utility = splitIdx === -1 ? cls : cls.slice(splitIdx + 1);

		// Strip ! suffix for property resolution (e.g. p-4!, hover:bg-red-500!)
		const important = utility.charCodeAt(utility.length - 1) === 33; /* '!' */
		const cleanUtility = important ? utility.slice(0, -1) : utility;

		const props = resolve(cleanUtility);

		// Unknown class — pass through unchanged
		if (!props) {
			result.push(cls);
			continue;
		}

		// Claim namespace: canonicalized variant prefix (so sm:hover: and
		// hover:sm: collide), partitioned by importance — in CSS an !important
		// declaration beats a later normal one, so neither form may dominate
		// the other while same-importance repeats still merge.
		let ns = splitIdx === -1 ? "" : canonicalVariantPrefix(cls.slice(0, splitIdx + 1));
		if (important) ns = `!${ns}`;

		// Check if ALL of this class's CSS properties are already claimed.
		// A class is only dominated (dropped) when every property it sets
		// has already been claimed by a rightmost class. This ensures
		// multi-property custom utilities survive partial overrides
		// (e.g., `ri('card p-8')` keeps card for border-radius/box-shadow).
		let dominated = true;
		for (const prop of props) {
			if (!claimed.has(ns + prop)) {
				dominated = false;
				break;
			}
		}
		if (dominated) continue;

		// Claim this class's CSS properties + expand shorthands
		for (const prop of props) {
			claimed.add(ns + prop);
			// If this is a shorthand, also claim all its longhands.
			// OVERRIDES is null-prototype, so one bare lookup is own-key safe.
			const longhands = OVERRIDES[prop];
			if (longhands !== undefined) {
				for (const lh of longhands) {
					claimed.add(ns + lh);
				}
			}
		}

		result.push(cls);
	}

	// The scan ran right-to-left and pushed survivors; reverse once to restore
	// left-to-right source order — O(n) instead of O(n²) repeated unshift().
	result.reverse();
	return result.join(" ");
}

/** LRU read: move a hit to the end so Map insertion order tracks recency. */
function lruGet(cache: Map<string, string>, key: string): string | undefined {
	const cached = cache.get(key);
	if (cached !== undefined) {
		cache.delete(key);
		cache.set(key, cached);
	}
	return cached;
}

/** LRU write with batch eviction — evict oldest 25% when full to amortize
 *  eviction cost and avoid per-call iterator allocation. */
function lruPut(cache: Map<string, string>, key: string, value: string): void {
	evictLRU(cache, RI_CACHE_MAX);
	cache.set(key, value);
}

/** Cached wrapper around mergeUncached, keyed by the tokenized class list. */
function mergeClasses(
	classes: string[],
	resolve: (utility: string) => readonly string[] | null,
	cache: Map<string, string>,
): string {
	// Join with "\x00" — tokens can contain spaces (bracket-aware splitting
	// preserves them), so a space join would let a malformed call poison the
	// cache entry of a well-formed one.
	const cacheKey = classes.join("\x00");
	// Bypass cache for oversized inputs to prevent memory waste from huge keys
	const useCache = cacheKey.length <= RI_CACHE_KEY_MAX_LEN;
	if (useCache) {
		const cached = lruGet(cache, cacheKey);
		if (cached !== undefined) return cached;
	}

	const output = mergeUncached(classes, resolve);

	if (useCache) lruPut(cache, cacheKey, output);

	return output;
}

/**
 * Shared ri()/createRi() entry: cache fast path, then flatten + merge.
 *
 * When every argument is a non-empty string, the cache key is built from the
 * raw arguments before any flattening/tokenization, so repeat calls (the
 * per-render common case) skip the whole tokenize pipeline. Raw-join and
 * token-join keys can only collide when they describe the same token list —
 * i.e. when they'd produce the same output — short of a literal "\x00" inside
 * an argument, which cannot occur in a real class name.
 */
function mergeFrom(
	inputs: ClassInput[],
	resolve: (utility: string) => readonly string[] | null,
	cache: Map<string, string>,
): string {
	let allStrings = inputs.length > 0;
	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i];
		if (typeof input !== "string" || input === "") {
			allStrings = false;
			break;
		}
	}
	if (allStrings) {
		const rawKey = (inputs as string[]).join("\x00");
		if (rawKey.length <= RI_CACHE_KEY_MAX_LEN) {
			const cached = lruGet(cache, rawKey);
			if (cached !== undefined) return cached;
			const classes = flattenInputs(inputs);
			const output =
				classes.length === 0
					? ""
					: classes.length === 1
						? classes[0]
						: mergeUncached(classes, resolve);
			lruPut(cache, rawKey, output);
			return output;
		}
	}

	const classes = flattenInputs(inputs);
	if (classes.length === 0) return "";
	if (classes.length === 1) return classes[0];
	return mergeClasses(classes, resolve, cache);
}

/** Detect SSR environment at runtime. Cached after first check.
 *
 *  NOTE: The result is cached permanently after the first check. */
let _isSSR: boolean | null = null;
function detectSSR(): boolean {
	if (_isSSR !== null) return _isSSR;
	_isSSR =
		typeof window === "undefined" && typeof process !== "undefined" && !!process.versions?.node;
	return _isSSR;
}

/** Shared throttle interval for ri() runtime warnings. Re-emitting periodically
 *  keeps misuse visible in logs without flooding — a single one-time warning is
 *  too easy to miss. */
const WARNING_THROTTLE_MS = 60_000;

/** Per-warning throttle state, initialized to -Infinity so the very first
 *  occurrence always emits immediately. */
let _ssrWarningLastMs = Number.NEGATIVE_INFINITY;
let _classLenWarningLastMs = Number.NEGATIVE_INFINITY;
let _depthWarningLastMs = Number.NEGATIVE_INFINITY;
let _totalClassesWarningLastMs = Number.NEGATIVE_INFINITY;
let _nonStringWarningLastMs = Number.NEGATIVE_INFINITY;

/**
 * Merge class names with conflict resolution (replaces both tailwind-merge and clsx).
 * Rightmost class wins when two classes set the same CSS property.
 * Falsy values are filtered.
 *
 * @example
 * ri('p-2 bg-red-500', 'p-4')           // → 'bg-red-500 p-4'
 * ri('px-2 py-1', 'p-4')                // → 'p-4' (shorthand wins)
 * ri('flex', isActive && 'bg-blue-500') // → 'flex bg-blue-500'
 * ri('text-lg text-red-500')            // → 'text-lg text-red-500' (different properties)
 */
export function ri(...inputs: ClassInput[]): string {
	if (detectSSR()) {
		const now = Date.now();
		if (now - _ssrWarningLastMs >= WARNING_THROTTLE_MS) {
			_ssrWarningLastMs = now;
			if (_latestSnapshot === null) {
				// No compilation has ever finalized — module-level state is uninitialized
				// defaults. In SSR this almost certainly means ri() is being called without
				// a preceding compile pass, which will produce incorrect merge results
				// for custom utilities, text sizes, and font families.
				console.warn(
					"[RI-2004] ri() called in an SSR environment before any compilation has finalized. " +
						"The default ri() export reads module-level state that has not been initialized. " +
						"Custom utilities, text sizes, and font families will not be recognized. " +
						"Use createRi(snapshot) for concurrent-safe class merging. See: https://rainbowindex.dev/docs/ssr",
				);
			} else {
				console.warn(
					"[RI-2004] The default ri() export uses module-level state and is not safe for concurrent " +
						"SSR requests. Use createRi(snapshot) for isolation. See: https://rainbowindex.dev/docs/ssr\n" +
						"This warning repeats every 60 s until resolved. In production SSR, switch to createRi(snapshot) " +
						"to prevent silent data corruption between concurrent requests.",
				);
			}
		}
	}
	return mergeFrom(inputs, resolveProps, _riCache);
}

/**
 * Create an isolated ri() instance bound to a specific compilation snapshot.
 * Use this in SSR or multi-compilation environments where the global ri()
 * would be corrupted by concurrent compilations.
 *
 * @example
 * const snapshot = finalizeCompilationContext(ctx);
 * const ri = createRi(snapshot);
 * ri('p-2 bg-red-500', 'p-4') // → 'bg-red-500 p-4'
 */
export function createRi(snapshot?: CompilationSnapshot): (...inputs: ClassInput[]) => string {
	const snap = snapshot ??
		_latestSnapshot ?? {
			customStaticProps: _customStaticProps,
			textSizes: _textSizes,
			fontFamilies: _fontFamilies,
			colorNames: _colorNames,
		};
	const cache = new Map<string, string>();
	const resolve = (utility: string) =>
		resolvePropsWith(
			utility,
			snap.customStaticProps,
			snap.textSizes,
			snap.fontFamilies,
			snap.colorNames,
		);

	return function boundRi(...inputs: ClassInput[]): string {
		return mergeFrom(inputs, resolve, cache);
	};
}

// ---------------------------------------------------------------------------
// Input flattening
// ---------------------------------------------------------------------------

/** Maximum nesting depth for ClassInput arrays to prevent stack overflow. */
const MAX_FLATTEN_DEPTH = 10;
/** Maximum length for a single class name token. Tokens exceeding this are
 *  silently dropped to prevent memory abuse in SSR scenarios where
 *  user-controlled strings reach ri(). */
const MAX_CLASS_NAME_LENGTH = 500;
/** Maximum total number of class tokens to process per ri() call.
 *  Prevents memory amplification from user-controlled SSR input
 *  (e.g. ri(new Array(100000).fill('a'))). */
const MAX_TOTAL_CLASSES = 10_000;

/**
 * Iterative stack-based flattening — avoids recursive call overhead in
 * browser-shipped code. Processes arrays using an explicit stack with
 * depth tracking to enforce MAX_FLATTEN_DEPTH without recursion.
 */
function flattenInputs(inputs: ClassInput[]): string[] {
	const result: string[] = [];
	// Stack entries: [array, index, depth]
	const stack: Array<[ClassInput[], number, number]> = [[inputs, 0, 0]];

	while (stack.length > 0) {
		const top = stack[stack.length - 1];
		const [arr, , depth] = top;

		if (top[1] >= arr.length) {
			stack.pop();
			continue;
		}

		const input = arr[top[1]++];

		if (!input) continue;

		if (Array.isArray(input)) {
			if (depth + 1 > MAX_FLATTEN_DEPTH) {
				const now = Date.now();
				if (now - _depthWarningLastMs >= WARNING_THROTTLE_MS) {
					_depthWarningLastMs = now;
					console.warn(
						`[RI-2011] ri() input nesting exceeds maximum depth of ${MAX_FLATTEN_DEPTH}. Deeply nested inputs are silently dropped. Flatten your class arrays to avoid this limit.`,
					);
				}
				continue;
			}
			stack.push([input, 0, depth + 1]);
		} else if (typeof input !== "string") {
			// clsx-style objects ({ active: true }) and numbers are not supported —
			// skip instead of crashing the render path. Dev-only + throttled.
			if (IS_DEV) {
				const now = Date.now();
				if (now - _nonStringWarningLastMs >= WARNING_THROTTLE_MS) {
					_nonStringWarningLastMs = now;
					devWarn(
						`ri() inputs must be strings, arrays, or falsy — got ${typeof input}; value skipped. Object syntax ({ class: condition }) is not supported; use \`condition && "class"\` instead.`,
					);
				}
			}
		} else {
			const trimmed = input.trim();
			if (trimmed) {
				for (const cls of splitBracketAware(trimmed)) {
					if (result.length >= MAX_TOTAL_CLASSES) {
						const now = Date.now();
						if (now - _totalClassesWarningLastMs >= WARNING_THROTTLE_MS) {
							_totalClassesWarningLastMs = now;
							console.warn(
								`[RI-2012] ri() input exceeds ${MAX_TOTAL_CLASSES} class limit. Excess classes are dropped to prevent memory exhaustion.`,
							);
						}
						return result;
					}
					if (cls.length <= MAX_CLASS_NAME_LENGTH) {
						result.push(cls);
					} else {
						// Warn in all environments (not just __DEV__) since silently
						// dropping classes in production causes hard-to-debug styling
						// regressions. Throttled to avoid log flooding.
						const now = Date.now();
						if (now - _classLenWarningLastMs >= WARNING_THROTTLE_MS) {
							_classLenWarningLastMs = now;
							console.warn(
								`[RI-2006] Class name exceeds ${MAX_CLASS_NAME_LENGTH} character limit and was dropped: "${cls.slice(0, 40)}…". This is a safety guard against adversarial input in SSR. If this is intentional, shorten the class name.`,
							);
						}
					}
				}
			}
		}
	}

	return result;
}

/**
 * Split a string on whitespace, but respect bracket/paren pairs.
 * Prevents splitting inside arbitrary values like `bg-[url('foo bar')]`.
 */
function splitBracketAware(input: string): string[] {
	// NOTE: This uses inline bracket-depth tracking rather than the shared
	// scanBracketAware() primitive because it needs to manage tokenStart/tokenEnd
	// state that doesn't map to the callback model without allocation overhead.
	// The depth-tracking logic follows the same conventions as brackets.ts.
	//
	// Fast path: if the input contains no brackets or parens, simple split suffices.
	// This avoids the character-by-character loop for the 99% case (plain class lists).
	// Trim first so the split yields no empty tokens — skips the filter pass and
	// the per-call regex literal the previous version paid on every uncached call.
	if (!input.includes("[") && !input.includes("(")) {
		const trimmed = input.trim();
		return trimmed === "" ? [] : trimmed.split(WS_SPLIT_RE);
	}

	const result: string[] = [];
	// Use start/end index tracking instead of string concatenation to avoid
	// O(n²) behavior for long inputs (this runs in the browser on every ri() call).
	let tokenStart = -1;
	let depth = 0;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		// Skip CSS escape sequences (e.g. \[ \]) to prevent escaped
		// brackets from affecting depth tracking — consistent with
		// findVariantColon in parser.ts.
		if (ch === "\\" && i + 1 < input.length) {
			if (tokenStart === -1) tokenStart = i;
			i++; // skip the escaped character
			continue;
		}
		if (ch === "[" || ch === "(") {
			depth++;
			if (tokenStart === -1) tokenStart = i;
		} else if (ch === "]" || ch === ")") {
			if (depth > 0) depth--;
			if (tokenStart === -1) tokenStart = i;
		} else if (
			depth === 0 &&
			(ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f")
		) {
			if (tokenStart !== -1) {
				result.push(input.slice(tokenStart, i));
				tokenStart = -1;
			}
		} else {
			if (tokenStart === -1) tokenStart = i;
		}
	}

	if (tokenStart !== -1) result.push(input.slice(tokenStart));
	return result;
}

// ---------------------------------------------------------------------------
// Custom utility registration (for @utility directives)
// ---------------------------------------------------------------------------

/**
 * Create a fresh compilation context.
 * Called at the start of each compile() pass.
 */
export function createCompilationContext(): CompilationContext {
	return {
		customStaticProps: {},
		textSizes: new Set(DEFAULT_TEXT_SIZES),
		fontFamilies: new Set(DEFAULT_FONT_FAMILIES),
		colorNames: new Set(),
	};
}

/**
 * Register a custom utility's CSS properties in the compilation context.
 * Called by the engine when processing @utility directives.
 */
export function registerCustomUtility(
	ctx: CompilationContext,
	name: string,
	properties: string[],
): void {
	if (IS_DEV) {
		if (!name) {
			devWarn("[RI-1301] registerCustomUtility() called with empty name — skipping.");
			return;
		}
		if (properties.length === 0) {
			devWarn(
				`[RI-1302] registerCustomUtility("${name}") called with no CSS properties — the utility won't participate in conflict resolution.`,
			);
		}
	}
	ctx.customStaticProps[name] = properties;
}

/**
 * Register custom text sizes so the merge function correctly classifies
 * text-{custom} as a font-size utility rather than a color utility.
 */
export function registerCustomTextSizes(ctx: CompilationContext, sizes: string[]): void {
	for (const s of sizes) ctx.textSizes.add(s);
}

/**
 * Register custom font family names so the merge function correctly classifies
 * font-{custom} as a font-family utility rather than a font-weight utility.
 */
export function registerCustomFontFamilies(ctx: CompilationContext, families: string[]): void {
	for (const f of families) ctx.fontFamilies.add(f);
}

/**
 * Register the resolved theme's color names so the merge function classifies
 * bare flat colors (border-accent for `@color { accent: … }`) as color
 * utilities rather than width/weight ones. Shaded forms (accent-500) already
 * match the shade pattern and need no registration.
 */
export function registerColorNames(ctx: CompilationContext, names: string[]): void {
	for (const n of names) ctx.colorNames.add(n);
}

/**
 * Snapshot compilation context into module-level state that ri() reads from.
 * Called at the end of compile() to atomically publish the new state.
 */
/**
 * Deep-copy a compilation context into an immutable snapshot. The string
 * arrays are cloned so later context mutation cannot corrupt the snapshot.
 * Shared by finalizeCompilationContext() and createCompiler()'s per-instance
 * snapshot (engine/index.ts).
 */
export function snapshotCompilationContext(ctx: CompilationContext): CompilationSnapshot {
	return {
		customStaticProps: Object.fromEntries(
			Object.entries(ctx.customStaticProps).map(([k, v]) => [k, [...v]]),
		),
		textSizes: new Set(ctx.textSizes),
		fontFamilies: new Set(ctx.fontFamilies),
		colorNames: new Set(ctx.colorNames),
	};
}

export function finalizeCompilationContext(ctx: CompilationContext): CompilationSnapshot {
	const snapshot = snapshotCompilationContext(ctx);
	_customStaticProps = snapshot.customStaticProps;
	_textSizes = snapshot.textSizes;
	_fontFamilies = snapshot.fontFamilies;
	_colorNames = snapshot.colorNames;
	// Clear global ri() cache — conflict resolution rules may have changed
	_riCache.clear();
	_latestSnapshot = snapshot;
	return snapshot;
}
