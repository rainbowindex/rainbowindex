/**
 * Filter & backdrop-filter utilities — the composable slot-var system for
 * blur/brightness/contrast/…/drop-shadow and their backdrop-* counterparts.
 */

import type { ResolvedTheme } from "../../directives/foundation.js";
import {
	type UtilityResult,
	single,
	multi,
	extractArbitrary,
	INTEGER_RE,
	deepFreezeUtilityMap,
} from "../helpers.js";
import { resolveScaledShadowFamily } from "./shadows.js";

// ---------------------------------------------------------------------------
// Composable filter / backdrop-filter via CSS variables
// ---------------------------------------------------------------------------

const FILTER_COMPOSED =
	"var(--ri-blur, ) var(--ri-brightness, ) var(--ri-contrast, ) var(--ri-grayscale, ) var(--ri-hue-rotate, ) var(--ri-invert, ) var(--ri-saturate, ) var(--ri-sepia, ) var(--ri-drop-shadow, )";

const BACKDROP_FILTER_COMPOSED =
	"var(--ri-backdrop-blur, ) var(--ri-backdrop-brightness, ) var(--ri-backdrop-contrast, ) var(--ri-backdrop-grayscale, ) var(--ri-backdrop-hue-rotate, ) var(--ri-backdrop-invert, ) var(--ri-backdrop-saturate, ) var(--ri-backdrop-sepia, ) var(--ri-backdrop-opacity, )";

export const FILTER_STATICS: Readonly<Record<string, UtilityResult>> = {
	// Filter — grayscale/invert/sepia (bare + numeric) are handled dynamically via
	// FILTER_TABLE (bare100); only the literal `filter-none` reset is static here.
	"filter-none": single("filter", "none"),

	// Backdrop filter
	"backdrop-blur-none": single("backdrop-filter", "none"),
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

// drop-shadow scale — inline, color-parameterized via --ri-drop-shadow-color (so
// drop-shadow-{color} recolors it) with a light-dark default. Mirrors inset-shadow.
const DROP_SHADOW_COLOR =
	"var(--ri-drop-shadow-color, light-dark(oklch(0 0 0 / 0.1), oklch(0 0 0 / 0.4)))";
const DROP_SHADOWS: Readonly<Record<string, string>> = Object.freeze({
	xs: `0 1px 1px ${DROP_SHADOW_COLOR}`,
	sm: `0 1px 2px ${DROP_SHADOW_COLOR}`,
	md: `0 3px 3px ${DROP_SHADOW_COLOR}`,
	lg: `0 4px 4px ${DROP_SHADOW_COLOR}`,
	xl: `0 9px 7px ${DROP_SHADOW_COLOR}`,
	"2xl": `0 25px 25px ${DROP_SHADOW_COLOR}`,
});

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
	// blur-none composes via the slot var; backdrop-blur-none stays the
	// backdrop-filter:none static in FILTER_STATICS (deliberate asymmetry).
	if (name === "none") return multi(["--ri-blur", "blur(0)"], ["filter", FILTER_COMPOSED]);
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
		return resolveScaledShadowFamily(
			full.slice(12), // "drop-shadow-".length
			DROP_SHADOWS,
			"0 0 #0000",
			"--ri-drop-shadow-color",
			theme,
			dataType,
			(value) => multi(["--ri-drop-shadow", `drop-shadow(${value})`], ["filter", FILTER_COMPOSED]),
		);
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
	// backdrop-blur uses theme.blur for named values ("backdrop-blur-none" is
	// the backdrop-filter:none static in FILTER_STATICS, resolved before this).
	if (full.startsWith("backdrop-blur-")) {
		const name = full.slice(14);
		if (name === "") return null;
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
