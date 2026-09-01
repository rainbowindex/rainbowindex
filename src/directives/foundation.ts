import type { DarkModeConfig } from "../theme/colors.js";
import type { FontSlot } from "../integrations/font-providers/index.js";
import type {
	AnimationDefinition,
	ColorDefinition,
	CornerShape,
	FluidConfig,
} from "../theme/index.js";
import { stripCSSComments } from "../shared.js";

/**
 * Raw-extractable directive names — the single source for the DirectiveType
 * union and the name sets in directives/index.ts (which add the PostCSS-only
 * apply/slot names on top for activation detection).
 */
export const DIRECTIVE_TYPE_NAMES = [
	"color",
	"text",
	"spacing",
	"breakpoint",
	"rounded",
	"shadow",
	"weight",
	"ease",
	"blur",
	"z",
	"animate",
	"fluid",
	"font",
	"preflight",
	"utility",
	"custom",
	"source",
	"leading",
	"tracking",
	"opacity",
	"duration",
	"layer",
	"register",
] as const;

export type DirectiveType = (typeof DIRECTIVE_TYPE_NAMES)[number];

export interface ParsedDirective {
	type: DirectiveType;
	body: string;
	modifier?: string;
}

export interface PreflightConfig {
	core: boolean;
	typography: boolean;
	content: boolean;
	forms: boolean;
	interactive: boolean;
	modern: boolean;
}

export interface CustomUtility {
	name: string;
	functional: boolean;
	body: string;
}

export interface CustomVariant {
	name: string;
	selector: string;
}

export interface SourceDirective {
	pattern: string;
	negated: boolean;
	inline: boolean;
	classes?: string[];
	/**
	 * Marks the pattern as a trusted, fully-qualified absolute path produced
	 * by internal machinery (auto-discovery from installed deps). User-facing
	 * `@source` patterns are validated to be relative — this flag bypasses
	 * that check for patterns we generate ourselves and that intentionally
	 * point outside the project's cwd (into `node_modules`).
	 */
	absolute?: boolean;
}

export interface LayerConfig {
	order: string[] | null;
	utilities: string | null;
	base: string | null;
	wrapAll: string | null;
}

/**
 * A custom-property registration produced by an `@register` directive — the
 * structured form of a CSS `@property` rule. `syntax` is stored already quoted
 * (e.g. `"<length>"`) so it can be emitted verbatim. `initialValue` is optional
 * only when `syntax` is the universal `"*"`; the parser drops typed registrations
 * that lack one (a typed `@property` without `initial-value` is invalid CSS and
 * silently ignored by browsers).
 */
export interface PropertyRegistration {
	name: string;
	syntax: string;
	inherits: boolean;
	initialValue?: string;
}

