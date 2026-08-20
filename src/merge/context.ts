/**
 * Compilation-context lifecycle — all mutable state behind ri().
 *
 * The engine creates a CompilationContext via createCompilationContext(),
 * mutates it during compilation (register* functions), then finalizes it so
 * ri() can read the published snapshot without interference from concurrent
 * compilations. Split from merge/index.ts so the merge algorithm stays pure
 * runtime and every piece of mutable state lives in one file.
 *
 * The default ri() LRU cache lives here rather than next to the merge loop
 * because finalizeCompilationContext() must clear it: conflict resolution
 * rules may change between compilations, and stale entries from a previous
 * compilation (with different custom utilities) must never be returned.
 */

import { devWarn, IS_DEV } from "../runtime.js";
import { DEFAULT_FONT_FAMILIES, DEFAULT_TEXT_SIZES, resolvePropsWith } from "./resolve.js";

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

/** Whether any compilation has ever finalized — drives ri()'s SSR guidance. */
export function hasFinalizedSnapshot(): boolean {
	return _latestSnapshot !== null;
}

/** Global LRU cache for the default ri() export. Cleared on every
 *  finalizeCompilationContext() call so stale entries from previous
 *  compilations (with different custom utilities) are never returned.
 *  SSR/multi-tenant environments should use createRi(), which gets
 *  its own isolated cache. */
export const defaultRiCache = new Map<string, string>();

/** Convenience resolver over the published module-level state (used by the default ri()). */
export function resolveProps(utility: string): readonly string[] | null {
	return resolvePropsWith(utility, _customStaticProps, _textSizes, _fontFamilies, _colorNames);
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
			textSizes: _textSizes,
			fontFamilies: _fontFamilies,
			colorNames: _colorNames,
		};
	return (utility) =>
		resolvePropsWith(
			utility,
			snap.customStaticProps,
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

/**
 * Snapshot compilation context into module-level state that ri() reads from.
 * Called at the end of compile() to atomically publish the new state.
 */
export function finalizeCompilationContext(ctx: CompilationContext): CompilationSnapshot {
	const snapshot = snapshotCompilationContext(ctx);
	_customStaticProps = snapshot.customStaticProps;
	_textSizes = snapshot.textSizes;
	_fontFamilies = snapshot.fontFamilies;
	_colorNames = snapshot.colorNames;
	// Clear global ri() cache — conflict resolution rules may have changed
	defaultRiCache.clear();
	_latestSnapshot = snapshot;
	return snapshot;
}
