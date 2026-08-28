/**
 * Compile-time CSS function substitution.
 *
 * - `--alpha(color / opacity)` → `color-mix(in oklab, color opacity%, transparent)`
 * - `--spacing(n)` → `calc(n * var(--spacing))` or `0px` for n=0
 * - `--theme(--var)` → `var(--var)` with build-time validation
 * - `--theme(--var, fallback)` → `var(--var, fallback)`
 * - `--theme(--var inline)` → raw inlined value (for @media contexts)
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import { findClosest } from "../engine/suggest.js";
import { isValidColorSuffix } from "../theme/index.js";
import { clampAlphaPercent, mixColorAlpha } from "./alpha.js";

/** Prefixes that trigger CSS function compilation. */
const CSS_FUNCTION_PREFIXES = ["--alpha(", "--spacing(", "--theme("] as const;

/** Check whether a CSS value contains any compile-time CSS function calls. */
export function hasCSSFunctions(value: string): boolean {
	// Fast-path: all RI CSS functions start with "--", so skip the .some()
	// loop for the vast majority of declarations that contain no custom functions.
	if (!value.includes("--")) return false;
	return CSS_FUNCTION_PREFIXES.some((p) => value.includes(p));
}

// ---------------------------------------------------------------------------
// Shared balanced-paren extraction
// ---------------------------------------------------------------------------

/**
 * Extract all occurrences of `prefix(...)` from a string, handling nested
 * parens and string literals. Returns the result string after applying
 * `transform` to each extracted inner content.
 *
 * Used by --alpha(), --spacing(), and --theme() to avoid code duplication.
 */
function replaceBalancedCalls(
	value: string,
	prefix: string,
	transform: (inner: string) => string,
): string {
	let result = "";
	let i = 0;

	while (i < value.length) {
		const idx = value.indexOf(prefix, i);
		if (idx === -1) {
			result += value.slice(i);
			break;
		}
		result += value.slice(i, idx);

		// Find matching closing paren with balanced depth
		const start = idx + prefix.length;
		let depth = 1;
		let end = start;
		while (end < value.length && depth > 0) {
			const ch = value[end];
			// Skip CSS escape sequences (e.g., \) inside unquoted values)
			if (ch === "\\" && end + 1 < value.length) {
				end += 2; // skip escaped character
				continue;
			}
			// Skip CSS comments
			if (ch === "/" && value[end + 1] === "*") {
				const commentEnd = value.indexOf("*/", end + 2);
				end = commentEnd === -1 ? value.length : commentEnd + 2;
				continue;
			}
			// Skip string literals inside function args
			if (ch === '"' || ch === "'") {
				const quote = ch;
				end++;
				while (end < value.length && value[end] !== quote) {
					if (value[end] === "\\" && end + 1 < value.length) end++;
					end++;
				}
			} else if (ch === "(") {
				depth++;
			} else if (ch === ")") {
				depth--;
			}
			if (depth > 0) end++;
		}

		if (depth > 0) {
			// Unclosed call — pass through unchanged
			result += value.slice(idx, value.length);
			i = value.length;
			break;
		}

		const inner = value.slice(start, end).trim();
		result += transform(inner);
		i = end + 1;
	}

	return result;
}

// ---------------------------------------------------------------------------
// --alpha(color / opacity)
// ---------------------------------------------------------------------------

/**
 * Compile `--alpha(color / opacity)` using balanced-paren extraction.
 * Handles nested parens in both color and opacity (e.g., `var(...)`, `calc(...)`).
 */
