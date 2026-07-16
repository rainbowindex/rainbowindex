/**
 * Spacing utilities — padding, margin, gap, space-between, inset.
 * All directional utilities use CSS logical properties by default.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import { fluidBoundExprs, fluidInterpolation } from "../shared.js";
import {
	type UtilityResult,
	single,
	multi,
	spacingLookup,
	parseRemValue,
	extractArbitrary,
} from "./index.js";

// ---------------------------------------------------------------------------
// Value resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a spacing value to a CSS value string.
 * @param allowAuto — When false, rejects "auto" (invalid for gap, scroll-padding, padding).
 */
function resolveSpacing(
	val: string | null,
	negative: boolean,
	warnings?: string[],
	allowAuto = true,
): string | null {
	if (val === null) return null;
	// Arbitrary value
	const arb = extractArbitrary(val);
	if (arb !== null) return negative ? `calc(${arb} * -1)` : arb;
	// Named values
	if (val === "auto") return allowAuto ? "auto" : null;
	if (val === "full") {
		if (warnings) {
			warnings.push(
				`[RI-1018] "full" resolves to 100%, which is almost never intentional for padding/margin (percentage is relative to containing block width). Use an arbitrary value like p-[100%] if intentional.`,
			);
		}
		return "100%";
	}
	// Scale lookup (handles `px` → 1px, numeric → calc(n * var(--spacing)))
	return spacingLookup(val, negative);
}

/** Fraction value for inset utilities, e.g. `1/2`. */
const FRACTION_RE = /^(\d+)\/(\d+)$/;

/**
 * Resolve an inset value. Adds fraction support (`inset-1/2` → `calc(1/2 * 100%)`)
 * on top of the shared spacing resolution. Fractions are intentionally scoped to
 * inset here (not the shared resolveSpacing) so padding/margin/gap don't accept them.
 */
function resolveInsetValue(
	val: string | null,
	negative: boolean,
	warnings: string[] | undefined,
): string | null {
	if (val !== null && FRACTION_RE.test(val)) {
		return `calc(${val} * ${negative ? "-100%" : "100%"})`;
	}
	return resolveSpacing(val, negative, warnings, true);
}

// ---------------------------------------------------------------------------
// Direction maps (logical by default)
// ---------------------------------------------------------------------------

const PADDING_MAP: Readonly<Record<string, string[]>> = Object.freeze({
	p: ["padding"],
	px: ["padding-inline"],
	py: ["padding-block"],
	pt: ["padding-block-start"],
	pb: ["padding-block-end"],
	pl: ["padding-inline-start"],
	pr: ["padding-inline-end"],
	ps: ["padding-inline-start"],
	pe: ["padding-inline-end"],
	pbs: ["padding-block-start"],
	pbe: ["padding-block-end"],
});

const MARGIN_MAP: Readonly<Record<string, string[]>> = Object.freeze({
	m: ["margin"],
	mx: ["margin-inline"],
	my: ["margin-block"],
	mt: ["margin-block-start"],
	mb: ["margin-block-end"],
	ml: ["margin-inline-start"],
	mr: ["margin-inline-end"],
	ms: ["margin-inline-start"],
	me: ["margin-inline-end"],
	mbs: ["margin-block-start"],
	mbe: ["margin-block-end"],
});

const GAP_MAP: Readonly<Record<string, string>> = Object.freeze({
	gap: "gap",
	"gap-x": "column-gap",
	"gap-y": "row-gap",
});

const INSET_MAP: Readonly<Record<string, string[]>> = Object.freeze({
	inset: ["inset"],
	"inset-x": ["inset-inline"],
	"inset-y": ["inset-block"],
	top: ["inset-block-start"],
	bottom: ["inset-block-end"],
	left: ["inset-inline-start"],
	right: ["inset-inline-end"],
	start: ["inset-inline-start"],
	end: ["inset-inline-end"],
	"inset-s": ["inset-inline-start"],
	"inset-e": ["inset-inline-end"],
	"inset-bs": ["inset-block-start"],
	"inset-be": ["inset-block-end"],
});

const SCROLL_MARGIN_MAP: Readonly<Record<string, string[]>> = Object.freeze({
	"scroll-m": ["scroll-margin"],
	"scroll-mx": ["scroll-margin-inline"],
	"scroll-my": ["scroll-margin-block"],
	"scroll-mt": ["scroll-margin-block-start"],
	"scroll-mb": ["scroll-margin-block-end"],
	"scroll-ml": ["scroll-margin-inline-start"],
	"scroll-mr": ["scroll-margin-inline-end"],
	"scroll-ms": ["scroll-margin-inline-start"],
	"scroll-me": ["scroll-margin-inline-end"],
	"scroll-mbs": ["scroll-margin-block-start"],
	"scroll-mbe": ["scroll-margin-block-end"],
});

