/**
 * PostCSS parse-safety rewriter for RI directive bodies.
 *
 * Some directive-body syntax (`!name;` removals, bare @fluid curve keywords,
 * @color option flags) is not parseable by PostCSS as declarations, so the
 * Vite plugin rewrites it into equivalent `--ri-*` custom-property forms
 * before PostCSS ever sees the file. The rewriter lives in the directives
 * layer — next to the parsers that accept the rewritten forms — so the
 * directive→body-grammar mapping cannot drift across layers.
 */

import { isAtRuleBoundary } from "../shared.js";
import { isAtRuleNameChar } from "./activation.js";
import { DIRECTIVE_TYPE_NAMES, type DirectiveType, findClosingBrace } from "./foundation.js";

/**
 * Body grammar of each directive type:
 *
 * - `removal` — bodies accept `!name;` removal syntax (parseKeyValueBody,
 *   parseColorBody, parseAnimateBody), rewritten to `--ri-rm: name;`.
 * - `keyword` — bodies carry bare curve keywords (@fluid), rewritten to
 *   `--ri-*: true/false;` purely for parse-safety (parseFluidBody ignores
 *   them, matching the CLI path which also ignores bare fluid keywords).
 * - `raw` — bodies are raw CSS (@utility/@custom/@font and friends) and
 *   must never be rewritten.
 *
 * The Record is exhaustive over DirectiveType, so adding a directive without
 * choosing its grammar is a compile error — this replaces the hand-synced
 * name sets the Vite plugin used to maintain.
 */
type BodyGrammar = "removal" | "keyword" | "raw";
const BODY_GRAMMAR: Record<DirectiveType, BodyGrammar> = {
	color: "removal",
	text: "removal",
	spacing: "removal",
	breakpoint: "removal",
	rounded: "removal",
	shadow: "removal",
	weight: "removal",
	ease: "removal",
	blur: "removal",
	z: "removal",
	animate: "removal",
	leading: "removal",
	tracking: "removal",
	opacity: "removal",
	duration: "removal",
	fluid: "keyword",
	font: "raw",
	preflight: "raw",
	utility: "raw",
	custom: "raw",
	source: "raw",
	layer: "raw",
	register: "raw",
};

const REMOVAL_BODY_DIRECTIVES: ReadonlySet<string> = new Set(
	DIRECTIVE_TYPE_NAMES.filter((n) => BODY_GRAMMAR[n] === "removal"),
);
const KEYWORD_BODY_DIRECTIVES: ReadonlySet<string> = new Set(
	DIRECTIVE_TYPE_NAMES.filter((n) => BODY_GRAMMAR[n] === "keyword"),
);

const REMOVAL_RE = /!([\w][\w-]*)\s*;/g;
const FLUID_KEYWORD_RE = /\b(no-parabolic|parabolic|no-shift|shift)\s*;?/g;
// Bare option flags inside a @color entry's `{ … }` block — `inline`,
// `parabolic`/`no-parabolic`. PostCSS cannot parse a lone keyword as a
// declaration, so each is rewritten to its `--ri-*` form (which parseColorBody
// also accepts). The lookbehind + `;`/`}` boundary restrict the match to a flag
// standing alone as its own statement, so a `dark: shift …` override value —
// whose `shift` is not a flag — is left intact.
const COLOR_FLAG_RE = /(?<=[{;\s]|^)(inline|no-parabolic|parabolic)\s*(?:;|(?=}))/g;

/**
 * Walk a directive body's top-level structure once: depth-0 spans go through
 * `mapOutside`, each complete top-level `{ … }` block's interior goes through
 * `mapBlock` (the braces themselves pass through verbatim). Nesting is owned
 * by findClosingBrace — the same matcher the outer directive scan uses, so
 * quotes and comments inside blocks are honored consistently. The tail after
 * an unclosed `{` is copied through untouched: the parsers treat it as
 * unterminated, so the rewriter must neither alter nor duplicate it.
 *
 * One walker serves both rewrite passes (top-level statements for
 * removals/keywords, block interiors for @color option flags) so their
 * boundary handling cannot drift.
 */
