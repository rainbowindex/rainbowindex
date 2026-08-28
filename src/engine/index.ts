/**
 * Engine — compile utility class names into CSS.
 *
 * Flow: class names → parse → resolve → sort → emit CSS string.
 */

import { parseUtility, type ParsedUtility } from "../utilities/parser.js";
import type { ResolvedTheme } from "../directives/foundation.js";
import { resolveUtilityDeclarations, extractCustomUtilityRootInfo } from "../utilities/index.js";
import type { CSSDeclaration, UtilityNestedBlock } from "../utilities/helpers.js";
import { buildBreakpointWeights, computeSortKey } from "./ordering.js";
import {
	createCompilationContext,
	registerCustomUtility,
	registerCustomTextSizes,
	registerCustomFontFamilies,
	registerColorNames,
	snapshotCompilationContext,
} from "../merge/context.js";
import { createRi } from "../merge/index.js";
import { DEFAULT_TEXT_SIZES } from "../merge/resolve.js";
import { pushWarningsDeduped } from "../warnings.js";
import { escapeSelector } from "../css/escape.js";
import {
	ANIMATE_VAR_REF_RE,
	COLOR_STOP_REF_RE,
	FONT_VAR_REF_RE,
	SHADOW_VAR_REF_RE,
	TEXT_VAR_REF_RE,
} from "../css/token-refs.js";
import { codepointCompare } from "../shared.js";
import { applyVariantWrappers, resolveVariant, type VariantWrapper } from "./variants.js";
import { SUPPORT_BLOCKS } from "./support-blocks.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompiledRule {
	/** The original class name (escaped for CSS selector). */
	selector: string;
	/** Sort key for deterministic ordering. */
	sortKey: number;
	/** CSS declarations as a string block. */
	css: string;
}

export interface CompilationResult {
	/** All compiled CSS rules. */
	rules: CompiledRule[];
	/** @keyframes blocks needed. */
	keyframes: string[];
	/** @property declarations needed. */
	properties: string[];
	/** Map of used color hue → set of used suffixes (for token pruning). */
	usedColorStops: Map<string, Set<number>>;
	/** Set of used text size names (for token pruning). */
	usedTextSizes: Set<string>;
	/** Set of used font slot names (for token pruning). */
	usedFonts: Set<string>;
	/** Set of used rounded value names (for token pruning). */
	/** Set of used shadow names (for token pruning). */
	usedShadows: Set<string>;
	/** Set of used animation shorthand names (for token pruning). */
	usedAnimations: Set<string>;
	/** Warnings emitted during compilation. */
	warnings: string[];
}

export { resolveVariant } from "./variants.js";
export type { VariantWrapper } from "./variants.js";

/**
 * Optional out-param for compileUtility: when provided, records WHY a class
 * produced no rule (compile keeps dropping silently — reserved RI-1001) and,
 * on success, the utility's root declarations. Callers reuse one mutable
 * instance so the compile hot path never allocates for it.
 */
export interface ClassResolutionDetail {
	/** Failure reason — null after a successful resolve. */
	reason: "unknown-utility" | "unknown-variant" | null;
	/** The offending variant when reason is "unknown-variant". */
	variant: string | null;
	/** Root declarations (before variant wrapping) on success. */
	declarations: CSSDeclaration[] | null;
}

/** Frozen empty map singleton — avoids per-compilation allocation when no custom variants exist. */
const _emptyVariantMap: ReadonlyMap<string, { name: string; selector: string }> = Object.freeze(
	new Map(),
);

/** Whitespace splitter shared by string-input handling and @apply expansion. */
const WS_RE = /\s+/;

// ---------------------------------------------------------------------------
// Core Compilation
// ---------------------------------------------------------------------------

/**
 * Compile a single parsed utility into a CSS rule.
 *
 * `detail`, when provided, is filled with the failure reason (or the root
 * declarations on success) — the class inspector's window into the exact
 * resolution the compile path performs. Omitted on the build path.
 */
