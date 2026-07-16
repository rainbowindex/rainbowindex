/**
 * Alpha → color-mix() helpers shared by the utility alpha-modifier path
 * (utilities/color.ts) and the --alpha() CSS function (css/functions.ts), so
 * the two surfaces normalize opacity and emit color-mix() identically.
 */

/**
 * Normalize a parsed numeric opacity to a percentage clamped to [0, 100].
 * Bare values ≤ 1 are fractions (0.5 → 50); values > 1 are already percent.
 * Rounded to 4 decimals — the fraction→percent multiply otherwise leaks float
 * artifacts (0.55 * 100 → 55.00000000000001) into the emitted color-mix().
 */
export function clampAlphaPercent(num: number, isPercent: boolean): number {
	const percent = isPercent ? num : num > 1 ? num : num * 100;
	return Math.min(100, Math.max(0, Math.round(percent * 10000) / 10000));
}

/**
 * Emit the canonical alpha color-mix(). Numeric alphas are percentages
 * (100 → the color itself, no mix); strings pass through verbatim for the
 * browser to resolve (var()/calc()).
 */
export function mixColorAlpha(color: string, alpha: number | string): string {
	if (typeof alpha === "number") {
		if (alpha >= 100) return color;
		return `color-mix(in oklab, ${color} ${alpha}%, transparent)`;
	}
	return `color-mix(in oklab, ${color} ${alpha}, transparent)`;
}
