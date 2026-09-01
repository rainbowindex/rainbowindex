// ---------------------------------------------------------------------------
// Token grammar + collectors — the extraction core behind every extractor
// ---------------------------------------------------------------------------
// The class-token grammar (CLASS_RE and friends) lives here WITH its sole
// driver, scanClassTokens, so the lastIndex-drain discipline documented on
// each module-level regex stays auditable within one file.

import {
	collectQuotedTokens,
	findMatchingBracket,
	readAssignedValue,
	skipQuoted,
	splitTopLevelArgs,
	walkLiteral,
} from "./js-scan.js";
import { type CandidateSink, SetSink } from "./sinks.js";
import { expandVariantGroupsCore, OutputMap } from "./variant-groups.js";

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
// Shared module-level instance: scanClassTokens resets lastIndex and drains it
// to null on every call, and never re-enters itself mid-scan, so reuse is safe
// and avoids recompiling this large alternation once per collected string value.
const CLASS_RE = new RegExp(CLASS_RE_SOURCE, "g");
const VARIANT_STRIP_RE = new RegExp(`^(?:${VARIANT_SEGMENT})+`);

/** Lines longer than this are dropped from the whole-file token scan — a
 *  guard against minified input. Real minified dists run 100KB+ per line,
 *  while hand-written lines (inline SVG path data, long attribute stacks)
 *  stay well under this, so the guard keeps its target without eating real
 *  source. Exported for the extractors' skip diagnostics and for tests. */
export const MAX_LINE_LENGTH = 10_000;

const CLASS_HELPERS = [
	"clsx",
	"cn",
	"classnames",
	"classNames",
	"cx",
	"ri",
	"twJoin",
	"twMerge",
] as const;

const VARIANT_HELPERS = ["cva", "tv"] as const;

/** Helper-call names whose string arguments are walked for class literals.
 *  Exported for editor tooling so completion-context detection can match the
 *  scanner's own behavior. */
export const CLASS_HELPER_NAMES: readonly string[] = Object.freeze([...CLASS_HELPERS]);

/** Variant-config helper names (`cva`/`tv`) whose config objects are walked. */
export const VARIANT_HELPER_NAMES: readonly string[] = Object.freeze([...VARIANT_HELPERS]);

// Module-level call matchers — every caller is a constant name list, so the
// alternations compile once. Same lastIndex-drain discipline as CLASS_RE:
// reset on entry, drained to null, never re-entered mid-scan.
export const CLASS_HELPERS_CALL_RE = new RegExp(`\\b(?:${CLASS_HELPERS.join("|")})\\s*\\(`, "g");
const VARIANT_HELPERS_CALL_RE = new RegExp(`\\b(?:${VARIANT_HELPERS.join("|")})\\s*\\(`, "g");
const CLASS_MAP_CALL_RE = /\bclassMap\s*\(/g;

// Reused across scanClassTokens invocations — safe under the same
// no-mid-scan-reentry discipline as CLASS_RE.
const TRANSLATE_SCRATCH = new Int32Array(4);

// Candidate filters for scanClassTokens' match loop — module-level so the
// scanner's hottest loop never evaluates a regex literal per matched token.
// BRACKET_SPAN_RE is g-flagged but used with .replace() only, which ignores
// and resets lastIndex — never run .test()/.exec() against it.
const BRACKET_SPAN_RE = /\[[^\]]*\]/g;
const HAS_UPPERCASE_RE = /[A-Z]/;
const BRACKET_WHITESPACE_RE = /\[[^\]]*\s+[^\]]*\]/;
const INDEX_ACCESS_RE = /\[\d*\]$/;
const PROPERTY_ACCESS_RE = /^[\w.@]+\[[^\]]+\]$/;

