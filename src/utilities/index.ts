import type { CustomUtility, ResolvedTheme } from "../directives/foundation.js";
import { APPLY_LIKE_MATCH_RE, hasApplyLikeDirective } from "../directives/apply-aliases.js";
import { parseUtility, decodeArbitraryValue, type ParsedUtility } from "./parser.js";
import { spacingGenerator } from "./spacing.js";
import { sizingGenerator } from "./sizing.js";
import { typographyGenerator } from "./typography.js";
import { colorGenerator } from "./color.js";
import { layoutGenerator } from "./layout.js";
import { borderGenerator } from "./borders.js";
import { effectsGenerator } from "./effects.js";
import { animationGenerator } from "./animations.js";
import { svgGenerator } from "./svg.js";

export interface CSSDeclaration {
	property: string;
	value: string;
}

/**
 * A nested rule block inside a custom @utility body. `selector` is the authored
 * prelude verbatim (a nested selector like `&:focus-visible` or an at-rule like
 * `@media (min-width: 600px)`); both surfaces emit it with native CSS nesting so
 * the browser applies standard nesting semantics.
 */
export interface UtilityNestedBlock {
	selector: string;
	declarations: CSSDeclaration[];
	nested: UtilityNestedBlock[];
}

export interface UtilityResult {
	declarations: CSSDeclaration[];
	nestedSelector?: string;
	/** Nested rule blocks — only produced by custom @utility bodies. */
	nested?: UtilityNestedBlock[];
}

type UtilityResolver = (
	utility: string,
	value: string | null,
	negative: boolean,
	theme: ResolvedTheme,
	warnings?: string[],
	dataType?: string | null,
) => UtilityResult | null;

export const INTEGER_RE = /^\d+$/;
export const DECIMAL_RE = /^\d+(?:[._]\d+)?$/;

export function single(property: string, value: string): UtilityResult {
	return { declarations: [{ property, value }] };
}

export function multi(...pairs: Array<[string, string]>): UtilityResult {
	return {
		declarations: pairs.map(([property, value]) => ({ property, value })),
	};
}

// Single-entry memo: every generator probed for one class rebuilds the same
// full name (static-table lookups), so consecutive identical calls — the only
// repeat pattern — return the cached string instead of re-concatenating.
let lastFullNameUtility: string | null = null;
let lastFullNameValue: string | null = null;
let lastFullName = "";

export function fullName(utility: string, value: string | null): string {
	if (value === null) return utility;
	if (utility === lastFullNameUtility && value === lastFullNameValue) return lastFullName;
	lastFullNameUtility = utility;
	lastFullNameValue = value;
	lastFullName = `${utility}-${value}`;
	return lastFullName;
}

export function extractArbitrary(value: string | null): string | null {
	if (!value) return null;
	return value.startsWith("[") && value.endsWith("]")
		? decodeArbitraryValue(value.slice(1, -1))
		: null;
}

// Defined in the leaf shared module so the directive resolver can validate fluid
// bounds against the same grammar the utilities consume here.
export { parseRemValue } from "../shared.js";

export function normalizeDecimalToken(value: string): string {
	return value.replaceAll("_", ".");
}

export function spacingLookup(value: string, negative = false): string | null {
	if (value === "px") return negative ? "-1px" : "1px";
	if (!DECIMAL_RE.test(value)) return null;
	const normalized = normalizeDecimalToken(value);
	const num = Number(normalized);
	if (!Number.isFinite(num) || num < 0) return null;
	if (num === 0) return "0px";
	const expr = `calc(${normalized} * var(--spacing))`;
	return negative ? `calc(${normalized} * var(--spacing) * -1)` : expr;
}

export function deepFreezeUtilityMap<T extends Record<string, UtilityResult>>(map: T): Readonly<T> {
	for (const value of Object.values(map)) {
		Object.freeze(value.declarations);
		Object.freeze(value);
	}
	return Object.freeze(map);
}

function uniqueResolvers(resolvers: UtilityResolver[]): UtilityResolver[] {
	return [...new Set(resolvers)];
}

