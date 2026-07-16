/**
 * CSS selector escaping utilities.
 *
 * Implements CSS identifier escaping per the CSS Syntax Module Level 3,
 * section 4.3.11 (https://www.w3.org/TR/css-syntax-3/#escape-a-character).
 * Null bytes are replaced with U+FFFD per the spec's input preprocessing rules.
 */

/**
 * Escape a class name for use as a CSS selector.
 *
 * Single charCodeAt pass with CSS.escape-aligned semantics:
 * - `-`, `_`, ASCII alphanumerics, and everything ≥ U+0080 pass through.
 * - NUL → U+FFFD (invalid in CSS identifiers).
 * - A digit in lead position (`2xl`) or after a lead `-` (`-2xl`) → `\<hex> `
 *   (the trailing space terminates the hex escape per the CSS spec).
 * - Tab/LF/FF/CR/space stay backslash-prefixed (`\<char>`) — the historical
 *   output shape; the scanner never produces class names containing them, so
 *   hex-escaping would only churn emitted bytes.
 * - Remaining control characters (U+0001–U+001F, U+007F) → `\<hex> `.
 * - Every other ASCII character → `\<char>`, covering selector metacharacters
 *   (`= ^ $ |` for data/aria attribute variants, `&` for CSS Nesting, …).
 */
export function escapeSelector(raw: string): string {
	let out: string[] | null = null;
	let runStart = 0;
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i);
		if (
			(code >= 0x61 && code <= 0x7a) || // a-z
			(code >= 0x41 && code <= 0x5a) || // A-Z
			code === 0x2d || // -
			code === 0x5f || // _
			code >= 0x80 // non-ASCII (incl. surrogate halves) is ident-safe raw
		) {
			continue;
		}
		if (
			code >= 0x30 &&
			code <= 0x39 && // 0-9
			i !== 0 &&
			!(i === 1 && raw.charCodeAt(0) === 0x2d)
		) {
			continue;
		}
		let escaped: string;
		if (code === 0x00) {
			escaped = "\uFFFD";
		} else if (code >= 0x30 && code <= 0x39) {
			escaped = `\\${code.toString(16)} `;
		} else if (code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
			escaped = `\\${raw[i]}`;
		} else if (code < 0x20 || code === 0x7f) {
			escaped = `\\${code.toString(16)} `;
		} else {
			escaped = `\\${raw[i]}`;
		}
		if (out === null) out = [];
		out.push(raw.slice(runStart, i), escaped);
		runStart = i + 1;
	}
	// Fast path: nothing needed escaping — return the input untouched.
	if (out === null) return raw;
	out.push(raw.slice(runStart));
	return out.join("");
}