const SCROLL_PADDING_MAP: Readonly<Record<string, string[]>> = Object.freeze({
	"scroll-p": ["scroll-padding"],
	"scroll-px": ["scroll-padding-inline"],
	"scroll-py": ["scroll-padding-block"],
	"scroll-pt": ["scroll-padding-block-start"],
	"scroll-pb": ["scroll-padding-block-end"],
	"scroll-pl": ["scroll-padding-inline-start"],
	"scroll-pr": ["scroll-padding-inline-end"],
	"scroll-ps": ["scroll-padding-inline-start"],
	"scroll-pe": ["scroll-padding-inline-end"],
	"scroll-pbs": ["scroll-padding-block-start"],
	"scroll-pbe": ["scroll-padding-block-end"],
});

// ---------------------------------------------------------------------------
// Fluid Spacing — `X-fluid-{n}` reuses the base direction maps above, so the
// fluid family can never drift from the plain one.
// ---------------------------------------------------------------------------

/** Compute the fluid clamp() expression for a spacing step, or null. */
function fluidSpacingClamp(val: string, theme: ResolvedTheme): string | null {
	const n = Number(val.replaceAll("_", "."));
	if (Number.isNaN(n) || n <= 0) return null;

	const base = Number.parseFloat(theme.spacing.base);
	if (Number.isNaN(base) || base <= 0) return null;
	const multiplier = theme.spacingFluid?.multiplier ?? theme.fluid.multiplier ?? 2;
	if (multiplier <= 1) return null;
	const minRem = Math.round(n * base * 1000) / 1000;
	const maxRem = Math.round(n * multiplier * base * 1000) / 1000;
	const diff = Math.round((maxRem - minRem) * 1000) / 1000;

	const fluidMinRaw = parseRemValue(theme.spacingFluid?.min ?? theme.fluid.min);
	const fluidMaxRaw = parseRemValue(theme.spacingFluid?.max ?? theme.fluid.max);
	if (fluidMinRaw === null || fluidMaxRaw === null) return null;

	const range = fluidMaxRaw - fluidMinRaw;
	// Reject zero/negative range and degenerate near-zero ranges that would
	// produce wildly oversized clamp scale factors (e.g. range=0.001 → 1000x).
	// Build-time guard only: a runtime override of the bound vars can still make
	// the range degenerate, but the clamp() endpoints bound the output anyway.
	if (range < 1) return null;

	const unit = theme.spacingFluid?.unit ?? theme.fluid.unit ?? "vw";
	const { min: minExpr, range: rangeExpr } = fluidBoundExprs("spacing");
	return `clamp(${minRem}rem, ${fluidInterpolation(minRem, diff, unit, minExpr, rangeExpr)}, ${maxRem}rem)`;
}

/**
 * Fluid clamp() for a base value that is only known at CSS runtime — a CSS
 * variable (`p-fluid-(--x)`) or an arbitrary length (`p-fluid-[10px]`). The
 * numeric path bakes `min`/`max`/`diff` as `rem` literals; here the multiplier
 * is the only static input, so the endpoints become CSS arithmetic on `base`:
 * min = base, max = base·multiplier, diff = base·(multiplier − 1). The viewport
 * ramp and bound tokens are identical to the numeric path. A non-positive base
 * makes min > max, which clamp() resolves to min — degenerate but always bounded,
 * never invalid CSS, so it cannot be validated away at build time.
 */
function fluidSpacingClampExpr(base: string, theme: ResolvedTheme): string | null {
	const multiplier = theme.spacingFluid?.multiplier ?? theme.fluid.multiplier ?? 2;
	if (multiplier <= 1) return null;

	const unit = theme.spacingFluid?.unit ?? theme.fluid.unit ?? "vw";
	const { min: minExpr, range: rangeExpr } = fluidBoundExprs("spacing");
	const max = `calc(${base} * ${multiplier})`;
	const diff = `calc(${base} * ${multiplier - 1})`;
	const interp = `calc(${base} + ${diff} * ((100${unit} - ${minExpr}) / ${rangeExpr}))`;
	return `clamp(${base}, ${interp}, ${max})`;
}

