/**
 * Font model — the pure half of the font-providers barrel.
 *
 * Types and factories for font slots/faces, with no dependency on the Google
 * fetch/cache machinery (which uses node:crypto and node:fs). Kept in a leaf
 * module so directive parsing — and through it the `rainbowindex/editor`
 * entry and browser bundles — can construct font slots without a Node-only
 * import edge. `font-providers/index.ts` re-exports this module wholesale,
 * so existing importers are unaffected.
 */

/** Characters allowed in a font family name — the trust boundary shared by
 *  the @font directive parser (directives/parsers.ts) and the metadata cache
 *  loader (google/cache.ts). Provider-agnostic CSS-injection defense; lives
 *  in this pure leaf so directive parsing never imports the Google
 *  cache-state module. */
export const SAFE_FONT_FAMILY_CHARS = "a-zA-Z0-9 ._-";
export const SAFE_FONT_FAMILY_RE = new RegExp(`^[${SAFE_FONT_FAMILY_CHARS}]+$`);

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
	/** Optional unicode-range descriptor emitted into the @font-face (local subsetting). */
	unicodeRange?: string;
	/** Whether to emit a preload link for this face's font file. */
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
	/** One or more faces — each emits an @font-face for local providers. */
	faces: FontFace[];
	/**
	 * CLS-fallback metrics config from the `metrics:` key. Absent = automatic
	 * (from the built-in table when the family is known); `null` = disabled via
	 * `metrics: none`; an object overrides the fallback font and/or the numbers.
	 */
	metrics?: FontMetricsConfig | null;
}

/**
 * Parsed `metrics:` value. `fallback` picks the local font to metric-match.
 * The four override percentages are all-present or all-absent (the parser
 * enforces arity); when absent they are computed from the built-in table.
 */
export interface FontMetricsConfig {
	fallback?: string;
	sizeAdjust?: number;
	ascent?: number;
	descent?: number;
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
	const slot: FontSlot = {
		slot: partial.slot,
		family: partial.family,
		kind: partial.kind ?? kindFromProvider(faces[0].provider),
		fallback: [...(partial.fallback ?? [])],
		features: partial.features ?? null,
		variation: partial.variation ?? null,
		faces,
	};
	// Assigned conditionally so an unset config stays absent (not `undefined`) —
	// the assembly-level cache key JSON.stringifies whole slots.
	if (partial.metrics !== undefined) slot.metrics = partial.metrics;
	return slot;
}
