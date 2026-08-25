/**
 * @color body grammar — entry scanning, value classification (generative pair
 * / explicit / alias / keyword), per-color options blocks, and the light/dark
 * pair + alpha-modifier value model. Split from parsers.ts so each directive
 * family with a non-trivial grammar owns one file; parsers.ts re-exports
 * parseColorBody, keeping the import surface unchanged.
 */

import type { ColorDefinition, ColorDarkOverride } from "../theme/index.js";
import { isValidColorSuffix } from "../theme/colors.js";
import { clampAlphaPercent, mixColorAlpha } from "../css/alpha.js";
import { IDENT_KEY_RE, scanEntries, topLevelIndexOf } from "./foundation.js";
import { stripCSSComments } from "../shared.js";

/** Maximum number of entries allowed in @color body to bound memory allocation. */
const MAX_COLOR_ENTRIES = 500;

/**
 * Expand color stop shorthands like `theme-700` → `var(--color-theme-700)`.
 * Only matches bare identifiers whose trailing numeric segment is a valid stop.
 * Values that already contain `(` (function calls) or start with `#` are returned as-is.
 */
function expandColorStopRef(v: string): string {
	if (v.includes("(") || v.startsWith("#")) return v;
	const m = v.match(/^([\w][\w-]*)-(\d+)$/);
	if (m && isValidColorSuffix(Number(m[2]))) {
		return `var(--color-${m[1]}-${m[2]})`;
	}
	return v;
}

/**
 * Split a trailing alpha modifier off one side of a color value:
 * `theme-282/52` → base `theme-282`, alpha `52`. The slash must sit at depth 0
 * (so `oklch(0 0 0 / 0.5)` keeps its native alpha) and the part after it must be
 * a bare number, optionally percent-suffixed — that is what distinguishes an
 * alpha slash from the spaced ` / ` that separates a light/dark pair.
 */
function splitColorAlpha(side: string): { base: string; alpha: string | null } {
	let depth = 0;
	for (let i = side.length - 1; i >= 0; i--) {
		const ch = side[i];
		if (ch === ")" || ch === "]") depth++;
		else if (ch === "(" || ch === "[") depth--;
		else if (ch === "/" && depth === 0) {
			const base = side.slice(0, i).trim();
			const alpha = side.slice(i + 1).trim();
			if (base && /^\d*\.?\d+%?$/.test(alpha)) return { base, alpha };
			break;
		}
	}
	return { base: side, alpha: null };
}

/**
 * Resolve one side of a color value: expand a stop shorthand to a `var()` and
 * apply an optional `/alpha` modifier as a color-mix() — the same opacity model
 * the utility layer uses ({@link mixColorAlpha}). Non-stop bases (functions, hex)
 * pass through, gaining only the alpha mix when one is present.
 */
function expandColorSide(side: string): string {
	const { base, alpha } = splitColorAlpha(side);
	const expanded = expandColorStopRef(base);
	if (alpha === null) return expanded;
	const isPercent = alpha.endsWith("%");
	const num = Number.parseFloat(isPercent ? alpha.slice(0, -1) : alpha);
	if (Number.isNaN(num)) return expanded;
	return mixColorAlpha(expanded, clampAlphaPercent(num, isPercent));
}

/**
 * Parse @color body.
 *
 * Supports:
 * - `brand: 0.18 330;`                                → generative (chroma + hue)
 * - `accent: oklch(0.72 0.21 330);`                   → explicit single value
 * - `surface: oklch(0.98 0.01 260) / oklch(0.15 ...);` → light/dark pair
 * - `!slate;`                                          → removal
 * - `brand: 0.18 330 { dark: fixed; }`                → per-color dark override
 * - `brand: 0.18 330 { dark: shift chroma +0.02 hue +10; }` → shift override
 */