export function compileUtility(
	parsed: ParsedUtility,
	theme: ResolvedTheme,
	result: CompilationResult,
	customVariantMap: ReadonlyMap<string, { name: string; selector: string }>,
	warnSeen: Set<string>,
	breakpointWeights: ReadonlyMap<string, number>,
	variantMemo: Map<string, VariantWrapper | null>,
	detail?: ClassResolutionDetail,
): CompiledRule | null {
	if (detail) {
		detail.reason = null;
		detail.variant = null;
		detail.declarations = null;
	}
	// Resolve utility to CSS declarations (handles arbitrary properties,
	// standard utilities, and physical property expansion).
	const utilResult = resolveUtilityDeclarations(parsed, theme, result.warnings);
	if (!utilResult) {
		if (detail) detail.reason = "unknown-utility";
		return null;
	}
	if (detail) detail.declarations = utilResult.declarations;

	// Track token references for tree-shaking.
	for (const decl of utilResult.declarations) {
		scanStringForTokenUsage(decl.value, result);
	}
	if (utilResult.nested) {
		scanNestedTokenUsage(utilResult.nested, result);
	}

	// Build selector
	const escapedClass = escapeSelector(parsed.raw);
	let selector = `.${escapedClass}`;

	// Build CSS from declarations
	let declCSS = utilResult.declarations
		.map((d) => `  ${d.property}: ${d.value}${parsed.important ? " !important" : ""};`)
		.join("\n");

	// Handle nested selectors (space-x, divide-y)
	if (utilResult.nestedSelector) {
		declCSS = `  ${utilResult.nestedSelector} {\n  ${declCSS}\n  }`;
	}

	// Custom-utility nested blocks emit with native CSS nesting so the authored
	// selector semantics (`&`, implicit descendant, nested at-rules) are the
	// browser's, not ours.
	if (utilResult.nested) {
		const parts = declCSS.length > 0 ? [declCSS] : [];
		for (const block of utilResult.nested) {
			parts.push(renderNestedBlock(block, "  ", parsed.important));
		}
		declCSS = parts.join("\n");
	}

	// Resolve variants
	let wrappers: VariantWrapper[] | null = null;

	for (const variant of parsed.variants) {
		const wrapper = resolveVariant(variant, theme, customVariantMap, variantMemo);
		if (!wrapper) {
			if (detail) {
				detail.reason = "unknown-variant";
				detail.variant = variant;
			}
			pushWarningsDeduped(
				result.warnings,
				[
					`[RI-1004] Unknown variant "${variant}" in "${parsed.raw}". Check spelling, or register it with \`@custom ${variant} { &:where(...) { @slot; } }\`. Built-in variants include hover, focus, dark, sm/md/lg/xl, data-[attr=value], and arbitrary [selector].`,
				],
				warnSeen,
			);
			return null;
		}
		if (!wrappers) wrappers = [];
		wrappers.push(wrapper);
	}

	// Apply the wrappers via the shared cascade model (also used by @apply's
	// AST emitter). Skipped entirely for variant-less classes so the hot path
	// stays allocation-free.
	let atRuleOpen = "";
	let atRuleClose = "";
	let startingStyleWrap = false;
	if (wrappers) {
		const applied = applyVariantWrappers(selector, wrappers);
		selector = applied.selector;
		for (const atRule of applied.atRules) {
			atRuleOpen += `${atRule} {\n`;
			atRuleClose = `}\n${atRuleClose}`;
		}
		startingStyleWrap = applied.startingStyle;
	}

	// Build final CSS
	let css: string;
	if (startingStyleWrap) {
		const indentedDecls = declCSS.replace(/\n/g, "\n  ");
		css = `${selector} {\n  @starting-style {\n  ${indentedDecls}\n  }\n}`;
	} else {
		css = `${selector} {\n${declCSS}\n}`;
	}

	if (atRuleOpen) {
		css = `${atRuleOpen}${css}\n${atRuleClose}`;
	}

	// Compute sort key
	const cssProperty = utilResult.declarations[0]?.property || "";
	const sortKey = computeSortKey(cssProperty, parsed.variants, breakpointWeights);

	return { selector, sortKey, css };
}

// ---------------------------------------------------------------------------
// Keyframes & @property Generation
// ---------------------------------------------------------------------------

// The @property/@keyframes data and the substring tests that trigger it live
// in support-blocks.ts — one table shared by the compile loop and
// scanCSSForTokenUsage so the two detection sites can't drift.
export { ANIMATION_KEYFRAMES, ANIMATION_PROPERTIES } from "./support-blocks.js";

