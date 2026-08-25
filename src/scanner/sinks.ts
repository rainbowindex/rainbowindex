// ---------------------------------------------------------------------------
// Candidate sinks — one extraction core, two consumers
// ---------------------------------------------------------------------------
// Leaf module of the scanner graph (imports nothing): the collectors and the
// per-filetype extractors both write through these sinks, so keeping them
// dependency-free lets the extraction core stay a DAG.

export type CandidateOrigin = "attribute" | "helper" | "safelist" | "plain";

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
	setOrigin?(origin: CandidateOrigin): void;
	setHelper?(name: string | null): void;
	/** Record that [start, end) is a class context (attribute value, helper
	 *  argument list) under the active origin. Origin assignment is by
	 *  containment, so simple quoted values — which only the whole-file scan
	 *  tokenizes — still get their context's origin. Never affects values. */
	markContext?(start: number, end: number): void;
}

/** Build-path sink: value-dedup into a Set, positions discarded. */
export class SetSink implements CandidateSink {
	readonly wantsPositions = false;
	constructor(readonly classes: Set<string>) {}
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
 */
export class CandidateCollector implements CandidateSink {
	readonly wantsPositions = true;
	private origin: CandidateOrigin = "plain";
	private helperName: string | null = null;
	private readonly byCandidate = new Map<string, ClassCandidate>();
	/** value -> byCandidate keys, so delete() is O(occurrences of the value). */
	private readonly keysByValue = new Map<string, Set<string>>();
	private readonly contexts: CandidateContext[] = [];

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

	add(value: string, start: number, end: number, prefixStart: number, prefixEnd: number): void {
		const key = `${start}:${end}:${value}`;
		if (this.byCandidate.has(key)) return;
		const candidate: ClassCandidate = { value, start, end, origin: "plain" };
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
				if (best) {
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