function buildPrefixDispatch(
	groups: Array<readonly [readonly string[], readonly UtilityResolver[]]>,
): ReadonlyMap<string, UtilityResolver[]> {
	const dispatch = new Map<string, UtilityResolver[]>();
	for (const [prefixes, resolvers] of groups) {
		for (const prefix of prefixes) {
			const existing = dispatch.get(prefix) ?? [];
			dispatch.set(prefix, uniqueResolvers([...existing, ...resolvers]));
		}
	}
	// Pre-merge each multi-segment key with its first-segment bucket (the keys
	// are all known here), so resolveUtility never unions buckets per class.
	for (const [key, resolvers] of dispatch) {
		const dashIdx = key.indexOf("-");
		if (dashIdx === -1) continue;
		const segmentBucket = dispatch.get(key.slice(0, dashIdx));
		if (segmentBucket) dispatch.set(key, uniqueResolvers([...resolvers, ...segmentBucket]));
	}
	return dispatch;
}

const GENERATORS = {
	spacing: spacingGenerator,
	sizing: sizingGenerator,
	typography: typographyGenerator,
	color: colorGenerator,
	layout: layoutGenerator,
	border: borderGenerator,
	effects: effectsGenerator,
	animation: animationGenerator,
	svg: svgGenerator,
} as const;

const PREFIX_GROUPS: Array<[string[], UtilityResolver[]]> = [
	[
		[
			"p",
			"px",
			"py",
			"pt",
			"pb",
			"pl",
			"pr",
			"ps",
			"pe",
			"pbs",
			"pbe",
			"m",
			"mx",
			"my",
			"mt",
			"mb",
			"ml",
			"mr",
			"ms",
			"me",
			"mbs",
			"mbe",
			"gap",
			"gap-x",
			"gap-y",
			"space",
			"space-x",
			"space-y",
			"inset",
			"inset-x",
			"inset-y",
			"inset-s",
			"inset-e",
			"inset-bs",
			"inset-be",
			"top",
			"bottom",
			"left",
			"right",
			"start",
			"end",
			"scroll",
			"scroll-m",
			"scroll-mx",
			"scroll-my",
			"scroll-mt",
			"scroll-mb",
			"scroll-ml",
			"scroll-mr",
			"scroll-ms",
			"scroll-me",
			"scroll-p",
			"scroll-px",
			"scroll-py",
			"scroll-pt",
			"scroll-pb",
			"scroll-pl",
			"scroll-pr",
			"scroll-ps",
			"scroll-pe",
		],
		[GENERATORS.spacing],
	],
	[["w", "h", "size", "min", "max", "min-w", "max-w", "min-h", "max-h"], [GENERATORS.sizing]],
	[
		[
			"text",
			"font",
			"leading",
			"tracking",
			"decoration",
			"whitespace",
			"italic",
			"truncate",
			"uppercase",
			"lowercase",
			"capitalize",
			"normal",
			"break",
			"antialiased",
			"subpixel",
			"align",
			"list",
			"content",
			"indent",
			"tab",
			"line",
			"hyphens",
			"wrap",
			"ordinal",
			"slashed",
			"lining",
			"oldstyle",
			"proportional",
			"tabular",
			"diagonal",
			"stacked",
			"underline",
		],
		[GENERATORS.typography, GENERATORS.color],
	],
	[
		[
			"bg",
			"bg-linear",
			"bg-conic",
			"bg-radial",
			"border",
			"accent",
			"caret",
			"fill",
			"stroke",
			"from",
			"via",
			"to",
			"divide",
		],
		[GENERATORS.color, GENERATORS.border, GENERATORS.effects, GENERATORS.svg],
	],
	[
		[
			"stroke-cap",
			"stroke-join",
			"stroke-dash",
			"stroke-offset",
			"stroke-miter",
			"stroke-opacity",
			"paint",
			"vector",
		],
		[GENERATORS.svg],
	],
	[
		[
			"block",
			"inline",
			"flex",
			"grid",
			"contents",
			"hidden",
			"table",
			"flow",
			"static",
			"relative",
			"absolute",
			"fixed",
			"sticky",
			"grow",
			"shrink",
			"items",
			"justify",
			"content",
			"self",
			"overflow",
			"overscroll",
			"visible",
			"invisible",
			"collapse",
			"isolate",
			"float",
			"clear",
			"aspect",
			"object",
			"cursor",
			"pointer",
			"select",
			"touch",
			"resize",
			"scrollbar",
			"snap",
			"place",
			"auto",
			"order",
			"col",
			"row",
			"columns",
			"sr",
			"z",
			"box",
			"caption",
			"field",
			"basis",
			"caret",
			"accent",
			"forced",
			"scheme",
			"backface",
			"contain",
			"@container",
			"@anchor",
			"@anchor-to",
			"position-area",
			"anchor-scope",
		],
		[GENERATORS.layout],
	],
	// inline-/block- also drive logical sizing (inline-size/block-size). Placed
	// after the layout group so display (bare `inline`, `inline-block`, `block`)
	// resolves first; sizing only claims size-shaped values.
	[["inline", "block"], [GENERATORS.sizing]],
	[["rounded", "corner"], [GENERATORS.border]],
	[["outline"], [GENERATORS.color, GENERATORS.border]],
	[
		[
			"shadow",
			"text-shadow",
			"ring",
			"inset-shadow",
			"inset-ring",
			"opacity",
			"transition",
			"duration",
			"delay",
			"ease",
			"transform",
			"mix",
			"filter",
			"grayscale",
			"invert",
			"sepia",
			"mask",
			"backdrop",
			"translate",
			"rotate",
			"scale",
			"skew",
			"origin",
			"will",
			"perspective",
		],
		[GENERATORS.effects],
	],
	[
		["animate", "fade", "zoom", "spin", "blur", "slide"],
		[GENERATORS.animation, GENERATORS.effects],
	],
];

