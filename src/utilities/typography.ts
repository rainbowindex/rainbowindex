/**
 * Typography utilities — text sizing, font family/weight,
 * leading, tracking, alignment, wrapping, transforms, decoration.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import { fluidBoundExprs, fluidInterpolation } from "../shared.js";
import { isFontFamilyValue } from "../merge/props.js";
import { devWarn } from "../runtime.js";
import { isBracketedColor } from "./color.js";
import {
	type UtilityResult,
	single,
	multi,
	spacingLookup,
	parseRemValue,
	fullName,
	extractArbitrary,
	deepFreezeUtilityMap,
	INTEGER_RE,
} from "./index.js";
import { decodeArbitraryValue, sanitizeArbitraryValue } from "./parser.js";

// ---------------------------------------------------------------------------
// Static utilities
// ---------------------------------------------------------------------------

/** Integer with optional percent suffix (font-stretch values). */
const INT_PERCENT_RE = /^\d+%?$/;

/** Composed font-variant-numeric value reading every slot var. */
const FONT_VARIANT_NUMERIC_COMPOSED =
	"var(--ri-ordinal, ) var(--ri-slashed-zero, ) var(--ri-numeric-figure, ) var(--ri-numeric-spacing, ) var(--ri-numeric-fraction, )";

/** One slot of the composable font-variant-numeric family. */
function fontVariantNumeric(slotVar: string, value: string): UtilityResult {
	return multi([slotVar, value], ["font-variant-numeric", FONT_VARIANT_NUMERIC_COMPOSED]);
}

