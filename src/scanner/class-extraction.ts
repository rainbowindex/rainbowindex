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

/** Helper-call names whose string arguments are walked for class literals.
 *  Exported for editor tooling so completion-context detection can match the
 *  scanner's own behavior. */
export const CLASS_HELPER_NAMES: readonly string[] = Object.freeze([...CLASS_HELPERS]);

/** Variant-config helper names (`cva`/`tv`) whose config objects are walked. */
export const VARIANT_HELPER_NAMES: readonly string[] = Object.freeze([...VARIANT_HELPERS]);

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

// ---------------------------------------------------------------------------
// Candidate sinks — one extraction core, two consumers
// ---------------------------------------------------------------------------

export type CandidateOrigin = "attribute" | "helper" | "safelist" | "plain";

export interface ClassCandidate {
	/** The class string in expanded form — for variant-group members this
	 *  includes the group prefix (`hover:bg-red-500`) even though the span
	 *  covers only the member token inside the braces. */
	value: string;
	/** Absolute [start, end) span of the visible token in the original source.
	 *  `source.slice(start, end)` is the member token for group members and
	 *  `value` itself everywhere else. */
	start: number;
	end: number;
	origin: CandidateOrigin;
	/** The call the class was found in, when origin is "helper"/"safelist". */
	helperName?: string;
	/** For variant-group members: span of the group's variant prefix (`hover:`). */
	groupPrefix?: { start: number; end: number };
}

/**
 * Where extracted class tokens land. The build path uses a Set-backed sink
 * (positions ignored, value dedup); the editor path collects positioned
 * candidates. Optional methods are editor-only annotations — call sites use
 * optional chaining, so the build path pays one undefined check, not a call.
 */
interface CandidateSink {
	readonly wantsPositions: boolean;
	/** start/end are absolute [start, end) offsets in the ORIGINAL source
	 *  (0,0 when the sink doesn't want positions). prefixStart/prefixEnd
	 *  delimit the variant-group prefix for group members, or are -1. */
	add(value: string, start: number, end: number, prefixStart: number, prefixEnd: number): void;
	/** Remove every candidate with this exact value (post-hoc pruning). */
	delete(value: string): void;
	setOrigin?(origin: CandidateOrigin): void;
	setHelper?(name: string | null): void;
	/** Record that [start, end) is a class context (attribute value, helper
	 *  argument list) under the active origin. Origin assignment is by
	 *  containment, so simple quoted values — which only the whole-file scan
	 *  tokenizes — still get their context's origin. Never affects values. */
	markContext?(start: number, end: number): void;
}

/** Build-path sink: value-dedup into a Set, positions discarded. */
class SetSink implements CandidateSink {
	readonly wantsPositions = false;
	constructor(readonly classes: Set<string>) {}
	add(value: string): void {
		this.classes.add(value);
	}
	delete(value: string): void {
		this.classes.delete(value);
	}
}

interface CandidateContext {
	start: number;
	end: number;
	origin: CandidateOrigin;
	helper: string | null;
}

/**
 * Editor-path sink: positioned candidates, deduped by span + value
 * (keep-first). The same span can host two different values — a nested
 * group's mangled expansion and an object-key collector can both claim one
 * token — and both must survive to keep value parity with the build path's
 * Set. Origins are resolved at finish() by context containment: collectors
 * record every class context they visit (attribute values, helper argument
 * lists), and each candidate takes the origin of the smallest context that
 * contains its span — so a class inside a clsx() call inside a className
 * expression reports "helper", not "attribute". Candidates contained by no
 * context stay "plain". Contexts never contribute values, so value parity
 * with the build path is untouched.
 */
class CandidateCollector implements CandidateSink {
	readonly wantsPositions = true;
	private origin: CandidateOrigin = "plain";
	private helperName: string | null = null;
	private readonly byCandidate = new Map<string, ClassCandidate>();
	private readonly contexts: CandidateContext[] = [];

	setOrigin(origin: CandidateOrigin): void {
		this.origin = origin;
		this.helperName = null;
	}

	setHelper(name: string | null): void {
		this.helperName = name;
	}

	markContext(start: number, end: number): void {
		if (this.origin === "plain" || end <= start) return;
		this.contexts.push({ start, end, origin: this.origin, helper: this.helperName });
	}

	add(value: string, start: number, end: number, prefixStart: number, prefixEnd: number): void {
		const key = `${start}:${end}:${value}`;
		if (this.byCandidate.has(key)) return;
		const candidate: ClassCandidate = { value, start, end, origin: "plain" };
		if (prefixStart >= 0) candidate.groupPrefix = { start: prefixStart, end: prefixEnd };
		this.byCandidate.set(key, candidate);
	}

