/**
 * One sort, for everything that orders class names.
 *
 * A "sort classes" command in an editor, a formatter plugin, and a CLI
 * codemod all have to agree, and the only way to guarantee that is for all
 * three to call the same function. The order is the one the emitted CSS uses:
 * `sortKey` first, then the same codepoint tie-break `compile()` applies to
 * rules, so reading a sorted class attribute tells you what the cascade will
 * do — including which of two conflicting classes actually wins.
 *
 * **A class list that reaches `ri()` must not be sorted.** `ri()` is
 * right-most-wins over its arguments, so reordering changes the result. This
 * is for a static class attribute, where the CSS decides and the attribute's
 * order carries no meaning at all.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import { createClassInspector, type ClassInspector } from "../engine/inspector.js";
import { codepointCompare } from "../shared.js";

interface SortEntry {
	className: string;
	sortKey: number;
	selector: string;
}

/**
 * Sort with an inspector already in hand. A session owns one per theme, and
 * the resolution cache inside it is what makes per-keystroke sorting cheap.
 */
export function sortClassesWithInspector(
	inspector: ClassInspector,
	classes: readonly string[],
): string[] {
	// Anything the compiler will not emit a rule for goes first, in the order
	// it was written: a custom class, a CSS-module name, or a typo has no place
	// in the cascade, and moving it would lose the only ordering it has.
	const unknown: string[] = [];
	const known: SortEntry[] = [];
	for (const className of classes) {
		const explanation = inspector.explain(className);
		if (explanation === null) {
			unknown.push(className);
			continue;
		}
		known.push({ className, sortKey: explanation.sortKey, selector: explanation.selector });
	}
	// The compile loop's comparator, minus its third key: two distinct classes
	// cannot share a selector, so `compile()`'s final compare on rule text has
	// nothing here to discriminate. What is left — equal key *and* equal
	// selector — is the same class written twice, and `Array#sort` has been
	// specified stable since ES2019, so those keep the order they came in.
	known.sort((a, b) => a.sortKey - b.sortKey || codepointCompare(a.selector, b.selector));
	const out = unknown;
	for (const entry of known) out.push(entry.className);
	return out;
}

/**
 * Per-theme inspector memo. Callers that sort on every keystroke pass the same
 * theme object each time; building a fresh inspector — and with it a fresh
 * variant map, breakpoint table and resolution cache — would throw that work
 * away between calls. Keyed weakly, so a replaced theme is collectable.
 */
const inspectorMemo = new WeakMap<ResolvedTheme, ClassInspector>();

/**
 * Order `classes` the way the generated stylesheet orders their rules.
 *
 * Unresolvable classes come first, in their original order; everything else
 * follows in emission order. Duplicates are kept — dropping a class silently
 * is never the right answer for a formatter — and the result is a new array.
 *
 * Variant groups (`hover:{underline font-bold}`) are one token here, and one
 * token is all a sort can move. Expand them with `expandVariantGroups` first
 * if the members should be ordered individually.
 */
export function sortClasses(theme: ResolvedTheme, classes: readonly string[]): string[] {
	let inspector = inspectorMemo.get(theme);
	if (inspector === undefined) {
		inspector = createClassInspector(theme);
		inspectorMemo.set(theme, inspector);
	}
	return sortClassesWithInspector(inspector, classes);
}
