/**
 * Font loading system — @font directive processing, @font-face generation,
 * metrics-adjusted fallbacks for zero CLS.
 *
 * A slot (sans/serif/mono/custom) maps to one --font-<slot> variable and one
 * family name, but can own multiple faces — e.g. an upright + an italic file,
 * or split unicode ranges. Each FontFace emits one @font-face for local
 * providers; google/system/manual slots carry a single face.
 *
 * This file is the barrel over three layers, and which one you import from
 * decides what your bundle pulls in:
 *
 *   model.ts    types, slot/face factories, family-name safety — pure
 *   emit.ts     @font-face / @import / --font-* generation — pure
 *   google/     the metadata fetch and its on-disk cache — needs node:
 *
 * A browser-bound graph (`rainbowindex/editor`, `assembly.ts`) imports the
 * pure layers directly. Node consumers take the barrel and get everything.
 */

export type { GoogleFontMeta } from "./google/state.js";
export {
	fetchGoogleFontList,
	getGoogleFontMeta,
	isVariableFont,
	refreshFontWeightDefaults,
	resolveGoogleFonts,
} from "./google/index.js";

// The pure font model (types, slot/face factories, font-family safety
// constants) lives in model.ts so directive parsing and browser/editor
// bundles can import it without the Google fetch/cache machinery above.
// Re-exported wholesale for compat.
export * from "./model.js";
export { computeFallbackMetrics, lookupFontMetrics, resolveAutoMetrics } from "./metrics.js";

// Emission — pure, and the half `assembly.ts` takes on its own.
export * from "./emit.js";
