/**
 * Claim resolution for ri() — utility name → CSS properties it sets.
 *
 * Split from merge/index.ts so each merge file is one concept: this file owns
 * the dual-mode dispatch tables and resolvePropsWith(); index.ts owns the
 * merge algorithm; context.ts owns the compilation-context lifecycle.
 *
 * Everything here is immutable module-init data plus pure closures over it —
 * the mutable published compilation state lives in context.ts, and callers
 * thread it in through resolvePropsWith()'s parameters.
 */

import {
	BUILTIN_STATIC_PROPS,
	PREFIX_PROPS,
	PREFIX_FIRST_SEGMENT_MAP,
	isColorValue,
	isImageValue,
	isFontFamilyValue,
	isGradientPositionValue,
	isMaskStopPositionValue,
	isMaskRadialSizeValue,
} from "./props.js";
import { scanBracketAware } from "../brackets.js";

/** One functional `@utility name-*` root and the properties it claims. Declared
 *  here rather than in context.ts so this layer keeps taking its state as
 *  parameters instead of importing the context module. */
export type CustomFunctionalEntry = readonly [root: string, properties: readonly string[]];

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
/** Default font family slots — initial state and reset baseline (context.ts). */
export const DEFAULT_FONT_FAMILIES = ["sans", "serif", "mono"];

/**
 * Resolver for dual-mode prefix utilities — prefixes that map to different CSS
 * properties depending on the value (e.g. text-lg → font-size vs text-red → color).
 * Receives the value part and context sets, returns the CSS properties.
 * Stored bare in the dispatch records: every entry is just a function.
 */
type DualModeResolver = (
	value: string,
	textSizes: ReadonlySet<string>,
	fontFamilies: ReadonlySet<string>,
	colorNames: ReadonlySet<string>,
) => readonly string[];

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

