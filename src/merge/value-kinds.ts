/**
 * Whether a value is a color, an image, a font family — the questions `ri()`
 * has to answer to tell `text-lg` from `text-white`.
 *
 * Kept apart from the claim tables: those are data the merge reads, these are
 * predicates it runs, and neither refers to the other.
 */

/**
 * Detect if a value part looks like a color.
 * Used for dual-mode resolution (text-{size} vs text-{color}).
 */
// Hoisted regexes — compiled once (merge.ts is browser-shipped hot path).
const RE_COLOR_SHADE = /^[a-z]+(?:-[a-z]+)*-\d{2,3}$/;

/**
 * CSS color-function names. Single source for the merge classifier here and
 * the engine's bracketed-color detector (utilities/color.ts) — if the two
 * sets drift, conflict groups stop matching emitted CSS.
 */
export const COLOR_FUNCTION_ALTERNATION =
	"oklch|oklab|rgb|rgba|hsl|hsla|hwb|lab|lch|color|light-dark";
const RE_ARBITRARY_COLOR = new RegExp(`[#]|(?:${COLOR_FUNCTION_ALTERNATION})\\s*\\(`);
const RE_ALPHA_SUFFIX = /\/[\w.%-]+$/;

/**
 * Special color names → CSS values. Single source for the engine resolver
 * (utilities/color.ts emits these values) and the merge classifier
 * (isColorValue matches the names) — a name added here is recognized by both
 * sides, so conflict groups always match emitted CSS. Null prototype + frozen.
 */
export const SPECIAL_COLORS: Readonly<Record<string, string>> = Object.freeze(
	Object.assign(Object.create(null), {
		transparent: "transparent",
		current: "currentColor",
		inherit: "inherit",
		black: "oklch(0 0 0)",
		white: "oklch(1 0 0)",
		paper: "var(--color-paper)",
		ink: "var(--color-ink)",
	}),
);
const SPECIAL_COLOR_NAMES: ReadonlySet<string> = new Set(Object.keys(SPECIAL_COLORS));

/**
 * Detect if a value part looks like a gradient position (percentage or arbitrary length).
 * Used for dual-mode resolution (from-{color} vs from-{position}).
 */
export function isGradientPositionValue(value: string): boolean {
	// Named percentage: "50%", "0%", "100%"
	if (value.endsWith("%")) {
		const num = Number(value.slice(0, -1));
		return !Number.isNaN(num) && Number.isInteger(num) && num >= 0 && num <= 100;
	}
	// Arbitrary non-color value in brackets: [20px], [calc(...)]
	if (value.startsWith("[") && value.endsWith("]") && !RE_ARBITRARY_COLOR.test(value)) {
		return true;
	}
	return false;
}

/**
 * Detect whether a mask gradient stop value (the part after `mask-…-from-`/`-to-`)
 * is a position rather than a color. Broader than isGradientPositionValue: bare
 * numbers resolve to spacing multiples and `(--custom-prop)` shorthands are
 * treated as positions for mask from/to utilities. Keep this in lockstep with
 * `resolveMaskPosition` in utilities/effects/masks.ts.
 */
const MASK_STOP_NUMBER_RE = /^\d+(?:[._]\d+)?$/;
const MASK_RADIAL_KEYWORD_RE = /\b(?:at|circle|ellipse|closest|farthest)\b/;

export function isMaskStopPositionValue(value: string): boolean {
	// Bare number (int or decimal) → spacing-based position
	if (MASK_STOP_NUMBER_RE.test(value)) return true;
	// CSS variable shorthand → position
	if (value.startsWith("(") && value.endsWith(")")) return true;
	// Any numeric percentage → position
	if (value.endsWith("%")) {
		const num = Number(value.slice(0, -1));
		return !Number.isNaN(num);
	}
	// Non-color arbitrary bracket → position
	if (value.startsWith("[")) return isGradientPositionValue(value);
	return false;
}

/** Single length/percentage token for radial size detection (e.g. 50%, 20px, 1.5rem). */
const MASK_RADIAL_SIZE_TOKEN_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:%|[a-z]+)?$/i;

