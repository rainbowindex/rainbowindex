/**
 * A CSS entry's theme, in the wire form a client bundle reads.
 *
 * Both producers go through here — `rainbowindex generate-snapshot` and the
 * Vite plugin's virtual module — so the three steps that define what a snapshot
 * *is* are written once. Two spellings of the same pipeline is how the two
 * would come to publish different themes for the same stylesheet.
 *
 * Its own module rather than a function in `project/analyze.ts`: that one is
 * deliberately a leaf, and this needs the engine.
 */

import { createThemeSnapshot } from "../engine/index.js";
import { serializeSnapshot, type SerializedSnapshot } from "../merge/context.js";
import { analyzeProjectCSS } from "./analyze.js";

export function snapshotFromCSS(css: string): SerializedSnapshot {
	return serializeSnapshot(createThemeSnapshot(analyzeProjectCSS(css).theme));
}