export const PREFIX_DISPATCH: ReadonlyMap<string, UtilityResolver[]> =
	buildPrefixDispatch(PREFIX_GROUPS);

const FALLBACK_RESOLVERS: UtilityResolver[] = [
	GENERATORS.spacing,
	GENERATORS.sizing,
	GENERATORS.typography,
	GENERATORS.color,
	GENERATORS.layout,
	GENERATORS.border,
	GENERATORS.effects,
	GENERATORS.animation,
];

const NO_RESOLVERS: UtilityResolver[] = [];

export function resolveUtility(
	utility: string,
	value: string | null,
	negative: boolean,
	theme: ResolvedTheme,
	warnings?: string[],
	visiting?: Set<string>,
	dataType?: string | null,
): UtilityResult | null {
	// Allocation-free: buildPrefixDispatch pre-merged multi-segment keys with
	// their first-segment buckets, so one Map hit (or the segment fallback)
	// yields the final resolver list.
	let candidateResolvers = PREFIX_DISPATCH.get(utility);
	if (candidateResolvers === undefined) {
		const firstDash = utility.indexOf("-");
		candidateResolvers =
			firstDash === -1
				? NO_RESOLVERS
				: (PREFIX_DISPATCH.get(utility.slice(0, firstDash)) ?? NO_RESOLVERS);
	}
	const resolvers = candidateResolvers.length > 0 ? candidateResolvers : FALLBACK_RESOLVERS;
	for (const resolver of resolvers) {
		const result = resolver(utility, value, negative, theme, warnings, dataType);
		if (result) return result;
	}
	if (candidateResolvers.length > 0) {
		for (const resolver of FALLBACK_RESOLVERS) {
			if (candidateResolvers.includes(resolver)) continue;
			const result = resolver(utility, value, negative, theme, warnings, dataType);
			if (result) return result;
		}
	}
	// Fallback: check custom utilities defined via @utility directive.
	const customResult = resolveCustomUtility(utility, value, theme, visiting);
	if (customResult) return customResult;

	return null;
}