	delete(value: string): void {
		for (const [key, candidate] of this.byCandidate) {
			if (candidate.value === value) this.byCandidate.delete(key);
		}
	}

	finish(): ClassCandidate[] {
		const candidates = [...this.byCandidate.values()].sort(
			(a, b) => a.start - b.start || a.end - b.end,
		);
		if (this.contexts.length > 0) {
			for (const candidate of candidates) {
				let best: CandidateContext | null = null;
				for (const context of this.contexts) {
					if (context.start <= candidate.start && candidate.end <= context.end) {
						if (!best || context.end - context.start < best.end - best.start) {
							best = context;
						}
					}
				}
				if (best) {
					candidate.origin = best.origin;
					if (best.helper) candidate.helperName = best.helper;
				}
			}
		}
		return candidates;
	}
}

// ---------------------------------------------------------------------------
// Output → source offset mapping
// ---------------------------------------------------------------------------

/**
 * Piecewise map from a transformed string's offsets back to source offsets.
 * Pieces are ascending, non-overlapping identity spans (out length === src
 * length, identical text); variant-group member pieces also carry the group's
 * prefix span so candidates matched in expanded groups can be annotated.
 * Offsets between pieces (join separators, dropped lines) belong to no piece.
 * Built only when a sink wants positions — the build path never allocates one.
 */
class OutputMap {
	private readonly outStarts: number[] = [];
	private readonly srcStarts: number[] = [];
	private readonly lens: number[] = [];
	private readonly prefixStarts: number[] = [];
	private readonly prefixEnds: number[] = [];

	push(outStart: number, srcStart: number, len: number, prefixStart = -1, prefixEnd = -1): void {
		if (len <= 0) return;
		this.outStarts.push(outStart);
		this.srcStarts.push(srcStart);
		this.lens.push(len);
		this.prefixStarts.push(prefixStart);
		this.prefixEnds.push(prefixEnd);
	}

	/** Piece index containing out offset, or -1. */
	private find(out: number): number {
		const starts = this.outStarts;
		let lo = 0;
		let hi = starts.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (starts[mid] > out) hi = mid - 1;
			else if (starts[mid] + this.lens[mid] <= out) lo = mid + 1;
			else return mid;
		}
		return -1;
	}

	/**
	 * Translate an [outStart, outEnd) span into `span`: [0] srcStart,
	 * [1] srcEnd, [2]/[3] group prefix span or -1. Returns false when the span
	 * maps nowhere. A span ending inside a group-member piece resolves to that
	 * member's mapping wholesale — the visible token is the member; matches
	 * that begin in the prefix piece clamp to the member start. The prefix
	 * annotation is attached only when the match starts exactly at the token
	 * start (prefix piece start): only then does the match's value contain the
	 * full prefix chain, keeping the ClassCandidate contract
	 * `groupPrefix slice + member slice === value`. Matches strictly inside a
	 * member (or crossing pieces) map to a plain span with no annotation.
	 */
	translate(outStart: number, outEnd: number, span: Int32Array): boolean {
		const j = this.find(outEnd - 1);
		if (j === -1) return false;
		const jOut = this.outStarts[j];
		if (this.prefixStarts[j] >= 0) {
			const src = this.srcStarts[j];
			span[0] = src + Math.max(0, outStart - jOut);
			span[1] = src + (outEnd - jOut);
			const tokenStart = jOut - (this.prefixEnds[j] - this.prefixStarts[j]);
			if (outStart === tokenStart) {
				span[2] = this.prefixStarts[j];
				span[3] = this.prefixEnds[j];
			} else {
				span[2] = -1;
				span[3] = -1;
			}
			return true;
		}
		span[1] = this.srcStarts[j] + (outEnd - jOut);
		let i = j;
		if (outStart < jOut) {
			i = this.find(outStart);
			if (i === -1) return false;
		}
		span[0] = this.srcStarts[i] + (outStart - this.outStarts[i]);
		span[2] = -1;
		span[3] = -1;
		return true;
	}
}

// Reused across scanClassTokens invocations — safe under the same
// no-mid-scan-reentry discipline as CLASS_RE.
const TRANSLATE_SCRATCH = new Int32Array(4);

// Tokenizer for group bodies in mapped mode. Must agree with the
// `.trim().split(/\s+/).filter(Boolean)` expansion below — \S+ runs of the
// untrimmed body are exactly those tokens. Same lastIndex-drain discipline as
// CLASS_RE: reset on entry, drained to null, never re-entered mid-scan.
const BODY_TOKEN_RE = /\S+/g;

