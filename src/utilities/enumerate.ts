/**
 * Class enumeration — the completion universe for editor tooling.
 *
 * Design: candidates are generated from a deliberately GENEROUS value-space
 * table (which theme namespaces and keyword families to TRY per functional
 * root), then every candidate is probed through the real utility resolver.
 * The resolver is the single authority — an enumerated class is one that
 * actually compiles, so the table can over-approximate freely and can never
 * emit something `validate()` would reject. Coverage is enforced the other
 * way by tests: every PREFIX_DISPATCH root must appear in the table (an empty
 * spec marks a statics-only root), so adding a generator root without
 * deciding its value space fails CI.
 *
 * Statics come from the merge conflict tables (STATIC_UTILITIES) plus each
 * generator's own static-map keys — probed too, for the same guarantee.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import { codepointCompare } from "../shared.js";
import { SPECIAL_COLORS } from "../merge/props.js";
import { parseUtility } from "./parser.js";
import { resolveUtilityDeclarations, PREFIX_DISPATCH } from "./index.js";
import { STATIC_UTILITIES } from "./metadata.js";
import { ANIMATION_STATIC_NAMES } from "./animations.js";
import { BORDER_STATIC_NAMES, ROUNDED_CORNER_NAMES, ROUNDED_SIDE_NAMES } from "./borders.js";
import { BACKGROUND_STATIC_NAMES, EFFECTS_STATIC_NAMES } from "./effects.js";
import { LAYOUT_STATIC_NAMES } from "./layout.js";
import { SVG_STATIC_NAMES } from "./svg.js";
import { TYPOGRAPHY_STATIC_NAMES } from "./typography.js";

// ---------------------------------------------------------------------------
// Value spaces
// ---------------------------------------------------------------------------

export type ValueSpaceKind =
	| "color"
	| "special-color"
	| "spacing"
	| "fraction"
	| "text-size"
	| "fluid-text-size"
	| "font-slot"
	| "weight"
	| "rounded"
	| "rounded-side"
	| "shadow"
	| "z"
	| "ease"
	| "blur"
	| "animation"
	| "leading"
	| "tracking"
	| "opacity"
	| "duration"
	| "breakpoint"
	| "int"
	| "percent"
	| "keywords";

export interface ValueSpaceSpec {
	kinds: readonly ValueSpaceKind[];
	/** Extra value parts to try verbatim (for "keywords" and beyond). */
	keywords?: readonly string[];
}

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

/** Common spacing-scale steps to enumerate concretely; the space itself is
 *  infinite (`${number}`, underscores for decimals) — see templates. */