export interface ResolvedTheme {
	readonly colors: Readonly<Record<string, ColorDefinition>>;
	readonly darkConfig: Readonly<DarkModeConfig>;
	readonly text: Readonly<Record<string, { fontSize: string; lineHeight: string }>>;
	readonly spacing: Readonly<{ base: string }>;
	readonly breakpoints: Readonly<Record<string, string>>;
	/**
	 * Corner shape set via `@rounded <shape>`. `null` means no shape was configured —
	 * the compiler emits neither a `corner-shape` rule nor the fallback `@supports not`
	 * block. Non-null values trigger both.
	 */
	readonly roundedShape: CornerShape | null;
	/**
	 * Multiplier applied to `border-radius` inside
	 * `@supports (corner-shape: <shape>)` so that — in browsers that do
	 * render the configured shape — radii are bumped to match the visual
	 * weight a plain round corner would have at the raw radius in
	 * non-supporting browsers. Derived from the per-shape default table,
	 * overridable via `--corner-scale` in the `@rounded` body. Ignored when
	 * `roundedShape` is null.
	 */
	readonly roundedShapeScale: number;
	/** Named radii from `@rounded { roof: 24px; }` — each one makes the class
	 *  `rounded-<name>` and the token `--rounded-<name>`. A name that matches a
	 *  built-in radius keyword replaces it; RI-1124 warns at definition. */
	readonly radii: Readonly<Record<string, string>>;
	readonly shadows: Readonly<Record<string, string>>;
	readonly weights: Readonly<Record<string, number>>;
	readonly easing: Readonly<Record<string, string>>;
	readonly blur: Readonly<Record<string, string>>;
	readonly z: Readonly<Record<string, string>>;
	readonly animations: Readonly<Record<string, AnimationDefinition>>;
	readonly fluid: Readonly<FluidConfig>;
	readonly textFluid?: Readonly<FluidConfig>;
	readonly spacingFluid?: Readonly<FluidConfig>;
	/** Named viewport ranges from `@fluid <name> { min; max; }` — each one makes
	 *  the scope class `fluid-<name>` and the tokens `--fluid-<name>-{min,max}`.
	 *  Ranges carry no unit: the ramp unit is baked per family. */
	readonly fluidRanges: Readonly<Record<string, Readonly<FluidConfig>>>;
	readonly fonts: readonly FontSlot[];
	readonly preflight: Readonly<PreflightConfig>;
	readonly customUtilities: readonly CustomUtility[];
	readonly customVariants: readonly CustomVariant[];
	readonly sources: readonly SourceDirective[];
	readonly leading: Readonly<Record<string, string>>;
	readonly tracking: Readonly<Record<string, string>>;
	readonly opacity: Readonly<Record<string, string>>;
	readonly duration: Readonly<Record<string, string>>;
	readonly layer: Readonly<LayerConfig> | null;
	/** Custom properties registered via `@register` → emitted as `@property` rules. */
	readonly registeredProperties: readonly PropertyRegistration[];
	readonly warnings: readonly string[];
}

type DeepMutable<T> = T extends readonly (infer U)[]
	? U[]
	: T extends Record<string, unknown>
		? { -readonly [K in keyof T]: DeepMutable<T[K]> }
		: T;

export type WritableTheme = { -readonly [K in keyof ResolvedTheme]: DeepMutable<ResolvedTheme[K]> };

/** PostCSS-safe removal entry key — the Vite transform rewrites `!name;` to
 *  `--ri-rm: name;`. Shared by every body parser that supports removals. */
export const REMOVAL_KEY = "--ri-rm";

/** Valid directive entry keys and @utility names. Digit-leading keys (`2xl`)
 *  and `--`-prefixed keys (`--corner-scale`, `--my-var`) are intentionally allowed;
 *  whitespace, semicolons, and braces would emit broken CSS and are not. */
export const IDENT_KEY_RE = /^[\w-]+$/;

/** Precompiled single-char whitespace test for the entry scanner. */
const WS_CHAR_RE = /\s/;

/**
 * Index of the first `char` at paren/bracket depth 0 outside quotes, or -1.
 * Shared by value splitters (@color light-dark pairs, @text comma splits,
 * @font brace detection) so `clamp(2rem, 5vw, 4rem)` and friends never split
 * at an inner comma.
 */
export function topLevelIndexOf(str: string, char: string): number {
	let depth = 0;
	for (let i = 0; i < str.length; i++) {
		const c = str[i];
		if (c === '"' || c === "'") {
			i++;
			while (i < str.length && str[i] !== c) {
				if (str[i] === "\\") i++;
				i++;
			}
			continue;
		}
		if (c === "(" || c === "[") depth++;
		else if (c === ")" || c === "]") {
			if (depth > 0) depth--;
		} else if (c === char && depth === 0) {
			return i;
		}
	}
	return -1;
}

export interface ScanEntriesOptions {
	/**
	 * Whether a depth-0 newline ends an entry. `@color` (like parseKeyValueBody)
	 * splits entries at newlines — except after a trailing comma, the standard
	 * CSS wrap for multi-line values — while `@animate` and nested `@font`
	 * values legally run across newlines to their `{` or `;`. Required, not
	 * defaulted: both behaviors are exercised grammar rules, not drift.
	 */
	newlineTerminates: boolean;
}

