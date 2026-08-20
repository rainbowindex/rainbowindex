/**
 * CSS section assembly, token layer generation, and font output caching.
 *
 * Assembles the final CSS output from a compilation result and theme.
 * Used by both the PostCSS plugin and CLI to ensure identical section ordering:
 *   @import → @property → @font-face → :root → corner-shape → @keyframes → preflight → utilities
 */

import type { PropertyRegistration, ResolvedTheme } from "./directives/foundation.js";
import {
	checkPaletteContrast,
	generateAllColorVariables,
	generateThemeOverrides,
} from "./theme/colors.js";
import {
	type FontSlot,
	generateFontCSS,
	SYSTEM_STACKS,
	type FontOutput,
} from "./integrations/font-providers/index.js";
import { type CompilationResult, renderCSS } from "./engine/index.js";
import { generatePreflight } from "./css/preflight.js";
import { COLOR_STOP_REF_RE, SHADOW_VAR_REF_RE } from "./css/token-refs.js";
import { codepointCompare } from "./shared.js";

/** Token usage sets extracted from CompilationResult for token layer pruning. */
interface TokenUsage {
	usedColorStops: Map<string, Set<number>>;
	usedTextSizes: Set<string>;
	usedFonts: Set<string>;
	usedRounded: Set<string>;
	usedShadows: Set<string>;
	usedAnimations: Set<string>;
}

// ---------------------------------------------------------------------------
// Token layer generation
// ---------------------------------------------------------------------------

