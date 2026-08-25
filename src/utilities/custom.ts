/**
 * Custom @utility subsystem: cached name lookup, the character-level body
 * parser, per-block @apply expansion, and root-info extraction for `ri()`
 * conflict registration.
 *
 * Leaf module in the sense of the layering rule documented in helpers.ts —
 * it imports only parser.js, helpers.js, and the directives layer. The
 * built-in resolver is injected by index.ts at the single resolveCustomUtility
 * call site, so the mutual recursion (custom bodies may @apply built-ins;
 * resolveUtility falls back to custom utilities) never becomes a module cycle.
 */

import type { CustomUtility, ResolvedTheme } from "../directives/foundation.js";
import { APPLY_LIKE_MATCH_RE, hasApplyLikeDirective } from "../directives/apply-aliases.js";
import { parseUtility } from "./parser.js";
import type { CSSDeclaration, UtilityNestedBlock, UtilityResult } from "./helpers.js";

/** Signature of the injected built-in resolver — exactly resolveUtility's. */
export type ResolveUtilityFn = (
	utility: string,
	value: string | null,
	negative: boolean,
	theme: ResolvedTheme,
	warnings?: string[],
	visiting?: Set<string>,
	dataType?: string | null,
) => UtilityResult | null;

const customUtilityMapCache = new WeakMap<ResolvedTheme, Map<string, CustomUtility>>();

/** Cached name → CustomUtility lookup (also used by the PostCSS @apply layer). */
export function getCustomUtility(theme: ResolvedTheme, name: string): CustomUtility | undefined {
	return getCustomUtilityMap(theme).get(name);
}

function getCustomUtilityMap(theme: ResolvedTheme): Map<string, CustomUtility> {
	let map = customUtilityMapCache.get(theme);
	if (!map) {
		map = new Map();
		for (const cu of theme.customUtilities) {
			// Theme objects are deep-frozen by the resolver, so the entries can be
			// stored directly instead of cloned.
			map.set(cu.name, cu);
		}
		customUtilityMapCache.set(theme, map);
	}
	return map;
}

/** One level of a parsed custom-utility body: declarations and @apply classes
 *  at this level, plus nested rule/at-rule blocks. `selector` is "" at the root. */
interface CustomUtilityBodyNode {
	selector: string;
	declarations: CSSDeclaration[];
	applyClasses: string[];
	nested: CustomUtilityBodyNode[];
}

/** Collapses authored whitespace runs in nested-block preludes (g-flagged is
 *  safe with String#replace — it never reads or leaves a lastIndex). */
const SELECTOR_WS_COLLAPSE_RE = /\s+/g;

/**
 * Parse a custom utility body into a rule tree: top-level declarations plus
 * nested blocks (selectors or at-rules) with their own declarations, recursively.
 * `@apply`/`@a` classes are collected per level so expansion lands in the block
 * that declared them. Comments were already stripped at directive-parse time.
 * Quoted strings and parenthesized groups are opaque, so `{};` inside
 * `[data-x="{a;b}"]` or `url(...)` never terminate a segment.
 */