export function expandVariantGroups(input: string, warnings?: string[]): string {
	return expandVariantGroupsCore(input, warnings, null);
}

function expandVariantGroupsCore(
	input: string,
	warnings: string[] | undefined,
	map: OutputMap | null,
): string {
	if (!input.includes("{")) {
		map?.push(0, 0, input.length);
		return input;
	}

	if (input.length > MAX_EXPANSION_INPUT_LENGTH) {
		warnings?.push(
			`[RI-1407] Variant group expansion input exceeds ${MAX_EXPANSION_INPUT_LENGTH} character limit — returning verbatim.`,
		);
		map?.push(0, 0, input.length);
		return input;
	}

	const parts: string[] = [];
	let partsLen = 0;
	// Exact output length so far — only consulted for map bookkeeping.
	// partsLen deliberately keeps its original meaning (the budget check).
	let outLen = 0;
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
			if (i > plainStart) {
				map?.push(outLen, plainStart, i - plainStart);
				outLen += i - plainStart;
				parts.push(input.slice(plainStart, i));
			}
			plainStart = input.length;
			map?.push(outLen, i, input.length - i);
			outLen += input.length - i;
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
						map?.push(outLen, plainStart, run.length);
						outLen += run.length;
						parts.push(run);
						partsLen += run.length;
					}
					const prefix = input.slice(prefixStart, braceStart);
					const bodyStart = braceStart + 1;
					const body = input.slice(bodyStart, j).trim();
					const expanded = body
						.split(/\s+/)
						.filter(Boolean)
						.map((cls) => prefix + cls)
						.join(" ");
					if (map) {
						// Each expanded token gets two identity pieces: the prefix
						// (same text as `prefix:` before the braces) and the member
						// (same text as its body token) — the member piece carries
						// the prefix span for group annotation.
						const rawBody = input.slice(bodyStart, j);
						let outPos = outLen;
						let first = true;
						BODY_TOKEN_RE.lastIndex = 0;
						for (;;) {
							const token = BODY_TOKEN_RE.exec(rawBody);
							if (token === null) break;
							if (!first) outPos += 1;
							first = false;
							map.push(outPos, prefixStart, prefix.length);
							map.push(
								outPos + prefix.length,
								bodyStart + token.index,
								token[0].length,
								prefixStart,
								braceStart,
							);
							outPos += prefix.length + token[0].length;
						}
					}
					outLen += expanded.length;
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

	if (plainStart < input.length) {
		map?.push(outLen, plainStart, input.length - plainStart);
		parts.push(input.slice(plainStart));
	}

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
 * Core token scan: long-line filtering, variant-group expansion, CLASS_RE
 * matching, and candidate filters. `baseOffset` is the absolute offset of
 * `source` within the original document — position-aware sinks receive spans
 * translated back through both transforms; the build path skips all mapping.
 */
function scanClassTokens(
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
		expanded = expandVariantGroupsCore(filteredSource, warnings, expansionMap);
	}

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

function addClasses(sink: CandidateSink, value: string, base: number, warnings?: string[]): void {
	scanClassTokens(sink, value, base, warnings);
}

type ValueVisitor = (sink: CandidateSink, value: string, base: number, warnings?: string[]) => void;

function collectDirectiveNames(
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
		addClasses(sink, value, captureStart, warnings);
	}
}

// Same lastIndex-drain discipline as CLASS_RE: reset on entry, drained to
// null, never re-entered mid-scan (addClasses never calls back into these).
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
		addClasses(sink, value, base + rawStart + (raw.length - raw.trimStart().length), warnings);
	}
}

