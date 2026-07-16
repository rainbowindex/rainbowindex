const BOUNDARY = /(?:^|[\s"'`{;:,=+(|])/.source;
const NEGATIVE = /-?/.source;
const IMPORTANT_SUFFIX = /!?/.source;
// Single source for the variant-segment grammar. The extractor's prefix
// matcher (VARIANT_PREFIX) and the base-name strip regex (VARIANT_STRIP_RE)
// must accept the same character set — deriving both from this one segment
// keeps dotted variants strippable exactly where they are matchable.
// Allows bracket-enclosed arbitrary variants like [&_p]: or [@media(...)]:
const VARIANT_SEGMENT = /(?:[\w.@-]+(?:\[[^\]]*\])?|\[[^\]]*\]):/.source;
const VARIANT_PREFIX = `(?:${VARIANT_SEGMENT})*`;
// Allow paren values for CSS var shorthand and bracket/paren modifiers.
// The value-position paren MUST be preceded by `-` (the `prefix-(` separator
// of `bg-(--brand)`). Without that anchor, a bare function call in scanned
// source — `defineIcon({ className: "...", d: "M0" })`, `cva(...)`, etc. —
// matches `name(...)` and swallows the whole argument list up to the first
// `)`, silently dropping every class literal nested inside the call. The
// `/(...)` modifier parens require `--` for the same reason: their only valid
// form references a custom property (`text-c/(--opacity)`).
const UTILITY_VALUE =
	/[\w.@-]+(?:\[[^\]]*\]|(?<=-)\([^)]*\))?(?:\/(?:[\w.]+|\[[^\]]*\]|\([^)]*--[^)]*\)))?/.source;
const VARIANT_GROUP = /[\w.@-]+:\{[^}]*\}/.source;
// Arbitrary properties: [color:red], [-webkit-box-decoration-break:clone]
const ARBITRARY_PROPERTY = /\[[a-z-][^\]]*:[^\]]+\](?:\/(?:[\w.]+|\[[^\]]*\]|\([^)]*--[^)]*\)))?/
	.source;
const CLASS_RE_SOURCE = `${BOUNDARY}(${NEGATIVE}${VARIANT_PREFIX}(?:${UTILITY_VALUE}|${VARIANT_GROUP}|${ARBITRARY_PROPERTY})${IMPORTANT_SUFFIX})`;
// Shared module-level instance: extractClasses resets lastIndex and drains it to
// null on every call, and never re-enters itself mid-scan, so reuse is safe and
// avoids recompiling this large alternation once per collected string value.
const CLASS_RE = new RegExp(CLASS_RE_SOURCE, "g");
const VARIANT_STRIP_RE = new RegExp(`^(?:${VARIANT_SEGMENT})+`);

const MAX_LINE_LENGTH = 2000;
const MAX_EXPANDED_LENGTH = 100_000;
const MAX_EXPANSION_INPUT_LENGTH = 500_000;
const MAX_VARIANT_GROUP_DEPTH = 10;

const BRACKET_PAIRS = {
	"(": ")",
	"[": "]",
	"{": "}",
} as const;

const CLASS_HELPERS = [
	"clsx",
	"cn",
	"classnames",
	"classNames",
	"cx",
	"twJoin",
	"twMerge",
] as const;

const VARIANT_HELPERS = ["cva", "tv"] as const;

const NON_CLASS_IDENTIFIERS = new Set<string>([...CLASS_HELPERS, ...VARIANT_HELPERS, "classMap"]);

