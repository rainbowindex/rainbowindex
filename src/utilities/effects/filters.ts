/**
 * Filter & backdrop-filter utilities — the composable slot-var system for
 * blur/brightness/contrast/…/drop-shadow and their backdrop-* counterparts.
 */

import type { ResolvedTheme } from "../../directives/foundation.js";
import {
	deepFreezeUtilityMap,
	extractArbitrary,
	INTEGER_RE,
	multi,
	single,
	type UtilityResult,
} from "../helpers.js";
import { resolveShadowFamily, type ShadowFamily } from "./shadows.js";

/**
 * `drop-shadow-*`. No `initial`: Tailwind does not register one here, and the
 * filter chain has no colour var to unset that the shadow families do.
 */
const DROP_SHADOW: ShadowFamily = {
	none: "0 0 #0000",
	colorVar: "--ri-drop-shadow-color",
	initial: false,
	// One `drop-shadow()` per layer, space-joined: the function takes a single
	// shadow, so a two-layer value written as `drop-shadow(a, b)` is invalid and
	// drops silently.
	wrap: (layers) =>
		multi(
			["--ri-drop-shadow", layers.map((l) => `drop-shadow(${l})`).join(" ")],
			["filter", FILTER_COMPOSED],
		),
};

// ---------------------------------------------------------------------------
// Composable filter / backdrop-filter via CSS variables
// ---------------------------------------------------------------------------

// The slot names and their order live in utilities/property-maps.ts, which the
// merge tables read too — one list, so a slot added here cannot go unclaimed.
import { BACKDROP_FILTER_COMPOSED, FILTER_COMPOSED } from "../property-maps.js";

export const FILTER_STATICS: Readonly<Record<string, UtilityResult>> = {
	// Filter — grayscale/invert/sepia (bare + numeric) are handled dynamically via
	// FILTER_TABLE (bare100). Bare `filter` enables the chain and contributes
	// nothing of its own, which is what makes a v3-era `filter blur-sm` string
	// work; `filter-none` is the reset.
	filter: single("filter", FILTER_COMPOSED),
	"filter-none": single("filter", "none"),

	// Backdrop filter. `backdrop-blur-none` is NOT here: it clears the blur slot
	// and re-emits the chain, exactly as `blur-none` does, so it composes with
	// the other backdrop functions instead of erasing them. It used to be
	// `backdrop-filter: none`, which is the v3 reading — v4.3.3 emits
	// `--tw-backdrop-blur: ;` followed by the chain, and `backdrop-filter-none`
	// is the spelling that really does reset everything.
	"backdrop-filter": single("backdrop-filter", BACKDROP_FILTER_COMPOSED),
};
deepFreezeUtilityMap(FILTER_STATICS);

/**
 * One filter-function mapping: utility prefix → CSS filter function.
 * `bare100` means the bare name (e.g. "grayscale") outputs fn(100%);
 * `negative` means the value supports negation (only hue-rotate).
 */
interface FilterTableEntry {
	prefix: string;
	fn: string;
	bare100?: boolean;
	negative?: boolean;
}

const FILTER_TABLE: readonly FilterTableEntry[] = [
	{ prefix: "brightness-", fn: "brightness" },
	{ prefix: "contrast-", fn: "contrast" },
	{ prefix: "saturate-", fn: "saturate" },
	{ prefix: "grayscale-", fn: "grayscale", bare100: true },
	{ prefix: "invert-", fn: "invert", bare100: true },
	{ prefix: "sepia-", fn: "sepia", bare100: true },
	{ prefix: "hue-rotate-", fn: "hue-rotate", negative: true },
];

/**
 * Resolve one filter-table entry against a utility name. Shared by the
 * filter and backdrop-filter walks — they differ only in slot-var prefix and
 * composed declaration. Returns `undefined` when the entry doesn't match the
 * name at all (caller continues the table walk), `null` when it matches but
 * the value is invalid (walk stops — prefixes are mutually exclusive).
 */
function resolveFilterTableEntry(
	entry: FilterTableEntry,
	full: string,
	negative: boolean,
	varPrefix: string,
	composedProp: string,
	composedValue: string,
): UtilityResult | null | undefined {
	// Bare form (e.g. `grayscale` → grayscale(100%)).
	if (entry.bare100 && full === entry.prefix.slice(0, -1))
		return multi([`${varPrefix}${entry.fn}`, `${entry.fn}(100%)`], [composedProp, composedValue]);
	if (!full.startsWith(entry.prefix)) return undefined;
	const val = full.slice(entry.prefix.length);
	const cssVar = `${varPrefix}${entry.fn}`;
	if (entry.negative) {
		if (INTEGER_RE.test(val))
			return multi(
				[cssVar, `${entry.fn}(${negative ? -Number(val) : Number(val)}deg)`],
				[composedProp, composedValue],
			);
		const arb = extractArbitrary(val);
		if (arb !== null)
			return multi(
				[cssVar, `${entry.fn}(${negative ? `calc(${arb} * -1)` : arb})`],
				[composedProp, composedValue],
			);
	} else {
		if (INTEGER_RE.test(val))
			return multi([cssVar, `${entry.fn}(${val}%)`], [composedProp, composedValue]);
		const arb = extractArbitrary(val);
		if (arb !== null) return multi([cssVar, `${entry.fn}(${arb})`], [composedProp, composedValue]);
	}
	return null;
}