export function generateTokenLayer(
	theme: ResolvedTheme,
	usage: TokenUsage,
	fontOutputCache: Map<string, FontOutput>,
): string {
	const vars: string[] = [];
	vars.push(`--spacing: ${theme.spacing.base};`);

	// Fluid scaling bounds
	vars.push(`--fluid-min: ${theme.fluid.min};`);
	vars.push(`--fluid-max: ${theme.fluid.max};`);
	if (theme.textFluid) {
		vars.push(`--fluid-text-min: ${theme.textFluid.min};`);
		vars.push(`--fluid-text-max: ${theme.textFluid.max};`);
	}
	if (theme.spacingFluid) {
		vars.push(`--fluid-spacing-min: ${theme.spacingFluid.min};`);
		vars.push(`--fluid-spacing-max: ${theme.spacingFluid.max};`);
	}

	// Color variables (only used hue+suffix pairs)
	// When "theme" is used and aliases another color, propagate suffixes to source
	const effectiveStops = new Map<string, Set<number>>(
		[...usage.usedColorStops].map(([k, v]) => [k, new Set(v)]),
	);
	const themeDef = theme.colors.theme;
	const themeSuffixes = effectiveStops.get("theme");
	if (themeDef && themeSuffixes && themeDef.type === "alias") {
		let sourceSuffixes = effectiveStops.get(themeDef.source);
		if (!sourceSuffixes) {
			sourceSuffixes = new Set();
			effectiveStops.set(themeDef.source, sourceSuffixes);
		}
		for (const s of themeSuffixes) sourceSuffixes.add(s);
	}

	// [data-theme] override blocks alias --color-theme-<n> to every inline
	// generative palette (generateThemeOverrides), so each inline color must
	// emit exactly the stops those blocks reference — otherwise switching
	// data-theme leaves --color-theme-<n> pointing at an undefined variable.
	if (themeDef && themeSuffixes) {
		for (const [name, def] of Object.entries(theme.colors)) {
			if (name === "theme" || def.type !== "generative" || !def.inline) continue;
			let stops = effectiveStops.get(name);
			if (!stops) {
				stops = new Set();
				effectiveStops.set(name, stops);
			}
			for (const s of themeSuffixes) stops.add(s);
		}
	}

	// Explicit/pair colors emit their --color-${name}: ... declaration
	// unconditionally, so any generative stops they reference (e.g.
	// `background: theme-22;` → `var(--color-theme-22)`) must be force-emitted
	// too — otherwise the var resolves to a dangling reference.
	for (const def of Object.values(theme.colors)) {
		const values =
			def.type === "explicit" ? [def.value] : def.type === "pair" ? [def.light, def.dark] : null;
		if (!values) continue;
		for (const v of values) {
			for (const m of v.matchAll(COLOR_STOP_REF_RE)) {
				// The shared regex also matches stop-less refs (var(--color-paper));
				// only hue+stop pairs participate in stop forcing.
				if (!m[2]) continue;
				const hue = m[1];
				const stop = Number(m[2]);
				let set = effectiveStops.get(hue);
				if (!set) {
					set = new Set();
					effectiveStops.set(hue, set);
				}
				set.add(stop);
			}
		}
	}

	const colorVars = generateAllColorVariables(theme.colors, theme.darkConfig, effectiveStops);
	vars.push(...colorVars);

	// Text scale tokens (only used sizes, sorted by key for deterministic output)
	for (const [name, size] of Object.entries(theme.text).sort(([a], [b]) =>
		codepointCompare(a, b),
	)) {
		if (!usage.usedTextSizes.has(name)) continue;
		vars.push(`--text-${name}: ${size.fontSize};`);
		vars.push(`--text-${name}-leading: ${size.lineHeight};`);
	}

	// Font variables — only emit used font slots
	const configuredSlots = new Set<string>();
	for (const fontConfig of theme.fonts) {
		if (!usage.usedFonts.has(fontConfig.slot)) continue;
		const output = getCachedFontOutput(fontConfig, fontOutputCache);
		vars.push(...output.variables);
		configuredSlots.add(fontConfig.slot);
	}
	// Default system stacks for unconfigured but used slots (sorted for deterministic output)
	for (const [slot, stack] of Object.entries(SYSTEM_STACKS).sort(([a], [b]) =>
		codepointCompare(a, b),
	)) {
		if (!configuredSlots.has(slot) && usage.usedFonts.has(slot)) {
			vars.push(`--font-${slot}: ${stack};`);
		}
	}

	// Rounded roof anchor + tokens (only if any rounded value is used, sorted by key)
	if (usage.usedRounded.size > 0) {
		vars.push(`--rounded-roof: ${theme.roundedRoof};`);
		for (const [name, val] of Object.entries(theme.rounded).sort(([a], [b]) =>
			codepointCompare(a, b),
		)) {
			if (!usage.usedRounded.has(name)) continue;
			vars.push(`--rounded-${name}: ${val};`);
		}
	}

	// Shadow tokens — walk the var(--shadow-*) graph so that a class-facing
	// shadow (e.g. `shadow-md`) transitively pulls in every building-block
	// token it composes (`--shadow-layer-1`, `--shadow-ring`, `--shadow-drop`,
	// etc.). Without this, layered shadows would render with undefined vars.
	const shadowsToEmit = resolveTransitiveShadowDeps(theme.shadows, usage.usedShadows);
	for (const [name, val] of Object.entries(theme.shadows).sort(([a], [b]) =>
		codepointCompare(a, b),
	)) {
		if (!shadowsToEmit.has(name)) continue;
		vars.push(`--shadow-${name}: ${val};`);
	}

	// Animation shorthand tokens (only used animations, sorted by key for deterministic output)
	for (const [name, def] of Object.entries(theme.animations).sort(([a], [b]) =>
		codepointCompare(a, b),
	)) {
		if (!usage.usedAnimations.has(name)) continue;
		vars.push(`--animate-${name}: ${def.shorthand};`);
	}

	return `:root {\n  ${vars.join("\n  ")}\n}`;
}

/**
 * Walk the `var(--shadow-*)` graph rooted at `seeds` and return every token
 * that must be emitted to `:root` so the resulting CSS resolves cleanly.
 * Uses a worklist + visited set; bounded by `shadows.size` so even pathological
 * cyclic themes terminate.
 */
