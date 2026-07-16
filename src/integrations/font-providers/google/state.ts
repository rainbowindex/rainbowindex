/** Characters allowed in a font family name — the trust boundary shared by
 *  the @font directive parser (directives/parsers.ts) and the metadata cache
 *  loader (cache.ts). */
export const SAFE_FONT_FAMILY_CHARS = "a-zA-Z0-9 ._-";
export const SAFE_FONT_FAMILY_RE = new RegExp(`^[${SAFE_FONT_FAMILY_CHARS}]+$`);

export interface GoogleFontMeta {
	family: string;
	variable: boolean;
	axes?: Array<{ tag: string; start: number; end: number }>;
	category: string;
}

export interface GoogleFontCacheState {
	readonly cache: Map<string, GoogleFontMeta>;
	readonly fetched: boolean;
}

export const googleFontInternals: {
	googleFontState: GoogleFontCacheState;
	googleFontListPromise: Promise<void> | null;
	lastFetchFailureMs: number;
	validatedCacheDir: string | null;
	resolvedCachePath: string | null;
} = {
	googleFontState: { cache: new Map(), fetched: false },
	googleFontListPromise: null,
	lastFetchFailureMs: 0,
	validatedCacheDir: null,
	resolvedCachePath: null,
};
