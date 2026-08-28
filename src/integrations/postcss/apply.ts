import postcss, { type AtRule, type ChildNode, type Node, type Root, type Rule } from "postcss";
import { parseUtility } from "../../utilities/parser.js";
import {
	resolveUtilityDeclarations,
	forEachApplyClass,
	matchCustomUtility,
} from "../../utilities/index.js";
import type { CSSDeclaration, UtilityNestedBlock } from "../../utilities/helpers.js";
import { resolveVariant, type VariantWrapper } from "../../engine/index.js";
import { computeSortKey } from "../../engine/ordering.js";
import { applyVariantWrappers, splitSelectorList } from "../../engine/variants.js";
import { expandVariantGroups } from "../../scanner/class-extraction.js";
import type { ResolvedTheme } from "../../directives/foundation.js";

interface ResolvedDecl {
	declarations: CSSDeclaration[];
	important: boolean;
	nestedSelector?: string;
	/** Nested rule blocks from a custom @utility body — emitted as native CSS nesting. */
	nested?: UtilityNestedBlock[];
	variants: VariantWrapper[];
}

/** A nested block paired with the importance of the class that produced it. */
interface NestedBlockEntry {
	block: UtilityNestedBlock;
	important: boolean;
}

/**
 * Memo for resolveClassName. Duplicate classes across @apply rules (flex,
 * px-4, …) resolve identically — theme and customVariantMap are constant per
 * theme and downstream only reads the cached structures. Warnings emitted
 * during resolution are cached and replayed on every hit so per-occurrence
 * diagnostics survive; the plugin dedupes them downstream.
 */
interface ResolveCacheEntry {
	result: ResolvedDecl | null;
	warnings: string[];
}

/**
 * Cross-rebuild @apply state, keyed on theme identity. The scan analysis and
 * pipeline theme memos keep the ResolvedTheme object stable across rebuilds,
 * so cached resolutions stay valid until the theme actually changes — and the
 * WeakMap entry dies with the old theme object.
 */
interface ApplyThemeState {
	customVariantMap: ReadonlyMap<string, { name: string; selector: string }>;
	/** [RI-1005] warnings from the top-level body walk, per custom-utility name. */
	applyRootWarnings: Map<string, string[]>;
	resolveCache: Map<string, ResolveCacheEntry>;
}

const applyStateByTheme = new WeakMap<ResolvedTheme, ApplyThemeState>();

/**
 * One source class's declarations, tagged with the sort key that engine/ordering.ts
 * would assign to the same utility as a standalone rule. Groups are stable-sorted
 * by sortKey so @apply preserves the cross-class cascade order that standalone
 * utilities have.
 */
interface DeclGroup {
	sortKey: number;
	decls: Array<{ decl: CSSDeclaration; important: boolean }>;
}

function makeDeclGroup(r: ResolvedDecl): DeclGroup {
	// Variants are handled by bucket key, so computeSortKey is called with no
	// variants and the key is the property group alone — the same value the
	// engine assigns the utility as a standalone rule.
	const sortKey = computeSortKey(r.declarations[0]?.property ?? "");
	return {
		sortKey,
		decls: r.declarations.map((d) => ({ decl: d, important: r.important })),
	};
}

function flattenGroups(groups: DeclGroup[]): Array<{ decl: CSSDeclaration; important: boolean }> {
	// Array.prototype.sort is stable (ES2019+), so groups with equal sortKey
	// preserve insertion order — matching how standalone utility rules sort.
	const sorted = [...groups].sort((a, b) => a.sortKey - b.sortKey);
	const out: Array<{ decl: CSSDeclaration; important: boolean }> = [];
	for (const g of sorted) out.push(...g.decls);
	return out;
}

import { APPLY_ALIASES, hasApplyLikeDirective } from "../../directives/index.js";

const MAX_APPLY_DEPTH = 5;
const MAX_APPLY_CLASSES = 500;

/** Copy `from`'s source position onto a freshly built node, when it has one. */
function applySource<T extends Node>(node: T, from: Node): T {
	if (from.source) node.source = from.source;
	return node;
}

// ---------------------------------------------------------------------------
// Group root tracking for CSS nesting
// ---------------------------------------------------------------------------

/** Pattern matching group variant selector suffix: ".group<pseudo> &" */
const GROUP_VARIANT_RE = /^\.group(.+) &$/;

