import type { ResolvedTheme } from "../directives/foundation.js";
import type { ParsedUtility } from "./parser.js";
import type { UtilityResult } from "./helpers.js";
import { resolveCustomUtility } from "./custom.js";
import { ROOT_GROUPS, type RootGroup, type UtilityResolver } from "./roots.js";
import { spacingGenerator } from "./spacing.js";
import { sizingGenerator } from "./sizing.js";
import { typographyGenerator } from "./typography.js";
import { colorGenerator } from "./color.js";
import { layoutGenerator } from "./layout.js";
import { borderGenerator } from "./borders.js";
import { effectsGenerator } from "./effects/index.js";
import { animationGenerator } from "./animations.js";
import { svgGenerator } from "./svg.js";

function uniqueResolvers(resolvers: UtilityResolver[]): UtilityResolver[] {
	return [...new Set(resolvers)];
}

function buildPrefixDispatch(groups: readonly RootGroup[]): ReadonlyMap<string, UtilityResolver[]> {
	const dispatch = new Map<string, UtilityResolver[]>();
	for (const { roots, resolvers } of groups) {
		// Defensive: a spec-only row must not register a prefix with an empty
		// bucket, which would flip resolveUtility's defined/undefined path.
		if (resolvers.length === 0) continue;
		for (const prefix of roots) {
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

export const PREFIX_DISPATCH: ReadonlyMap<string, UtilityResolver[]> =
	buildPrefixDispatch(ROOT_GROUPS);

const FALLBACK_RESOLVERS: UtilityResolver[] = [
	GENERATORS.spacing,
	GENERATORS.sizing,
	GENERATORS.typography,
	GENERATORS.color,
	GENERATORS.layout,
	GENERATORS.border,
	GENERATORS.effects,
	GENERATORS.animation,
	// Unregistered svg roots degrade to a slow path instead of a silent outage.
	GENERATORS.svg,
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
	// Reassembled once here: nearly every generator's first act is a static
	// table lookup on the full class name, so probing eight resolvers must not
	// rebuild the same string eight times.
	const full = value === null ? utility : `${utility}-${value}`;
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
		const result = resolver(utility, value, full, negative, theme, warnings, dataType);
		if (result) return result;
	}
	if (candidateResolvers.length > 0) {
		for (const resolver of FALLBACK_RESOLVERS) {
			if (candidateResolvers.includes(resolver)) continue;
			const result = resolver(utility, value, full, negative, theme, warnings, dataType);
			if (result) return result;
		}
	}
	// Fallback: check custom utilities defined via @utility directive.
	const customResult = resolveCustomUtility(
		utility,
		value,
		negative,
		theme,
		resolveUtility,
		visiting,
	);
	if (customResult) return customResult;

	return null;
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

// Custom-@utility subsystem re-exports — the machinery lives in custom.ts;
// existing consumers (engine, PostCSS @apply, tests) keep importing from here.
export {
	matchCustomUtility,
	forEachApplyClass,
	forEachApplyClassList,
	extractCustomUtilityRootInfo,
} from "./custom.js";

// Per-family font-weight check for applied class lists — the sibling classes
// an @apply body has, and a scanned class attribute does not.
export { checkAppliedFontWeights } from "./typography.js";
