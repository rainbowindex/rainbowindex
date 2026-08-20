/**
 * Bracket-aware scanning primitive shared by the merge runtime
 * (merge/index.ts and merge/resolve.ts).
 *
 * This module has NO Node.js dependencies so it can be safely imported
 * by the browser-shipped merge runtime (the `ri()` export of `rainbowindex`).
 */

/**
 * Scan a string character-by-character, tracking `[`/`(` bracket depth and
 * skipping CSS escape sequences. Calls `onChar` for each non-escaped character
 * with the current depth. Return `true` from `onChar` to stop scanning early.
 *
 * This is the shared primitive behind variant colon detection and
 * whitespace splitting in merge/index.ts — it runs per ri() token, so depth
 * tracking uses direct char comparisons rather than Set lookups.
 *
 * @param input - The string to scan
 * @param onChar - Callback receiving (char, index, depth). Return true to stop.
 * @param options.reverse - Scan right-to-left instead of left-to-right
 */
export function scanBracketAware(
	input: string,
	onChar: (ch: string, index: number, depth: number) => boolean | undefined,
	options?: {
		reverse?: boolean;
	},
): void {
	const reverse = options?.reverse ?? false;

	let depth = 0;
	const start = reverse ? input.length - 1 : 0;
	const end = reverse ? -1 : input.length;
	const step = reverse ? -1 : 1;

	for (let i = start; i !== end; i += step) {
		const ch = input[i];

		// Skip CSS escape sequences
		if (reverse) {
			// Right-to-left: count consecutive backslashes before the current char.
			// An odd count means the current char is escaped; an even count means
			// the backslashes escape each other and the current char is literal.
			// This correctly handles `\\]` (two backslashes + literal `]`).
			let bs = 0;
			while (i - 1 - bs >= 0 && input[i - 1 - bs] === "\\") bs++;
			if (bs > 0 && bs % 2 === 1) {
				// After `i -= bs`, i points to the first backslash in the sequence.
				// The loop's `i += step` (-1) then moves to the character *before*
				// the backslash sequence, which is correctly the next char to process.
				// Total skipped: the escaped char (original i) + bs backslashes.
				i -= bs;
				continue;
			}
		} else {
			// Left-to-right: backslash + next character
			if (ch === "\\" && i + 1 < input.length) {
				i++; // skip the escaped character
				continue;
			}
		}

		if (reverse) {
			// In reverse, closers increase depth and openers decrease. Clamp at 0
			// like the forward scan so unbalanced input classifies positions
			// identically in both directions.
			if (ch === "]" || ch === ")") depth++;
			else if ((ch === "[" || ch === "(") && depth > 0) depth--;
		} else {
			if (ch === "[" || ch === "(") depth++;
			else if ((ch === "]" || ch === ")") && depth > 0) depth--;
		}

		if (onChar(ch, i, depth)) return;
	}
}