function mapTopLevelSpans(
	body: string,
	mapOutside: (span: string) => string,
	mapBlock: (interior: string) => string,
): string {
	let brace = body.indexOf("{");
	if (brace === -1) return mapOutside(body);
	let out = "";
	let segStart = 0;
	while (brace !== -1) {
		out += mapOutside(body.slice(segStart, brace));
		const close = findClosingBrace(body, brace);
		if (close === -1) return out + body.slice(brace);
		out += `{${mapBlock(body.slice(brace + 1, close))}}`;
		segStart = close + 1;
		brace = body.indexOf("{", segStart);
	}
	return out + mapOutside(body.slice(segStart));
}

const keepSpan = (span: string): string => span;

/** Map one matched @color flag keyword to its `--ri-*` declaration. */
function rewriteColorOptionFlag(_match: string, keyword: string): string {
	if (keyword === "inline") return "--ri-inline: true;";
	const negated = keyword.startsWith("no-");
	return `--ri-${negated ? keyword.slice(3) : keyword}: ${negated ? "false" : "true"};`;
}

/** Rewrite the bare option flags inside each @color entry's `{ … }` block to
 *  their `--ri-*` forms. The flags sit inside the per-color options block, so
 *  only block interiors are visited. Depth-0 entries (e.g. an alias
 *  `muted: shift;`) never are — a color value that happens to be a flag word
 *  is never mistaken for a flag. */
function rewriteColorOptionFlags(body: string): string {
	return mapTopLevelSpans(body, keepSpan, (interior) =>
		interior.replace(COLOR_FLAG_RE, rewriteColorOptionFlag),
	);
}

/**
 * Rewrite PostCSS-unparseable RI syntax (`!name;` removals, bare @fluid curve
 * keywords, @color option flags) into the custom-property forms the directive
 * parsers recognize (`--ri-rm: name;`, `--ri-parabolic: true;`, `--ri-inline: true;`).
 *
 * Scoped to the bodies of the directives that define that syntax so user CSS
 * is never touched — a file-wide replace would destroy `color: red !important;`
 * and keyframe/animation names like `shift`.
 */
export function rewriteDirectiveBodies(code: string): string {
	let out = "";
	let last = 0;
	let i = 0;
	while (i < code.length) {
		const at = code.indexOf("@", i);
		if (at === -1) break;
		if (!isAtRuleBoundary(code, at)) {
			i = at + 1;
			continue;
		}
		let nameEnd = at + 1;
		while (nameEnd < code.length && isAtRuleNameChar(code.charCodeAt(nameEnd))) nameEnd++;
		const name = code.slice(at + 1, nameEnd);
		const removals = REMOVAL_BODY_DIRECTIVES.has(name);
		const keywords = KEYWORD_BODY_DIRECTIVES.has(name);
		if (!removals && !keywords) {
			i = nameEnd;
			continue;
		}
		// Skip the (optional) modifier up to the body brace; semicolon-form
		// directives have no body to rewrite.
		let braceIdx = nameEnd;
		while (braceIdx < code.length) {
			const ch = code[braceIdx];
			if (ch === "{" || ch === ";" || ch === "}") break;
			braceIdx++;
		}
		if (code[braceIdx] !== "{") {
			i = braceIdx + 1;
			continue;
		}
		const close = findClosingBrace(code, braceIdx);
		const bodyStart = braceIdx + 1;
		const bodyEnd = close === -1 ? code.length : close;
		// Top-level statements only — block interiors (e.g. @animate keyframes
		// containing `!important`) pass through untouched.
		let rewritten = mapTopLevelSpans(
			code.slice(bodyStart, bodyEnd),
			(span) => {
				let s = span;
				if (removals) s = s.replace(REMOVAL_RE, "--ri-rm: $1;");
				if (keywords) {
					s = s.replace(FLUID_KEYWORD_RE, (_, kw: string) => {
						const negated = kw.startsWith("no-");
						return `--ri-${negated ? kw.slice(3) : kw}: ${negated ? "false" : "true"};`;
					});
				}
				return s;
			},
			keepSpan,
		);
		// @color option flags live inside the per-entry `{ … }` block, which the
		// pass above keeps verbatim — rewrite them in a block-interior pass.
		if (name === "color") rewritten = rewriteColorOptionFlags(rewritten);
		out += code.slice(last, bodyStart) + rewritten;
		last = bodyEnd;
		i = bodyEnd;
	}
	if (last === 0) return code;
	return out + code.slice(last);
}