function parseCustomUtilityBody(body: string): CustomUtilityBodyNode {
	const root: CustomUtilityBodyNode = {
		selector: "",
		declarations: [],
		applyClasses: [],
		nested: [],
	};
	const stack: CustomUtilityBodyNode[] = [root];
	let start = 0;
	let parens = 0;

	const flushStatement = (end: number): void => {
		const segment = body.slice(start, end).trim();
		if (!segment) return;
		const current = stack[stack.length - 1];
		if (segment.charCodeAt(0) === 64 /* @ */) {
			// @apply/@a statements collect classes; other at-statements are skipped.
			for (const m of segment.matchAll(APPLY_LIKE_MATCH_RE)) {
				for (const cls of m[1].trim().split(APPLY_CLASS_SPLIT_RE)) {
					if (cls) current.applyClasses.push(cls);
				}
			}
			return;
		}
		const colonIdx = segment.indexOf(":");
		if (colonIdx === -1) return;
		const property = segment.slice(0, colonIdx).trim();
		const value = segment.slice(colonIdx + 1).trim();
		if (property && value) current.declarations.push({ property, value });
	};

	for (let i = 0; i < body.length; i++) {
		const ch = body.charCodeAt(i);
		if (ch === 34 /* " */ || ch === 39 /* ' */) {
			i++;
			while (i < body.length) {
				const c = body.charCodeAt(i);
				if (c === 92 /* \ */) {
					i++;
				} else if (c === ch) {
					break;
				}
				i++;
			}
			continue;
		}
		if (ch === 40 /* ( */) {
			parens++;
			continue;
		}
		if (ch === 41 /* ) */) {
			if (parens > 0) parens--;
			continue;
		}
		if (parens > 0) continue;
		if (ch === 59 /* ; */) {
			flushStatement(i);
			start = i + 1;
			continue;
		}
		if (ch === 123 /* { */) {
			const selector = body.slice(start, i).trim().replace(SELECTOR_WS_COLLAPSE_RE, " ");
			const node: CustomUtilityBodyNode = {
				selector,
				declarations: [],
				applyClasses: [],
				nested: [],
			};
			// An empty prelude is malformed — parse the block but drop its contents.
			if (selector) stack[stack.length - 1].nested.push(node);
			stack.push(node);
			start = i + 1;
			continue;
		}
		if (ch === 125 /* } */) {
			flushStatement(i);
			if (stack.length > 1) stack.pop();
			start = i + 1;
		}
	}
	flushStatement(body.length);

	return root;
}

/**
 * Parsed-body cache keyed by body text. The parse is pure per body (CustomUtility
 * objects are deep-frozen by the resolver), so `card` / `hover:card` / `md:card`
 * and the per-pass root-info extraction share one tree within a compile — and
 * across watch rebuilds, whose fresh themes carry equal body text. Keyed by the
 * string rather than the CustomUtility object because extractCustomUtilityRootInfo
 * only receives the body. Cached trees are treated as immutable by both readers:
 * they copy any array they mutate or return, so no caller ever holds a reference
 * into the cached tree's containers (shared leaf CSSDeclaration objects are fine —
 * nothing writes to them).
 */
const parsedBodyCache = new Map<string, CustomUtilityBodyNode>();
const PARSED_BODY_CACHE_MAX = 500;

function getParsedBody(body: string): CustomUtilityBodyNode {
	let tree = parsedBodyCache.get(body);
	if (!tree) {
		// ponytail: clear-on-cap eviction; upgrade to LRU if body churn ever matters.
		if (parsedBodyCache.size >= PARSED_BODY_CACHE_MAX) parsedBodyCache.clear();
		tree = parseCustomUtilityBody(body);
		parsedBodyCache.set(body, tree);
	}
	return tree;
}

/** Maximum recursion depth for nested @apply inside custom utilities. */
const MAX_CUSTOM_APPLY_DEPTH = 5;

const APPLY_CLASS_SPLIT_RE = /\s+/;

/**
 * Visit every class token of every `@apply`-like directive in a custom-utility
 * body, at any nesting depth. Used only by the PostCSS warning-only walk
 * (checkCustomApplyWarnings in apply.ts) — declaration expansion is per-block
 * via the parsed body tree, so this flat walk must never emit declarations.
 */
export function forEachApplyClass(body: string, visit: (cls: string) => void): void {
	for (const m of body.matchAll(APPLY_LIKE_MATCH_RE)) {
		for (const cls of m[1].trim().split(APPLY_CLASS_SPLIT_RE)) {
			if (cls) visit(cls);
		}
	}
}

/** Resolve one level's @apply classes into `outDecls`/`outNested`. Nested blocks
 *  returned by inner custom utilities nest under the level that applied them. */
function expandApplyClasses(
	classes: string[],
	theme: ResolvedTheme,
	visited: Set<string>,
	outDecls: CSSDeclaration[],
	outNested: UtilityNestedBlock[],
	resolve: ResolveUtilityFn,
): void {
	for (const cls of classes) {
		const parsed = parseUtility(cls);
		const inner = resolve(
			parsed.utility,
			parsed.value,
			parsed.negative,
			theme,
			undefined,
			visited,
			parsed.dataType ?? null,
		);
		if (!inner) continue;
		outDecls.push(...inner.declarations);
		if (inner.nested) outNested.push(...inner.nested);
	}
}