// Module-level call matchers — every caller is a constant name list, so the
// alternations compile once. Same lastIndex-drain discipline as CLASS_RE:
// reset on entry, drained to null, never re-entered mid-scan.
const CLASS_HELPERS_CALL_RE = new RegExp(`\\b(?:${CLASS_HELPERS.join("|")})\\s*\\(`, "g");
const VARIANT_HELPERS_CALL_RE = new RegExp(`\\b(?:${VARIANT_HELPERS.join("|")})\\s*\\(`, "g");
const SAFELIST_CALL_RE = /\bsafelist\s*\(/g;
const CLASS_MAP_CALL_RE = /\bclassMap\s*\(/g;

/** [\w@-] — the segment chars expandVariantGroups accepts before a group `:`. */
function isGroupSegmentCharCode(code: number): boolean {
	// a-z: 97-122 (most common), A-Z: 65-90, 0-9: 48-57, _: 95, @: 64, -: 45
	return (
		(code >= 97 && code <= 122) ||
		(code >= 65 && code <= 90) ||
		(code >= 48 && code <= 57) ||
		code === 95 ||
		code === 64 ||
		code === 45
	);
}

/** ASCII \s — sufficient for the JS/HTML source these hot loops read. */
function isWhitespaceCode(code: number): boolean {
	// space: 32, tab through CR: 9-13
	return code === 32 || (code >= 9 && code <= 13);
}

export interface SourceExtractionInput {
	path?: string;
	content: string;
}

type Extractor = {
	test: (context: SourceExtractionInput) => boolean;
	extract: (context: SourceExtractionInput, warnings?: string[]) => Set<string>;
};

type ValueVisitor = (target: Set<string>, value: string, warnings?: string[]) => void;

export function expandVariantGroups(input: string, warnings?: string[]): string {
	if (!input.includes("{")) return input;

	if (input.length > MAX_EXPANSION_INPUT_LENGTH) {
		warnings?.push(
			`[RI-1407] Variant group expansion input exceeds ${MAX_EXPANSION_INPUT_LENGTH} character limit — returning verbatim.`,
		);
		return input;
	}

	const parts: string[] = [];
	let partsLen = 0;
	let i = 0;
	// Start of the pending run of non-group characters. Runs are flushed as one
	// slice when a group expands (or at the end) instead of pushing one
	// single-character string per position — this loop sees whole files.
	let plainStart = 0;

	while (i < input.length) {
		if (partsLen + (i - plainStart) > MAX_EXPANDED_LENGTH) {
			warnings?.push(
				`[RI-1408] Variant group expansion output exceeds ${MAX_EXPANDED_LENGTH} character limit — remaining input appended verbatim.`,
			);
			if (i > plainStart) parts.push(input.slice(plainStart, i));
			plainStart = input.length;
			parts.push(input.slice(i));
			break;
		}

		const prefixStart = i;
		let prefixEnd = i;
		let foundGroup = false;
		// Once a `{` has been inspected, rescanning interior positions is not
		// equivalent (brace walks emit warnings) — the no-group skip below only
		// fires for spans that provably contain no group start.
		let sawBrace = false;
		let scanEnd = i;

		while (prefixEnd < input.length) {
			const segStart = prefixEnd;
			let segEnd = segStart;
			while (segEnd < input.length && isGroupSegmentCharCode(input.charCodeAt(segEnd))) segEnd++;
			scanEnd = segEnd;
			if (segEnd === segStart || segEnd >= input.length || input[segEnd] !== ":") break;
			prefixEnd = segEnd + 1;
			scanEnd = prefixEnd;

			if (prefixEnd < input.length && input[prefixEnd] === "{") {
				sawBrace = true;
				const braceStart = prefixEnd;
				let depth = 1;
				let j = braceStart + 1;
				while (j < input.length && depth > 0) {
					const ch = input[j];
					if (ch === "\\" && j + 1 < input.length) {
						j += 2;
						continue;
					}
					if (ch === "[") {
						j++;
						while (j < input.length && input[j] !== "]") {
							if (input[j] === "\\" && j + 1 < input.length) {
								j += 2;
								continue;
							}
							if (input[j] === "'" || input[j] === '"') {
								const q = input[j];
								j++;
								while (j < input.length && input[j] !== q) {
									if (input[j] === "\\" && j + 1 < input.length) j++;
									j++;
								}
							}
							j++;
						}
						if (j < input.length) j++;
						continue;
					}
					if (ch === "{") {
						depth++;
						if (depth > MAX_VARIANT_GROUP_DEPTH) {
							warnings?.push(
								`[RI-1409] Variant group nesting exceeds maximum depth of ${MAX_VARIANT_GROUP_DEPTH} — group not expanded.`,
							);
							break;
						}
					} else if (ch === "}") {
						depth--;
					}
					if (depth > 0) j++;
				}

				if (depth === 0) {
					if (prefixStart > plainStart) {
						const run = input.slice(plainStart, prefixStart);
						parts.push(run);
						partsLen += run.length;
					}
					const prefix = input.slice(prefixStart, braceStart);
					const body = input.slice(braceStart + 1, j).trim();
					const expanded = body
						.split(/\s+/)
						.filter(Boolean)
						.map((cls) => prefix + cls)
						.join(" ");
					parts.push(expanded);
					partsLen += expanded.length;
					i = j + 1;
					plainStart = i;
					foundGroup = true;
				}
				break;
			}
		}

		if (!foundGroup) {
			// Brace-free segment scans fail identically from every interior
			// position, so the whole scanned span joins the plain run at once.
			i = !sawBrace && scanEnd > i ? scanEnd : i + 1;
		}
	}

	if (plainStart < input.length) parts.push(input.slice(plainStart));

	return parts.join("");
}

const APPLY_AT_RULE_RE = /@(?:apply|a)\s+/g;

/**
 * Expand variant groups (`prefix:{a b c}` → `prefix:a prefix:b prefix:c`)
 * inside `@apply` / `@a` directive bodies in raw CSS, leaving everything else
 * untouched. Run on the CSS source string before PostCSS parses it — the `{`
 * inside group syntax otherwise looks like the start of a CSS block to the
 * PostCSS parser.
 */
export function expandApplyGroups(css: string, warnings?: string[]): string {
	if (!css.includes("{") || !css.includes("@")) return css;

	APPLY_AT_RULE_RE.lastIndex = 0;
	let match: RegExpExecArray | null = APPLY_AT_RULE_RE.exec(css);
	if (match === null) return css;

	const out: string[] = [];
	let lastEnd = 0;

	while (match !== null) {
		const bodyStart = match.index + match[0].length;
		let i = bodyStart;
		let depth = 0;
		while (i < css.length) {
			const ch = css[i];
			if (ch === "{") depth++;
			else if (ch === "}") {
				if (depth === 0) break;
				depth--;
			} else if (ch === ";" && depth === 0) break;
			i++;
		}

		const body = css.slice(bodyStart, i);
		if (body.includes("{")) {
			const expanded = expandVariantGroups(body, warnings);
			if (expanded !== body) {
				out.push(css.slice(lastEnd, bodyStart));
				out.push(expanded);
				lastEnd = i;
			}
		}

		APPLY_AT_RULE_RE.lastIndex = i;
		match = APPLY_AT_RULE_RE.exec(css);
	}

	if (lastEnd === 0) return css;
	out.push(css.slice(lastEnd));
	return out.join("");
}

// Candidate filters for extractClasses' match loop — module-level so the
// scanner's hottest loop never evaluates a regex literal per matched token.
// BRACKET_SPAN_RE is g-flagged but used with .replace() only, which ignores
// and resets lastIndex — never run .test()/.exec() against it.
const BRACKET_SPAN_RE = /\[[^\]]*\]/g;
const HAS_UPPERCASE_RE = /[A-Z]/;
const BRACKET_WHITESPACE_RE = /\[[^\]]*\s+[^\]]*\]/;
const INDEX_ACCESS_RE = /\[\d*\]$/;
const PROPERTY_ACCESS_RE = /^[\w.@]+\[[^\]]+\]$/;