function collectTemplateLiteralClasses(
	sink: CandidateSink,
	source: string,
	start: number,
	base: number,
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
			const raw = source.slice(chunkStart, i);
			const value = raw.trim();
			if (value) {
				addClasses(
					sink,
					value,
					base + chunkStart + (raw.length - raw.trimStart().length),
					warnings,
				);
			}
			return i;
		}
		if (ch === "$" && source[i + 1] === "{") {
			const raw = source.slice(chunkStart, i);
			const value = raw.trim();
			if (value) {
				addClasses(
					sink,
					value,
					base + chunkStart + (raw.length - raw.trimStart().length),
					warnings,
				);
			}
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
				addClasses(sink, value, base + i + 1 + (raw.length - raw.trimStart().length), warnings);
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

function readAssignedValue(
	source: string,
	start: number,
): { value: string; end: number; valueStart: number } | null {
	const i = skipWhitespace(source, start);
	const ch = source[i];
	if (!ch) return null;

	if (ch === "'" || ch === '"') {
		const end = skipQuoted(source, i, ch);
		return {
			value: source.slice(i + 1, end),
			end,
			valueStart: i + 1,
		};
	}

	if (ch === "`") {
		const end = skipTemplateLiteral(source, i);
		return {
			value: source.slice(i + 1, end),
			end,
			valueStart: i + 1,
		};
	}

	if (ch in BRACKET_PAIRS) {
		const end = findMatchingBracket(source, i);
		if (end === -1) return null;
		return {
			value: source.slice(i + 1, end),
			end,
			valueStart: i + 1,
		};
	}

	let end = i;
	while (end < source.length && !isValueTerminatorCode(source.charCodeAt(end))) end++;
	return {
		value: source.slice(i, end),
		end: end - 1,
		valueStart: i,
	};
}

function collectAssignedValues(
	sink: CandidateSink,
	source: string,
	regex: RegExp,
	visitor: ValueVisitor = addClasses,
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
		visitor(
			sink,
			value,
			base + parsed.valueStart + (raw.length - raw.trimStart().length),
			warnings,
		);
		regex.lastIndex = Math.max(regex.lastIndex, parsed.end + 1);
	}
}

function collectClassishExpression(
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

function collectCallArguments(
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

function splitTopLevelArgs(source: string): Array<{ text: string; start: number }> {
	const parts: Array<{ text: string; start: number }> = [];
	const pushPart = (from: number, to: number): void => {
		const raw = source.slice(from, to);
		const text = raw.trim();
		parts.push({ text, start: from + (raw.length - raw.trimStart().length) });
	};
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
			pushPart(last, i);
			last = i + 1;
		}
		i++;
	}
	const tailRaw = source.slice(last);
	if (tailRaw.trim()) pushPart(last, source.length);
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
	sink: CandidateSink,
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
		},
		base,
		warnings,
	);
	collectAssignedValues(
		sink,
		source,
		COMPOUND_VARIANTS_KEY_RE,
		(nextSink, value, valueBase, w) => {
			collectAssignedValues(nextSink, value, CLASS_KEY_RE, addClasses, valueBase, w);
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

function collectVariantHelperArguments(
	sink: CandidateSink,
	source: string,
	base: number,
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
	// Key collection reuses the class collectors — a Set-backed sink keeps them
	// position-free regardless of what the outer sink wants.
	const tokenSink = new SetSink(tokens);
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
			collectVariantConfigClasses(sink, config.text, argsBase + config.start, warnings);
			collectAssignedValues(
				tokenSink,
				config.text,
				VARIANTS_KEY_RE,
				(t, v, b, w) => {
					collectObjectKeys(t, v, ":", b, w);
				},
				0,
				warnings,
			);
			collectAssignedValues(
				tokenSink,
				config.text,
				DEFAULT_VARIANTS_KEY_RE,
				(t, v, b, w) => {
					collectObjectKeys(t, v, ":", b, w);
					collectStringLiteralClasses(t, v, b, w);
				},
				0,
				warnings,
			);
			collectAssignedValues(
				tokenSink,
				config.text,
				SLOTS_KEY_RE,
				(t, v, b, w) => {
					collectObjectKeys(t, v, ":", b, w);
				},
				0,
				warnings,
			);
		}
		VARIANT_HELPERS_CALL_RE.lastIndex = Math.max(VARIANT_HELPERS_CALL_RE.lastIndex, end + 1);
	}
	return { tokens, callRanges };
}

