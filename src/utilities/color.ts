/**
 * Color utilities — text-{color}, bg-{color}, border-{color},
 * outline-{color}, accent-{color}, caret-{color}, plus gradients.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import {
	type UtilityResult,
	single,
	multi,
	fullName,
	extractArbitrary,
	INTEGER_RE,
} from "./index.js";
import { COLOR_FUNCTION_ALTERNATION, RE_IMAGE_VALUE, SPECIAL_COLORS } from "../merge/props.js";
import { type ColorDefinition, isValidColorSuffix } from "../theme/index.js";
import {
	ARBITRARY_TYPE_HINTS,
	CSS_VAR_NAME_RE,
	decodeArbitraryValue,
	sanitizeArbitraryValue,
} from "./parser.js";
import { clampAlphaPercent, mixColorAlpha } from "../css/alpha.js";

/**
 * Does this color emit per-stop CSS variables (--color-${name}-${suffix})?
 * Only generative colors do, plus aliases that ultimately resolve to one.
 * Used to reject suffixed forms like `bg-accent-500` when `accent` is an
 * explicit/pair/keyword entry with no shades.
 */
function hasStopVariables(name: string, colors: Record<string, ColorDefinition>): boolean {
	const seen = new Set<string>();
	let current = name;
	while (Object.hasOwn(colors, current)) {
		if (seen.has(current)) return false;
		seen.add(current);
		const def = colors[current];
		if (def.type === "generative") return true;
		if (def.type !== "alias") return false;
		current = def.source;
	}
	return false;
}
// Explicit arbitrary-value type hints. `[color:...]` forces color resolution;
// the rest force a non-color interpretation and should short-circuit here so
// the next generator (border-width, font-size, etc.) picks them up.
// Derived from the parser's hint list so a new hint can't drift past this gate.
const RE_COLOR_HINT = /^\[color:/;
const RE_NON_COLOR_HINT = new RegExp(
	`^\\[(?:${ARBITRARY_TYPE_HINTS.filter((h) => h !== "color").join("|")}):`,
);
// Simple numeric length/percentage values — [1rem], [2px], [50%], [-4vh] — are
// unambiguously not colors. Reject them so `border-[1rem]` falls through to
// borderGenerator as border-width instead of being absorbed as border-color.
// Non-simple expressions (var(), calc(), etc.) stay accepted to preserve
// existing ambiguous cases like bg-(--my-color) → [var(--my-color)].
const RE_ARBITRARY_LENGTH =
	/^\[-?\d+(?:\.\d+)?(?:rem|em|px|vh|vw|vmin|vmax|ch|ex|%|pt|pc|in|cm|mm|q|fr|s|ms|deg|rad|turn|grad)\]$/i;
// Bracketed values that unambiguously encode a color — hex or a CSS color
// function (alternation shared with the merge classifier in props.ts). Used
// by sibling generators (border-width, outline-width, gradient position,
// shadow) to reject color-shaped arbitraries that should route to the color
// path instead.
const RE_BRACKETED_COLOR = new RegExp(
	`^\\[(?:color:|[#]|(?:${COLOR_FUNCTION_ALTERNATION})\\s*\\()`,
);

/**
 * Whether a bracketed arbitrary value like `[#ff0000]` or `[rgb(255,0,0)]` is
 * shaped like a color. Ambiguous values (`[var(--x)]`, `[calc(...)]`) return
 * false — absent a preserved type hint there is no way to tell, and callers
 * fall back to their default (usually the non-color path).
 */
export function isBracketedColor(value: string): boolean {
	return RE_BRACKETED_COLOR.test(value);
}

// ---------------------------------------------------------------------------
// Color resolution
// ---------------------------------------------------------------------------

/**
 * Map from first segment of prefix to [prefix, cssProperty] candidates.
 * Enables O(1) dispatch instead of O(P) linear scan across all prefixes.
 * Candidates are sorted longest-first so "border-t" matches before "border".
 */
const COLOR_PREFIX_MAP = new Map<string, [string, string][]>();
{
	const entries: [string, string][] = [
		["border-t", "border-block-start-color"],
		["border-b", "border-block-end-color"],
		["border-l", "border-inline-start-color"],
		["border-r", "border-inline-end-color"],
		["border-s", "border-inline-start-color"],
		["border-e", "border-inline-end-color"],
		["border-bs", "border-block-start-color"],
		["border-be", "border-block-end-color"],
		["border-x", "border-inline-color"],
		["border-y", "border-block-color"],
		["border", "border-color"],
		["text", "color"],
		["bg", "background-color"],
		["outline", "outline-color"],
		["accent", "accent-color"],
		["caret", "caret-color"],
		["fill", "fill"],
		["stroke", "stroke"],
	];
	for (const [prefix, prop] of entries) {
		const dashIdx = prefix.indexOf("-");
		const key = dashIdx === -1 ? prefix : prefix.slice(0, dashIdx);
		const existing = COLOR_PREFIX_MAP.get(key);
		if (existing) {
			existing.push([prefix, prop]);
		} else {
			COLOR_PREFIX_MAP.set(key, [[prefix, prop]]);
		}
	}
	// Sort each bucket longest-first for greedy matching
	for (const bucket of COLOR_PREFIX_MAP.values()) {
		bucket.sort((a, b) => b[0].length - a[0].length);
	}
}

// SPECIAL_COLORS lives in merge/props.ts so the merge classifier and this
// resolver can never drift.

// Gradient direction map
// divide-* values owned by borderGenerator (axis/style forms, not colors).
const DIVIDE_NON_COLOR_RE = /^divide-(?:x|y|solid|dashed|dotted|double|hidden|none)(?:-|$)/;

/**
 * Shared body for the bg-conic/bg-radial families — `/interp`, `-value[/interp]`,
 * and the bare form. The numeric-angle form (`from Ndeg`) exists only for conic.
 */
function resolveRoundGradient(
	afterPrefix: string,
	fallback: string,
	numericAngle: boolean,
): UtilityResult | null {
	let valueStr = "";
	let interpolation = "";

	if (afterPrefix.startsWith("/")) {
		// bg-conic/oklab — interpolation only
		interpolation = resolveInterpolation(afterPrefix.slice(1));
	} else if (afterPrefix.startsWith("-")) {
		const { base, alpha } = splitAlphaSuffix(afterPrefix.slice(1));
		valueStr = base;
		interpolation = alpha ? resolveInterpolation(alpha) : "";
	}

	if (!valueStr) {
		// Bare form, possibly with interpolation
		const pairs: [string, string][] = [];
		if (interpolation) pairs.push(["--ri-gradient-position", interpolation.trim()]);
		pairs.push(["background-image", fallback]);
		return multi(...pairs);
	}

	// Numeric angle: bg-conic-45 → from 45deg
	if (numericAngle && INTEGER_RE.test(valueStr)) {
		return multi(
			["--ri-gradient-position", `from ${valueStr}deg${interpolation}`],
			["background-image", fallback],
		);
	}

	// Arbitrary: bg-conic-[from_90deg_at_center] / bg-radial-[circle_at_top]
	if (valueStr.startsWith("[") && valueStr.endsWith("]")) {
		const sanitized = sanitizeArbitraryValue(valueStr);
		if (sanitized !== null) {
			const inner = sanitized.slice(1, -1).replaceAll("_", " ");
			return multi(
				["--ri-gradient-position", `${inner}${interpolation}`],
				["background-image", fallback],
			);
		}
	}
	return null;
}

const GRADIENT_DIRS: Readonly<Record<string, string>> = Object.freeze({
	t: "to top",
	tr: "to top right",
	r: "to right",
	br: "to bottom right",
	b: "to bottom",
	bl: "to bottom left",
	l: "to left",
	tl: "to top left",
});

// Color interpolation method map (modifier after `/`)
const INTERPOLATION_METHODS: Readonly<Record<string, string>> = Object.freeze({
	oklab: " in oklab",
	oklch: " in oklch",
	srgb: " in srgb",
	hsl: " in hsl",
	longer: " in oklch longer hue",
	shorter: " in oklch shorter hue",
	increasing: " in oklch increasing hue",
	decreasing: " in oklch decreasing hue",
});

/**
 * Resolve a gradient position value (percentage or arbitrary length).
 * Returns a CSS value string, or null if the input is not a valid position.
 *
 * Supported values:
 * - Named percentages: 0%, 5%, 10%, ..., 100% (in 5% increments, plus 0% and 100%)
 * - Arbitrary: [50%], [20px], [calc(50%-1rem)]
 */
function resolveGradientPosition(val: string): string | null {
	// Arbitrary bracket value
	if (val.startsWith("[") && val.endsWith("]")) {
		// Color-shaped values belong to the from/via/to color branch.
		if (isBracketedColor(val)) return null;
		const sanitized = sanitizeArbitraryValue(val);
		if (sanitized === null) return null;
		return sanitized.slice(1, -1);
	}

	// Named percentage: "0%", "5%", "10%", ..., "100%"
	if (val.endsWith("%")) {
		const numStr = val.slice(0, -1);
		const num = Number(numStr);
		if (!Number.isNaN(num) && Number.isInteger(num) && num >= 0 && num <= 100) {
			return `${num}%`;
		}
	}

	return null;
}

/**
 * Resolve an interpolation modifier from the `/` suffix on gradient direction utilities.
 * Returns the CSS interpolation string (with leading space), or empty string if not valid.
 */
function resolveInterpolation(modifier: string): string {
	// Named interpolation method
	if (Object.hasOwn(INTERPOLATION_METHODS, modifier)) {
		return INTERPOLATION_METHODS[modifier];
	}
	// Arbitrary: [in_hsl_longer_hue] → " in hsl longer hue"
	if (modifier.startsWith("[") && modifier.endsWith("]")) {
		const sanitized = sanitizeArbitraryValue(modifier);
		if (sanitized !== null) {
			const inner = sanitized.slice(1, -1).replaceAll("_", " ");
			return ` ${inner}`;
		}
	}
	return "";
}

// Gradient stops composition — flat values with no nested var() fallback commas.
// --ri-gradient-stops holds the complete argument list for the gradient function,
// including the direction. This avoids commas inside var() fallbacks which some
// CSS processors (Vite, esbuild) incorrectly strip.
const GRADIENT_STOPS_2 =
	"var(--ri-gradient-position), var(--ri-gradient-from, transparent) var(--ri-gradient-from-position), var(--ri-gradient-to, transparent) var(--ri-gradient-to-position)";

const GRADIENT_STOPS_3 =
	"var(--ri-gradient-position), var(--ri-gradient-from, transparent) var(--ri-gradient-from-position), var(--ri-gradient-via) var(--ri-gradient-via-position), var(--ri-gradient-to, transparent) var(--ri-gradient-to-position)";

function splitAlphaSuffix(input: string): { base: string; alpha: string | null } {
	let parenDepth = 0;
	let bracketDepth = 0;
	for (let i = input.length - 1; i >= 0; i--) {
		const ch = input[i];
		if (ch === "]") {
			bracketDepth++;
		} else if (ch === "[") {
			bracketDepth--;
		} else if (ch === ")") {
			parenDepth++;
		} else if (ch === "(") {
			parenDepth--;
		} else if (ch === "/" && parenDepth === 0 && bracketDepth === 0) {
			const base = input.slice(0, i);
			const alpha = input.slice(i + 1);
			if (base && alpha) return { base, alpha };
			break;
		}
	}
	return { base: input, alpha: null };
}

function alphaToPercent(alpha: string, theme: ResolvedTheme): number | string | null {
	const token = alpha.trim();
	if (!token) return null;

	// Arbitrary bracket modifier: [50%], [0.5], [calc(var(--opacity)*100%)]
	if (token.startsWith("[") && token.endsWith("]")) {
		// Same injection defense as every other arbitrary path — a raw modifier
		// would otherwise carry `;`/`{}` straight into the emitted color-mix().
		const sanitized = sanitizeArbitraryValue(token);
		if (sanitized === null) return null;
		const inner = decodeArbitraryValue(sanitized.slice(1, -1));
		// Try parsing as a number — same normalization as named values
		const isPercent = inner.endsWith("%");
		const raw = isPercent ? inner.slice(0, -1) : inner;
		const num = Number.parseFloat(raw);
		if (!Number.isNaN(num) && String(num) === raw) {
			return clampAlphaPercent(num, isPercent);
		}
		// Not a simple number — return as raw CSS string (e.g. calc(), var())
		return inner;
	}

	// CSS variable shorthand modifier: (--my-opacity)
	if (token.startsWith("(") && token.endsWith(")")) {
		const inner = token.slice(1, -1);
		if (CSS_VAR_NAME_RE.test(inner)) {
			return `var(${inner})`;
		}
		return null;
	}

	if (Object.hasOwn(theme.opacity, token)) {
		const themed = theme.opacity[token].trim();
		const themedPercent = themed.endsWith("%");
		const themedRaw = themedPercent ? themed.slice(0, -1) : themed;
		const themedNum = Number.parseFloat(themedRaw);
		if (Number.isNaN(themedNum)) return null;
		return clampAlphaPercent(themedNum, themedPercent);
	}

	const isExplicitPercent = token.endsWith("%");
	const raw = isExplicitPercent ? token.slice(0, -1) : token;
	const num = Number.parseFloat(raw);
	if (Number.isNaN(num)) return null;
	return clampAlphaPercent(num, isExplicitPercent);
}

function applyAlpha(color: string, alpha: string | null, theme: ResolvedTheme): string {
	if (alpha === null) return color;
	const result = alphaToPercent(alpha, theme);
	if (result === null) return color;
	return mixColorAlpha(color, result);
}

export function resolveColor(
	colorName: string,
	theme: ResolvedTheme,
	dataType?: string | null,
): string | null {
	// Explicit non-color hint (length, number, percentage, …) — the user
	// forced a non-color interpretation, so decline regardless of value shape.
	if (dataType && dataType !== "color") return null;

	const { base: baseColorName, alpha } = splitAlphaSuffix(colorName);

	// Arbitrary value — sanitize to prevent CSS injection (expression(), -moz-binding, etc.)
	if (baseColorName.startsWith("[") && baseColorName.endsWith("]")) {
		// A `color` dataType hint (from border-[color:var(--x)] or border-(color:--x))
		// forces the color path regardless of heuristic. Without a hint, fall back to
		// detecting unambiguous non-colors so siblings (border-width, etc.) can claim
		// them. `[color:...]` bracket-internal hints are a legacy defense-in-depth
		// fallback; the preferred signal is the structural `dataType`.
		if (dataType !== "color" && !RE_COLOR_HINT.test(baseColorName)) {
			if (RE_NON_COLOR_HINT.test(baseColorName)) return null;
			if (RE_ARBITRARY_LENGTH.test(baseColorName)) return null;
		}
		const sanitized = sanitizeArbitraryValue(baseColorName);
		if (sanitized === null) return null;
		return applyAlpha(decodeArbitraryValue(sanitized.slice(1, -1)), alpha, theme);
	}

	// Special colors
	const specialValue = SPECIAL_COLORS[baseColorName];
	if (specialValue !== undefined) {
		return applyAlpha(specialValue, alpha, theme);
	}

	// Palette color: e.g. "red-500". Only generative colors (and aliases whose
	// source is generative) emit per-stop variables, so we must reject the
	// suffixed form for explicit/pair/keyword entries — otherwise we'd produce
	// a dangling var(--color-${hue}-${stop}) reference.
	const lastDash = baseColorName.lastIndexOf("-");
	if (lastDash !== -1) {
		const hue = baseColorName.slice(0, lastDash);
		const stop = Number(baseColorName.slice(lastDash + 1));
		if (
			Object.hasOwn(theme.colors, hue) &&
			isValidColorSuffix(stop) &&
			hasStopVariables(hue, theme.colors)
		) {
			return applyAlpha(`var(--color-${hue}-${stop})`, alpha, theme);
		}
	}

	// Keyword colors (transparent, currentColor, inherit): inline directly, no var()
	if (
		Object.hasOwn(theme.colors, baseColorName) &&
		theme.colors[baseColorName].type === "keyword"
	) {
		return applyAlpha(theme.colors[baseColorName].value, alpha, theme);
	}

	// Bare color name for explicit/pair colors: e.g. "accent"
	if (Object.hasOwn(theme.colors, baseColorName)) {
		return applyAlpha(`var(--color-${baseColorName})`, alpha, theme);
	}

	return null;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function colorGenerator(
	utility: string,
	value: string | null,
	_negative: boolean,
	theme: ResolvedTheme,
	_warnings?: string[],
	dataType?: string | null,
): UtilityResult | null {
	const full = fullName(utility, value);

	// bg-position-* → background-position, bg-size-* → background-size, and
	// bg-(image:<custom-property>) / bg-[<image>] → background-image. These run
	// before the color dispatch so image/position/size values aren't claimed as
	// background-color.
	if (full.startsWith("bg-")) {
		if (full.startsWith("bg-position-")) {
			const arb = extractArbitrary(full.slice(12));
			if (arb !== null) return single("background-position", arb);
		}
		if (full.startsWith("bg-size-")) {
			const arb = extractArbitrary(full.slice(8));
			if (arb !== null) return single("background-size", arb);
		}
		const bgArb = extractArbitrary(full.slice(3));
		if (bgArb !== null && (dataType === "image" || RE_IMAGE_VALUE.test(bgArb))) {
			return single("background-image", bgArb);
		}
	}

	// Try color prefixes: text-red-500, bg-blue-200, etc.
	// O(1) dispatch on the first segment of the utility name.
	const firstDash = utility.indexOf("-");
	const firstSeg = firstDash === -1 ? utility : utility.slice(0, firstDash);
	const candidates = COLOR_PREFIX_MAP.get(firstSeg);
	if (candidates) {
		for (const [prefix, cssProperty] of candidates) {
			// `full.startsWith(prefix + "-")` without the per-candidate template —
			// this loop runs for every color-shaped class.
			const isExact = utility === prefix;
			if (
				!isExact &&
				!((full.startsWith(prefix) && full.charCodeAt(prefix.length) === 45) /* '-' */)
			)
				continue;
			const colorName = isExact && value !== null ? value : full.slice(prefix.length + 1);
			if (!colorName) continue;

			const resolved = resolveColor(colorName, theme, dataType);
			if (resolved) return single(cssProperty, resolved);
		}
	}

	// divide-{color}: border-color on children
	// Skip values handled by borderGenerator (divide-x, divide-y, divide-{style})
	if (full.startsWith("divide-") && !DIVIDE_NON_COLOR_RE.test(full)) {
		const colorName = full.slice(7);
		const resolved = resolveColor(colorName, theme, dataType);
		if (resolved) {
			return {
				declarations: [{ property: "border-color", value: resolved }],
				nestedSelector: "& > :not(:last-child)",
			};
		}
	}

	// -----------------------------------------------------------------------
	// Gradient direction utilities
	// -----------------------------------------------------------------------

	// bg-linear-to-{dir}, bg-linear-{angle}, bg-linear-[arbitrary]
	if (full.startsWith("bg-linear-")) {
		const afterPrefix = full.slice(10); // after "bg-linear-"
		const { base, alpha } = splitAlphaSuffix(afterPrefix);
		const interpolation = alpha ? resolveInterpolation(alpha) : "";

		// Direction keyword: bg-linear-to-r
		if (base.startsWith("to-")) {
			const gradientDir = GRADIENT_DIRS[base.slice(3)];
			if (gradientDir) {
				return multi(
					["--ri-gradient-position", `${gradientDir}${interpolation}`],
					["background-image", "linear-gradient(var(--ri-gradient-stops))"],
				);
			}
		}

		// Numeric angle: bg-linear-45 → 45deg
		if (INTEGER_RE.test(base)) {
			return multi(
				["--ri-gradient-position", `${base}deg${interpolation}`],
				["background-image", "linear-gradient(var(--ri-gradient-stops))"],
			);
		}

		// Arbitrary: bg-linear-[125deg], bg-linear-[to_bottom]
		if (base.startsWith("[") && base.endsWith("]")) {
			const sanitized = sanitizeArbitraryValue(base);
			if (sanitized !== null) {
				const inner = sanitized.slice(1, -1).replaceAll("_", " ");
				return multi(
					["--ri-gradient-position", `${inner}${interpolation}`],
					["background-image", "linear-gradient(var(--ri-gradient-stops))"],
				);
			}
		}
	}

	// bg-conic, bg-conic-{angle}, bg-conic-[arbitrary], bg-conic/{interpolation}
	if (full === "bg-conic" || full.startsWith("bg-conic-") || full.startsWith("bg-conic/")) {
		const r = resolveRoundGradient(full.slice(8), "conic-gradient(var(--ri-gradient-stops))", true);
		if (r) return r;
	}

	// bg-radial, bg-radial-[arbitrary], bg-radial/{interpolation}
	if (full === "bg-radial" || full.startsWith("bg-radial-") || full.startsWith("bg-radial/")) {
		const r = resolveRoundGradient(
			full.slice(9),
			"radial-gradient(var(--ri-gradient-stops))",
			false,
		);
		if (r) return r;
	}

	// -----------------------------------------------------------------------
	// Gradient stop utilities: from-*, via-*, to-*
	// -----------------------------------------------------------------------

	// from-{color} or from-{position}
	if (full.startsWith("from-")) {
		const val = full.slice(5);

		// Position stop: from-50%, from-[20px]. Skip when hint forces color.
		if (dataType !== "color") {
			const position = resolveGradientPosition(val);
			if (position) return single("--ri-gradient-from-position", position);
		}

		// Color stop: from-red-500
		const resolved = resolveColor(val, theme, dataType);
		if (resolved)
			return multi(["--ri-gradient-from", resolved], ["--ri-gradient-stops", GRADIENT_STOPS_2]);
	}

	// via-none | via-{color} | via-{position}
	if (full.startsWith("via-")) {
		const val = full.slice(4);

		// via-none: clear the via color, revert to 2-stop
		if (val === "none") {
			return multi(["--ri-gradient-via", "initial"], ["--ri-gradient-stops", GRADIENT_STOPS_2]);
		}

		// Position stop: via-30%, via-[10px]. Skip when hint forces color.
		if (dataType !== "color") {
			const position = resolveGradientPosition(val);
			if (position) return single("--ri-gradient-via-position", position);
		}

		// Color stop: via-yellow-400
		const resolved = resolveColor(val, theme, dataType);
		if (resolved)
			return multi(["--ri-gradient-via", resolved], ["--ri-gradient-stops", GRADIENT_STOPS_3]);
	}

	// to-{color} or to-{position}
	if (full.startsWith("to-")) {
		const val = full.slice(3);

		// Position stop: to-90%, to-[80px]. Skip when hint forces color.
		if (dataType !== "color") {
			const position = resolveGradientPosition(val);
			if (position) return single("--ri-gradient-to-position", position);
		}

		// Color stop: to-green-500
		const resolved = resolveColor(val, theme, dataType);
		if (resolved)
			return multi(["--ri-gradient-to", resolved], ["--ri-gradient-stops", GRADIENT_STOPS_2]);
	}

	// decoration-{color}
	if (full.startsWith("decoration-")) {
		const resolved = resolveColor(full.slice(11), theme, dataType);
		if (resolved) return single("text-decoration-color", resolved);
	}

	return null;
}
