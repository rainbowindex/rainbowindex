import { BUILTIN_STATIC_KEYS, PREFIX_PROP_KEYS } from "../merge/props.js";
import { codepointCompare } from "../shared.js";

/**
 * Utilities recognized as whole static tokens by the parser even though
 * merge conflict resolution handles them through prefix-based rules.
 */
export const PARSER_ONLY_STATICS = [
	"w-full",
	"w-screen",
	"w-auto",
	"w-min",
	"w-max",
	"w-fit",
	"h-full",
	"h-screen",
	"h-auto",
	"h-min",
	"h-max",
	"h-fit",
	"min-w-0",
	"min-w-full",
	"min-w-min",
	"min-w-max",
	"min-w-fit",
	"max-w-none",
	"max-w-full",
	"max-w-min",
	"max-w-max",
	"max-w-fit",
	"max-w-prose",
	"min-h-0",
	"min-h-full",
	"min-h-screen",
	"min-h-min",
	"min-h-max",
	"min-h-fit",
	"max-h-none",
	"max-h-full",
	"max-h-screen",
	"max-h-min",
	"max-h-max",
	"max-h-fit",
	"size-auto",
	"size-full",
	"size-min",
	"size-max",
	"size-fit",
] as const;

export const STATIC_UTILITIES: ReadonlySet<string> = new Set([
	...BUILTIN_STATIC_KEYS,
	...PARSER_ONLY_STATICS,
]);

export const MULTI_SEGMENT_PREFIXES: string[] = [...PREFIX_PROP_KEYS]
	.filter((key) => key.includes("-"))
	.sort((a, b) => b.length - a.length || codepointCompare(a, b));
