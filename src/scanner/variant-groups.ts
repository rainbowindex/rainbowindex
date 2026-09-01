// ---------------------------------------------------------------------------
// Variant-group expansion (`prefix:{a b c}` → `prefix:a prefix:b prefix:c`)
// ---------------------------------------------------------------------------
// Leaf module of the scanner graph (imports nothing): the class-token scan,
// the PostCSS `@apply` pre-pass, and the Vite transform all expand groups
// through here, and OutputMap is how the editor path maps expanded offsets
// back to source.

// Bounds how much expansion may ADD, not how long the output may be. Plain
// text passes through unchanged and costs nothing, so a large source file
// with no groups in it never trips this — only real expansion growth does.
const MAX_EXPANSION_GROWTH = 100_000;
const MAX_EXPANSION_INPUT_LENGTH = 500_000;
const MAX_VARIANT_GROUP_DEPTH = 10;

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

/**
 * Piecewise map from a transformed string's offsets back to source offsets.
 * Pieces are ascending, non-overlapping identity spans (out length === src
 * length, identical text); variant-group member pieces also carry the group's
 * prefix span so candidates matched in expanded groups can be annotated.
 * Offsets between pieces (join separators, dropped lines) belong to no piece.
 * Built only when a sink wants positions — the build path never allocates one.
 */
export class OutputMap {
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

// Tokenizer for group bodies in mapped mode. Must agree with the
// `.trim().split(/\s+/).filter(Boolean)` expansion below — \S+ runs of the
// untrimmed body are exactly those tokens. Same lastIndex-drain discipline as
// the scanner's CLASS_RE: reset on entry, drained to null, never re-entered
// mid-scan.
const BODY_TOKEN_RE = /\S+/g;

export function expandVariantGroups(input: string, warnings?: string[], path?: string): string {
	return expandVariantGroupsCore(input, warnings, null, path);
}

export function expandVariantGroupsCore(
	input: string,
	warnings: string[] | undefined,
	map: OutputMap | null,
	path?: string,
): string {
	if (!input.includes("{")) {
		map?.push(0, 0, input.length);
		return input;
	}

	if (input.length > MAX_EXPANSION_INPUT_LENGTH) {
		warnings?.push(
			`[RI-1407] ${path ?? "<source>"}: Variant group expansion input exceeds ${MAX_EXPANSION_INPUT_LENGTH} character limit — returning verbatim.`,
		);
		map?.push(0, 0, input.length);
		return input;
	}

	const parts: string[] = [];
	// Exact length of everything pushed into `parts` so far, which always
	// corresponds to input [0, plainStart). Drives both the map bookkeeping and
	// the growth budget below.
	let outLen = 0;
	let i = 0;
	// Start of the pending run of non-group characters. Runs are flushed as one
	// slice when a group expands (or at the end) instead of pushing one
	// single-character string per position — this loop sees whole files.
	let plainStart = 0;
	// Set by a group that would blow the budget on its own, so the loop head
	// below runs the one bail-out path instead of a second copy of it.
	let overflowed = false;

	while (i < input.length) {
		// `outLen` covers input [0, plainStart) and the pending run [plainStart, i)
		// passes through 1:1, so `outLen - plainStart` is exactly what expansion
		// has added so far — independent of how much plain text came with it.
		//
		// The budget itself is spent below, where each group is sized before it is
		// built and sets `overflowed` rather than growing past the limit. So in
		// practice `overflowed` is what fires here; the arithmetic restates the
		// invariant that keeps it true.
		if (overflowed || outLen - plainStart > MAX_EXPANSION_GROWTH) {
			warnings?.push(
				`[RI-1408] ${path ?? "<source>"}: Variant group expansion exceeds the ${MAX_EXPANSION_GROWTH} character growth limit — remaining input appended verbatim.`,
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
								`[RI-1409] ${path ?? "<source>"}: Variant group nesting exceeds maximum depth of ${MAX_VARIANT_GROUP_DEPTH} — group not expanded.`,
							);
							break;
						}
					} else if (ch === "}") {
						depth--;
					}
					if (depth > 0) j++;
				}

				if (depth === 0) {
					const prefix = input.slice(prefixStart, braceStart);
					const bodyStart = braceStart + 1;
					const body = input.slice(bodyStart, j).trim();
					const members = body.split(/\s+/).filter(Boolean);
					// One group can outgrow the whole budget by itself: the prefix is
					// copied onto every member, so a long prefix over many members
					// multiplies. Checking between groups would only notice after the
					// string it exists to prevent had already been built, so size the
					// expansion here and leave the group verbatim when it does not fit.
					// Measured before the pending run is flushed, hence `prefixStart`
					// rather than `plainStart` on the consumed-input side.
					const expandedLength =
						members.length === 0
							? 0
							: members.length * (prefix.length + 1) -
								1 +
								members.reduce((total, member) => total + member.length, 0);
					const growth = outLen - plainStart + (expandedLength - (j + 1 - prefixStart));
					if (growth > MAX_EXPANSION_GROWTH) {
						overflowed = true;
						break;
					}
					if (prefixStart > plainStart) {
						const run = input.slice(plainStart, prefixStart);
						map?.push(outLen, plainStart, run.length);
						outLen += run.length;
						parts.push(run);
					}
					const expanded = members.map((cls) => prefix + cls).join(" ");
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
export function expandApplyGroups(css: string, warnings?: string[], path?: string): string {
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
			const expanded = expandVariantGroups(body, warnings, path);
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