function compileAlpha(value: string): string {
	return replaceBalancedCalls(value, "--alpha(", (inner) => {
		// Find the last `/` at depth 0 to split color / opacity.
		// Reverse scan skips string literals and tracks paren depth.
		let slashIdx = -1;
		let d = 0;
		for (let j = inner.length - 1; j >= 0; j--) {
			const ch = inner[j];
			if (ch === ")") {
				d++;
			} else if (ch === "(") {
				d--;
			} else if ((ch === '"' || ch === "'") && d === 0) {
				// Skip backwards over string literal, handling escaped quotes.
				// Count consecutive backslashes before a quote to determine if
				// the quote is escaped (odd count) or not (even count).
				const quote = ch;
				j--;
				while (j >= 0) {
					if (inner[j] === quote) {
						// Count backslashes preceding this quote
						let bs = 0;
						while (j - 1 - bs >= 0 && inner[j - 1 - bs] === "\\") bs++;
						if (bs % 2 === 0) break; // Even backslashes → unescaped quote (opening)
						j--; // Odd backslashes → escaped quote, continue scanning
					} else {
						j--;
					}
				}
				// j now points at opening quote (or -1); loop decrement moves past it
			} else if (ch === "/" && d === 0) {
				slashIdx = j;
				break;
			}
		}

		if (slashIdx === -1) {
			// No separator — pass through unchanged
			return `--alpha(${inner})`;
		}
		const color = inner.slice(0, slashIdx).trim();
		const opacity = inner.slice(slashIdx + 1).trim();
		return compileAlphaValue(color, opacity);
	});
}

function compileAlphaValue(color: string, opacity: string): string {
	const isExplicitPercent = opacity.endsWith("%");
	const raw = isExplicitPercent ? opacity.slice(0, -1) : opacity;
	const op = Number.parseFloat(raw);

	if (Number.isNaN(op)) {
		// Non-numeric opacity (var()/calc()) — pass it through for the browser
		// to resolve. An empty opacity has nothing to pass through; keep the
		// implicit 50/50 mix.
		if (opacity === "") return `color-mix(in oklab, ${color}, transparent)`;
		return mixColorAlpha(color, opacity);
	}

	// Shared normalization with the utility alpha-modifier path (css/alpha.ts):
	// explicit % passes through, bare ≤ 1 is a fraction, 100 drops the mix.
	return mixColorAlpha(color, clampAlphaPercent(op, isExplicitPercent));
}

// ---------------------------------------------------------------------------
// --spacing(n)
// ---------------------------------------------------------------------------

/** Strict decimal `<number>` grammar (CSS-compatible, optional exponent).
 *  `Number()` alone also accepts "", hex/octal/binary literals, and Infinity —
 *  which would silently emit `0px` for `--spacing()` or invalid CSS like
 *  `calc(0x10 * var(--spacing))`. */
const DECIMAL_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Compile `--spacing(n)` using balanced-paren extraction.
 * Handles nested parens in the argument (e.g., `--spacing(calc(2 + 3))`).
 */
function compileSpacing(value: string, warnings?: string[]): string {
	return replaceBalancedCalls(value, "--spacing(", (inner) => {
		if (!DECIMAL_NUMBER_RE.test(inner)) {
			warnings?.push(
				`[RI-2005] --spacing(${inner}) received a non-numeric argument and was left unchanged. Only literal numbers are supported (e.g., --spacing(4)). For dynamic values, use calc(${inner} * var(--spacing)) directly.`,
			);
			return `--spacing(${inner})`;
		}
		if (Number(inner) === 0) return "0px";
		return `calc(${inner} * var(--spacing))`;
	});
}

// ---------------------------------------------------------------------------
// --theme(key) / --theme(key, fallback) / --theme(key inline)
// ---------------------------------------------------------------------------

/**
 * Replace `--theme(...)` calls using balanced-paren extraction
 * so that fallback values containing parens (e.g. `rgb(255,0,0)`) work.
 */
function compileTheme(value: string, theme?: ResolvedTheme, warnings?: string[]): string {
	return replaceBalancedCalls(value, "--theme(", (args) => {
		return resolveThemeArgs(args, theme, warnings);
	});
}