function resolveFluidSpacing(
	basePrefix: string,
	val: string | null,
	negative: boolean,
	theme: ResolvedTheme,
): UtilityResult | null {
	if (val === null) return null;

	// A var/arbitrary base (p-fluid-(--x), p-fluid-[10px]) arrives as `[expr]` and
	// builds a runtime clamp(); numeric steps stay on the baked-rem fast path.
	const arb = extractArbitrary(val);
	const clampValue =
		arb !== null ? fluidSpacingClampExpr(arb, theme) : fluidSpacingClamp(val, theme);
	if (clampValue === null) return null;

	// Padding (negative padding is invalid CSS — reject)
	if (Object.hasOwn(PADDING_MAP, basePrefix)) {
		if (negative) return null;
		return multi(...PADDING_MAP[basePrefix].map((p) => [p, clampValue] as [string, string]));
	}

	const finalValue = negative ? `calc(${clampValue} * -1)` : clampValue;

	// Margin
	if (Object.hasOwn(MARGIN_MAP, basePrefix)) {
		return multi(...MARGIN_MAP[basePrefix].map((p) => [p, finalValue] as [string, string]));
	}

	// Gap (negative gap is invalid CSS — reject)
	if (Object.hasOwn(GAP_MAP, basePrefix)) {
		if (negative) return null;
		return single(GAP_MAP[basePrefix], clampValue);
	}

	// Inset
	if (Object.hasOwn(INSET_MAP, basePrefix)) {
		return multi(...INSET_MAP[basePrefix].map((p) => [p, finalValue] as [string, string]));
	}

	return null;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function spacingGenerator(
	utility: string,
	value: string | null,
	negative: boolean,
	theme: ResolvedTheme,
	warnings?: string[],
): UtilityResult | null {
	// Split utility-value: "p-4" → prefix="p", val="4"
	// But utility may already be split by parser, with value passed separately
	let prefix: string;
	let val: string | null;

	if (value !== null) {
		prefix = utility;
		val = value;
	} else {
		// Try to split on last hyphen
		const lastDash = utility.lastIndexOf("-");
		if (lastDash === -1) {
			prefix = utility;
			val = null;
		} else {
			prefix = utility.slice(0, lastDash);
			val = utility.slice(lastDash + 1);
		}
	}

	// Fluid spacing: p-fluid-{n}, m-fluid-{n}, gap-fluid-{n}, etc. — the base
	// prefix (before "-fluid") resolves against the same direction maps as the
	// plain forms.
	if (prefix.endsWith("-fluid")) {
		return resolveFluidSpacing(prefix.slice(0, -6), val, negative, theme);
	}

	// Space-between: space-x-{n}, space-y-{n}, space-{x,y}-reverse.
	// Reverse-aware: every child except the last gets margin on both sides,
	// weighted by --ri-space-{x,y}-reverse (0 normally, 1 when *-reverse is set).
	// auto is disallowed — `margin: auto` on every sibling is almost certainly a mistake.
	if (prefix === "space-x" || prefix === "space-y") {
		const axis = prefix === "space-x" ? "x" : "y";
		const reverseVar = `--ri-space-${axis}-reverse`;
		if (val === "reverse") {
			return {
				declarations: [{ property: reverseVar, value: "1" }],
				nestedSelector: "& > :not(:last-child)",
			};
		}
		const resolved = resolveSpacing(val, negative, warnings, false);
		if (resolved === null) return null;
		const startProp = axis === "x" ? "margin-inline-start" : "margin-block-start";
		const endProp = axis === "x" ? "margin-inline-end" : "margin-block-end";
		return {
			declarations: [
				{ property: reverseVar, value: "0" },
				{ property: startProp, value: `calc(${resolved} * var(${reverseVar}))` },
				{ property: endProp, value: `calc(${resolved} * calc(1 - var(${reverseVar})))` },
			],
			nestedSelector: "& > :not(:last-child)",
		};
	}

	// Padding (negative padding is invalid CSS — reject; auto is also invalid for padding)
	if (Object.hasOwn(PADDING_MAP, prefix)) {
		if (negative) return null;
		const paddingProps = PADDING_MAP[prefix];
		const resolved = resolveSpacing(val, negative, warnings, false);
		if (resolved === null) return null;
		return multi(...paddingProps.map((p) => [p, resolved] as [string, string]));
	}

	// Margin
	if (Object.hasOwn(MARGIN_MAP, prefix)) {
		const marginProps = MARGIN_MAP[prefix];
		const resolved = resolveSpacing(val, negative, warnings, true);
		if (resolved === null) return null;
		return multi(...marginProps.map((p) => [p, resolved] as [string, string]));
	}

	// Gap (negative gap is invalid CSS — reject; auto is also invalid for gap)
	if (Object.hasOwn(GAP_MAP, prefix)) {
		if (negative) return null;
		const resolved = resolveSpacing(val, negative, warnings, false);
		if (resolved === null) return null;
		return single(GAP_MAP[prefix], resolved);
	}

	// Inset (fraction-aware: inset-1/2 → calc(1/2 * 100%))
	if (Object.hasOwn(INSET_MAP, prefix)) {
		const insetProps = INSET_MAP[prefix];
		const resolved = resolveInsetValue(val, negative, warnings);
		if (resolved === null) return null;
		return multi(...insetProps.map((p) => [p, resolved] as [string, string]));
	}

	// Scroll margin
	if (Object.hasOwn(SCROLL_MARGIN_MAP, prefix)) {
		const resolved = resolveSpacing(val, negative, warnings, true);
		if (resolved === null) return null;
		return multi(...SCROLL_MARGIN_MAP[prefix].map((p) => [p, resolved] as [string, string]));
	}

	// Scroll padding (negative scroll-padding is invalid CSS — reject;
	// auto is NOT valid per CSS Scroll Snap spec — only <length-percentage> values are accepted)
	if (Object.hasOwn(SCROLL_PADDING_MAP, prefix)) {
		if (negative) return null;
		const resolved = resolveSpacing(val, negative, warnings, false);
		if (resolved === null) return null;
		return multi(...SCROLL_PADDING_MAP[prefix].map((p) => [p, resolved] as [string, string]));
	}

	return null;
}
