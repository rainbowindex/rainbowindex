// ---------------------------------------------------------------------------
// Candidate sinks — one extraction core, two consumers
// ---------------------------------------------------------------------------
// Leaf module of the scanner graph (imports nothing): the collectors and the
// per-filetype extractors both write through these sinks, so keeping them
// dependency-free lets the extraction core stay a DAG.

/** Where a candidate was found. "expression" marks a string literal sitting
 *  in a JS expression position that cannot be a class list — today, an
 *  operand of `==`/`!=` (`mode === "default"`). It is NOT a certain origin:
 *  editors should treat it like "plain" and never report it as a bad class. */
export type CandidateOrigin = "attribute" | "helper" | "safelist" | "plain" | "expression";

/** Is this origin a context the author wrote as a class list? "plain" is the
 *  whole-file scan, whose grammar also matches bare JS identifiers and prose;
 *  "expression" is an equality operand. Neither says anything about intent, so
 *  neither may drive a diagnostic about a malformed class. */
function isClassListOrigin(origin: CandidateOrigin): boolean {
	return origin !== "plain" && origin !== "expression";
}

export interface ClassCandidate {
	/** The class string in expanded form — for variant-group members this
	 *  includes the group prefix (`hover:bg-red-500`) even though the span
	 *  covers only the member token inside the braces. */
	value: string;
	/** Absolute [start, end) span of the visible token in the original source.
	 *  `source.slice(start, end)` is the member token for group members and
	 *  `value` itself everywhere else. */
	start: number;
	end: number;
	origin: CandidateOrigin;
	/** The call the class was found in, when origin is "helper"/"safelist". */
	helperName?: string;
	/** Identity of the innermost scanned helper/safelist call context:
	 *  candidates from the same call share one id, distinct calls get distinct
	 *  ids. A class helper nested inside another class helper's arguments is
	 *  not scanned as its own call — its literals belong to the outer call —
	 *  while a class helper inside a cva/tv config does get its own id. Ids
	 *  are only comparable within one extraction's result. Absent for
	 *  attribute/plain candidates. */
	callId?: number;
	/** For variant-group members: span of the group's variant prefix (`hover:`). */
	groupPrefix?: { start: number; end: number };
}

/**
 * Where extracted class tokens land. The build path uses a Set-backed sink
 * (positions ignored, value dedup); the editor path collects positioned
 * candidates. Optional methods are editor-only annotations — call sites use
 * optional chaining, so the build path pays one undefined check, not a call.
 */
export interface CandidateSink {
	readonly wantsPositions: boolean;
	/** start/end are absolute [start, end) offsets in the ORIGINAL source
	 *  (0,0 when the sink doesn't want positions). prefixStart/prefixEnd
	 *  delimit the variant-group prefix for group members, or are -1. */
	add(value: string, start: number, end: number, prefixStart: number, prefixEnd: number): void;
	/** Remove every candidate with this exact value (post-hoc pruning). */
	delete(value: string): void;
	/** True while a context-aware collector is tokenizing something the author
	 *  wrote as a class list (attribute value, helper or safelist argument).
	 *  Read by the token scan to decide whether a rejected candidate is worth
	 *  reporting: the same rejection from the whole-file scan is routine. */
	readonly inClassList?: boolean;
	setOrigin?(origin: CandidateOrigin): void;
	setHelper?(name: string | null): void;
	/** Record that [start, end) is a class context (attribute value, helper
	 *  argument list) under the active origin. A context only origins the
	 *  candidates a context-aware collector tokenized inside it — never the
	 *  whole-file scan's, whose grammar also matches bare JS identifiers.
	 *  Never affects values. */
	markContext?(start: number, end: number): void;
	/** Record that [start, end) is an expression-position literal — a narrower
	 *  context than the enclosing helper/attribute one, so containment gives
	 *  its tokens the "expression" origin. Independent of the active origin,
	 *  so callers need no save/restore. Never affects values. */
	markExpression?(start: number, end: number): void;
}

/** Build-path sink: value-dedup into a Set, positions discarded. The origin is
 *  tracked but never stored per value — it exists only so the token scan can
 *  tell a class context from the whole-file scan when reporting a rejection. */
export class SetSink implements CandidateSink {
	readonly wantsPositions = false;
	private origin: CandidateOrigin = "plain";
	constructor(readonly classes: Set<string>) {}
	get inClassList(): boolean {
		return isClassListOrigin(this.origin);
	}
	setOrigin(origin: CandidateOrigin): void {
		this.origin = origin;
	}
	add(value: string): void {
		this.classes.add(value);
	}
	delete(value: string): void {
		this.classes.delete(value);
	}
}

interface CandidateContext {
	start: number;
	end: number;
	origin: CandidateOrigin;
	helper: string | null;
	/** Position in the contexts array — doubles as the call identity that
	 *  helper/safelist candidates surface as `callId`. */
	id: number;
}

