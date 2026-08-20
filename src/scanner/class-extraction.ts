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

/** Adds nothing — used for position-only passes that record class contexts
 *  (markContext) without contributing values, so build output is untouched. */
const NOOP_VISITOR: ValueVisitor = () => undefined;

function extractHTML(
	sink: CandidateSink,
	context: SourceExtractionInput,
	warnings?: string[],
): void {
	sink.setOrigin?.("plain");
	scanClassTokens(sink, context.content, 0, warnings);
	// Quoted class attributes are fully tokenized by the whole-file scan above;
	// this pass only annotates their spans as attribute contexts.
	if (sink.wantsPositions) {
		sink.setOrigin?.("attribute");
		collectAssignedValues(sink, context.content, /\bclass\s*=/g, NOOP_VISITOR, 0, warnings);
	}
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
	// Position-only annotation for static class="…" attributes (see extractHTML).
	if (sink.wantsPositions) {
		collectAssignedValues(
			sink,
			context.content,
			/(?<![:\w-])class\s*=/g,
			NOOP_VISITOR,
			0,
			warnings,
		);
	}
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

function extractInto(sink: CandidateSink, input: SourceExtractionInput, warnings?: string[]): void {
	let handled = false;
	for (const extractor of EXTRACTORS) {
		if (extractor.test(input)) {
			extractor.extract(sink, input, warnings);
			handled = true;
			break;
		}
	}
	if (!handled) {
		sink.setOrigin?.("plain");
		scanClassTokens(sink, input.content, 0, warnings);
	}

	// `safelist(...)` — cross-language protocol for libraries that ship class
	// declarations alongside their bundled code. Detected in every file type
	// (the bundled JS in node_modules has no JSX); only literal-string
	// arguments are extracted, so the scan is fast and predictable. Runs after
	// the extractor's prunes on purpose: a safelisted literal survives even
	// when it collides with a structural token.
	if (input.content.includes("safelist")) {
		sink.setOrigin?.("safelist");
		collectCallArguments(
			sink,
			input.content,
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