const SPACING_SAMPLES = Object.freeze([
	"0",
	"1",
	"1_5",
	"2",
	"2_5",
	"3",
	"4",
	"5",
	"6",
	"8",
	"10",
	"12",
	"16",
	"20",
	"24",
	"px",
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

/** Table groups mirror PREFIX_GROUPS' shape: roots sharing one spec. Roots
 *  appearing in several groups get their kinds/keywords merged. */
const SPEC_GROUPS: ReadonlyArray<readonly [readonly string[], ValueSpaceSpec]> = [
	// Spacing family — the scale is shared; sides/axes are distinct roots.
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
			"indent",
		],
		{ kinds: ["spacing"] },
	],
	[
		[
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
		],
		{ kinds: ["spacing", "fraction"], keywords: ["auto", "full"] },
	],
	// Sizing
	[
		[
			"w",
			"h",
			"size",
			"min",
			"max",
			"min-w",
			"max-w",
			"min-h",
			"max-h",
			"inline",
			"block",
			"basis",
		],
		{ kinds: ["spacing", "fraction"] },
	],
	[["max-w", "basis", "columns"], { kinds: ["breakpoint"] }],
	// Typography
	[["text"], { kinds: ["text-size", "fluid-text-size", "color", "special-color"] }],
	[["font"], { kinds: ["font-slot", "weight"] }],
	[["leading"], { kinds: ["leading", "int"] }],
	[["tracking"], { kinds: ["tracking"] }],
	[
		["decoration"],
		{
			kinds: ["color", "special-color", "int", "keywords"],
			keywords: ["auto", "from-font", "solid", "double", "dotted", "dashed", "wavy"],
		},
	],
	[
		["underline"],
		{
			kinds: ["keywords"],
			keywords: ["offset-auto", "offset-0", "offset-1", "offset-2", "offset-4", "offset-8"],
		},
	],
	[
		["line"],
		{
			kinds: ["keywords"],
			keywords: ["clamp-none", "clamp-1", "clamp-2", "clamp-3", "clamp-4", "clamp-5", "clamp-6"],
		},
	],
	[["tab"], { kinds: ["int"] }],
	[
		["break"],
		{
			kinds: ["keywords"],
			keywords: ["normal", "words", "all", "keep", "after-avoid", "before-avoid", "inside-avoid"],
		},
	],
	[
		[
			"whitespace",
			"italic",
			"truncate",
			"uppercase",
			"lowercase",
			"capitalize",
			"normal",
			"antialiased",
			"subpixel",
			"align",
			"list",
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
		],
		{ kinds: [] },
	],
	// Color-bearing families
	[["bg", "accent", "caret", "fill"], { kinds: ["color", "special-color"] }],
	[
		["bg-linear"],
		{
			kinds: ["keywords"],
			keywords: ["to-t", "to-b", "to-l", "to-r", "to-tl", "to-tr", "to-bl", "to-br"],
		},
	],
	[["bg-conic", "bg-radial"], { kinds: ["int"] }],
	[["border", "divide"], { kinds: ["color", "special-color", "int"] }],
	[["stroke"], { kinds: ["color", "special-color", "int"] }],
	[["from", "via", "to"], { kinds: ["color", "special-color"] }],
	[
		["outline"],
		{
			kinds: ["color", "special-color", "int", "keywords"],
			keywords: ["offset-0", "offset-1", "offset-2", "offset-4", "offset-8"],
		},
	],
	// SVG
	[["stroke-cap"], { kinds: ["keywords"], keywords: ["butt", "round", "square"] }],
	[["stroke-join"], { kinds: ["keywords"], keywords: ["miter", "round", "bevel"] }],
	[["stroke-dash", "stroke-offset", "stroke-miter"], { kinds: ["int"] }],
	[["stroke-opacity"], { kinds: ["opacity", "percent"] }],
	[["paint", "vector"], { kinds: [] }],
	// Layout — overwhelmingly statics; functional exceptions below.
	[
		[
			"contents",
			"hidden",
			"table",
			"flow",
			"static",
			"relative",
			"absolute",
			"fixed",
			"sticky",
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
			"object",
			"cursor",
			"pointer",
			"select",
			"touch",
			"resize",
			"scrollbar",
			"snap",
			"place",
			"sr",
			"box",
			"caption",
			"field",
			"forced",
			"scheme",
			"backface",
			"@container",
			"@anchor",
			"@anchor-to",
			"position-area",
			"anchor-scope",
		],
		{ kinds: [] },
	],
	[["flex"], { kinds: ["int", "keywords"], keywords: ["auto", "initial", "none"] }],
	[
		["grid"],
		{
			kinds: ["keywords"],
			keywords: [
				...Array.from({ length: 12 }, (_, i) => `cols-${i + 1}`),
				...Array.from({ length: 6 }, (_, i) => `rows-${i + 1}`),
				"cols-none",
				"rows-none",
				"cols-subgrid",
				"rows-subgrid",
			],
		},
	],
	[["grow", "shrink"], { kinds: ["int"] }],
	[["order"], { kinds: ["int"], keywords: ["first", "last", "none"] }],
	[
		["col", "row"],
		{
			kinds: ["keywords"],
			keywords: [
				"auto",
				"span-full",
				...Array.from({ length: 12 }, (_, i) => `span-${i + 1}`),
				...Array.from({ length: 13 }, (_, i) => `start-${i + 1}`),
				...Array.from({ length: 13 }, (_, i) => `end-${i + 1}`),
			],
		},
	],
	[["columns"], { kinds: ["int"] }],
	[
		["auto"],
		{
			kinds: ["keywords"],
			keywords: [
				"cols-auto",
				"cols-min",
				"cols-max",
				"cols-fr",
				"rows-auto",
				"rows-min",
				"rows-max",
				"rows-fr",
			],
		},
	],
	[["aspect"], { kinds: ["keywords"], keywords: ["auto", "square", "video"] }],
	[["z"], { kinds: ["z", "int"] }],
	[
		["contain"],
		{
			kinds: ["keywords"],
			keywords: ["none", "strict", "content", "size", "inline-size", "layout", "style", "paint"],
		},
	],
	// Borders
	[["rounded"], { kinds: ["rounded", "rounded-side"] }],
	[
		["corner"],
		{ kinds: ["keywords"], keywords: ["round", "scoop", "bevel", "notch", "square", "squircle"] },
	],
	// Effects
	[["shadow", "text-shadow", "inset-shadow"], { kinds: ["shadow", "color", "special-color"] }],
	[["ring", "inset-ring"], { kinds: ["int", "color", "special-color"] }],
	[["opacity"], { kinds: ["opacity", "percent"] }],
	[
		["transition"],
		{ kinds: ["keywords"], keywords: ["all", "colors", "opacity", "shadow", "transform", "none"] },
	],
	[["duration", "delay"], { kinds: ["duration", "int"] }],
	[["ease"], { kinds: ["ease", "keywords"], keywords: ["linear", "in", "out", "in-out"] }],
	[["transform", "filter", "mask", "origin"], { kinds: [] }],
	[
		["mix"],
		{
			kinds: ["keywords"],
			keywords: [
				"blend-normal",
				"blend-multiply",
				"blend-screen",
				"blend-overlay",
				"blend-darken",
				"blend-lighten",
				"blend-color-dodge",
				"blend-color-burn",
				"blend-hard-light",
				"blend-soft-light",
				"blend-difference",
				"blend-exclusion",
				"blend-hue",
				"blend-saturation",
				"blend-color",
				"blend-luminosity",
			],
		},
	],
	[["grayscale", "invert", "sepia"], { kinds: ["percent"] }],
	[["backdrop"], { kinds: ["keywords"], keywords: ["blur-none", "grayscale", "invert", "sepia"] }],
	[
		["translate"],
		{
			kinds: ["keywords"],
			keywords: [
				...SPACING_SAMPLES.flatMap((s) => [`x-${s}`, `y-${s}`, `z-${s}`]),
				"x-full",
				"y-full",
				"x-1/2",
				"y-1/2",
			],
		},
	],
	[
		["rotate", "skew"],
		{
			kinds: ["keywords"],
			keywords: [
				"0",
				"1",
				"2",
				"3",
				"6",
				"12",
				"45",
				"90",
				"180",
				...["0", "3", "6", "12", "45", "90"].flatMap((v) => [`x-${v}`, `y-${v}`]),
			],
		},
	],
	[
		["scale"],
		{
			kinds: ["keywords"],
			keywords: [
				"0",
				"50",
				"75",
				"90",
				"95",
				"100",
				"105",
				"110",
				"125",
				"150",
				...["0", "50", "75", "90", "95", "100", "105", "110", "125", "150"].flatMap((v) => [
					`x-${v}`,
					`y-${v}`,
				]),
			],
		},
	],
	[
		["will"],
		{
			kinds: ["keywords"],
			keywords: ["change-auto", "change-scroll", "change-contents", "change-transform"],
		},
	],
	[["perspective"], { kinds: ["int"], keywords: ["none", "normal"] }],
	// Animation
	[["animate"], { kinds: ["animation", "keywords"], keywords: ["none", "in", "out"] }],
	[
		["fade", "zoom"],
		{
			kinds: ["keywords"],
			keywords: [
				"in",
				"out",
				"in-0",
				"in-50",
				"in-75",
				"in-95",
				"out-0",
				"out-50",
				"out-75",
				"out-95",
			],
		},
	],
	[
		["spin"],
		{
			kinds: ["keywords"],
			keywords: ["in", "out", "in-45", "in-90", "in-180", "out-45", "out-90", "out-180"],
		},
	],
	[
		["slide"],
		{
			kinds: ["keywords"],
			keywords: [
				"in-from-top",
				"in-from-bottom",
				"in-from-left",
				"in-from-right",
				"out-to-top",
				"out-to-bottom",
				"out-to-left",
				"out-to-right",
			],
		},
	],
	[["blur"], { kinds: ["blur"], keywords: ["none"] }],
];

function buildValueSpaces(): ReadonlyMap<string, ValueSpaceSpec> {
	const table = new Map<string, { kinds: Set<ValueSpaceKind>; keywords: Set<string> }>();
	for (const [roots, spec] of SPEC_GROUPS) {
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

/** Root → value spaces to try. Coverage of every PREFIX_DISPATCH root is
 *  enforced by __tests__/core/enumerate.test.ts. */
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
		if (!spec) continue; // coverage enforced by tests, not at runtime
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
