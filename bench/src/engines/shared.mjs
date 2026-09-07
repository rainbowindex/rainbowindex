/**
 * Helpers shared by the three engine adapters.
 */

/**
 * Escape a class name the way all three engines escape it in a selector, so
 * `css.includes("." + escapeClass(name))` is a reliable "did this engine emit
 * a rule for it" test. Tailwind, UnoCSS and rainbowindex all use
 * backslash-character escaping rather than numeric `\3a ` escapes; the
 * coverage check in `run.mjs` asserts that on a known-good sample before it
 * trusts any of the counts.
 *
 * @param {string} name
 */
export function escapeClass(name) {
	const body = name.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
	// A CSS identifier cannot start with a digit, so `2xl:flex` is emitted as
	// `.\32 xl\:flex` — a hex escape and a terminating space, not a backslash
	// before the digit. All three engines spell it that way; a checker that did
	// not would report every `2xl:` and `3xl:` class as unsupported everywhere.
	if (/^[0-9]/.test(body)) return `\\3${body[0]} ${body.slice(1)}`;
	return body;
}

/** Escape a string for literal use inside a RegExp. */
function forRegex(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A regex matching the selector for exactly this class and no other.
 *
 * A plain `css.includes("." + escaped)` is wrong, and wrong in the flattering
 * direction: `.transform` is a prefix of `.transform-gpu` and `.w-4` of
 * `.w-48`, so an engine that implements only the longer one would be credited
 * with both. The lookahead pins the end of the class name — the next character
 * cannot continue an identifier, which rules out a word character, a `-`, and a
 * backslash starting another escape.
 *
 * @param {string} name
 */
export function classSelectorRe(name) {
	return new RegExp(`\\.${forRegex(escapeClass(name))}(?![\\w\\\\-])`);
}

/**
 * Count how many of `names` the engine emitted a rule for.
 *
 * @param {string} css
 * @param {Iterable<string>} names
 */
export function countMatched(css, names) {
	let matched = 0;
	for (const name of names) {
		if (classSelectorRe(name).test(css)) matched++;
	}
	return matched;
}