/** Build an emission-ready nested block from a parsed body node. `expansion` is
 *  the active @apply visited set, or null when expansion is suppressed (no
 *  directives, circular reference, or depth limit). Blocks that end up with no
 *  declarations and no children are pruned (returns null). */
function buildNestedBlock(
	node: CustomUtilityBodyNode,
	theme: ResolvedTheme,
	expansion: Set<string> | null,
	resolve: ResolveUtilityFn,
): UtilityNestedBlock | null {
	const declarations = [...node.declarations];
	const nested: UtilityNestedBlock[] = [];
	if (expansion) {
		expandApplyClasses(node.applyClasses, theme, expansion, declarations, nested, resolve);
	}
	for (const child of node.nested) {
		const block = buildNestedBlock(child, theme, expansion, resolve);
		if (block) nested.push(block);
	}
	if (declarations.length === 0 && nested.length === 0) return null;
	return { selector: node.selector, declarations, nested };
}

export function resolveCustomUtility(
	utility: string,
	value: string | null,
	theme: ResolvedTheme,
	resolve: ResolveUtilityFn,
	visiting?: Set<string>,
): UtilityResult | null {
	const map = getCustomUtilityMap(theme);

	// A custom utility matches a class by its exact name only: the bare name when
	// the class carries no value (`card`), or the reconstructed `utility-value`
	// when it does (`pg-mg` parsed as utility="pg" value="mg"). Matching the bare
	// name while a value is present would let a static custom utility named `min-h`
	// swallow `min-h-<value>` classes that belong to the built-in `min-h-*` family.
	const cu = value === null ? map.get(utility) : map.get(`${utility}-${value}`);

	if (!cu || cu.functional) return null;

	const tree = getParsedBody(cu.body);

	// Expand @apply directives (per block) so className usage produces the same
	// CSS as the PostCSS @apply path. Cycles and over-depth chains suppress
	// expansion *silently* — raw declarations still resolve; the [RI-1005]
	// warnings are owned by the PostCSS walk (checkCustomApplyWarnings).
	let expansion: Set<string> | null = null;
	if (hasApplyLikeDirective(cu.body)) {
		const visited = visiting ?? new Set<string>();
		if (!visited.has(cu.name) && visited.size < MAX_CUSTOM_APPLY_DEPTH) {
			visited.add(cu.name);
			expansion = visited;
		}
	}

	const declarations = [...tree.declarations];
	const nested: UtilityNestedBlock[] = [];
	// Root @apply expansion runs before the authored nested blocks are built, so
	// blocks inherited from applied utilities sort first and the author's own
	// blocks win the cascade on conflict.
	if (expansion) {
		expandApplyClasses(tree.applyClasses, theme, expansion, declarations, nested, resolve);
	}
	for (const child of tree.nested) {
		const block = buildNestedBlock(child, theme, expansion, resolve);
		if (block) nested.push(block);
	}
	if (expansion) expansion.delete(cu.name);

	if (declarations.length === 0 && nested.length === 0) return null;
	if (nested.length === 0) return { declarations };

	return { declarations, nested };
}

/**
 * Root-level info for `ri()` conflict registration: the properties and @apply
 * classes that style the utility's own element. Nested blocks style descendants
 * or other states, so their properties must NOT participate in root conflict
 * resolution — a custom utility that rings a child on focus does not conflict
 * with `ring-*` on the element itself.
 */
export function extractCustomUtilityRootInfo(body: string): {
	properties: string[];
	applyClasses: string[];
} {
	const tree = getParsedBody(body);
	const seen = new Set<string>();
	const properties: string[] = [];
	for (const d of tree.declarations) {
		if (!d.property.startsWith("--") && !seen.has(d.property)) {
			seen.add(d.property);
			properties.push(d.property);
		}
	}
	// Copy: returning the cached tree's array would let a caller's push/sort
	// poison every later resolution of the same body.
	return { properties, applyClasses: [...tree.applyClasses] };
}