/** One entry produced by {@link scanEntries}. */
export interface ScannedEntry {
	/** Entry key (the removed name for removals; `""` for colon-less fragments). */
	key: string;
	/** Trimmed value text (`""` for `!name` removals; the raw text for fragments). */
	value: string;
	/** Inner content of the entry's trailing `{ … }` block, trimmed. */
	block?: string;
	/** Set for removal entries — `!name` or `--ri-rm: name`. */
	removal?: true;
	/** Set for colon-less fragments so callers can warn (@color) or skip them. */
	fragment?: true;
	/** Set when the entry's `{` block never closes; scanning stops after it. */
	unclosedBlock?: true;
	/** Half-open span of the entry in the scanned source, `[start, end)`. Lets a
	 *  caller lift one entry out of a body and hand the rest to another parser. */
	start: number;
	end: number;
}

/**
 * Scan a directive body's top-level `key: value` / `key: value { block }` /
 * `!name` entries — the shared grammar behind `@color`, `@animate`, and nested
 * `@font` bodies. Expects comment-stripped input.
 *
 * The scan is quote-aware (with backslash escapes) and paren/bracket-depth
 * aware, so `;`/`{`/newline only terminate an entry at depth 0 outside quotes.
 * Blocks are captured opaquely via {@link findClosingBrace}: removals are
 * recognized only at the top level, never inside a block — `!important` inside
 * keyframes must survive — mirroring the Vite transform, which only rewrites
 * depth-0 spans. Both removal spellings (`!name` and the PostCSS-safe
 * `--ri-rm: name`) are recognized here so no caller re-implements them.
 *
 * Lazy generator on purpose: callers with entry caps (@color, @font) stop
 * iterating at the cap, keeping the cap check O(1) on adversarial input.
 */
export function* scanEntries(
	src: string,
	opts: ScanEntriesOptions,
): Generator<ScannedEntry, void, undefined> {
	let i = 0;
	while (i < src.length) {
		// Skip whitespace and stray semicolons between entries.
		while (i < src.length && /[\s;]/.test(src[i])) i++;
		if (i >= src.length) return;

		// Removal shorthand: !name
		if (src[i] === "!") {
			let end = i + 1;
			while (end < src.length && /[\w-]/.test(src[end])) end++;
			const name = src.slice(i + 1, end);
			if (name) yield { key: name, value: "", removal: true, start: i, end };
			i = end;
			continue;
		}

		// One pass over the entry: note the first depth-0 colon, stop at the
		// first depth-0 terminator (`;`, `{`, mode-dependent newline, or EOF).
		const entryStart = i;
		let colonIdx = -1;
		let depth = 0;
		let lastNonWS = "";
		let terminator = ""; // "" = end of input
		while (i < src.length) {
			const ch = src[i];
			if (ch === '"' || ch === "'") {
				i++;
				while (i < src.length && src[i] !== ch) {
					if (src[i] === "\\") i++;
					i++;
				}
				i++;
				lastNonWS = ch;
				continue;
			}
			if (ch === "(" || ch === "[") depth++;
			else if (ch === ")" || ch === "]") {
				if (depth > 0) depth--;
			} else if (depth === 0) {
				if (ch === ":" && colonIdx === -1) {
					colonIdx = i;
				} else if (
					ch === ";" ||
					ch === "{" ||
					(ch === "\n" && opts.newlineTerminates && lastNonWS !== ",")
				) {
					terminator = ch;
					break;
				}
			}
			if (!WS_CHAR_RE.test(ch)) lastNonWS = ch;
			i++;
		}

		const key = colonIdx === -1 ? "" : src.slice(entryStart, colonIdx).trim();
		const value = src.slice(colonIdx === -1 ? entryStart : colonIdx + 1, i).trim();

		if (terminator === "{") {
			const close = findClosingBrace(src, i);
			if (close === -1) {
				// Unterminated block: emit what was scanned and stop — @color keeps
				// such an entry (value without options), @animate/@font drop it.
				const span = { start: entryStart, end: src.length };
				if (colonIdx === -1) {
					if (value) yield { key: "", value, fragment: true, unclosedBlock: true, ...span };
				} else if (key === REMOVAL_KEY) {
					if (value) yield { key: value, value: "", removal: true, ...span };
				} else {
					yield { key, value, unclosedBlock: true, ...span };
				}
				return;
			}
			const block = src.slice(i + 1, close).trim();
			i = close + 1;
			if (colonIdx === -1) {
				// Fragments keep their block so @font can consume legacy `@face { … }`
				// spans; @color skips fragments and @animate requires a valid key, so
				// neither changes behavior.
				if (value) yield { key: "", value, fragment: true, block, start: entryStart, end: i };
				continue;
			}
			if (key === REMOVAL_KEY) {
				if (value) yield { key: value, value: "", removal: true, start: entryStart, end: i };
				continue;
			}
			yield { key, value, block, start: entryStart, end: i };
			continue;
		}

		if (terminator !== "") i++; // step past the `;` / newline
		if (colonIdx === -1) {
			if (value) yield { key: "", value, fragment: true, start: entryStart, end: i };
			continue;
		}
		if (key === REMOVAL_KEY) {
			if (value) yield { key: value, value: "", removal: true, start: entryStart, end: i };
			continue;
		}
		yield { key, value, start: entryStart, end: i };
	}
}

