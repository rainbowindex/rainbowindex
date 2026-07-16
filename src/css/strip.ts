/**
 * Strip RI directives from raw CSS input.
 *
 * Handles balanced-brace blocks and comment/string-protected ranges while
 * preserving standard @font-face rules (a standard at-rule, not an RI directive).
 */

import {
	EXTRACTABLE_DIRECTIVE_NAMES,
	RI_IMPORT_SPECIFIER_ALTERNATION,
	directiveAtRulePattern,
} from "../directives/index.js";
import { isAtRuleBoundary } from "../shared.js";

// ---------------------------------------------------------------------------
// Directive patterns
// ---------------------------------------------------------------------------

/** Single source of truth: the raw-extractable directive names (apply-like
 *  PostCSS-only directives already excluded by directives/index.ts). */
const DIRECTIVE_AT_RULE_PATTERNS = [...EXTRACTABLE_DIRECTIVE_NAMES].map(directiveAtRulePattern);

// ---------------------------------------------------------------------------
// Protected range helpers
// ---------------------------------------------------------------------------

/**
 * Build a sorted array of [start, end] ranges marking protected sections
 * in `css`: string literals and comments. Uses O(n) scan but only stores
 * ranges, not a full-size typed array, making it memory-efficient for
 * large CSS files.
 */
function buildProtectedRanges(css: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	let i = 0;
	while (i < css.length) {
		if (css[i] === "/" && css[i + 1] === "*") {
			const start = i;
			const end = css.indexOf("*/", i + 2);
			i = end === -1 ? css.length : end + 2;
			ranges.push([start, i]);
			continue;
		}
		if (css[i] === '"' || css[i] === "'") {
			const quote = css[i];
			const start = i;
			i++;
			while (i < css.length && css[i] !== quote) {
				if (css[i] === "\\" && i + 1 < css.length) i++;
				i++;
			}
			if (i < css.length) i++; // skip closing quote
			ranges.push([start, i]);
		} else {
			i++;
		}
	}
	return ranges;
}

/**
 * Check if a position is inside a protected range using binary search
 * on the sorted ranges array. O(log n) per lookup.
 */
function isInsideProtectedRange(pos: number, ranges: Array<[number, number]>): boolean {
	let lo = 0;
	let hi = ranges.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		const [start, end] = ranges[mid];
		if (pos < start) hi = mid - 1;
		else if (pos >= end) lo = mid + 1;
		else return true;
	}
	return false;
}

// isAtRuleBoundary is imported from shared.ts — single source of truth.

// ---------------------------------------------------------------------------
// Strip helpers
// ---------------------------------------------------------------------------

/**
 * Replace regex matches only when they are outside protected sections.
 * Uses a pre-built range map for efficient inside-range checks.
 *
 * `regex` must be one of the g-flagged module constants below; stripping is
 * synchronous and lastIndex is reset on entry, so sharing is safe.
 */
function replaceOutsideProtectedRanges(
	css: string,
	re: RegExp,
	ranges: Array<[number, number]>,
): string {
	re.lastIndex = 0;
	// Use array-based assembly with a final .join("") for O(n) instead of
	// O(n*m) string concatenation when many directive matches are removed.
	const parts: string[] = [];
	let lastIdx = 0;
	for (;;) {
		const match = re.exec(css);
		if (match === null) break;
		if (isInsideProtectedRange(match.index, ranges) || !isAtRuleBoundary(css, match.index)) {
			continue;
		}
		let end = match.index + match[0].length;
		// The patterns terminate at the first `;`, which can sit inside a quoted
		// value (`@source "a;b";`). Extend to the next unprotected `;` so the
		// whole directive is stripped. An unprotected brace aborts the match
		// (block-form or malformed — stripping on would eat unrelated CSS);
		// reaching EOF consumes the rest, per CSS at-rule error recovery.
		if (isInsideProtectedRange(end - 1, ranges)) {
			let k = end;
			let aborted = false;
			while (k < css.length) {
				if (!isInsideProtectedRange(k, ranges)) {
					const ch = css[k];
					if (ch === ";") break;
					if (ch === "{" || ch === "}") {
						aborted = true;
						break;
					}
				}
				k++;
			}
			if (aborted) continue;
			end = k < css.length ? k + 1 : css.length;
			// Keep the scan past the extended range so the regex cannot re-match
			// text that is already being stripped.
			re.lastIndex = end;
		}
		parts.push(css.slice(lastIdx, match.index));
		lastIdx = end;
	}
	parts.push(css.slice(lastIdx));
	return parts.join("");
}

/**
 * Strip a balanced-brace block starting at the match position of a prefix regex.
 * Handles nested braces (e.g., @animate with inner keyframe blocks).
 */