export function extractClasses(source: string, warnings?: string[]): Set<string> {
	const classes = new Set<string>();

	// Over-long lines are dropped wholesale — including a single-line minified
	// file, which is just the degenerate one-line case. Helper-call collection
	// (safelist()/cn()/cva()) runs on the raw content outside this guard, so
	// library dist scanning is unaffected.
	let filteredSource = source;
	if (source.length > MAX_LINE_LENGTH) {
		// First pass only measures — the common all-short-lines case must not
		// rebuild the whole file.
		let hasLongLine = false;
		let start = 0;
		let idx = source.indexOf("\n", start);
		while (idx !== -1) {
			if (idx - start > MAX_LINE_LENGTH) {
				hasLongLine = true;
				break;
			}
			start = idx + 1;
			idx = source.indexOf("\n", start);
		}
		if (!hasLongLine && source.length - start > MAX_LINE_LENGTH) hasLongLine = true;

		if (hasLongLine) {
			const parts: string[] = [];
			start = 0;
			idx = source.indexOf("\n", start);
			while (idx !== -1) {
				if (idx - start <= MAX_LINE_LENGTH) {
					parts.push(source.slice(start, idx));
				}
				start = idx + 1;
				idx = source.indexOf("\n", start);
			}
			if (source.length - start <= MAX_LINE_LENGTH) {
				parts.push(source.slice(start));
			}
			filteredSource = parts.join("\n");
		}
	}

	const expanded = filteredSource.includes("{")
		? expandVariantGroups(filteredSource, warnings)
		: filteredSource;

	CLASS_RE.lastIndex = 0;

	for (;;) {
		const match = CLASS_RE.exec(expanded);
		if (match === null) break;
		const cls = match[1];
		if (!cls) continue;
		const unbanged = cls.endsWith("!") ? cls.slice(0, -1) : cls;
		const base = unbanged.replace(VARIANT_STRIP_RE, "");
		if (HAS_UPPERCASE_RE.test(base.replace(BRACKET_SPAN_RE, ""))) continue;
		if (BRACKET_WHITESPACE_RE.test(base)) continue;
		if (INDEX_ACCESS_RE.test(base)) continue;
		// Reject JS array / property access: `obj[key]`, `rest["aria-invalid"]`,
		// `state.foo["data-state"]`, etc. CSS utility arbitrary values always
		// use `utility-[value]` syntax — the character immediately before `[`
		// must be `-`, and this regex's name part excludes `-`, so anything it
		// matches is an access expression, never a utility.
		if (PROPERTY_ACCESS_RE.test(base)) continue;
		classes.add(cls);
	}

	return classes;
}

