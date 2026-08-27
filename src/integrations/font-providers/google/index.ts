import type { ResolvedTheme } from "../../../directives/foundation.js";
import type { FontSlot } from "../index.js";
import { googleFontInternals, type GoogleFontCacheState, type GoogleFontMeta } from "./state.js";
import { getFontCacheFile, loadFontCache, saveFontCache } from "./cache.js";
import { fetchGoogleFontMetadata } from "./client.js";
import { isRIDebug, withTimeout } from "../../../shared.js";

const FETCH_RETRY_COOLDOWN_MS = 30_000;

export async function fetchGoogleFontList(): Promise<void> {
	if (googleFontInternals.googleFontState.fetched) return;
	if (googleFontInternals.googleFontListPromise) return googleFontInternals.googleFontListPromise;
	if (
		googleFontInternals.lastFetchFailureMs > 0 &&
		Date.now() - googleFontInternals.lastFetchFailureMs < FETCH_RETRY_COOLDOWN_MS
	) {
		return;
	}
	const localPromise = (async () => {
		try {
			const isOffline = process.env.RI_OFFLINE === "1" || process.env.RI_OFFLINE === "true";
			if (isOffline) {
				if (await loadFontCache(true)) return;
				console.warn(
					`[RI-1206] RI_OFFLINE is set but no local font cache found at ${getFontCacheFile()}. Run once with network access to populate it. Non-variable fonts will default to weight "100 900" and may produce broken Google Fonts URLs — set an explicit weight in the @font directive to avoid this.`,
				);
				return;
			}
			if (await loadFontCache()) return;
			const fetchDisabled =
				process.env.RI_FETCH_FONTS === "0" || process.env.RI_FETCH_FONTS === "false";
			if (fetchDisabled) {
				if (await loadFontCache(true)) return;
				return;
			}
			if (typeof globalThis.fetch !== "function") {
				console.warn(
					"[RI-1212] Global fetch() is not available. Google Fonts metadata requires Node.js >= 18. Skipping font fetch.",
				);
				return;
			}
			if (isRIDebug()) {
				console.warn("[RI-DEBUG] Fetching Google Fonts metadata...");
			}
			try {
				const newCache = await fetchGoogleFontMetadata();
				googleFontInternals.googleFontState = { cache: newCache, fetched: true };
				await saveFontCache();
				return;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (message.startsWith("[RI-1207]")) {
					console.warn(`${message} Skipping.`);
					if (await loadFontCache(true)) return;
					return;
				}
				if (await loadFontCache(true)) return;
				console.warn(
					`[RI-1205] Could not fetch Google Fonts metadata after 3 attempts (${message}). Fonts without explicit weight/style will default to "100 900" + "normal italic" — non-variable fonts may produce broken Google Fonts URLs. Run with network access to populate the metadata cache, or set an explicit weight/style in the @font directive.`,
				);
			}
		} finally {
			if (!googleFontInternals.googleFontState.fetched) {
				googleFontInternals.lastFetchFailureMs = Date.now();
			}
			googleFontInternals.googleFontListPromise = null;
		}
	})();
	googleFontInternals.googleFontListPromise = localPromise;
	return localPromise;
}

export function getGoogleFontMeta(family: string): GoogleFontMeta | undefined {
	return googleFontInternals.googleFontState.cache.get(family);
}

export function isVariableFont(family: string): boolean {
	return googleFontInternals.googleFontState.cache.get(family)?.variable ?? false;
}

/**
 * Narrow optimistic Google font defaults (weight "100 900", style "normal italic")
 * on each google slot's face(s) based on cached Google Fonts metadata. User-provided
 * values (flagged via `_weightExplicit` / `_styleExplicit` at directive-parse time)
 * are never touched.
 *
 * When metadata isn't loaded yet, slots are returned unchanged — the caller is
 * expected to invoke `fetchGoogleFontList()` before this runs.
 *
 * Identity contract: when no slot changes, the ORIGINAL array is returned, and
 * repeated calls with the same array + same metadata state return the same
 * output array. Watch rebuilds hand in the same (memoized) theme fonts every
 * build, so a stable output identity lets finalizeProjectCompilation keep the
 * effective theme object — and every theme-identity-keyed cache — alive.
 */
const refreshMemo = new WeakMap<
	readonly FontSlot[],
	{ state: GoogleFontCacheState; result: FontSlot[] }
>();

export function refreshFontWeightDefaults(fonts: readonly FontSlot[]): FontSlot[] {
	const state = googleFontInternals.googleFontState;
	const memo = refreshMemo.get(fonts);
	if (memo && memo.state === state) return memo.result;

	let anyChanged = false;
	const refreshed = fonts.map((slot) => {
		if (slot.kind !== "google") return slot;
		const meta = googleFontInternals.googleFontState.cache.get(slot.family);
		if (!meta) return slot;

		let changed = false;
		const faces = slot.faces.map((f) => {
			let next = f;

			if (!f._weightExplicit) {
				const wghtAxis = meta.axes?.find((a) => a.tag === "wght");
				const axisWeight =
					wghtAxis && wghtAxis.start !== wghtAxis.end ? `${wghtAxis.start} ${wghtAxis.end}` : "400";
				if (next.weight !== axisWeight) next = { ...next, weight: axisWeight };
			}

			if (!f._styleExplicit) {
				const italAxis = meta.axes?.find((a) => a.tag === "ital");
				const axisStyle = italAxis ? "normal italic" : "normal";
				if (next.style !== axisStyle) next = { ...next, style: axisStyle };
			}

			if (next !== f) changed = true;
			return next;
		});

		if (changed) anyChanged = true;
		return changed ? { ...slot, faces } : slot;
	});

	// The input is only readonly by annotation — every producer hands us a plain
	// mutable array — so returning it unchanged is safe.
	const result = anyChanged ? refreshed : (fonts as FontSlot[]);
	refreshMemo.set(fonts, { state, result });
	return result;
}

/** Cap how long any surface (CLI, PostCSS, compileProject) waits for Google
 *  Fonts metadata — the fetch retry ladder can otherwise stall a build on a
 *  slow network, and the surfaces must share one policy to stay byte-identical. */
const FONT_FETCH_TIMEOUT_MS = 10_000;

export async function resolveGoogleFonts(
	fonts: ResolvedTheme["fonts"],
): Promise<ResolvedTheme["fonts"]> {
	if (!fonts.some((slot) => slot.kind === "google")) return fonts;
	try {
		await withTimeout(
			fetchGoogleFontList(),
			FONT_FETCH_TIMEOUT_MS,
			"[RI-1213] Google Fonts metadata fetch timed out",
		);
	} catch {
		console.warn(
			`[RI-1213] Could not fetch Google Fonts metadata within ${FONT_FETCH_TIMEOUT_MS / 1000}s — proceeding with default font weights. Variable-weight fonts may use "400" instead of their full range.`,
		);
	}
	return refreshFontWeightDefaults(fonts);
}
