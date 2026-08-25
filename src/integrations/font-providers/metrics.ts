/**
 * Automatic CLS-fallback metrics — the fontaine/capsize approach.
 *
 * A metrics-adjusted local fallback @font-face eliminates layout shift when a
 * web font swaps in. The override percentages are pure arithmetic over the web
 * font's and the fallback font's metric tables, so users never enter them by
 * hand: any @font slot whose family appears in the built-in table (see
 * metrics-data.ts) gets a fallback face automatically; `metrics: none` opts
 * out and `metrics: "<family>" [numbers]` overrides the fallback choice or the
 * computed values.
 *
 * Pure data + arithmetic — safe for browser/editor bundles.
 */

import { FONT_METRICS_TABLE, type FontMetricsRow } from "./metrics-data.js";
import type { FontMetrics } from "./model.js";

/** Default local fallback per capsize font category. */
const CATEGORY_FALLBACK: Readonly<Record<string, string>> = {
	"sans-serif": "Arial",
	serif: "Times New Roman",
	monospace: "Courier New",
};

/** Look up a family's metrics row (case-insensitive). */
export function lookupFontMetrics(family: string): FontMetricsRow | undefined {
	return FONT_METRICS_TABLE[family.trim().toLowerCase()];
}

/** Round to 4 decimal places — enough precision for override percentages. */
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/**
 * Compute the metrics-adjusted overrides for rendering `fallbackName` in the
 * web font's place (the fontaine formula): size-adjust matches average glyph
 * width, and the vertical overrides are the web font's normalized metrics
 * divided by that adjustment.
 */
export function computeFallbackMetrics(
	fallbackName: string,
	font: FontMetricsRow,
	fallbackFont: FontMetricsRow,
): FontMetrics {
	const [ascent, descent, lineGap, unitsPerEm, xWidthAvg] = font;
	const [, , , fbUnitsPerEm, fbXWidthAvg] = fallbackFont;
	const sizeAdjust = xWidthAvg / unitsPerEm / (fbXWidthAvg / fbUnitsPerEm);
	return {
		fallback: fallbackName,
		sizeAdjust: round4(sizeAdjust * 100),
		ascent: round4((ascent / unitsPerEm / sizeAdjust) * 100),
		descent: round4((Math.abs(descent) / unitsPerEm / sizeAdjust) * 100),
		lineGap: round4((lineGap / unitsPerEm / sizeAdjust) * 100),
	};
}

/**
 * Resolve automatic metrics for a slot family.
 *
 * Fallback font choice: `explicitFallback` if given, else the first entry of
 * the slot's fallback stack that has metrics, else the category default for
 * the web font, else Arial. Returns null when the family (or an explicitly
 * requested fallback) has no metrics — callers decide whether that warrants a
 * warning.
 */
export function resolveAutoMetrics(
	family: string,
	fallbackStack: readonly string[],
	explicitFallback?: string,
): FontMetrics | null {
	const font = lookupFontMetrics(family);
	if (!font) return null;
	const fallbackName =
		explicitFallback ??
		fallbackStack.find((f) => lookupFontMetrics(f)) ??
		CATEGORY_FALLBACK[font[5]] ??
		"Arial";
	const fallbackFont = lookupFontMetrics(fallbackName);
	if (!fallbackFont) return null;
	return computeFallbackMetrics(fallbackName, font, fallbackFont);
}
