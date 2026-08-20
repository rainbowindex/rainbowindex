/**
 * Fluid-scale subsystem — the clamp()-ramp grammar shared by the directive
 * resolver (fluid-bound validation) and the typography/spacing utilities
 * (fluid-bound consumption) so the two sides agree on the grammar.
 */

/**
 * Lower-bound and range CSS expressions for a fluid family, mirroring the
 * resolver's `theme.{family}Fluid?.min ?? theme.fluid.min` fallback into the
 * cascade via var() fallbacks. Fluid utilities reference the published :root
 * tokens rather than baking the resolved bounds — matching how the rest of the
 * engine treats tokens (plain spacing emits `calc(n * var(--spacing))`, fluid
 * type clamps between `var(--text-*)`) and letting a runtime override of either
 * the family-specific or the global bound retarget the ramp. The clamp()
 * endpoints stay baked, so a degenerate runtime range still can't escape them.
 */
export function fluidBoundExprs(family: "text" | "spacing"): {
	min: string;
	range: string;
} {
	const min = `var(--fluid-${family}-min, var(--fluid-min))`;
	const max = `var(--fluid-${family}-max, var(--fluid-max))`;
	return { min, range: `calc(${max} - ${min})` };
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