// Re-export compileCSSFunctions from dedicated module
export { compileCSSFunctions, hasCSSFunctions } from "../css/functions.js";

/**
 * Record token-variable references found in `str` (color stops, text sizes,
 * fonts, rounded, shadows, animations) into `result`, so the token layer keeps
 * only what's used. Shared by per-declaration scanning (compileUtility) and
 * whole-CSS scanning (scanCSSForTokenUsage) so the two can't drift. Fast-path:
 * skip each regex unless its `var(--prefix` is present.
 */
function scanStringForTokenUsage(str: string, result: CompilationResult): void {
	if (str.includes("var(--color-")) {
		for (const m of str.matchAll(COLOR_STOP_REF_RE)) {
			const hue = m[1];
			const suffix = m[2] ? Number(m[2]) : undefined;
			if (suffix !== undefined) {
				let set = result.usedColorStops.get(hue);
				if (!set) {
					set = new Set();
					result.usedColorStops.set(hue, set);
				}
				set.add(suffix);
			}
		}
	}
	if (str.includes("var(--text-")) {
		for (const m of str.matchAll(TEXT_VAR_REF_RE)) {
			result.usedTextSizes.add(m[1]);
		}
	}
	if (str.includes("var(--font-")) {
		for (const m of str.matchAll(FONT_VAR_REF_RE)) {
			result.usedFonts.add(m[1]);
		}
	}
	if (str.includes("var(--shadow-")) {
		for (const m of str.matchAll(SHADOW_VAR_REF_RE)) {
			result.usedShadows.add(m[1]);
		}
	}
	if (str.includes("var(--animate-")) {
		for (const m of str.matchAll(ANIMATE_VAR_REF_RE)) {
			result.usedAnimations.add(m[1]);
		}
	}
}

/** Recursive companion to scanStringForTokenUsage for custom-utility nested
 *  blocks — without it, token pruning would drop :root variables referenced
 *  only inside a nested rule. */
function scanNestedTokenUsage(blocks: UtilityNestedBlock[], result: CompilationResult): void {
	for (const block of blocks) {
		for (const decl of block.declarations) {
			scanStringForTokenUsage(decl.value, result);
		}
		if (block.nested.length > 0) {
			scanNestedTokenUsage(block.nested, result);
		}
	}
}

/** Render one custom-utility nested block as native CSS nesting at `indent`. */
function renderNestedBlock(block: UtilityNestedBlock, indent: string, important: boolean): string {
	const inner = `${indent}  `;
	const lines: string[] = [`${indent}${block.selector} {`];
	for (const d of block.declarations) {
		lines.push(`${inner}${d.property}: ${d.value}${important ? " !important" : ""};`);
	}
	for (const child of block.nested) {
		lines.push(renderNestedBlock(child, inner, important));
	}
	lines.push(`${indent}}`);
	return lines.join("\n");
}

/**
 * Scan raw CSS text for token variable references and merge them into
 * an existing CompilationResult. This ensures that user-authored CSS
 * containing e.g. `var(--text-lg)` or `var(--font-sans)` marks those
 * tokens as used before the token layer is generated.
 */
export function scanCSSForTokenUsage(css: string, result: CompilationResult): void {
	scanStringForTokenUsage(css, result);
	// Detect support-block usage in user CSS (e.g. via @apply) so @property
	// declarations are emitted even when no matching utility class names are
	// scanned from source files. The sentinel check dedups against blocks the
	// compile loop already pushed.
	for (const block of SUPPORT_BLOCKS) {
		if (block.compileLoopOnly) continue;
		if (!block.test(css)) continue;
		if (result.properties.some((p) => p.includes(block.sentinel))) continue;
		result.properties.push(...block.properties);
	}
}

// ---------------------------------------------------------------------------
// Core compilation loop
// ---------------------------------------------------------------------------

/** Built-in text size names — used to identify custom text sizes.
 *  Derived from merge runtime defaults (single source of truth). */
const BUILTIN_TEXT_SIZES: ReadonlySet<string> = new Set(DEFAULT_TEXT_SIZES);