export function parseColorBody(
	body: string,
	warnings?: string[],
): {
	colors: Record<string, ColorDefinition>;
	removals: string[];
} {
	const cleanedBody = stripCSSComments(body);
	const colors: Record<string, ColorDefinition> = {};
	const removals: string[] = [];
	// Unique-key counter instead of Object.keys().length per entry — the cap
	// exists for adversarial inputs, so the check itself must stay O(1).
	let colorCount = 0;

	// @color entries end at depth-0 newlines (a trailing comma continues) —
	// the same boundary rule parseKeyValueBody uses for key-value directives.
	for (const entry of scanEntries(cleanedBody, { newlineTerminates: true })) {
		if (entry.removal) {
			removals.push(entry.key);
			continue;
		}
		if (entry.fragment) {
			warnings?.push(
				`[RI-1035] Invalid @color key "${entry.value}" — color names may only contain letters, numbers, hyphens, and underscores. The entry was skipped.`,
			);
			continue;
		}
		const { key, value } = entry;
		if (!key || !value) continue;

		// Guard against pathological input with excessive color entries.
		if (colorCount >= MAX_COLOR_ENTRIES) {
			warnings?.push(
				`[RI-1101] @color directive exceeds ${MAX_COLOR_ENTRIES} entries — remaining entries skipped.`,
			);
			break;
		}

		if (!IDENT_KEY_RE.test(key)) {
			warnings?.push(
				`[RI-1035] Invalid @color key "${key}" — color names may only contain letters, numbers, hyphens, and underscores. The entry was skipped.`,
			);
			continue;
		}

		const darkBlock = entry.block ?? null;

		// Parse the options block if present. It is a `;`-separated list of bare
		// flags (`inline`, `parabolic`/`no-parabolic`), their Vite-rewritten
		// `--ri-*: bool` equivalents (the Vite plugin converts bare keywords PostCSS
		// can't parse), and at most one `dark: …` override. Parsing
		// statement-by-statement keeps a bare flag from being confused with the
		// `shift` strategy inside a `dark: shift …` value.
		let darkOverride: ColorDarkOverride | undefined;
		let hasInline = false;
		let hasParabolic: boolean | undefined;
		if (darkBlock) {
			for (const statement of darkBlock.split(";")) {
				const stmt = statement.trim();
				if (!stmt) continue;
				const colonIdx = stmt.indexOf(":");
				if (colonIdx === -1) {
					// Bare flag(s) — a single statement may hold several, space-separated.
					for (const flag of stmt.split(/\s+/)) {
						if (flag === "inline") hasInline = true;
						else if (flag === "parabolic") hasParabolic = true;
						else if (flag === "no-parabolic") hasParabolic = false;
					}
					continue;
				}
				const optKey = stmt.slice(0, colonIdx).trim();
				const optVal = stmt.slice(colonIdx + 1).trim();
				if (optKey === "dark") {
					darkOverride = parseDarkOverrideValue(optVal);
				} else if (optKey === "--ri-inline") {
					if (optVal === "true") hasInline = true;
				} else if (optKey === "--ri-parabolic") {
					if (optVal === "true") hasParabolic = true;
					else if (optVal === "false") hasParabolic = false;
				}
			}
		}

		const def = parseColorValue(key, value, warnings);
		if (!def) continue;

		if (def.type === "generative") {
			if (darkOverride) def.dark = darkOverride;
			if (hasInline) def.inline = true;
			if (hasParabolic !== undefined) def.parabolic = hasParabolic;
		} else if (darkBlock) {
			warnings?.push(
				`[RI-1108] @color "${key}" has an options block but its value is not generative — dark/inline/parabolic options only apply to "chroma hue" colors and were ignored.`,
			);
		}

		if (!Object.hasOwn(colors, key)) colorCount++;
		colors[key] = def;
	}

	return { colors, removals };
}

/**
 * Parse one @color entry value into a ColorDefinition. Generative extras
 * (dark override, inline, parabolic, shift) are applied by the caller since
 * they only exist on generative values. Returns null (warning RI-1101/RI-1102
 * pushed when a channel is provided) for unparseable values.
 */
