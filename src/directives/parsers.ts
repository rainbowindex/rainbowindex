/**
 * Directive Body Parsers — directive-specific grammar for parsing body content.
 *
 * Extracted from directives.ts for maintainability. These functions handle the
 * inner body parsing for each directive type (@color, @text, @spacing, etc.).
 */

import {
	type AnimationDefinition,
	type ColorDefinition,
	type ColorDarkOverride,
	type CornerShape,
	CORNER_SHAPE_KEYWORDS,
} from "../theme/index.js";
import { isValidColorSuffix } from "../theme/colors.js";
import { clampAlphaPercent, mixColorAlpha } from "../css/alpha.js";

import {
	type FontFace,
	type FontSlot,
	createFontFace,
	createFontSlot,
	kindFromProvider,
	SAFE_FONT_FAMILY_CHARS,
	SAFE_FONT_FAMILY_RE,
} from "../integrations/font-providers/index.js";

import type {
	PreflightConfig,
	CustomUtility,
	CustomVariant,
	SourceDirective,
	LayerConfig,
	PropertyRegistration,
} from "./foundation.js";

import { findClosingBrace } from "./foundation.js";
import { stripCSSComments } from "../shared.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Strips characters outside the shared font-family trust boundary
 *  (defense-in-depth against CSS injection). */
const UNSAFE_FONT_FAMILY_CHARS_RE = new RegExp(`[^${SAFE_FONT_FAMILY_CHARS}]`, "g");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed length for @utility body content to prevent unbounded CSS output. */
const MAX_UTILITY_BODY_LENGTH = 10_000;
/** Maximum allowed length for @custom selector content. */
const MAX_CUSTOM_SELECTOR_LENGTH = 2_000;
/** Maximum number of entries allowed in @color body to bound memory allocation. */
const MAX_COLOR_ENTRIES = 500;
/** Maximum number of font configs allowed in @font block to bound fetch requests. */
const MAX_FONT_CONFIGS = 20;
/** @custom variant name format — aligns with class parser variant token rules. */
const CUSTOM_VARIANT_NAME_RE = /^[a-z][\w-]*$/;

/** Valid directive entry keys and @utility names. Digit-leading keys (`2xl`)
 *  and `--`-prefixed keys (`--roof`, `--my-var`) are intentionally allowed;
 *  whitespace, semicolons, and braces would emit broken CSS and are not. */
const IDENT_KEY_RE = /^[\w-]+$/;

/** Precompiled single-char whitespace test for the entry scanner. */
const WS_CHAR_RE = /\s/;

// isValidColorSuffix is imported from theme/colors.js

/** PostCSS-safe removal entry key — the Vite transform rewrites `!name;` to
 *  `--ri-rm: name;`. Shared by every body parser that supports removals. */
const REMOVAL_KEY = "--ri-rm";

/**
 * Read a `!name` removal token whose `!` sits at `i`. Pushes the name (when
 * non-empty) and returns the index just past it. Shared by the positional
 * body scanners (@color, @animate).
 */
function readRemovalToken(src: string, i: number, removals: string[]): number {
	let end = i + 1;
	while (end < src.length && /[\w-]/.test(src[end])) end++;
	const name = src.slice(i + 1, end);
	if (name) removals.push(name);
	return end;
}

/**
 * Index of the first `char` at paren/bracket depth 0 outside quotes, or -1.
 * Shared by value splitters so `clamp(2rem, 5vw, 4rem)` and friends never
 * split at an inner comma.
 */
function topLevelIndexOf(str: string, char: string): number {
	let depth = 0;
	for (let i = 0; i < str.length; i++) {
		const c = str[i];
		if (c === '"' || c === "'") {
			i++;
			while (i < str.length && str[i] !== c) {
				if (str[i] === "\\") i++;
				i++;
			}
			continue;
		}
		if (c === "(" || c === "[") depth++;
		else if (c === ")" || c === "]") {
			if (depth > 0) depth--;
		} else if (c === char && depth === 0) {
			return i;
		}
	}
	return -1;
}

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

type FontEntry = [string, string];

/** Accepted truthy spellings for boolean font options (e.g. `preload: yes`). */
const TRUTHY_FONT_VALUES = new Set(["true", "yes", "on"]);

/** Face-level keys. At slot level these act as defaults inherited by every face;
 *  inside an @face block they apply to that face only. */
const FACE_DEFAULT_KEYS = new Set([
	"weight",
	"style",
	"display",
	"subset",
	"unicodeRange",
	"unicode-range",
]);

/**
 * Apply per-face options. Used both for slot-level defaults (weight/style/…) and
 * for an individual @face block's own entries (which override the defaults).
 */
function applyFaceOptions(face: FontFace, entries: readonly FontEntry[]): void {
	for (const [key, value] of entries) {
		switch (key) {
			case "weight":
				face.weight = value;
				face._weightExplicit = true;
				break;
			case "style":
				face.style = value;
				face._styleExplicit = true;
				break;
			case "display":
				face.display = value;
				break;
			case "subset":
				face.subset = value;
				break;
			case "unicodeRange":
			case "unicode-range":
				face.unicodeRange = value;
				break;
			case "preload":
				face.preload = TRUTHY_FONT_VALUES.has(value);
				break;
		}
	}
}

/**
 * Apply slot-level options (fallback, features, variation, metrics, preload default).
 */
