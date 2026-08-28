// ---------------------------------------------------------------------------
// Per-filetype extractors — the scanner's public entry points
// ---------------------------------------------------------------------------
// This module stays the single import surface for class extraction: the
// grammar, sinks, and collectors live in sibling modules (collectors.js,
// sinks.js, js-scan.js, variant-groups.js), and everything consumers relied
// on here is either defined or re-exported below.

import {
	CLASS_HELPER_NAMES,
	CLASS_HELPERS_CALL_RE,
	collectAssignedValues,
	collectCallArguments,
	collectClassishExpression,
	collectClassMapArguments,
	collectDirectiveNames,
	collectStringLiteralClasses,
	collectVariantHelperArguments,
	MAX_LINE_LENGTH,
	pruneTokens,
	pruneVariantMetadata,
	scanClassTokens,
	type ValueVisitor,
	VARIANT_HELPER_NAMES,
} from "./collectors.js";
import { CandidateCollector, type CandidateSink, type ClassCandidate, SetSink } from "./sinks.js";

export { CLASS_HELPER_NAMES, extractClasses, VARIANT_HELPER_NAMES } from "./collectors.js";
export type { CandidateOrigin, ClassCandidate } from "./sinks.js";
export { expandApplyGroups, expandVariantGroups } from "./variant-groups.js";

export interface SourceExtractionInput {
	path?: string;
	content: string;
}

const NON_CLASS_IDENTIFIERS = new Set<string>([
	...CLASS_HELPER_NAMES,
	...VARIANT_HELPER_NAMES,
	"classMap",
]);