function addClasses(target: Set<string>, value: string, warnings?: string[]): void {
	for (const cls of extractClasses(value, warnings)) {
		target.add(cls);
	}
}

function collectDirectiveNames(
	target: Set<string>,
	source: string,
	regex: RegExp,
	warnings?: string[],
): void {
	for (;;) {
		const match = regex.exec(source);
		if (match === null) break;
		const value = match[1]?.trim();
		if (!value) continue;
		addClasses(target, value, warnings);
	}
}

// Same lastIndex-drain discipline as CLASS_RE: reset on entry, drained to
// null, never re-entered mid-scan (addClasses never calls back into these).
const OBJECT_KEY_COLON_RE = /(["'`])([^"'`]+)\1\s*:|([A-Za-z_@][\w@-]*)\s*:/g;
const OBJECT_KEY_ARROW_RE = /(["'`])([^"'`]+)\1\s*=>/g;

function collectObjectKeys(
	target: Set<string>,
	body: string,
	separator: ":" | "=>",
	warnings?: string[],
): void {
	const keyRe = separator === ":" ? OBJECT_KEY_COLON_RE : OBJECT_KEY_ARROW_RE;
	keyRe.lastIndex = 0;
	for (;;) {
		const match = keyRe.exec(body);
		if (match === null) break;
		const value = (match[2] ?? match[3] ?? "").trim();
		if (!value) continue;
		addClasses(target, value, warnings);
	}
}

function collectTemplateLiteralClasses(
	target: Set<string>,
	source: string,
	start: number,
	warnings?: string[],
): number {
	let i = start + 1;
	let chunkStart = i;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === "`") {
			const value = source.slice(chunkStart, i).trim();
			if (value) addClasses(target, value, warnings);
			return i;
		}
		if (ch === "$" && source[i + 1] === "{") {
			const value = source.slice(chunkStart, i).trim();
			if (value) addClasses(target, value, warnings);
			const end = findMatchingBracket(source, i + 1);
			if (end === -1) return source.length - 1;
			i = end + 1;
			chunkStart = i;
			continue;
		}
		i++;
	}
	return source.length - 1;
}

function collectStringLiteralClasses(
	target: Set<string>,
	source: string,
	warnings?: string[],
): void {
	let i = 0;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "'" || ch === '"') {
			const end = skipQuoted(source, i, ch);
			const value = source.slice(i + 1, end).trim();
			if (value) addClasses(target, value, warnings);
			i = end + 1;
			continue;
		}
		if (ch === "`") {
			i = collectTemplateLiteralClasses(target, source, i, warnings) + 1;
			continue;
		}
		i++;
	}
}

function skipQuoted(source: string, start: number, quote: "'" | '"'): number {
	let i = start + 1;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === quote) return i;
		i++;
	}
	return source.length - 1;
}