const STATIC_TEXT: Record<string, UtilityResult> = {
	// Text alignment
	"text-left": single("text-align", "left"),
	"text-center": single("text-align", "center"),
	"text-right": single("text-align", "right"),
	"text-justify": single("text-align", "justify"),
	"text-start": single("text-align", "start"),
	"text-end": single("text-align", "end"),

	// Text wrapping
	"text-wrap": single("text-wrap", "wrap"),
	"text-nowrap": single("text-wrap", "nowrap"),
	"text-balance": single("text-wrap", "balance"),
	"text-pretty": single("text-wrap", "pretty"),

	// Text transforms
	uppercase: single("text-transform", "uppercase"),
	lowercase: single("text-transform", "lowercase"),
	capitalize: single("text-transform", "capitalize"),
	"normal-case": single("text-transform", "none"),

	// Text overflow
	truncate: multi(["overflow", "hidden"], ["text-overflow", "ellipsis"], ["white-space", "nowrap"]),
	"text-clip": single("text-overflow", "clip"),
	"text-ellipsis": single("text-overflow", "ellipsis"),

	// Hyphens
	"hyphens-none": single("hyphens", "none"),
	"hyphens-manual": single("hyphens", "manual"),
	"hyphens-auto": single("hyphens", "auto"),

	// Overflow wrap
	"wrap-normal": single("overflow-wrap", "normal"),
	"wrap-break-word": single("overflow-wrap", "break-word"),
	"wrap-anywhere": single("overflow-wrap", "anywhere"),

	// Font variant numeric — all combine via the composed slot vars
	"normal-nums": single("font-variant-numeric", "normal"),
	ordinal: fontVariantNumeric("--ri-ordinal", "ordinal"),
	"slashed-zero": fontVariantNumeric("--ri-slashed-zero", "slashed-zero"),
	"lining-nums": fontVariantNumeric("--ri-numeric-figure", "lining-nums"),
	"oldstyle-nums": fontVariantNumeric("--ri-numeric-figure", "oldstyle-nums"),
	"proportional-nums": fontVariantNumeric("--ri-numeric-spacing", "proportional-nums"),
	"tabular-nums": fontVariantNumeric("--ri-numeric-spacing", "tabular-nums"),
	"diagonal-fractions": fontVariantNumeric("--ri-numeric-fraction", "diagonal-fractions"),
	"stacked-fractions": fontVariantNumeric("--ri-numeric-fraction", "stacked-fractions"),

	// Font stretch (static keyword values)
	"font-stretch-normal": single("font-stretch", "normal"),
	"font-stretch-ultra-condensed": single("font-stretch", "ultra-condensed"),
	"font-stretch-extra-condensed": single("font-stretch", "extra-condensed"),
	"font-stretch-condensed": single("font-stretch", "condensed"),
	"font-stretch-semi-condensed": single("font-stretch", "semi-condensed"),
	"font-stretch-semi-expanded": single("font-stretch", "semi-expanded"),
	"font-stretch-expanded": single("font-stretch", "expanded"),
	"font-stretch-extra-expanded": single("font-stretch", "extra-expanded"),
	"font-stretch-ultra-expanded": single("font-stretch", "ultra-expanded"),

	// List image reset
	"list-image-none": single("list-style-image", "none"),

	// Text decoration line
	underline: single("text-decoration-line", "underline"),
	overline: single("text-decoration-line", "overline"),
	"line-through": single("text-decoration-line", "line-through"),
	"no-underline": single("text-decoration-line", "none"),

	// Text decoration style
	"decoration-solid": single("text-decoration-style", "solid"),
	"decoration-dashed": single("text-decoration-style", "dashed"),
	"decoration-dotted": single("text-decoration-style", "dotted"),
	"decoration-double": single("text-decoration-style", "double"),
	"decoration-wavy": single("text-decoration-style", "wavy"),

	// Text decoration thickness
	"decoration-auto": single("text-decoration-thickness", "auto"),
	"decoration-from-font": single("text-decoration-thickness", "from-font"),

	// Whitespace
	"whitespace-normal": single("white-space", "normal"),
	"whitespace-nowrap": single("white-space", "nowrap"),
	"whitespace-pre": single("white-space", "pre"),
	"whitespace-pre-line": single("white-space", "pre-line"),
	"whitespace-pre-wrap": single("white-space", "pre-wrap"),
	"whitespace-break-spaces": single("white-space", "break-spaces"),

	// Word break
	"break-normal": single("word-break", "normal"),
	"break-words": single("overflow-wrap", "break-word"),
	"break-all": single("word-break", "break-all"),
	"break-keep": single("word-break", "keep-all"),

	// Font style
	italic: single("font-style", "italic"),
	"not-italic": single("font-style", "normal"),

	// Font smoothing
	antialiased: multi(
		["-webkit-font-smoothing", "antialiased"],
		["-moz-osx-font-smoothing", "grayscale"],
	),
	"subpixel-antialiased": multi(
		["-webkit-font-smoothing", "auto"],
		["-moz-osx-font-smoothing", "auto"],
	),

	// Vertical alignment
	"align-baseline": single("vertical-align", "baseline"),
	"align-top": single("vertical-align", "top"),
	"align-middle": single("vertical-align", "middle"),
	"align-bottom": single("vertical-align", "bottom"),
	"align-text-top": single("vertical-align", "text-top"),
	"align-text-bottom": single("vertical-align", "text-bottom"),
	"align-sub": single("vertical-align", "sub"),
	"align-super": single("vertical-align", "super"),

	// List style
	"list-none": single("list-style-type", "none"),
	"list-disc": single("list-style-type", "disc"),
	"list-decimal": single("list-style-type", "decimal"),
	"list-inside": single("list-style-position", "inside"),
	"list-outside": single("list-style-position", "outside"),

	// Content
	"content-none": single("content", "none"),
};
deepFreezeUtilityMap(STATIC_TEXT);

// ---------------------------------------------------------------------------
// Fluid Typography
// ---------------------------------------------------------------------------

/**
 * Build a sorted scale of theme text sizes by their rem value for fluid lookups.
 * Returns entries sorted ascending by font-size. Cached per theme object.
 */
const _textScaleCache = new WeakMap<ResolvedTheme, Array<{ name: string; rem: number }>>();

