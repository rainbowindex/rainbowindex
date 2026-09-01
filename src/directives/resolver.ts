/**
 * Directive Resolution — merge parsed directives with theme defaults.
 *
 * Extracted from directives.ts for maintainability. The parsing functions
 * remain in directives.ts; this module focuses on resolution logic.
 */

import { parseRemValue } from "../css/fluid.js";
import { stripCSSComments } from "../shared.js";
import { entryDisabled, parseEntryDisables } from "./suppress.js";

import { DEFAULT_DARK_CONFIG } from "../theme/colors.js";
import type { CornerShape, FluidConfig, FluidUnit } from "../theme/index.js";
import {
	DEFAULT_COLORS,
	DEFAULT_CORNER_SCALE,
	DEFAULT_SUPERELLIPSE_SCALE,
} from "../theme/index.js";
import { resolveUtility } from "../utilities/index.js";
import { STATIC_UTILITIES } from "../utilities/metadata.js";
import type { ParsedDirective, ResolvedTheme, WritableTheme } from "./foundation.js";
import { IDENT_KEY_RE, scanEntries } from "./foundation.js";
import {
	extractUtilityBlocks,
	parseAnimateBody,
	parseColorBody,
	parseCustomVariantDirective,
	parseFluidBody,
	parseGroupedUtilityDirective,
	parseKeyValueBody,
	parseLayerDirective,
	parseNestedFontBlock,
	parsePreflightDirective,
	parseRegisterBody,
	parseRoundedModifier,
	parseSourceDirective,
	parseSpacingBody,
	parseTextBody,
	parseUtilityDirective,
} from "./parsers.js";

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

const FLUID_UNITS = new Set<string>(["vw", "vi", "vmin", "vmax", "cqw", "cqi", "cqmin", "cqmax"]);
const FLUID_TARGETS = new Set<string>(["text", "spacing"]);

