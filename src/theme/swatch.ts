/**
 * Color swatches and theme-token introspection for editor tooling.
 *
 * Resolves a theme color (and stop) to concrete light/dark colors — the same
 * OKLCH math the CSS variable emitter uses (generateStop / computeDarkStop),
 * plus an sRGB hex conversion for completion-item swatches and sidebar chips.
 * Pure computation, no IO.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import {
	computeDarkStop,
	formatOklch,
	generateStop,
	linearToSrgb,
	oklabToLinearSrgb,
	oklchToOklab,
	type ColorDefinition,
} from "./colors.js";

/** The canonical palette stops every generative color defines. */
export const CANONICAL_COLOR_STOPS: readonly number[] = Object.freeze([
	50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950,
]);

// ---------------------------------------------------------------------------
// OKLCH → sRGB hex
// ---------------------------------------------------------------------------

function channelHex(value: number): string {
	return Math.round(Math.min(1, Math.max(0, value)) * 255)
		.toString(16)
		.padStart(2, "0");
}

/** Convert an OKLCH color to a #rrggbb hex string (sRGB, channel-clamped). */
export function oklchToHex(l: number, c: number, h: number): string {
	const [labL, labA, labB] = oklchToOklab(l, c, h);
	const [r, g, b] = oklabToLinearSrgb(labL, labA, labB);
	return `#${channelHex(linearToSrgb(r))}${channelHex(linearToSrgb(g))}${channelHex(linearToSrgb(b))}`;
}

// ---------------------------------------------------------------------------
// CSS color text → hex (the shapes theme definitions actually contain)
// ---------------------------------------------------------------------------

const OKLCH_TEXT_RE = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.-]+)\s*(?:\/\s*[\d.]+%?\s*)?\)$/i;
const HEX_TEXT_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Best-effort hex for the CSS color texts theme definitions hold: `oklch()`
 *  and hex literals. Anything else (named colors, rgb(), vars) returns null —
 *  the raw CSS text still travels alongside. */
