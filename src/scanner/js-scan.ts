// ---------------------------------------------------------------------------
// JS micro-lexer — charCode scanning primitives for the class collectors
// ---------------------------------------------------------------------------
// Leaf module of the scanner graph (imports nothing). These are pure position
// walkers over raw JS/HTML source: they never allocate beyond the slices a
// caller keeps, so the collectors can lean on them in their hottest loops.

const BRACKET_PAIRS = {
	"(": ")",
	"[": "]",
	"{": "}",
} as const;

/** ASCII \s — sufficient for the JS/HTML source these hot loops read. */
function isWhitespaceCode(code: number): boolean {
	// space: 32, tab through CR: 9-13
	return code === 32 || (code >= 9 && code <= 13);
}

export function skipQuoted(source: string, start: number, quote: "'" | '"'): number {
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

/**
 * Walk one quoted or template literal from its opening quote at `start`.
 * Single owner of the escape / `${}`-interpolation / termination skeleton —
 * the template-class collector, bracket skipper, and quoted-token provenance
 * pass all wrap this one walker, so the tricky invariants (escape-at-EOF,
 * nested interpolation, unterminated input) cannot drift between copies.
 *
 * Emits every non-empty literal chunk via `onChunk(chunkStart, chunkEnd,
 * terminated)`:
 * - at a `${` (backtick literals only) the preceding chunk is flushed with
 *   terminated=true, then the interpolation is skipped via
 *   findMatchingBracket; when the interpolation never closes the walk stops
 *   WITHOUT emitting a tail chunk;
 * - at the closing quote the pending chunk is flushed with terminated=true;
 * - at plain EOF the pending tail is flushed with terminated=false — each
 *   caller decides whether unterminated tails count.
 * Returns the closing-quote index, or `source.length - 1` when the input
 * ends first.
 */
export function walkLiteral(
	source: string,
	start: number,
	quoteCode: number,
	onChunk: (chunkStart: number, chunkEnd: number, terminated: boolean) => void,
): number {
	let i = start + 1;
	let chunkStart = i;
	while (i < source.length) {
		const code = source.charCodeAt(i);
		if (code === 92 /* \ */) {
			i += 2;
			continue;
		}
		if (code === quoteCode) {
			if (i > chunkStart) onChunk(chunkStart, i, true);
			return i;
		}
		if (
			quoteCode === 96 /* ` */ &&
			code === 36 /* $ */ &&
			source.charCodeAt(i + 1) === 123 /* { */
		) {
			if (i > chunkStart) onChunk(chunkStart, i, true);
			const end = findMatchingBracket(source, i + 1);
			if (end === -1) return source.length - 1;
			i = end + 1;
			chunkStart = i;
			continue;
		}
		i++;
	}
	if (source.length > chunkStart) onChunk(chunkStart, source.length, false);
	return source.length - 1;
}

// Module-level so skipTemplateLiteral allocates no closure — it runs inside
// findMatchingBracket's loop.
const NOOP_CHUNK = (): void => undefined;

function skipTemplateLiteral(source: string, start: number): number {
	return walkLiteral(source, start, 96 /* ` */, NOOP_CHUNK);
}

export function findMatchingBracket(source: string, start: number): number {
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

export function readAssignedValue(
	source: string,
	start: number,
): { value: string; end: number; valueStart: number; quoted: boolean; bare: boolean } | null {
	const i = skipWhitespace(source, start);
	const ch = source[i];
	if (!ch) return null;

	// `quoted` marks a plain '/" string — its value IS the final class list,
	// with no nested expression for a visitor to unwrap. Template and bracket
	// values are not "quoted": they may contain interpolations or code, so
	// their handling stays with the caller's visitor.
	if (ch === "'" || ch === '"') {
		const end = skipQuoted(source, i, ch);
		return {
			value: source.slice(i + 1, end),
			end,
			valueStart: i + 1,
			quoted: true,
			bare: false,
		};
	}

	if (ch === "`") {
		const end = skipTemplateLiteral(source, i);
		return {
			value: source.slice(i + 1, end),
			end,
			valueStart: i + 1,
			quoted: false,
			bare: false,
		};
	}

	if (ch in BRACKET_PAIRS) {
		const end = findMatchingBracket(source, i);
		if (end === -1) return null;
		return {
			value: source.slice(i + 1, end),
			end,
			valueStart: i + 1,
			quoted: false,
			bare: false,
		};
	}

	// An unquoted, undelimited value: `class=flex` in HTML/Vue/Svelte. Unlike a
	// template or `{…}` expression it carries no code, so it IS a class list —
	// `bare` lets collectAssignedValues tokenize it and give it provenance.
	let end = i;
	while (end < source.length && !isValueTerminatorCode(source.charCodeAt(end))) end++;
	return {
		value: source.slice(i, end),
		end: end - 1,
		valueStart: i,
		quoted: false,
		bare: true,
	};
}

export function splitTopLevelArgs(source: string): Array<{ text: string; start: number }> {
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

/**
 * Collect whitespace-separated tokens that appear inside quoted string
 * literals ('"`), skipping `excludeRanges` (ascending, non-overlapping
 * [start, end) spans). Template interpolations act as token boundaries; their
 * code is not collected. Single linear charCode pass, allocating only the
 * token slices it keeps.
 */
export function collectQuotedTokens(
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

/** Tokenize one quoted literal starting at `start`; returns the index after it.
 *  Unterminated tails DO count as tokens here — provenance must see every
 *  quoted occurrence, even in truncated input. */
function collectTokensInLiteral(
	source: string,
	start: number,
	quoteCode: number,
	out: Set<string>,
): number {
	return (
		walkLiteral(source, start, quoteCode, (chunkStart, chunkEnd) => {
			// Whitespace-split by index arithmetic (same backslash-escape rule as
			// the walk itself) so only the kept token slices allocate.
			let tokenStart = chunkStart;
			let i = chunkStart;
			while (i < chunkEnd) {
				const code = source.charCodeAt(i);
				if (code === 92 /* \ */) {
					i += 2;
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
			if (chunkEnd > tokenStart) out.add(source.slice(tokenStart, chunkEnd));
		}) + 1
	);
}
