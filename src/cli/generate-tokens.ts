/**
 * `rainbowindex generate-tokens` — the theme as data, for the places CSS
 * cannot reach.
 *
 * A class name is the right way to style an element, and the wrong way to feed
 * a chart library a series color, tell a canvas what to paint, or hand Figma a
 * palette. Those need the token's value, not a utility that applies it.
 *
 * Two files, because the two audiences want different shapes:
 *
 * - `rainbowindex-tokens.ts` — `tokens.color.brand[500]` as a `var()`
 *   reference, typed `as const` so a typo is a compile error and the editor
 *   completes the names. A `var()` rather than a literal so the value still
 *   follows the cascade: a `[data-theme]` override or a dark-mode flip changes
 *   what it resolves to, which a baked literal could not do.
 * - `tokens.json` — the same theme in the W3C Design Tokens format, which is
 *   what Style Dictionary, Figma plugins, and the rest of that ecosystem read.
 *   Here the values ARE resolved, because a design tool has no cascade to
 *   resolve a `var()` against.
 *
 * Both are deterministic: sorted, derived from the CSS entry alone, so
 * re-running on an unchanged theme rewrites nothing.
 */

import { relative, resolve } from "node:path";
import { analyzeProjectCSS } from "../project/analyze.js";
import { CANONICAL_COLOR_STOPS } from "../theme/swatch.js";
import { resolveColorSwatch } from "../theme/swatch.js";
import type { ResolvedTheme } from "../directives/foundation.js";
import { listThemeTokens } from "../theme/swatch.js";
import type { CLIOptions } from "./args.js";
import { writeFileAtomic } from "./atomic-write.js";
import { loadProjectCSS } from "./css-file.js";

const TOKENS_FILE = "rainbowindex-tokens.ts";
const TOKENS_JSON_FILE = "tokens.json";

/**
 * Sort keys the way JavaScript itself orders them: integer-like keys ascending
 * and first, everything else by codepoint. A plain string sort would print the
 * colour stops as 100, 150, …, 450, 50, 500 — while the JSON, whose object
 * literal JavaScript reorders for us, shows 50, 100, 150. The two files would
 * disagree about the same theme for no reason.
 */
function byKey([a]: [string, unknown], [b]: [string, unknown]): number {
	const na = /^\d+$/.test(a);
	const nb = /^\d+$/.test(b);
	if (na && nb) return Number(a) - Number(b);
	if (na !== nb) return na ? -1 : 1;
	return a < b ? -1 : a > b ? 1 : 0;
}

/** A JS identifier can be written `a.b`; anything else needs `a["b"]`. */
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function key(name: string): string {
	return IDENT_RE.test(name) ? name : JSON.stringify(name);
}

/** Render a nested plain-data object as TypeScript source, sorted. */
function renderObject(value: unknown, indent: string): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number") return String(value);
	const entries = Object.entries(value as Record<string, unknown>).sort(byKey);
	if (entries.length === 0) return "{}";
	const inner = entries
		.map(([k, v]) => `${indent}\t${key(k)}: ${renderObject(v, `${indent}\t`)},`)
		.join("\n");
	return `{\n${inner}\n${indent}}`;
}

/**
 * The token tree, as `var()` references.
 *
 * Only namespaces a project actually declared appear. An empty namespace is
 * omitted rather than emitted as `{}`, so the generated type says what this
 * theme has instead of what the engine could support.
 */
function buildVarTokens(theme: ResolvedTheme): Record<string, unknown> {
	const tokens = listThemeTokens(theme);
	const out: Record<string, unknown> = {};

	const color: Record<string, unknown> = {};
	for (const { name, kind } of tokens.colors) {
		if (kind === "generative") {
			// A generative palette has every canonical stop, whether or not a
			// class used one — the token file is not pruned by usage, because
			// what reads it is code the scanner never sees.
			const stops: Record<string, string> = {};
			for (const stop of CANONICAL_COLOR_STOPS) {
				stops[String(stop)] = `var(--color-${name}-${stop})`;
			}
			color[name] = stops;
		} else {
			color[name] = `var(--color-${name})`;
		}
	}
	if (Object.keys(color).length > 0) out.color = color;

	const simple: Array<[string, string, Record<string, string | number>]> = [
		["text", "text", Object.fromEntries(tokens.textSizes.map((t) => [t.name, t.fontSize]))],
		["breakpoint", "breakpoint", tokens.breakpoints],
		["shadow", "shadow", tokens.shadows],
		["weight", "weight", tokens.weights],
		["ease", "ease", tokens.easing],
		["blur", "blur", tokens.blur],
		["z", "z", tokens.z],
		["leading", "leading", tokens.leading],
		["tracking", "tracking", tokens.tracking],
		["opacity", "opacity", tokens.opacity],
		["duration", "duration", tokens.duration],
		["rounded", "rounded", tokens.radii],
		["animate", "animate", Object.fromEntries(tokens.animations.map((n) => [n, n]))],
	];
	for (const [group, prefix, values] of simple) {
		const names = Object.keys(values);
		if (names.length === 0) continue;
		out[group] = Object.fromEntries(names.map((n) => [n, `var(--${prefix}-${n})`]));
	}

	if (tokens.fonts.length > 0) {
		out.font = Object.fromEntries(tokens.fonts.map((f) => [f.slot, `var(--font-${f.slot})`]));
	}

	return out;
}