/** Split a text-size token on its line-height modifier `/`, respecting brackets/parens. */
function splitLineHeightModifier(s: string): { base: string; modifier: string | null } {
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === "[" || ch === "(") depth++;
		else if (ch === "]" || ch === ")") depth--;
		else if (ch === "/" && depth === 0) return { base: s.slice(0, i), modifier: s.slice(i + 1) };
	}
	return { base: s, modifier: null };
}

/** Resolve a text line-height modifier (text-lg/{mod}). Mirrors leading-* so text-lg/7 ≡ leading-7. */
function resolveLineHeightModifier(mod: string, theme: ResolvedTheme): string | null {
	if (Object.hasOwn(theme.leading, mod)) return theme.leading[mod];
	if (mod.startsWith("(") && mod.endsWith(")")) {
		const inner = mod.slice(1, -1);
		return /^--[a-zA-Z_][\w-]*$/.test(inner) ? `var(${inner})` : null;
	}
	// Modifiers bypass parseUtility's bracket sanitization. Reject — don't strip —
	// when sanitization would change the value: the stripped remainder of e.g.
	// [1.5;color:red] is "1.5color:red", whose top-level colon breaks emitted CSS.
	if (mod.startsWith("[") && mod.endsWith("]")) {
		return sanitizeArbitraryValue(mod) === mod ? extractArbitrary(mod) : null;
	}
	return null;
}

function isDisplayScaleName(name: string): boolean {
	const match = /^(\d+)xl$/.exec(name);
	return match ? Number(match[1]) >= 4 : false;
}

function buildSortedTextScale(theme: ResolvedTheme): Array<{ name: string; rem: number }> {
	const cached = _textScaleCache.get(theme);
	if (cached) return cached;

	const entries: Array<{ name: string; rem: number }> = [];
	for (const [name, def] of Object.entries(theme.text)) {
		const rem = parseRemValue(def.fontSize);
		if (rem !== null) entries.push({ name, rem });
	}
	entries.sort((a, b) => a.rem - b.rem);
	_textScaleCache.set(theme, entries);
	return entries;
}

