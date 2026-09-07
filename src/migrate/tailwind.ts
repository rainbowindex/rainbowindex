/**
 * Tailwind v4 → Rainbow Index, for the CSS entry.
 *
 * Scope is the whole design here. Tailwind v4 puts its theme in CSS, and so
 * does this project, so the translation is mostly a rename: a `--color-*`
 * custom property becomes a `@color` entry, `--breakpoint-*` becomes
 * `@breakpoint`, and so on. What is *not* mechanical — a plugin, a v3 JS
 * config, a namespace with no counterpart here — is reported rather than
 * guessed at, because a migrator that quietly drops something is worse than
 * one that stops and points.
 *
 * Nothing here writes a file or reads one. It takes text and returns text plus
 * a list of things a person has to decide, which is what lets the whole
 * translation be tested on strings.
 */

import { findClosingBrace } from "../directives/foundation.js";
import { stripCSSComments } from "../shared.js";

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** Something the migrator could not do, and the person now has to. */
export interface ManualStep {
	/** What was found, verbatim enough to grep for. */
	found: string;
	/** Why it cannot be translated. */
	reason: string;
	/** What to do instead, when there is a next step. */
	action?: string;
}

export interface TailwindDetection {
	/** Whether this looks like a Tailwind v4 project at all. */
	isTailwind: boolean;
	/** The signals that said so, for the report. */
	signals: string[];
	/** A v3-era JS config, which this migrator does not read. */
	legacyConfig: string | null;
}

