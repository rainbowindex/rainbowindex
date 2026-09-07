/**
 * The package's "compiled" output — what a consumer actually installs.
 *
 * Every class below exists only in this file. A consumer's scanner never looks
 * inside `node_modules` on its own, so without the `rainbowindex.safelistSources`
 * entry in this package's `package.json` these classes would be missing from
 * the consumer's stylesheet and the components would render unstyled.
 */

const BUTTON_BASE = "inline-flex items-center gap-2 rounded-control px-4 py-2 font-medium";

const BUTTON_TONE = {
	solid: "bg-accent-500 text-white hover:bg-accent-600 ds-focus-ring",
	quiet: "bg-surface text-accent-700 hover:bg-accent-100 ds-focus-ring",
};

/** Class names for a button. Returns a string; nothing is styled at runtime. */
export function buttonClass(tone = "solid") {
	return `${BUTTON_BASE} ${BUTTON_TONE[tone] ?? BUTTON_TONE.solid}`;
}

/** Class names for the card the buttons sit in. */
export function cardClass() {
	return "rounded-control bg-surface p-6 shadow-md";
}