function collectClassMapArguments(
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

function pruneTokens(sink: CandidateSink, tokens: Iterable<string>): void {
	for (const token of tokens) {
		sink.delete(token);
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

// ---------------------------------------------------------------------------
// Per-filetype extractors
// ---------------------------------------------------------------------------

type Extractor = {
	test: (context: SourceExtractionInput) => boolean;
	extract: (sink: CandidateSink, context: SourceExtractionInput, warnings?: string[]) => void;
};

/** Adds nothing — used for position-only passes that record class contexts
 *  (markContext) without contributing values, so build output is untouched. */
const NOOP_VISITOR: ValueVisitor = () => undefined;

function extractHTML(
	sink: CandidateSink,
	context: SourceExtractionInput,
	warnings?: string[],
): void {
	sink.setOrigin?.("plain");
	scanClassTokens(sink, context.content, 0, warnings);
	// Quoted class attributes are fully tokenized by the whole-file scan above;
	// this pass only annotates their spans as attribute contexts.
	if (sink.wantsPositions) {
		sink.setOrigin?.("attribute");
		collectAssignedValues(sink, context.content, /\bclass\s*=/g, NOOP_VISITOR, 0, warnings);
	}
}

function extractJSXTSX(
	sink: CandidateSink,
	context: SourceExtractionInput,
	warnings?: string[],
): void {
	const content = context.content;
	sink.setOrigin?.("plain");
	scanClassTokens(sink, content, 0, warnings);
	sink.setOrigin?.("attribute");
	collectAssignedValues(
		sink,
		content,
		/\b(?:className|class|tw)\s*=/g,
		collectClassishExpression,
		0,
		warnings,
	);
	collectAssignedValues(
		sink,
		content,
		/\b(?:className|class)\s*:/g,
		collectClassishExpression,
		0,
		warnings,
	);
	collectAssignedValues(sink, content, /\bclassList\s*=/g, collectClassishExpression, 0, warnings);
	sink.setOrigin?.("helper");
	collectCallArguments(sink, content, CLASS_HELPERS_CALL_RE, undefined, 0, warnings);
	const variantMetadata = collectVariantHelperArguments(sink, content, 0, warnings);
	collectClassMapArguments(sink, content, 0, warnings);
	sink.setHelper?.(null);
	pruneTokens(sink, NON_CLASS_IDENTIFIERS);
	pruneVariantMetadata(sink, variantMetadata, content);
}

function extractVue(
	sink: CandidateSink,
	context: SourceExtractionInput,
	warnings?: string[],
): void {
	sink.setOrigin?.("plain");
	scanClassTokens(sink, context.content, 0, warnings);
	sink.setOrigin?.("attribute");
	collectAssignedValues(
		sink,
		context.content,
		/(?::class|v-bind:class)\s*=/g,
		collectClassishExpression,
		0,
		warnings,
	);
	// Position-only annotation for static class="…" attributes (see extractHTML).
	if (sink.wantsPositions) {
		collectAssignedValues(
			sink,
			context.content,
			/(?<![:\w-])class\s*=/g,
			NOOP_VISITOR,
			0,
			warnings,
		);
	}
}

function extractSvelte(
	sink: CandidateSink,
	context: SourceExtractionInput,
	warnings?: string[],
): void {
	sink.setOrigin?.("plain");
	scanClassTokens(sink, context.content, 0, warnings);
	sink.setOrigin?.("attribute");
	collectDirectiveNames(sink, context.content, /class:([A-Za-z0-9_-]+)/g, 0, warnings);
	collectAssignedValues(
		sink,
		context.content,
		/\bclass\s*=/g,
		collectClassishExpression,
		0,
		warnings,
	);
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

function extractInto(sink: CandidateSink, input: SourceExtractionInput, warnings?: string[]): void {
	let handled = false;
	for (const extractor of EXTRACTORS) {
		if (extractor.test(input)) {
			extractor.extract(sink, input, warnings);
			handled = true;
			break;
		}
	}
	if (!handled) {
		sink.setOrigin?.("plain");
		scanClassTokens(sink, input.content, 0, warnings);
	}

	// `safelist(...)` — cross-language protocol for libraries that ship class
	// declarations alongside their bundled code. Detected in every file type
	// (the bundled JS in node_modules has no JSX); only literal-string
	// arguments are extracted, so the scan is fast and predictable. Runs after
	// the extractor's prunes on purpose: a safelisted literal survives even
	// when it collides with a structural token.
	if (input.content.includes("safelist")) {
		sink.setOrigin?.("safelist");
		collectCallArguments(
			sink,
			input.content,
			SAFELIST_CALL_RE,
			collectStringLiteralClasses,
			0,
			warnings,
		);
		sink.setHelper?.(null);
	}
}

export function extractClassesFromSource(
	input: SourceExtractionInput,
	warnings?: string[],
): Set<string> {
	const classes = new Set<string>();
	extractInto(new SetSink(classes), input, warnings);
	return classes;
}

/**
 * Position-aware variant of `extractClassesFromSource` for editor tooling.
 * Same extractors, same filters, same pruning — the value set of the result
 * always equals `extractClassesFromSource(input)`. Each candidate additionally
 * carries its source span, its collection origin, and (for variant-group
 * members) the group's prefix span. Candidates are sorted by position and
 * deduped by span + value; a span found by both the whole-file scan and a
 * context-aware collector reports the collector's origin.
 */
export function extractClassCandidates(
	input: SourceExtractionInput,
	warnings?: string[],
): ClassCandidate[] {
	const collector = new CandidateCollector();
	extractInto(collector, input, warnings);
	return collector.finish();
}
