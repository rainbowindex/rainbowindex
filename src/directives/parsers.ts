/**
 * Directive Body Parsers — directive-specific grammar for parsing body content.
 *
 * This module stays the single import surface for directive body parsing: the
 * grammars with their own weight live in sibling modules (@color in color.js,
 * @font in font.js, and the generic key-value/entry grammars in
 * foundation.js), and everything consumers relied on here is either defined
 * or re-exported below. What remains defined here are the small scalar-body
 * parsers (@text, @spacing, @animate, @fluid, @preflight) and the
 * modifier-shaped directives (@utility, @custom, @source, @rounded, @layer,
 * @register).
 */

import {
	type AnimationDefinition,
	type CornerShape,
	CORNER_SHAPE_KEYWORDS,
} from "../theme/index.js";

import type {
	PreflightConfig,
	CustomUtility,
	CustomVariant,
	SourceDirective,
	LayerConfig,
	PropertyRegistration,
} from "./foundation.js";

import {
	findClosingBrace,
	IDENT_KEY_RE,
	parseKeyValueBody,
	scanEntries,
	topLevelIndexOf,
} from "./foundation.js";
import { stripCSSComments } from "../shared.js";

// Re-exported grammar homes — see the module header.
export { parseKeyValueBody } from "./foundation.js";
export { parseColorBody } from "./color.js";
export { parseFontBody, parseNestedFontBlock } from "./font.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed length for @utility body content to prevent unbounded CSS output. */
const MAX_UTILITY_BODY_LENGTH = 10_000;
/** Maximum allowed length for @custom selector content. */
const MAX_CUSTOM_SELECTOR_LENGTH = 2_000;
/** @custom variant name format — aligns with class parser variant token rules. */
const CUSTOM_VARIANT_NAME_RE = /^[a-z][\w-]*$/;

// ---------------------------------------------------------------------------
// Body Parsers — directive-specific grammar
// ---------------------------------------------------------------------------

/**
 * Parse @text body.
 *
 * ```
 * xs: 0.75rem, calc(1 / 0.75);
 * base: 1rem, 1.5;
 * ```
 */
export function parseTextBody(
	body: string,
	warnings?: string[],
): {
	text: Record<string, { fontSize: string; lineHeight: string }>;
	removals: string[];
} {
	const { entries, removals } = parseKeyValueBody(body, warnings, "text");
	const text: Record<string, { fontSize: string; lineHeight: string }> = {};

	for (const [key, value] of entries) {
		// Depth-aware split so `clamp(2rem, 5vw, 4rem), 1.1` keeps the clamp intact.
		const commaIdx = topLevelIndexOf(value, ",");
		if (commaIdx !== -1) {
			const fontSize = value.slice(0, commaIdx).trim();
			const lineHeight = value.slice(commaIdx + 1).trim();
			text[key] = { fontSize, lineHeight };
		} else {
			text[key] = { fontSize: value.trim(), lineHeight: "1.5" };
		}
	}

	return { text, removals };
}

/**
 * Parse @spacing body.
 *
 * ```
 * base: 0.25rem;
 * ```
 */
export function parseSpacingBody(body: string): {
	base: string | null;
} {
	const { entries } = parseKeyValueBody(body);
	let base: string | null = null;

	for (const [key, value] of entries) {
		if (key === "base") {
			base = value;
		}
	}

	return {
		base,
	};
}

/**
 * Parse @animate body.
 *
 * ```
 * spin: spin 1s linear infinite {
 *   from { transform: rotate(0deg); }
 *   to { transform: rotate(360deg); }
 * }
 * ```
 */