/**
 * Distinguish `mask-radial-[<size>]` (one or two length/percentage tokens →
 * `--ri-mask-radial-size`) from `mask-radial-[<value>]` (a full radial-gradient
 * argument → `mask-image`). Shape/position keywords (`circle`, `ellipse`,
 * `at …`, `closest/farthest …`) mark the value as a full image, not a size.
 * Used on both the generate side (utilities/effects/masks.ts) and the merge side.
 */
export function isMaskRadialSizeValue(value: string): boolean {
	if (!(value.startsWith("[") && value.endsWith("]"))) return false;
	const inner = value.slice(1, -1);
	if (!inner) return false;
	if (MASK_RADIAL_KEYWORD_RE.test(inner)) return false;
	const tokens = inner.split("_").filter(Boolean);
	if (tokens.length === 0 || tokens.length > 2) return false;
	return tokens.every((token) => MASK_RADIAL_SIZE_TOKEN_RE.test(token));
}

export function isColorValue(
	value: string,
	textSizes?: ReadonlySet<string>,
	colorNames?: ReadonlySet<string>,
): boolean {
	// Explicit color hint ([color:var(--x)] / (color:--x)) — the parser forces
	// these down the color path, so the merge must classify them identically.
	if (value.startsWith("[color:") || value.startsWith("(color:")) return true;
	// Single regex pass: the suffix match anchors at $, so slicing at its index
	// equals replacing it with "".
	const alphaMatch = RE_ALPHA_SUFFIX.exec(value);
	const baseValue = alphaMatch ? value.slice(0, alphaMatch.index) : value;
	// If the value is a known text size, it's definitively not a color —
	// prevents false positives where custom text sizes match color patterns.
	if (textSizes?.has(baseValue) === true) return false;
	// Theme color names registered at compile time — covers flat custom colors
	// (@color { accent: … }) whose bare form matches no shade/special pattern.
	if (colorNames?.has(baseValue) === true) return true;
	if (SPECIAL_COLOR_NAMES.has(baseValue)) return true;
	// Color shade: e.g., "red-500", "blue-50", "deep-blue-500"
	if (RE_COLOR_SHADE.test(baseValue)) return true;
	// Arbitrary color: hex (#fff), or known color functions
	if (baseValue.startsWith("[") && RE_ARBITRARY_COLOR.test(baseValue)) return true;
	return false;
}

/**
 * Image-shaped value: routes `bg-[<value>]` to `background-image` rather than
 * `background-color`. Single source for the engine dispatch (utilities/color.ts)
 * and the merge-side `bg` dual-mode so conflict groups match emitted CSS.
 */
export const RE_IMAGE_VALUE =
	/^(?:url|image|image-set|cross-fade|element|paint|(?:repeating-)?(?:linear|radial|conic)-gradient)\s*\(/i;

/** Merge-side wrapper: tests a raw class value (`[url(/x.png)]`, `(image:--x)`,
 *  `[image:linear-gradient(...)]`) for image shape, including the `image:` hint. */
export function isImageValue(value: string): boolean {
	if (value.startsWith("[image:") || value.startsWith("(image:")) return true;
	if (value.startsWith("[") || value.startsWith("(")) {
		return RE_IMAGE_VALUE.test(value.slice(1, -1));
	}
	return false;
}

/**
 * Font-stack-shaped arbitrary value (`font-[Georgia,_serif]`, `font-["Inter"]`,
 * `font-[family-name:var(--x)]`): mirrors typography.ts's family-vs-weight
 * heuristic so the merge claims `font-family` exactly when the engine emits it.
 */
export function isFontFamilyValue(value: string): boolean {
	if (value.startsWith("[family-name:") || value.startsWith("(family-name:")) return true;
	if (value.startsWith("[") && value.endsWith("]")) {
		const raw = value.slice(1, -1);
		return raw.includes(",") || raw.startsWith('"') || raw.startsWith("'");
	}
	return false;
}