/**
 * The same theme as W3C Design Tokens, with values resolved.
 *
 * `$type` follows the spec's names — `color`, `dimension`, `duration`,
 * `fontWeight`, `cubicBezier`, `shadow` — so a Style Dictionary or Figma
 * importer knows what each leaf is without guessing from its group.
 */
function buildDesignTokens(theme: ResolvedTheme): Record<string, unknown> {
	const tokens = listThemeTokens(theme);
	const out: Record<string, unknown> = {};

	const color: Record<string, unknown> = {};
	for (const { name, kind } of tokens.colors) {
		if (kind === "generative") {
			const stops: Record<string, unknown> = {};
			for (const stop of CANONICAL_COLOR_STOPS) {
				const swatch = resolveColorSwatch(theme, name, stop);
				if (swatch === null) continue;
				// Hex, not the authored `oklch()`: this file is read by design
				// tools, and hex is the one color spelling all of them parse.
				// The light form only — a design token has one value, and the
				// dark form belongs to a mode the spec models separately.
				stops[String(stop)] = { $type: "color", $value: swatch.light.hex };
			}
			if (Object.keys(stops).length > 0) color[name] = stops;
			continue;
		}
		const swatch = resolveColorSwatch(theme, name);
		if (swatch !== null) color[name] = { $type: "color", $value: swatch.light.hex };
	}
	if (Object.keys(color).length > 0) out.color = color;

	const typed: Array<[string, string, Record<string, string | number>]> = [
		["text", "dimension", Object.fromEntries(tokens.textSizes.map((t) => [t.name, t.fontSize]))],
		["breakpoint", "dimension", tokens.breakpoints],
		["tracking", "dimension", tokens.tracking],
		["blur", "dimension", tokens.blur],
		["rounded", "dimension", tokens.radii],
		["weight", "fontWeight", tokens.weights],
		["duration", "duration", tokens.duration],
		["ease", "cubicBezier", tokens.easing],
		["shadow", "shadow", tokens.shadows],
		["leading", "number", tokens.leading],
		["opacity", "number", tokens.opacity],
		["z", "number", tokens.z],
	];
	for (const [group, type, values] of typed) {
		const names = Object.keys(values);
		if (names.length === 0) continue;
		out[group] = Object.fromEntries(
			names.map((n) => [n, { $type: type, $value: String(values[n]) }]),
		);
	}

	if (tokens.fonts.length > 0) {
		out.font = Object.fromEntries(
			tokens.fonts.map((f) => [f.slot, { $type: "fontFamily", $value: f.family }]),
		);
	}

	return out;
}

/** Sort every object key, at every depth, so the JSON is diff-stable. */
function sortDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortDeep);
	if (value === null || typeof value !== "object") return value;
	const entries = Object.entries(value as Record<string, unknown>).sort(byKey);
	return Object.fromEntries(entries.map(([k, v]) => [k, sortDeep(v)]));
}

export async function generateTokens(opts: CLIOptions, cwd: string): Promise<void> {
	const { css, cssFile, warnings } = await loadProjectCSS(opts, cwd);
	for (const warning of warnings) console.error(warning);

	const analysis = analyzeProjectCSS(css);
	for (const warning of analysis.warnings) console.error(warning);

	const source = cssFile === null ? "no CSS entry found" : relative(cwd, cssFile);
	const outPath = resolve(cwd, opts.output ?? TOKENS_FILE);
	const jsonPath = resolve(outPath, "..", TOKENS_JSON_FILE);

	const body = `/**
 * Generated by \`rainbowindex generate-tokens\` from ${source}.
 * Do not edit. Re-run the command when the theme changes.
 *
 * Every value is a \`var()\` reference, not a literal, so it still follows the
 * cascade — a \`[data-theme]\` override or a dark-mode flip changes what it
 * resolves to. Use these where a class cannot go: a chart's series colors, a
 * canvas fill, an inline style computed at runtime.
 *
 *   import { tokens } from "./${relative(cwd, outPath)
		.split("\\\\")
		.join("/")
		.replace(/\.tsx?$/, "")}";
 *   <Chart color={tokens.color.brand[500]} />
 */
export const tokens = ${renderObject(buildVarTokens(analysis.theme), "")} as const;

export type Tokens = typeof tokens;
`;

	await writeFileAtomic(outPath, body);
	console.log(`[rainbowindex] Wrote: ${relative(cwd, outPath)}`);

	const designTokens = sortDeep(buildDesignTokens(analysis.theme));
	await writeFileAtomic(jsonPath, `${JSON.stringify(designTokens, null, "\t")}\n`);
	console.log(`[rainbowindex] Wrote: ${relative(cwd, jsonPath)}`);
}