const MASK_STOP_DUAL_MODES: Record<string, DualModeResolver> = {};
for (const [prefix, sides, end] of MASK_STOP_FAMILIES) {
	// Per-family arrays are precomputed once at module init — the resolver runs
	// per ri() call and must not allocate. The color case is exactly the
	// family's PREFIX_PROPS entry (single source of truth).
	const positionProps: string[] = ["mask-image"];
	if (sides.length > 1) positionProps.push("mask-composite");
	for (const side of sides) positionProps.push(`--ri-mask-${side}-${end}-position`);
	Object.freeze(positionProps);
	const colorProps = PREFIX_PROPS[prefix];
	MASK_STOP_DUAL_MODES[prefix] = (value) =>
		isMaskStopPositionValue(value) ? positionProps : colorProps;
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
const STROKE_WIDTH_PROPS: readonly string[] = Object.freeze(["stroke-width"]);
const BG_IMAGE_PROPS: readonly string[] = Object.freeze(["background-image"]);
const BORDER_COLOR_PROPS: readonly string[] = Object.freeze(["border-color"]);
const OUTLINE_COLOR_PROPS: readonly string[] = Object.freeze(["outline-color"]);
const OUTLINE_STYLE_PROPS: readonly string[] = Object.freeze(["outline-style"]);
const DECORATION_COLOR_PROPS: readonly string[] = Object.freeze(["text-decoration-color"]);

// Hoisted dual-mode value tests — resolvers run per ri() token.
const RE_SIGNED_INT = /^-?\d+$/;
const RE_UNSIGNED_INT = /^\d+$/;
// Mirrors DECIMAL_RE in utilities/helpers.ts (svg.ts routes these to
// stroke-width) — kept local so the merge layer stays generator-free.
const RE_DECIMAL = /^\d+(?:[._]\d+)?$/;

/** Color-vs-default dual mode shared by the composable shadow/ring families. */
function colorOrDefault(prefix: string, colorProps: readonly string[]): DualModeResolver {
	const defaultProps = PREFIX_PROPS[prefix];
	return (value, _textSizes, _fontFamilies, colorNames) =>
		isColorValue(value, undefined, colorNames) ? colorProps : defaultProps;
}

/**
 * Data-driven dispatch table for dual-mode prefix utilities.
 */
const DUAL_MODE_PREFIXES: Readonly<Record<string, DualModeResolver>> = {
	...MASK_STOP_DUAL_MODES,
	// mask-radial-[<size>] sets the size var; mask-radial-[<value>] is a full image.
	"mask-radial": (value) =>
		isMaskRadialSizeValue(value) ? MASK_RADIAL_SIZE_PROPS : PREFIX_PROPS["mask-radial"],
	text: (value, textSizes, _fontFamilies, colorNames) => {
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
	font: (value, _textSizes, fontFamilies) => {
		// Font-stack-shaped arbitraries (font-[Georgia,_serif]) emit font-family,
		// mirroring typography.ts — everything else is a weight.
		if (fontFamilies.has(value) || isFontFamilyValue(value)) return FONT_FAMILY_PROPS;
		return PREFIX_PROPS.font;
	},
	border: (value, _textSizes, _fontFamilies, colorNames) =>
		isColorValue(value, undefined, colorNames) ? BORDER_COLOR_PROPS : PREFIX_PROPS.border,
	outline: (value, _textSizes, _fontFamilies, colorNames) => {
		if (isColorValue(value, undefined, colorNames)) return OUTLINE_COLOR_PROPS;
		if (RE_SIGNED_INT.test(value) || (value.startsWith("[") && !isColorValue(value)))
			return PREFIX_PROPS.outline;
		return OUTLINE_STYLE_PROPS;
	},
	// Width-vs-color, mirroring svg.ts's generate-side dispatch: decimals
	// (stroke-2, stroke-1.5) and non-color arbitraries (stroke-[3px]) emit
	// stroke-width; every color-shaped value emits the `stroke` paint property.
	stroke: (value, _textSizes, _fontFamilies, colorNames) => {
		if (
			RE_DECIMAL.test(value) ||
			(value.startsWith("[") && !isColorValue(value, undefined, colorNames))
		)
			return STROKE_WIDTH_PROPS;
		return PREFIX_PROPS.stroke;
	},
	decoration: (value, _textSizes, _fontFamilies, colorNames) => {
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
	// Image-first to mirror colorGenerator's dispatch: the engine emits
	// background-image for image-shaped values (bg-[url(#x)] contains "#",
	// so a color-first check would misclassify it) and background-color
	// for everything else — never the full `background` shorthand.
	bg: (value) => (isImageValue(value) ? BG_IMAGE_PROPS : PREFIX_PROPS.bg),
	shadow: colorOrDefault("shadow", Object.freeze(["--ri-shadow-color"])),
	"inset-shadow": colorOrDefault("inset-shadow", Object.freeze(["--ri-inset-shadow-color"])),
	ring: colorOrDefault("ring", Object.freeze(["--ri-ring-color"])),
	"inset-ring": colorOrDefault("inset-ring", Object.freeze(["--ri-inset-ring-color"])),
	"text-shadow": colorOrDefault("text-shadow", Object.freeze(["--ri-text-shadow-color"])),
	"drop-shadow": colorOrDefault("drop-shadow", Object.freeze(["--ri-drop-shadow-color"])),
	from: (value) =>
		isGradientPositionValue(value) ? PREFIX_PROPS["from-position"] : PREFIX_PROPS.from,
	via: (value) =>
		isGradientPositionValue(value) ? PREFIX_PROPS["via-position"] : PREFIX_PROPS.via,
	to: (value) => (isGradientPositionValue(value) ? PREFIX_PROPS["to-position"] : PREFIX_PROPS.to),
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
// Prefix extraction
// ---------------------------------------------------------------------------

/**
 * Extract the utility prefix and value from a class name (without variant prefix).
 * Returns the CSS properties this utility sets, or null if unknown.
 */
export function resolvePropsWith(
	utility: string,
	customStaticProps: Readonly<Record<string, string[]>>,
	customFunctionalProps: readonly CustomFunctionalEntry[],
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

	// 3. Try custom functional roots (@utility name-*), longest root first. They
	// rank below every exact name so a functional `text-*` cannot claim
	// `text-center`, and above the built-in prefixes so a custom root wins the
	// family it declares.
	for (const [root, properties] of customFunctionalProps) {
		if (name.length <= root.length) continue;
		if (name.startsWith(root) && name.charCodeAt(root.length) === 45 /* '-' */) return properties;
	}

	// 4. Try prefix-based match (longest prefix wins)
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
			const dualMode = DUAL_MODE_PREFIXES[prefix] as DualModeResolver | undefined;
			if (dualMode) {
				return dualMode(value, textSizes, fontFamilies, colorNames);
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