function resolveTransitiveShadowDeps(
	shadows: Readonly<Record<string, string>>,
	seeds: ReadonlySet<string>,
): Set<string> {
	const out = new Set<string>();
	const worklist: string[] = [];
	for (const name of seeds) {
		if (Object.hasOwn(shadows, name)) {
			out.add(name);
			worklist.push(name);
		}
	}
	while (worklist.length > 0) {
		const name = worklist.pop() as string;
		const value = shadows[name];
		if (!value?.includes("var(--shadow-")) continue;
		for (const m of value.matchAll(SHADOW_VAR_REF_RE)) {
			const dep = m[1];
			if (!out.has(dep) && Object.hasOwn(shadows, dep)) {
				out.add(dep);
				worklist.push(dep);
			}
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Corner-shape block (global shape + fallback compensation)
// ---------------------------------------------------------------------------

/**
 * Serialize a `CornerShape` as it appears in CSS (`corner-shape: …` values
 * and inside `@supports (corner-shape: …)` feature queries).
 */
function cornerShapeValue(shape: NonNullable<ResolvedTheme["roundedShape"]>): string {
	return typeof shape === "string" ? shape : `superellipse(${shape.superellipse})`;
}

/**
 * Emit the global `corner-shape` rule plus an `@supports (...)` block that
 * bumps `--ri-rounded-scale` on browsers that *do* render the configured
 * shape, so `border-radius` compensates for the visual tightening shapes
 * like squircle exhibit at equal radius versus plain round corners.
 *
 * Non-supporting browsers ignore the `corner-shape` declaration entirely
 * and render raw round corners at the unbumped radius — which matches what
 * the user authored in `rounded-*` utilities, so nothing extra is needed.
 *
 * Returns `null` when no shape was configured (theme.roundedShape is null).
 */
export function generateCornerShapeBlock(theme: ResolvedTheme): string | null {
	if (theme.roundedShape === null) return null;
	const value = cornerShapeValue(theme.roundedShape);
	const shapeRule = `:root {\n  corner-shape: ${value};\n}\n*, ::before, ::after {\n  corner-shape: inherit;\n}`;
	if (theme.roundedShapeScale === 1) return shapeRule;
	const scaleBlock = `@supports (corner-shape: ${value}) {\n  :root {\n    --ri-rounded-scale: ${theme.roundedShapeScale};\n  }\n}`;
	return `${shapeRule}\n\n${scaleBlock}`;
}

// ---------------------------------------------------------------------------
// Font output caching — call generateFontCSS once per config
// ---------------------------------------------------------------------------

/** Derive a stable cache key from a FontSlot's content. A plain serialization
 *  covers the nested faces[] array — a sorted-key allowlist would recurse into
 *  faces and strip every face field, collapsing distinct faces to one key.
 *  Construction order is deterministic, so identical content yields an identical
 *  key across rebuilds.
 *
 *  Note: JSON.stringify omits undefined values, so two slots that differ only by
 *  an undefined vs absent key produce the same cache key. This is intentional —
 *  both represent "not set" semantically. */
function fontCacheKey(config: FontSlot): string {
	return JSON.stringify(config);
}

/**
 * Get cached font output for a FontSlot. Calls generateFontCSS at most once
 * per unique slot within one compilation, preventing duplicate work and
 * duplicate warnings. The cache is compiler-instance-scoped (SSR-safe) and
 * cleared per compilation by createCompiler(), so it needs no eviction.
 */
export function getCachedFontOutput(config: FontSlot, cache: Map<string, FontOutput>): FontOutput {
	const key = fontCacheKey(config);
	let cached = cache.get(key);
	if (!cached) {
		cached = generateFontCSS(config);
		cache.set(key, cached);
	}
	return cached;
}

// ---------------------------------------------------------------------------
// @property registration emission
// ---------------------------------------------------------------------------

/** Render an `@register` registration as a CSS `@property` rule. Mirrors the
 *  format of the engine's built-in `@property` blocks (see engine/index.ts). */
function renderRegisteredProperty(reg: PropertyRegistration): string {
	const lines = [
		`@property ${reg.name} {`,
		`  syntax: ${reg.syntax};`,
		`  inherits: ${reg.inherits};`,
	];
	if (reg.initialValue !== undefined) lines.push(`  initial-value: ${reg.initialValue};`);
	lines.push("}");
	return lines.join("\n");
}

/** Extract the registered custom-property name from an `@property` block. */
const PROPERTY_NAME_RE = /@property\s+(--[A-Za-z0-9_-]+)/;

/**
 * Merge user `@register` rules with the engine's built-in `@property` blocks,
 * deduplicating by property name. User registrations come first so that on a
 * name collision the explicitly-authored rule wins over an engine default.
 */
function collectPropertyBlocks(
	registered: readonly PropertyRegistration[],
	engineProperties: readonly string[],
): string[] {
	const blocks: string[] = [];
	const seen = new Set<string>();
	const push = (block: string) => {
		const name = PROPERTY_NAME_RE.exec(block)?.[1];
		if (name) {
			if (seen.has(name)) return;
			seen.add(name);
		}
		blocks.push(block);
	};
	for (const reg of registered) push(renderRegisteredProperty(reg));
	for (const block of engineProperties) push(block);
	return blocks;
}

// ---------------------------------------------------------------------------
// Shared build pipeline — assemble CSS sections in canonical order
// ---------------------------------------------------------------------------

/**
 * Assemble the final CSS output from a compilation result and theme.
 * Used by both the PostCSS plugin and CLI to ensure identical section ordering:
 *   @import → @property → @font-face → :root → corner-shape → @keyframes → preflight → utilities
 */
export function assembleSections(
	compilation: CompilationResult,
	theme: ResolvedTheme,
	fontOutputCache: Map<string, FontOutput>,
): { sections: string[]; warnings: string[] } {
	/** Everything between imports and utilities, in canonical order. */
	const baseSections: string[] = [];
	const fontImports: string[] = [];
	const fontFaceBlocks: string[] = [];
	/** Warnings collected during assembly — returned separately to avoid
	 *  mutating `theme.warnings`, which would corrupt shared theme objects
	 *  in concurrent SSR compilations. */
	const assemblyWarnings: string[] = [];

	// Per-compilation set to deduplicate font warnings within this assembly pass.
	const fontWarningsEmitted = new Set<string>();

	// Preflight's "core" category always references --font-sans and --font-mono,
	// so mark those slots as used whenever preflight core is enabled.
	if (theme.preflight.core !== false) {
		compilation.usedFonts.add("sans");
		compilation.usedFonts.add("mono");
	}

	for (const fontConfig of theme.fonts) {
		if (!compilation.usedFonts.has(fontConfig.slot)) continue;
		const output = getCachedFontOutput(fontConfig, fontOutputCache);
		fontImports.push(...output.imports);
		fontFaceBlocks.push(...output.fontFaces);
		for (const w of output.warnings) {
			if (!fontWarningsEmitted.has(w)) {
				assemblyWarnings.push(w);
				fontWarningsEmitted.add(w);
			}
		}
	}
	const importsSection: string | null = fontImports.length > 0 ? fontImports.join("\n") : null;

	// @property declarations — user @register rules merged with engine-generated
	// blocks, deduped by name.
	const propertyBlocks = collectPropertyBlocks(theme.registeredProperties, compilation.properties);
	if (propertyBlocks.length > 0) {
		baseSections.push(propertyBlocks.join("\n\n"));
	}

	// @font-face blocks (local/metrics fallbacks only)
	if (fontFaceBlocks.length > 0) {
		baseSections.push(fontFaceBlocks.join("\n\n"));
	}

	// Token layer (:root)
	const tokenLayer = generateTokenLayer(theme, compilation, fontOutputCache);
	if (tokenLayer) baseSections.push(tokenLayer);

	// APCA contrast warnings — fired for stops that fail the medium-text threshold
	// against both --color-paper and --color-ink. Catches genuinely-unusable text
	// stops while staying quiet on the typical 50/100/900/950 text-friendly stops.
	for (const w of checkPaletteContrast(theme.colors, compilation.usedColorStops)) {
		assemblyWarnings.push(w);
	}

	// [data-theme] overrides for the "theme" color (only used suffixes)
	const themeOverrides = generateThemeOverrides(
		theme.colors,
		compilation.usedColorStops.get("theme"),
	);
	if (themeOverrides.length > 0) {
		baseSections.push(themeOverrides.join("\n\n"));
	}

	// Corner-shape + fallback compensation block. Gated only on whether an @rounded
	// shape was configured (generateCornerShapeBlock returns null otherwise) — not
	// on per-utility radius usage. A radius reaches the output through several paths
	// (compiled utility classes, @apply-inlined declarations, hand-authored CSS),
	// and only the first populates usedRounded; gating on it silently dropped the
	// shape for numeric/arbitrary radii and for @apply. The block is small and the
	// directive is an explicit opt-in, so emit it whenever a shape is set.
	const cornerShape = generateCornerShapeBlock(theme);
	if (cornerShape) baseSections.push(cornerShape);

	// @keyframes
	if (compilation.keyframes.length > 0) {
		baseSections.push(compilation.keyframes.join("\n\n"));
	}

	// Preflight
	const preflight = generatePreflight(theme.preflight);
	if (preflight) baseSections.push(preflight);

	// Utility rules
	const utilityCSS = renderCSS({
		...compilation,
		properties: [],
		keyframes: [],
	});
	const utilitiesSection: string | null = utilityCSS !== "" ? utilityCSS : null;

	const parts: SectionParts = {
		imports: importsSection,
		base: baseSections,
		utilities: utilitiesSection,
	};
	const sections = theme.layer
		? applyLayerWrapping(parts, theme.layer)
		: [
				...(importsSection !== null ? [importsSection] : []),
				...baseSections,
				...(utilitiesSection !== null ? [utilitiesSection] : []),
			];

	return { sections, warnings: assemblyWarnings };
}

// ---------------------------------------------------------------------------
// @layer wrapping
// ---------------------------------------------------------------------------

/**
 * Assembled output with section identity kept explicit — imports must stay
 * outside any @layer block (CSS spec) and utilities may be wrapped in their
 * own layer, so the wrapper receives the named parts instead of inferring
 * them positionally from a flat section list.
 */
interface SectionParts {
	imports: string | null;
	base: string[];
	utilities: string | null;
}

function wrapInLayer(content: string, layerName: string): string {
	const indented = content.replace(/^(?=.)/gm, "  ");
	return `@layer ${layerName} {\n${indented}\n}`;
}

function applyLayerWrapping(
	parts: SectionParts,
	layer: NonNullable<ResolvedTheme["layer"]>,
): string[] {
	const sections: string[] = [];
	// @import rules must never be inside @layer blocks (CSS spec).
	if (parts.imports !== null) sections.push(parts.imports);

	if (layer.wrapAll) {
		// Simple form: wrap all content (except imports) in one layer
		sections.push(`@layer ${layer.wrapAll};`);
		const joined = [...parts.base, ...(parts.utilities !== null ? [parts.utilities] : [])].join(
			"\n\n",
		);
		if (joined) sections.push(wrapInLayer(joined, layer.wrapAll));
		return sections;
	}

	// Configured form: wrap base and/or utilities separately.

	// Emit layer order declaration
	if (layer.order && layer.order.length > 0) {
		sections.push(`@layer ${layer.order.join(", ")};`);
	}

	// Wrap base sections
	if (parts.base.length > 0) {
		const baseJoined = parts.base.join("\n\n");
		if (layer.base) {
			sections.push(wrapInLayer(baseJoined, layer.base));
		} else {
			sections.push(baseJoined);
		}
	}

	// Wrap utility section
	if (parts.utilities !== null) {
		if (layer.utilities) {
			sections.push(wrapInLayer(parts.utilities, layer.utilities));
		} else {
			sections.push(parts.utilities);
		}
	}

	return sections;
}