function findMatchingBracket(source: string, start: number): number {
	const open = source[start] as keyof typeof BRACKET_PAIRS;
	const close = BRACKET_PAIRS[open];
	if (!close) return -1;

	const stack: string[] = [close];
	let i = start + 1;

	while (i < source.length) {
		const ch = source[i];
		if (ch === "'" || ch === '"') {
			i = skipQuoted(source, i, ch);
			i++;
			continue;
		}
		if (ch === "`") {
			i = skipTemplateLiteral(source, i);
			i++;
			continue;
		}
		if (ch === "/" && source[i + 1] === "/") {
			i += 2;
			while (i < source.length && source[i] !== "\n") i++;
			continue;
		}
		if (ch === "/" && source[i + 1] === "*") {
			i += 2;
			while (i + 1 < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
			i = Math.min(i + 2, source.length);
			continue;
		}
		if (ch in BRACKET_PAIRS) {
			stack.push(BRACKET_PAIRS[ch as keyof typeof BRACKET_PAIRS]);
			i++;
			continue;
		}
		if (ch === stack[stack.length - 1]) {
			stack.pop();
			if (stack.length === 0) return i;
		}
		i++;
	}

	return -1;
}

function skipTemplateLiteral(source: string, start: number): number {
	let i = start + 1;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === "`") return i;
		if (ch === "$" && source[i + 1] === "{") {
			const end = findMatchingBracket(source, i + 1);
			if (end === -1) return source.length - 1;
			i = end + 1;
			continue;
		}
		i++;
	}
	return source.length - 1;
}

function skipWhitespace(source: string, start: number): number {
	let i = start;
	while (i < source.length && isWhitespaceCode(source.charCodeAt(i))) i++;
	return i;
}

/** True at value terminators in readAssignedValue: \s , ; ) } ] */
function isValueTerminatorCode(code: number): boolean {
	return (
		isWhitespaceCode(code) ||
		code === 44 || // ,
		code === 59 || // ;
		code === 41 || // )
		code === 125 || // }
		code === 93 // ]
	);
}

function readAssignedValue(source: string, start: number): { value: string; end: number } | null {
	const i = skipWhitespace(source, start);
	const ch = source[i];
	if (!ch) return null;

	if (ch === "'" || ch === '"') {
		const end = skipQuoted(source, i, ch);
		return {
			value: source.slice(i + 1, end),
			end,
		};
	}

	if (ch === "`") {
		const end = skipTemplateLiteral(source, i);
		return {
			value: source.slice(i + 1, end),
			end,
		};
	}

	if (ch in BRACKET_PAIRS) {
		const end = findMatchingBracket(source, i);
		if (end === -1) return null;
		return {
			value: source.slice(i + 1, end),
			end,
		};
	}

	let end = i;
	while (end < source.length && !isValueTerminatorCode(source.charCodeAt(end))) end++;
	return {
		value: source.slice(i, end),
		end: end - 1,
	};
}

function collectAssignedValues(
	target: Set<string>,
	source: string,
	regex: RegExp,
	visitor: ValueVisitor = addClasses,
	warnings?: string[],
): void {
	regex.lastIndex = 0;
	for (;;) {
		const match = regex.exec(source);
		if (match === null) break;
		const parsed = readAssignedValue(source, match.index + match[0].length);
		if (!parsed) continue;
		const value = parsed.value.trim();
		if (!value) continue;
		visitor(target, value, warnings);
		regex.lastIndex = Math.max(regex.lastIndex, parsed.end + 1);
	}
}

function collectClassishExpression(
	target: Set<string>,
	expression: string,
	warnings?: string[],
): void {
	collectStringLiteralClasses(target, expression, warnings);
	collectObjectKeys(target, expression, ":", warnings);
	collectObjectKeys(target, expression, "=>", warnings);
}

function collectCallArguments(
	target: Set<string>,
	source: string,
	callRe: RegExp,
	visitor: ValueVisitor = collectClassishExpression,
	warnings?: string[],
): void {
	callRe.lastIndex = 0;
	for (;;) {
		const match = callRe.exec(source);
		if (match === null) break;
		// The regex ends in `(`, so the opener is the last char of the match.
		const openIndex = match.index + match[0].length - 1;
		const end = findMatchingBracket(source, openIndex);
		if (end === -1) continue;
		const value = source.slice(openIndex + 1, end).trim();
		if (value) visitor(target, value, warnings);
		callRe.lastIndex = Math.max(callRe.lastIndex, end + 1);
	}
}

