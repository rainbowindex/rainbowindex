import { describe, expect, it } from "vitest";
import {
	createCompilationContext,
	registerCustomUtility,
	finalizeCompilationContext,
	createRi,
} from "../../src/merge/index.js";
import { BUILTIN_STATIC_KEYS, PREFIX_PROP_KEYS } from "../../src/merge/props.js";
import {
	parseUtility,
	STATIC_UTILITIES,
	MULTI_SEGMENT_PREFIXES,
} from "../../src/utilities/parser.js";
import { resolveDirectives } from "../../src/directives/index.js";
import { resolveUtility, PREFIX_DISPATCH } from "../../src/utilities/index.js";

describe("STATIC_UTILITIES ↔ BUILTIN_STATIC_PROPS parity", () => {
	it("every BUILTIN_STATIC_PROPS key is parseable as a known utility", () => {
		const unparseable: string[] = [];
		for (const key of BUILTIN_STATIC_KEYS) {
			const parsed = parseUtility(key);
			if (!STATIC_UTILITIES.has(key) && parsed.utility === key && !parsed.value) {
				unparseable.push(key);
			}
		}
		expect(unparseable).toEqual([]);
	});
});

describe("MULTI_SEGMENT_PREFIXES ↔ PREFIX_PROPS parity", () => {
	it("every multi-segment PREFIX_PROPS key is in MULTI_SEGMENT_PREFIXES", () => {
		const multiSegmentPrefixSet = new Set(MULTI_SEGMENT_PREFIXES);
		const missing: string[] = [];
		for (const key of PREFIX_PROP_KEYS) {
			if (key.includes("-") && !multiSegmentPrefixSet.has(key)) {
				missing.push(key);
			}
		}
		expect(missing).toEqual([]);
	});

	it("every MULTI_SEGMENT_PREFIXES entry exists in PREFIX_PROPS, BUILTIN_STATIC_PROPS, or is known parser-only metadata", () => {
		const parserOnly = new Set([
			"flex-shrink",
			"flex-grow",
			"flex-basis",
			"@container",
			"overflow-x",
			"overflow-y",
			"overscroll-x",
			"overscroll-y",
		]);
		const orphaned: string[] = [];
		for (const prefix of MULTI_SEGMENT_PREFIXES) {
			if (!PREFIX_PROP_KEYS.has(prefix) && !prefix.endsWith("-fluid") && !parserOnly.has(prefix)) {
				orphaned.push(prefix);
			}
		}
		expect(orphaned).toEqual([]);
	});
});

describe("createRi() isolation", () => {
	it("createRi() with snapshot uses bound context", () => {
		const ctx = createCompilationContext();
		registerCustomUtility(ctx, "card", ["padding", "border-radius"]);
		const snapshot = finalizeCompilationContext(ctx);
		const boundRi = createRi(snapshot);
		const result = boundRi("card p-8");
		expect(result).toContain("p-8");
		expect(result).toContain("card");
		finalizeCompilationContext(createCompilationContext());
	});

	it("createRi() without snapshot uses latest global state", () => {
		const boundRi = createRi();
		expect(boundRi("p-2 p-4")).toBe("p-4");
	});
});

describe("PREFIX_DISPATCH covers all resolvable utilities", () => {
	const theme = resolveDirectives([]);
	const sampleUtilities: Array<[string, string | null]> = [
		["p", "4"],
		["px", "2"],
		["m", "4"],
		["gap", "4"],
		["inset", "4"],
		["top", "4"],
		["w", "full"],
		["h", "screen"],
		["size", "4"],
		["min-w", "0"],
		["max-w", "lg"],
		["text", "lg"],
		["font", "bold"],
		["leading", "tight"],
		["tracking", "wide"],
		["bg", "paper"],
		["text-theme-500", null],
		["border-theme-300", null],
		["outline-theme-500", null],
		["fill-theme-500", null],
		["stroke-theme-500", null],
		["flex", null],
		["grid", null],
		["hidden", null],
		["relative", null],
		["items-center", null],
		["justify-between", null],
		["z", "10"],
		["overflow-hidden", null],
		["border", null],
		["rounded", "lg"],
		["outline", null],
		["divide-y", null],
		["shadow", "lg"],
		["opacity", "50"],
		["blur", "md"],
		["duration", "300"],
		["translate-x", "4"],
		["rotate", "45"],
		["scale", "75"],
		["transition", null],
		["animate-spin", null],
		["fade-in", null],
		["zoom-in", null],
	];

	it("every sample utility's first segment is in PREFIX_DISPATCH", () => {
		const missing: string[] = [];
		for (const [utility, value] of sampleUtilities) {
			const r = resolveUtility(utility, value, false, theme);
			if (!r) continue;
			const dashIdx = utility.indexOf("-");
			const firstSegment = dashIdx === -1 ? utility : utility.slice(0, dashIdx);
			if (!PREFIX_DISPATCH.has(firstSegment)) {
				missing.push(`${utility}${value ? `-${value}` : ""} (prefix: "${firstSegment}")`);
			}
		}
		expect(missing).toEqual([]);
	});

	it("every sample utility actually resolves", () => {
		const unresolved: string[] = [];
		for (const [utility, value] of sampleUtilities) {
			const r = resolveUtility(utility, value, false, theme);
			if (!r) unresolved.push(`${utility}${value ? `-${value}` : ""}`);
		}
		expect(unresolved).toEqual([]);
	});

	it("every STATIC_UTILITIES entry resolves via the engine", () => {
		const unresolved: string[] = [];
		for (const staticName of STATIC_UTILITIES) {
			const r = resolveUtility(staticName, null, false, theme);
			if (!r) unresolved.push(staticName);
		}
		expect(unresolved).toEqual([]);
	});

	it("dispatched resolution matches static utility coverage", () => {
		const mismatches: string[] = [];
		for (const staticName of STATIC_UTILITIES) {
			const dashIdx = staticName.indexOf("-");
			const firstSegment = dashIdx === -1 ? staticName : staticName.slice(0, dashIdx);
			if (!PREFIX_DISPATCH.has(firstSegment)) continue;
			const dispatched = resolveUtility(staticName, null, false, theme);
			if (!dispatched) {
				mismatches.push(
					`${staticName} — dispatched to null despite prefix "${firstSegment}" being registered`,
				);
			}
		}
		expect(mismatches).toEqual([]);
	});
});