/**
 * Editor-path sink: positioned candidates, deduped by span + value
 * (keep-first). The same span can host two different values — a nested
 * group's mangled expansion and an object-key collector can both claim one
 * token — and both must survive to keep value parity with the build path's
 * Set. Origins are resolved at finish() by context containment: collectors
 * record every class context they visit (attribute values, helper argument
 * lists), and each candidate takes the origin of the smallest context that
 * contains its span — so a class inside a clsx() call inside a className
 * expression reports "helper", not "attribute". Candidates contained by no
 * context stay "plain". Contexts never contribute values, so value parity
 * with the build path is untouched.
 *
 * Containment alone is not enough to certify a class, because the whole-file
 * token scan's grammar also matches bare JS identifiers: `ri(mode ? a : b)`
 * yields `mode`, which sits inside the call's span and used to be laundered
 * into "helper". So a candidate must ALSO have been tokenized by a
 * context-aware collector to be eligible — provenance decides whether any
 * context may apply, containment decides which one wins.
 */
export class CandidateCollector implements CandidateSink {
	readonly wantsPositions = true;
	private origin: CandidateOrigin = "plain";
	private helperName: string | null = null;
	private readonly byCandidate = new Map<string, ClassCandidate>();
	/** value -> byCandidate keys, so delete() is O(occurrences of the value). */
	private readonly keysByValue = new Map<string, Set<string>>();
	private readonly contexts: CandidateContext[] = [];
	/** Candidates a context-aware collector tokenized itself — the only ones
	 *  eligible to inherit a context's origin (see finish()). */
	private readonly contextual = new WeakSet<ClassCandidate>();

	get inClassList(): boolean {
		return isClassListOrigin(this.origin);
	}

	setOrigin(origin: CandidateOrigin): void {
		this.origin = origin;
		this.helperName = null;
	}

	setHelper(name: string | null): void {
		this.helperName = name;
	}

	markContext(start: number, end: number): void {
		if (this.origin === "plain" || end <= start) return;
		this.contexts.push({
			start,
			end,
			origin: this.origin,
			helper: this.helperName,
			id: this.contexts.length,
		});
	}

	markExpression(start: number, end: number): void {
		if (end <= start) return;
		this.contexts.push({
			start,
			end,
			origin: "expression",
			helper: null,
			id: this.contexts.length,
		});
	}

	add(value: string, start: number, end: number, prefixStart: number, prefixEnd: number): void {
		const key = `${start}:${end}:${value}`;
		// A non-plain active origin means a context-aware collector produced
		// this token. The whole-file plain scan runs first and wins the
		// keep-first dedupe, so eligibility must also be raised on a repeat
		// add — otherwise every quoted attribute value would stay ineligible.
		const contextual = this.origin !== "plain";
		const existing = this.byCandidate.get(key);
		if (existing) {
			if (contextual) this.contextual.add(existing);
			return;
		}
		const candidate: ClassCandidate = { value, start, end, origin: "plain" };
		if (contextual) this.contextual.add(candidate);
		if (prefixStart >= 0) candidate.groupPrefix = { start: prefixStart, end: prefixEnd };
		this.byCandidate.set(key, candidate);
		let keys = this.keysByValue.get(value);
		if (!keys) {
			keys = new Set();
			this.keysByValue.set(value, keys);
		}
		keys.add(key);
	}

	delete(value: string): void {
		const keys = this.keysByValue.get(value);
		if (!keys) return;
		for (const key of keys) this.byCandidate.delete(key);
		this.keysByValue.delete(value);
	}

	finish(): ClassCandidate[] {
		const candidates = [...this.byCandidate.values()].sort(
			(a, b) => a.start - b.start || a.end - b.end,
		);
		if (this.contexts.length > 0) {
			// Sweep instead of candidates x contexts: candidates are start-sorted,
			// so each context enters `live` once its start is reached and leaves
			// for good once its end falls behind the sweep — amortized O(1) per
			// context, with only the (usually shallow) live nesting scanned per
			// candidate. Contexts are typically nested-or-disjoint, but different
			// collectors mark independently and nothing enforces that, so the scan
			// stays correct for overlaps: narrowest containing context wins, equal
			// widths broken by insertion order (id) — the old full scan's exact
			// tie-breaking.
			const byStart = [...this.contexts].sort((a, b) => a.start - b.start);
			const live: CandidateContext[] = [];
			let next = 0;
			for (const candidate of candidates) {
				while (next < byStart.length && byStart[next].start <= candidate.start) {
					live.push(byStart[next]);
					next++;
				}
				let best: CandidateContext | null = null;
				for (let i = 0; i < live.length; i++) {
					const context = live[i];
					if (context.end < candidate.start) {
						// Ends before this candidate, so before every later one too.
						live[i] = live[live.length - 1];
						live.pop();
						i--;
						continue;
					}
					if (candidate.end <= context.end) {
						const width = context.end - context.start;
						const bestWidth = best ? best.end - best.start : -1;
						if (!best || width < bestWidth || (width === bestWidth && context.id < best.id)) {
							best = context;
						}
					}
				}
				if (best && this.contextual.has(candidate)) {
					candidate.origin = best.origin;
					if (best.helper) candidate.helperName = best.helper;
					// A helper/safelist context is one call's argument list, so
					// its id is the call identity merge tooling groups by.
					if (best.origin === "helper" || best.origin === "safelist") {
						candidate.callId = best.id;
					}
				}
			}
		}
		return candidates;
	}
}