/**
 * Whitespace inside an arbitrary value makes a class unreachable, not merely
 * unusual: `class`, `@a`/`@apply`, and `safelist()` all split their input on
 * whitespace, so `bg-[url('a b')]` reaches the browser as the two tokens
 * `bg-[url('a` and `b')]` and matches nothing. The scanner has always dropped
 * these, silently, which leaves the author with no CSS and no reason why.
 *
 * Reported once per distinct message: one class is tokenized by both the
 * attribute collector and any helper collector nested inside it.
 */
function warnBracketWhitespace(warnings: string[], cls: string): void {
	const message = `[RI-1412] Class "${cls}" has whitespace inside its arbitrary value, so it can never match an element — class attributes, @a/@apply, and safelist() all split on whitespace. Use "_" for a space (\`bg-[url('a_b')]\` emits \`url('a b')\`) and "\\_" for a literal underscore. The class was skipped.`;
	if (!warnings.includes(message)) warnings.push(message);
}

/**
 * Core token scan: long-line filtering, variant-group expansion, CLASS_RE
 * matching, and candidate filters. `baseOffset` is the absolute offset of
 * `source` within the original document — position-aware sinks receive spans
 * translated back through both transforms; the build path skips all mapping.
 */
export function scanClassTokens(
	sink: CandidateSink,
	source: string,
	baseOffset: number,
	warnings?: string[],
): void {
	const wantsPositions = sink.wantsPositions;

	// Over-long lines are dropped wholesale — including a single-line minified
	// file, which is just the degenerate one-line case. Helper-call collection
	// (safelist()/cn()/cva()) runs on the raw content outside this guard, so
	// library dist scanning is unaffected.
	let filteredSource = source;
	let lineMap: OutputMap | null = null;
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
			if (wantsPositions) lineMap = new OutputMap();
			let outLen = 0;
			start = 0;
			idx = source.indexOf("\n", start);
			while (idx !== -1) {
				if (idx - start <= MAX_LINE_LENGTH) {
					if (lineMap) {
						lineMap.push(outLen, start, idx - start);
						outLen += idx - start + 1;
					}
					parts.push(source.slice(start, idx));
				}
				start = idx + 1;
				idx = source.indexOf("\n", start);
			}
			if (source.length - start <= MAX_LINE_LENGTH) {
				if (lineMap) lineMap.push(outLen, start, source.length - start);
				parts.push(source.slice(start));
			}
			filteredSource = parts.join("\n");
		}
	}

	let expanded = filteredSource;
	let expansionMap: OutputMap | null = null;
	if (filteredSource.includes("{")) {
		if (wantsPositions) expansionMap = new OutputMap();
		expanded = expandVariantGroupsCore(filteredSource, warnings, expansionMap, sink.path);
	}

	CLASS_RE.lastIndex = 0;

	for (;;) {
		const match = CLASS_RE.exec(expanded);
		if (match === null) break;
		const cls = match[1];
		if (!cls) continue;
		const unbanged = cls.endsWith("!") ? cls.slice(0, -1) : cls;
		const base = unbanged.replace(VARIANT_STRIP_RE, "");
		// Every bracket filter (span strip, index/property access, bracket
		// whitespace — the RI-1412 warning included) needs a literal `[` to
		// have any effect, so the common bracket-free candidate skips straight
		// to the uppercase test.
		if (!base.includes("[")) {
			if (HAS_UPPERCASE_RE.test(base)) continue;
		} else {
			if (HAS_UPPERCASE_RE.test(base.replace(BRACKET_SPAN_RE, ""))) continue;
			if (INDEX_ACCESS_RE.test(base)) continue;
			// Reject JS array / property access: `obj[key]`, `rest["aria-invalid"]`,
			// `state.foo["data-state"]`, etc. CSS utility arbitrary values always
			// use `utility-[value]` syntax — the character immediately before `[`
			// must be `-`, and this regex's name part excludes `-`, so anything it
			// matches is an access expression, never a utility.
			if (PROPERTY_ACCESS_RE.test(base)) continue;
			// Ordered last of the four deliberately. All four only `continue`, so
			// the dropped set is identical whatever the order — but this is the one
			// rejection worth reporting, and it can only be reported once the JS
			// access shapes above are out of the way: `styles["my class"]` sits in
			// a className expression and trips the whitespace test too.
			if (BRACKET_WHITESPACE_RE.test(base)) {
				if (warnings && sink.inClassList) warnBracketWhitespace(warnings, cls);
				continue;
			}
		}

		if (!wantsPositions) {
			sink.add(cls, 0, 0, -1, -1);
			continue;
		}

		// The boundary consumes at most one char before the candidate.
		let start = match.index + match[0].length - cls.length;
		let end = start + cls.length;
		let prefixStart = -1;
		let prefixEnd = -1;
		if (expansionMap) {
			if (!expansionMap.translate(start, end, TRANSLATE_SCRATCH)) continue;
			start = TRANSLATE_SCRATCH[0];
			end = TRANSLATE_SCRATCH[1];
			prefixStart = TRANSLATE_SCRATCH[2];
			prefixEnd = TRANSLATE_SCRATCH[3];
		}
		if (lineMap) {
			if (!lineMap.translate(start, end, TRANSLATE_SCRATCH)) continue;
			start = TRANSLATE_SCRATCH[0];
			end = TRANSLATE_SCRATCH[1];
			if (prefixStart >= 0) {
				if (lineMap.translate(prefixStart, prefixEnd, TRANSLATE_SCRATCH)) {
					prefixStart = TRANSLATE_SCRATCH[0];
					prefixEnd = TRANSLATE_SCRATCH[1];
				} else {
					prefixStart = -1;
					prefixEnd = -1;
				}
			}
		}
		sink.add(
			cls,
			baseOffset + start,
			baseOffset + end,
			prefixStart < 0 ? -1 : baseOffset + prefixStart,
			prefixEnd < 0 ? -1 : baseOffset + prefixEnd,
		);
	}
}