function splitTopLevelArgs(source: string): string[] {
	const parts: string[] = [];
	let last = 0;
	let i = 0;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "'" || ch === '"') {
			i = skipQuoted(source, i, ch);
			i++;
			continue;
		}
		if (ch === "`") {
			i = skipTemplateLiteral(source, i);
			i++;
			continue;
		}
		if (ch in BRACKET_PAIRS) {
			const end = findMatchingBracket(source, i);
			if (end === -1) break;
			i = end + 1;
			continue;
		}
		if (ch === ",") {
			parts.push(source.slice(last, i).trim());
			last = i + 1;
		}
		i++;
	}
	const tail = source.slice(last).trim();
	if (tail) parts.push(tail);
	return parts;
}

// Config-key matchers for the cva/tv collectors. collectAssignedValues resets
// lastIndex on entry, so sequential reuse is safe; no constant below is driven
// at two nesting levels at once (the nested drives use a different constant
// than their outer drive).
const CLASS_BASE_KEY_RE = /\b(?:class|className|base)\s*:/g;
const CLASS_KEY_RE = /\b(?:class|className)\s*:/g;
const VARIANTS_KEY_RE = /\bvariants\s*:/g;
const DEFAULT_VARIANTS_KEY_RE = /\bdefaultVariants\s*:/g;
const COMPOUND_VARIANTS_KEY_RE = /\bcompoundVariants\s*:/g;
const SLOTS_KEY_RE = /\bslots\s*:/g;
const SLOT_ENTRY_KEY_RE = /\b[A-Za-z_][\w-]*\s*:/g;

function collectVariantConfigClasses(
	target: Set<string>,
	source: string,
	warnings?: string[],
): void {
	collectAssignedValues(target, source, CLASS_BASE_KEY_RE, collectClassishExpression, warnings);
	collectAssignedValues(
		target,
		source,
		VARIANTS_KEY_RE,
		(nextTarget, value, w) => {
			collectStringLiteralClasses(nextTarget, value, w);
		},
		warnings,
	);
	collectAssignedValues(
		target,
		source,
		COMPOUND_VARIANTS_KEY_RE,
		(nextTarget, value, w) => {
			collectAssignedValues(nextTarget, value, CLASS_KEY_RE, addClasses, w);
		},
		warnings,
	);
	collectAssignedValues(
		target,
		source,
		SLOTS_KEY_RE,
		(nextTarget, value, w) => {
			collectAssignedValues(nextTarget, value, SLOT_ENTRY_KEY_RE, collectClassishExpression, w);
		},
		warnings,
	);
}

type VariantHelperMetadata = {
	tokens: Set<string>;
	/** [start, end) spans of each helper call's argument list, ascending. */
	callRanges: Array<[number, number]>;
};

function collectVariantHelperArguments(
	target: Set<string>,
	source: string,
	warnings?: string[],
): VariantHelperMetadata {
	// Structural keys of cva()/tv() configs that must not survive as class names,
	// seeded with the static keys and grown with the variant/slot keys found in
	// this file's configs. Collected during the same walk that gathers classes so
	// the file is scanned once, not twice. The caller prunes these last.
	const tokens = new Set<string>([
		"variants",
		"defaultVariants",
		"compoundVariants",
		"slots",
		"base",
		"class",
		"className",
	]);
	const callRanges: Array<[number, number]> = [];
	VARIANT_HELPERS_CALL_RE.lastIndex = 0;
	for (;;) {
		const match = VARIANT_HELPERS_CALL_RE.exec(source);
		if (match === null) break;
		const openIndex = match.index + match[0].length - 1;
		const end = findMatchingBracket(source, openIndex);
		if (end === -1) continue;
		callRanges.push([openIndex + 1, end]);
		const args = splitTopLevelArgs(source.slice(openIndex + 1, end));
		// tv() takes its config object as the FIRST argument; cva() takes base
		// classes first and the config second. A leading `{` (splitTopLevelArgs
		// trims) is what tells the two shapes apart.
		const config = args[0]?.startsWith("{") ? args[0] : args[1];
		if (args[0] && args[0] !== config) collectClassishExpression(target, args[0], warnings);
		if (config) {
			collectVariantConfigClasses(target, config, warnings);
			collectAssignedValues(
				tokens,
				config,
				VARIANTS_KEY_RE,
				(t, v, w) => {
					collectObjectKeys(t, v, ":", w);
				},
				warnings,
			);
			collectAssignedValues(
				tokens,
				config,
				DEFAULT_VARIANTS_KEY_RE,
				(t, v, w) => {
					collectObjectKeys(t, v, ":", w);
					collectStringLiteralClasses(t, v, w);
				},
				warnings,
			);
			collectAssignedValues(
				tokens,
				config,
				SLOTS_KEY_RE,
				(t, v, w) => {
					collectObjectKeys(t, v, ":", w);
				},
				warnings,
			);
		}
		VARIANT_HELPERS_CALL_RE.lastIndex = Math.max(VARIANT_HELPERS_CALL_RE.lastIndex, end + 1);
	}
	return { tokens, callRanges };
}

