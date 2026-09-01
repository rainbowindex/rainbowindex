/**
 * Compilation-context lifecycle — all mutable state behind ri().
 *
 * The engine creates a CompilationContext via createCompilationContext(),
 * mutates it during compilation (register* functions), then finalizes it so
 * ri() can read the published snapshot without interference from concurrent
 * compilations. Split from merge/index.ts so the merge algorithm stays pure
 * runtime and every piece of mutable state lives in one file.
 *
 * The default ri() cache lives here rather than next to the merge loop
 * because finalizeCompilationContext() must clear it: conflict resolution
 * rules may change between compilations, and stale entries from a previous
 * compilation (with different custom utilities) must never be returned.
 */

import { devWarn, IS_DEV } from "../runtime.js";
import { type CustomFunctionalEntry, DEFAULT_FONT_FAMILIES, resolvePropsWith } from "./resolve.js";

export interface CompilationContext {
	customStaticProps: Record<string, string[]>;
	/** Roots of functional `@utility name-*` entries → the properties they set. */
	customFunctionalProps: Record<string, string[]>;
	textSizes: Set<string>;
	fontFamilies: Set<string>;
	colorNames: Set<string>;
}

/** Finalized snapshot — read by ri() via resolveProps(). Immutable between compilations. */
let _customStaticProps: Readonly<Record<string, string[]>> = {};
let _customFunctionalProps: readonly CustomFunctionalEntry[] = [];
let _textSizes: ReadonlySet<string> = new Set();
let _fontFamilies: ReadonlySet<string> = new Set(DEFAULT_FONT_FAMILIES);
let _colorNames: ReadonlySet<string> = new Set();

/**
 * Frozen snapshot of compilation state for SSR-safe ri() instances.
 * Created by finalizeCompilationContext() and consumed by createRi().
 */
export type { CustomFunctionalEntry };

export interface CompilationSnapshot {
	readonly customStaticProps: Readonly<Record<string, string[]>>;
	/** Longest root first, so `glow-outer-*` wins over `glow-*` for `glow-outer-4`. */
	readonly customFunctionalProps: readonly CustomFunctionalEntry[];
	readonly textSizes: ReadonlySet<string>;
	readonly fontFamilies: ReadonlySet<string>;
	readonly colorNames: ReadonlySet<string>;
}

/** Latest snapshot, used by createRi() to capture state at finalization time. */
let _latestSnapshot: CompilationSnapshot | null = null;

/** Whether any compilation has ever finalized — drives ri()'s SSR guidance. */
export function hasFinalizedSnapshot(): boolean {
	return _latestSnapshot !== null;
}

/** Per-generation bound for ri() caches — a cache holds at most ~2x this. */
export const RI_CACHE_MAX = 500;

/**
 * Two-generation cache for ri() results (the tailwind-merge design). Hits are
 * the steady state — ri() runs per component per render — so a hit in the
 * current generation costs one Map.get, with none of the delete/re-insert
 * churn of a Map-order LRU. When the current generation fills it becomes the
 * previous one and a fresh Map starts; hits on previous entries promote them
 * into current, so hot keys survive the swap while cold keys age out with the
 * dropped generation.
 */
export class RiCache {
	private current = new Map<string, string>();
	private previous = new Map<string, string>();

	constructor(private readonly maxSize: number) {}

	get(key: string): string | undefined {
		const hit = this.current.get(key);
		if (hit !== undefined) return hit;
		const promoted = this.previous.get(key);
		if (promoted !== undefined) this.put(key, promoted);
		return promoted;
	}

	put(key: string, value: string): void {
		this.current.set(key, value);
		if (this.current.size >= this.maxSize) {
			this.previous = this.current;
			this.current = new Map();
		}
	}

	has(key: string): boolean {
		return this.current.has(key) || this.previous.has(key);
	}

	get size(): number {
		return this.current.size + this.previous.size;
	}

	clear(): void {
		this.current.clear();
		this.previous.clear();
	}
}

/** Global cache for the default ri() export. Cleared on every
 *  finalizeCompilationContext() call so stale entries from previous
 *  compilations (with different custom utilities) are never returned.
 *  SSR/multi-tenant environments should use createRi(), which gets
 *  its own isolated cache. */
export const defaultRiCache = new RiCache(RI_CACHE_MAX);

/** Convenience resolver over the published module-level state (used by the default ri()). */
export function resolveProps(utility: string): readonly string[] | null {
	return resolvePropsWith(
		utility,
		_customStaticProps,
		_customFunctionalProps,
		_textSizes,
		_fontFamilies,
		_colorNames,
	);
}

/**
 * Build a resolve closure bound to `snapshot`, falling back to the latest
 * finalized snapshot, then to the live published state. Shared by createRi()
 * and analyzeMerge() so their snapshot-fallback semantics cannot drift.
 */
export function resolverFor(
	snapshot?: CompilationSnapshot,
): (utility: string) => readonly string[] | null {
	const snap = snapshot ??
		_latestSnapshot ?? {
			customStaticProps: _customStaticProps,
			customFunctionalProps: _customFunctionalProps,
			textSizes: _textSizes,
			fontFamilies: _fontFamilies,
			colorNames: _colorNames,
		};
	return (utility) =>
		resolvePropsWith(
			utility,
			snap.customStaticProps,
			snap.customFunctionalProps,
			snap.textSizes,
			snap.fontFamilies,
			snap.colorNames,
		);
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
		customFunctionalProps: {},
		textSizes: new Set(),
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
	functional = false,
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
	if (functional) ctx.customFunctionalProps[name] = properties;
	else ctx.customStaticProps[name] = properties;
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
		customFunctionalProps: Object.entries(ctx.customFunctionalProps)
			.map(([k, v]): CustomFunctionalEntry => [k, [...v]])
			.sort((a, b) => b[0].length - a[0].length),
		textSizes: new Set(ctx.textSizes),
		fontFamilies: new Set(ctx.fontFamilies),
		colorNames: new Set(ctx.colorNames),
	};
}

/**
 * Snapshot compilation context into module-level state that ri() reads from.
 * Called at the end of compile() to atomically publish the new state.
 */
export function finalizeCompilationContext(ctx: CompilationContext): CompilationSnapshot {
	const snapshot = snapshotCompilationContext(ctx);
	_customStaticProps = snapshot.customStaticProps;
	_customFunctionalProps = snapshot.customFunctionalProps;
	_textSizes = snapshot.textSizes;
	_fontFamilies = snapshot.fontFamilies;
	_colorNames = snapshot.colorNames;
	// Clear global ri() cache — conflict resolution rules may have changed
	defaultRiCache.clear();
	_latestSnapshot = snapshot;
	return snapshot;
}