function resolveThemeArgs(trimmed: string, theme?: ResolvedTheme, warnings?: string[]): string {
	// Check for `inline` modifier: --theme(--breakpoint-md inline)
	if (trimmed.endsWith(" inline")) {
		const varName = trimmed.slice(0, -" inline".length).trim();
		if (theme) {
			const raw = lookupThemeValue(varName, theme, true);
			if (raw !== null) return raw;
			// Inline mode must resolve — var() won't work in @media contexts.
			// Color and font variables cannot be inlined because their values
			// are computed dynamically by the generation pipeline.
			const knownVars = collectThemeVariableNames(theme);
			const isKnownVar = lookupThemeValue(varName, theme, false) !== null;
			const suggestion = isKnownVar ? null : findClosest(varName, knownVars);
			const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
			const reason = isKnownVar
				? " Color and font variables cannot be inlined — their values are computed dynamically. Use var() syntax instead, or use inline mode only with scalar theme values (breakpoints, spacing, text sizes, etc.)."
				: " The variable does not exist in the current theme.";
			const msg = `[RI-2002] Could not inline value for theme function: ${varName}.${hint}${reason} Inline mode requires the variable to be resolvable at build time.`;
			// Always fall back to var() instead of throwing — callers may omit
			// the optional warnings array, and an unhandled throw would crash.
			if (warnings) {
				warnings.push(msg);
			} else {
				console.warn(msg);
			}
			return `var(${varName})`;
		}
		// No theme provided — fallback to var()
		return `var(${varName})`;
	}

	// Check for fallback: --theme(--color-red-500, blue)
	// Find the first comma that's not inside parens
	let depth = 0;
	let commaIdx = -1;
	for (let j = 0; j < trimmed.length; j++) {
		if (trimmed[j] === "(") depth++;
		else if (trimmed[j] === ")") depth--;
		else if (trimmed[j] === "," && depth === 0) {
			commaIdx = j;
			break;
		}
	}
	if (commaIdx !== -1) {
		const varName = trimmed.slice(0, commaIdx).trim();
		const fallback = trimmed.slice(commaIdx + 1).trim();
		return `var(${varName}, ${fallback})`;
	}

	// Simple: --theme(--color-red-500)
	const varName = trimmed;

	// Build-time validation: check if variable exists
	if (theme) {
		const exists = lookupThemeValue(varName, theme);
		if (exists === null) {
			const knownVars = collectThemeVariableNames(theme);
			const suggestion = findClosest(varName, knownVars);
			const hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
			const msg =
				`[RI-2001] Could not resolve value for theme function: ${varName}. ` +
				`The variable does not exist in the current theme.${hint} ` +
				`Add a fallback value (e.g., --theme(${varName}, <fallback>)) or define the variable in your directives.`;
			if (warnings) {
				warnings.push(msg);
			} else {
				console.warn(msg);
			}
		}
	}

	return `var(${varName})`;
}

/**
 * Look up a CSS variable name in the resolved theme.
 * Returns the raw value or null if not found.
 *
 * When `inline` is true, the caller needs the actual computed value (not a
 * var() reference) for use in contexts like @media queries where var() doesn't
 * work. Color and font variables return null in inline mode because their
 * values are computed dynamically by the generation pipeline and cannot be
 * resolved at theme-lookup time.
 */

// Hoisted regex patterns — compiled once instead of per-call.
const RE_COLOR_HUE_STOP = /^color-([\w-]+)-(\d+)$/;
const RE_COLOR_SINGLE = /^color-([\w-]+)$/;
const RE_ANIMATE = /^animate-([\w-]+)$/;
const RE_TEXT = /^text-([\w-]+)$/;
const RE_TEXT_LEADING = /^text-([\w-]+)-leading$/;
const RE_SHADOW = /^shadow-([\w-]+)$/;
const RE_BREAKPOINT = /^breakpoint-([\w-]+)$/;
const RE_FONT_SUB_VAR = /--(?:features|variations)$/;

/** Cached font slot Sets per theme — avoids rebuilding on every lookup. */
const _fontSlotCache = new WeakMap<ResolvedTheme, Set<string>>();
function getFontSlots(theme: ResolvedTheme): Set<string> {
	let cached = _fontSlotCache.get(theme);
	if (!cached) {
		cached = new Set(["sans", "serif", "mono", ...theme.fonts.map((f) => f.slot)]);
		_fontSlotCache.set(theme, cached);
	}
	return cached;
}