// Group roots (rules containing `@apply group`) are collected inside
// processApply's single walk — see classListByNode there.

/**
 * Walk up the CSS nesting tree from `startRule` to find an ancestor that is a
 * group root. Returns the group root's fully-resolved selector so that prefix
 * stripping against a descendant's full selector works even when the group
 * root itself is nested inside other rules.
 */
function findGroupAncestor(
	startRule: Rule,
	groupRoots: ReadonlySet<Rule>,
): { groupRootSelector: string } | null {
	// Check if the rule itself is the group root (group-hover in same rule as group)
	if (groupRoots.has(startRule)) {
		return { groupRootSelector: resolveFullNestingSelector(startRule) };
	}

	let current: import("postcss").Container | import("postcss").Document | undefined =
		startRule.parent;
	while (current) {
		if (current.type === "rule") {
			const rule = current as Rule;
			if (groupRoots.has(rule)) {
				return { groupRootSelector: resolveFullNestingSelector(rule) };
			}
		}
		current = current.parent;
	}
	return null;
}

/**
 * Compose an array of selectors (outermost → innermost) into a single
 * fully-resolved selector, resolving CSS nesting `&` references along the way.
 * Selectors containing `&` have it replaced with the composed parent selector;
 * selectors without `&` are joined as descendant combinators.
 *
 * Comma-separated selector lists are expanded so that each branch is composed
 * independently, e.g. `["h1, h2", "&:hover"]` → `"h1:hover, h2:hover"`.
 */
function composeNestedSelectors(parts: string[]): string {
	if (parts.length === 0) return "";
	// Start with each branch of the outermost selector
	let branches = splitSelectorList(parts[0]);
	for (let i = 1; i < parts.length; i++) {
		const childBranches = splitSelectorList(parts[i]);
		const next: string[] = [];
		for (const parent of branches) {
			for (const child of childBranches) {
				if (child.includes("&")) {
					next.push(child.replace(/&/g, parent));
				} else {
					next.push(`${parent} ${child}`);
				}
			}
		}
		branches = next;
	}
	return branches.join(", ");
}

/**
 * Walk up the CSS nesting tree and compose the fully-resolved selector for a rule.
 * E.g. for `&:not([data-active])` nested inside `a` inside `nav` inside
 * `[data-slot="sidebar"]`, returns `[data-slot="sidebar"] nav a:not([data-active])`.
 *
 * Resolves CSS nesting `&` references so the returned selector is valid at the
 * document root (no unresolved `&` characters).
 */
