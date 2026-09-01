/**
 * Fluid-scale subsystem — the clamp()-ramp grammar shared by the directive
 * resolver (fluid-bound validation) and the typography/spacing utilities
 * (fluid-bound consumption) so the two sides agree on the grammar.
 */

import type { ResolvedTheme } from "../directives/foundation.js";

/**
 * Lower-bound and range CSS expressions for a fluid family, mirroring the
 * resolver's `theme.{family}Fluid?.min ?? theme.fluid.min` fallback into the
 * cascade via var() fallbacks. Fluid utilities reference the published :root
 * tokens rather than baking the resolved bounds — matching how the rest of the
 * engine treats tokens (plain spacing emits `calc(n * var(--spacing))`, fluid
 * type clamps between `var(--text-*)`) and letting a runtime override of either
 * the family-specific or the global bound retarget the ramp. The clamp()
 * endpoints stay baked, so a degenerate runtime range still can't escape them.
 *
 * `--fluid-scope-{min,max}` sits at the top of the chain: the `fluid-<name>`
 * scope classes set it, custom properties inherit, so a range set on an
 * ancestor retargets every fluid ramp underneath — winning over the family
 * override, since scope is the more local intent.
 */
export function fluidBoundExprs(family: "text" | "spacing"): {
	min: string;
	range: string;
} {
	const min = `var(--fluid-scope-min, var(--fluid-${family}-min, var(--fluid-min)))`;
	const max = `var(--fluid-scope-max, var(--fluid-${family}-max, var(--fluid-max)))`;
	return { min, range: `calc(${max} - ${min})` };
}

/**
 * The numeric viewport range a fluid family ramps across: the family override
 * when it states a bound, the global `@fluid` range otherwise. `null` when
 * either end is missing or is not a rem length — the package ships no range,
 * so until `@fluid { min; max; }` exists there are no `--fluid-*` tokens to
 * reference and a fluid utility must not resolve at all.
 */
export function fluidRange(
	theme: ResolvedTheme,
	family: "text" | "spacing",
): { min: number; max: number } | null {
	const override = family === "text" ? theme.textFluid : theme.spacingFluid;
	const minRaw = override?.min ?? theme.fluid.min;
	const maxRaw = override?.max ?? theme.fluid.max;
	if (minRaw === undefined || maxRaw === undefined) return null;
	const min = parseRemValue(minRaw);
	const max = parseRemValue(maxRaw);
	return min === null || max === null ? null : { min, max };
}

/**
 * The fluid interpolation term shared by fluid spacing (utilities/spacing.ts)
 * and fluid typography (utilities/typography.ts): a linear ramp starting at
 * `minRem` and rising `diffRem` as the viewport grows across the fluid range.
 * `fluidMinExpr`/`rangeExpr` are CSS expressions from fluidBoundExprs so the
 * bounds reference :root tokens. Callers clamp() the result between their own
 * endpoints, which bounds the output even when the runtime range is degenerate.
 */
export function fluidInterpolation(
	minRem: number,
	diffRem: number,
	unit: string,
	fluidMinExpr: string,
	rangeExpr: string,
): string {
	return `calc(${minRem}rem + ${diffRem}rem * ((100${unit} - ${fluidMinExpr}) / ${rangeExpr}))`;
}

/** Parse a plain `<number>rem` literal to its numeric part, or null. */
export function parseRemValue(value: string): number | null {
	const match = /^(-?\d+(?:\.\d+)?)rem$/.exec(value.trim());
	return match ? Number(match[1]) : null;
}