export function parseAnimateBody(body: string): {
	animations: Record<string, AnimationDefinition>;
	removals: string[];
} {
	const animations: Record<string, AnimationDefinition> = {};
	const removals: string[] = [];
	const cleaned = stripCSSComments(body);

	// `name: shorthand { keyframes }` entries. Removals (`!name;` /
	// `--ri-rm: name;`) are only recognized at the top level of the body —
	// never inside keyframe blocks, where `!important` must survive — which
	// scanEntries guarantees by capturing blocks opaquely. Shorthands legally
	// wrap across newlines to their `{`, so newlines never end an entry.
	for (const entry of scanEntries(cleaned, { newlineTerminates: false })) {
		if (entry.removal) {
			removals.push(entry.key);
			continue;
		}
		// Entries without a keyframes block (colon-less fragments, stray
		// `name: value;` lines, unterminated blocks) are dropped, as before.
		if (entry.block === undefined) continue;
		// Names that would emit broken keyframe selectors never parse.
		if (!IDENT_KEY_RE.test(entry.key)) continue;
		animations[entry.key] = { shorthand: entry.value, keyframes: entry.block };
	}

	return { animations, removals };
}

/**
 * Parse @fluid body.
 *
 * ```
 * min: 20rem;
 * max: 80rem;
 * ```
 */
export function parseFluidBody(body: string): {
	min?: string;
	max?: string;
	unit?: string;
	multiplier?: string;
} {
	const { entries } = parseKeyValueBody(body);
	const result: { min?: string; max?: string; unit?: string; multiplier?: string } = {};
	for (const [key, value] of entries) {
		if (key === "min") result.min = value;
		if (key === "max") result.max = value;
		if (key === "unit") result.unit = value;
		if (key === "multiplier") result.multiplier = value;
	}
	return result;
}

/**
 * Parse @preflight body or modifier.
 *
 * - `@preflight;`             → all on
 * - `@preflight off;`         → all off
 * - `@preflight { core: on; forms: off; }` → selective, merged onto `base`
 *
 * Selective bodies merge onto `base` (the config accumulated from earlier
 * @preflight directives) so `@preflight { forms: off; }` followed by
 * `@preflight { interactive: off; }` disables both. Bare and `off` forms are
 * absolute and reset every flag.
 */
export function parsePreflightDirective(
	body: string,
	modifier?: string,
	base?: Readonly<PreflightConfig>,
): PreflightConfig {
	const normalizedModifier = modifier ? stripCSSComments(modifier).trim() : undefined;

	if (normalizedModifier === "off") {
		return {
			core: false,
			typography: false,
			content: false,
			forms: false,
			interactive: false,
			modern: false,
		};
	}

	const allOn: PreflightConfig = {
		core: true,
		typography: true,
		content: true,
		forms: true,
		interactive: true,
		modern: true,
	};

	if (!body) return allOn;

	const config: PreflightConfig = base ? { ...base } : allOn;
	const { entries } = parseKeyValueBody(body);
	for (const [key, value] of entries) {
		const k = key as keyof PreflightConfig;
		if (Object.hasOwn(config, k)) {
			config[k] = value === "on" || value === "true";
		}
	}

	return config;
}

/** Validate a custom-utility name (after the functional `-*` suffix is stripped).
 *  Names with whitespace/semicolons/braces would emit broken selectors — warn
 *  RI-1035 and report invalid so callers skip the utility. */
function isValidUtilityName(name: string, warnings?: string[]): boolean {
	if (IDENT_KEY_RE.test(name)) {
		// The markup scanner rejects candidates containing uppercase (its filter
		// for JS identifiers), so an uppercase utility can never trigger from
		// class/className markup — only via @a/@apply or inline @source. Keep
		// the utility (those paths are legitimate) but say so loudly.
		if (/[A-Z]/.test(name)) {
			warnings?.push(
				`[RI-1038] @utility name "${name}" contains uppercase letters — the markup scanner only matches lowercase tokens, so class="${name}" will never generate it. It still works via @a/@apply and inline @source. Prefer a lowercase-hyphen name.`,
			);
		}
		return true;
	}
	warnings?.push(
		`[RI-1035] Invalid @utility name "${name}" — names may only contain letters, numbers, hyphens, and underscores (plus an optional trailing "-*" for functional utilities). The utility was skipped.`,
	);
	return false;
}