// ---------------------------------------------------------------------------
// Custom utility resolution
// ---------------------------------------------------------------------------

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
): void {
	for (const cls of classes) {
		const parsed = parseUtility(cls);
		const inner = resolveUtility(
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
): UtilityNestedBlock | null {
	const declarations = [...node.declarations];
	const nested: UtilityNestedBlock[] = [];
	if (expansion) expandApplyClasses(node.applyClasses, theme, expansion, declarations, nested);
	for (const child of node.nested) {
		const block = buildNestedBlock(child, theme, expansion);
		if (block) nested.push(block);
	}
	if (declarations.length === 0 && nested.length === 0) return null;
	return { selector: node.selector, declarations, nested };
}

function resolveCustomUtility(
	utility: string,
	value: string | null,
	theme: ResolvedTheme,
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

	const tree = parseCustomUtilityBody(cu.body);

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
	if (expansion) expandApplyClasses(tree.applyClasses, theme, expansion, declarations, nested);
	for (const child of tree.nested) {
		const block = buildNestedBlock(child, theme, expansion);
		if (block) nested.push(block);
	}
	if (expansion) expansion.delete(cu.name);

	if (declarations.length === 0 && nested.length === 0) return null;
	if (nested.length === 0) return { declarations };

	return { declarations, nested };
}

// ---------------------------------------------------------------------------
// Logical → Physical property mapping
// ---------------------------------------------------------------------------

const LOGICAL_TO_PHYSICAL: Readonly<Record<string, string | string[]>> = {
	// Padding
	"padding-inline-start": "padding-left",
	"padding-inline-end": "padding-right",
	"padding-block-start": "padding-top",
	"padding-block-end": "padding-bottom",
	"padding-inline": ["padding-left", "padding-right"],
	"padding-block": ["padding-top", "padding-bottom"],
	// Margin
	"margin-inline-start": "margin-left",
	"margin-inline-end": "margin-right",
	"margin-block-start": "margin-top",
	"margin-block-end": "margin-bottom",
	"margin-inline": ["margin-left", "margin-right"],
	"margin-block": ["margin-top", "margin-bottom"],
	// Inset
	"inset-inline-start": "left",
	"inset-inline-end": "right",
	"inset-block-start": "top",
	"inset-block-end": "bottom",
	"inset-inline": ["left", "right"],
	"inset-block": ["top", "bottom"],
	// Border width
	"border-inline-start-width": "border-left-width",
	"border-inline-end-width": "border-right-width",
	"border-block-start-width": "border-top-width",
	"border-block-end-width": "border-bottom-width",
	"border-inline-width": ["border-left-width", "border-right-width"],
	"border-block-width": ["border-top-width", "border-bottom-width"],
	// Border color
	"border-inline-start-color": "border-left-color",
	"border-inline-end-color": "border-right-color",
	"border-block-start-color": "border-top-color",
	"border-block-end-color": "border-bottom-color",
	"border-inline-color": ["border-left-color", "border-right-color"],
	"border-block-color": ["border-top-color", "border-bottom-color"],
	// Border style
	"border-inline-start-style": "border-left-style",
	"border-inline-end-style": "border-right-style",
	"border-block-start-style": "border-top-style",
	"border-block-end-style": "border-bottom-style",
	"border-inline-style": ["border-left-style", "border-right-style"],
	"border-block-style": ["border-top-style", "border-bottom-style"],
	// Border radius
	"border-start-start-radius": "border-top-left-radius",
	"border-start-end-radius": "border-top-right-radius",
	"border-end-start-radius": "border-bottom-left-radius",
	"border-end-end-radius": "border-bottom-right-radius",
	// Sizing
	"inline-size": "width",
	"block-size": "height",
	"min-inline-size": "min-width",
	"min-block-size": "min-height",
	"max-inline-size": "max-width",
	"max-block-size": "max-height",
};
Object.freeze(LOGICAL_TO_PHYSICAL);

/**
 * Expand logical CSS properties to their physical equivalents.
 * Used by both the engine and @apply to handle the -physical- infix.
 */
function expandPhysicalProperties(
	declarations: Array<{ property: string; value: string }>,
): Array<{ property: string; value: string }> {
	const expanded: Array<{ property: string; value: string }> = [];
	let changed = false;
	for (const decl of declarations) {
		const phys = LOGICAL_TO_PHYSICAL[decl.property];
		if (!phys) {
			expanded.push(decl);
			continue;
		}
		changed = true;
		for (const p of Array.isArray(phys) ? phys : [phys]) {
			expanded.push({ property: p, value: decl.value });
		}
	}
	return changed ? expanded : declarations;
}

// ---------------------------------------------------------------------------
// Unified utility resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a parsed utility to CSS declarations, handling arbitrary properties,
 * standard utility resolution, and physical property expansion.
 *
 * Both the inline class compilation (engine) and @apply directive expansion
 * use this as their shared resolution step.
 */
export function resolveUtilityDeclarations(
	parsed: ParsedUtility,
	theme: ResolvedTheme,
	warnings?: string[],
): UtilityResult | null {
	let utilResult: UtilityResult | null;

	if (parsed.arbitraryProperty) {
		utilResult = {
			declarations: [
				{ property: parsed.arbitraryProperty.property, value: parsed.arbitraryProperty.value },
			],
		};
	} else {
		utilResult = resolveUtility(
			parsed.utility,
			parsed.value,
			parsed.negative,
			theme,
			warnings,
			undefined,
			parsed.dataType ?? null,
		);
		if (!utilResult) return null;
	}

	if (parsed.physical) {
		utilResult = { ...utilResult, declarations: expandPhysicalProperties(utilResult.declarations) };
	}

	return utilResult;
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
	const tree = parseCustomUtilityBody(body);
	const seen = new Set<string>();
	const properties: string[] = [];
	for (const d of tree.declarations) {
		if (!d.property.startsWith("--") && !seen.has(d.property)) {
			seen.add(d.property);
			properties.push(d.property);
		}
	}
	return { properties, applyClasses: tree.applyClasses };
}