export interface MigrationResult {
	/** The translated CSS entry. */
	css: string;
	/** Directive blocks produced, in emission order, for the summary. */
	translated: Array<{ directive: string; entries: number }>;
	/** Everything a person still has to do. */
	manual: ManualStep[];
	/** Whether a `dark` custom variant was found and rewritten. */
	darkVariant: "selector" | "media" | null;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const TAILWIND_IMPORT_RE = /@import\s+["']tailwindcss(?:\/[\w-]+)?["']/;
/** This migrator's own header, so a second run replaces it rather than
 *  adding to it. Migrating twice has to be the same as migrating once. */
const RI_IMPORT_RE = /@import\s+["']rainbowindex(?:\/[\w.-]+)?["']/;
const TAILWIND_PACKAGES = [
	"tailwindcss",
	"@tailwindcss/vite",
	"@tailwindcss/postcss",
	"@tailwindcss/cli",
];
const LEGACY_CONFIG_FILES = [
	"tailwind.config.js",
	"tailwind.config.mjs",
	"tailwind.config.cjs",
	"tailwind.config.ts",
];

/**
 * Is this a Tailwind v4 project, and how do we know?
 *
 * `files` is whatever the caller found on disk — the CLI passes the entries of
 * the project root, so this stays free of IO like the rest of the module.
 */
export function detectTailwind(options: {
	css: string;
	packageJson?: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
	files?: readonly string[];
}): TailwindDetection {
	const signals: string[] = [];
	const css = stripCSSComments(options.css);

	if (TAILWIND_IMPORT_RE.test(css)) signals.push('@import "tailwindcss"');
	if (/@theme\b/.test(css)) signals.push("@theme");
	if (/@custom-variant\b/.test(css)) signals.push("@custom-variant");

	const deps = {
		...(options.packageJson?.dependencies ?? {}),
		...(options.packageJson?.devDependencies ?? {}),
	};
	for (const name of TAILWIND_PACKAGES) {
		if (Object.hasOwn(deps, name)) signals.push(`${name} in package.json`);
	}

	const legacyConfig = (options.files ?? []).find((f) => LEGACY_CONFIG_FILES.includes(f)) ?? null;

	return { isTailwind: signals.length > 0, signals, legacyConfig };
}

// ---------------------------------------------------------------------------
// At-rule scanning
// ---------------------------------------------------------------------------

interface AtRule {
	name: string;
	/** Everything between the name and the `{` or `;`, trimmed. */
	prelude: string;
	/** Block contents, or null for a statement at-rule. */
	body: string | null;
	start: number;
	end: number;
}

/** Top-level at-rules, in source order. Comment-stripped input. */
function scanAtRules(css: string): AtRule[] {
	const out: AtRule[] = [];
	for (let i = 0; i < css.length; i++) {
		if (css[i] !== "@") continue;
		// Skip an `@` inside a string or a rule body: only depth-0 at-rules
		// matter, and a nested one belongs to its parent's body.
		let nameEnd = i + 1;
		while (nameEnd < css.length && /[\w-]/.test(css[nameEnd])) nameEnd++;
		const name = css.slice(i + 1, nameEnd);
		if (!name) continue;

		let j = nameEnd;
		while (j < css.length && css[j] !== "{" && css[j] !== ";") j++;
		if (j >= css.length) break;
		const prelude = css.slice(nameEnd, j).trim();
		if (css[j] === ";") {
			out.push({ name, prelude, body: null, start: i, end: j + 1 });
			i = j;
			continue;
		}
		const close = findClosingBrace(css, j);
		if (close === -1) break;
		out.push({ name, prelude, body: css.slice(j + 1, close), start: i, end: close + 1 });
		i = close;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Namespace mapping
// ---------------------------------------------------------------------------

/**
 * Tailwind theme namespace → the directive that holds the same tokens.
 *
 * Longest prefix wins, which is why this is an ordered list rather than a map:
 * `--font-weight-bold` is a weight, not a font, and `--text-lg--line-height`
 * is a text size's second value. Both would be mis-filed by a shortest-match
 * lookup.
 */
const NAMESPACES: ReadonlyArray<{ prefix: string; directive: string }> = [
	{ prefix: "--font-weight-", directive: "weight" },
	{ prefix: "--color-", directive: "color" },
	{ prefix: "--font-", directive: "font" },
	{ prefix: "--text-", directive: "text" },
	{ prefix: "--tracking-", directive: "tracking" },
	{ prefix: "--leading-", directive: "leading" },
	{ prefix: "--breakpoint-", directive: "breakpoint" },
	{ prefix: "--radius-", directive: "rounded" },
	{ prefix: "--shadow-", directive: "shadow" },
	{ prefix: "--blur-", directive: "blur" },
	{ prefix: "--ease-", directive: "ease" },
	{ prefix: "--animate-", directive: "animate" },
];

/** Namespaces with no counterpart here, and what to do about each. */
const UNSUPPORTED_NAMESPACES: ReadonlyArray<{ prefix: string; action: string }> = [
	{ prefix: "--container-", action: "Rainbow Index's container ladder is built in; drop these." },
	{
		prefix: "--default-",
		action: "A Tailwind internal, and its `--theme()` value is Tailwind's own function. Drop it.",
	},
	{ prefix: "--max-width-", action: "Use an arbitrary value: `max-w-[65ch]`." },
	{
		prefix: "--inset-shadow-",
		action: "There is no theme namespace for inset shadows — define an `@utility` per name.",
	},
	{
		prefix: "--drop-shadow-",
		action: "There is no theme namespace for drop shadows — define an `@utility` per name.",
	},
	{
		prefix: "--text-shadow-",
		action: "There is no theme namespace for text shadows — define an `@utility` per name.",
	},
	{ prefix: "--perspective-", action: "Use an arbitrary value: `perspective-[800px]`." },
	{ prefix: "--aspect-", action: "Use an arbitrary value: `aspect-[16/10]`." },
];

/** `--color-red-500` → `red-500`, given its namespace prefix. */
function tokenName(key: string, prefix: string): string {
	return key.slice(prefix.length);
}

// ---------------------------------------------------------------------------
// The translation
// ---------------------------------------------------------------------------

/** Entries gathered per directive, in first-seen order. */
type Bucket = Map<string, string>;

function emitBlock(directive: string, bucket: Bucket): string {
	// An `@animate` entry is a nested rule — `name { … }` — not a declaration,
	// so it takes neither a colon nor a semicolon.
	const lines = [...bucket].map(([key, value]) =>
		value.startsWith("{") ? `\t${key} ${value}` : `\t${key}: ${value};`,
	);
	return `@${directive} {\n${lines.join("\n")}\n}\n`;
}

/** Re-indent a block body to `depth` tabs, ignoring what it came in with. */
function reindent(body: string, depth: number): string {
	const pad = "\t".repeat(depth);
	const lines = body
		.trim()
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	return lines.map((line) => pad + line).join("\n");
}

/**
 * Translate a Tailwind v4 CSS entry into a Rainbow Index one.
 *
 * The output is a complete stylesheet, not a patch: the activation import, the
 * preset (so the familiar class names keep resolving), the translated theme,
 * and whatever the file had that is not theme — rules, `@utility`, `@source` —
 * carried through in source order.
 */
export function migrateTailwindCSS(input: string): MigrationResult {
	const css = stripCSSComments(input);
	const atRules = scanAtRules(css);

	const buckets = new Map<string, Bucket>();
	const bucket = (directive: string): Bucket => {
		let existing = buckets.get(directive);
		if (existing === undefined) {
			existing = new Map();
			buckets.set(directive, existing);
		}
		return existing;
	};

	const manual: ManualStep[] = [];
	/** `@keyframes` found anywhere — Tailwind's own theme keeps them *inside*
	 *  the `@theme` block, and a project's beside it. */
	const keyframes: Map<string, string> = new Map();
	/** Spans consumed by the translation, so the tail can be carried through. */
	const consumed: Array<[number, number]> = [];
	let darkVariant: MigrationResult["darkVariant"] = null;
	/** `--text-lg--line-height` values, applied after the sizes are known. */
	const lineHeights = new Map<string, string>();

	for (const rule of atRules) {
		switch (rule.name) {
			case "import": {
				// The Tailwind import is replaced by this migrator's header — and so
				// is an existing Rainbow Index one, which is what keeps a second run
				// from stacking a second copy of the header on top of the first.
				const target = `@import ${rule.prelude}`;
				if (TAILWIND_IMPORT_RE.test(target) || RI_IMPORT_RE.test(target)) {
					consumed.push([rule.start, rule.end]);
				}
				break;
			}
			case "color": {
				// `@color dark { variant: … }` is this migrator's own output. Read it
				// back rather than carrying it through, or a re-run emits two.
				if (rule.prelude.trim() !== "dark" || rule.body === null) break;
				const variant = /variant\s*:\s*([^;}]+)/.exec(rule.body)?.[1]?.trim();
				if (variant === undefined) break;
				consumed.push([rule.start, rule.end]);
				darkVariant = variant.startsWith("selector") ? "selector" : "media";
				break;
			}
			case "theme": {
				consumed.push([rule.start, rule.end]);
				if (rule.body === null) break;
				if (/\binline\b/.test(rule.prelude)) {
					manual.push({
						found: `@theme ${rule.prelude}`,
						reason: "`@theme inline` emits resolved values rather than variable references.",
						action:
							"Rainbow Index emits `var()` references so a token follows the cascade. Check any place you relied on the inlined value.",
					});
				}
				translateThemeBody(rule.body, bucket, lineHeights, manual, keyframes);
				break;
			}
			case "keyframes": {
				const name = rule.prelude.trim();
				if (name && rule.body !== null) {
					keyframes.set(name, rule.body.trim());
					consumed.push([rule.start, rule.end]);
				}
				break;
			}
			case "custom-variant": {
				consumed.push([rule.start, rule.end]);
				const name = rule.prelude.split(/[\s(]/)[0]?.trim() ?? "";
				const rest = rule.prelude.slice(name.length).trim();
				if (name === "dark") {
					// C4's selector strategy is exactly what a Tailwind project's
					// `dark` variant means, so it becomes the theme's dark config
					// rather than a custom variant that would fight the built-in one.
					darkVariant = /prefers-color-scheme/.test(rest) ? "media" : "selector";
					break;
				}
				const body = rule.body === null ? rest : `{\n${rule.body.trim()}\n}`;
				bucketCustom(buckets, `@custom ${name} ${body}${rule.body === null ? ";" : ""}`);
				break;
			}
			case "plugin":
			case "config":
			case "reference": {
				consumed.push([rule.start, rule.end]);
				manual.push({
					found: `@${rule.name} ${rule.prelude}`.trim(),
					reason: `\`@${rule.name}\` has no Rainbow Index equivalent.`,
					action:
						rule.name === "plugin"
							? "Reimplement what the plugin added with `@utility` and `@custom`."
							: rule.name === "config"
								? "A v3 JavaScript config is not read. Move the values into directives."
								: "Remove it; Rainbow Index resolves the theme from the entry itself.",
				});
				break;
			}
			case "variant": {
				manual.push({
					found: `@variant ${rule.prelude}`,
					reason: "`@variant` applies a variant to a rule body; there is no equivalent.",
					action: "Write the variant on the class, or express it as a nested selector.",
				});
				break;
			}
			default:
				break;
		}
	}

	// A text size's line height arrives as a separate custom property, and the
	// directive takes both in one entry.
	const textBucket = buckets.get("text");
	if (textBucket) {
		for (const [name, leading] of lineHeights) {
			const size = textBucket.get(name);
			if (size !== undefined) textBucket.set(name, `${size}, ${leading}`);
		}
	}

	// An animation is a shorthand plus its keyframes, which Tailwind keeps in
	// two places and this directive keeps in one.
	const animateBucket = buckets.get("animate");
	if (animateBucket) {
		for (const [name, shorthand] of [...animateBucket]) {
			const frames = keyframes.get(firstWord(shorthand)) ?? keyframes.get(name);
			if (frames === undefined) {
				animateBucket.delete(name);
				manual.push({
					found: `--animate-${name}: ${shorthand}`,
					reason: "No matching `@keyframes` was found in this file.",
					action: "Add the keyframes to an `@animate` entry, or drop the token.",
				});
				continue;
			}
			// The canonical form: a nested rule whose `@keyframes` repeats
			// the entry name, because the emitted keyframes are named after it.
			animateBucket.set(
				name,
				`{\n\t\tanimation: ${shorthand};\n\t\t@keyframes ${name} {\n${reindent(frames, 3)}\n\t\t}\n\t}`,
			);
		}
		if (animateBucket.size === 0) buckets.delete("animate");
	}

	return {
		css: assemble(css, consumed, buckets, darkVariant),
		translated: [...buckets].map(([directive, entries]) => ({
			directive: `@${directive}`,
			entries: entries.size,
		})),
		manual,
		darkVariant,
	};
}

/** Custom variants are whole statements, not key-value entries; keep them in
 *  their own ordered bucket keyed by their own text. */
function bucketCustom(buckets: Map<string, Bucket>, statement: string): void {
	let existing = buckets.get("__custom");
	if (existing === undefined) {
		existing = new Map();
		buckets.set("__custom", existing);
	}
	existing.set(statement, "");
}

function firstWord(value: string): string {
	return value.trim().split(/\s+/)[0] ?? "";
}

/**
 * Split a `@theme` body into declarations, and lift the at-rules out of it.
 *
 * Two things the shared key-value reader cannot do here, both of which
 * Tailwind's own `theme.css` needs. Its `@keyframes` live *inside* the
 * `@theme` block, so a reader that walks straight through the body reads
 * `transform: none` out of a keyframe as if it were a theme token. And its
 * values wrap:
 *
 *     --font-sans:
 *       -apple-system, BlinkMacSystemFont, …;
 *
 * A newline ends an entry in this project's own grammar, so the first line
 * would be `--font-sans` with no value. A `@theme` body is plain CSS
 * declarations, so splitting on a top-level `;` is both simpler and right.
 */
function readThemeBody(body: string): {
	entries: Array<[string, string]>;
	keyframes: Map<string, string>;
} {
	const keyframes = new Map<string, string>();
	// Lift nested at-rules out first, so no declaration inside one is read as
	// a theme token.
	let rest = "";
	let at = 0;
	for (const rule of scanAtRules(body)) {
		rest += body.slice(at, rule.start);
		at = rule.end;
		if (rule.name === "keyframes" && rule.body !== null) {
			keyframes.set(rule.prelude.trim(), rule.body.trim());
		}
	}
	rest += body.slice(at);

	const entries: Array<[string, string]> = [];
	for (const statement of splitTopLevel(rest, ";")) {
		const text = statement.trim();
		if (!text) continue;
		const colon = text.indexOf(":");
		if (colon === -1) continue;
		const key = text.slice(0, colon).trim();
		const value = text
			.slice(colon + 1)
			.trim()
			.replace(/\s+/g, " ");
		if (key && value) entries.push([key, value]);
	}
	return { entries, keyframes };
}

/** Split on `char` at paren/bracket/brace depth 0, outside quotes. */
function splitTopLevel(input: string, char: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (ch === '"' || ch === "'") {
			const quote = ch;
			i++;
			while (i < input.length && input[i] !== quote) {
				if (input[i] === "\\") i++;
				i++;
			}
			continue;
		}
		if (ch === "(" || ch === "[" || ch === "{") depth++;
		else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
		else if (ch === char && depth === 0) {
			out.push(input.slice(start, i));
			start = i + 1;
		}
	}
	out.push(input.slice(start));
	return out;
}

/** Read one `@theme` body into the directive buckets. */
function translateThemeBody(
	body: string,
	bucket: (directive: string) => Bucket,
	lineHeights: Map<string, string>,
	manual: ManualStep[],
	keyframes: Map<string, string>,
): void {
	const parsed = readThemeBody(body);
	for (const [name, frames] of parsed.keyframes) keyframes.set(name, frames);
	for (const [key, value] of parsed.entries) {
		if (key === "--spacing") {
			bucket("spacing").set("base", value);
			continue;
		}
		// `--namespace-*: initial` clears a namespace in Tailwind. Nothing here
		// ships a default scale, so the clear is already the state.
		if (key.endsWith("-*") || value === "initial") continue;

		if (key.endsWith("--line-height")) {
			const size = key.slice("--text-".length, -"--line-height".length);
			if (key.startsWith("--text-")) lineHeights.set(size, value);
			continue;
		}
		// Tailwind's other per-token modifiers (`--font-weight`, `--tracking`)
		// on a text size have no single-entry equivalent.
		const modifier = /--(?:font-weight|letter-spacing|tracking)$/.exec(key);
		if (modifier) {
			manual.push({
				found: `${key}: ${value}`,
				reason: "A per-size weight or tracking modifier has no `@text` equivalent.",
				action: "Set it on the element, or define an `@utility`.",
			});
			continue;
		}

		// `--drop-shadow` with no suffix is the DEFAULT of a namespace that has no
		// counterpart, so it is as unsupported as `--drop-shadow-glow`.
		const unsupported = UNSUPPORTED_NAMESPACES.find(
			(n) => key.startsWith(n.prefix) || key === n.prefix.slice(0, -1),
		);
		if (unsupported) {
			manual.push({
				found: `${key}: ${value}`,
				reason: `The \`${unsupported.prefix}*\` namespace has no counterpart.`,
				action: unsupported.action,
			});
			continue;
		}

		// `--shadow`, `--radius`, `--blur` with no suffix are Tailwind's DEFAULT
		// tokens, which every scale here spells `DEFAULT`.
		const bare = NAMESPACES.find((n) => key === n.prefix.slice(0, -1));
		if (bare) {
			bucket(bare.directive).set("DEFAULT", value);
			continue;
		}
		const namespace = NAMESPACES.find((n) => key.startsWith(n.prefix));
		if (!namespace) {
			// Anything else is a plain custom property the project defined, and it
			// is still valid CSS — carry it into a `:root` block rather than
			// dropping it.
			bucket("__root").set(key, value);
			continue;
		}
		bucket(namespace.directive).set(tokenName(key, namespace.prefix), value);
	}
}

/** Build the migrated stylesheet. */
function assemble(
	css: string,
	consumed: Array<[number, number]>,
	buckets: Map<string, Bucket>,
	darkVariant: MigrationResult["darkVariant"],
): string {
	const parts: string[] = [
		'@import "rainbowindex";',
		"/* Tailwind's default scales, so the familiar class names keep resolving.",
		"   Drop this line and only what you declare below exists. */",
		'@import "rainbowindex/tailwind.css";',
		"",
	];

	if (darkVariant === "selector") {
		parts.push("/* `dark:` follows the .dark class, as it did under Tailwind. */");
		parts.push("@color dark {\n\tvariant: selector(.dark);\n}");
		parts.push("");
	}

	const root = buckets.get("__root");
	const customs = buckets.get("__custom");
	for (const [directive, entries] of buckets) {
		if (directive === "__root" || directive === "__custom") continue;
		if (entries.size === 0) continue;
		parts.push(emitBlock(directive, entries));
	}
	if (customs) {
		for (const statement of customs.keys()) parts.push(statement);
		parts.push("");
	}
	if (root && root.size > 0) {
		parts.push(`:root {\n${[...root].map(([k, v]) => `\t${k}: ${v};`).join("\n")}\n}\n`);
	}

	// Everything the translation did not consume, in source order.
	consumed.sort((a, b) => a[0] - b[0]);
	let rest = "";
	let at = 0;
	for (const [start, end] of consumed) {
		if (start < at) continue;
		rest += css.slice(at, start);
		at = end;
	}
	rest += css.slice(at);
	const tail = rest.trim();
	if (tail) parts.push(tail, "");

	return `${parts
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd()}\n`;
}