function resolveFullNestingSelector(rule: Rule): string {
	const parts: string[] = [rule.selector];
	let current: import("postcss").Container | import("postcss").Document | undefined = rule.parent;
	while (current) {
		if (current.type === "rule") {
			parts.unshift((current as Rule).selector);
		}
		current = current.parent;
	}
	return composeNestedSelectors(parts);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function processApply(root: Root, theme: ResolvedTheme, warnings: string[]): void {
	// Normalize @apply aliases before processing.
	for (const alias of APPLY_ALIASES) {
		root.walkAtRules(alias, (atRule) => {
			atRule.name = "apply";
		});
	}

	let state = applyStateByTheme.get(theme);
	if (!state) {
		state = {
			customVariantMap: new Map(theme.customVariants.map((cv) => [cv.name, cv])),
			applyRootWarnings: new Map(),
			resolveCache: new Map(),
		};
		applyStateByTheme.set(theme, state);
	}
	const { customVariantMap, applyRootWarnings, resolveCache } = state;

	for (let depth = 0; depth < MAX_APPLY_DEPTH; depth++) {
		// One walk collects the nodes, their expanded class lists, and the group
		// roots (`@apply group`) — re-collected each iteration so dynamically
		// generated roots from prior expansions are detected.
		const applyNodes: AtRule[] = [];
		const classListByNode = new Map<AtRule, string[]>();
		const groupRoots = new Set<Rule>();
		root.walkAtRules("apply", (atRule) => {
			applyNodes.push(atRule);
			const params = expandVariantGroups(atRule.params, warnings);
			const classNames = params.trim().split(/\s+/).filter(Boolean);
			classListByNode.set(atRule, classNames);
			if (classNames.includes("group")) {
				const parent = atRule.parent;
				if (parent && parent.type === "rule") {
					groupRoots.add(parent as Rule);
				}
			}
		});

		if (applyNodes.length === 0) break;

		for (const atRule of applyNodes) {
			expandApply(
				atRule,
				classListByNode.get(atRule) ?? [],
				theme,
				warnings,
				customVariantMap,
				groupRoots,
				applyRootWarnings,
				resolveCache,
			);
		}
	}

	const remaining: AtRule[] = [];
	root.walkAtRules("apply", (atRule) => {
		remaining.push(atRule);
	});
	if (remaining.length > 0) {
		warnings.push(
			`[RI-1006] @apply recursion depth limit reached (${MAX_APPLY_DEPTH}). ${remaining.length} remaining @apply directive(s) will not be expanded.`,
		);
		for (const atRule of remaining) {
			atRule.remove();
		}
	}
}

function expandApply(
	atRule: AtRule,
	// Pre-expanded by processApply's collection walk — never re-expand here.
	classNames: readonly string[],
	theme: ResolvedTheme,
	warnings: string[],
	customVariantMap: ReadonlyMap<string, { name: string; selector: string }>,
	groupRoots: ReadonlySet<Rule>,
	applyRootWarnings: Map<string, string[]>,
	resolveCache: Map<string, ResolveCacheEntry>,
): void {
	const parentRule = atRule.parent;
	if (parentRule?.type !== "rule") {
		warnings.push("[RI-1006] @apply must be used inside a CSS rule, not at the top level.");
		atRule.remove();
		return;
	}

	const baseSelector = (parentRule as Rule).selector;
	const parentContainer = parentRule.parent;
	if (!parentContainer) {
		atRule.remove();
		return;
	}

	if (classNames.length > MAX_APPLY_CLASSES) {
		warnings.push(
			`[RI-1006] @apply contains ${classNames.length} classes (limit: ${MAX_APPLY_CLASSES}). Split into multiple @apply directives or reduce class count.`,
		);
		atRule.remove();
		return;
	}

	const resolved: ResolvedDecl[] = [];
	for (const className of classNames) {
		let entry = resolveCache.get(className);
		if (!entry) {
			const entryWarnings: string[] = [];
			entry = {
				result: resolveClassName(
					className,
					theme,
					entryWarnings,
					customVariantMap,
					applyRootWarnings,
				),
				warnings: entryWarnings,
			};
			resolveCache.set(className, entry);
		}
		warnings.push(...entry.warnings);
		if (entry.result) resolved.push(entry.result);
	}

	// Each "group" is the declarations from one class in the @apply directive.
	// Within a group, declaration order matches the utility generator's output.
	// Groups are stable-sorted by property-group weight (same as standalone rules in
	// engine/ordering.ts) so that e.g. via-* — whose primary property `--ri-gradient-via`
	// has a heavier weight than `--ri-gradient-from/to` — emits its 3-stop
	// `--ri-gradient-stops` declaration AFTER the 2-stop ones, winning the cascade
	// regardless of the order classes were listed in the @apply directive.
	const baseGroups: DeclGroup[] = [];
	const baseNestedBlocks: NestedBlockEntry[] = [];
	const nestedGroups = new Map<string, DeclGroup[]>();
	const variantBuckets = new Map<
		string,
		{
			wrappers: VariantWrapper[];
			nestedSelector?: string;
			groups: DeclGroup[];
			nestedBlocks: NestedBlockEntry[];
		}
	>();

	for (const r of resolved) {
		const hasVariants = r.variants.length > 0;
		const hasNested = !!r.nestedSelector;
		const group = makeDeclGroup(r);

		if (!hasVariants && !hasNested) {
			baseGroups.push(group);
			// nestedSelector comes only from built-ins (divide-*/space-*), which never
			// carry custom nested blocks — so r.nested needs no handling on that path.
			if (r.nested) {
				for (const block of r.nested) baseNestedBlocks.push({ block, important: r.important });
			}
		} else if (!hasVariants && hasNested) {
			const key = r.nestedSelector;
			if (!key) continue;
			let list = nestedGroups.get(key);
			if (!list) {
				list = [];
				nestedGroups.set(key, list);
			}
			list.push(group);
		} else {
			const key = variantKey(r.variants, r.nestedSelector);
			let bucket = variantBuckets.get(key);
			if (!bucket) {
				bucket = {
					wrappers: r.variants,
					nestedSelector: r.nestedSelector,
					groups: [],
					nestedBlocks: [],
				};
				variantBuckets.set(key, bucket);
			}
			bucket.groups.push(group);
			if (r.nested) {
				for (const block of r.nested) bucket.nestedBlocks.push({ block, important: r.important });
			}
		}
	}

	for (const { decl, important } of flattenGroups(baseGroups)) {
		const node = applySource(
			postcss.decl({
				prop: decl.property,
				value: decl.value,
				important,
			}),
			atRule,
		);
		atRule.before(node);
	}
	// Custom-utility nested blocks land inside the parent rule as native CSS
	// nesting, at the @apply position — after the flat declarations above.
	for (const { block, important } of baseNestedBlocks) {
		atRule.before(buildNestedBlockNode(block, atRule, important));
	}

	let insertAfter: ChildNode = parentRule as Rule;
	for (const [nestedSel, groups] of nestedGroups) {
		const sel = nestedSel.replaceAll("&", baseSelector);
		const rule = applySource(postcss.rule({ selector: sel }), parentRule);
		for (const { decl, important } of flattenGroups(groups)) {
			rule.append(
				applySource(postcss.decl({ prop: decl.property, value: decl.value, important }), atRule),
			);
		}
		parentContainer.insertAfter(insertAfter, rule);
		insertAfter = rule;
	}

	// Pre-compute group variant info for each bucket (avoids redundant tree walks).
	// Loop-invariant lookups, computed at most once across all buckets.
	let fullSelectorMemo: string | null = null;
	const fullNestingSelector = () => {
		if (fullSelectorMemo === null)
			fullSelectorMemo = resolveFullNestingSelector(parentRule as Rule);
		return fullSelectorMemo;
	};

	// When any bucket uses group-* variants, all variant rules must be emitted at
	// the document root with fully-resolved selectors so that source order
	// (not nesting position) determines the cascade winner.
	const groupInfoByKey = new Map<string, ReturnType<typeof resolveGroupVariantInfo>>();
	let hasGroupVariants = false;
	for (const [key, bucket] of variantBuckets) {
		const info = resolveGroupVariantInfo(
			bucket.wrappers,
			parentRule as Rule,
			groupRoots,
			fullNestingSelector,
		);
		groupInfoByKey.set(key, info);
		if (info) hasGroupVariants = true;
	}

	let docRootMemo: Root | null = null;
	const docRoot = () => {
		if (docRootMemo === null) docRootMemo = parentContainer.root();
		return docRootMemo;
	};

	for (const [key, bucket] of variantBuckets) {
		const groupVariantInfo = groupInfoByKey.get(key) ?? null;

		const bucketDecls = flattenGroups(bucket.groups);

		if (groupVariantInfo) {
			// Group variant in CSS nesting context: rewrite selector and insert at root.
			// We must use a fully-resolved base selector (no unresolved `&` chars)
			// because the rule is emitted at the document root where `&` has no context.
			const fullSelector = fullNestingSelector();
			const { groupRootSelector } = groupVariantInfo;
			// Extract the descendant portion by stripping the group root prefix
			// from each branch of the fully-resolved selector.
			// fullSelector = "[data-slot='sidebar'] nav a:not([data-active])"
			// groupRootSelector = "[data-slot='sidebar']"
			// effectiveBase = "nav a:not([data-active])"
			// Stripping is skipped when the rule IS the group root: every branch
			// would strip to nothing, leaving an empty selector. The rewritten
			// wrappers already carry `&<pseudo>`, so the element is the base.
			const rootBranches = groupVariantInfo.isSelf ? [] : splitSelectorList(groupRootSelector);
			const fullBranches = splitSelectorList(fullSelector);
			const baseBranches: string[] = [];
			for (const fb of fullBranches) {
				let stripped = false;
				for (const rb of rootBranches) {
					if (fb.startsWith(rb)) {
						const after = fb.slice(rb.length);
						baseBranches.push(after.startsWith(" ") ? after.slice(1) : after);
						stripped = true;
						break;
					}
				}
				if (!stripped) baseBranches.push(fb);
			}
			// Deduplicate branches (comma expansion may produce identical paths)
			const effectiveBase = [...new Set(baseBranches)].join(", ");
			const node = buildVariantNode(
				effectiveBase,
				groupVariantInfo.rewrittenWrappers,
				bucketDecls,
				atRule,
				bucket.nestedSelector,
				bucket.nestedBlocks,
			);
			if (node) {
				docRoot().append(node);
			}
		} else if (hasGroupVariants) {
			// Non-group variant that is a peer of group variants in the same @apply.
			// Emit at document root with fully-resolved selector so both group and
			// non-group rules share the same cascade layer and source order wins.
			const node = buildVariantNode(
				fullNestingSelector(),
				bucket.wrappers,
				bucketDecls,
				atRule,
				bucket.nestedSelector,
				bucket.nestedBlocks,
			);
			if (node) {
				docRoot().append(node);
			}
		} else {
			// Regular variant: insert as sibling of parent rule
			const node = buildVariantNode(
				baseSelector,
				bucket.wrappers,
				bucketDecls,
				atRule,
				bucket.nestedSelector,
				bucket.nestedBlocks,
			);
			if (node) {
				parentContainer.insertAfter(insertAfter, node);
				insertAfter = node;
			}
		}
	}

	atRule.remove();
}

/**
 * If the variant wrappers contain a group-* variant (e.g. group-hover) and
 * the @apply rule is nested inside a CSS rule with `@apply group`, rewrite
 * the variant selector to use the group root's actual selector instead of
 * `.group`. Returns null if no group rewriting is needed.
 */
function resolveGroupVariantInfo(
	wrappers: VariantWrapper[],
	parentRule: Rule,
	groupRoots: ReadonlySet<Rule>,
	fullNestingSelector: () => string,
): { rewrittenWrappers: VariantWrapper[]; groupRootSelector: string; isSelf: boolean } | null {
	if (groupRoots.size === 0) return null;

	// Check if any wrapper is a group variant
	const hasGroupVariant = wrappers.some(
		(w) => w.selectorSuffix && w.replaceAmpersand && GROUP_VARIANT_RE.test(w.selectorSuffix),
	);
	if (!hasGroupVariant) return null;

	// Find the group root ancestor in the CSS nesting tree
	const groupInfo = findGroupAncestor(parentRule, groupRoots);
	if (!groupInfo) return null;

	// Rewrite group variant wrappers to use the concrete ancestor selector.
	// The descendant path is NOT included here — the caller is responsible for
	// passing a fully-resolved base selector (via resolveFullNestingSelector)
	// so that `&` in the suffix gets replaced with the correct resolved path.
	//
	// Comma-separated group root selectors are expanded so each branch gets
	// the pseudo independently: ".card, .panel" + ":hover" → ".card:hover &, .panel:hover &"
	//
	// The @apply rule can also resolve to the group root itself — the marker and
	// the variant sharing one rule (`.self { @apply group group-hover:underline }`),
	// or a nested `&` block inside the root. There is then no descendant path to
	// separate, so the variant degenerates to a plain `&<pseudo>` on that element.
	const isSelf = fullNestingSelector() === groupInfo.groupRootSelector;

	const rewrittenWrappers = wrappers.map((w) => {
		if (!w.selectorSuffix || !w.replaceAmpersand) return w;
		const match = w.selectorSuffix.match(GROUP_VARIANT_RE);
		if (!match) return w;

		const pseudo = match[1]; // e.g., ":hover", ":focus"
		if (isSelf) return { ...w, selectorSuffix: `&${pseudo}` };
		const rootBranches = splitSelectorList(groupInfo.groupRootSelector);
		const newSuffix = rootBranches.map((b) => `${b}${pseudo} &`).join(", ");

		return { ...w, selectorSuffix: newSuffix };
	});

	return { rewrittenWrappers, groupRootSelector: groupInfo.groupRootSelector, isSelf };
}

// ---------------------------------------------------------------------------
// Class resolution
// ---------------------------------------------------------------------------

/** Marker classes that are valid in class attributes but produce no CSS declarations. */
const MARKER_CLASSES = new Set(["group"]);

/** Max recursion depth for @apply within custom utility bodies. */
const MAX_CUSTOM_APPLY_DEPTH = 5;

/**
 * Find the custom utility entry that owns a parsed class, static or functional
 * — backed by the cached index in utilities/custom.ts, so this walk and the
 * declaration expansion can never disagree about which utility a class hit.
 */
function findCustomUtility(
	utility: string,
	value: string | null,
	negative: boolean,
	theme: ResolvedTheme,
): { body: string; name: string } | undefined {
	return matchCustomUtility(utility, value, negative, theme)?.cu;
}

/**
 * Walk a custom utility's @apply/@a body graph purely to surface circular-reference
 * and depth-limit warnings.
 *
 * Declaration expansion is owned by `resolveCustomUtility` (utilities/index.ts),
 * which performs the same traversal but cuts cycles and over-depth chains
 * *silently*. Re-expanding here would double-emit every inner declaration, so this
 * walk produces no declarations — it only emits the [RI-1005] warnings that the
 * silent expansion would otherwise swallow.
 */
function checkCustomApplyWarnings(
	cu: { body: string; name: string },
	theme: ResolvedTheme,
	warnings: string[],
	visiting: Set<string> = new Set(),
): void {
	if (!hasApplyLikeDirective(cu.body)) return;
	const innerClasses: string[] = [];
	forEachApplyClass(cu.body, (cls) => innerClasses.push(cls));
	if (innerClasses.length === 0) return;

	if (visiting.has(cu.name)) {
		warnings.push(
			`[RI-1005] Circular @apply detected in @utility "${cu.name}" — skipping inner @apply.`,
		);
		return;
	}
	if (visiting.size >= MAX_CUSTOM_APPLY_DEPTH) {
		warnings.push(
			`[RI-1005] @apply recursion depth limit reached in @utility "${cu.name}" — skipping inner @apply.`,
		);
		return;
	}

	visiting.add(cu.name);
	for (const innerClass of innerClasses) {
		const parsed = parseUtility(innerClass);
		const innerCu = findCustomUtility(parsed.utility, parsed.value, parsed.negative, theme);
		if (innerCu) checkCustomApplyWarnings(innerCu, theme, warnings, visiting);
	}
	visiting.delete(cu.name);
}

function resolveClassName(
	className: string,
	theme: ResolvedTheme,
	warnings: string[],
	customVariantMap: ReadonlyMap<string, { name: string; selector: string }>,
	applyRootWarnings: Map<string, string[]>,
): ResolvedDecl | null {
	const parsed = parseUtility(className);

	// Marker classes like "group" are valid Tailwind classes used by variants
	// (e.g. group-hover) but produce no CSS declarations — silently skip them.
	if (parsed.variants.length === 0 && MARKER_CLASSES.has(parsed.utility) && parsed.value === null) {
		return null;
	}

	const utilResult = resolveUtilityDeclarations(parsed, theme, warnings);
	if (!utilResult) {
		warnings.push(`[RI-1005] Unknown utility "${className}" in @apply — skipping.`);
		return null;
	}

	const declarations = [...utilResult.declarations];

	// A custom utility's @apply/@a body was already fully expanded into
	// utilResult.declarations by resolveCustomUtility, so re-expanding it here
	// would emit every inner declaration twice. We still walk the body — but only
	// to surface the circular/depth [RI-1005] warnings that resolveCustomUtility
	// detects and then handles silently. One top-level walk per utility per
	// theme: the walk's warnings are cached and replayed into every class that
	// hits the utility, so they survive rebuilds even after the class that
	// triggered the walk leaves the CSS. The plugin dedupes repeats downstream.
	const cu = findCustomUtility(parsed.utility, parsed.value, parsed.negative, theme);
	if (cu) {
		let cuWarnings = applyRootWarnings.get(cu.name);
		if (!cuWarnings) {
			cuWarnings = [];
			checkCustomApplyWarnings(cu, theme, cuWarnings);
			applyRootWarnings.set(cu.name, cuWarnings);
		}
		warnings.push(...cuWarnings);
	}

	const variantWrappers: VariantWrapper[] = [];
	for (const variant of parsed.variants) {
		const wrapper = resolveVariant(variant, theme, customVariantMap);
		if (!wrapper) {
			warnings.push(
				`[RI-1004] Unknown variant "${variant}" in @apply "${className}" — skipping. Check spelling, or register the variant with \`@custom ${variant} { ... }\`. Built-in variants: hover, focus, dark, sm/md/lg/xl, data-[attr], arbitrary [selector].`,
			);
			return null;
		}
		variantWrappers.push(wrapper);
	}

	return {
		declarations,
		important: parsed.important,
		nestedSelector: utilResult.nestedSelector,
		nested: utilResult.nested,
		variants: variantWrappers,
	};
}

function variantKey(wrappers: VariantWrapper[], nestedSelector?: string): string {
	const parts: string[] = [];
	for (const w of wrappers) {
		const sel = w.selectorSuffix ?? "";
		const at = w.atRule ?? "";
		parts.push(
			`${sel.length}:${sel}${at.length}:${at}${w.startingStyle ? "1" : "0"}${w.replaceAmpersand ? "1" : "0"}`,
		);
	}
	let key = parts.join("\0");
	if (nestedSelector) key += `\0N${nestedSelector}`;
	return key;
}

/**
 * Build a PostCSS node for one custom-utility nested block. An `@`-prefixed
 * prelude (e.g. a nested `@media`) becomes an AtRule; anything else a Rule.
 * Children recurse, so the authored nesting structure is preserved verbatim.
 */
function buildNestedBlockNode(
	block: UtilityNestedBlock,
	sourceNode: Node,
	important: boolean,
): ChildNode {
	let node: Rule | AtRule;
	if (block.selector.charCodeAt(0) === 64 /* @ */) {
		const spaceIdx = block.selector.indexOf(" ");
		const name = spaceIdx === -1 ? block.selector.slice(1) : block.selector.slice(1, spaceIdx);
		const params = spaceIdx === -1 ? "" : block.selector.slice(spaceIdx + 1);
		node = applySource(postcss.atRule({ name, params }), sourceNode);
	} else {
		node = applySource(postcss.rule({ selector: block.selector }), sourceNode);
	}
	for (const d of block.declarations) {
		node.append(
			applySource(postcss.decl({ prop: d.property, value: d.value, important }), sourceNode),
		);
	}
	for (const child of block.nested) {
		node.append(buildNestedBlockNode(child, sourceNode, important));
	}
	return node;
}

function buildVariantNode(
	baseSelector: string,
	wrappers: VariantWrapper[],
	decls: Array<{ decl: CSSDeclaration; important: boolean }>,
	sourceNode: Node,
	nestedSelector: string | undefined,
	nestedBlocks: NestedBlockEntry[],
): ChildNode | null {
	if (decls.length === 0 && nestedBlocks.length === 0) return null;

	// Wrapper folding (suffix per branch, at-rule order, starting-style) is the
	// engine's cascade model — shared so @apply output can't diverge from the
	// same utility compiled standalone.
	const { selector, atRules, startingStyle } = applyVariantWrappers(baseSelector, wrappers);

	const rule = applySource(postcss.rule({ selector }), sourceNode);
	let declTarget = rule;
	if (nestedSelector) {
		declTarget = applySource(postcss.rule({ selector: nestedSelector }), sourceNode);
		rule.append(declTarget);
	}

	if (startingStyle) {
		const startingAtRule = applySource(postcss.atRule({ name: "starting-style" }), sourceNode);
		for (const { decl, important } of decls) {
			startingAtRule.append(
				applySource(
					postcss.decl({ prop: decl.property, value: decl.value, important }),
					sourceNode,
				),
			);
		}
		declTarget.append(startingAtRule);
	} else {
		for (const { decl, important } of decls) {
			declTarget.append(
				applySource(
					postcss.decl({ prop: decl.property, value: decl.value, important }),
					sourceNode,
				),
			);
		}
	}

	for (const { block, important } of nestedBlocks) {
		declTarget.append(buildNestedBlockNode(block, sourceNode, important));
	}

	if (atRules.length === 0) return rule;

	let node: ChildNode = rule;
	for (let i = atRules.length - 1; i >= 0; i--) {
		const atRuleStr = atRules[i];
		const spaceIdx = atRuleStr.indexOf(" ");
		const name = spaceIdx === -1 ? atRuleStr.slice(1) : atRuleStr.slice(1, spaceIdx);
		const params = spaceIdx === -1 ? "" : atRuleStr.slice(spaceIdx + 1);
		const wrapper = applySource(postcss.atRule({ name, params }), sourceNode);
		wrapper.append(node);
		node = wrapper;
	}

	return node;
}