// theme.blur / arbitrary lookup shared by blur and backdrop-blur — they differ
// only in slot var and composed declaration, like the table entries above.
function resolveBlurValue(
	name: string,
	theme: ResolvedTheme,
	cssVar: string,
	composedProp: string,
	composedValue: string,
): UtilityResult | null {
	if (Object.hasOwn(theme.blur, name))
		return multi([cssVar, `blur(${theme.blur[name]})`], [composedProp, composedValue]);
	const arb = extractArbitrary(name);
	if (arb !== null) return multi([cssVar, `blur(${arb})`], [composedProp, composedValue]);
	return null;
}

export function resolveBlur(full: string, theme: ResolvedTheme): UtilityResult | null {
	const name = full === "blur" ? "DEFAULT" : full.slice(5);
	// `blur-none` composes via the slot var rather than resetting the whole
	// `filter` property, so it clears the blur and leaves a sibling `grayscale`
	// alone. `backdrop-blur-none` does the same — see resolveBackdropFilter.
	// A theme entry named `none` replaces the reset rather than losing to it
	// — every named scale resolves theme-first, and RI-1124 warns at definition.
	if (name === "none" && !Object.hasOwn(theme.blur, name))
		return multi(["--ri-blur", "blur(0)"], ["filter", FILTER_COMPOSED]);
	return resolveBlurValue(name, theme, "--ri-blur", "filter", FILTER_COMPOSED);
}

export function resolveFilter(
	full: string,
	negative: boolean,
	theme: ResolvedTheme,
	dataType?: string | null,
): UtilityResult | null {
	for (const entry of FILTER_TABLE) {
		const r = resolveFilterTableEntry(entry, full, negative, "--ri-", "filter", FILTER_COMPOSED);
		if (r !== undefined) return r;
	}
	if (full.startsWith("drop-shadow-")) {
		return resolveShadowFamily(full.slice(12) /* "drop-shadow-" */, theme, dataType, DROP_SHADOW);
	}
	return null;
}

// filter-(--c) / filter-[v]: a literal filter value that overrides the composition.
export function resolveFilterBase(full: string): UtilityResult | null {
	const arb = extractArbitrary(full.slice(7)); // "filter-".length
	if (arb !== null) return single("filter", arb);
	return null;
}

// Backdrop counterparts, derived from FILTER_TABLE so the two walks can never
// diverge, plus the backdrop-only opacity entry. Entry order is irrelevant:
// the prefixes are mutually exclusive, so a name matches at most one entry.
const BACKDROP_FILTERS: readonly FilterTableEntry[] = [
	...FILTER_TABLE.map((entry) => ({ ...entry, prefix: `backdrop-${entry.prefix}` })),
	{ prefix: "backdrop-opacity-", fn: "opacity" },
];

export function resolveBackdropFilter(
	full: string,
	theme: ResolvedTheme,
	negative: boolean,
): UtilityResult | null {
	// backdrop-filter base: none / custom-property / arbitrary (literal value).
	if (full.startsWith("backdrop-filter-")) {
		const v = full.slice(16);
		if (v === "none") return single("backdrop-filter", "none");
		const arb = extractArbitrary(v);
		if (arb !== null) return single("backdrop-filter", arb);
		return null;
	}
	// backdrop-blur uses theme.blur for named values, `none` included: it clears
	// the slot and re-emits the chain, the same shape `resolveBlur` uses, so a
	// sibling `backdrop-invert` survives it. `backdrop-filter-none` is the
	// spelling that resets the whole property.
	if (full.startsWith("backdrop-blur-")) {
		const name = full.slice(14);
		if (name === "") return null;
		if (name === "none" && !Object.hasOwn(theme.blur, name)) {
			return multi(
				["--ri-backdrop-blur", "blur(0)"],
				["backdrop-filter", BACKDROP_FILTER_COMPOSED],
			);
		}
		const blur = resolveBlurValue(
			name,
			theme,
			"--ri-backdrop-blur",
			"backdrop-filter",
			BACKDROP_FILTER_COMPOSED,
		);
		if (blur) return blur;
	}
	if (full === "backdrop-blur") {
		return resolveBlurValue(
			"DEFAULT",
			theme,
			"--ri-backdrop-blur",
			"backdrop-filter",
			BACKDROP_FILTER_COMPOSED,
		);
	}

	// Single table walk (bare form + value forms per entry) — bare names never
	// collide with another entry's dashed prefix, so one pass suffices.
	for (const entry of BACKDROP_FILTERS) {
		const r = resolveFilterTableEntry(
			entry,
			full,
			negative,
			"--ri-backdrop-",
			"backdrop-filter",
			BACKDROP_FILTER_COMPOSED,
		);
		if (r !== undefined) return r;
	}

	return null;
}