function lookupThemeValue(varName: string, theme: ResolvedTheme, inline = false): string | null {
	// Strip leading -- for matching
	const name = varName.startsWith("--") ? varName.slice(2) : varName;

	// Color variables: --color-{hue}-{stop}
	const colorMatch = name.startsWith("color-") ? name.match(RE_COLOR_HUE_STOP) : null;
	if (colorMatch) {
		const [, hue, stopStr] = colorMatch;
		const stop = Number(stopStr);
		if (Object.hasOwn(theme.colors, hue) && isValidColorSuffix(stop)) {
			// Color values are computed dynamically by the color generation
			// pipeline and cannot be inlined at theme-lookup time.
			return inline ? null : `var(${varName})`;
		}
	}

	// Explicit/pair color variables: --color-{name}
	const singleColorMatch = name.startsWith("color-") ? name.match(RE_COLOR_SINGLE) : null;
	if (singleColorMatch) {
		const def = theme.colors[singleColorMatch[1]];
		if (def && (def.type === "explicit" || def.type === "pair")) {
			return inline ? null : `var(${varName})`;
		}
	}

	// Semantic colors
	if (name === "color-paper" || name === "color-ink") return inline ? null : `var(${varName})`;

	// Animation tokens: --animate-{name}
	const animMatch = name.startsWith("animate-") ? name.match(RE_ANIMATE) : null;
	if (animMatch && Object.hasOwn(theme.animations, animMatch[1]))
		return theme.animations[animMatch[1]].shorthand;

	// Text leading: --text-{size}-leading (check before --text-{size} to avoid prefix match)
	const textLeadingMatch = name.startsWith("text-") ? name.match(RE_TEXT_LEADING) : null;
	if (textLeadingMatch && Object.hasOwn(theme.text, textLeadingMatch[1]))
		return inline ? theme.text[textLeadingMatch[1]].lineHeight : `var(${varName})`;

	// Text scale: --text-{size}
	const textMatch = name.startsWith("text-") ? name.match(RE_TEXT) : null;
	if (textMatch && Object.hasOwn(theme.text, textMatch[1]))
		return inline ? theme.text[textMatch[1]].fontSize : `var(${varName})`;

	// Font variables: --font-{slot} — validate against configured font slots
	if (name.startsWith("font-")) {
		const fontSlot = name.slice("font-".length);
		const baseSlot = fontSlot.replace(RE_FONT_SUB_VAR, "");
		if (getFontSlots(theme).has(baseSlot)) return inline ? null : `var(${varName})`;
		return null;
	}

	// Shadow: --shadow-{size}
	const shadowMatch = name.startsWith("shadow-") ? name.match(RE_SHADOW) : null;
	if (shadowMatch && Object.hasOwn(theme.shadows, shadowMatch[1]))
		return theme.shadows[shadowMatch[1]];

	// Breakpoints: --breakpoint-{name}
	const bpMatch = name.startsWith("breakpoint-") ? name.match(RE_BREAKPOINT) : null;
	if (bpMatch && Object.hasOwn(theme.breakpoints, bpMatch[1])) return theme.breakpoints[bpMatch[1]];

	// Fluid: --fluid-min, --fluid-max
	if (name === "fluid-min") return theme.fluid.min;
	if (name === "fluid-max") return theme.fluid.max;
	if (name === "fluid-text-min") return theme.textFluid?.min ?? theme.fluid.min;
	if (name === "fluid-text-max") return theme.textFluid?.max ?? theme.fluid.max;
	if (name === "fluid-spacing-min") return theme.spacingFluid?.min ?? theme.fluid.min;
	if (name === "fluid-spacing-max") return theme.spacingFluid?.max ?? theme.fluid.max;

	// Spacing base: --spacing
	if (name === "spacing") return theme.spacing.base;

	return null;
}

/**
 * Collect all known CSS variable names from the theme for typo suggestions.
 * Cached per theme object reference to avoid regenerating on every failed
 * lookup within a single compilation pass. Since resolveDirectives() creates
 * one theme object per compilation, the cache is effective for the lifetime
 * of that pass. Across compilations the old theme object is GC'd via WeakMap.
 */
