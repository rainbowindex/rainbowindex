/**
 * ri() — class merge function.
 * Replaces both tailwind-merge and clsx.
 *
 * Re-exported from the package's main and browser entries as `ri()`.
 * Right-to-left scan: rightmost class wins when two classes set the same CSS property.
 *
 * This file is the pure merge runtime. Its siblings hold the other merge
 * concepts: props.ts (claim data), resolve.ts (dual-mode claim resolution),
 * context.ts (compilation-context lifecycle + published state), analyze.ts
 * (editor-only merge diagnostics).
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

import { OVERRIDES } from "./props.js";
import {
	type CompilationSnapshot,
	defaultRiCache,
	hasFinalizedSnapshot,
	resolveProps,
	resolverFor,
} from "./context.js";
import { scanBracketAware } from "../brackets.js";
import { devWarn, IS_DEV } from "../runtime.js";

// ---------------------------------------------------------------------------
// LRU cache for ri() — avoids re-computing conflict resolution for repeated calls
// ---------------------------------------------------------------------------

const RI_CACHE_MAX = 500;
/** Maximum cache key length — oversized inputs bypass the cache to prevent memory waste. */
const RI_CACHE_KEY_MAX_LEN = 2048;

// Hoisted — splitBracketAware's fast path runs per uncached ri() call.
const WS_SPLIT_RE = /\s+/;

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
 * Optional trace for mergeUncached — filled only when a caller (analyzeMerge)
 * provides one, so the ri() hot path pays a single falsy check per property.
 * Declared here rather than in analyze.ts because it types mergeUncached's
 * parameter — analyze.ts imports it alongside mergeUncached.
 */
export interface MergeTrace {
	/** Claim key (namespace + property) → index of the class that claimed it. */
	claimers: Map<string, number>;
	/** Dropped classes in scan order with the indices that dominated them. */
	dropped: Array<{ index: number; overriddenBy: number[] }>;
}

/**
 * Core merge algorithm shared by ri() and createRi().
 * Right-to-left scan: rightmost class wins conflicts.
 * Exported for analyze.ts, which threads a MergeTrace through it.
 */
