/**
 * Class enumeration — the completion universe for editor tooling.
 *
 * Design: candidates are generated from a deliberately GENEROUS value-space
 * table (which theme namespaces and keyword families to TRY per functional
 * root), then every candidate is probed through the real utility resolver.
 * The resolver is the single authority — an enumerated class is one that
 * actually compiles, so the table can over-approximate freely and can never
 * emit something `validate()` would reject. Coverage is structural: the table
 * derives from ROOT_GROUPS (roots.ts), where `spec` is a required field of
 * every row — adding a root forces deciding its value space in the same row
 * (an empty spec marks a statics-only root); the CI check in enumerate.test.ts
 * stays on as a regression tripwire.
 *
 * Statics come from the merge conflict tables (STATIC_UTILITIES) plus each
 * generator's own static-map keys — probed too, for the same guarantee.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import { codepointCompare } from "../shared.js";
import { SPECIAL_COLORS } from "../merge/props.js";
import { parseUtility } from "./parser.js";
import { ROOT_GROUPS, SPACING_SAMPLES, type ValueSpaceKind, type ValueSpaceSpec } from "./roots.js";
import { resolveUtilityDeclarations, PREFIX_DISPATCH } from "./index.js";
import { STATIC_UTILITIES } from "./metadata.js";
import { ANIMATION_STATIC_NAMES } from "./animations.js";
import { BORDER_STATIC_NAMES, ROUNDED_CORNER_NAMES, ROUNDED_SIDE_NAMES } from "./borders.js";
import { BACKGROUND_STATIC_NAMES } from "./background.js";
import { EFFECTS_STATIC_NAMES } from "./effects/index.js";
import { LAYOUT_STATIC_NAMES } from "./layout.js";
import { SVG_STATIC_NAMES } from "./svg.js";
import { TYPOGRAPHY_STATIC_NAMES } from "./typography.js";

// ---------------------------------------------------------------------------
// Value spaces
// ---------------------------------------------------------------------------

// The kind/spec vocabulary lives with the registration table in roots.ts;
// re-exported here so the editor entry's public surface is unchanged.
export type { ValueSpaceKind, ValueSpaceSpec } from "./roots.js";

/** Color stop suffixes — mirrors isValidColorSuffix / the ColorStop type. */
const COLOR_STOPS = Object.freeze([
	"50",
	"100",
	"150",
	"200",
	"250",
	"300",
	"350",
	"400",
	"450",
	"500",
	"550",
	"600",
	"650",
	"700",
	"750",
	"800",
	"850",
	"900",
	"950",
]);

const FRACTION_SAMPLES = Object.freeze([
	"1/2",
	"1/3",
	"2/3",
	"1/4",
	"3/4",
	"1/5",
	"2/5",
	"3/5",
	"4/5",
	"1/6",
	"5/6",
]);

const INT_SAMPLES = Object.freeze(["0", "1", "2", "3", "4", "6", "8", "10", "12"]);

const PERCENT_SAMPLES = Object.freeze([
	"0",
	"5",
	"10",
	"15",
	"20",
	"25",
	"30",
	"40",
	"50",
	"60",
	"70",
	"75",
	"80",
	"90",
	"95",
	"100",
]);

/** Font slots the typography generator always accepts, theme or not. */
const BUILTIN_FONT_SLOTS = Object.freeze(["sans", "serif", "mono"]);

/** Transition durations worth offering when the theme defines none. */
const DURATION_SAMPLES = Object.freeze(["75", "100", "150", "200", "300", "500", "700", "1000"]);

/** Side/corner prefixes derive from the border generator's own tables so a
 *  new side can never silently miss enumeration. */
const ROUNDED_SIDES: readonly string[] = Object.freeze([
	...ROUNDED_SIDE_NAMES,
	...ROUNDED_CORNER_NAMES,
]);

function buildValueSpaces(): ReadonlyMap<string, ValueSpaceSpec> {
	const table = new Map<string, { kinds: Set<ValueSpaceKind>; keywords: Set<string> }>();
	for (const { roots, spec } of ROOT_GROUPS) {
		for (const root of roots) {
			let entry = table.get(root);
			if (!entry) {
				entry = { kinds: new Set(), keywords: new Set() };
				table.set(root, entry);
			}
			for (const kind of spec.kinds) entry.kinds.add(kind);
			for (const kw of spec.keywords ?? []) entry.keywords.add(kw);
		}
	}
	const out = new Map<string, ValueSpaceSpec>();
	for (const [root, entry] of table) {
		out.set(root, {
			kinds: Object.freeze([...entry.kinds]),
			keywords: entry.keywords.size > 0 ? Object.freeze([...entry.keywords]) : undefined,
		});
	}
	return out;
}

/** Root → value spaces to try, derived from ROOT_GROUPS. Every
 *  PREFIX_DISPATCH root is present by construction — both maps are built
 *  from the same rows. */
export const UTILITY_VALUE_SPACES: ReadonlyMap<string, ValueSpaceSpec> = buildValueSpaces();

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

