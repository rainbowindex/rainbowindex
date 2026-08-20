/**
 * analyzeMerge() — editor-only merge diagnostics.
 *
 * Explains ri()'s right-most-wins conflict resolution by threading a
 * MergeTrace through the shared merge loop. Split from merge/index.ts so the
 * browser-facing runtime file stays free of editor-only analysis; consumed by
 * editor/session.ts and the editor entry.
 */

import { mergeUncached, type MergeTrace } from "./index.js";
import { resolverFor, type CompilationSnapshot } from "./context.js";

export interface MergeDrop {
	index: number;
	className: string;
	/** Ascending indices of the surviving classes that together claimed every
	 *  CSS property this class sets (px-4 + py-4 jointly dominate p-2). */
	overriddenBy: number[];
}

export interface MergeAnalysis {
	/** The merged output — identical to ri()'s result for this token list. */
	output: string;
	/** Indices of surviving classes, ascending. */
	kept: number[];
	/** Dropped classes with attribution, ascending by index. */
	dropped: MergeDrop[];
}

/**
 * Explain ri()'s conflict resolution for a list of class tokens — which
 * classes the right-most-wins scan drops, and which survivors claimed their
 * properties. Powers "this class is overridden" editor diagnostics.
 *
 * Unlike ri(), the input is pre-tokenized: one class per element, no falsy
 * filtering, no whitespace splitting — exactly the token list an editor
 * extracts from one class attribute. `snapshot` binds custom utilities, text
 * sizes, and color names the same way createRi(snapshot) does (editors build
 * one with createThemeSnapshot()); without it, the module-level state of the
 * most recent compile applies. Uncached — call sites own their memoization.
 */
export function analyzeMerge(
	classes: readonly string[],
	snapshot?: CompilationSnapshot,
): MergeAnalysis {
	const resolve = resolverFor(snapshot);

	const trace: MergeTrace = { claimers: new Map(), dropped: [] };
	const output = mergeUncached(classes, resolve, trace);

	trace.dropped.sort((a, b) => a.index - b.index);
	const droppedIndexes = new Set(trace.dropped.map((d) => d.index));
	const kept: number[] = [];
	for (let i = 0; i < classes.length; i++) {
		if (!droppedIndexes.has(i)) kept.push(i);
	}
	return {
		output,
		kept,
		dropped: trace.dropped.map((d) => ({
			index: d.index,
			className: classes[d.index],
			overriddenBy: d.overriddenBy,
		})),
	};
}