export function mergeUncached(
	classes: readonly string[],
	resolve: (utility: string) => readonly string[] | null,
	trace?: MergeTrace,
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
		if (dominated) {
			if (trace) {
				// Attribute the drop: every property was claimed, so each claim
				// key has a recorded owner. Multiple owners are legitimate —
				// px-4 + py-4 jointly dominate p-2.
				const by = new Set<number>();
				for (const prop of props) {
					const claimer = trace.claimers.get(ns + prop);
					if (claimer !== undefined) by.add(claimer);
				}
				trace.dropped.push({ index: i, overriddenBy: [...by].sort((a, b) => a - b) });
			}
			continue;
		}

		// Claim this class's CSS properties + expand shorthands
		for (const prop of props) {
			const key = ns + prop;
			if (trace && !claimed.has(key)) trace.claimers.set(key, i);
			claimed.add(key);
			// If this is a shorthand, also claim all its longhands.
			// OVERRIDES is null-prototype, so one bare lookup is own-key safe.
			const longhands = OVERRIDES[prop];
			if (longhands !== undefined) {
				for (const lh of longhands) {
					const longhandKey = ns + lh;
					if (trace && !claimed.has(longhandKey)) trace.claimers.set(longhandKey, i);
					claimed.add(longhandKey);
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

/**
 * Evict the oldest 25% of entries from a Map when it reaches `maxSize`.
 * ES6 Map iterates in insertion order, so the first entries are the oldest.
 * Call this BEFORE inserting a new entry. Exported for its unit tests.
 */
export function evictLRU<K, V>(cache: Map<K, V>, maxSize: number): void {
	if (cache.size < maxSize) return;
	const evictCount = maxSize >> 2; // 25%
	let count = 0;
	for (const key of cache.keys()) {
		if (count >= evictCount) break;
		cache.delete(key);
		count++;
	}
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

/** Build a warner that emits at most once per WARNING_THROTTLE_MS. Each warner
 *  keeps its own timestamp (initialized to -Infinity so the very first
 *  occurrence always emits immediately), and the message is computed lazily so
 *  throttled calls pay nothing beyond the time check. */
function throttledWarn<A extends unknown[]>(
	message: (...args: A) => string,
	emit: (msg: string) => void = console.warn,
): (...args: A) => void {
	let last = Number.NEGATIVE_INFINITY;
	return (...args: A) => {
		const now = Date.now();
		if (now - last >= WARNING_THROTTLE_MS) {
			last = now;
			emit(message(...args));
		}
	};
}

const warnSSRUsage = throttledWarn(() =>
	!hasFinalizedSnapshot()
		? // No compilation has ever finalized — module-level state is uninitialized
			// defaults. In SSR this almost certainly means ri() is being called without
			// a preceding compile pass, which will produce incorrect merge results
			// for custom utilities, text sizes, and font families.
			"[RI-2004] ri() called in an SSR environment before any compilation has finalized. " +
			"The default ri() export reads module-level state that has not been initialized. " +
			"Custom utilities, text sizes, and font families will not be recognized. " +
			"Use createRi(snapshot) for concurrent-safe class merging. See: https://rainbowindex.dev/docs/ssr"
		: "[RI-2004] The default ri() export uses module-level state and is not safe for concurrent " +
			"SSR requests. Use createRi(snapshot) for isolation. See: https://rainbowindex.dev/docs/ssr\n" +
			"This warning repeats every 60 s until resolved. In production SSR, switch to createRi(snapshot) " +
			"to prevent silent data corruption between concurrent requests.",
);
const warnFlattenDepth = throttledWarn(
	() =>
		`[RI-2011] ri() input nesting exceeds maximum depth of ${MAX_FLATTEN_DEPTH}. Deeply nested inputs are silently dropped. Flatten your class arrays to avoid this limit.`,
);
const warnTotalClasses = throttledWarn(
	() =>
		`[RI-2012] ri() input exceeds ${MAX_TOTAL_CLASSES} class limit. Excess classes are dropped to prevent memory exhaustion.`,
);
const warnClassLength = throttledWarn(
	(cls: string) =>
		`[RI-2006] Class name exceeds ${MAX_CLASS_NAME_LENGTH} character limit and was dropped: "${cls.slice(0, 40)}…". This is a safety guard against adversarial input in SSR. If this is intentional, shorten the class name.`,
);
const warnNonStringInput = throttledWarn(
	(input: unknown) =>
		`ri() inputs must be strings, arrays, or falsy — got ${typeof input}; value skipped. Object syntax ({ class: condition }) is not supported; use \`condition && "class"\` instead.`,
	devWarn,
);

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
		warnSSRUsage();
	}
	return mergeFrom(inputs, resolveProps, defaultRiCache);
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
	const resolve = resolverFor(snapshot);
	const cache = new Map<string, string>();

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
				warnFlattenDepth();
				continue;
			}
			stack.push([input, 0, depth + 1]);
		} else if (typeof input !== "string") {
			// clsx-style objects ({ active: true }) and numbers are not supported —
			// skip instead of crashing the render path. Dev-only + throttled.
			if (IS_DEV) {
				warnNonStringInput(input);
			}
		} else {
			const trimmed = input.trim();
			if (trimmed) {
				for (const cls of splitBracketAware(trimmed)) {
					if (result.length >= MAX_TOTAL_CLASSES) {
						warnTotalClasses();
						return result;
					}
					if (cls.length <= MAX_CLASS_NAME_LENGTH) {
						result.push(cls);
					} else {
						// Warn in all environments (not just __DEV__) since silently
						// dropping classes in production causes hard-to-debug styling
						// regressions. Throttled to avoid log flooding.
						warnClassLength(cls);
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
