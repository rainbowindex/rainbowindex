// The font-family safety constants live in the pure model leaf (model.ts) so
// directive parsing never imports this mutable cache-state module — the
// editor/browser graphs must stay structurally free of the Node-touching
// machinery this state serves. Re-exported for the cache loader's convenience.
export { SAFE_FONT_FAMILY_CHARS, SAFE_FONT_FAMILY_RE } from "../model.js";

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
