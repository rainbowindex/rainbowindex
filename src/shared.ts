/**
 * Shared utilities — small helpers used across multiple modules.
 *
 * Import domain-specific helpers directly from their modules:
 *   - warnings.ts  → pushWarningsDeduped, MAX_WARNINGS
 *   - assembly.ts  → assembleSections, generateTokenLayer, etc.
 *   - css/strip.ts → stripRIDirectives
 */

// ---------------------------------------------------------------------------
// Debug flag — single source of truth for RI_DEBUG across the codebase.
// ---------------------------------------------------------------------------

export function isRIDebug(): boolean {
	return typeof process !== "undefined" && !!process.env.RI_DEBUG;
}

// ---------------------------------------------------------------------------
// Timeout helper — clears the timer when the primary promise settles to avoid
// leaking timer handles and spurious unhandled rejections.
// ---------------------------------------------------------------------------

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms);
		if (typeof timer === "object" && "unref" in timer) timer.unref();
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

// ---------------------------------------------------------------------------
// CSS comment stripping
// ---------------------------------------------------------------------------

/**
 * Strip CSS comments while preserving quoted strings and spacing boundaries.
 * Used to normalize directive bodies before package-specific parsing.
 */
export function stripCSSComments(input: string): string {
	// Fast path: no "/" means no comment of either kind.
	if (!input.includes("/")) return input;

	const len = input.length;
	let result = "";
	// Verbatim spans are copied as one slice per comment boundary instead of
	// one character at a time — this runs on every directive body.
	let copyStart = 0;
	let i = 0;
	let quote = 0; // charCode of the open quote, 0 outside strings

	while (i < len) {
		const c = input.charCodeAt(i);

		if (quote !== 0) {
			if (c === 92 /* \ */) {
				i += 2;
				continue;
			}
			if (c === quote) quote = 0;
			i++;
			continue;
		}

		if (c === 34 /* " */ || c === 39 /* ' */) {
			quote = c;
			i++;
			continue;
		}

		if (c === 47 /* / */) {
			const next = input.charCodeAt(i + 1);
			if (next === 42 /* * */) {
				result += input.slice(copyStart, i);
				result += " ";
				const end = input.indexOf("*/", i + 2);
				// Unterminated comment drops the rest, matching CSS recovery.
				copyStart = end === -1 ? len : end + 2;
				if (end === -1) break;
				i = copyStart;
				continue;
			}
			if (next === 47) {
				result += input.slice(copyStart, i);
				const end = input.indexOf("\n", i + 2);
				copyStart = end === -1 ? len : end + 1;
				if (end === -1) break;
				result += "\n";
				i = copyStart;
				continue;
			}
		}

		i++;
	}

	if (copyStart === 0) return input;
	if (copyStart < len) result += input.slice(copyStart);
	return result;
}

// ---------------------------------------------------------------------------
// At-rule boundary detection — shared between strip.ts and directives.ts
// ---------------------------------------------------------------------------

/** Pre-compiled whitespace test for isAtRuleBoundary. */
const BOUNDARY_WHITESPACE_RE = /\s/;

/**
 * Check whether an `@` token position can start a CSS at-rule.
 * Prevents matching directive-like substrings inside URL/property values.
 */
export function isAtRuleBoundary(css: string, idx: number): boolean {
	if (idx === 0) return true;
	const prev = css.charCodeAt(idx - 1);
	// ASCII fast path — this runs for every `@` the scanners encounter.
	// space, \t-\r, `;`, `{`, `}`
	if (prev === 32 || (prev >= 9 && prev <= 13) || prev === 59 || prev === 123 || prev === 125)
		return true;
	// Allow immediately after a block comment end: /* ... */@directive
	if (prev === 47 /* / */ && idx >= 2 && css.charCodeAt(idx - 2) === 42 /* * */) return true;
	// Non-ASCII Unicode whitespace (NBSP etc.) keeps its boundary status.
	return prev > 127 && BOUNDARY_WHITESPACE_RE.test(css[idx - 1]);
}

/**
 * Conservative CSS custom-ident grammar (letter, then letters/digits/_/-).
 * Shared by the layout utilities (@container/@anchor names) and the variant
 * resolver (named containers) to prevent at-rule/selector injection.
 */
export const CSS_CUSTOM_IDENT_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Locale-independent string comparator for deterministic output ordering.
 * `localeCompare` collates via ICU, which differs across Node builds and
 * versions — codepoint order is the only ordering that is byte-stable.
 */
export function codepointCompare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
