/**
 * Font loading system — @font directive processing, @font-face generation,
 * metrics-adjusted fallbacks for zero CLS.
 *
 * A slot (sans/serif/mono/custom) maps to one --font-<slot> variable and one
 * family name, but can own multiple faces — e.g. an upright + an italic file,
 * or split unicode ranges. Each FontFace emits one @font-face for local
 * providers; google/system/manual slots carry a single face.
 */

export type { GoogleFontMeta } from "./google/state.js";
export { SAFE_FONT_FAMILY_CHARS, SAFE_FONT_FAMILY_RE } from "./google/state.js";
export {
	fetchGoogleFontList,
	getGoogleFontMeta,
	isVariableFont,
	refreshFontWeightDefaults,
	resolveGoogleFonts,
} from "./google/index.js";
import { isRIDebug } from "../../shared.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Provider discriminant for a slot, derived from its faces. */
export type FontProviderKind = "google" | "system" | "local" | "manual";

export interface FontFace {
	/** Provider: "google", "system", a file path/URL, or "" (manual stack — no @font-face). */
	provider: string;
	/** Weight range ("300 900"), list ("400,700"), or single ("400"). */
	weight: string;
	/** A single valid font-style descriptor: "normal", "italic", or "oblique <range>".
	 *  (Google faces may carry "normal italic" — that drives the URL's ital axis, not a descriptor.) */
	style: string;
	/** font-display strategy. */
	display: string;
	/** Unicode subsets — used as a Google Fonts URL hint. */
	subset: string;
	/** Optional unicode-range descriptor emitted into the @font-face (local subsetting). */
	unicodeRange?: string;
	/** Per-face preload override; when undefined the slot-level default applies. */
	preload?: boolean;
	/** Whether the weight was explicitly set by the user (not a default).
	 *  Used by refreshFontWeightDefaults() to avoid overriding user intent. */
	_weightExplicit?: boolean;
	/** Whether the style was explicitly set by the user (not a default).
	 *  Used by refreshFontWeightDefaults() to avoid overriding user intent. */
	_styleExplicit?: boolean;
}

export interface FontSlot {
	/** Target slot: "sans", "serif", "mono", or custom like "display". */
	slot: string;
	/** Font family name — shared by every face in the slot. */
	family: string;
	/** Provider discriminant, derived from the slot's faces. */
	kind: FontProviderKind;
	/** Fallback font stack. */
	fallback: string[];
	/** Font feature settings — applied via the font-<slot> utility. */
	features: string | null;
	/** Font variation settings — applied via the font-<slot> utility. */
	variation: string | null;
	/** Slot-level preload default for faces that don't set their own. */
	preload: boolean;
	/** One or more faces — each emits an @font-face for local providers. */
	faces: FontFace[];
	/** User-specified fallback font for metrics-adjusted @font-face. */
	metricsFallback?: string;
	/** User-specified size-adjust percentage. */
	sizeAdjust?: number;
	/** User-specified ascent-override percentage. */
	ascent?: number;
	/** User-specified descent-override percentage. */
	descent?: number;
	/** User-specified line-gap-override percentage. */
	lineGap?: number;
}