/** Fresh, empty CompilationResult — shared by the compile loop and the class
 *  inspector (which needs a scratch result for warning/token bookkeeping). */
export function createEmptyCompilationResult(): CompilationResult {
	return {
		rules: [],
		keyframes: [],
		properties: [],
		usedColorStops: new Map(),
		usedTextSizes: new Set(),
		usedFonts: new Set(),
		usedShadows: new Set(),
		usedAnimations: new Set(),
		warnings: [],
	};
}

/**
 * Everything compiling one class contributes to a CompilationResult: its rule
 * (or null), the warnings it emitted, the token references it recorded, and
 * which SUPPORT_BLOCKS rows it matched (index-aligned with the table; all
 * false on failure). Captured once per (theme, class) and replayed on hits.
 */
interface ClassCompileEntry {
	rule: CompiledRule | null;
	warnings: readonly string[];
	/** RI-1002 text, held back because it is only emitted for authored classes.
	 *  Kept off `warnings` so one memo entry serves both provenances. */
	arbitraryWarning: string | null;
	usedColorStops: ReadonlyMap<string, ReadonlySet<number>>;
	usedTextSizes: ReadonlySet<string>;
	usedFonts: ReadonlySet<string>;
	usedShadows: ReadonlySet<string>;
	usedAnimations: ReadonlySet<string>;
	support: readonly boolean[];
}

/**
 * Per-theme, per-class compile memo. A class's compile output is a pure
 * function of (raw class, theme) — the utility/variant resolvers read no other
 * mutable state — and entries (including CompiledRule objects) are never
 * mutated after creation, so sharing them across compilations and compiler
 * instances is safe. Watch rebuilds present the same theme identity (see the
 * project/scan.ts and project/pipeline.ts memos) and skip re-parsing and
 * re-resolving every unchanged class. Keyed weakly: dropping a theme drops
 * its entries. Like every theme-keyed cache here, this assumes ResolvedTheme
 * objects are not mutated between compiles.
 */
const classCompileMemo = new WeakMap<ResolvedTheme, Map<string, ClassCompileEntry>>();

/** Cleared wholesale at the cap (inspector.ts RESOLUTION_CACHE_CAP pattern).
 *  Steady-state size is the project's whole scanned token vocabulary, so the
 *  cap sits well above it — a lower cap would clear mid-compile on every
 *  rebuild and defeat the memo. */
const CLASS_COMPILE_MEMO_CAP = 50_000;

/** Compile one class into a self-contained memo entry via a scratch result. */
function compileClassEntry(
	raw: string,
	theme: ResolvedTheme,
	customVariantMap: ReadonlyMap<string, { name: string; selector: string }>,
	breakpointWeights: ReadonlyMap<string, number>,
	variantMemo: Map<string, VariantWrapper | null>,
): ClassCompileEntry {
	const scratch = createEmptyCompilationResult();
	const parsed = parseUtility(raw);
	const rule = compileUtility(
		parsed,
		theme,
		scratch,
		customVariantMap,
		new Set(),
		breakpointWeights,
		variantMemo,
	);
	const support: boolean[] = new Array(SUPPORT_BLOCKS.length).fill(false);
	let arbitraryWarning: string | null = null;
	if (rule) {
		for (let i = 0; i < SUPPORT_BLOCKS.length; i++) {
			const block = SUPPORT_BLOCKS[i];
			if (block.test(rule.css) || block.utilities?.includes(parsed.utility)) {
				support[i] = true;
			}
		}
	} else if (parsed.arbitrary && parsed.value) {
		const bracketContent = parsed.value.replace(/^\[|\]$/g, "");
		if (shouldWarnUnresolvedArbitrary(bracketContent)) {
			const truncated = parsed.raw.length > 100 ? `${parsed.raw.slice(0, 100)}...` : parsed.raw;
			arbitraryWarning = `[RI-1002] Could not resolve arbitrary utility "${truncated}". Arbitrary utilities use \`[property:value]\` syntax — e.g. \`[padding:1rem]\` or \`[mask-type:luminance]\`. Check that the property name is a known CSS property and the value is well-formed (no stray spaces, quoted strings escaped). If you meant to set a CSS variable, use \`[--my-var:value]\`.`;
		}
	}
	return {
		rule,
		warnings: scratch.warnings,
		arbitraryWarning,
		usedColorStops: scratch.usedColorStops,
		usedTextSizes: scratch.usedTextSizes,
		usedFonts: scratch.usedFonts,
		usedShadows: scratch.usedShadows,
		usedAnimations: scratch.usedAnimations,
		support,
	};
}