function parseColorValue(key: string, value: string, warnings?: string[]): ColorDefinition | null {
	// Light/dark pair: `oklch(...) / oklch(...)`, `theme-200 / theme-800`, or with
	// per-side alpha `theme-282/52 / theme-344/52`.
	const slashIdx = findPairSeparator(value);
	if (slashIdx !== -1) {
		const light = expandColorSide(value.slice(0, slashIdx).trim());
		const dark = expandColorSide(value.slice(slashIdx + 1).trim());
		return { type: "pair", light, dark };
	}

	// light-dark() alias: light-dark(lightVal, darkVal) → pair
	if (/^light-dark\s*\(/.test(value)) {
		const inner = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")")).trim();
		const commaIdx = topLevelIndexOf(inner, ",");
		if (commaIdx !== -1) {
			const light = expandColorSide(inner.slice(0, commaIdx).trim());
			const dark = expandColorSide(inner.slice(commaIdx + 1).trim());
			return { type: "pair", light, dark };
		}
	}

	// CSS keyword colors: transparent, currentColor, inherit
	// Stored as "keyword" so the utility resolver can inline them directly
	// without emitting a CSS variable (avoids var() indirection at runtime).
	if (value === "transparent" || value === "currentColor" || value === "inherit") {
		return { type: "keyword", value };
	}

	// Hex color: #rgb, #rrggbb, #rrggbbaa
	if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
		return { type: "explicit", value };
	}

	// Explicit single value: oklch(...), var(), or any CSS color function
	if (/^(oklch|oklab|rgb|hsl|hwb|lch|lab|color|color-mix|var)\s*\(/.test(value)) {
		return { type: "explicit", value };
	}

	// Generative: chroma hue
	const parts = value.split(/\s+/);
	if (parts.length === 2) {
		const chroma = Number.parseFloat(parts[0]);
		const hue = Number.parseFloat(parts[1]);
		if (!Number.isNaN(chroma) && !Number.isNaN(hue)) {
			// Validate ranges
			if (chroma < 0 || chroma > 0.4) {
				warnings?.push(
					`[RI-1102] @color "${key}" chroma ${chroma} is outside the typical range [0, 0.4] — clamping to valid range.`,
				);
			}
			const clampedChroma = Math.max(0, Math.min(0.4, chroma));
			const normalizedHue = ((hue % 360) + 360) % 360;
			return { type: "generative", chroma: clampedChroma, hue: normalizedHue };
		}
		warnings?.push(
			`[RI-1101] Invalid @color value "${key}: ${value}" — expected "chroma hue" (e.g., "0.15 30") or a CSS color function.`,
		);
		return null;
	}
	if (parts.length === 1) {
		// Color-stop reference, optionally with /alpha: `theme-700`, `theme-282/52`.
		// expandColorSide returns the input unchanged when it is not a stop ref, so
		// a bare color name still falls through to the alias case below.
		const expanded = expandColorSide(value);
		if (expanded !== value) return { type: "explicit", value: expanded };
		// Alias: references another color by name (e.g., theme: brand)
		if (/^[\w-]+$/.test(value)) return { type: "alias", source: value };
	}
	warnings?.push(
		`[RI-1101] Invalid @color value "${key}: ${value}" — expected "chroma hue" (e.g., "0.15 30"), a color name alias, or a CSS color function.`,
	);
	return null;
}

/**
 * Parse the value of a `dark: …` override from within a color entry's options
 * block — e.g. "fixed", "mirror", or "shift chroma +0.02 hue +10". The caller
 * has already isolated the `dark` key, so this works on the bare value.
 */
function parseDarkOverrideValue(value: string): ColorDarkOverride | undefined {
	const val = value.trim();
	if (val === "mirror") return { strategy: "mirror" };
	if (val === "fixed") return { strategy: "fixed" };
	if (val.startsWith("shift")) {
		const chromaMatch = val.match(/chroma\s+([+-]?\d+(?:\.\d+)?)/);
		const hueMatch = val.match(/hue\s+([+-]?\d+(?:\.\d+)?)/);
		const chromaDelta = chromaMatch ? Number.parseFloat(chromaMatch[1]) : 0;
		const hueDelta = hueMatch ? Number.parseFloat(hueMatch[1]) : 0;
		return {
			strategy: "shift",
			chromaDelta: Number.isNaN(chromaDelta) ? 0 : chromaDelta,
			hueDelta: Number.isNaN(hueDelta) ? 0 : hueDelta,
		};
	}
	return undefined;
}

/**
 * Find the `/` separator between light and dark values in a color pair.
 * Skips `/` characters inside parentheses (e.g., inside `oklch(0 0 0 / 0.5)`).
 * Returns -1 if no valid separator found.
 */
function findPairSeparator(value: string): number {
	let depth = 0;
	for (let i = 0; i < value.length; i++) {
		if (value[i] === "(" || value[i] === "[") depth++;
		else if (value[i] === ")" || value[i] === "]") {
			depth--;
			// Malformed input drove depth negative — no valid separator exists.
			if (depth < 0) return -1;
		} else if (value[i] === "/" && depth === 0) {
			// Skip an alpha slash — one tight against a token and immediately
			// followed by a number (e.g. `theme-282/52`). Only the spaced ` / `
			// between two color expressions separates a light/dark pair.
			const prev = value[i - 1];
			const next = value[i + 1];
			if (prev !== undefined && !/\s/.test(prev) && next !== undefined && /[\d.]/.test(next)) {
				continue;
			}
			// A pair separator needs content on both sides.
			const before = value.slice(0, i).trim();
			const after = value.slice(i + 1).trim();
			if (before && after) {
				return i;
			}
		}
	}
	return -1;
}