export interface FontMetrics {
	fallback: string;
	sizeAdjust: number;
	ascent: number;
	descent: number;
	lineGap: number;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Google faces default to the full variable-weight range and both italic/normal
 *  styles so a face without an explicit weight/style still yields a useful
 *  variable-font URL. refreshFontWeightDefaults() narrows these once Google
 *  metadata reveals a smaller weight axis or no italic axis. */
const GOOGLE_DEFAULT_WEIGHT = "100 900";
const GOOGLE_DEFAULT_STYLE = "normal italic";

/** Map a face's provider string to the slot-level kind discriminant. */
export function kindFromProvider(provider: string): FontProviderKind {
	if (provider === "google") return "google";
	if (provider === "system") return "system";
	if (provider === "") return "manual";
	return "local";
}

export function createFontFace(partial: Partial<FontFace> & { provider: string }): FontFace {
	const isGoogle = partial.provider === "google";
	return {
		weight: isGoogle ? GOOGLE_DEFAULT_WEIGHT : "400",
		style: isGoogle ? GOOGLE_DEFAULT_STYLE : "normal",
		display: "swap",
		subset: "latin",
		...partial,
	};
}

export function createFontSlot(
	partial: Partial<FontSlot> & { slot: string; family: string },
): FontSlot {
	// A slot with no explicit faces gets one face whose provider matches the
	// declared kind (google → "google", system → "system", else manual "").
	const defaultProvider =
		partial.kind === "google" ? "google" : partial.kind === "system" ? "system" : "";
	const faces =
		partial.faces && partial.faces.length > 0
			? partial.faces.map((f) => ({ ...f }))
			: [createFontFace({ provider: defaultProvider })];
	return {
		slot: partial.slot,
		family: partial.family,
		kind: partial.kind ?? kindFromProvider(faces[0].provider),
		fallback: [...(partial.fallback ?? [])],
		features: partial.features ?? null,
		variation: partial.variation ?? null,
		preload: partial.preload ?? false,
		faces,
		metricsFallback: partial.metricsFallback,
		sizeAdjust: partial.sizeAdjust,
		ascent: partial.ascent,
		descent: partial.descent,
		lineGap: partial.lineGap,
	};
}

// ---------------------------------------------------------------------------
// System Font Stacks
// ---------------------------------------------------------------------------

export const SYSTEM_STACKS: Readonly<Record<string, string>> = Object.freeze({
	sans: 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
	serif:
		'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
	mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
});

/**
 * Get the literal fallback stack for a slot.
 * Uses the known system stack for sans/serif/mono, falls back to sans.
 */
function getFallbackStack(slot: string): string {
	if (!SYSTEM_STACKS[slot] && isRIDebug()) {
		console.warn(`[RI-DEBUG] Unknown font slot "${slot}" — falling back to sans stack.`);
	}
	return SYSTEM_STACKS[slot] || SYSTEM_STACKS.sans;
}

// ---------------------------------------------------------------------------
// URL Generation
// ---------------------------------------------------------------------------

/**
 * Generate Google Fonts CSS API v2 URL for a family + face.
 */
export function googleFontsUrl(family: string, face: FontFace): string {
	const encodedFamily = encodeURIComponent(family).replace(/%20/g, "+");

	// Weight axis — exactly one axis param per URL. The comma check runs
	// first: "400, 700" is a weight list whose space would otherwise
	// misclassify it as a variable range.
	let axisParam: string;
	if (face.weight.includes(",")) {
		// Specific weights: "400,700" / "400, 700"
		const weights = face.weight.split(",").map((w) => w.trim());
		if (face.style.includes("italic")) {
			const tuples = weights.flatMap((w) => [`0,${w}`, `1,${w}`]);
			axisParam = `ital,wght@${tuples.join(";")}`;
		} else {
			axisParam = `wght@${weights.join(";")}`;
		}
	} else if (face.weight.includes(" ")) {
		// Variable weight range: "100 900"
		const range = face.weight.replace(" ", "..");
		axisParam = face.style.includes("italic") ? `ital,wght@0,${range};1,${range}` : `wght@${range}`;
	} else {
		const w = face.weight || "400";
		axisParam = face.style.includes("italic") ? `ital,wght@0,${w};1,${w}` : `wght@${w}`;
	}

	const display = face.display || "swap";
	const subset =
		face.subset && face.subset !== "latin" ? `&subset=${encodeURIComponent(face.subset)}` : "";
	return `https://fonts.googleapis.com/css2?family=${encodedFamily}:${axisParam}&display=${display}${subset}`;
}

// ---------------------------------------------------------------------------
// @font-face Generation
// ---------------------------------------------------------------------------

/** Escape characters in a font family name to prevent CSS string breakout.
 *  Handles backslashes, double quotes, newlines, and null bytes — the latter
 *  two are invalid inside CSS quoted strings and could break parsing if a
 *  malicious @font directive injects them. */
function escapeFontFamily(name: string): string {
	return name
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\0/g, "\\0")
		.replace(/\n/g, "\\a ")
		.replace(/\r/g, "\\d ");
}

/**
 * Generate the metrics-adjusted fallback @font-face block.
 */