function candidateValues(kind: ValueSpaceKind, theme: ResolvedTheme): string[] {
	switch (kind) {
		case "color": {
			const out: string[] = [];
			for (const name of Object.keys(theme.colors)) {
				for (const stop of COLOR_STOPS) out.push(`${name}-${stop}`);
			}
			return out;
		}
		case "special-color":
			return Object.keys(SPECIAL_COLORS);
		case "spacing":
			return [...SPACING_SAMPLES];
		case "fraction":
			return [...FRACTION_SAMPLES];
		case "text-size":
			return Object.keys(theme.text);
		case "fluid-text-size":
			return Object.keys(theme.text).map((size) => `fluid-${size}`);
		case "font-slot":
			return [...new Set([...BUILTIN_FONT_SLOTS, ...theme.fonts.map((slot) => slot.slot)])];
		case "weight":
			return Object.keys(theme.weights);
		case "rounded":
			return Object.keys(theme.rounded);
		case "rounded-side": {
			const tokens = Object.keys(theme.rounded);
			const out: string[] = [];
			for (const side of ROUNDED_SIDES) {
				out.push(side);
				for (const token of tokens) out.push(`${side}-${token}`);
			}
			return out;
		}
		case "shadow":
			return Object.keys(theme.shadows);
		case "z":
			return Object.keys(theme.z);
		case "ease":
			return Object.keys(theme.easing);
		case "blur":
			return Object.keys(theme.blur);
		case "animation":
			return Object.keys(theme.animations);
		case "leading":
			return Object.keys(theme.leading);
		case "tracking":
			return Object.keys(theme.tracking);
		case "opacity":
			return Object.keys(theme.opacity);
		case "duration":
			return [...new Set([...Object.keys(theme.duration), ...DURATION_SAMPLES])];
		case "breakpoint":
			return Object.keys(theme.breakpoints);
		case "int":
			return [...INT_SAMPLES];
		case "percent":
			return [...PERCENT_SAMPLES];
		case "keywords":
			return []; // spec.keywords carries the values
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EnumeratedClass {
	name: string;
	/** How the class was produced: a static table, a custom @utility, or the
	 *  value-space kind that filled the functional root. */
	kind: ValueSpaceKind | "static" | "custom";
	/** The functional root, or null for statics/custom statics. */
	root: string | null;
}

export interface ClassTemplate {
	root: string;
	/** The open-ended space: numeric spacing scale, plain numbers, or a
	 *  functional custom utility that accepts any suffix. */
	kind: "spacing" | "number" | "custom";
	example: string;
}

export interface ClassEnumeration {
	/** Every finite concrete class, probed valid, sorted by name. */
	classes: EnumeratedClass[];
	/** Families whose value space is infinite — offer as snippets. */
	templates: ClassTemplate[];
}

/**
 * Enumerate the finite completion universe for a theme. Every returned class
 * has been resolved by the real utility resolver — `validate()` accepts each
 * one by construction. Infinite families (the spacing scale, numeric values,
 * functional custom utilities) come back as templates; a template is emitted
 * only when at least one of its probes resolved.
 */
export function enumerateClassNames(theme: ResolvedTheme): ClassEnumeration {
	const seen = new Set<string>();
	const classes: EnumeratedClass[] = [];
	const templates: ClassTemplate[] = [];

	// Probe warnings are expected (candidates are over-approximations) — the
	// sink keeps generators from routing them to the dev console.
	const probeWarnings: string[] = [];
	const resolves = (name: string): boolean =>
		resolveUtilityDeclarations(parseUtility(name), theme, probeWarnings) !== null;

	const emit = (name: string, kind: EnumeratedClass["kind"], root: string | null): void => {
		if (seen.has(name)) return;
		if (!resolves(name)) return;
		seen.add(name);
		classes.push({ name, kind, root });
	};

	for (const name of STATIC_UTILITIES) emit(name, "static", null);
	for (const names of [
		ANIMATION_STATIC_NAMES,
		BORDER_STATIC_NAMES,
		BACKGROUND_STATIC_NAMES,
		EFFECTS_STATIC_NAMES,
		LAYOUT_STATIC_NAMES,
		SVG_STATIC_NAMES,
		TYPOGRAPHY_STATIC_NAMES,
	]) {
		for (const name of names) emit(name, "static", null);
	}

	for (const custom of theme.customUtilities) {
		if (custom.functional) {
			templates.push({ root: custom.name, kind: "custom", example: `${custom.name}-value` });
		} else {
			emit(custom.name, "custom", null);
		}
	}

	for (const root of PREFIX_DISPATCH.keys()) {
		const spec = UTILITY_VALUE_SPACES.get(root);
		if (!spec) continue; // narrowing guard; presence is structural (see roots.ts)
		let spacingHit = false;
		let intHit = false;
		for (const kind of spec.kinds) {
			for (const value of candidateValues(kind, theme)) {
				const name = `${root}-${value}`;
				if (seen.has(name)) continue;
				if (!resolves(name)) continue;
				seen.add(name);
				classes.push({ name, kind, root });
				if (kind === "spacing") spacingHit = true;
				if (kind === "int") intHit = true;
			}
		}
		for (const keyword of spec.keywords ?? []) {
			emit(`${root}-${keyword}`, "keywords", root);
		}
		if (spacingHit) templates.push({ root, kind: "spacing", example: `${root}-4` });
		else if (intHit) templates.push({ root, kind: "number", example: `${root}-2` });
	}

	classes.sort((a, b) => codepointCompare(a.name, b.name));
	templates.sort((a, b) => codepointCompare(a.root, b.root));
	return { classes, templates };
}
