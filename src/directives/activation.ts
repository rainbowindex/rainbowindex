/**
 * Activation detection — the leaf half of the directive tokenizer.
 *
 * Everything here is pure string scanning with no dependencies beyond the
 * directive name lists, so IO-free consumers (the `rainbowindex/editor`
 * entry, browser bundles) can import activation checks without pulling the
 * directive resolver — whose graph reaches Node-only font machinery — into
 * their module graph. `directives/index.ts` re-exports this module's public
 * surface, so existing importers are unaffected.
 */

import { DIRECTIVE_TYPE_NAMES } from "./foundation.js";
import { APPLY_ALIASES } from "./apply-aliases.js";
import { isAtRuleBoundary } from "../shared.js";

/**
 * Single source of truth for all RI directive names.
 * Used by the PostCSS plugin, CLI, and Vite plugin for activation detection.
 *
 * NOTE: This set includes "apply" and "slot" which are NOT in the DirectiveType
 * union. `@apply` is expanded by the PostCSS plugin's walkAtRules pass;
 * `@slot` is only meaningful inside a `@custom` body (consumed during directive
 * parsing), and a standalone `@slot` is flagged with RI-1037 by that same pass.
 * Both are kept here so hasRIActivation() still detects files that use them.
 */
export const DIRECTIVE_NAMES_SET = new Set<string>([
	...DIRECTIVE_TYPE_NAMES,
	"apply",
	...APPLY_ALIASES,
	"slot",
]);

/**
 * Build a regex fragment that matches a directive at-rule token.
 *
 * Matches the exact directive name only and excludes hyphenated standard
 * at-rules that share a prefix — `@custom` not `@custom-media`, `@font` not
 * `@font-face` — via the trailing `(?!-)` negative lookahead.
 */
export function directiveAtRulePattern(name: string): string {
	return `@${name}(?!-)\\b`;
}

/** Check if a character code is a valid at-rule name character ([\w-]).
 *  Uses direct charCode range checks instead of regex for hot-loop performance
 *  in scanAtRules and extractDirectives. */
export function isAtRuleNameChar(code: number): boolean {
	// a-z: 97-122 (most common), A-Z: 65-90, 0-9: 48-57, _: 95, -: 45
	return (
		(code >= 97 && code <= 122) ||
		(code >= 65 && code <= 90) ||
		(code >= 48 && code <= 57) ||
		code === 95 ||
		code === 45
	);
}
// isAtRuleBoundary is imported from shared.ts — single source of truth.
/** Precompiled whitespace regex for whitespace-skipping loops. */
const WS_RE = /\s/;

const CC_QUOTE_DOUBLE = 34;
const CC_QUOTE_SINGLE = 39;
const CC_PAREN_OPEN = 40;
const CC_PAREN_CLOSE = 41;
const CC_STAR = 42;
const CC_SLASH = 47;
const CC_AT = 64;
const CC_BACKSLASH = 92;

/**
 * Shared at-rule scanner: walks `src` outside comments and strings, tracking
 * paren depth so `//` inside `url(...)` is content rather than a line comment
 * (line comments are skipped only at depth 0, matching extractDirectives).
 * One charCodeAt read per position — this runs over entire stylesheets.
 *
 * `onAtRule` fires for each `@name` token found at a valid at-rule boundary.
 * Return `true` to stop the scan (the scan result becomes true), a number to
 * continue from that index (e.g. past a consumed directive body), or
 * `undefined` to continue from the end of the name.
 */
export function scanAtRules(
	src: string,
	onAtRule: (name: string, atPos: number, nameEnd: number) => number | boolean | undefined,
	onLineComment?: (pos: number) => void,
): boolean {
	const len = src.length;
	let i = 0;
	let parenDepth = 0;
	while (i < len) {
		const c = src.charCodeAt(i);
		if (c === CC_SLASH) {
			const next = src.charCodeAt(i + 1);
			if (next === CC_STAR) {
				const end = src.indexOf("*/", i + 2);
				i = end === -1 ? len : end + 2;
				continue;
			}
			if (next === CC_SLASH && parenDepth === 0) {
				onLineComment?.(i);
				const end = src.indexOf("\n", i + 2);
				i = end === -1 ? len : end + 1;
				continue;
			}
			i++;
			continue;
		}
		if (c === CC_QUOTE_DOUBLE || c === CC_QUOTE_SINGLE) {
			i++;
			while (i < len && src.charCodeAt(i) !== c) {
				if (src.charCodeAt(i) === CC_BACKSLASH && i + 1 < len) i++;
				i++;
			}
			if (i < len) i++;
			continue;
		}
		if (c === CC_PAREN_OPEN) {
			parenDepth++;
			i++;
			continue;
		}
		if (c === CC_PAREN_CLOSE) {
			// Clamped at 0 so a stray `)` cannot poison the rest of the scan.
			if (parenDepth > 0) parenDepth--;
			i++;
			continue;
		}
		if (c !== CC_AT) {
			i++;
			continue;
		}
		// Escaped or embedded `@` (e.g. the selector `.\@color\:red`) is not an at-rule.
		if (!isAtRuleBoundary(src, i)) {
			i++;
			continue;
		}

		let nameEnd = i + 1;
		while (nameEnd < len && isAtRuleNameChar(src.charCodeAt(nameEnd))) nameEnd++;
		if (nameEnd === i + 1) {
			i++;
			continue;
		}
		const result = onAtRule(src.slice(i + 1, nameEnd), i, nameEnd);
		if (result === true) return true;
		i = typeof result === "number" ? result : nameEnd;
	}
	return false;
}