export function generateFallbackFontFace(family: string, metrics: FontMetrics): string {
	const safeFamily = escapeFontFamily(family);
	return `@font-face {
  font-family: "${safeFamily} Fallback";
  src: local("${metrics.fallback}");
  size-adjust: ${metrics.sizeAdjust}%;
  ascent-override: ${metrics.ascent}%;
  descent-override: ${metrics.descent}%;
  line-gap-override: ${metrics.lineGap}%;
}`;
}

type FontFormat = "woff2" | "woff" | "truetype" | "opentype";

/** Format → IANA MIME type, for preload `type` attributes. */
const FONT_FORMAT_MIME = {
	woff2: "font/woff2",
	woff: "font/woff",
	truetype: "font/ttf",
	opentype: "font/otf",
} as const satisfies Record<FontFormat, string>;

/**
 * Infer font format from file extension.
 */
function inferFontFormat(path: string): FontFormat {
	if (path.endsWith(".woff2")) return "woff2";
	if (path.endsWith(".woff")) return "woff";
	if (path.endsWith(".ttf")) return "truetype";
	if (path.endsWith(".otf")) return "opentype";
	return "woff2";
}

/**
 * Generate the web font loading CSS for a single face.
 *
 * For Google faces, returns an @import rule that fetches the provider's CSS
 * stylesheet (which contains the real @font-face declarations).
 *
 * For local files / raw URLs, returns a @font-face block with a direct src
 * pointing to the font binary.
 */
export function generateWebFontFace(
	family: string,
	face: FontFace,
): { type: "import" | "font-face"; css: string } | null {
	if (face.provider === "system" || !face.provider) return null;

	// CDN providers return CSS stylesheets, not font binaries —
	// use @import to fetch their stylesheet which contains @font-face rules.
	// **CSP note:** This emits an @import with an external URL (fonts.googleapis.com).
	// Users with strict Content-Security-Policy headers must whitelist
	// `fonts.googleapis.com` in `style-src` and `fonts.gstatic.com` in `font-src`.
	// For CSP-strict environments, consider using a local font file or URL instead
	// of the "google" provider to avoid external requests.
	if (face.provider === "google") {
		return { type: "import", css: `@import url("${googleFontsUrl(family, face)}");` };
	}
	// Local file or URL — generate @font-face with direct src.
	// Escape characters that would break the CSS url("...") syntax.
	const safeProvider = face.provider.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	const format = inferFontFormat(face.provider);
	const src = `url("${safeProvider}") format("${format}")`;

	const declarations = [`  font-family: "${escapeFontFamily(family)}";`, `  src: ${src};`];

	if (face.weight) declarations.push(`  font-weight: ${face.weight};`);
	if (face.style && face.style !== "normal") declarations.push(`  font-style: ${face.style};`);
	if (face.display) declarations.push(`  font-display: ${face.display};`);
	if (face.unicodeRange) declarations.push(`  unicode-range: ${face.unicodeRange};`);

	return { type: "font-face", css: `@font-face {\n${declarations.join("\n")}\n}` };
}

// ---------------------------------------------------------------------------
// Full CSS Generation for a Font Slot
// ---------------------------------------------------------------------------

export interface FontOutput {
	imports: string[];
	fontFaces: string[];
	variables: string[];
	warnings: string[];
}

/** A local face's style must be a single valid descriptor — "normal italic" is a
 *  google-URL convention, not valid CSS. Detect the compound case (two keywords)
 *  while allowing oblique angle ranges like "oblique 0deg 14deg". */
function normalizeLocalStyle(style: string, family: string, warnings: string[]): string {
	if (style.includes(" ") && !style.startsWith("oblique")) {
		const first = style.split(/\s+/)[0];
		warnings.push(
			`[RI-1203] Local font "${family}" has a compound font-style "${style}" — a single @font-face takes one style. Split upright and italic into separate @face blocks (or use the italic: shorthand). Using "${first}".`,
		);
		return first;
	}
	return style;
}

/**
 * Generate all CSS for a single @font slot (one or more faces).
 */