export function extractClasses(source: string, warnings?: string[]): Set<string> {
	const classes = new Set<string>();
	scanClassTokens(new SetSink(classes), source, 0, warnings);
	return classes;
}

export type ValueVisitor = (
	sink: CandidateSink,
	value: string,
	base: number,
	warnings?: string[],
) => void;

export function collectDirectiveNames(
	sink: CandidateSink,
	source: string,
	regex: RegExp,
	base: number,
	warnings?: string[],
): void {
	for (;;) {
		const match = regex.exec(source);
		if (match === null) break;
		const value = match[1]?.trim();
		if (!value) continue;
		// The capture cannot contain whitespace, so trim is a no-op and the
		// capture's offset is the match end minus its length.
		const captureStart = base + match.index + match[0].length - match[1].length;
		sink.markContext?.(captureStart, captureStart + match[1].length);
		scanClassTokens(sink, value, captureStart, warnings);
	}
}

// Same lastIndex-drain discipline as CLASS_RE: reset on entry, drained to
// null, never re-entered mid-scan (scanClassTokens never calls back into
// these).
const OBJECT_KEY_COLON_RE = /(["'`])([^"'`]+)\1\s*:|([A-Za-z_@][\w@-]*)\s*:/g;
const OBJECT_KEY_ARROW_RE = /(["'`])([^"'`]+)\1\s*=>/g;

function collectObjectKeys(
	sink: CandidateSink,
	body: string,
	separator: ":" | "=>",
	base: number,
	warnings?: string[],
): void {
	const keyRe = separator === ":" ? OBJECT_KEY_COLON_RE : OBJECT_KEY_ARROW_RE;
	keyRe.lastIndex = 0;
	for (;;) {
		const match = keyRe.exec(body);
		if (match === null) break;
		const raw = match[2] ?? match[3] ?? "";
		const value = raw.trim();
		if (!value) continue;
		// Quoted keys start one char after match.index (the quote); bare keys
		// start at match.index itself.
		const rawStart = match[2] !== undefined ? match.index + 1 : match.index;
		scanClassTokens(sink, value, base + rawStart + (raw.length - raw.trimStart().length), warnings);
	}
}

function collectTemplateLiteralClasses(
	sink: CandidateSink,
	source: string,
	start: number,
	base: number,
	warnings?: string[],
): number {
	return walkLiteral(source, start, 96 /* ` */, (chunkStart, chunkEnd, terminated) => {
		// Unterminated tails are deliberately ignored: the whole-file scan has
		// already collected their tokens as plain candidates, so flushing here
		// would only manufacture positioned duplicates from truncated input.
		if (!terminated) return;
		const raw = source.slice(chunkStart, chunkEnd);
		const value = raw.trim();
		if (value) {
			scanClassTokens(
				sink,
				value,
				base + chunkStart + (raw.length - raw.trimStart().length),
				warnings,
			);
		}
	});
}

/**
 * Is the string literal spanning [open, close] an operand of `==`/`!=` (and
 * so `===`/`!==`)? Only equality is matched: a bare `=` is assignment, where
 * `const base = "px-2"` is a perfectly ordinary class list.
 */
function isEqualityOperand(source: string, open: number, close: number): boolean {
	let before = open - 1;
	while (before >= 0 && /\s/.test(source[before])) before--;
	if (
		before >= 1 &&
		source[before] === "=" &&
		(source[before - 1] === "=" || source[before - 1] === "!")
	) {
		return true;
	}
	let after = close + 1;
	while (after < source.length && /\s/.test(source[after])) after++;
	return (source[after] === "=" || source[after] === "!") && source[after + 1] === "=";
}

export function collectStringLiteralClasses(
	sink: CandidateSink,
	source: string,
	base: number,
	warnings?: string[],
): void {
	let i = 0;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "'" || ch === '"') {
			const end = skipQuoted(source, i, ch);
			const raw = source.slice(i + 1, end);
			const value = raw.trim();
			if (value) {
				// The value is still collected — dropping it would change the
				// generated CSS — but an equality operand is flagged so editors
				// can tell `mode === "default"` from a real class list.
				if (isEqualityOperand(source, i, end)) sink.markExpression?.(base + i, base + end + 1);
				scanClassTokens(
					sink,
					value,
					base + i + 1 + (raw.length - raw.trimStart().length),
					warnings,
				);
			}
			i = end + 1;
			continue;
		}
		if (ch === "`") {
			i = collectTemplateLiteralClasses(sink, source, i, base, warnings) + 1;
			continue;
		}
		i++;
	}
}

export function collectAssignedValues(
	sink: CandidateSink,
	source: string,
	regex: RegExp,
	visitor: ValueVisitor = scanClassTokens,
	base = 0,
	warnings?: string[],
): void {
	regex.lastIndex = 0;
	for (;;) {
		const match = regex.exec(source);
		if (match === null) break;
		const parsed = readAssignedValue(source, match.index + match[0].length);
		if (!parsed) continue;
		const raw = parsed.value;
		const value = raw.trim();
		if (!value) continue;
		sink.markContext?.(base + parsed.valueStart, base + parsed.valueStart + raw.length);
		const valueOffset = base + parsed.valueStart + (raw.length - raw.trimStart().length);
		// A quoted or bare value IS a class list, so tokenize it directly — the
		// expression visitors only find literals nested INSIDE a value, and the
		// whole-file scan that used to cover these drops >MAX_LINE_LENGTH lines
		// (e.g. `className` sharing a line with inline SVG path data), silently
		// losing the classes. Tokenizing here is also what earns these values
		// their context provenance: a token only the whole-file scan found is
		// never eligible for an attribute/helper origin (CandidateCollector.add).
		// Template and `{…}` values are excluded — they carry code, so only the
		// caller's visitor may decide what inside them is a class. The visitor
		// still runs: a quoted value can carry nested extractables (template
		// chunks), and duplicate finds dedupe in the sink.
		if ((parsed.quoted || parsed.bare) && visitor !== scanClassTokens) {
			scanClassTokens(sink, value, valueOffset, warnings);
		}
		visitor(sink, value, valueOffset, warnings);
		regex.lastIndex = Math.max(regex.lastIndex, parsed.end + 1);
	}
}

export function collectClassishExpression(
	sink: CandidateSink,
	expression: string,
	base: number,
	warnings?: string[],
): void {
	collectStringLiteralClasses(sink, expression, base, warnings);
	collectObjectKeys(sink, expression, ":", base, warnings);
	collectObjectKeys(sink, expression, "=>", base, warnings);
}

/** Helper name from a call-matcher hit — match[0] is `name(` with optional
 *  interior whitespace. */
function helperNameFromMatch(matched: string): string {
	return matched.slice(0, matched.length - 1).trim();
}

export function collectCallArguments(
	sink: CandidateSink,
	source: string,
	callRe: RegExp,
	visitor: ValueVisitor = collectClassishExpression,
	base = 0,
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
		const raw = source.slice(openIndex + 1, end);
		const value = raw.trim();
		if (value) {
			sink.setHelper?.(helperNameFromMatch(match[0]));
			sink.markContext?.(base + openIndex + 1, base + end);
			visitor(sink, value, base + openIndex + 1 + (raw.length - raw.trimStart().length), warnings);
		}
		callRe.lastIndex = Math.max(callRe.lastIndex, end + 1);
	}
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

/** Walk one cva()/tv() config object, feeding class candidates to `sink` and
 *  structural tokens (variant/slot key names, defaultVariants values) to
 *  `tokenSink` in the same pass — each recognized config key is driven exactly
 *  once, so the two collections can never drift apart. `tokenSink` is a
 *  position-free SetSink with no context methods, so the token halves add no
 *  markContext/setHelper calls beyond what the class drives already make. */
function collectVariantConfigClasses(
	sink: CandidateSink,
	tokenSink: CandidateSink,
	source: string,
	base: number,
	warnings?: string[],
): void {
	collectAssignedValues(sink, source, CLASS_BASE_KEY_RE, collectClassishExpression, base, warnings);
	collectAssignedValues(
		sink,
		source,
		VARIANTS_KEY_RE,
		(nextSink, value, valueBase, w) => {
			collectStringLiteralClasses(nextSink, value, valueBase, w);
			// Variant group/value names are structural keys, not classes.
			collectObjectKeys(tokenSink, value, ":", valueBase, w);
		},
		base,
		warnings,
	);
	collectAssignedValues(
		sink,
		source,
		COMPOUND_VARIANTS_KEY_RE,
		(nextSink, value, valueBase, w) => {
			collectAssignedValues(nextSink, value, CLASS_KEY_RE, scanClassTokens, valueBase, w);
		},
		base,
		warnings,
	);
	collectAssignedValues(
		sink,
		source,
		SLOTS_KEY_RE,
		(nextSink, value, valueBase, w) => {
			collectAssignedValues(
				nextSink,
				value,
				SLOT_ENTRY_KEY_RE,
				collectClassishExpression,
				valueBase,
				w,
			);
			// Slot names are structural keys, not classes.
			collectObjectKeys(tokenSink, value, ":", valueBase, w);
		},
		base,
		warnings,
	);
	// defaultVariants carries no classes — only structural tokens (its keys and
	// its string values, e.g. `size: "sm"`), so this drive feeds tokenSink alone.
	collectAssignedValues(
		tokenSink,
		source,
		DEFAULT_VARIANTS_KEY_RE,
		(t, v, b, w) => {
			collectObjectKeys(t, v, ":", b, w);
			collectStringLiteralClasses(t, v, b, w);
		},
		base,
		warnings,
	);
}

type VariantHelperMetadata = {
	tokens: Set<string>;
	/** [start, end) spans of each helper call's argument list, ascending,
	 *  relative to the scanned source. */
	callRanges: Array<[number, number]>;
};

export function collectVariantHelperArguments(
	sink: CandidateSink,
	source: string,
	base: number,
	warnings?: string[],
): VariantHelperMetadata {
	// Structural keys of cva()/tv() configs that must not survive as class names,
	// seeded with the static keys and grown with the variant/slot keys found in
	// this file's configs. collectVariantConfigClasses feeds both sinks in one
	// pass, so each config is walked once, not twice. The caller prunes these last.
	const tokens = new Set<string>([
		"variants",
		"defaultVariants",
		"compoundVariants",
		"slots",
		"base",
		"class",
		"className",
	]);
	// Key collection reuses the class collectors — a Set-backed sink keeps them
	// position-free regardless of what the outer sink wants.
	const tokenSink = new SetSink(tokens, sink.path);
	const callRanges: Array<[number, number]> = [];
	VARIANT_HELPERS_CALL_RE.lastIndex = 0;
	for (;;) {
		const match = VARIANT_HELPERS_CALL_RE.exec(source);
		if (match === null) break;
		const openIndex = match.index + match[0].length - 1;
		const end = findMatchingBracket(source, openIndex);
		if (end === -1) continue;
		callRanges.push([openIndex + 1, end]);
		sink.setHelper?.(helperNameFromMatch(match[0]));
		sink.markContext?.(base + openIndex + 1, base + end);
		const argsBase = base + openIndex + 1;
		const args = splitTopLevelArgs(source.slice(openIndex + 1, end));
		// tv() takes its config object as the FIRST argument; cva() takes base
		// classes first and the config second. A leading `{` (splitTopLevelArgs
		// trims) is what tells the two shapes apart.
		const first = args[0];
		const config = first?.text.startsWith("{") ? first : args[1];
		if (first?.text && first !== config) {
			collectClassishExpression(sink, first.text, argsBase + first.start, warnings);
		}
		if (config) {
			collectVariantConfigClasses(sink, tokenSink, config.text, argsBase + config.start, warnings);
		}
		VARIANT_HELPERS_CALL_RE.lastIndex = Math.max(VARIANT_HELPERS_CALL_RE.lastIndex, end + 1);
	}
	return { tokens, callRanges };
}

export function collectClassMapArguments(
	sink: CandidateSink,
	source: string,
	base: number,
	warnings?: string[],
): void {
	CLASS_MAP_CALL_RE.lastIndex = 0;
	for (;;) {
		const match = CLASS_MAP_CALL_RE.exec(source);
		if (match === null) break;
		const openIndex = match.index + match[0].length - 1;
		const end = findMatchingBracket(source, openIndex);
		if (end === -1) continue;
		const raw = source.slice(openIndex + 1, end);
		const value = raw.trim();
		if (value) {
			sink.setHelper?.("classMap");
			sink.markContext?.(base + openIndex + 1, base + end);
			const valueBase = base + openIndex + 1 + (raw.length - raw.trimStart().length);
			collectObjectKeys(sink, value, ":", valueBase, warnings);
			collectObjectKeys(sink, value, "=>", valueBase, warnings);
		}
		CLASS_MAP_CALL_RE.lastIndex = Math.max(CLASS_MAP_CALL_RE.lastIndex, end + 1);
	}
}

export function pruneTokens(sink: CandidateSink, tokens: Iterable<string>): void {
	for (const token of tokens) {
		sink.delete(token);
	}
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
export function pruneVariantMetadata(
	sink: CandidateSink,
	metadata: VariantHelperMetadata,
	source: string,
): void {
	if (metadata.callRanges.length === 0) {
		pruneTokens(sink, metadata.tokens);
		return;
	}
	const quoted = new Set<string>();
	collectQuotedTokens(source, metadata.callRanges, quoted);
	for (const token of metadata.tokens) {
		if (!quoted.has(token)) sink.delete(token);
	}
}