/**
 * Parse @utility body.
 *
 * ```
 * @utility card { background: var(--color-surface); padding: ... }
 * @utility tab-size-* { tab-size: var(--value); }
 * ```
 */
export function parseUtilityDirective(
	body: string,
	modifier?: string,
	warnings?: string[],
): CustomUtility | null {
	const normalizedModifier = modifier ? stripCSSComments(modifier).trim() : "";
	if (!normalizedModifier) return null;
	if (body.length > MAX_UTILITY_BODY_LENGTH) {
		warnings?.push(
			`[RI-1015] @utility "${normalizedModifier}" body exceeds ${MAX_UTILITY_BODY_LENGTH} characters (${body.length}) — directive skipped.`,
		);
		return null;
	}
	const normalizedBody = stripCSSComments(body).trim();
	const functional = normalizedModifier.endsWith("-*");
	const name = functional ? normalizedModifier.slice(0, -2) : normalizedModifier;
	if (!isValidUtilityName(name, warnings)) return null;
	return { name, functional, body: normalizedBody };
}

/**
 * Lift colon-less `name { … }` blocks out of a named-scale directive body.
 *
 * Every scale that feeds exactly one class prefix takes these, so the math can
 * sit beside the tokens it reads — radius math in `@rounded`, shadow math in
 * `@shadow`. The block uses the `@utility` grammar and the name is namespaced
 * with the family's prefix, so `@shadow { lifted-* { … } }` defines
 * `shadow-lifted-*`.
 *
 * The colon is what separates the two block meanings already in this grammar:
 * `key: value { … }` is the directive's own block (`@color` options, `@animate`
 * keyframes) and is left untouched. Only a block with no key before it is a
 * utility.
 *
 * Returns the body with the lifted spans cut out, so each directive's existing
 * parser still sees only what it already understood.
 */
export function extractUtilityBlocks(
	body: string,
	prefix: string,
	newlineTerminates: boolean,
	warnings?: string[],
): { rest: string; utilities: CustomUtility[]; cut: boolean } {
	const cleaned = stripCSSComments(body);
	const utilities: CustomUtility[] = [];
	const cuts: Array<[number, number]> = [];
	for (const entry of scanEntries(cleaned, { newlineTerminates })) {
		if (!entry.fragment || entry.block === undefined) continue;
		const util = parseUtilityDirective(entry.block, `${prefix}-${entry.value}`, warnings);
		if (util) utilities.push(util);
		// Cut the span even when the name was rejected: leaving a malformed block
		// behind would only make the directive's own parser warn about it twice.
		cuts.push([entry.start, entry.end]);
	}
	if (cuts.length === 0) return { rest: cleaned, utilities, cut: false };
	let rest = "";
	let at = 0;
	for (const [start, end] of cuts) {
		rest += cleaned.slice(at, start);
		at = end;
	}
	return { rest: rest + cleaned.slice(at), utilities, cut: true };
}

/**
 * Parse a grouped @utility block (no modifier) containing multiple named utilities.
 *
 * ```
 * @utility {
 *   flex-center {
 *     display: flex;
 *     align-items: center;
 *   }
 *   text-shadow {
 *     text-shadow: 0 2px 4px rgb(0 0 0 / 0.1);
 *   }
 * }
 * ```
 */