function shouldWarnUnresolvedArbitrary(bracketContent: string): boolean {
	// Attribute-selector style or wildcard syntax is typically intentional and
	// not a utility typo (e.g. data-[state=*] extracted from markup).
	if (/[=*]/.test(bracketContent)) return false;
	// Whitespace inside [] is usually from JS expressions, not utility classes.
	if (/\s/.test(bracketContent)) return false;
	// Heuristic: identifier arithmetic/indexing patterns are likely JS, not CSS.
	if (/^[a-z_$][\w$]*(?:[+\-*/](?:\d+|[a-z_$][\w$]*))+$/i.test(bracketContent)) return false;
	return true;
}

/**
 * Core compilation loop behind `createCompiler().compile()`: registers custom
 * tokens/utilities on the compilation context, compiles each class once, and
 * sorts the rules deterministically.
 *
 * `variantMapCache` is the caller's per-instance WeakMap (keyed by theme) so
 * concurrent compiler instances never share cached custom-variant maps.
 */
/**
 * Register a theme's custom tokens and utilities on a compilation context —
 * the merge-side knowledge (custom text sizes, font slots, color names,
 * custom utility property claims) that makes ri()/analyzeMerge() resolve
 * theme-defined classes correctly. Shared by the compile loop and
 * createThemeSnapshot().
 */
export function registerThemeOnContext(
	ctx: ReturnType<typeof createCompilationContext>,
	theme: ResolvedTheme,
): void {
	const customTextSizeNames = Object.keys(theme.text).filter(
		(name) => !BUILTIN_TEXT_SIZES.has(name),
	);
	if (customTextSizeNames.length > 0) registerCustomTextSizes(ctx, customTextSizeNames);
	const customFontSlots: string[] = [];
	for (const f of theme.fonts) {
		if (f.slot !== "sans" && f.slot !== "serif" && f.slot !== "mono") customFontSlots.push(f.slot);
	}
	if (customFontSlots.length > 0) registerCustomFontFamilies(ctx, customFontSlots);
	registerColorNames(ctx, Object.keys(theme.colors));
	for (const cu of theme.customUtilities) {
		// Root-level only: nested blocks style descendants/other states, so their
		// properties must not make the utility conflict with same-property classes
		// on the element itself. resolveUtilityDeclarations returns root
		// declarations only, so transitive @apply props stay root-scoped too.
		const { properties, applyClasses } = extractCustomUtilityRootInfo(cu.body);
		for (const cls of applyClasses) {
			const parsed = parseUtility(cls);
			const result = resolveUtilityDeclarations(parsed, theme);
			if (result) {
				for (const d of result.declarations) {
					properties.push(d.property);
				}
			}
		}
		if (properties.length > 0) {
			registerCustomUtility(ctx, cu.name, properties, cu.functional);
		}
	}
}

/**
 * Build a CompilationSnapshot straight from a resolved theme — no compile
 * pass, no module-level state. Editor tooling pairs this with
 * analyzeMerge()/createRi() for theme-accurate merge semantics.
 */
export function createThemeSnapshot(
	theme: ResolvedTheme,
): import("../merge/context.js").CompilationSnapshot {
	const ctx = createCompilationContext();
	registerThemeOnContext(ctx, theme);
	return snapshotCompilationContext(ctx);
}

