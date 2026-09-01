/**
 * `ri-disable` comment pragmas — silencing named diagnostics from the CSS.
 *
 * Two forms, both ordinary CSS comments, so nothing new reaches the parser and
 * a stylesheet carrying them stays valid CSS for every other tool:
 *
 * ```css
 * /* ri-disable RI-1124 *\/             — every warning of that code, whole file
 * /* ri-disable-next-line RI-1124 *\/   — the next entry, or the next directive
 * ```
 *
 * One comment may name several codes: `/* ri-disable RI-1124, RI-1122 *\/`.
 *
 * `ri-disable-next-line` resolves at whichever granularity the emitter can
 * offer. Inside a scale body it guards the single entry that follows, because
 * entries are named and the name is right there in the text. Outside a body it
 * guards the directive that follows, because a resolver warning's only known
 * position is the at-rule that produced it. Matching on the name rather than on
 * an offset is what keeps the first case cheap: comments are stripped per body
 * before parsing, so offsets taken from a parsed entry no longer line up with
 * the text the reader wrote, but the name does.
 */

const CODE_LIST_RE = /^[\s,]*(?:RI-\d{4}[\s,]*)+$/;
const CODE_RE = /RI-\d{4}/g;

/** `ri-disable`, not followed by `-next-line` — `\s` after the word rules it out. */
const FILE_PRAGMA_RE = /\/\*\s*ri-disable\s+([^*]*?)\s*\*\//g;
const NEXT_LINE_PRAGMA_RE = /\/\*\s*ri-disable-next-line\s+([^*]*?)\s*\*\//g;

/** A `ri-disable-next-line` pragma and where it sits in the scanned text. */
export interface NextLinePragma {
	code: string;
	/** Offset of the comment's first character. */
	start: number;
	/** Offset just past the comment's closing `*​/`. */
	end: number;
}

/**
 * Fatal bootstrap (RI-00xx) and runtime (RI-20xx) codes are never silenceable.
 * They report a broken build or a broken call, not a style choice, and a
 * stylesheet that could hide them would hide the reason the build failed.
 */
export function isSuppressible(code: string): boolean {
	return !/^RI-[02]\d{3}$/.test(code);
}

/** Read the `RI-NNNN` codes out of one pragma's argument list. */
function parseCodes(raw: string, warnings?: string[]): string[] {
	if (!CODE_LIST_RE.test(raw)) {
		warnings?.push(
			`[RI-1040] Unreadable ri-disable comment "${raw.trim()}" — expected one or more codes such as "RI-1124", separated by commas. The comment was ignored.`,
		);
		return [];
	}
	const out: string[] = [];
	for (const match of raw.matchAll(CODE_RE)) {
		const code = match[0];
		if (!isSuppressible(code)) {
			warnings?.push(
				`[RI-1040] ri-disable cannot silence "${code}" — RI-00xx and RI-20xx report a broken build or a broken call, not a style choice. The code was ignored.`,
			);
			continue;
		}
		out.push(code);
	}
	return out;
}

/** Codes silenced for the whole CSS entry by `ri-disable`. */
export function parseFileDisables(css: string, warnings?: string[]): Set<string> {
	const disabled = new Set<string>();
	if (!css.includes("ri-disable")) return disabled;
	for (const match of css.matchAll(FILE_PRAGMA_RE)) {
		for (const code of parseCodes(match[1], warnings)) disabled.add(code);
	}
	return disabled;
}

/** Every `ri-disable-next-line` pragma in the text, in source order. */
export function parseNextLinePragmas(css: string, warnings?: string[]): NextLinePragma[] {
	const out: NextLinePragma[] = [];
	if (!css.includes("ri-disable-next-line")) return out;
	for (const match of css.matchAll(NEXT_LINE_PRAGMA_RE)) {
		for (const code of parseCodes(match[1], warnings)) {
			out.push({ code, start: match.index, end: match.index + match[0].length });
		}
	}
	return out;
}

/** The entry key a body-level pragma guards: the identifier that opens the
 *  next entry, skipping whitespace and any further comments. */
function readEntryName(src: string): string | null {
	const match = /^(?:\s|\/\*[\s\S]*?\*\/)*([\w-]+\*?)/.exec(src);
	return match ? match[1] : null;
}

/**
 * Entry names silenced inside one directive body, as `code → names`.
 *
 * Keyed by name because the pragma is read from the body as authored, while the
 * parsed entries come from a comment-stripped copy whose offsets have shifted.
 */
export function parseEntryDisables(
	body: string,
	warnings?: string[],
): ReadonlyMap<string, ReadonlySet<string>> {
	const out = new Map<string, Set<string>>();
	for (const pragma of parseNextLinePragmas(body, warnings)) {
		const name = readEntryName(body.slice(pragma.end));
		if (name === null) continue;
		let names = out.get(pragma.code);
		if (names === undefined) {
			names = new Set();
			out.set(pragma.code, names);
		}
		names.add(name);
	}
	return out;
}

/** True when `code` is silenced for `name` by a body-level pragma. */
export function entryDisabled(
	disables: ReadonlyMap<string, ReadonlySet<string>> | undefined,
	code: string,
	name: string,
): boolean {
	return disables?.get(code)?.has(name) === true;
}
