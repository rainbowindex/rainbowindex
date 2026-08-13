/**
 * Directive Resolution — merge parsed directives with theme defaults.
 *
 * Extracted from directives.ts for maintainability. The parsing functions
 * remain in directives.ts; this module focuses on resolution logic.
 */

import {
	DEFAULT_BREAKPOINTS,
	DEFAULT_BLUR,
	DEFAULT_COLORS,
	DEFAULT_CORNER_SCALE,
	DEFAULT_EASING,
	DEFAULT_ROUNDED,
	DEFAULT_ROUNDED_ROOF,
	DEFAULT_SHADOWS,
	DEFAULT_SUPERELLIPSE_SCALE,
	DEFAULT_TEXT,
	DEFAULT_WEIGHTS,
	DEFAULT_ANIMATIONS,
	DEFAULT_FLUID,
	DEFAULT_LEADING,
	DEFAULT_TRACKING,
} from "../theme/index.js";
import type { CornerShape, FluidConfig, FluidUnit } from "../theme/index.js";

import { DEFAULT_DARK_CONFIG } from "../theme/colors.js";
import { parseRemValue } from "../shared.js";

import type { ParsedDirective, ResolvedTheme, WritableTheme } from "./foundation.js";

import {
	parseKeyValueBody,
	parseColorBody,
	parseTextBody,
	parseSpacingBody,
	parseAnimateBody,
	parseFluidBody,
	parsePreflightDirective,
	parseNestedFontBlock,
	parseUtilityDirective,
	parseGroupedUtilityDirective,
	parseCustomVariantDirective,
	parseSourceDirective,
	parseRoundedModifier,
	parseLayerDirective,
	parseRegisterBody,
} from "./parsers.js";

import { STATIC_UTILITIES } from "../utilities/metadata.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Warn when a custom `@utility` name is an exact built-in static utility (e.g.
 * `flex`): the built-in resolver always wins, so the custom utility is silently
 * dead — no output, no clue. The consumer can't infer that from the symptom, so
 * name the clash here at definition time.
 *
 * Prefix-family names (e.g. `min-h`) are intentionally NOT flagged: a custom
 * `min-h` owns the bare `min-h` class while the built-in keeps `min-h-<value>`,
 * and the two coexist cleanly thanks to the value-gated lookup in
 * `resolveCustomUtility` / `findCustomUtility`.
 */
function warnCustomUtilityCollision(name: string, warnings: string[]): void {
	if (STATIC_UTILITIES.has(name)) {
		warnings.push(
			`[RI-1032] @utility "${name}" collides with the built-in "${name}" utility and is ignored — the built-in takes precedence. Rename the custom utility to a non-built-in name.`,
		);
	}
}

/**
 * RI-1034: warn when a directive that takes no modifier carries one —
 * `@shadow card { … }` silently merges into the global shadow scale, which is
 * never what the author meant. The body is still applied (warn, don't drop).
 */
function warnIgnoredModifier(type: string, modifier: string | undefined, warnings: string[]): void {
	if (modifier === undefined) return;
	warnings.push(
		`[RI-1034] @${type} does not take a modifier — "${modifier}" was ignored and the body was applied globally. Remove the modifier.`,
	);
}

/**
 * Apply removals to a record, then merge overrides.
 */
function mergeWithRemovals<T>(
	defaults: Record<string, T>,
	overrides: Record<string, T>,
	removals: string[],
	warnings?: string[],
	directiveName?: string,
): Record<string, T> {
	const result = { ...defaults };
	for (const key of removals) {
		if (!Object.hasOwn(result, key) && warnings) {
			warnings.push(
				`[RI-1103] Invalid removal "!${key}" in @${directiveName ?? "unknown"} — key "${key}" does not exist in defaults.`,
			);
		}
		delete result[key];
	}
	for (const [key, value] of Object.entries(overrides)) {
		result[key] = value;
	}
	return result;
}

/**
 * Parse a key-value directive and merge overrides into a defaults record.
 * Consolidates the common pattern used by @breakpoint, @shadow, @ease, @blur, @z.
 */
function resolveKeyValueDirective(
	directive: ParsedDirective,
	defaults: Record<string, string>,
	warnings: string[],
	directiveName: string,
): Record<string, string> {
	warnIgnoredModifier(directiveName, directive.modifier, warnings);
	const { entries, removals } = parseKeyValueBody(directive.body, warnings, directiveName);
	const overrides: Record<string, string> = {};
	for (const [k, v] of entries) overrides[k] = v;
	return mergeWithRemovals(defaults, overrides, removals, warnings, directiveName);
}