export function parseGroupedUtilityDirective(body: string, warnings?: string[]): CustomUtility[] {
	const results: CustomUtility[] = [];
	const cleaned = stripCSSComments(body).trim();
	let i = 0;

	while (i < cleaned.length) {
		// Skip whitespace
		while (i < cleaned.length && /\s/.test(cleaned[i])) i++;
		if (i >= cleaned.length) break;

		// Read utility name (up to '{')
		let nameEnd = i;
		while (nameEnd < cleaned.length && cleaned[nameEnd] !== "{") nameEnd++;
		const name = cleaned.slice(i, nameEnd).trim();
		if (!name || nameEnd >= cleaned.length) {
			if (name) {
				warnings?.push(
					`[RI-1015] Grouped @utility: missing opening brace for "${name}" — skipped.`,
				);
			}
			break;
		}

		// Find matching closing brace
		const closePos = findClosingBrace(cleaned, nameEnd);
		if (closePos === -1) {
			warnings?.push(`[RI-1015] Grouped @utility: unmatched brace for "${name}" — skipped.`);
			break;
		}

		const innerBody = cleaned.slice(nameEnd + 1, closePos).trim();
		if (innerBody.length > MAX_UTILITY_BODY_LENGTH) {
			warnings?.push(
				`[RI-1015] @utility "${name}" body exceeds ${MAX_UTILITY_BODY_LENGTH} characters (${innerBody.length}) — directive skipped.`,
			);
			i = closePos + 1;
			continue;
		}

		const functional = name.endsWith("-*");
		const baseName = functional ? name.slice(0, -2) : name;
		if (isValidUtilityName(baseName, warnings)) {
			results.push({ name: baseName, functional, body: innerBody });
		}

		i = closePos + 1;
	}
	return results;
}

/**
 * Parse @custom.
 *
 * ```
 * @custom hocus (&:hover, &:focus);
 * @custom any-hover (@media (any-hover: hover));
 * @custom hocus { &:hover, &:focus { @slot; } }
 * ```
 */
export function parseCustomVariantDirective(
	body: string,
	modifier?: string,
	warnings?: string[],
): CustomVariant | null {
	const normalizedModifier = modifier ? stripCSSComments(modifier).trim() : "";
	const normalizedBody = stripCSSComments(body).trim();
	if (!normalizedModifier) return null;
	const isValidCustomVariantName = (name: string): boolean => {
		if (CUSTOM_VARIANT_NAME_RE.test(name)) return true;
		warnings?.push(
			`[RI-1017] @custom variant name "${name}" is invalid. Use lowercase letters, numbers, hyphens, or underscores, and start with a letter.`,
		);
		return false;
	};
	// modifier contains the variant name, and possibly the selector inline
	// e.g. modifier = "hocus (&:hover, &:focus)" (inline form)
	// or modifier = "hocus" with body containing the block form
	const parenMatch = normalizedModifier.match(/^([\w-]+)\s*\((.+)\)$/s);
	if (parenMatch) {
		if (!isValidCustomVariantName(parenMatch[1])) return null;
		const selector = parenMatch[2].trim();
		if (!selector) return null;
		if (selector.length > MAX_CUSTOM_SELECTOR_LENGTH) {
			warnings?.push(
				`[RI-1016] @custom "${parenMatch[1]}" selector exceeds ${MAX_CUSTOM_SELECTOR_LENGTH} characters (${selector.length}) — directive skipped.`,
			);
			return null;
		}
		return { name: parenMatch[1], selector };
	}

	// Block form: modifier is just the name, body has the content
	// e.g. body = "&:hover, &:focus { @slot; }"
	// Extract the selector wrapper by removing @slot; and the inner braces
	const name = normalizedModifier.trim();
	if (!isValidCustomVariantName(name)) return null;
	if (normalizedBody) {
		let selector = normalizedBody;
		// If body contains @slot, extract the selector wrapping it
		if (normalizedBody.includes("@slot")) {
			// Match pattern: selector { @slot; }
			const slotMatch = normalizedBody.match(/^([\s\S]+?)\s*\{\s*@slot\s*;?\s*\}$/);
			if (slotMatch) {
				selector = slotMatch[1].trim();
			} else {
				// Fallback: just strip @slot; from the body
				selector = normalizedBody.replace(/@slot\s*;?/g, "").trim();
			}
		}
		if (!selector) return null;
		if (selector.length > MAX_CUSTOM_SELECTOR_LENGTH) {
			warnings?.push(
				`[RI-1016] @custom "${name}" selector exceeds ${MAX_CUSTOM_SELECTOR_LENGTH} characters (${selector.length}) — directive skipped.`,
			);
			return null;
		}
		return { name, selector };
	}

	return null;
}