function collectClassMapArguments(target: Set<string>, source: string, warnings?: string[]): void {
	CLASS_MAP_CALL_RE.lastIndex = 0;
	for (;;) {
		const match = CLASS_MAP_CALL_RE.exec(source);
		if (match === null) break;
		const openIndex = match.index + match[0].length - 1;
		const end = findMatchingBracket(source, openIndex);
		if (end === -1) continue;
		const value = source.slice(openIndex + 1, end).trim();
		if (value) {
			collectObjectKeys(target, value, ":", warnings);
			collectObjectKeys(target, value, "=>", warnings);
		}
		CLASS_MAP_CALL_RE.lastIndex = Math.max(CLASS_MAP_CALL_RE.lastIndex, end + 1);
	}
}

function pruneTokens(target: Set<string>, tokens: Iterable<string>): void {
	for (const token of tokens) {
		target.delete(token);
	}
}

/**
 * Collect whitespace-separated tokens that appear inside quoted string
 * literals ('"`), skipping `excludeRanges` (ascending, non-overlapping
 * [start, end) spans). Template interpolations act as token boundaries; their
 * code is not collected. Single linear charCode pass, allocating only the
 * token slices it keeps.
 */
function collectQuotedTokens(
	source: string,
	excludeRanges: ReadonlyArray<readonly [number, number]>,
	out: Set<string>,
): void {
	let range = 0;
	let i = 0;
	while (i < source.length) {
		if (range < excludeRanges.length) {
			const current = excludeRanges[range];
			if (i >= current[0]) {
				i = Math.max(i, current[1]);
				range++;
				continue;
			}
		}
		const code = source.charCodeAt(i);
		// " : 34, ' : 39, ` : 96
		if (code === 34 || code === 39 || code === 96) {
			i = collectTokensInLiteral(source, i, code, out);
			continue;
		}
		i++;
	}
}

/** Tokenize one quoted literal starting at `start`; returns the index after it. */
function collectTokensInLiteral(
	source: string,
	start: number,
	quoteCode: number,
	out: Set<string>,
): number {
	let i = start + 1;
	let tokenStart = i;
	while (i < source.length) {
		const code = source.charCodeAt(i);
		if (code === 92 /* \ */) {
			i += 2;
			continue;
		}
		if (code === quoteCode) {
			if (i > tokenStart) out.add(source.slice(tokenStart, i));
			return i + 1;
		}
		if (quoteCode === 96 /* ` */ && code === 36 /* $ */ && source.charCodeAt(i + 1) === 123) {
			if (i > tokenStart) out.add(source.slice(tokenStart, i));
			const end = findMatchingBracket(source, i + 1);
			if (end === -1) return source.length;
			i = end + 1;
			tokenStart = i;
			continue;
		}
		if (isWhitespaceCode(code)) {
			if (i > tokenStart) out.add(source.slice(tokenStart, i));
			i++;
			tokenStart = i;
			continue;
		}
		i++;
	}
	if (source.length > tokenStart) out.add(source.slice(tokenStart, source.length));
	return source.length;
}