function compileInternal(
	classNames: Iterable<string>,
	theme: ResolvedTheme,
	variantMapCache: WeakMap<ResolvedTheme, ReadonlyMap<string, { name: string; selector: string }>>,
	authored?: ReadonlySet<string>,
): { result: CompilationResult; ctx: ReturnType<typeof createCompilationContext> } {
	const ctx = createCompilationContext();
	registerThemeOnContext(ctx, theme);

	const customVariantMap =
		theme.customVariants.length === 0
			? _emptyVariantMap
			: (variantMapCache.get(theme) ??
				(() => {
					const map = new Map(theme.customVariants.map((cv) => [cv.name, cv]));
					variantMapCache.set(theme, map);
					return map;
				})());

	const result = createEmptyCompilationResult();

	// Per-compilation warning dedup state shared across all pushWarningsDeduped calls.
	const warnSeen = new Set<string>();

	// Per-compilation variant state: theme-derived breakpoint weights for sort
	// keys, and a memo so repeated variants resolve the branch cascade once.
	const breakpointWeights = buildBreakpointWeights(theme.breakpoints);
	const variantMemo = new Map<string, VariantWrapper | null>();

	const seen = new Set<string>();
	// One slot per SUPPORT_BLOCKS row — set once per compilation, replayed from
	// each class entry's cached match flags.
	const supportNeeded: boolean[] = new Array(SUPPORT_BLOCKS.length).fill(false);

	let classMemo = classCompileMemo.get(theme);
	if (!classMemo) {
		classMemo = new Map();
		classCompileMemo.set(theme, classMemo);
	}

	for (const raw of classNames) {
		if (seen.has(raw)) continue;
		seen.add(raw);

		let entry = classMemo.get(raw);
		if (!entry) {
			if (classMemo.size >= CLASS_COMPILE_MEMO_CAP) classMemo.clear();
			entry = compileClassEntry(raw, theme, customVariantMap, breakpointWeights, variantMemo);
			classMemo.set(raw, entry);
		}

		// Replay the entry into this compilation's mutable containers — the
		// memoized containers themselves are never handed out.
		if (entry.warnings.length > 0) {
			pushWarningsDeduped(result.warnings, entry.warnings as string[], warnSeen);
		}
		// An unresolved arbitrary value is a typo worth reporting only when the
		// author wrote the class. Scanning reads whole files, prose comments
		// included, where a bracket token like `min-[437px]` is just text.
		if (entry.arbitraryWarning !== null && (authored === undefined || authored.has(raw))) {
			pushWarningsDeduped(result.warnings, [entry.arbitraryWarning], warnSeen);
		}
		for (const [hue, stops] of entry.usedColorStops) {
			let set = result.usedColorStops.get(hue);
			if (!set) {
				set = new Set();
				result.usedColorStops.set(hue, set);
			}
			for (const stop of stops) set.add(stop);
		}
		for (const v of entry.usedTextSizes) result.usedTextSizes.add(v);
		for (const v of entry.usedFonts) result.usedFonts.add(v);
		for (const v of entry.usedShadows) result.usedShadows.add(v);
		for (const v of entry.usedAnimations) result.usedAnimations.add(v);

		if (!entry.rule) continue;
		result.rules.push(entry.rule);

		for (let i = 0; i < SUPPORT_BLOCKS.length; i++) {
			if (entry.support[i]) supportNeeded[i] = true;
		}
	}

	// Tie-break equal sort keys (e.g. pt-4 vs pt-8) by selector codepoint so
	// scan/glob order never leaks into the output — the byte-identical invariant.
	result.rules.sort(
		(a, b) =>
			a.sortKey - b.sortKey ||
			codepointCompare(a.selector, b.selector) ||
			codepointCompare(a.css, b.css),
	);

	// Push matched support blocks in table order — same output byte layout as
	// the former per-family push blocks.
	for (let i = 0; i < SUPPORT_BLOCKS.length; i++) {
		if (!supportNeeded[i]) continue;
		const block = SUPPORT_BLOCKS[i];
		if (block.keyframes) {
			result.keyframes.push(...block.keyframes);
		}
		result.properties.push(...block.properties);
	}

	// Pre-build a set of animation base names from seen classes — O(n) once,
	// then O(1) lookup per keyframe instead of O(k*n) nested iteration.
	const animationBases = new Set<string>();
	for (const c of seen) {
		const colonIdx = c.lastIndexOf(":");
		let base = colonIdx === -1 ? c : c.slice(colonIdx + 1);
		if (base.charCodeAt(0) === 33 /* '!' */) base = base.slice(1);
		if (base.startsWith("animate-")) {
			animationBases.add(base);
		}
	}

	// Emit @keyframes straight from the theme for used animations — no
	// stringify-then-reparse round trip.
	for (const [name, def] of Object.entries(theme.animations)) {
		if (def.keyframes && animationBases.has(`animate-${name}`)) {
			result.keyframes.push(`@keyframes ${name} {\n  ${def.keyframes}\n}`);
		}
	}

	return { result, ctx };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a CompilationResult to a final CSS string.
 */
export function renderCSS(result: CompilationResult): string {
	const parts: string[] = [];

	// @property declarations
	if (result.properties.length > 0) {
		parts.push(result.properties.join("\n\n"));
	}

	// @keyframes
	if (result.keyframes.length > 0) {
		parts.push(result.keyframes.join("\n\n"));
	}

	// Rules
	if (result.rules.length > 0) {
		parts.push(result.rules.map((r) => r.css).join("\n\n"));
	}

	return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// SSR-safe compiler factory
// ---------------------------------------------------------------------------

/**
 * Create an isolated compiler instance for SSR / concurrent-compilation
 * environments. Returns a `compile()` function that does NOT touch module-level
 * state, and a `createRi()` that produces a merge function bound to the
 * compilation's snapshot.
 *
 * **Isolation scope:** Compilation context, variant map cache, and font output
 * cache are fully isolated per instance. Google Fonts metadata (from fonts.ts)
 * is intentionally shared read-only across instances — it is populated once
 * via atomic swap and never mutated afterward, so concurrent reads are safe.
 *
 * **Font output cache lifecycle:** `fontOutputCache` is cleared at the start
 * of each `compile()` call, so it only caches within a single compilation pass.
 * If the same compiler instance is reused across compilations (the expected SSR
 * pattern), each compilation starts with a fresh font cache.
 *
 * @example
 * ```ts
 * import { createCompiler } from "rainbowindex";
 *
 * const compiler = createCompiler();
 * const result = compiler.compile(classNames, theme);
 * const ri = compiler.createRi();
 * ```
 */
export function createCompiler(): {
	/** `authored` names the classes the user wrote by hand (`@source inline`,
	 *  `@apply`, a caller-supplied list). Omit it to treat every class as
	 *  authored — correct for callers who assembled the list themselves. */
	compile: (
		classNames: Iterable<string>,
		theme: ResolvedTheme,
		authored?: ReadonlySet<string>,
	) => CompilationResult;
	createRi: () => (...inputs: (string | false | null | undefined)[]) => string;
	/** Isolated font output cache for this compiler instance. Pass to
	 *  `assembleSections()` to avoid sharing module-level font state. */
	fontOutputCache: Map<string, import("../integrations/font-providers/index.js").FontOutput>;
} {
	let latestSnapshot: import("../merge/context.js").CompilationSnapshot | null = null;
	const fontOutputCache = new Map<
		string,
		import("../integrations/font-providers/index.js").FontOutput
	>();
	// Isolated variant map cache so concurrent compiler instances don't
	// share cached variant maps keyed on theme object identity.
	const variantMapCache = new WeakMap<
		ResolvedTheme,
		ReadonlyMap<string, { name: string; selector: string }>
	>();

	return {
		fontOutputCache,

		compile(
			classNames: Iterable<string>,
			theme: ResolvedTheme,
			authored?: ReadonlySet<string>,
		): CompilationResult {
			// A bare string is iterable per-character — treat it as a
			// whitespace-separated class list instead of silently compiling nothing.
			const list =
				typeof classNames === "string" ? classNames.split(WS_RE).filter(Boolean) : classNames;
			if (list == null || typeof list[Symbol.iterator] !== "function") {
				throw new TypeError(
					`[RI-2008] compile() expected classNames to be iterable, got ${typeof classNames}.`,
				);
			}
			if (!theme || typeof theme !== "object") {
				throw new TypeError(
					`[RI-2007] compile() expected theme to be a ResolvedTheme object, got ${typeof theme}.`,
				);
			}
			// No module-level merge state is touched here.
			const { result, ctx } = compileInternal(list, theme, variantMapCache, authored);

			// Snapshot without publishing to module-level globals.
			latestSnapshot = snapshotCompilationContext(ctx);

			// Clear instance-scoped font cache between compilations
			fontOutputCache.clear();

			return result;
		},

		createRi() {
			return createRi(latestSnapshot ?? undefined);
		},
	};
}
