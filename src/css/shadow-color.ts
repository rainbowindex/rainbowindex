/**
 * The colour slot inside a shadow value.
 *
 * A shadow utility and a shadow-colour utility are two separate classes that
 * have to meet on one element: `shadow-md` sets the geometry, `shadow-red-500`
 * sets the colour. They meet through a custom property, and the only place that
 * property can be read is inside the shadow value itself — which is why the
 * value has to be rewritten from
 *
 *     0 4px 6px -1px rgb(0 0 0 / 0.1)
 * to
 *     0 4px 6px -1px var(--ri-shadow-color, rgb(0 0 0 / 0.1))
 *
 * The obvious alternative — leave the utility as `--ri-shadow: var(--shadow-md)`
 * and put the slot inside the `:root` token — does not work, and not for a
 * subtle reason: `var()` inside a custom property is substituted when that
 * property is computed on the element it is DECLARED on. A slot written into
 * `:root`'s `--shadow-md` resolves against `:root`, where no utility has set a
 * colour, so it bakes in its own fallback before it ever reaches the element.
 * Verified in a browser, not reasoned about. Tailwind inlines for the same
 * reason.
 *
 * This module has no imports so the preset generator (plain `.mjs`, run under
 * Node) can use it for the `@utility` bodies it writes for the shadow families
 * that have no theme namespace.
 */

/** Words that occupy no position in a shadow layer's grammar. */
const SHADOW_KEYWORDS: ReadonlySet<string> = new Set([
	"inset",
	"inherit",
	"initial",
	"revert",
	"revert-layer",
	"unset",
]);

/** Functions that produce a length, so they count toward the offset positions. */
const MATH_FUNCTIONS: ReadonlySet<string> = new Set(["calc", "clamp", "min", "max"]);

/**
 * Functions that produce a colour. Deliberately a local list rather than an
 * import: this module stays dependency-free for the generator, and the merge
 * layer's alternation answers a different question (does this class-name
 * fragment look like a colour) on a different input shape.
 */
const COLOR_FUNCTIONS: ReadonlySet<string> = new Set([
	"color",
	"color-mix",
	"contrast-color",
	"device-cmyk",
	"hsl",
	"hsla",
	"hwb",
	"lab",
	"lch",
	"light-dark",
	"oklab",
	"oklch",
	"rgb",
	"rgba",
]);

/** A token that starts like a number is an offset or a blur/spread radius. */
const LENGTH_START_RE = /^-?(?:\d+|\.\d+)/;

interface Token {
	start: number;
	end: number;
	text: string;
	/** `name(…)`, captured whole including its parentheses. */
	isFunction: boolean;
}

/**
 * Split on top-level commas — the separator between shadow layers. A comma
 * inside `rgb(0 0 0 / 0.1)` or `var(--x, 0 1px)` belongs to that function, so
 * depth has to be tracked rather than the string split.
 */
export function splitShadowLayers(value: string): string[] {
	const layers: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch === "(" || ch === "[") depth++;
		else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
		else if (ch === "," && depth === 0) {
			layers.push(value.slice(start, i));
			start = i + 1;
		}
	}
	layers.push(value.slice(start));
	return layers;
}

/** Whitespace-separated top-level tokens; `name(…)` is one token, parens included. */
function tokenizeLayer(layer: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < layer.length) {
		if (/\s/.test(layer[i])) {
			i++;
			continue;
		}
		const start = i;
		let depth = 0;
		let isFunction = false;
		while (i < layer.length) {
			const ch = layer[i];
			if (ch === "\\") {
				i += 2;
				continue;
			}
			if (ch === "(") {
				if (depth === 0) isFunction = true;
				depth++;
			} else if (ch === ")") {
				depth = Math.max(0, depth - 1);
			} else if (depth === 0 && /\s/.test(ch)) {
				break;
			}
			i++;
		}
		tokens.push({ start, end: i, text: layer.slice(start, i), isFunction });
	}
	return tokens;
}

/** The function name in front of a `name(…)` token. */
function functionName(text: string): string {
	const open = text.indexOf("(");
	return open === -1 ? "" : text.slice(0, open).toLowerCase();
}