/**
 * Drop cva()/tv() structural tokens from the class set — but only those with
 * no quoted-string provenance. A variant KEY can legitimately double as a
 * class elsewhere in the file (`variants: { rounded: … }` plus
 * `className="rounded"`); deleting it from the file-wide set would kill the
 * real utility. Tokens quoted anywhere OUTSIDE the helper calls survive;
 * quoted occurrences INSIDE the config (defaultVariants values, quoted keys)
 * stay prunable.
 */
function pruneVariantMetadata(
	classes: Set<string>,
	metadata: VariantHelperMetadata,
	source: string,
): void {
	if (metadata.callRanges.length === 0) {
		pruneTokens(classes, metadata.tokens);
		return;
	}
	const quoted = new Set<string>();
	collectQuotedTokens(source, metadata.callRanges, quoted);
	for (const token of metadata.tokens) {
		if (!quoted.has(token)) classes.delete(token);
	}
}

function extractHTML(context: SourceExtractionInput, warnings?: string[]): Set<string> {
	return extractClasses(context.content, warnings);
}

function extractJSXTSX(context: SourceExtractionInput, warnings?: string[]): Set<string> {
	const classes = extractClasses(context.content, warnings);
	collectAssignedValues(
		classes,
		context.content,
		/\b(?:className|class|tw)\s*=/g,
		collectClassishExpression,
		warnings,
	);
	collectAssignedValues(
		classes,
		context.content,
		/\b(?:className|class)\s*:/g,
		collectClassishExpression,
		warnings,
	);
	collectAssignedValues(
		classes,
		context.content,
		/\bclassList\s*=/g,
		collectClassishExpression,
		warnings,
	);
	collectCallArguments(classes, context.content, CLASS_HELPERS_CALL_RE, undefined, warnings);
	const variantMetadata = collectVariantHelperArguments(classes, context.content, warnings);
	collectClassMapArguments(classes, context.content, warnings);
	pruneTokens(classes, NON_CLASS_IDENTIFIERS);
	pruneVariantMetadata(classes, variantMetadata, context.content);
	return classes;
}

function extractVue(context: SourceExtractionInput, warnings?: string[]): Set<string> {
	const classes = extractClasses(context.content, warnings);
	collectAssignedValues(
		classes,
		context.content,
		/(?::class|v-bind:class)\s*=/g,
		collectClassishExpression,
		warnings,
	);
	return classes;
}

function extractSvelte(context: SourceExtractionInput, warnings?: string[]): Set<string> {
	const classes = extractClasses(context.content, warnings);
	collectDirectiveNames(classes, context.content, /class:([A-Za-z0-9_-]+)/g, warnings);
	collectAssignedValues(
		classes,
		context.content,
		/\bclass\s*=/g,
		collectClassishExpression,
		warnings,
	);
	return classes;
}

const EXTRACTORS: readonly Extractor[] = [
	{
		test: (context) => !!context.path && context.path.endsWith(".vue"),
		extract: extractVue,
	},
	{
		test: (context) => !!context.path && context.path.endsWith(".svelte"),
		extract: extractSvelte,
	},
	{
		test: (context) => !!context.path && context.path.endsWith(".html"),
		extract: extractHTML,
	},
	{
		test: (context) =>
			!!context.path &&
			(context.path.endsWith(".tsx") ||
				context.path.endsWith(".jsx") ||
				context.path.endsWith(".ts") ||
				context.path.endsWith(".js") ||
				context.path.endsWith(".mdx") ||
				context.path.endsWith(".md")),
		extract: extractJSXTSX,
	},
];

export function extractClassesFromSource(
	input: SourceExtractionInput,
	warnings?: string[],
): Set<string> {
	let classes: Set<string> | undefined;
	for (const extractor of EXTRACTORS) {
		if (extractor.test(input)) {
			classes = extractor.extract(input, warnings);
			break;
		}
	}
	if (!classes) classes = extractClasses(input.content, warnings);

	// `safelist(...)` — cross-language protocol for libraries that ship class
	// declarations alongside their bundled code. Detected in every file type
	// (the bundled JS in node_modules has no JSX); only literal-string
	// arguments are extracted, so the scan is fast and predictable.
	if (input.content.includes("safelist")) {
		collectCallArguments(
			classes,
			input.content,
			SAFELIST_CALL_RE,
			collectStringLiteralClasses,
			warnings,
		);
	}
	return classes;
}