function generateFluidText(size: string, theme: ResolvedTheme): UtilityResult | null {
	if (!Object.hasOwn(theme.text, size)) return null;

	const maxRaw = parseRemValue(theme.text[size].fontSize);
	if (maxRaw === null) {
		devWarn(
			`[RI-1501] text-fluid-${size} requires a rem-based font size, but "${theme.text[size].fontSize}" is not in rem.`,
		);
		return null;
	}

	const scale = buildSortedTextScale(theme);
	const idx = scale.findIndex((entry) => entry.name === size);
	if (idx === -1) return null;

	let minSize: string | null = null;
	if (isDisplayScaleName(size)) {
		const minIdx = idx - 2;
		minSize = minIdx >= 0 ? scale[minIdx].name : null;
	} else {
		const minIdx = idx - 1;
		minSize = minIdx >= 0 ? scale[minIdx].name : null;
	}

	if (!minSize || !Object.hasOwn(theme.text, minSize)) {
		devWarn(
			`[RI-1502] text-fluid-${size} has no smaller size to interpolate from — fluid typography requires at least one step below.`,
		);
		return null;
	}

	const minRaw = parseRemValue(theme.text[minSize].fontSize);
	if (minRaw === null) return null;

	const fluidMinRaw = parseRemValue(theme.textFluid?.min ?? theme.fluid.min);
	const fluidMaxRaw = parseRemValue(theme.textFluid?.max ?? theme.fluid.max);
	if (fluidMinRaw === null || fluidMaxRaw === null) return null;

	const range = fluidMaxRaw - fluidMinRaw;
	if (range <= 0) return null;

	const diff = Math.round((maxRaw - minRaw) * 1000) / 1000;

	const unit = theme.textFluid?.unit ?? theme.fluid.unit ?? "vi";
	const { min: minExpr, range: rangeExpr } = fluidBoundExprs("text");
	const fontSize = `clamp(var(--text-${minSize}), ${fluidInterpolation(minRaw, diff, unit, minExpr, rangeExpr)}, var(--text-${size}))`;

	return multi(["font-size", fontSize], ["line-height", `var(--text-${size}-leading)`]);
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function typographyGenerator(
	utility: string,
	value: string | null,
	negative: boolean,
	theme: ResolvedTheme,
	_warnings?: string[],
	dataType?: string | null,
): UtilityResult | null {
	const full = fullName(utility, value);

	// Static utilities
	if (Object.hasOwn(STATIC_TEXT, full)) return STATIC_TEXT[full];

	// text-fluid-{size}: fluid font-size + line-height
	if (full.startsWith("text-fluid-")) {
		const sizeName = full.slice(11);
		return generateFluidText(sizeName, theme);
	}

	// text-{size}[/{line-height}]: font-size + line-height from theme, with an
	// optional `/modifier` overriding the line-height (text-lg/7, text-lg/[1.5]).
	if (full.startsWith("text-")) {
		const { base: sizeName, modifier } = splitLineHeightModifier(full.slice(5));
		const lh = modifier !== null ? resolveLineHeightModifier(modifier, theme) : null;
		if (Object.hasOwn(theme.text, sizeName)) {
			return multi(
				["font-size", `var(--text-${sizeName})`],
				["line-height", lh ?? `var(--text-${sizeName}-leading)`],
			);
		}
		// text-[arbitrary] — skip color-shaped values so they fall through to the color generator
		if (!isBracketedColor(sizeName)) {
			const arbText = extractArbitrary(sizeName);
			if (arbText) {
				return lh !== null
					? multi(["font-size", arbText], ["line-height", lh])
					: single("font-size", arbText);
			}
		}
	}

	// font-features-[<value>] / font-features-(<custom-property>) → font-feature-settings
	if (full.startsWith("font-features-")) {
		const arb = extractArbitrary(full.slice(14));
		if (arb !== null) return single("font-feature-settings", arb);
	}

	// font-{weight}: font-weight from theme
	if (full.startsWith("font-")) {
		const name = full.slice(5);
		if (Object.hasOwn(theme.weights, name)) {
			return single("font-weight", String(theme.weights[name]));
		}
		// font-{family} from loaded fonts — also applies the slot's feature/variation
		// settings when defined, so the @font directive is the single source of truth.
		const fontConfig = theme.fonts.find((f) => f.slot === name);
		if (fontConfig || name === "sans" || name === "serif" || name === "mono") {
			const family = `var(--font-${name})`;
			const decls: Array<[string, string]> = [["font-family", family]];
			if (fontConfig?.features) {
				decls.push(["font-feature-settings", `var(--font-${name}--features)`]);
			}
			if (fontConfig?.variation) {
				decls.push(["font-variation-settings", `var(--font-${name}--variations)`]);
			}
			return decls.length === 1 ? single("font-family", family) : multi(...decls);
		}
		// font-[arbitrary] — family vs weight decided by the shared merge-side
		// predicate; the parser surfaces a `family-name:` hint as dataType. The
		// predicate sees the undecoded bracket form (same input as the merger);
		// only the emitted value decodes underscores.
		if (name.startsWith("[") && name.endsWith("]")) {
			const raw = decodeArbitraryValue(name.slice(1, -1));
			if (dataType === "family-name" || isFontFamilyValue(name)) {
				return single("font-family", raw);
			}
			return single("font-weight", raw);
		}
	}

	// leading-{n}: line-height
	if (full.startsWith("leading-")) {
		const name = full.slice(8);
		if (Object.hasOwn(theme.leading, name)) {
			return single("line-height", theme.leading[name]);
		}
		const arbLeading = extractArbitrary(name);
		if (arbLeading) return single("line-height", arbLeading);
		if (name === "px") return single("line-height", "1px");
	}

	// tracking-{n}: letter-spacing
	if (full.startsWith("tracking-")) {
		const name = full.slice(9);
		if (Object.hasOwn(theme.tracking, name)) {
			return single("letter-spacing", theme.tracking[name]);
		}
		const arbTracking = extractArbitrary(name);
		if (arbTracking) return single("letter-spacing", arbTracking);
	}

	// decoration-{n} (thickness, when not a color — color handled in color.ts)
	if (full.startsWith("decoration-")) {
		const name = full.slice(11);
		if (INTEGER_RE.test(name)) {
			return single("text-decoration-thickness", `${name}px`);
		}
		if (name.startsWith("[") && name.endsWith("]")) {
			const raw = name.slice(1, -1);
			// A `length:` hint forces thickness. Otherwise color-shaped values and bare
			// custom properties (decoration-(--c)) defer to colorGenerator → decoration-color.
			if (dataType !== "length" && (isBracketedColor(name) || raw.startsWith("var("))) {
				return null;
			}
			return single("text-decoration-thickness", raw);
		}
	}

	// indent-{n}: text-indent
	if (full.startsWith("indent-")) {
		const name = full.slice(7);
		const arbIndent = extractArbitrary(name);
		if (arbIndent) return single("text-indent", arbIndent);
		const sp = spacingLookup(name, negative);
		if (sp) return single("text-indent", sp);
	}

	// tab-{number} | tab-(<custom-property>) | tab-[<value>] → tab-size
	if (full.startsWith("tab-")) {
		const name = full.slice(4);
		const arb = extractArbitrary(name);
		if (arb !== null) return single("tab-size", arb);
		if (INTEGER_RE.test(name)) return single("tab-size", name);
	}

	// align-[<value>] / align-(<custom-property>) → vertical-align (keyword statics above)
	if (full.startsWith("align-")) {
		const arb = extractArbitrary(full.slice(6));
		if (arb !== null) return single("vertical-align", arb);
	}

	// content-['...']
	if (full.startsWith("content-")) {
		const arbContent = extractArbitrary(full.slice(8));
		if (arbContent) return single("content", arbContent);
	}

	// line-clamp-{n}, line-clamp-none
	if (full === "line-clamp-none") {
		return multi(
			["overflow", "visible"],
			["display", "block"],
			["-webkit-box-orient", "horizontal"],
			["-webkit-line-clamp", "unset"],
		);
	}
	if (full.startsWith("line-clamp-")) {
		const name = full.slice(11);
		if (INTEGER_RE.test(name)) {
			return multi(
				["overflow", "hidden"],
				["display", "-webkit-box"],
				["-webkit-box-orient", "vertical"],
				["-webkit-line-clamp", name],
			);
		}
		const arb = extractArbitrary(name);
		if (arb !== null) {
			return multi(
				["overflow", "hidden"],
				["display", "-webkit-box"],
				["-webkit-box-orient", "vertical"],
				["-webkit-line-clamp", arb],
			);
		}
	}

	// underline-offset-{n}: text-underline-offset
	if (full === "underline-offset-auto") return single("text-underline-offset", "auto");
	if (full.startsWith("underline-offset-")) {
		const name = full.slice(17);
		if (INTEGER_RE.test(name))
			return single("text-underline-offset", negative ? `calc(${name}px * -1)` : `${name}px`);
		const arb = extractArbitrary(name);
		if (arb !== null) return single("text-underline-offset", negative ? `calc(${arb} * -1)` : arb);
	}

	// font-stretch-{n}: numeric percentage, or arbitrary
	if (full.startsWith("font-stretch-")) {
		const name = full.slice(13);
		const arb = extractArbitrary(name);
		if (arb !== null) return single("font-stretch", arb);
		if (INT_PERCENT_RE.test(name)) {
			const v = name.endsWith("%") ? name : `${name}%`;
			return single("font-stretch", v);
		}
	}

	// list-image-{arbitrary}: list-style-image from arbitrary URL/gradient
	if (full.startsWith("list-image-")) {
		const arb = extractArbitrary(full.slice(11));
		if (arb !== null) return single("list-style-image", arb);
	}

	// list-[<value>] / list-(<custom-property>) → list-style-type
	// (statics handle disc/decimal/none/inside/outside; list-image-* handled above)
	if (full.startsWith("list-")) {
		const arb = extractArbitrary(full.slice(5));
		if (arb !== null) return single("list-style-type", arb);
	}

	return null;
}