/**
 * Parse @source directive.
 *
 * ```
 * @source "./src/**\/*.{ts,tsx}";
 * @source not "./node_modules/**\/*";
 * @source inline("underline text-red-500");
 * ```
 */
export function parseSourceDirective(body: string, modifier?: string): SourceDirective | null {
	const raw = stripCSSComments(modifier || body || "").trim();
	if (!raw) return null;

	// @source inline("...")
	const inlineMatch = raw.match(/^inline\(["'](.+?)["']\)$/);
	if (inlineMatch) {
		return {
			pattern: "",
			negated: false,
			inline: true,
			classes: inlineMatch[1].split(/\s+/).filter(Boolean),
		};
	}

	// @source not "pattern"
	const negated = raw.startsWith("not ");
	const pattern = (negated ? raw.slice(4) : raw).trim().replace(/["']/g, "");

	return { pattern, negated, inline: false };
}

/** Keywords accepted by `@rounded <shape>` — derived from the theme's source list. */
const CORNER_SHAPE_KEYWORD_SET = new Set<string>(CORNER_SHAPE_KEYWORDS);

/**
 * Parse the `@rounded <shape>` modifier.
 *
 * Accepts any `corner-shape` value: `round`, `scoop`, `bevel`, `notch`,
 * `square`, `squircle`, or `superellipse(N)`. Returns `null` if no modifier
 * was provided or the input is unrecognized — callers should skip setting
 * a shape in that case.
 */
export function parseRoundedModifier(modifier?: string): CornerShape | null {
	if (!modifier) return null;
	const m = stripCSSComments(modifier).trim();
	if (CORNER_SHAPE_KEYWORD_SET.has(m)) {
		return m as CornerShape;
	}
	const match = m.match(/^superellipse\((\d+(?:\.\d+)?)\)$/);
	if (match) {
		const n = Number.parseFloat(match[1]);
		if (!Number.isNaN(n)) return { superellipse: n };
	}
	return null;
}

// ---------------------------------------------------------------------------
// @layer
// ---------------------------------------------------------------------------

const VALID_LAYER_KEYS = new Set(["order", "utilities", "base"]);

/**
 * Parse @layer directive.
 *
 * Simple form:  `@layer utilities;`  → modifier="utilities", body=""
 * Body form:    `@layer { order: base, utilities; utilities: utilities; base: base; }`
 */
export function parseLayerDirective(
	body: string,
	modifier: string | undefined,
	warnings: string[],
): LayerConfig {
	// Simple form: @layer <name>;
	if (!body && modifier) {
		return { order: null, utilities: null, base: null, wrapAll: modifier };
	}

	// Body form: @layer { order: ...; utilities: ...; base: ...; }
	const { entries } = parseKeyValueBody(body, warnings, "layer");
	let order: string[] | null = null;
	let utilities: string | null = null;
	let base: string | null = null;

	for (const [key, value] of entries) {
		if (!VALID_LAYER_KEYS.has(key)) {
			warnings.push(
				`[RI-1120] Unknown @layer option "${key}" — supported: order, utilities, base.`,
			);
			continue;
		}
		switch (key) {
			case "order":
				order = value
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
				break;
			case "utilities":
				utilities = value;
				break;
			case "base":
				base = value;
				break;
		}
	}

	return { order, utilities, base, wrapAll: null };
}

// ---------------------------------------------------------------------------
// @register — custom-property registration (emits @property rules)
// ---------------------------------------------------------------------------

/**
 * Descriptor keys recognized inside an `@register` body. Anything else that
 * starts with `--` is treated as a per-property entry whose value is its
 * `initial-value`.
 */
const REGISTER_DESCRIPTOR_KEYS = new Set(["syntax", "inherits", "initial-value"]);

/** Normalize a `syntax` descriptor: strip one layer of surrounding quotes, then
 *  re-quote (a `@property` syntax descriptor must be a string). Reports whether
 *  the syntax is the universal `*`, for which `initial-value` is optional. */
function normalizeSyntax(raw: string | undefined): { quoted: string; universal: boolean } {
	const unquoted = (raw ?? "*")
		.trim()
		.replace(/^["']|["']$/g, "")
		.trim();
	return { quoted: `"${unquoted}"`, universal: unquoted === "*" };
}

/**
 * Parse an `@register` directive into zero or more property registrations.
 *
 * Two authoring forms are supported:
 *
 * 1. **Grouped name list** — names in the modifier share one definition in the body:
 *    ```css
 *    @register --a, --b, --c { syntax: "<length>"; inherits: false; initial-value: 0px; }
 *    ```
 * 2. **Shared-defaults block** — block-level `syntax`/`inherits`/`initial-value`
 *    defaults plus one `--name: <initial>` entry per property:
 *    ```css
 *    @register { syntax: "<length>"; inherits: false; --a: 0px; --b: 8px; }
 *    ```
 *
 * `inherits` defaults to `false` and `syntax` to `"*"`. A typed (non-universal)
 * registration with no `initial-value` is dropped with a warning, since the
 * browser would ignore it anyway.
 */
export function parseRegisterBody(
	modifier: string | undefined,
	body: string,
	warnings: string[],
): PropertyRegistration[] {
	const { entries } = parseKeyValueBody(body, warnings, "register");

	let syntaxRaw: string | undefined;
	let inheritsRaw: string | undefined;
	let initialRaw: string | undefined;
	const bodyNames: Array<[string, string]> = [];
	for (const [key, value] of entries) {
		if (key === "syntax") syntaxRaw = value;
		else if (key === "inherits") inheritsRaw = value;
		else if (key === "initial-value") initialRaw = value;
		else if (key.startsWith("--")) bodyNames.push([key, value]);
		else if (!REGISTER_DESCRIPTOR_KEYS.has(key)) {
			warnings.push(
				`[RI-1031] Unknown @register entry "${key}" — expected syntax, inherits, initial-value, or a "--custom-property: <initial>" entry.`,
			);
		}
	}

	const { quoted: syntax, universal } = normalizeSyntax(syntaxRaw);
	const inherits = (inheritsRaw ?? "").trim().toLowerCase() === "true";

	const out: PropertyRegistration[] = [];

	// Dedup (last-wins) is applied globally in the resolver so it spans multiple
	// @register directives, not just repeats within a single block.
	const add = (name: string, initial: string | undefined) => {
		if (!name.startsWith("--")) {
			warnings.push(
				`[RI-1028] Invalid @register property name "${name}" — custom property names must start with "--" (e.g. --my-var). Skipped.`,
			);
			return;
		}
		const initialValue = initial && initial.length > 0 ? initial : undefined;
		if (!universal && initialValue === undefined) {
			warnings.push(
				`[RI-1029] @register property "${name}" has syntax ${syntax} but no initial-value — a typed @property without one is ignored by browsers. Add an initial-value or use syntax "*". Skipped.`,
			);
			return;
		}
		out.push({ name, syntax, inherits, initialValue });
	};

	const modifierNames = (modifier ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	if (modifierNames.length > 0) {
		// Form 1: the body is one shared definition applied to every listed name.
		for (const name of modifierNames) add(name, initialRaw);
	}
	// Per-property entries are always honored (their own value is the initial-value,
	// falling back to a block-level initial-value when omitted). This also covers
	// Form 2 when no modifier names are present.
	for (const [name, value] of bodyNames) add(name, value || initialRaw);

	if (modifierNames.length === 0 && bodyNames.length === 0) {
		warnings.push(
			`[RI-1031] @register declared no properties — provide a name list (\`@register --a, --b { … }\`) or "--name: <initial>" entries.`,
		);
	}

	return out;
}
