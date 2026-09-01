/**
 * Test fixture typography scales — the text, leading, and tracking values that
 * used to ship as `DEFAULT_TEXT`, `DEFAULT_LEADING`, and `DEFAULT_TRACKING`
 * before the package stopped shipping a type scale.
 *
 * They live here (not in `src/`) because the typography machinery — fluid
 * clamp interpolation, the `/line-height` modifier, dual-mode text
 * classification in the merger, token pruning — still needs a realistic,
 * multi-step scale to exercise. Definitions are byte-for-byte the former
 * defaults, so any test that swaps a shipped lookup for a fixture one keeps
 * every numeric assertion valid.
 */

import type { ResolvedTheme } from "../../src/directives/foundation.js";
import { resolveDirectives } from "../../src/directives/index.js";
import type { TextSize } from "../../src/theme/index.js";

export const FIXTURE_TEXT: Record<string, TextSize> = {
	"2xs": { fontSize: "0.625rem", lineHeight: "1.2" },
	xs: { fontSize: "0.75rem", lineHeight: "1.3" },
	sm: { fontSize: "0.875rem", lineHeight: "1.4" },
	md: { fontSize: "1rem", lineHeight: "1.5" },
	lg: { fontSize: "1.25rem", lineHeight: "1.4" },
	xl: { fontSize: "1.5rem", lineHeight: "1.3" },
	"2xl": { fontSize: "1.875rem", lineHeight: "1.2" },
	"3xl": { fontSize: "2.25rem", lineHeight: "1.15" },
	"4xl": { fontSize: "2.813rem", lineHeight: "1.1" },
	"5xl": { fontSize: "3.5rem", lineHeight: "1.05" },
	"6xl": { fontSize: "4.375rem", lineHeight: "1.05" },
	"7xl": { fontSize: "5.5rem", lineHeight: "1" },
	"8xl": { fontSize: "6.875rem", lineHeight: "1" },
	"9xl": { fontSize: "8.5rem", lineHeight: "1" },
};

export const FIXTURE_LEADING: Record<string, string> = {
	"3": "0.75rem",
	"4": "1rem",
	"5": "1.25rem",
	"6": "1.5rem",
	"7": "1.75rem",
	"8": "2rem",
	"9": "2.25rem",
	"10": "2.5rem",
	none: "1",
	tight: "1.25",
	snug: "1.375",
	normal: "1.5",
	relaxed: "1.625",
	loose: "2",
};

export const FIXTURE_TRACKING: Record<string, string> = {
	tighter: "-0.05em",
	tight: "-0.025em",
	normal: "0em",
	wide: "0.025em",
	wider: "0.05em",
	widest: "0.1em",
};

/**
 * A resolved theme carrying the fixture typography scales. Drop-in replacement
 * for `resolveDirectives([])` in tests that reference the former default type
 * scale (e.g. `text-lg`, `leading-tight`, `tracking-wide`). Pass `base` to
 * layer the scales onto an already-resolved theme. A scale the base defines
 * wins, so a test's own `@text` override is never masked.
 */
export function typographyTheme(base: ResolvedTheme = resolveDirectives([])): ResolvedTheme {
	return {
		...base,
		text: { ...FIXTURE_TEXT, ...base.text },
		leading: { ...FIXTURE_LEADING, ...base.leading },
		tracking: { ...FIXTURE_TRACKING, ...base.tracking },
	};
}