function stripBalancedBlocks(
	css: string,
	re: RegExp,
	protectedRanges: Array<[number, number]>,
): string {
	// Stripping is synchronous and lastIndex is reset here, so the shared
	// g-flagged module constant is safe even though lastIndex is mutated
	// mid-iteration below.
	re.lastIndex = 0;

	// Collect all ranges to remove in a single pass, then apply at once.
	// This avoids rebuilding the string map after every removal (O(n*m) → O(n)).
	const ranges: Array<[number, number]> = [];
	for (;;) {
		const match = re.exec(css);
		if (match === null) break;
		const start = match.index;
		// Skip matches inside comments or string literals (O(log n) lookup)
		if (isInsideProtectedRange(start, protectedRanges)) {
			continue;
		}
		if (!isAtRuleBoundary(css, start)) {
			continue;
		}
		// The regex stops at the first `{`, which can sit inside a quoted
		// prelude value (`@font "a{b" { … }`) — advance to the first
		// unprotected `{` so the balanced scan starts at the real block opener.
		let braceIdx = css.indexOf("{", start);
		while (braceIdx !== -1 && isInsideProtectedRange(braceIdx, protectedRanges)) {
			braceIdx = css.indexOf("{", braceIdx + 1);
		}
		// An unprotected `;` before the opener means the directive is
		// statement-form with a quoted `{` in its value
		// (`@source "src/**/*.{ts,tsx}";`) — phase 1's regex cannot cross the
		// quoted brace, so strip through the terminator here instead of
		// consuming the unrelated `{…}` that follows.
		const preludeEnd = braceIdx === -1 ? css.length : braceIdx;
		let semiIdx = -1;
		for (let k = start; k < preludeEnd; k++) {
			if (css[k] === ";" && !isInsideProtectedRange(k, protectedRanges)) {
				semiIdx = k;
				break;
			}
		}
		if (semiIdx !== -1) {
			ranges.push([start, semiIdx + 1]);
			re.lastIndex = semiIdx + 1;
			continue;
		}
		// Neither an unprotected `;` nor an unprotected `{` — the malformed
		// directive runs to EOF; consume the rest, per CSS at-rule error recovery.
		if (braceIdx === -1) {
			ranges.push([start, css.length]);
			break;
		}
		let depth = 1;
		let j = braceIdx + 1;
		while (j < css.length && depth > 0) {
			const ch = css[j];
			if (ch === '"' || ch === "'") {
				const quote = ch;
				j++;
				while (j < css.length && css[j] !== quote) {
					if (css[j] === "\\" && j + 1 < css.length) j++;
					j++;
				}
				j++;
				continue;
			}
			if (ch === "/" && css[j + 1] === "*") {
				const end = css.indexOf("*/", j + 2);
				j = end === -1 ? css.length : end + 2;
				continue;
			}
			if (ch === "{") depth++;
			else if (ch === "}") depth--;
			j++;
		}
		ranges.push([start, j]);
		// Skip past the removed block so the regex doesn't re-enter it
		re.lastIndex = j;
	}

	if (ranges.length === 0) return css;

	// Build result using array join for O(n) instead of O(n*m) string concatenation
	const parts: string[] = [];
	let lastEnd = 0;
	for (const [start, end] of ranges) {
		parts.push(css.slice(lastEnd, start));
		lastEnd = end;
	}
	parts.push(css.slice(lastEnd));
	return parts.join("");
}

// ---------------------------------------------------------------------------
// Precompiled directive regexes
// ---------------------------------------------------------------------------

/** Precompiled combined regex matching all semicolon-terminated RI directives in one pass. */
const ALL_SEMI_DIRECTIVES_RE = new RegExp(
	DIRECTIVE_AT_RULE_PATTERNS.map((p) => `${p}[^{;]*;`).join("|"),
	"g",
);

/** Precompiled combined regex matching all brace-opening RI directives in one pass. */
const ALL_BRACE_DIRECTIVES_RE = new RegExp(
	DIRECTIVE_AT_RULE_PATTERNS.map((p) => `${p}[^{]*{`).join("|"),
	"g",
);

/** Exact package activation import to strip from authored CSS. */
const RI_IMPORT_RE = new RegExp(
	`@import\\s+(?:url\\(\\s*)?["'](?:${RI_IMPORT_SPECIFIER_ALTERNATION})["']\\s*\\)?[^;]*;`,
	"g",
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function stripRIDirectives(css: string): string {
	// Build protected ranges once for the original CSS.
	let currentRanges = buildProtectedRanges(css);

	// Phase 0: Strip the package activation import if present.
	let result = replaceOutsideProtectedRanges(css, RI_IMPORT_RE, currentRanges);
	if (result !== css) {
		currentRanges = buildProtectedRanges(result);
	}

	// Phase 1: Collect all semicolon-terminated directive ranges in one pass
	const beforePhase1 = result;
	result = replaceOutsideProtectedRanges(result, ALL_SEMI_DIRECTIVES_RE, currentRanges);

	// Phase 2: Collect all brace-body directive ranges in one pass
	// Only rebuild protected ranges once after all preceding mutations.
	const dirty = result !== beforePhase1;
	if (dirty) {
		currentRanges = buildProtectedRanges(result);
	}
	// Phase 2 strips every brace-body directive in one pass, including @font { … }
	// (a generic directive now that per-slot @font-<slot> is gone). @font-face is
	// left intact — it's a standard at-rule, not an RI directive.
	result = stripBalancedBlocks(result, ALL_BRACE_DIRECTIVES_RE, currentRanges);

	return result.trim();
}