/** Representative suffixes for typo suggestions (every 50, 1–999). */
const SUGGESTION_SUFFIXES: readonly number[] = (() => {
	const s: number[] = [];
	for (let i = 50; i <= 950; i += 50) s.push(i);
	return s;
})();

const _themeVarCache = new WeakMap<ResolvedTheme, string[]>();
function collectThemeVariableNames(theme: ResolvedTheme): string[] {
	const cached = _themeVarCache.get(theme);
	if (cached) return cached;
	const names: string[] = [
		"--spacing",
		"--fluid-min",
		"--fluid-max",
		"--fluid-text-min",
		"--fluid-text-max",
		"--fluid-spacing-min",
		"--fluid-spacing-max",
		"--color-paper",
		"--color-ink",
	];

	for (const [hue, def] of Object.entries(theme.colors)) {
		if (def.type === "keyword") continue; // inlined directly, no CSS variable
		if (def.type === "generative" || def.type === "alias") {
			for (const stop of SUGGESTION_SUFFIXES) {
				names.push(`--color-${hue}-${stop}`);
			}
		} else {
			names.push(`--color-${hue}`);
		}
	}

	for (const size of Object.keys(theme.text)) {
		names.push(`--text-${size}`);
		names.push(`--text-${size}-leading`);
	}

	for (const name of Object.keys(theme.shadows)) {
		names.push(`--shadow-${name}`);
	}

	for (const name of Object.keys(theme.breakpoints)) {
		names.push(`--breakpoint-${name}`);
	}

	for (const font of theme.fonts) {
		names.push(`--font-${font.slot}`);
	}

	for (const name of Object.keys(theme.animations)) {
		names.push(`--animate-${name}`);
	}

	_themeVarCache.set(theme, names);
	return names;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile all CSS function calls in a property value.
 * Processes --alpha(), --spacing(), and --theme() at build time.
 */
/**
 * Maximum substitution passes to prevent infinite expansion if a --theme()
 * value itself contains --theme() or other CSS function calls.
 */
const MAX_CSS_FUNCTION_DEPTH = 5;
/** Maximum output size (1 MB) to prevent theme value expansion from producing
 *  excessively large CSS output. */
const MAX_CSS_FUNCTION_OUTPUT_SIZE = 1_048_576;

export function compileCSSFunctions(
	value: string,
	theme?: ResolvedTheme,
	warnings?: string[],
): string {
	let result = value;
	// Early exit: nothing to process (shares hasCSSFunctions' "--" fast path).
	if (!hasCSSFunctions(result)) return result;
	for (let depth = 0; depth < MAX_CSS_FUNCTION_DEPTH; depth++) {
		// Re-check for each function on every iteration — prior passes may have
		// introduced new calls (e.g. a --theme() value that contains --alpha()).
		let next = result.includes("--alpha(") ? compileAlpha(result) : result;
		next = next.includes("--spacing(") ? compileSpacing(next, warnings) : next;
		next = next.includes("--theme(") ? compileTheme(next, theme, warnings) : next;
		if (next === result) break; // No further substitutions — converged
		if (next.length > MAX_CSS_FUNCTION_OUTPUT_SIZE) {
			warnings?.push(
				`[RI-2010] CSS function output exceeds ${MAX_CSS_FUNCTION_OUTPUT_SIZE} byte limit after ${depth + 1} passes. Theme values may be expanding to excessive size. Returning last stable result.`,
			);
			return result; // Return the pre-expansion value
		}
		// Warn early at pass 3 (of 5) so users see the issue before exhausting all passes.
		if (depth >= 2) {
			const severity = depth === MAX_CSS_FUNCTION_DEPTH - 1 ? "" : " (still attempting)";
			warnings?.push(
				`[RI-2009] CSS function substitution has not converged after ${depth + 1} passes${severity}. ` +
					`The value may contain circular or deeply nested function calls: "${value.slice(0, 100)}${value.length > 100 ? "..." : ""}"`,
			);
		}
		result = next;
	}
	return result;
}
