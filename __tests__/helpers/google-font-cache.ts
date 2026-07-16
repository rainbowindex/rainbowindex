import { googleFontInternals } from "../../src/integrations/font-providers/google/state.js";

export async function resetGoogleFontCacheForTests(): Promise<void> {
	if (googleFontInternals.googleFontListPromise) {
		await googleFontInternals.googleFontListPromise.catch(() => {});
	}
	googleFontInternals.googleFontState = { cache: new Map(), fetched: false };
	googleFontInternals.googleFontListPromise = null;
	googleFontInternals.lastFetchFailureMs = 0;
	googleFontInternals.validatedCacheDir = null;
	googleFontInternals.resolvedCachePath = null;
}
