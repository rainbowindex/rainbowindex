/**
 * Regenerates src/presets/tailwind.css from Tailwind CSS v4's own theme.css.
 *
 * The preset is checked in — users must not need a network fetch to install
 * the package — but the values are Tailwind's, so transcribing them by hand
 * would be both tedious and a source of silent drift. This script reads the
 * upstream file and rewrites the preset in Rainbow Index directives.
 *
 * Requires Node >= 22.18 (it imports a `.ts` module through type stripping).
 *
 * Usage:
 *   node scripts/generate-tailwind-preset.mjs                     # the pin below
 *   node scripts/generate-tailwind-preset.mjs --version=4.3.3     # another release
 *   node scripts/generate-tailwind-preset.mjs path/to/theme.css   # a local file
 *
 * Review the diff before committing. A Tailwind release that adds a color
 * family shows up here as new @color blocks. A release that renames or removes
 * a namespace, or reworks the deprecated block, throws — every scale this
 * script reads is asserted, because the alternative is a preset that silently
 * lost a whole scale and a script that still exits 0.
 *
 * Two entries are added by hand rather than read from upstream, because
 * Tailwind implements them as utilities and not as theme tokens:
 * `leading-none` and `container`. Both are commented where they are emitted.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// The engine's own shadow-colour rewriter, so a generated `@utility` body and
// the equivalent arbitrary utility cannot drift — the preset test asserts they
// are identical. Imported as `.ts` and read through Node's type stripping,
// which is why this script needs Node >= 22.18; it is a maintainer tool run by
// hand, never by CI or by an install.
import { withShadowColorSlot, withShadowColorSlotLayers } from "../src/css/shadow-color.ts";

/**
 * The Tailwind release the checked-in preset was generated from. Pinned, not
 * `main`: a moving branch makes the preset unreproducible, and there would be
 * no way to tell which upstream any given checkout came from. Bump this
 * deliberately, re-run, and read the diff.
 */
const UPSTREAM_VERSION = "4.3.3";
const upstreamURL = (version) =>
	`https://raw.githubusercontent.com/tailwindlabs/tailwindcss/v${version}/packages/tailwindcss/theme.css`;
const OUT = join(dirname(dirname(fileURLToPath(import.meta.url))), "src/presets/tailwind.css");

// ---------------------------------------------------------------------------
// Read the upstream declarations
// ---------------------------------------------------------------------------

/** `--version=x.y.z` overrides the pin for a one-off comparison. */
const versionFlag = process.argv.slice(2).find((a) => a.startsWith("--version="));
const version = versionFlag ? versionFlag.slice("--version=".length) : UPSTREAM_VERSION;
const localFile = process.argv.slice(2).find((a) => !a.startsWith("--"));

const source = localFile
	? readFileSync(localFile, "utf8")
	: await (async () => {
			const url = upstreamURL(version);
			const res = await fetch(url);
			if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
			return res.text();
		})();

/** Provenance line for the generated header. A local file has no version. */
const provenance = localFile ? `from the local file ${localFile}` : `from tailwindcss v${version}`;

/**
 * `--name: value;` pairs from the first @theme block only. The trailing
 * `@theme default inline reference` block is Tailwind's deprecated-alias
 * section; its `--shadow`, `--blur`, `--radius` are the bare DEFAULT forms,
 * which we read separately below.
 */
function readDeclarations(text) {
	const decls = new Map();
	const re = /^\s*(--[a-zA-Z0-9-]+):\s*([\s\S]*?);\s*$/gm;
	for (const match of text.matchAll(re)) {
		decls.set(match[1], match[2].replace(/\s+/g, " ").trim());
	}
	return decls;
}

const deprecatedAt = source.indexOf("/* Deprecated */");
if (deprecatedAt === -1) {
	// Without this marker every declaration below it would be read as live, and
	// the deprecated aliases (`--shadow-inner`, the bare `--shadow`/`--blur`/
	// `--radius`) would be promoted into the emitted blocks. Fail rather than
	// emit a preset that is quietly wrong.
	throw new Error(
		"upstream theme.css has no `/* Deprecated */` marker — the split this " +
			"script relies on is gone. Read the upstream file and update the parser.",
	);
}
const main = readDeclarations(source.slice(0, deprecatedAt));
const deprecated = readDeclarations(source.slice(deprecatedAt));

/**
 * Entries under `--<prefix>-…`, in upstream order, as [suffix, value].
 *
 * Throws on an empty result. A renamed upstream namespace would otherwise
 * delete a whole scale from the preset and still exit 0 — the failure mode
 * this script exists to prevent.
 */