/**
 * Look up the default fallback scale for a parsed corner shape. Keyword shapes
 * use the table in `DEFAULT_CORNER_SCALE`; `superellipse(N)` falls back to
 * `DEFAULT_SUPERELLIPSE_SCALE` since the visual weight isn't straightforwardly
 * derivable from N — callers are expected to tune via `--corner-scale`.
 */
function defaultScaleForShape(shape: CornerShape): number {
	if (typeof shape === "string") return DEFAULT_CORNER_SCALE[shape];
	return DEFAULT_SUPERELLIPSE_SCALE;
}

const FLUID_UNITS = new Set<string>(["vw", "vi", "vmin", "vmax"]);
const FLUID_TARGETS = new Set<string>(["text", "spacing"]);

function validateFluidRange(config: FluidConfig, directiveName: string, warnings: string[]): void {
	const min = parseRemValue(config.min);
	const max = parseRemValue(config.max);
	if (min === null) {
		warnings.push(
			`[RI-1022] Invalid ${directiveName} min "${config.min}" — expected a rem length such as "20rem".`,
		);
	}
	if (max === null) {
		warnings.push(
			`[RI-1023] Invalid ${directiveName} max "${config.max}" — expected a rem length such as "80rem".`,
		);
	}
	if (min !== null && max !== null && max <= min) {
		warnings.push(
			`[RI-1024] Invalid ${directiveName} range — max "${config.max}" must be greater than min "${config.min}".`,
		);
	}
}