// A bound that is absent is not yet configured, not invalid: a later @fluid
// block can still state it, and until one does the fluid utilities simply do
// not resolve. Only a stated bound is checked.
function validateFluidRange(config: FluidConfig, directiveName: string, warnings: string[]): void {
	const min = config.min !== undefined ? parseRemValue(config.min) : null;
	const max = config.max !== undefined ? parseRemValue(config.max) : null;
	if (config.min !== undefined && min === null) {
		warnings.push(
			`[RI-1022] Invalid ${directiveName} min "${config.min}" — expected a rem length such as "20rem".`,
		);
	}
	if (config.max !== undefined && max === null) {
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
	options: { allowMultiplier?: boolean; forbidUnit?: boolean } = {},
): void {
	if (parsed.min) target.min = parsed.min;
	if (parsed.max) target.max = parsed.max;
	if (parsed.unit) {
		if (options.forbidUnit) {
			warnings.push(
				`[RI-1039] Invalid ${directiveName} unit "${parsed.unit}" — named ranges carry no unit; set it on @fluid, @fluid text, or @fluid spacing.`,
			);
		} else if (FLUID_UNITS.has(parsed.unit)) {
			target.unit = parsed.unit as FluidUnit;
		} else {
			warnings.push(
				`[RI-1025] Invalid ${directiveName} unit "${parsed.unit}" — expected vw, vi, vmin, vmax, cqw, cqi, cqmin, or cqmax.`,
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

/** A @shadow value that is only another token's class name, e.g. `alias: shadow-md`. */
const SHADOW_ALIAS_RE = /^shadow-([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/**
 * Rewrite `alias: shadow-md` into `var(--shadow-md)` once every @shadow
 * directive has merged, so a token defined in a later block still resolves.
 * The token layer walks these var() references and emits the referenced token
 * alongside the alias.
 */
function resolveShadowAliases(theme: WritableTheme): void {
	// Collected before anything is rewritten: the rewrite below replaces a value
	// with `var(…)`, which no longer matches the alias pattern, so a chain has to
	// be walked over the values as written.
	const aliases = new Map<string, string>();
	for (const [name, value] of Object.entries(theme.shadows)) {
		const match = SHADOW_ALIAS_RE.exec(value);
		if (match) aliases.set(name, match[1]);
	}
	for (const [name, target] of aliases) {
		if (!Object.hasOwn(theme.shadows, target)) {
			theme.warnings.push(
				`[RI-1123] @shadow alias "${name}: shadow-${target}" — shadow "${target}" is not defined.`,
			);
			continue;
		}
		// A cycle emits var() references that point at each other, which CSS calls
		// guaranteed-invalid: the shadow would resolve to nothing at all, with no
		// hint as to why. `@color` reports the same shape with RI-1107.
		const visited = new Set<string>([name]);
		let current = target;
		let circular = false;
		while (aliases.has(current)) {
			if (visited.has(current)) {
				circular = true;
				break;
			}
			visited.add(current);
			current = aliases.get(current) as string;
		}
		if (circular) {
			theme.warnings.push(
				`[RI-1125] @shadow alias "${name}: shadow-${target}" — circular alias chain detected.`,
			);
			continue;
		}
		theme.shadows[name] = `var(--shadow-${target})`;
	}
}

/** The scale directives all resolve identically — merge the directive's
 *  key/value body into one string-keyed theme record. One table entry per
 *  directive keeps them to a single switch branch; the directive type doubles
 *  as the warning label, so warning text is unchanged from the per-case form. */
const SCALE_DIRECTIVE_FIELDS = {
	breakpoint: "breakpoints",
	shadow: "shadows",
	ease: "easing",
	blur: "blur",
	z: "z",
	leading: "leading",
	tracking: "tracking",
	opacity: "opacity",
	duration: "duration",
} as const;

/**
 * Named scales, as `[theme field, directive, class prefix, takes utility blocks]`.
 *
 * A scale that feeds exactly one class prefix takes utility blocks: a colon-less
 * `name { … }` in its body defines a utility in that family, so the math sits
 * beside the tokens it reads. `@color` is the one entry that does not — a colour
 * name feeds `bg-`, `text-`, `border-`, `ring-` and more, so a block would have
 * no single family to land in. It still takes part in the RI-1124 check, probed
 * through `bg-`, which is where the fixed colour keywords live.
 *
 * `@breakpoint` is absent altogether: it names variants, not utilities.
 * `@spacing` too — it holds one base value, and its scale feeds `p-`, `m-`,
 * `gap-` and the rest.
 */
const NAMED_SCALES = [
	["radii", "rounded", "rounded", true],
	["shadows", "shadow", "shadow", true],
	["blur", "blur", "blur", true],
	["z", "z", "z", true],
	["leading", "leading", "leading", true],
	["tracking", "tracking", "tracking", true],
	["opacity", "opacity", "opacity", true],
	["duration", "duration", "duration", true],
	["easing", "ease", "ease", true],
	["weights", "weight", "font", true],
	["text", "text", "text", true],
	["animations", "animate", "animate", true],
	["colors", "color", "bg", false],
] as const;

/** Directive → class prefix, for the scales that take utility blocks. */
const BLOCK_PREFIXES: ReadonlyMap<string, string> = new Map(
	NAMED_SCALES.filter(([, , , blocks]) => blocks).map(([, directive, prefix]) => [
		directive,
		prefix,
	]),
);

/**
 * RI-1124: warn when a named scale entry takes over a built-in class name —
 * `@rounded { full: 30px; }` replaces `rounded-full`. The consumer's value wins
 * (every named scale resolves theme-first), so this is a heads-up, not a
 * rejection: the risk is replacing a built-in you did not know was there.
 *
 * The built-in list is not hard-coded. Three registries already describe parts
 * of it and none is complete — STATIC_UTILITIES misses `blur-none`,
 * UTILITY_VALUE_SPACES misses `duration-initial` — so a fourth would drift the
 * first time a generator gains a keyword. Instead this asks the generators
 * themselves: empty the scale under test, and anything that still resolves came
 * from a built-in rather than from the consumer. Overriding a *default token*
 * (`@color { red: … }`, `@blur { sm: … }`) stays quiet, because emptying the
 * scale removes those too.
 */
function warnBuiltinShadows(
	theme: WritableTheme,
	directives: ParsedDirective[],
	attribution?: number[],
): void {
	// Only names the consumer actually wrote. The resolved scale also holds the
	// shipped colours, and warning about those would fire on every build for
	// entries nobody typed.
	// scanEntries is the general grammar: it reads the flat scales and the
	// block-carrying bodies of @color/@animate alike.
	// name → the index of the directive that declared it, so a warning raised
	// here can still point at an at-rule. This runs after the resolution loop,
	// which is what fills `attribution`, so it files its own entries.
	const declared = new Map<string, Map<string, number>>();
	// `ri-disable-next-line` names, merged across every block of a directive type.
	// Parsed silently here: the main resolution loop already reported any
	// malformed pragma in these same bodies.
	const disabled = new Map<string, Map<string, Set<string>>>();
	for (let index = 0; index < directives.length; index++) {
		const d = directives[index];
		if (!d.body) continue;
		let set = declared.get(d.type);
		if (!set) {
			set = new Map();
			declared.set(d.type, set);
		}
		for (const entry of scanEntries(stripCSSComments(d.body), { newlineTerminates: true })) {
			if (entry.key && !entry.removal && !entry.fragment) set.set(entry.key, index);
		}
		for (const [code, names] of parseEntryDisables(d.body)) {
			let byCode = disabled.get(d.type);
			if (byCode === undefined) {
				byCode = new Map();
				disabled.set(d.type, byCode);
			}
			let merged = byCode.get(code);
			if (merged === undefined) {
				merged = new Set();
				byCode.set(code, merged);
			}
			for (const name of names) merged.add(name);
		}
	}

	for (const [field, directive, prefix] of NAMED_SCALES) {
		const names = declared.get(directive);
		if (names === undefined || names.size === 0) continue;
		// customUtilities emptied as well: a custom utility of the same name is
		// the consumer's own doing and RI-1032 already covers that clash.
		const probe = { ...theme, [field]: {}, customUtilities: [] } as unknown as ResolvedTheme;
		const silenced = disabled.get(directive)?.get("RI-1124");
		for (const [name, sourceIndex] of names) {
			if (!Object.hasOwn(theme[field], name)) continue;
			if (silenced?.has(name)) continue;
			const builtin = resolveUtility(prefix, name, false, probe, [], undefined, null);
			if (builtin === null) continue;
			// Which side actually won? Within a family the entry wins, because every
			// named scale resolves theme-first. Across families it does not: `blur-in`
			// is an enter-animation utility that merely shares the `blur-` prefix, and
			// `@blur { in: … }` cannot take it. Ask rather than assume — a warning that
			// misreports who won is worse than none.
			const actual = resolveUtility(prefix, name, false, theme, [], undefined, null);
			// Pad past any post-loop warning that has no source directive, so the
			// index pushed below stays parallel to theme.warnings.
			if (attribution) {
				while (attribution.length < theme.warnings.length) attribution.push(-1);
			}
			theme.warnings.push(
				JSON.stringify(actual) === JSON.stringify(builtin)
					? `[RI-1124] @${directive} "${name}" is shadowed by the built-in "${prefix}-${name}" utility, which belongs to another family and still wins — your value never applies. Rename the entry.`
					: `[RI-1124] @${directive} "${name}" replaces the built-in "${prefix}-${name}" utility — that class now uses your value. Rename the entry if you did not mean to replace it.`,
			);
			attribution?.push(sourceIndex);
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
		// Named size tokens come from @text.
		text: {},
		spacing: { base: "0.25rem" },
		// Breakpoint variants come from @breakpoint.
		breakpoints: {},
		roundedShape: null,
		roundedShapeScale: 1,
		radii: {},
		// Named shadow, weight, easing and blur tokens come from @shadow,
		// @weight, @ease and @blur.
		shadows: {},
		weights: {},
		easing: {},
		blur: {},
		// No default z scale — numeric z is computed by the utility, `auto` is a
		// keyword, and named tokens come from @z.
		z: {},
		// Keyframes come from @animate; the fluid viewport range from @fluid.
		animations: {},
		fluid: {},
		fluidRanges: {},
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
		// No default leading/tracking scales — named tokens come from
		// @leading and @tracking.
		leading: {},
		tracking: {},
		// No default opacity/duration scales — opacity-N → N% and duration-N → Nms
		// via the utilities; @opacity / @duration add named tokens.
		opacity: {},
		duration: {},
		layer: null,
		registeredProperties: [],
		warnings: [],
	};

	for (let directiveIndex = 0; directiveIndex < directives.length; directiveIndex++) {
		let directive = directives[directiveIndex];
		// Read from the body as authored — block extraction below rewrites it.
		const pragmas = parseEntryDisables(directive.body, theme.warnings);
		// Utility blocks come out before the directive's own parser runs, so each
		// grammar below still sees only the entries it already understood.
		const blockPrefix = BLOCK_PREFIXES.get(directive.type);
		if (blockPrefix !== undefined && directive.body) {
			const { rest, utilities, cut } = extractUtilityBlocks(
				directive.body,
				blockPrefix,
				// @animate shorthands legally wrap across newlines to their `{`, so
				// only a `;` or a brace ends an entry there. Every other scale splits
				// on newlines, as parseKeyValueBody does.
				directive.type !== "animate",
				theme.warnings,
			);
			for (const util of utilities) warnCustomUtilityCollision(util.name, theme.warnings);
			theme.customUtilities.push(...utilities);
			// Swap in the excised body whenever a block was lifted, not only when
			// one survived. A block whose name was rejected is still cut, and the
			// parsers below are brace-blind: left in place, its declarations read
			// as scale entries, so `bad.name-* { box-shadow: … }` would define a
			// shadow token called "box-shadow".
			if (cut) directive = { ...directive, body: rest };
		}
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
			case "breakpoint":
			case "shadow":
			case "ease":
			case "blur":
			case "z":
			case "leading":
			case "tracking":
			case "opacity":
			case "duration": {
				const field = SCALE_DIRECTIVE_FIELDS[directive.type];
				theme[field] = resolveKeyValueDirective(
					directive,
					theme[field],
					theme.warnings,
					directive.type,
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
					// scanEntries, not parseKeyValueBody: `--corner-scale` shares this body
					// with the radius names, so entries are read one at a time and the
					// option is pulled out before the rest merge as a scale.
					const overrides: Record<string, string> = {};
					const removals: string[] = [];
					for (const entry of scanEntries(stripCSSComments(directive.body), {
						newlineTerminates: true,
					})) {
						if (entry.removal) {
							removals.push(entry.key);
							continue;
						}
						if (entry.fragment) continue;
						if (entry.key === "--corner-scale") {
							// Last occurrence wins, matching every other key-value directive.
							const n = Number.parseFloat(entry.value);
							if (!Number.isNaN(n) && n > 0) theme.roundedShapeScale = n;
							else if (!entryDisabled(pragmas, "RI-1121", entry.key))
								theme.warnings.push(
									`[RI-1121] Invalid --corner-scale "${entry.value}" — expected a positive number.`,
								);
							continue;
						}
						if (entry.key.startsWith("--")) {
							if (!entryDisabled(pragmas, "RI-1122", entry.key))
								theme.warnings.push(
									`[RI-1122] Unknown @rounded option "${entry.key}" — the only option is --corner-scale. Keys without a "--" prefix define radii: "roof: 24px" makes rounded-roof.`,
								);
							continue;
						}
						if (!IDENT_KEY_RE.test(entry.key)) {
							if (!entryDisabled(pragmas, "RI-1035", entry.key))
								theme.warnings.push(
									`[RI-1035] Invalid @rounded entry key "${entry.key}" — keys may only contain letters, numbers, hyphens, and underscores. The entry was skipped.`,
								);
							continue;
						}
						overrides[entry.key] = entry.value;
					}
					theme.radii = mergeWithRemovals(
						theme.radii,
						overrides,
						removals,
						theme.warnings,
						"rounded",
					);
				}
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
					// Any other identifier defines a named range: the scope class
					// `fluid-<name>` and the tokens `--fluid-<name>-{min,max}`.
					if (!IDENT_KEY_RE.test(targetName)) {
						theme.warnings.push(
							`[RI-1027] Invalid @fluid range name "${targetName}" — expected "text", "spacing", or a name of letters, digits, hyphens, and underscores.`,
						);
						break;
					}
					// Seed min/max only: ranges have no unit or multiplier of their
					// own. Consecutive bodies for one name accumulate, like the
					// family overrides above.
					const range = theme.fluidRanges[targetName] ?? {
						min: theme.fluid.min,
						max: theme.fluid.max,
					};
					theme.fluidRanges[targetName] = range;
					applyFluidDirective(range, parsed, `@fluid ${targetName}`, theme.warnings, {
						forbidUnit: true,
					});
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
	resolveShadowAliases(theme);

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

	warnBuiltinShadows(theme, directives, attribution);

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
