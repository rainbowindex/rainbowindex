import { describe, expect, test } from "vitest";
import {
	CandidateCollector,
	type CandidateOrigin,
	type ClassCandidate,
} from "../../src/scanner/sinks.js";

// ---------------------------------------------------------------------------
// CandidateCollector — context resolution sweep + indexed delete
// ---------------------------------------------------------------------------
// finish() replaced a candidates x contexts scan with a sweep; delete()
// replaced a full-map scan with a value index. These tests pin the exact
// semantics of the old algorithms: narrowest containing context wins, equal
// widths broken by insertion order, no-context candidates stay "plain", and
// delete removes exactly the entries for the pruned value.

interface ContextSpec {
	start: number;
	end: number;
	origin: CandidateOrigin;
	helper?: string;
}

function build(contexts: ContextSpec[], spans: Array<[string, number, number]>): ClassCandidate[] {
	const collector = new CandidateCollector();
	for (const context of contexts) {
		collector.setOrigin(context.origin);
		if (context.helper) collector.setHelper(context.helper);
		collector.markContext(context.start, context.end);
	}
	collector.setOrigin("plain");
	for (const [value, start, end] of spans) {
		collector.add(value, start, end, -1, -1);
	}
	return collector.finish();
}

/** The pre-sweep algorithm, verbatim: scan every context per candidate,
 *  keep the first strictly-narrowest containing one (insertion order). */
function referenceAssign(
	candidate: ClassCandidate,
	contexts: ContextSpec[],
): Pick<ClassCandidate, "origin" | "helperName" | "callId"> {
	let best: (ContextSpec & { id: number }) | null = null;
	for (const [id, context] of contexts.entries()) {
		if (context.start <= candidate.start && candidate.end <= context.end) {
			if (!best || context.end - context.start < best.end - best.start) {
				best = { ...context, id };
			}
		}
	}
	if (!best) return { origin: "plain", helperName: undefined, callId: undefined };
	return {
		origin: best.origin,
		helperName: best.helper,
		callId: best.origin === "helper" || best.origin === "safelist" ? best.id : undefined,
	};
}

function assignments(candidates: ClassCandidate[]) {
	return candidates.map((c) => ({
		value: c.value,
		origin: c.origin,
		helperName: c.helperName,
		callId: c.callId,
	}));
}

describe("CandidateCollector context resolution", () => {
	test("nested, disjoint, and adjacent contexts with boundary candidates", () => {
		const contexts: ContextSpec[] = [
			{ start: 10, end: 50, origin: "attribute" }, // outer, id 0
			{ start: 20, end: 40, origin: "helper", helper: "clsx" }, // nested, id 1
			{ start: 50, end: 60, origin: "attribute" }, // adjacent to outer, id 2
			{ start: 70, end: 80, origin: "safelist", helper: "safelist" }, // disjoint, id 3
		];
		const candidates = build(contexts, [
			["a", 10, 15], // start == outer.start
			["b", 20, 25], // start == nested.start -> narrowest wins
			["c", 35, 40], // end == nested.end
			["d", 45, 50], // end == outer.end, NOT inside [50,60)
			["e", 50, 55], // start == adjacent.start
			["f", 62, 66], // outside every context
			["g", 70, 80], // exactly the safelist span
			["h", 5, 12], // straddles outer.start -> not contained
		]);
		expect(assignments(candidates)).toEqual([
			{ value: "h", origin: "plain", helperName: undefined, callId: undefined },
			{ value: "a", origin: "attribute", helperName: undefined, callId: undefined },
			{ value: "b", origin: "helper", helperName: "clsx", callId: 1 },
			{ value: "c", origin: "helper", helperName: "clsx", callId: 1 },
			{ value: "d", origin: "attribute", helperName: undefined, callId: undefined },
			{ value: "e", origin: "attribute", helperName: undefined, callId: undefined },
			{ value: "f", origin: "plain", helperName: undefined, callId: undefined },
			{ value: "g", origin: "safelist", helperName: "safelist", callId: 3 },
		]);
	});

	test("equal-width tie goes to the earlier-inserted context", () => {
		const contexts: ContextSpec[] = [
			{ start: 0, end: 10, origin: "helper", helper: "first" },
			{ start: 0, end: 10, origin: "helper", helper: "second" },
		];
		const [candidate] = build(contexts, [["x", 2, 6]]);
		expect(candidate.helperName).toBe("first");
		expect(candidate.callId).toBe(0);
	});

	test("narrowest wins regardless of insertion order", () => {
		const contexts: ContextSpec[] = [
			{ start: 5, end: 15, origin: "helper", helper: "inner" },
			{ start: 0, end: 100, origin: "attribute" },
		];
		const [candidate] = build(contexts, [["x", 6, 9]]);
		expect(candidate.origin).toBe("helper");
		expect(candidate.helperName).toBe("inner");
	});

	test("matches the old full-scan exactly on randomized overlapping layouts", () => {
		// mulberry32 — deterministic layouts, so failures reproduce.
		let seed = 0xc0ffee;
		const rand = () => {
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const origins: CandidateOrigin[] = ["attribute", "helper", "safelist"];
		for (let round = 0; round < 25; round++) {
			const contexts: ContextSpec[] = [];
			for (let i = 0; i < 12; i++) {
				const start = Math.floor(rand() * 60);
				const origin = origins[Math.floor(rand() * origins.length)];
				contexts.push({
					start,
					end: start + 1 + Math.floor(rand() * 30),
					origin,
					helper: origin === "attribute" ? undefined : `h${i}`,
				});
			}
			const spans: Array<[string, number, number]> = [];
			for (let i = 0; i < 20; i++) {
				const start = Math.floor(rand() * 70);
				spans.push([`c${i}`, start, start + 1 + Math.floor(rand() * 8)]);
			}
			const candidates = build(contexts, spans);
			for (const candidate of candidates) {
				expect({
					value: candidate.value,
					origin: candidate.origin,
					helperName: candidate.helperName,
					callId: candidate.callId,
				}).toEqual({ value: candidate.value, ...referenceAssign(candidate, contexts) });
			}
		}
	});
});

describe("CandidateCollector delete", () => {
	test("removes every entry for the value and nothing else", () => {
		const collector = new CandidateCollector();
		collector.add("keep", 0, 4, -1, -1);
		collector.add("drop", 5, 9, -1, -1);
		collector.add("drop", 10, 14, -1, -1);
		collector.add("keep", 20, 24, -1, -1);
		collector.delete("drop");
		collector.delete("missing"); // no-op
		expect(collector.finish().map((c) => [c.value, c.start])).toEqual([
			["keep", 0],
			["keep", 20],
		]);
	});

	test("re-adding after delete works", () => {
		const collector = new CandidateCollector();
		collector.add("drop", 5, 9, -1, -1);
		collector.delete("drop");
		collector.add("drop", 5, 9, -1, -1);
		expect(collector.finish().map((c) => c.value)).toEqual(["drop"]);
	});
});
