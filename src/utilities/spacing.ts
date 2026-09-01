/**
 * Spacing utilities — padding, margin, gap, space-between, inset.
 * All directional utilities use CSS logical properties by default.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import { topLevelIndexOf } from "../directives/foundation.js";
// Direction maps (logical by default) — shared with the merge's claim tables
// (merge/props.ts) so the properties this generator emits and the properties
// ri() claims for conflict resolution can never drift apart.
import {
	PADDING_MAP,
	MARGIN_MAP,
	GAP_MAP,
	INSET_MAP,
	SCROLL_MARGIN_MAP,
	SCROLL_PADDING_MAP,
} from "../merge/props.js";
import { fluidBoundExprs, fluidInterpolation, fluidRange } from "../css/fluid.js";
import { devWarn } from "../runtime.js";
import { type UtilityResult, single, multi, spacingLookup, extractArbitrary } from "./helpers.js";

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

	const bounds = fluidRange(theme, "spacing");
	if (bounds === null) return null;

	const range = bounds.max - bounds.min;
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
	if (fluidRange(theme, "spacing") === null) return null;
	const multiplier = theme.spacingFluid?.multiplier ?? theme.fluid.multiplier ?? 2;
	if (multiplier <= 1) return null;

	const unit = theme.spacingFluid?.unit ?? theme.fluid.unit ?? "vw";
	const { min: minExpr, range: rangeExpr } = fluidBoundExprs("spacing");
	const max = `calc(${base} * ${multiplier})`;
	const diff = `calc(${base} * ${multiplier - 1})`;
	const interp = `calc(${base} + ${diff} * ((100${unit} - ${minExpr}) / ${rangeExpr}))`;
	return `clamp(${base}, ${interp}, ${max})`;
}

/** Resolve one pair endpoint: a spacing step to a rem count, or an arbitrary
 *  `[…]` / `(--var)` value to a CSS expression. Zero is a legal endpoint. */
function fluidEndpoint(raw: string, base: number): { rem: number } | { expr: string } | null {
	const arb = extractArbitrary(raw);
	if (arb !== null) return { expr: arb };
	if (raw.startsWith("(") && raw.endsWith(")")) {
		const inner = raw.slice(1, -1);
		return /^--[a-zA-Z_][\w-]*$/.test(inner) ? { expr: `var(${inner})` } : null;
	}
	if (raw.length === 0) return null;
	const n = Number(raw.replaceAll("_", "."));
	if (Number.isNaN(n) || n < 0) return null;
	return { rem: Math.round(n * base * 1000) / 1000 };
}

/**
 * Fluid clamp() between two explicit endpoints — `p-fluid-4/8`. Two steps bake
 * to rem literals; an arbitrary/var endpoint switches the whole expression to
 * CSS arithmetic. Descending pairs are legal (the value shrinks as the
 * viewport grows): the clamp() bounds are ordered while the ramp keeps its
 * signed slope, so the output stays bounded either way.
 */
function fluidPairClamp(rawA: string, rawB: string, theme: ResolvedTheme): string | null {
	const base = Number.parseFloat(theme.spacing.base);
	if (Number.isNaN(base) || base <= 0) return null;
	const a = fluidEndpoint(rawA, base);
	const b = fluidEndpoint(rawB, base);
	if (a === null || b === null) return null;
	const bounds = fluidRange(theme, "spacing");
	if (bounds === null) return null;

	const unit = theme.spacingFluid?.unit ?? theme.fluid.unit ?? "vw";
	const { min: minExpr, range: rangeExpr } = fluidBoundExprs("spacing");

	if ("rem" in a && "rem" in b) {
		// Same degenerate-range guard as the multiplier path above.
		if (bounds.max - bounds.min < 1) return null;
		const diff = Math.round((b.rem - a.rem) * 1000) / 1000;
		const lower = Math.min(a.rem, b.rem);
		const upper = Math.max(a.rem, b.rem);
		return `clamp(${lower}rem, ${fluidInterpolation(a.rem, diff, unit, minExpr, rangeExpr)}, ${upper}rem)`;
	}

	const exprA = "rem" in a ? `${a.rem}rem` : a.expr;
	const exprB = "rem" in b ? `${b.rem}rem` : b.expr;
	const interp = `calc(${exprA} + (${exprB} - ${exprA}) * ((100${unit} - ${minExpr}) / ${rangeExpr}))`;
	return `clamp(min(${exprA}, ${exprB}), ${interp}, max(${exprA}, ${exprB}))`;
}

/** `fluid-<name>` — point every fluid ramp on the element (and, through
 *  custom-property inheritance, its descendants) at a named @fluid range. */
function resolveFluidScope(
	name: string,
	negative: boolean,
	theme: ResolvedTheme,
	warnings?: string[],
): UtilityResult | null {
	if (negative || name.length === 0) return null;
	if (!Object.hasOwn(theme.fluidRanges, name)) {
		const message = `[RI-1503] fluid-${name}: no @fluid range named "${name}" — define one with @fluid ${name} { min: …; max: …; }.`;
		if (warnings) warnings.push(message);
		else devWarn(message);
		return null;
	}
	return multi(
		["--fluid-scope-min", `var(--fluid-${name}-min)`],
		["--fluid-scope-max", `var(--fluid-${name}-max)`],
	);
}

function resolveFluidSpacing(
	basePrefix: string,
	val: string | null,
	negative: boolean,
	theme: ResolvedTheme,
): UtilityResult | null {
	if (val === null) return null;

	// `a/b` picks both endpoints; a bare value keeps the multiplier ramp. A
	// var/arbitrary base (p-fluid-(--x), p-fluid-[10px]) builds a runtime
	// clamp(); numeric steps stay on the baked-rem fast path.
	const slash = topLevelIndexOf(val, "/");
	let clampValue: string | null;
	if (slash !== -1) {
		clampValue = fluidPairClamp(val.slice(0, slash), val.slice(slash + 1), theme);
	} else {
		const arb = extractArbitrary(val);
		clampValue = arb !== null ? fluidSpacingClampExpr(arb, theme) : fluidSpacingClamp(val, theme);
	}
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

	// Gap (negative gap is invalid CSS — reject). The shared map is
	// array-valued; gap families are always single-property.
	if (Object.hasOwn(GAP_MAP, basePrefix)) {
		if (negative) return null;
		return single(GAP_MAP[basePrefix][0], clampValue);
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
	// This generator mostly wants the split (prefix, value) form; `full` is
	// read only for the fluid scope classes, whose names may carry dashes.
	full: string,
	negative: boolean,
	theme: ResolvedTheme,
	warnings?: string[],
): UtilityResult | null {
	// fluid-<name>: scope class from a named @fluid range.
	if (full.startsWith("fluid-")) {
		return resolveFluidScope(full.slice(6), negative, theme, warnings);
	}
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
		return single(GAP_MAP[prefix][0], resolved);
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