function namespace(prefix) {
	const out = [];
	for (const [name, value] of main) {
		if (name.startsWith(`--${prefix}-`)) out.push([name.slice(prefix.length + 3), value]);
	}
	if (out.length === 0) {
		throw new Error(
			`upstream theme.css has no \`--${prefix}-*\` declarations. Tailwind renamed ` +
				"or removed the namespace; update this script rather than shipping a " +
				"preset that is missing the scale.",
		);
	}
	return out;
}

/** A deprecated alias the emitter depends on — the bare `DEFAULT` forms. */
function deprecatedValue(name) {
	const value = deprecated.get(name);
	if (value === undefined) {
		throw new Error(
			`upstream theme.css no longer defines \`${name}\` in its deprecated block. ` +
				"That value is a bare DEFAULT the preset needs; find its new home.",
		);
	}
	return value;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/** family → [[stop, value], …], in upstream order. */
const colorFamilies = new Map();
for (const [suffix, value] of namespace("color")) {
	const split = suffix.lastIndexOf("-");
	if (split === -1) continue; // --color-black / --color-white, handled by the engine
	const family = suffix.slice(0, split);
	const stop = suffix.slice(split + 1);
	if (!/^\d+$/.test(stop)) continue;
	if (!colorFamilies.has(family)) colorFamilies.set(family, []);
	colorFamilies.get(family).push([stop, value]);
}

// ---------------------------------------------------------------------------
// Text sizes — Tailwind splits size and line height across two declarations
// ---------------------------------------------------------------------------

const textSizes = [];
for (const [suffix, value] of namespace("text")) {
	if (suffix.endsWith("--line-height") || suffix.startsWith("shadow-")) continue;
	const leading = main.get(`--text-${suffix}--line-height`);
	textSizes.push([suffix, leading ? `${value}, ${leading}` : value]);
}

// ---------------------------------------------------------------------------
// Animations — the shorthand lives in a declaration, the keyframes in a rule
// ---------------------------------------------------------------------------

/** The body of `@keyframes <name> { … }`, brace-matched. */
function keyframesBody(name) {
	const head = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(source);
	if (!head) return null;
	let depth = 1;
	let i = head.index + head[0].length;
	for (; i < source.length && depth > 0; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") depth--;
	}
	return source.slice(head.index + head[0].length, i - 1);
}

/** Re-indent an upstream keyframes body to sit inside our @animate block. */
function reindent(body, indent) {
	const lines = body.replace(/\t/g, "  ").split("\n");
	const nonEmpty = lines.filter((l) => l.trim() !== "");
	const base = Math.min(...nonEmpty.map((l) => l.length - l.trimStart().length));
	return nonEmpty
		.map(
			(l) =>
				indent + "\t".repeat(Math.round((l.length - l.trimStart().length - base) / 2)) + l.trim(),
		)
		.join("\n");
}

const animations = namespace("animate").map(([name, shorthand]) => {
	const body = keyframesBody(name);
	if (body === null) throw new Error(`@animate ${name}: no @keyframes found upstream`);
	return [name, shorthand, body];
});

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const lines = [];
const push = (...l) => lines.push(...l);

/** A `@name { key: value; … }` block, skipped entirely when it has no entries. */
function block(directive, entries, comment) {
	if (entries.length === 0) return;
	if (comment) push(`/* ${comment} */`);
	push(`@${directive} {`);
	for (const [key, value] of entries) push(`\t${key}: ${value};`);
	push("}", "");
}

push(
	"/*",
	" * rainbowindex/tailwind.css — Tailwind CSS v4's default theme, as directives.",
	" *",
	` * GENERATED by scripts/generate-tailwind-preset.mjs ${provenance},`,
	" * out of Tailwind's own theme.css. Do not edit by hand; re-run the script",
	" * instead. Tailwind CSS is MIT-licensed — see NOTICE.md.",
	" *",
	" * Rainbow Index ships no scales of its own, on purpose: a token you did not",
	" * define is a token nobody has to reason about. This file is the opt-in",
	" * opposite, for a project migrating from Tailwind or one that just wants a",
	" * familiar starting scale:",
	" *",
	' *   @import "rainbowindex";',
	' *   @import "rainbowindex/tailwind.css";',
	" *",
	" * Import it after the package, and override anything it sets by declaring",
	" * the same token after it — later blocks win.",
	" *",
	" * KNOWN DIFFERENCES from Tailwind, which no theme file can paper over:",
	" *",
	" *   - Directional utilities emit logical properties. `pl-4` is",
	" *     `padding-inline-start`, not `padding-left`; `rounded-t` is",
	" *     `border-start-*-radius`. Identical in LTR, correct in RTL.",
	" *   - Dark mode is a choice, not a default. Tailwind toggles a `.dark`",
	" *     class; here `dark:` follows `prefers-color-scheme` until you say",
	" *     otherwise. For Tailwind's behaviour add, next to this import:",
	" *       @color dark { variant: selector(.dark); }",
	" *     `variant: appearance` instead ties `dark:` to the `data-appearance`",
	" *     attribute the color tokens already follow. See docs/theming.md.",
	" *   - `opacity-50` emits `50%` rather than `0.5`. Same computed value.",
	" *   - The `inset-shadow-*`, `text-shadow-*`, and `drop-shadow-*` scales are",
	" *     supplied below as `@utility` definitions: those families read no theme",
	" *     namespace, so a token block cannot reach them.",
	" *   - `container` and `leading-none` are utilities upstream, not tokens, so",
	" *     they are written into this file by hand rather than read from",
	" *     theme.css. `container` nests its breakpoint caps inside the class",
	" *     instead of emitting one flat rule per breakpoint; same computed",
	" *     result.",
	" *   - `ring-inset` and `ring-offset-*` are engine utilities here, not theme",
	" *     tokens: the offset width is a length and the flag is a keyword, so",
	" *     neither reads a namespace this file could supply. They need no entry",
	" *     below and work with or without this preset.",
	" *   - `bg-gradient-to-*` is spelled `bg-linear-to-*`, which is Tailwind v4's",
	" *     own current name for it.",
	" */",
	"",
);

push("/* Colors — one block per family, so a diff names the family that changed. */");
for (const [family, stops] of colorFamilies) {
	block(
		"color",
		stops.map(([stop, value]) => [`${family}-${stop}`, value]),
	);
}

block("breakpoint", namespace("breakpoint"), "Breakpoints");
block("text", textSizes, "Text sizes — `name: <font-size>, <line-height>`");
block("weight", namespace("font-weight"), "Font weights");
// `leading-none` is a static utility upstream, not a `--leading-*` token, so
// the namespace walk never sees it. Rainbow Index has no static form either:
// every `leading-<name>` reads the theme. Name it explicitly or the single
// most-used line height in Tailwind's vocabulary resolves to nothing.
block("leading", [["none", "1"], ...namespace("leading")], "Line heights");
block("tracking", namespace("tracking"), "Letter spacing");

// Radii, with the deprecated bare `--radius` as DEFAULT so `rounded` works.
const radii = namespace("radius");
const radiusDefault = deprecatedValue("--radius");
block(
	"rounded",
	[["DEFAULT", radiusDefault], ...radii],
	"Corner radii — DEFAULT is what bare `rounded` reads",
);

const shadows = namespace("shadow");
const shadowDefault = deprecatedValue("--shadow");
// `shadow-inner` is still a Tailwind v4 class — it lives in upstream's
// deprecated block rather than the `--shadow-*` namespace, which is why a
// namespace() sweep misses it. Read through deprecatedValue() so a move
// upstream is a loud failure rather than a silently dropped class.
const shadowInner = deprecatedValue("--shadow-inner");
block(
	"shadow",
	[["DEFAULT", shadowDefault], ...shadows, ["inner", shadowInner]],
	"Box shadows — DEFAULT is what bare `shadow` reads",
);

const blurs = namespace("blur");
const blurDefault = deprecatedValue("--blur");
block("blur", [["DEFAULT", blurDefault], ...blurs], "Blur — DEFAULT is what bare `blur` reads");

block("ease", namespace("ease"), "Easing");

/*
 * `container`.
 *
 * Upstream this is a utility, not a token: `width: 100%` plus a `max-width`
 * at every breakpoint, read from the same `--breakpoint-*` values `@breakpoint`
 * gets. Rainbow Index has no `container` utility of its own, so the preset
 * defines one from the breakpoints it just emitted. The nesting is the only
 * visible difference — Tailwind writes one flat rule per breakpoint, this
 * writes the media queries inside the class — and the computed result is the
 * same in every browser that supports `oklch()`.
 */
const breakpoints = namespace("breakpoint");
if (breakpoints.length > 0) {
	push("/* Container — width: 100% capped at each breakpoint, as upstream */");
	push("@utility container {", "\twidth: 100%;");
	for (const [, value] of breakpoints) {
		push(`\t@media (min-width: ${value}) {`, `\t\tmax-width: ${value};`, "\t}");
	}
	push("}", "");
}

if (animations.length > 0) {
	push("/* Animations — the keyframes are emitted only when the class is used. */");
	push("@animate {");
	for (const [name, shorthand, body] of animations) {
		// The canonical form: a nested rule, not a block after a
		// declaration. The keyframes at-rule repeats the entry name because the
		// emitted `@keyframes` is named after the entry.
		push(
			`\t${name} {`,
			`\t\tanimation: ${shorthand};`,
			`\t\t@keyframes ${name} {`,
			reindent(body, "\t\t\t"),
			"\t\t}",
			"\t}",
		);
	}
	push("}", "");
}

/**
 * The three shadow families that read no theme namespace. Each is a plain
 * declaration set, matching what the engine emits for the same value written
 * as an arbitrary utility — `__tests__/core/tailwind-preset.test.ts` asserts
 * that equivalence, so a change to the composed chains fails there rather than
 * silently making these wrong.
 */
const COMPOSED_BOX_SHADOW =
	"var(--ri-inset-shadow, 0 0 #0000), var(--ri-inset-ring-shadow, 0 0 #0000), var(--ri-ring-offset-shadow, 0 0 #0000), var(--ri-ring-shadow, 0 0 #0000), var(--ri-shadow, 0 0 #0000)";
const COMPOSED_FILTER =
	"var(--ri-blur, ) var(--ri-brightness, ) var(--ri-contrast, ) var(--ri-grayscale, ) var(--ri-hue-rotate, ) var(--ri-invert, ) var(--ri-saturate, ) var(--ri-sepia, ) var(--ri-drop-shadow, )";

// These three families are written out as `@utility` bodies, so the colour slot
// has to be baked in HERE — the engine's resolvers never see these values. That
// is why `text-shadow-red-500` did nothing for as long as this file has existed:
// it set `--ri-text-shadow-color`, and the sizes it was meant to tint were
// literal colours generated below.
const utilityFamilies = [
	[
		"inset-shadow",
		namespace("inset-shadow"),
		(value) => [
			`--ri-inset-shadow: ${withShadowColorSlot(value, "--ri-inset-shadow-color")};`,
			`box-shadow: ${COMPOSED_BOX_SHADOW};`,
		],
	],
	[
		"text-shadow",
		namespace("text-shadow"),
		(value) => [`text-shadow: ${withShadowColorSlot(value, "--ri-text-shadow-color")};`],
	],
	[
		"drop-shadow",
		// The bare form comes from the deprecated block, the same place the bare
		// `shadow`, `blur`, and `rounded` values do. A `DEFAULT` token cannot
		// carry it here — this family reads no theme namespace — so it is
		// emitted as its own `@utility drop-shadow`, spelled with an empty
		// suffix so the loop below names it exactly that.
		[["", deprecatedValue("--drop-shadow")], ...namespace("drop-shadow")],
		(value) => [
			// One call per layer: `drop-shadow()` takes a single shadow.
			`--ri-drop-shadow: ${withShadowColorSlotLayers(value, "--ri-drop-shadow-color")
				.map((layer) => `drop-shadow(${layer})`)
				.join(" ")};`,
			`filter: ${COMPOSED_FILTER};`,
		],
	],
];

push(
	"/*",
	" * inset-shadow / text-shadow / drop-shadow.",
	" *",
	" * These three families resolve arbitrary values and `none`, but read no",
	" * theme namespace, so there is no token block that could name their sizes.",
	" * Defining them as utilities is the whole of the workaround, and it costs",
	" * nothing: an unused @utility emits no CSS.",
	" */",
);
for (const [family, entries, declarations] of utilityFamilies) {
	for (const [name, value] of entries) {
		push(`@utility ${name === "" ? family : `${family}-${name}`} {`);
		for (const declaration of declarations(value)) push(`\t${declaration}`);
		push("}");
	}
	push("");
}

writeFileSync(OUT, `${lines.join("\n").replace(/\n+$/, "")}\n`);

const colorCount = [...colorFamilies.values()].reduce((n, stops) => n + stops.length, 0);
console.log(
	`Wrote ${OUT}\n` +
		`  ${colorFamilies.size} color families, ${colorCount} stops\n` +
		`  ${textSizes.length} text sizes, ${animations.length} animations\n` +
		`  ${utilityFamilies.reduce((n, [, e]) => n + e.length, 0)} shadow-family utilities`,
);