export function generateFontCSS(slot: FontSlot): FontOutput {
	const imports: string[] = [];
	const fontFaces: string[] = [];
	const variables: string[] = [];
	const warnings: string[] = [];

	const pushFeatureVars = () => {
		if (slot.features) variables.push(`--font-${slot.slot}--features: ${slot.features};`);
		if (slot.variation) variables.push(`--font-${slot.slot}--variations: ${slot.variation};`);
	};

	if (slot.kind === "system") {
		// System stack — use the fallback var for known slots.
		variables.push(`--font-${slot.slot}: ${getFallbackStack(slot.slot)};`);
		return { imports, fontFaces, variables, warnings };
	}

	if (slot.kind === "manual") {
		// Manual font stack — no loading, just wire the variable.
		const stack = [`"${escapeFontFamily(slot.family)}"`, ...slot.fallback].join(", ");
		variables.push(`--font-${slot.slot}: ${stack};`);
		pushFeatureVars();
		return { imports, fontFaces, variables, warnings };
	}

	// Metrics-adjusted fallback @font-face (only when the user provides explicit metrics).
	const { sizeAdjust, ascent, descent, lineGap } = slot;
	const hasMetrics =
		sizeAdjust !== undefined &&
		ascent !== undefined &&
		descent !== undefined &&
		lineGap !== undefined;
	if (hasMetrics) {
		const metricsFallbackFont = slot.metricsFallback || slot.fallback[0] || "Arial";
		fontFaces.push(
			generateFallbackFontFace(slot.family, {
				fallback: metricsFallbackFont,
				sizeAdjust: sizeAdjust as number,
				ascent: ascent as number,
				descent: descent as number,
				lineGap: lineGap as number,
			}),
		);
	}

	// One @font-face (local) or @import (google) per face.
	for (const face of slot.faces) {
		if (
			face.provider !== "google" &&
			!face.provider.startsWith("/") &&
			!face.provider.startsWith("http") &&
			!face.provider.startsWith(".")
		) {
			warnings.push(
				`[RI-1201] Unknown font provider "${face.provider}" for "${slot.family}" — supported: google, or a file path/URL.`,
			);
			continue;
		}
		const emitFace =
			face.provider === "google"
				? face
				: { ...face, style: normalizeLocalStyle(face.style, slot.family, warnings) };
		const webFont = generateWebFontFace(slot.family, emitFace);
		if (!webFont) continue;
		if (webFont.type === "import") imports.push(webFont.css);
		else fontFaces.push(webFont.css);
	}

	// Font variable with fallback chain.
	const fallbackStack =
		slot.fallback.length > 0 ? slot.fallback.join(", ") : getFallbackStack(slot.slot);
	const safeFamily = escapeFontFamily(slot.family);
	const stackParts = [`"${safeFamily}"`];
	if (hasMetrics) stackParts.push(`"${safeFamily} Fallback"`);
	stackParts.push(fallbackStack);
	variables.push(`--font-${slot.slot}: ${stackParts.join(", ")};`);
	pushFeatureVars();

	return { imports, fontFaces, variables, warnings };
}

/**
 * Structured preload link data for font loading.
 */
export interface FontPreloadLink {
	href: string;
	as: "font";
	type: (typeof FONT_FORMAT_MIME)[FontFormat];
	crossorigin: true;
}

/**
 * Get preload links for font slots (for <link rel="preload">).
 * Returns structured objects for framework flexibility.
 */
export function getFontPreloadLinks(slots: readonly FontSlot[]): FontPreloadLink[] {
	const links: FontPreloadLink[] = [];
	const seen = new Set<string>();
	for (const slot of slots) {
		for (const face of slot.faces) {
			const preload = face.preload ?? slot.preload;
			if (!preload) continue;
			// Google Fonts returns CSS stylesheets, not font binaries — we can't
			// determine the actual .woff2 URL without fetching the CSS at build time,
			// so preload is only supported for local file / raw URL providers.
			if (face.provider === "system" || face.provider === "google" || !face.provider) continue;
			if (seen.has(face.provider)) continue;
			seen.add(face.provider);
			links.push({
				href: face.provider,
				as: "font",
				type: FONT_FORMAT_MIME[inferFontFormat(face.provider)],
				crossorigin: true,
			});
		}
	}
	return links;
}
