/**
 * Test fixture palette — the semantic + tonal generative colors that used to
 * ship in `DEFAULT_COLORS` before the package was trimmed to the achromatic
 * `theme` base alone.
 *
 * They live here (not in `src/`) because the color engine — OKLCH ramp
 * generation, gamut clamping, contrast matching, hue shift, CVD checks — still
 * needs realistic, multi-hue input to exercise. Keeping the old definitions as
 * a fixture lets those tests assert against stable, known chroma/hue values
 * without re-coupling the shipped defaults to a fixed semantic palette.
 *
 * Definitions are byte-for-byte the former defaults, so any test that swaps a
 * `DEFAULT_COLORS["error"]`-style lookup for `FIXTURE_COLORS["error"]` keeps
 * every numeric assertion valid.
 */
import { resolveDirectives } from "../../src/directives/index.js";
import type { ResolvedTheme } from "../../src/directives/foundation.js";
import type { ColorDefinition } from "../../src/theme/index.js";

export const FIXTURE_COLORS: Record<string, ColorDefinition> = {
	error: { type: "generative", chroma: 0.35, hue: 32 },
	warning: { type: "generative", chroma: 0.37, hue: 62 },
	alert: { type: "generative", chroma: 0.35, hue: 103 },
	success: { type: "generative", chroma: 0.35, hue: 154 },
	expired: { type: "generative", chroma: 0.06, hue: 161 },
	info: { type: "generative", chroma: 0.24, hue: 222 },
	general: { type: "generative", chroma: 0.38, hue: 296 },
	theme: {
		type: "generative",
		chroma: 0,
		hue: 0,
		parabolic: false,
		chromaBoost: false,
	},
	lichen: {
		type: "generative",
		chroma: 0.02,
		hue: 109,
		parabolic: false,
		chromaBoost: false,
	},
	clay: {
		type: "generative",
		chroma: 0.03,
		hue: 73,
		parabolic: false,
		chromaBoost: false,
	},
	lake: {
		type: "generative",
		chroma: 0.02,
		hue: 194,
		parabolic: false,
		chromaBoost: false,
	},
	storm: {
		type: "generative",
		chroma: 0.03,
		hue: 254,
		parabolic: false,
		chromaBoost: false,
	},
	lavender: {
		type: "generative",
		chroma: 0.02,
		hue: 294,
		parabolic: false,
		chromaBoost: false,
	},
};

/**
 * A resolved theme carrying every shipped default plus {@link FIXTURE_COLORS}.
 * Drop-in replacement for `resolveDirectives([])` in tests that reference the
 * former default palette (e.g. `bg-error-500`, `text-info-200`). The fixture
 * colors are layered under the resolved defaults so a shipped `theme` (or any
 * future default) always wins on name collision.
 */
export function fixtureTheme(): ResolvedTheme {
	const theme = resolveDirectives([]);
	return { ...theme, colors: { ...FIXTURE_COLORS, ...theme.colors } };
}