function applySlotOptions(slot: FontSlot, entries: readonly FontEntry[]): void {
	for (const [key, value] of entries) {
		switch (key) {
			case "fallback":
				slot.fallback = value.split(",").map((s) => s.trim());
				break;
			case "features":
				slot.features = value;
				break;
			case "variation":
				slot.variation = value;
				break;
			case "preload":
				slot.preload = TRUTHY_FONT_VALUES.has(value);
				break;
			case "metricsFallback":
				slot.metricsFallback = value.replace(/["']/g, "");
				break;
			case "sizeAdjust": {
				const n = Number.parseFloat(value);
				if (!Number.isNaN(n)) slot.sizeAdjust = n;
				break;
			}
			case "ascent": {
				const n = Number.parseFloat(value);
				if (!Number.isNaN(n)) slot.ascent = n;
				break;
			}
			case "descent": {
				const n = Number.parseFloat(value);
				if (!Number.isNaN(n)) slot.descent = n;
				break;
			}
			case "lineGap": {
				const n = Number.parseFloat(value);
				if (!Number.isNaN(n)) slot.lineGap = n;
				break;
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Body Parsers — directive-specific grammar
// ---------------------------------------------------------------------------

/**
 * Parse key-value pairs from a directive body.
 * Handles both simple values and values with semicolons/commas.
 *
 * ```
 * sm: 0.125rem;
 * DEFAULT: 0.25rem;
 * !slate;              ← removal
 * ```
 *
 * Entry boundaries are depth-aware: `;` ends an entry at paren/bracket/quote
 * depth 0; a newline ends one only when the last non-whitespace char is not a
 * comma (a trailing comma is the standard CSS wrap for multi-line values).
 * When `warnings` is provided, keys that would emit broken CSS are skipped
 * with RI-1035 naming `directiveName`.
 */
export function parseKeyValueBody(
	body: string,
	warnings?: string[],
	directiveName?: string,
): {
	entries: Array<[string, string]>;
	removals: string[];
} {
	const entries: Array<[string, string]> = [];
	const removals: string[] = [];
	const cleanedBody = stripCSSComments(body);

	const flush = (raw: string): void => {
		const line = raw.trim();
		if (!line) return;

		// Removal: !key
		if (line.startsWith("!")) {
			removals.push(line.slice(1).trim());
			return;
		}

		// key: value
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) return;

		const key = line.slice(0, colonIdx).trim();
		const value = line.slice(colonIdx + 1).trim();
		if (key === REMOVAL_KEY && value) {
			removals.push(value);
			return;
		}
		if (key && !IDENT_KEY_RE.test(key)) {
			warnings?.push(
				`[RI-1035] Invalid @${directiveName ?? "directive"} entry key "${key}" — keys may only contain letters, numbers, hyphens, and underscores. The entry was skipped.`,
			);
			return;
		}
		if (key && value) {
			entries.push([key, value]);
		}
	};

	let start = 0;
	let depth = 0;
	let lastNonWS = "";
	for (let i = 0; i < cleanedBody.length; i++) {
		const ch = cleanedBody[i];
		if (ch === '"' || ch === "'") {
			i++;
			while (i < cleanedBody.length && cleanedBody[i] !== ch) {
				if (cleanedBody[i] === "\\") i++;
				i++;
			}
			lastNonWS = ch;
			continue;
		}
		if (ch === "(" || ch === "[") {
			depth++;
			lastNonWS = ch;
			continue;
		}
		if (ch === ")" || ch === "]") {
			if (depth > 0) depth--;
			lastNonWS = ch;
			continue;
		}
		if (depth === 0 && (ch === ";" || (ch === "\n" && lastNonWS !== ","))) {
			flush(cleanedBody.slice(start, i));
			start = i + 1;
			lastNonWS = "";
			continue;
		}
		if (!WS_CHAR_RE.test(ch)) lastNonWS = ch;
	}
	flush(cleanedBody.slice(start));

	return { entries, removals };
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

	let i = 0;
	while (i < cleanedBody.length) {
		// Skip whitespace
		while (i < cleanedBody.length && /\s/.test(cleanedBody[i])) i++;
		if (i >= cleanedBody.length) break;

		// Check for removal: !name
		if (cleanedBody[i] === "!") {
			i = readRemovalToken(cleanedBody, i, removals);
			while (i < cleanedBody.length && /[\s;]/.test(cleanedBody[i])) i++;
			continue;
		}

		// Find colon for key: value
		const colonIdx = cleanedBody.indexOf(":", i);
		if (colonIdx === -1) break;

		const key = cleanedBody.slice(i, colonIdx).trim();
		i = colonIdx + 1;

		// Scan value, looking for ; or { (end of entry) while respecting parens
		const valueStart = i;
		let depth = 0;
		let braceStart = -1;

		let braceClosePos = -1;
		while (i < cleanedBody.length) {
			if (cleanedBody[i] === "(") depth++;
			else if (cleanedBody[i] === ")") depth--;
			else if (cleanedBody[i] === "{" && depth === 0) {
				braceStart = i;
				braceClosePos = findClosingBrace(cleanedBody, i);
				i = braceClosePos === -1 ? cleanedBody.length : braceClosePos + 1;
				break;
			} else if ((cleanedBody[i] === ";" || cleanedBody[i] === "\n") && depth === 0) {
				break;
			}
			i++;
		}

		let value: string;
		let darkBlock: string | null = null;

		if (braceStart !== -1) {
			value = cleanedBody.slice(valueStart, braceStart).trim();
			if (braceClosePos !== -1) {
				darkBlock = cleanedBody.slice(braceStart + 1, braceClosePos).trim();
			}
		} else {
			value = cleanedBody.slice(valueStart, i).trim();
		}

		if (i < cleanedBody.length && (cleanedBody[i] === ";" || cleanedBody[i] === "\n")) i++;

		if (!key || !value) continue;

		if (key === REMOVAL_KEY) {
			removals.push(value);
			continue;
		}

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
					darkOverride = parseDarkOverrideBlock(`dark: ${optVal}`);
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
 * Parse a dark override block from within a color entry.
 * e.g. "dark: fixed;" or "dark: mirror;" or "dark: shift chroma +0.02 hue +10;"
 */
function parseDarkOverrideBlock(block: string): ColorDarkOverride | undefined {
	const { entries } = parseKeyValueBody(block);
	for (const [k, v] of entries) {
		if (k !== "dark") continue;
		const val = v.trim();
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

/**
 * Parse @text body.
 *
 * ```
 * xs: 0.75rem, calc(1 / 0.75);
 * base: 1rem, 1.5;
 * ```
 */
export function parseTextBody(
	body: string,
	warnings?: string[],
): {
	text: Record<string, { fontSize: string; lineHeight: string }>;
	removals: string[];
} {
	const { entries, removals } = parseKeyValueBody(body, warnings, "text");
	const text: Record<string, { fontSize: string; lineHeight: string }> = {};

	for (const [key, value] of entries) {
		// Depth-aware split so `clamp(2rem, 5vw, 4rem), 1.1` keeps the clamp intact.
		const commaIdx = topLevelIndexOf(value, ",");
		if (commaIdx !== -1) {
			const fontSize = value.slice(0, commaIdx).trim();
			const lineHeight = value.slice(commaIdx + 1).trim();
			text[key] = { fontSize, lineHeight };
		} else {
			text[key] = { fontSize: value.trim(), lineHeight: "1.5" };
		}
	}

	return { text, removals };
}

/**
 * Parse @spacing body.
 *
 * ```
 * base: 0.25rem;
 * ```
 */
export function parseSpacingBody(body: string): {
	base: string | null;
} {
	const { entries } = parseKeyValueBody(body);
	let base: string | null = null;

	for (const [key, value] of entries) {
		if (key === "base") {
			base = value;
		}
	}

	return {
		base,
	};
}

/**
 * Parse @animate body.
 *
 * ```
 * spin: spin 1s linear infinite {
 *   from { transform: rotate(0deg); }
 *   to { transform: rotate(360deg); }
 * }
 * ```
 */
export function parseAnimateBody(body: string): {
	animations: Record<string, AnimationDefinition>;
	removals: string[];
} {
	const animations: Record<string, AnimationDefinition> = {};
	const removals: string[] = [];
	const cleaned = stripCSSComments(body);

	// Positional scan over `name: shorthand { keyframes }` entries. Removals
	// (`!name;` / `--ri-rm: name;`) are only recognized at the top level of the
	// body — never inside keyframe blocks, where `!important` must survive.
	// This mirrors the Vite transform, which only rewrites depth-0 spans.
	let i = 0;
	while (i < cleaned.length) {
		// Skip whitespace and stray semicolons between entries
		while (i < cleaned.length && /[\s;]/.test(cleaned[i])) i++;
		if (i >= cleaned.length) break;

		// Top-level removal: !name;
		if (cleaned[i] === "!") {
			i = readRemovalToken(cleaned, i, removals);
			continue;
		}

		// Find name
		let nameEnd = i;
		while (nameEnd < cleaned.length && /[\w-]/.test(cleaned[nameEnd])) nameEnd++;
		const name = cleaned.slice(i, nameEnd);
		if (!name) {
			i++;
			continue;
		}

		// Skip whitespace and colon
		let j = nameEnd;
		while (j < cleaned.length && /\s/.test(cleaned[j])) j++;
		if (cleaned[j] !== ":") {
			i = j + 1;
			continue;
		}
		j++; // skip colon
		while (j < cleaned.length && /\s/.test(cleaned[j])) j++;

		// Read the value until the keyframes brace or a top-level terminator.
		let k = j;
		while (k < cleaned.length && cleaned[k] !== "{" && cleaned[k] !== ";") k++;

		if (k >= cleaned.length || cleaned[k] === ";") {
			// Terminated without a keyframes block — PostCSS-safe removal or a stray entry.
			const value = cleaned.slice(j, k).trim();
			if (name === REMOVAL_KEY && value) removals.push(value);
			i = k < cleaned.length ? k + 1 : k;
			continue;
		}

		const shorthand = cleaned.slice(j, k).trim();

		// Find matching close brace for keyframes block
		const closePos = findClosingBrace(cleaned, k);
		if (closePos === -1) break;

		const keyframes = cleaned.slice(k + 1, closePos).trim();
		animations[name] = { shorthand, keyframes };
		i = closePos + 1;
	}

	return { animations, removals };
}

/**
 * Parse @fluid body.
 *
 * ```
 * min: 20rem;
 * max: 80rem;
 * ```
 */
export function parseFluidBody(body: string): {
	min?: string;
	max?: string;
	unit?: string;
	multiplier?: string;
} {
	const { entries } = parseKeyValueBody(body);
	const result: { min?: string; max?: string; unit?: string; multiplier?: string } = {};
	for (const [key, value] of entries) {
		if (key === "min") result.min = value;
		if (key === "max") result.max = value;
		if (key === "unit") result.unit = value;
		if (key === "multiplier") result.multiplier = value;
	}
	return result;
}

/**
 * Parse @preflight body or modifier.
 *
 * - `@preflight;`             → all on
 * - `@preflight off;`         → all off
 * - `@preflight { core: on; forms: off; }` → selective, merged onto `base`
 *
 * Selective bodies merge onto `base` (the config accumulated from earlier
 * @preflight directives) so `@preflight { forms: off; }` followed by
 * `@preflight { interactive: off; }` disables both. Bare and `off` forms are
 * absolute and reset every flag.
 */
export function parsePreflightDirective(
	body: string,
	modifier?: string,
	base?: Readonly<PreflightConfig>,
): PreflightConfig {
	const normalizedModifier = modifier ? stripCSSComments(modifier).trim() : undefined;

	if (normalizedModifier === "off") {
		return {
			core: false,
			typography: false,
			content: false,
			forms: false,
			interactive: false,
			modern: false,
		};
	}

	const allOn: PreflightConfig = {
		core: true,
		typography: true,
		content: true,
		forms: true,
		interactive: true,
		modern: true,
	};

	if (!body) return allOn;

	const config: PreflightConfig = base ? { ...base } : allOn;
	const { entries } = parseKeyValueBody(body);
	for (const [key, value] of entries) {
		const k = key as keyof PreflightConfig;
		if (Object.hasOwn(config, k)) {
			config[k] = value === "on" || value === "true";
		}
	}

	return config;
}

/** Strip characters disallowed in a font family name (defense-in-depth against CSS injection). */
function sanitizeFamily(family: string): string {
	return family.replace(UNSAFE_FONT_FAMILY_CHARS_RE, "");
}

/** Build one face from a provider + inherited slot defaults, optionally forcing a style. */
function buildFace(
	provider: string,
	faceDefaults: readonly FontEntry[],
	forceStyle?: string,
): FontFace {
	const face = createFontFace({ provider });
	applyFaceOptions(face, faceDefaults);
	if (forceStyle !== undefined) {
		face.style = forceStyle;
		face._styleExplicit = true;
	}
	return face;
}

/** Build a face from an `@face { … }` block's entries (`src:` becomes the provider). */
function faceFromBlock(
	entries: readonly FontEntry[],
	faceDefaults: readonly FontEntry[],
): FontFace {
	let src = "";
	const own: FontEntry[] = [];
	for (const [k, v] of entries) {
		if (k === "src") src = v.replace(/["']/g, "");
		else own.push([k, v]);
	}
	const face = createFontFace({ provider: src });
	applyFaceOptions(face, faceDefaults);
	applyFaceOptions(face, own);
	return face;
}

interface SlotBlock {
	faceDefaults: FontEntry[];
	slotOpts: FontEntry[];
	faceBlocks: FontEntry[][];
	italicSrcs: string[];
}

/** Pull `@face { … }` sub-blocks out of a slot body, returning them plus the remaining text. */
function extractFaceBlocks(
	body: string,
	warnings?: string[],
): { faceBlocks: FontEntry[][]; rest: string } {
	const faceBlocks: FontEntry[][] = [];
	let rest = "";
	let i = 0;
	while (i < body.length) {
		const at = body.indexOf("@face", i);
		if (at === -1) {
			rest += body.slice(i);
			break;
		}
		rest += body.slice(i, at);
		let j = at + 5;
		while (j < body.length && /\s/.test(body[j])) j++;
		if (body[j] !== "{") {
			// Not an @face block (e.g. a stray token) — keep it in the remaining text.
			rest += body.slice(at, j);
			i = j;
			continue;
		}
		const close = findClosingBrace(body, j);
		if (close === -1) {
			rest += body.slice(at);
			break;
		}
		faceBlocks.push(parseKeyValueBody(body.slice(j + 1, close), warnings, "font").entries);
		i = close + 1;
	}
	return { faceBlocks, rest };
}

/** Split a slot body into inherited face defaults, slot options, @face blocks, and italic shorthands. */
function processSlotBlock(blockBody: string, warnings?: string[]): SlotBlock {
	const { faceBlocks, rest } = extractFaceBlocks(blockBody, warnings);
	const { entries } = parseKeyValueBody(rest, warnings, "font");
	const faceDefaults: FontEntry[] = [];
	const slotOpts: FontEntry[] = [];
	const italicSrcs: string[] = [];
	for (const [k, v] of entries) {
		if (k === "italic") italicSrcs.push(v.replace(/["']/g, ""));
		else if (FACE_DEFAULT_KEYS.has(k)) faceDefaults.push([k, v]);
		else slotOpts.push([k, v]);
	}
	return { faceDefaults, slotOpts, faceBlocks, italicSrcs };
}

/** Assemble a slot's faces: an optional primary face (from `from <provider>`),
 *  any explicit @face blocks, and any italic: shorthands. */
function buildFaces(primaryProvider: string | null, block: SlotBlock): FontFace[] {
	const faces: FontFace[] = [];
	if (primaryProvider !== null) faces.push(buildFace(primaryProvider, block.faceDefaults));
	for (const fb of block.faceBlocks) faces.push(faceFromBlock(fb, block.faceDefaults));
	for (const src of block.italicSrcs) faces.push(buildFace(src, block.faceDefaults, "italic"));
	if (faces.length === 0) faces.push(buildFace("", block.faceDefaults));
	return faces;
}

/** Warn (RI-1214) when a slot has two faces sharing the same weight+style. */
function warnDuplicateFaces(slot: FontSlot, warnings?: string[]): void {
	if (!warnings || slot.faces.length < 2) return;
	const seen = new Set<string>();
	for (const face of slot.faces) {
		const key = `${face.weight}|${face.style}`;
		if (seen.has(key)) {
			warnings.push(
				`[RI-1214] @font slot "${slot.slot}" has duplicate faces with weight "${face.weight}" and style "${face.style}" — the later @font-face wins. Remove the duplicate or give it a distinct weight/style.`,
			);
		}
		seen.add(key);
	}
}

/**
 * Parse a single @font slot declaration into a FontSlot.
 *
 * Forms:
 * - `system`
 * - `"Inter" from google { weight: 100 900; style: normal italic; }`
 * - `"Inter", ui-sans-serif, sans-serif { features: "cv11"; }`            (manual stack)
 * - `"Satoshi" from "/Satoshi.woff2" { weight: 300 900; italic: "/Satoshi-Italic.woff2"; }`
 * - `"Satoshi" { @face { src: "/regular.woff2"; } @face { src: "/italic.woff2"; style: italic; } }`
 */
export function parseFontBody(body: string, slot: string, warnings?: string[]): FontSlot {
	const normalizedBody = stripCSSComments(body).trim();

	if (normalizedBody === "system") {
		return createFontSlot({ slot, family: "", kind: "system" });
	}

	// Wrapped declarations (e.g. a multi-line font stack) would fail the
	// line-oriented preamble regexes below — collapse whitespace runs outside
	// the optional { … } block before matching. Block content keeps its layout.
	const braceIdx = topLevelIndexOf(normalizedBody, "{");
	const matchable =
		braceIdx === -1
			? normalizedBody.replace(/\s+/g, " ")
			: normalizedBody.slice(0, braceIdx).replace(/\s+/g, " ") + normalizedBody.slice(braceIdx);

	// "from <provider>" path
	const fromMatch = matchable.match(/^(["'])(.+?)\1\s+from\s+(.+?)(?:\s*\{([\s\S]*)\})?$/);
	if (fromMatch) {
		const family = fromMatch[2];
		// Validate the family at the parse boundary to prevent CSS injection
		// (e.g. `"Inter};.foo{color:red"`).
		if (!SAFE_FONT_FAMILY_RE.test(family)) {
			return createFontSlot({ slot, family: sanitizeFamily(family), kind: "manual" });
		}
		const provider = fromMatch[3].trim().replace(/["']/g, "");
		const kind = kindFromProvider(provider);
		const block = processSlotBlock(fromMatch[4] || "", warnings);

		if (kind === "google" || kind === "system") {
			if (block.faceBlocks.length > 0 || block.italicSrcs.length > 0) {
				warnings?.push(
					`[RI-1204] @font slot "${slot}" loads "${family}" from "${provider}" but also declares @face/italic faces — provider fonts can't be combined with local faces. The extra faces were ignored.`,
				);
			}
			const config = createFontSlot({
				slot,
				family,
				kind,
				faces: [buildFace(provider, block.faceDefaults)],
			});
			applySlotOptions(config, block.slotOpts);
			return config;
		}

		const config = createFontSlot({ slot, family, kind, faces: buildFaces(provider, block) });
		applySlotOptions(config, block.slotOpts);
		warnDuplicateFaces(config, warnings);
		return config;
	}

	// Manual stack OR family-with-@face (no "from" keyword)
	const manualMatch = matchable.match(/^(.+?)(?:\s*\{([\s\S]*)\})?$/);
	if (manualMatch) {
		const stackParts = manualMatch[1]
			.trim()
			.split(",")
			.map((s) => s.trim());
		const family = stackParts[0].replace(/["']/g, "");
		if (!SAFE_FONT_FAMILY_RE.test(family)) {
			return createFontSlot({ slot, family: sanitizeFamily(family), kind: "manual" });
		}
		const fallback = stackParts.slice(1).map((s) => s.replace(/["']/g, "").trim());
		const block = processSlotBlock(manualMatch[2] || "", warnings);

		if (block.faceBlocks.length > 0 || block.italicSrcs.length > 0) {
			// Family + @face/italic faces → a local slot with no provider preamble.
			const config = createFontSlot({
				slot,
				family,
				kind: "local",
				fallback,
				faces: buildFaces(null, block),
			});
			applySlotOptions(config, block.slotOpts);
			warnDuplicateFaces(config, warnings);
			return config;
		}

		// Manual font stack — no @font-face, just the variable.
		const config = createFontSlot({
			slot,
			family,
			kind: "manual",
			fallback,
			faces: [buildFace("", block.faceDefaults)],
		});
		applySlotOptions(config, block.slotOpts);
		return config;
	}

	return createFontSlot({
		slot,
		family: sanitizeFamily(normalizedBody.replace(/["']/g, "")),
		kind: "manual",
	});
}

/**
 * Parse nested @font block body into multiple FontConfigs.
 *
 * ```
 * sans: "Inter" from google;
 * serif: "Merriweather" from google;
 * mono: "Fira Code" from google { weight: 300 700; }
 * ```
 */
export function parseNestedFontBlock(body: string, warnings?: string[]): FontSlot[] {
	const cleanedBody = stripCSSComments(body);
	const configs: FontSlot[] = [];
	let i = 0;

	while (i < cleanedBody.length) {
		// Skip whitespace
		while (i < cleanedBody.length && /\s/.test(cleanedBody[i])) i++;
		if (i >= cleanedBody.length) break;

		// Guard against pathological input with excessive font slot definitions.
		// Checked after the whitespace skip so the warning only fires when real
		// content was actually truncated.
		if (configs.length >= MAX_FONT_CONFIGS) {
			warnings?.push(
				`[RI-1216] @font block exceeds ${MAX_FONT_CONFIGS} slot definitions — the remaining slots were skipped. Split rarely-used slots into a separate stylesheet or remove unused ones.`,
			);
			break;
		}

		// Find slot name (up to the colon)
		const colonIdx = cleanedBody.indexOf(":", i);
		if (colonIdx === -1) break;
		const slot = cleanedBody.slice(i, colonIdx).trim();
		if (!slot) break;
		i = colonIdx + 1;

		// Skip whitespace after colon
		while (i < cleanedBody.length && /\s/.test(cleanedBody[i])) i++;

		// Scan the font value — look for ; or { (respecting quotes)
		let bracePos = -1;
		let semiPos = -1;
		let inQuote = false;
		let quoteChar = "";
		for (let j = i; j < cleanedBody.length; j++) {
			if (inQuote) {
				if (cleanedBody[j] === quoteChar) {
					let bs = 0;
					while (j - 1 - bs >= i && cleanedBody[j - 1 - bs] === "\\") bs++;
					if (bs % 2 === 0) inQuote = false;
				}
				continue;
			}
			if (cleanedBody[j] === '"' || cleanedBody[j] === "'") {
				inQuote = true;
				quoteChar = cleanedBody[j];
				continue;
			}
			if (cleanedBody[j] === "{") {
				bracePos = j;
				break;
			}
			if (cleanedBody[j] === ";") {
				semiPos = j;
				break;
			}
		}

		if (bracePos !== -1) {
			// Has body block: slot: "Inter" from google { weight: 100 900; }
			const preamble = cleanedBody.slice(i, bracePos).trim();
			const closePos = findClosingBrace(cleanedBody, bracePos);
			if (closePos === -1) break;
			const innerBody = cleanedBody.slice(bracePos + 1, closePos).trim();
			const combined = `${preamble} { ${innerBody} }`;
			configs.push(parseFontBody(combined, slot, warnings));
			i = closePos + 1;
			// Skip optional trailing semicolon
			while (i < cleanedBody.length && /[\s;]/.test(cleanedBody[i])) i++;
		} else if (semiPos !== -1) {
			// Simple: slot: "Inter" from google;
			const value = cleanedBody.slice(i, semiPos).trim();
			configs.push(parseFontBody(value, slot, warnings));
			i = semiPos + 1;
		} else {
			// End of body without terminator
			const value = cleanedBody.slice(i).trim();
			if (value) configs.push(parseFontBody(value, slot, warnings));
			break;
		}
	}

	return configs;
}

/** Strip a single leading `.` so `@utility .foo` and `@utility foo` are equivalent. */
function stripLeadingClassDot(name: string): string {
	return name.startsWith(".") ? name.slice(1) : name;
}

/** Validate a custom-utility name (after the functional `-*` suffix is stripped).
 *  Names with whitespace/semicolons/braces would emit broken selectors — warn
 *  RI-1035 and report invalid so callers skip the utility. */
function isValidUtilityName(name: string, warnings?: string[]): boolean {
	if (IDENT_KEY_RE.test(name)) return true;
	warnings?.push(
		`[RI-1035] Invalid @utility name "${name}" — names may only contain letters, numbers, hyphens, and underscores (plus an optional trailing "-*" for functional utilities). The utility was skipped.`,
	);
	return false;
}

/**
 * Parse @utility body.
 *
 * ```
 * @utility card { background: var(--color-surface); padding: ... }
 * @utility tab-size-* { tab-size: var(--value); }
 * ```
 *
 * A single leading `.` on the name is tolerated (`@utility .card` ≡ `@utility card`).
 */
export function parseUtilityDirective(
	body: string,
	modifier?: string,
	warnings?: string[],
): CustomUtility | null {
	const normalizedModifier = stripLeadingClassDot(
		modifier ? stripCSSComments(modifier).trim() : "",
	);
	if (!normalizedModifier) return null;
	if (body.length > MAX_UTILITY_BODY_LENGTH) {
		warnings?.push(
			`[RI-1015] @utility "${normalizedModifier}" body exceeds ${MAX_UTILITY_BODY_LENGTH} characters (${body.length}) — directive skipped.`,
		);
		return null;
	}
	const normalizedBody = stripCSSComments(body).trim();
	const functional = normalizedModifier.endsWith("-*");
	const name = functional ? normalizedModifier.slice(0, -2) : normalizedModifier;
	if (!isValidUtilityName(name, warnings)) return null;
	return { name, functional, body: normalizedBody };
}

/**
 * Parse a grouped @utility block (no modifier) containing multiple named utilities.
 *
 * ```
 * @utility {
 *   flex-center {
 *     display: flex;
 *     align-items: center;
 *   }
 *   text-shadow {
 *     text-shadow: 0 2px 4px rgb(0 0 0 / 0.1);
 *   }
 * }
 * ```
 */
export function parseGroupedUtilityDirective(body: string, warnings?: string[]): CustomUtility[] {
	const results: CustomUtility[] = [];
	const cleaned = stripCSSComments(body).trim();
	let i = 0;

	while (i < cleaned.length) {
		// Skip whitespace
		while (i < cleaned.length && /\s/.test(cleaned[i])) i++;
		if (i >= cleaned.length) break;

		// Read utility name (up to '{')
		let nameEnd = i;
		while (nameEnd < cleaned.length && cleaned[nameEnd] !== "{") nameEnd++;
		const name = stripLeadingClassDot(cleaned.slice(i, nameEnd).trim());
		if (!name || nameEnd >= cleaned.length) {
			if (name) {
				warnings?.push(
					`[RI-1015] Grouped @utility: missing opening brace for "${name}" — skipped.`,
				);
			}
			break;
		}

		// Find matching closing brace
		const closePos = findClosingBrace(cleaned, nameEnd);
		if (closePos === -1) {
			warnings?.push(`[RI-1015] Grouped @utility: unmatched brace for "${name}" — skipped.`);
			break;
		}

		const innerBody = cleaned.slice(nameEnd + 1, closePos).trim();
		if (innerBody.length > MAX_UTILITY_BODY_LENGTH) {
			warnings?.push(
				`[RI-1015] @utility "${name}" body exceeds ${MAX_UTILITY_BODY_LENGTH} characters (${innerBody.length}) — directive skipped.`,
			);
			i = closePos + 1;
			continue;
		}

		const functional = name.endsWith("-*");
		const baseName = functional ? name.slice(0, -2) : name;
		if (isValidUtilityName(baseName, warnings)) {
			results.push({ name: baseName, functional, body: innerBody });
		}

		i = closePos + 1;
	}
	return results;
}

/**
 * Parse @custom.
 *
 * ```
 * @custom hocus (&:hover, &:focus);
 * @custom any-hover (@media (any-hover: hover));
 * @custom hocus { &:hover, &:focus { @slot; } }
 * ```
 */
export function parseCustomVariantDirective(
	body: string,
	modifier?: string,
	warnings?: string[],
): CustomVariant | null {
	const normalizedModifier = modifier ? stripCSSComments(modifier).trim() : "";
	const normalizedBody = stripCSSComments(body).trim();
	if (!normalizedModifier) return null;
	const isValidCustomVariantName = (name: string): boolean => {
		if (CUSTOM_VARIANT_NAME_RE.test(name)) return true;
		warnings?.push(
			`[RI-1017] @custom variant name "${name}" is invalid. Use lowercase letters, numbers, hyphens, or underscores, and start with a letter.`,
		);
		return false;
	};
	// modifier contains the variant name, and possibly the selector inline
	// e.g. modifier = "hocus (&:hover, &:focus)" (inline form)
	// or modifier = "hocus" with body containing the block form
	const parenMatch = normalizedModifier.match(/^([\w-]+)\s*\((.+)\)$/s);
	if (parenMatch) {
		if (!isValidCustomVariantName(parenMatch[1])) return null;
		const selector = parenMatch[2].trim();
		if (!selector) return null;
		if (selector.length > MAX_CUSTOM_SELECTOR_LENGTH) {
			warnings?.push(
				`[RI-1016] @custom "${parenMatch[1]}" selector exceeds ${MAX_CUSTOM_SELECTOR_LENGTH} characters (${selector.length}) — directive skipped.`,
			);
			return null;
		}
		return { name: parenMatch[1], selector };
	}

	// Block form: modifier is just the name, body has the content
	// e.g. body = "&:hover, &:focus { @slot; }"
	// Extract the selector wrapper by removing @slot; and the inner braces
	const name = normalizedModifier.trim();
	if (!isValidCustomVariantName(name)) return null;
	if (normalizedBody) {
		let selector = normalizedBody;
		// If body contains @slot, extract the selector wrapping it
		if (normalizedBody.includes("@slot")) {
			// Match pattern: selector { @slot; }
			const slotMatch = normalizedBody.match(/^([\s\S]+?)\s*\{\s*@slot\s*;?\s*\}$/);
			if (slotMatch) {
				selector = slotMatch[1].trim();
			} else {
				// Fallback: just strip @slot; from the body
				selector = normalizedBody.replace(/@slot\s*;?/g, "").trim();
			}
		}
		if (!selector) return null;
		if (selector.length > MAX_CUSTOM_SELECTOR_LENGTH) {
			warnings?.push(
				`[RI-1016] @custom "${name}" selector exceeds ${MAX_CUSTOM_SELECTOR_LENGTH} characters (${selector.length}) — directive skipped.`,
			);
			return null;
		}
		return { name, selector };
	}

	return null;
}

/**
 * Parse @source directive.
 *
 * ```
 * @source "./src/**\/*.{ts,tsx}";
 * @source not "./node_modules/**\/*";
 * @source inline("underline text-red-500");
 * ```
 */
export function parseSourceDirective(body: string, modifier?: string): SourceDirective | null {
	const raw = stripCSSComments(modifier || body || "").trim();
	if (!raw) return null;

	// @source inline("...")
	const inlineMatch = raw.match(/^inline\(["'](.+?)["']\)$/);
	if (inlineMatch) {
		return {
			pattern: "",
			negated: false,
			inline: true,
			classes: inlineMatch[1].split(/\s+/).filter(Boolean),
		};
	}

	// @source not "pattern"
	const negated = raw.startsWith("not ");
	const pattern = (negated ? raw.slice(4) : raw).trim().replace(/["']/g, "");

	return { pattern, negated, inline: false };
}

/** Keywords accepted by `@rounded <shape>` — derived from the theme's source list. */
const CORNER_SHAPE_KEYWORD_SET = new Set<string>(CORNER_SHAPE_KEYWORDS);

/**
 * Parse the `@rounded <shape>` modifier.
 *
 * Accepts any `corner-shape` value: `round`, `scoop`, `bevel`, `notch`,
 * `square`, `squircle`, or `superellipse(N)`. Returns `null` if no modifier
 * was provided or the input is unrecognized — callers should skip setting
 * a shape in that case.
 */
export function parseRoundedModifier(modifier?: string): CornerShape | null {
	if (!modifier) return null;
	const m = stripCSSComments(modifier).trim();
	if (CORNER_SHAPE_KEYWORD_SET.has(m)) {
		return m as CornerShape;
	}
	const match = m.match(/^superellipse\((\d+(?:\.\d+)?)\)$/);
	if (match) {
		const n = Number.parseFloat(match[1]);
		if (!Number.isNaN(n)) return { superellipse: n };
	}
	return null;
}

// ---------------------------------------------------------------------------
// @layer
// ---------------------------------------------------------------------------

const VALID_LAYER_KEYS = new Set(["order", "utilities", "base"]);

/**
 * Parse @layer directive.
 *
 * Simple form:  `@layer utilities;`  → modifier="utilities", body=""
 * Body form:    `@layer { order: base, utilities; utilities: utilities; base: base; }`
 */
export function parseLayerDirective(
	body: string,
	modifier: string | undefined,
	warnings: string[],
): LayerConfig {
	// Simple form: @layer <name>;
	if (!body && modifier) {
		return { order: null, utilities: null, base: null, wrapAll: modifier };
	}

	// Body form: @layer { order: ...; utilities: ...; base: ...; }
	const { entries } = parseKeyValueBody(body, warnings, "layer");
	let order: string[] | null = null;
	let utilities: string | null = null;
	let base: string | null = null;

	for (const [key, value] of entries) {
		if (!VALID_LAYER_KEYS.has(key)) {
			warnings.push(
				`[RI-1120] Unknown @layer option "${key}" — supported: order, utilities, base.`,
			);
			continue;
		}
		switch (key) {
			case "order":
				order = value
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
				break;
			case "utilities":
				utilities = value;
				break;
			case "base":
				base = value;
				break;
		}
	}

	return { order, utilities, base, wrapAll: null };
}

// ---------------------------------------------------------------------------
// @register — custom-property registration (emits @property rules)
// ---------------------------------------------------------------------------

/**
 * Descriptor keys recognized inside an `@register` body. Anything else that
 * starts with `--` is treated as a per-property entry whose value is its
 * `initial-value`.
 */
const REGISTER_DESCRIPTOR_KEYS = new Set(["syntax", "inherits", "initial-value"]);

/** Normalize a `syntax` descriptor: strip one layer of surrounding quotes, then
 *  re-quote (a `@property` syntax descriptor must be a string). Reports whether
 *  the syntax is the universal `*`, for which `initial-value` is optional. */
function normalizeSyntax(raw: string | undefined): { quoted: string; universal: boolean } {
	const unquoted = (raw ?? "*")
		.trim()
		.replace(/^["']|["']$/g, "")
		.trim();
	return { quoted: `"${unquoted}"`, universal: unquoted === "*" };
}

/**
 * Parse an `@register` directive into zero or more property registrations.
 *
 * Two authoring forms are supported:
 *
 * 1. **Grouped name list** — names in the modifier share one definition in the body:
 *    ```css
 *    @register --a, --b, --c { syntax: "<length>"; inherits: false; initial-value: 0px; }
 *    ```
 * 2. **Shared-defaults block** — block-level `syntax`/`inherits`/`initial-value`
 *    defaults plus one `--name: <initial>` entry per property:
 *    ```css
 *    @register { syntax: "<length>"; inherits: false; --a: 0px; --b: 8px; }
 *    ```
 *
 * `inherits` defaults to `false` and `syntax` to `"*"`. A typed (non-universal)
 * registration with no `initial-value` is dropped with a warning, since the
 * browser would ignore it anyway.
 */
export function parseRegisterBody(
	modifier: string | undefined,
	body: string,
	warnings: string[],
): PropertyRegistration[] {
	const { entries } = parseKeyValueBody(body, warnings, "register");

	let syntaxRaw: string | undefined;
	let inheritsRaw: string | undefined;
	let initialRaw: string | undefined;
	const bodyNames: Array<[string, string]> = [];
	for (const [key, value] of entries) {
		if (key === "syntax") syntaxRaw = value;
		else if (key === "inherits") inheritsRaw = value;
		else if (key === "initial-value") initialRaw = value;
		else if (key.startsWith("--")) bodyNames.push([key, value]);
		else if (!REGISTER_DESCRIPTOR_KEYS.has(key)) {
			warnings.push(
				`[RI-1031] Unknown @register entry "${key}" — expected syntax, inherits, initial-value, or a "--custom-property: <initial>" entry.`,
			);
		}
	}

	const { quoted: syntax, universal } = normalizeSyntax(syntaxRaw);
	const inherits = (inheritsRaw ?? "").trim().toLowerCase() === "true";

	const out: PropertyRegistration[] = [];

	// Dedup (last-wins) is applied globally in the resolver so it spans multiple
	// @register directives, not just repeats within a single block.
	const add = (name: string, initial: string | undefined) => {
		if (!name.startsWith("--")) {
			warnings.push(
				`[RI-1028] Invalid @register property name "${name}" — custom property names must start with "--" (e.g. --my-var). Skipped.`,
			);
			return;
		}
		const initialValue = initial && initial.length > 0 ? initial : undefined;
		if (!universal && initialValue === undefined) {
			warnings.push(
				`[RI-1029] @register property "${name}" has syntax ${syntax} but no initial-value — a typed @property without one is ignored by browsers. Add an initial-value or use syntax "*". Skipped.`,
			);
			return;
		}
		out.push({ name, syntax, inherits, initialValue });
	};

	const modifierNames = (modifier ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	if (modifierNames.length > 0) {
		// Form 1: the body is one shared definition applied to every listed name.
		for (const name of modifierNames) add(name, initialRaw);
	}
	// Per-property entries are always honored (their own value is the initial-value,
	// falling back to a block-level initial-value when omitted). This also covers
	// Form 2 when no modifier names are present.
	for (const [name, value] of bodyNames) add(name, value || initialRaw);

	if (modifierNames.length === 0 && bodyNames.length === 0) {
		warnings.push(
			`[RI-1031] @register declared no properties — provide a name list (\`@register --a, --b { … }\`) or "--name: <initial>" entries.`,
		);
	}

	return out;
}