/**
 * Rewrite one layer so its colour reads the slot, with the layer's own colour
 * as the fallback.
 *
 * The decision follows the shadow grammar rather than a colour regex, because a
 * bare identifier can be a named colour (`red`) or a custom-property reference
 * or nothing recognisable, and guessing wrong turns a shadow into a colour:
 *
 * - A colour function or a `#hex` is unambiguous: wrap it where it stands.
 * - Fewer than two length tokens means this is not a shadow layer at all — a
 *   bare `var(--shadow-md)` from an `@shadow` alias, a `shadow-(--x)` custom
 *   property, or a keyword like `none`. Leave it exactly as it is. This one
 *   rule is what keeps aliases and custom properties working.
 * - Otherwise the layer has offsets, so a single leftover non-length token is
 *   the colour, and no leftover token means the colour is implied: append the
 *   slot with `currentColor`, which is what the browser would have used.
 * - Two or more leftover tokens is not a shape this can reason about; leave it.
 *
 * The last two rules diverge from Tailwind on `1px red` and `0 1px 2px red blue`,
 * which it slots and this leaves alone. Both are invalid `box-shadow` values —
 * one offset, and two colours — so neither renders either way. Matching there
 * would mean carrying the 148 CSS named colours to recognise a bare keyword,
 * which is a lot of table for values a browser rejects.
 */
function slotLayer(layer: string, colorVar: string): string {
	const trimmed = layer.trim();
	if (trimmed === "") return layer;

	// `@shadow { x: 0 1px 2px !important; }` keeps the bang in the stored value,
	// and the token walk would read it as the layer's colour. Hoist it, rewrite
	// what is left, and put it back on the end where CSS expects it.
	const bang = /!\s*important\s*$/i.exec(trimmed);
	const core = bang === null ? trimmed : trimmed.slice(0, bang.index).trimEnd();
	const suffix = bang === null ? "" : ` ${trimmed.slice(bang.index)}`;
	if (core === "") return layer;
	const lead = layer.slice(0, layer.indexOf(trimmed));
	const trail = layer.slice(lead.length + trimmed.length);

	const tokens = tokenizeLayer(core);
	let lengths = 0;
	let values = 0;
	let last: Token | null = null;
	let hit: Token | null = null;

	for (const token of tokens) {
		if (token.isFunction) {
			const name = functionName(token.text);
			if (COLOR_FUNCTIONS.has(name)) {
				hit = token;
				break;
			}
			if (MATH_FUNCTIONS.has(name)) {
				lengths++;
				continue;
			}
			last = token;
			values++;
			continue;
		}
		if (SHADOW_KEYWORDS.has(token.text.toLowerCase())) continue;
		if (token.text.startsWith("#")) {
			hit = token;
			break;
		}
		if (LENGTH_START_RE.test(token.text)) {
			lengths++;
			continue;
		}
		last = token;
		values++;
	}

	const wrap = (token: Token): string => {
		// Never wrap twice. The preset's own generated bodies come back through
		// the engine as arbitrary values in the parity test, and an author can
		// write the slot by hand.
		if (token.text.startsWith(`var(${colorVar}`)) return layer;
		return (
			lead +
			core.slice(0, token.start) +
			`var(${colorVar}, ${token.text})` +
			core.slice(token.end) +
			suffix +
			trail
		);
	};

	if (hit !== null) return wrap(hit);
	if (lengths < 2) return layer;
	if (values === 0) return `${lead + core} var(${colorVar}, currentColor)${suffix}${trail}`;
	if (values === 1 && last !== null) return wrap(last);
	return layer;
}

/**
 * Give every layer of a shadow value a colour slot, one string per layer.
 *
 * Layers rather than a joined string because `drop-shadow()` takes exactly one
 * shadow: a two-layer value has to become two space-separated `drop-shadow(…)`
 * calls, not one call with two arguments. Every other family joins with `", "`.
 *
 * @param value the shadow value, one or more comma-separated layers
 * @param colorVar the custom property a colour utility writes, e.g. `--ri-shadow-color`
 */
export function withShadowColorSlotLayers(value: string, colorVar: string): string[] {
	return splitShadowLayers(value).map((layer) => slotLayer(layer, colorVar).trim());
}