// Module-level call matcher — the safelist protocol name is constant, so the
// regex compiles once. Same lastIndex-drain discipline as the collectors'
// call matchers: reset on entry, drained to null, never re-entered mid-scan.
const SAFELIST_CALL_RE = /\bsafelist\s*\(/g;

type Extractor = {
	test: (context: SourceExtractionInput) => boolean;
	extract: (sink: CandidateSink, context: SourceExtractionInput, warnings?: string[]) => void;
};

/** Adds nothing itself — used for passes whose non-quoted values should not
 *  contribute tokens. Quoted attribute values are still tokenized by
 *  collectAssignedValues regardless of visitor, so these passes both annotate
 *  attribute contexts (markContext) and keep quoted classes alive on lines the
 *  whole-file scan drops for length. */
const NOOP_VISITOR: ValueVisitor = () => undefined;

function extractHTML(
	sink: CandidateSink,
	context: SourceExtractionInput,
	warnings?: string[],
): void {
	sink.setOrigin?.("plain");
	scanClassTokens(sink, context.content, 0, warnings);
	// Runs unconditionally: besides annotating attribute contexts for the
	// editor, this pass is what extracts quoted class attributes on
	// >MAX_LINE_LENGTH lines, which the whole-file scan above drops.
	sink.setOrigin?.("attribute");
	collectAssignedValues(sink, context.content, /\bclass\s*=/g, NOOP_VISITOR, 0, warnings);
}

function extractJSXTSX(
	sink: CandidateSink,
	context: SourceExtractionInput,
	warnings?: string[],
): void {
	const content = context.content;
	sink.setOrigin?.("plain");
	scanClassTokens(sink, content, 0, warnings);
	sink.setOrigin?.("attribute");
	collectAssignedValues(
		sink,
		content,
		/\b(?:className|class|tw)\s*=/g,
		collectClassishExpression,
		0,
		warnings,
	);
	collectAssignedValues(
		sink,
		content,
		/\b(?:className|class)\s*:/g,
		collectClassishExpression,
		0,
		warnings,
	);
	collectAssignedValues(sink, content, /\bclassList\s*=/g, collectClassishExpression, 0, warnings);
	sink.setOrigin?.("helper");
	collectCallArguments(sink, content, CLASS_HELPERS_CALL_RE, undefined, 0, warnings);
	const variantMetadata = collectVariantHelperArguments(sink, content, 0, warnings);
	collectClassMapArguments(sink, content, 0, warnings);
	sink.setHelper?.(null);
	pruneTokens(sink, NON_CLASS_IDENTIFIERS);
	pruneVariantMetadata(sink, variantMetadata, content);
}

function extractVue(
	sink: CandidateSink,
	context: SourceExtractionInput,
	warnings?: string[],
): void {
	sink.setOrigin?.("plain");
	scanClassTokens(sink, context.content, 0, warnings);
	sink.setOrigin?.("attribute");
	collectAssignedValues(
		sink,
		context.content,
		/(?::class|v-bind:class)\s*=/g,
		collectClassishExpression,
		0,
		warnings,
	);
	// Unconditional for the same reason as extractHTML: quoted static
	// class="…" attributes on over-long lines only survive through this pass.
	collectAssignedValues(sink, context.content, /(?<![:\w-])class\s*=/g, NOOP_VISITOR, 0, warnings);
}

function extractSvelte(
	sink: CandidateSink,
	context: SourceExtractionInput,
	warnings?: string[],
): void {
	sink.setOrigin?.("plain");
	scanClassTokens(sink, context.content, 0, warnings);
	sink.setOrigin?.("attribute");
	collectDirectiveNames(sink, context.content, /class:([A-Za-z0-9_-]+)/g, 0, warnings);
	collectAssignedValues(
		sink,
		context.content,
		/\bclass\s*=/g,
		collectClassishExpression,
		0,
		warnings,
	);
}

const EXTRACTORS: readonly Extractor[] = [
	{
		test: (context) => !!context.path && context.path.endsWith(".vue"),
		extract: extractVue,
	},
	{
		test: (context) => !!context.path && context.path.endsWith(".svelte"),
		extract: extractSvelte,
	},
	{
		test: (context) => !!context.path && context.path.endsWith(".html"),
		extract: extractHTML,
	},
	{
		test: (context) =>
			!!context.path &&
			(context.path.endsWith(".tsx") ||
				context.path.endsWith(".jsx") ||
				context.path.endsWith(".ts") ||
				context.path.endsWith(".js") ||
				context.path.endsWith(".mdx") ||
				context.path.endsWith(".md")),
		extract: extractJSXTSX,
	},
];

/** SVG geometry attributes carry unbounded numeric blobs, never class lists.
 *  Their values tokenize cleanly against the class grammar — `d="M255.75,40c-.35…"`
 *  yields hundreds of digit fragments (`40c-.35-1.1-1.04`, `9.17-57.2`), each one
 *  a wasted compile lookup and cache entry on every build of every file with an
 *  inline icon. Matching only quoted values keeps `d={expr}` bindings, where a
 *  class list can legitimately live, untouched. */
const SVG_GEOMETRY_VALUE_RE = /((?<![\w-])(?:d|points)\s*=\s*["'])([^"']*)/g;

/** Blank SVG geometry values before any collector reads them. Spaces, not
 *  removal: the replacement is the same length, so every candidate span the
 *  editor path reports still points at the original text. */
function blankSvgGeometry(content: string): string {
	return content.replace(
		SVG_GEOMETRY_VALUE_RE,
		(_match, head: string, value: string) => head + " ".repeat(value.length),
	);
}

/**
 * Surface the whole-file scan's long-line drops instead of losing content
 * silently — a class list on a dropped line simply never generating is the
 * scanner's worst failure mode to debug. Suppressed for node_modules paths:
 * minified dists are the guard's intended target, and warning there is noise.
 */
function warnOverLongLines(input: SourceExtractionInput, warnings?: string[]): void {
	const content = input.content;
	if (!warnings || content.length <= MAX_LINE_LENGTH) return;
	if (input.path?.includes("node_modules")) return;
	let count = 0;
	let start = 0;
	for (;;) {
		const idx = content.indexOf("\n", start);
		const end = idx === -1 ? content.length : idx;
		if (end - start > MAX_LINE_LENGTH) count++;
		if (idx === -1) break;
		start = idx + 1;
	}
	if (count === 0) return;
	warnings.push(
		`[RI-1411] ${input.path ?? "<source>"}: ${count} line(s) longer than ${MAX_LINE_LENGTH} characters were skipped by the class scanner (minified-input guard). Quoted class attributes on those lines are still read; other class references there are not — split the long lines.`,
	);
}

function extractInto(sink: CandidateSink, input: SourceExtractionInput, warnings?: string[]): void {
	warnOverLongLines(input, warnings);
	// Every pass below reads the blanked copy — the geometry values it drops
	// cannot hold a class in any of them, and blanking once here is what keeps
	// the guard from having to be repeated per extractor.
	const scanned: SourceExtractionInput = {
		path: input.path,
		content: blankSvgGeometry(input.content),
	};
	let handled = false;
	for (const extractor of EXTRACTORS) {
		if (extractor.test(scanned)) {
			extractor.extract(sink, scanned, warnings);
			handled = true;
			break;
		}
	}
	if (!handled) {
		sink.setOrigin?.("plain");
		scanClassTokens(sink, scanned.content, 0, warnings);
	}

	// `safelist(...)` — cross-language protocol for libraries that ship class
	// declarations alongside their bundled code. Detected in every file type
	// (the bundled JS in node_modules has no JSX); only literal-string
	// arguments are extracted, so the scan is fast and predictable. Runs after
	// the extractor's prunes on purpose: a safelisted literal survives even
	// when it collides with a structural token.
	if (scanned.content.includes("safelist")) {
		sink.setOrigin?.("safelist");
		collectCallArguments(
			sink,
			scanned.content,
			SAFELIST_CALL_RE,
			collectStringLiteralClasses,
			0,
			warnings,
		);
		sink.setHelper?.(null);
	}
}

export function extractClassesFromSource(
	input: SourceExtractionInput,
	warnings?: string[],
): Set<string> {
	const classes = new Set<string>();
	extractInto(new SetSink(classes), input, warnings);
	return classes;
}

/**
 * Position-aware variant of `extractClassesFromSource` for editor tooling.
 * Same extractors, same filters, same pruning — the value set of the result
 * always equals `extractClassesFromSource(input)`. Each candidate additionally
 * carries its source span, its collection origin, and (for variant-group
 * members) the group's prefix span. Candidates are sorted by position and
 * deduped by span + value; a span found by both the whole-file scan and a
 * context-aware collector reports the collector's origin.
 */
export function extractClassCandidates(
	input: SourceExtractionInput,
	warnings?: string[],
): ClassCandidate[] {
	const collector = new CandidateCollector();
	extractInto(collector, input, warnings);
	return collector.finish();
}