function applyFluidDirective(
	target: FluidConfig,
	parsed: ReturnType<typeof parseFluidBody>,
	directiveName: string,
	warnings: string[],
	options: { allowMultiplier?: boolean } = {},
): void {
	if (parsed.min) target.min = parsed.min;
	if (parsed.max) target.max = parsed.max;
	if (parsed.unit) {
		if (FLUID_UNITS.has(parsed.unit)) {
			target.unit = parsed.unit as FluidUnit;
		} else {
			warnings.push(
				`[RI-1025] Invalid ${directiveName} unit "${parsed.unit}" — expected vw, vi, vmin, or vmax.`,
			);
		}
	}
	if (parsed.multiplier) {
		const multiplier = Number(parsed.multiplier);
		if (!options.allowMultiplier) {
			warnings.push(
				`[RI-1026] Invalid ${directiveName} multiplier "${parsed.multiplier}" — multiplier only applies to spacing fluid utilities.`,
			);
		} else if (Number.isFinite(multiplier) && multiplier > 1) {
			target.multiplier = multiplier;
		} else {
			warnings.push(
				`[RI-1026] Invalid ${directiveName} multiplier "${parsed.multiplier}" — expected a number greater than 1.`,
			);
		}
	}
	validateFluidRange(target, directiveName, warnings);
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve all directives into a complete theme configuration.
 */
/**
 * Validate every @color alias once the full color map is assembled: the source
 * color must exist (RI-1105) and the alias chain must not be circular (RI-1107).
 */
function validateColorAliases(theme: WritableTheme): void {
	for (const [name, def] of Object.entries(theme.colors)) {
		if (def.type !== "alias") continue;
		if (!Object.hasOwn(theme.colors, def.source)) {
			theme.warnings.push(
				`[RI-1105] @color alias "${name}: ${def.source}" — color "${def.source}" is not defined.`,
			);
			continue;
		}
		// Walk the alias chain to detect cycles.
		const visited = new Set<string>([name]);
		let current = def.source;
		while (Object.hasOwn(theme.colors, current) && theme.colors[current].type === "alias") {
			if (visited.has(current)) {
				theme.warnings.push(
					`[RI-1107] @color alias "${name}: ${def.source}" — circular alias chain detected.`,
				);
				break;
			}
			visited.add(current);
			current = (theme.colors[current] as { type: "alias"; source: string }).source;
		}
	}
}

/**
 * Resolve parsed directives into a theme.
 *
 * `attribution`, when provided, is filled parallel to `theme.warnings`: entry
 * i holds the index of the directive whose resolution pushed warning i.
 * Warnings pushed by the post-loop cross-validations (alias cycles, slot
 * dedup, …) have no single source directive and leave the array short —
 * callers treat missing entries as unattributed.
 */
export function resolveDirectives(
	directives: ParsedDirective[],
	attribution?: number[],
): ResolvedTheme {
	const theme: WritableTheme = {
		colors: { ...DEFAULT_COLORS },
		darkConfig: { ...DEFAULT_DARK_CONFIG },
		text: { ...DEFAULT_TEXT },
		spacing: { base: "0.25rem" },
		breakpoints: { ...DEFAULT_BREAKPOINTS },
		rounded: { ...DEFAULT_ROUNDED },
		roundedRoof: DEFAULT_ROUNDED_ROOF,
		roundedShape: null,
		roundedShapeScale: 1,
		shadows: { ...DEFAULT_SHADOWS },
		weights: { ...DEFAULT_WEIGHTS },
		easing: { ...DEFAULT_EASING },
		blur: { ...DEFAULT_BLUR },
		// No default z scale — numeric z is computed by the utility, `auto` is a
		// keyword, and named tokens come from @z.
		z: {},
		animations: { ...DEFAULT_ANIMATIONS },
		fluid: { ...DEFAULT_FLUID },
		fonts: [],
		preflight: {
			core: true,
			typography: true,
			content: true,
			forms: true,
			interactive: true,
			modern: true,
		},
		customUtilities: [],
		customVariants: [],
		sources: [],
		leading: { ...DEFAULT_LEADING },
		tracking: { ...DEFAULT_TRACKING },
		// No default opacity/duration scales — opacity-N → N% and duration-N → Nms
		// via the utilities; @opacity / @duration add named tokens.
		opacity: {},
		duration: {},
		layer: null,
		registeredProperties: [],
		warnings: [],
	};

	for (let directiveIndex = 0; directiveIndex < directives.length; directiveIndex++) {
		const directive = directives[directiveIndex];
		switch (directive.type) {
			case "color": {
				// Handle @color dark { mode: auto; chroma-boost: 0.015; hue-shift: 0; }
				if (directive.modifier === "dark") {
					const { entries } = parseKeyValueBody(directive.body, theme.warnings, "color dark");
					for (const [k, v] of entries) {
						if (k === "mode") {
							if (v !== "auto" && v !== "off") {
								theme.warnings.push(
									`[RI-1103] Invalid @color dark mode "${v}" — expected "auto" or "off".`,
								);
							} else {
								theme.darkConfig.mode = v;
							}
						} else if (k === "chroma-boost") {
							const n = Number.parseFloat(v);
							if (!Number.isNaN(n)) theme.darkConfig.chromaBoost = n;
						} else if (k === "hue-shift") {
							const n = Number.parseFloat(v);
							if (!Number.isNaN(n)) theme.darkConfig.hueShift = n;
						} else {
							theme.warnings.push(
								`[RI-1104] Unknown @color dark option "${k}" — supported: mode, chroma-boost, hue-shift.`,
							);
						}
					}
					break;
				}
				if (directive.modifier !== undefined) {
					theme.warnings.push(
						`[RI-1034] Unknown @color modifier "${directive.modifier}" — only "dark" is supported. The modifier was ignored and the body was applied as a regular @color block.`,
					);
				}
				const colorResult = parseColorBody(directive.body, theme.warnings);
				theme.colors = mergeWithRemovals(
					theme.colors,
					colorResult.colors,
					colorResult.removals,
					theme.warnings,
					"color",
				);
				break;
			}
			case "text": {
				warnIgnoredModifier("text", directive.modifier, theme.warnings);
				const { text, removals } = parseTextBody(directive.body, theme.warnings);
				theme.text = mergeWithRemovals(theme.text, text, removals, theme.warnings, "text");
				break;
			}
			case "spacing": {
				warnIgnoredModifier("spacing", directive.modifier, theme.warnings);
				const { base } = parseSpacingBody(directive.body);
				if (base) {
					// Validate that base looks like a CSS length value
					if (!/^\d+(\.\d+)?\s*(rem|em|px|%)$/.test(base)) {
						theme.warnings.push(
							`[RI-1020] Invalid @spacing base value "${base}" — expected a CSS length (e.g., "0.25rem", "4px"). Using value as-is.`,
						);
					}
					theme.spacing.base = base;
				}
				break;
			}
			case "breakpoint": {
				theme.breakpoints = resolveKeyValueDirective(
					directive,
					theme.breakpoints,
					theme.warnings,
					"breakpoint",
				);
				break;
			}
			case "rounded": {
				const shape = parseRoundedModifier(directive.modifier);
				if (shape !== null) {
					theme.roundedShape = shape;
					theme.roundedShapeScale = defaultScaleForShape(shape);
				}
				if (directive.body) {
					const { entries, removals } = parseKeyValueBody(
						directive.body,
						theme.warnings,
						"rounded",
					);
					// Single pass: the two option keys peel off (last occurrence wins,
					// matching every other key-value directive); the rest are overrides.
					let roofValue: string | undefined;
					let scaleValue: string | undefined;
					const overrides: Record<string, string> = {};
					for (const [k, v] of entries) {
						if (k === "--roof") roofValue = v;
						else if (k === "--corner-scale") scaleValue = v;
						else overrides[k] = v;
					}
					if (roofValue !== undefined) theme.roundedRoof = roofValue;
					if (scaleValue !== undefined) {
						const n = Number.parseFloat(scaleValue);
						if (!Number.isNaN(n) && n > 0) {
							theme.roundedShapeScale = n;
						} else {
							theme.warnings.push(
								`[RI-1121] Invalid --corner-scale "${scaleValue}" — expected a positive number.`,
							);
						}
					}
					theme.rounded = mergeWithRemovals(
						theme.rounded,
						overrides,
						removals,
						theme.warnings,
						"rounded",
					);
				}
				break;
			}
			case "shadow": {
				theme.shadows = resolveKeyValueDirective(
					directive,
					theme.shadows,
					theme.warnings,
					"shadow",
				);
				break;
			}
			case "weight": {
				warnIgnoredModifier("weight", directive.modifier, theme.warnings);
				const { entries, removals } = parseKeyValueBody(directive.body, theme.warnings, "weight");
				const overrides: Record<string, number> = {};
				for (const [k, v] of entries) {
					const n = Number.parseInt(v, 10);
					if (!Number.isNaN(n)) {
						overrides[k] = n;
					} else {
						theme.warnings.push(
							`[RI-1021] Invalid @weight value "${k}: ${v}" — expected an integer (e.g., 400).`,
						);
					}
				}
				theme.weights = mergeWithRemovals(
					theme.weights,
					overrides,
					removals,
					theme.warnings,
					"weight",
				);
				break;
			}
			case "ease": {
				theme.easing = resolveKeyValueDirective(directive, theme.easing, theme.warnings, "ease");
				break;
			}
			case "blur": {
				theme.blur = resolveKeyValueDirective(directive, theme.blur, theme.warnings, "blur");
				break;
			}
			case "z": {
				theme.z = resolveKeyValueDirective(directive, theme.z, theme.warnings, "z");
				break;
			}
			case "animate": {
				warnIgnoredModifier("animate", directive.modifier, theme.warnings);
				const { animations: parsedAnims, removals: animRemovals } = parseAnimateBody(
					directive.body,
				);
				// Routed through mergeWithRemovals like every sibling so a removal of a
				// missing animation warns RI-1103 instead of failing silently.
				theme.animations = mergeWithRemovals(
					theme.animations,
					parsedAnims,
					animRemovals,
					theme.warnings,
					"animate",
				);
				break;
			}
			case "fluid": {
				const parsed = parseFluidBody(directive.body);
				const targetName = directive.modifier?.trim();
				if (!targetName) {
					applyFluidDirective(theme.fluid, parsed, "@fluid", theme.warnings, {
						allowMultiplier: true,
					});
					break;
				}
				if (!FLUID_TARGETS.has(targetName)) {
					theme.warnings.push(
						`[RI-1027] Unknown @fluid modifier "${targetName}" — expected "text" or "spacing".`,
					);
					break;
				}
				if (targetName === "text") {
					// Seed from the existing override so consecutive @fluid text
					// directives accumulate instead of resetting to the base scale.
					theme.textFluid = { ...(theme.textFluid ?? theme.fluid) };
					applyFluidDirective(theme.textFluid, parsed, "@fluid text", theme.warnings);
				} else {
					theme.spacingFluid = { ...(theme.spacingFluid ?? theme.fluid) };
					applyFluidDirective(theme.spacingFluid, parsed, "@fluid spacing", theme.warnings, {
						allowMultiplier: true,
					});
				}
				break;
			}
			case "font": {
				// @font { sans: …; serif: …; mono: …; } — the sole font directive form.
				warnIgnoredModifier("font", directive.modifier, theme.warnings);
				theme.fonts.push(...parseNestedFontBlock(directive.body, theme.warnings));
				break;
			}
			case "preflight": {
				// Selective bodies merge onto the accumulated config; bare/off reset it.
				theme.preflight = parsePreflightDirective(
					directive.body,
					directive.modifier,
					theme.preflight,
				);
				break;
			}
			case "utility": {
				if (directive.modifier) {
					// Named: @utility card { ... }
					const util = parseUtilityDirective(directive.body, directive.modifier, theme.warnings);
					if (util) {
						warnCustomUtilityCollision(util.name, theme.warnings);
						theme.customUtilities.push(util);
					}
				} else if (directive.body) {
					// Grouped: @utility { card { ... } text-shadow { ... } }
					const utils = parseGroupedUtilityDirective(directive.body, theme.warnings);
					for (const util of utils) warnCustomUtilityCollision(util.name, theme.warnings);
					theme.customUtilities.push(...utils);
				}
				break;
			}
			case "custom": {
				const variant = parseCustomVariantDirective(
					directive.body,
					directive.modifier,
					theme.warnings,
				);
				if (variant) theme.customVariants.push(variant);
				break;
			}
			case "source": {
				const source = parseSourceDirective(directive.body, directive.modifier);
				if (source) theme.sources.push(source);
				break;
			}
			case "leading": {
				theme.leading = resolveKeyValueDirective(
					directive,
					theme.leading,
					theme.warnings,
					"leading",
				);
				break;
			}
			case "tracking": {
				theme.tracking = resolveKeyValueDirective(
					directive,
					theme.tracking,
					theme.warnings,
					"tracking",
				);
				break;
			}
			case "opacity": {
				theme.opacity = resolveKeyValueDirective(
					directive,
					theme.opacity,
					theme.warnings,
					"opacity",
				);
				break;
			}
			case "duration": {
				theme.duration = resolveKeyValueDirective(
					directive,
					theme.duration,
					theme.warnings,
					"duration",
				);
				break;
			}
			case "layer": {
				const layerConfig = parseLayerDirective(directive.body, directive.modifier, theme.warnings);
				theme.layer = layerConfig;
				break;
			}
			case "register": {
				theme.registeredProperties.push(
					...parseRegisterBody(directive.modifier, directive.body, theme.warnings),
				);
				break;
			}
			default: {
				// Exhaustive check — if DirectiveType is extended without updating
				// this switch, TypeScript will error here at compile time.
				const _exhaustive: never = directive.type;
				theme.warnings.push(
					`[RI-1110] Unknown directive type "${_exhaustive}" — this directive was parsed but has no resolver. This is a bug in RainbowIndex.`,
				);
			}
		}
		if (attribution) {
			// Any warning pushed during this iteration came from this directive.
			while (attribution.length < theme.warnings.length) attribution.push(directiveIndex);
		}
	}

	// Aliases reference the full color map, which is only complete after every
	// @color directive has merged — validate once here, not per directive.
	validateColorAliases(theme);

	// Dedup font slots (last definition wins) across all @font directives so a
	// redefined slot doesn't emit two --font-<slot> variables and fetch both
	// font payloads.
	theme.fonts = dedupeLastWins(
		theme.fonts,
		(font) => font.slot,
		(font) =>
			`[RI-1215] @font slot "${font.slot}" is defined more than once — the last definition wins. Remove the earlier definition.`,
		theme.warnings,
	);

	// Dedup registered properties (last definition wins) across all @register
	// directives, so a name redefined in a later block — or a later file —
	// overrides the earlier one rather than emitting two conflicting @property rules.
	theme.registeredProperties = dedupeLastWins(
		theme.registeredProperties,
		(r) => r.name,
		(r) =>
			`[RI-1030] @register property "${r.name}" is declared more than once — the last definition wins.`,
		theme.warnings,
	);

	// Freeze every object-valued field (including theme.warnings — callers copy
	// it; no code may mutate it post-freeze) to prevent accidental mutation
	// that would corrupt caches keyed by theme identity (e.g. the WeakMap
	// variant cache in engine.ts). Iterating the fields instead of keeping a
	// hand-written list means a newly added field cannot be forgotten.
	for (const value of Object.values(theme)) {
		if (value !== null && typeof value === "object") Object.freeze(value);
	}
	Object.freeze(theme);

	return theme as ResolvedTheme;
}

/**
 * Last-definition-wins dedup preserving final order. Returns the input array
 * untouched when there are no duplicate keys; otherwise pushes `warn(item)`
 * for each dropped earlier duplicate.
 */
function dedupeLastWins<T>(
	items: T[],
	keyOf: (item: T) => string,
	warn: (item: T) => string,
	warnings: string[],
): T[] {
	if (items.length <= 1) return items;
	const lastIndex = new Map<string, number>();
	items.forEach((item, i) => {
		lastIndex.set(keyOf(item), i);
	});
	if (lastIndex.size === items.length) return items;
	const deduped: T[] = [];
	items.forEach((item, i) => {
		if (lastIndex.get(keyOf(item)) === i) {
			deduped.push(item);
		} else {
			warnings.push(warn(item));
		}
	});
	return deduped;
}