/**
 * Parse key-value pairs from a directive body — the generic grammar behind
 * @text, @spacing, @fluid, @preflight, @layer, @register, and @font
 * sub-blocks. Handles both simple values and values with semicolons/commas.
 *
 * ```
 * sm: 0.125rem;
 * DEFAULT: 0.25rem;
 * !slate;              ← removal
 * ```
 *
 * Entry boundaries are depth-aware: `;` ends an entry at paren/bracket/quote
 * depth 0; a newline ends one only when the last non-whitespace char is not a
 * comma (a trailing comma is the standard CSS wrap for multi-line values).
 * When `warnings` is provided, keys that would emit broken CSS are skipped
 * with RI-1035 naming `directiveName`.
 */
export function parseKeyValueBody(
	body: string,
	warnings?: string[],
	directiveName?: string,
): {
	entries: Array<[string, string]>;
	removals: string[];
} {
	const entries: Array<[string, string]> = [];
	const removals: string[] = [];
	const cleanedBody = stripCSSComments(body);

	const flush = (raw: string): void => {
		const line = raw.trim();
		if (!line) return;

		// Removal: !key
		if (line.startsWith("!")) {
			removals.push(line.slice(1).trim());
			return;
		}

		// key: value
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) return;

		const key = line.slice(0, colonIdx).trim();
		const value = line.slice(colonIdx + 1).trim();
		if (key === REMOVAL_KEY && value) {
			removals.push(value);
			return;
		}
		if (key && !IDENT_KEY_RE.test(key)) {
			warnings?.push(
				`[RI-1035] Invalid @${directiveName ?? "directive"} entry key "${key}" — keys may only contain letters, numbers, hyphens, and underscores. The entry was skipped.`,
			);
			return;
		}
		if (key && value) {
			entries.push([key, value]);
		}
	};

	let start = 0;
	let depth = 0;
	let lastNonWS = "";
	for (let i = 0; i < cleanedBody.length; i++) {
		const ch = cleanedBody[i];
		if (ch === '"' || ch === "'") {
			i++;
			while (i < cleanedBody.length && cleanedBody[i] !== ch) {
				if (cleanedBody[i] === "\\") i++;
				i++;
			}
			lastNonWS = ch;
			continue;
		}
		if (ch === "(" || ch === "[") {
			depth++;
			lastNonWS = ch;
			continue;
		}
		if (ch === ")" || ch === "]") {
			if (depth > 0) depth--;
			lastNonWS = ch;
			continue;
		}
		if (depth === 0 && (ch === ";" || (ch === "\n" && lastNonWS !== ","))) {
			flush(cleanedBody.slice(start, i));
			start = i + 1;
			lastNonWS = "";
			continue;
		}
		if (!WS_CHAR_RE.test(ch)) lastNonWS = ch;
	}
	flush(cleanedBody.slice(start));

	return { entries, removals };
}

export function findClosingBrace(src: string, start: number): number {
	let depth = 1;
	for (let i = start + 1; i < src.length; i++) {
		const ch = src[i];
		if (ch === '"' || ch === "'") {
			const quote = ch;
			i++;
			while (i < src.length && src[i] !== quote) {
				if (src[i] === "\\" && i + 1 < src.length) i++;
				i++;
			}
			continue;
		}
		if (ch === "/" && src[i + 1] === "*") {
			const end = src.indexOf("*/", i + 2);
			i = end === -1 ? src.length - 1 : end + 1;
			continue;
		}
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}