/**
 * Scan at-rule tokens in source outside comments/strings.
 * Returns true when `predicate(name, nameEnd)` matches any discovered at-rule
 * name; `nameEnd` is the index just past the name, for prelude inspection.
 */
function scanAtRuleTokens(
	src: string,
	predicate: (name: string, nameEnd: number) => boolean,
): boolean {
	return scanAtRules(src, (name, _atPos, nameEnd) => (predicate(name, nameEnd) ? true : undefined));
}

function readQuotedImportTarget(
	src: string,
	start: number,
): { target: string | null; nextIndex: number } {
	const quote = src[start];
	if (quote !== '"' && quote !== "'") return { target: null, nextIndex: start };
	let i = start + 1;
	let target = "";
	while (i < src.length) {
		const ch = src[i];
		if (ch === "\\") {
			if (i + 1 < src.length) {
				target += src[i + 1];
				i += 2;
				continue;
			}
			break;
		}
		if (ch === quote) {
			return { target, nextIndex: i + 1 };
		}
		target += ch;
		i++;
	}
	return { target: null, nextIndex: i };
}

function readURLImportTarget(
	src: string,
	start: number,
): { target: string | null; nextIndex: number } {
	if (
		!src
			.slice(start, start + 3)
			.toLowerCase()
			.startsWith("url")
	) {
		return { target: null, nextIndex: start };
	}
	let i = start + 3;
	while (i < src.length && WS_RE.test(src[i])) i++;
	if (src[i] !== "(") return { target: null, nextIndex: i };
	i++;
	while (i < src.length && WS_RE.test(src[i])) i++;
	if (src[i] === '"' || src[i] === "'") {
		const quoted = readQuotedImportTarget(src, i);
		i = quoted.nextIndex;
		while (i < src.length && WS_RE.test(src[i])) i++;
		if (src[i] === ")") i++;
		return { target: quoted.target, nextIndex: i };
	}
	const targetStart = i;
	while (i < src.length && src[i] !== ")") i++;
	const target = src.slice(targetStart, i).trim();
	if (src[i] === ")") i++;
	return { target: target || null, nextIndex: i };
}

function scanImportTarget(src: string, paramsStart: number): string | null {
	let i = paramsStart;
	while (i < src.length && WS_RE.test(src[i])) i++;
	if (i >= src.length) return null;
	if (src[i] === '"' || src[i] === "'") {
		return readQuotedImportTarget(src, i).target;
	}
	return readURLImportTarget(src, i).target;
}

/** Import specifiers that activate RainbowIndex. Single source for the
 *  activation scan here, the PostCSS import matcher, and the strip regex. */
export const RI_IMPORT_SPECIFIERS: readonly string[] = Object.freeze([
	"rainbowindex",
	"rainbowindex/index.css",
]);

/** Regex-escaped alternation of RI_IMPORT_SPECIFIERS for embedding in patterns. */
export const RI_IMPORT_SPECIFIER_ALTERNATION = RI_IMPORT_SPECIFIERS.map((s) =>
	s.replace(/[/\\^$.*+?()[\]{}|]/g, "\\$&"),
).join("|");

const RI_IMPORT_TARGETS = new Set(RI_IMPORT_SPECIFIERS);

/**
 * Detect whether source activates RainbowIndex: any RI directive token
 * (including PostCSS-only `@apply` and `@slot`) or an `@import` of the
 * package CSS, outside comments/strings. One fused scan covers both.
 */
export function hasRIActivation(src: string): boolean {
	return scanAtRuleTokens(src, (fullName, nameEnd) => {
		if (DIRECTIVE_NAMES_SET.has(fullName)) return true;
		if (fullName !== "import") return false;
		const target = scanImportTarget(src, nameEnd);
		return target !== null && RI_IMPORT_TARGETS.has(target);
	});
}

/**
 * Detect whether a specific RI at-rule name exists outside comments/strings.
 * Exact-name match only (e.g. "apply" matches `@apply`).
 */
export function hasRIDirectiveName(src: string, name: string): boolean {
	return scanAtRuleTokens(src, (fullName) => fullName === name);
}