export function cssColorToHex(css: string): string | null {
	const text = css.trim();
	if (HEX_TEXT_RE.test(text)) {
		if (text.length === 4 || text.length === 5) {
			// #rgb[a] → #rrggbb (alpha dropped for swatches)
			return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
		}
		return text.slice(0, 7).toLowerCase();
	}
	const match = OKLCH_TEXT_RE.exec(text);
	if (match) {
		const rawL = match[1];
		const l = rawL.endsWith("%") ? Number.parseFloat(rawL) / 100 : Number.parseFloat(rawL);
		const c = Number.parseFloat(match[2]);
		const h = Number.parseFloat(match[3]);
		if (Number.isFinite(l) && Number.isFinite(c) && Number.isFinite(h)) {
			return oklchToHex(l, c, h);
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Swatch resolution
// ---------------------------------------------------------------------------

export interface SwatchColor {
	/** CSS color text (`oklch(…)`, or the definition's own value verbatim). */
	css: string;
	/** sRGB hex, or null when the CSS text isn't convertible. */
	hex: string | null;
}

export interface ColorSwatch {
	light: SwatchColor;
	/** Null when the theme's dark mode is off or the color has no dark form. */
	dark: SwatchColor | null;
}

const MAX_ALIAS_HOPS = 8;

/** Fixed semantic colors (paper/ink flip between modes). */
const SEMANTIC_SWATCHES: Readonly<Record<string, ColorSwatch>> = Object.freeze({
	paper: {
		light: { css: "oklch(1 0 0)", hex: "#ffffff" },
		dark: { css: "oklch(0 0 0)", hex: "#000000" },
	},
	ink: {
		light: { css: "oklch(0 0 0)", hex: "#000000" },
		dark: { css: "oklch(1 0 0)", hex: "#ffffff" },
	},
	white: {
		light: { css: "oklch(1 0 0)", hex: "#ffffff" },
		dark: null,
	},
	black: {
		light: { css: "oklch(0 0 0)", hex: "#000000" },
		dark: null,
	},
});

function swatchFromCss(css: string): SwatchColor {
	return { css, hex: cssColorToHex(css) };
}

/**
 * Resolve a theme color name (+ stop, for generative palettes) to concrete
 * light/dark swatch colors — exactly the values the emitted CSS variables
 * carry. Theme-defined colors always win; the fixed semantic swatches
 * (paper/ink/white/black) apply only when the theme does not define the name,
 * mirroring the emitter (a user `@color { white: … }` palette emits
 * `--color-white-*` variables that suffixed utilities resolve against).
 * Returns null for unknown names, unresolvable aliases, and keyword colors
 * with no concrete value (transparent, currentColor).
 */
export function resolveColorSwatch(
	theme: ResolvedTheme,
	name: string,
	stop = 500,
): ColorSwatch | null {
	let def: ColorDefinition | undefined = theme.colors[name];
	for (let hop = 0; def && def.type === "alias" && hop < MAX_ALIAS_HOPS; hop++) {
		def = theme.colors[def.source];
	}
	if (!def || def.type === "alias") {
		return SEMANTIC_SWATCHES[name] ?? null;
	}

	switch (def.type) {
		case "generative": {
			const light = generateStop(def, stop);
			const lightSwatch: SwatchColor = {
				css: formatOklch(light.l, light.c, light.h),
				hex: oklchToHex(light.l, light.c, light.h),
			};
			if (theme.darkConfig.mode === "off" || def.dark?.strategy === "fixed") {
				return { light: lightSwatch, dark: null };
			}
			const dark = computeDarkStop(def, stop, theme.darkConfig, def.dark);
			return {
				light: lightSwatch,
				dark: {
					css: formatOklch(dark.l, dark.c, dark.h),
					hex: oklchToHex(dark.l, dark.c, dark.h),
				},
			};
		}
		case "explicit":
			return { light: swatchFromCss(def.value), dark: null };
		case "pair":
			// The emitter drops the pair's dark side entirely when dark mode is
			// off — the swatch must agree.
			return {
				light: swatchFromCss(def.light),
				dark: theme.darkConfig.mode === "off" ? null : swatchFromCss(def.dark),
			};
		case "keyword":
			return null;
	}
}

// ---------------------------------------------------------------------------
// Theme token introspection
// ---------------------------------------------------------------------------

export interface ThemeTokens {
	/** Color names with their definition kind — pair with resolveColorSwatch. */
	colors: Array<{ name: string; kind: ColorDefinition["type"] }>;
	colorStops: readonly number[];
	spacingBase: string;
	textSizes: Array<{ name: string; fontSize: string; lineHeight: string }>;
	breakpoints: Record<string, string>;
	shadows: Record<string, string>;
	weights: Record<string, number>;
	easing: Record<string, string>;
	blur: Record<string, string>;
	z: Record<string, string>;
	leading: Record<string, string>;
	tracking: Record<string, string>;
	opacity: Record<string, string>;
	duration: Record<string, string>;
	/** Named radii from `@rounded { roof: 24px; }` — the class is `rounded-roof`.
	 *  Unnamed radii are spacing multiples and carry no token. */
	radii: Record<string, string>;
	/** Named ranges from `@fluid <name> { min; max; }` — each one makes the scope
	 *  class `fluid-<name>`. A bound absent from the block is absent here. */
	fluidRanges: Record<string, { min?: string; max?: string }>;
	fonts: Array<{ slot: string; family: string }>;
	animations: string[];
}

/** One render-ready view of a theme's token namespaces for sidebar chips and
 *  completion detail — plain data, no theme internals to traverse. */
export function listThemeTokens(theme: ResolvedTheme): ThemeTokens {
	return {
		colors: Object.entries(theme.colors).map(([name, def]) => ({ name, kind: def.type })),
		colorStops: CANONICAL_COLOR_STOPS,
		spacingBase: theme.spacing.base,
		textSizes: Object.entries(theme.text).map(([name, def]) => ({
			name,
			fontSize: def.fontSize,
			lineHeight: def.lineHeight,
		})),
		breakpoints: { ...theme.breakpoints },
		shadows: { ...theme.shadows },
		weights: { ...theme.weights },
		easing: { ...theme.easing },
		blur: { ...theme.blur },
		z: { ...theme.z },
		leading: { ...theme.leading },
		tracking: { ...theme.tracking },
		opacity: { ...theme.opacity },
		duration: { ...theme.duration },
		radii: { ...theme.radii },
		fluidRanges: Object.fromEntries(
			Object.entries(theme.fluidRanges).map(([name, range]) => [
				name,
				{ min: range.min, max: range.max },
			]),
		),
		fonts: theme.fonts.map((slot) => ({ slot: slot.slot, family: slot.family })),
		animations: Object.keys(theme.animations),
	};
}
