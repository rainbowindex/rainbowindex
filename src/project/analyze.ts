/**
 * Theme-only project analysis — the cheap front half of compileProject.
 *
 * Kept in a leaf module (no assembly/font machinery in the import graph) so
 * IO-free consumers — the `rainbowindex/editor` entry — can turn a CSS input
 * string into a ResolvedTheme without dragging Node-only code along.
 * `project/pipeline.ts` re-exports this module, so existing importers are
 * unaffected.
 */

import {
	extractDirectives,
	resolveDirectives,
	type DirectiveCapture,
	type ParsedDirective,
	type ResolvedTheme,
} from "../directives/index.js";
import { diagnosticFromWarning, type Diagnostic } from "../diagnostics.js";
import { pushWarningsDeduped } from "../warnings.js";
import { parseFileDisables, parseNextLinePragmas } from "../directives/suppress.js";

export interface ProjectAnalysis {
	directives: ParsedDirective[];
	theme: ResolvedTheme;
	warnings: string[];
	warningSeen: Set<string>;
	/**
	 * Structured view of `warnings` — same messages, same order
	 * (`diagnostics[i].message === warnings[i]`), each with the parsed code,
	 * range-derived severity, and a [start, end) span into the CSS input when
	 * the emitter knew one: directive-parse problems point at the offending
	 * at-rule, resolver problems at the directive whose body produced them.
	 */
	diagnostics: Diagnostic[];
	/**
	 * Codes silenced for the whole entry by `/* ri-disable … *\/`. Later stages
	 * push through this so a code the author hid never reaches the caller —
	 * scanner and compile warnings included, which no stylesheet comment could
	 * reach by position.
	 */
	suppressed: ReadonlySet<string>;
}

/**
 * Directive indexes guarded by a `ri-disable-next-line` comment that sits
 * outside every directive body.
 *
 * A pragma inside a body is not ours: the resolver already applied it to the
 * single entry that followed it, which is finer than anything reachable here.
 * What is left guards the directive that starts next, because that at-rule's
 * span is the only position a resolver warning carries.
 *
 * Reading the whole entry is also what makes a top-level pragma's RI-1040
 * reachable: the resolver only ever sees directive bodies. An in-body pragma is
 * read twice, so its RI-1040 arrives here too — identical text, which
 * `pushWarningsDeduped` collapses against the resolver's copy.
 */
function nextLineTargets(
	css: string,
	spans: ReadonlyArray<readonly [number, number] | undefined>,
	warnings: string[],
): Map<number, Set<string>> {
	const targets = new Map<number, Set<string>>();
	for (const pragma of parseNextLinePragmas(css, warnings)) {
		let inBody = false;
		for (const span of spans) {
			if (span && pragma.start >= span[0] && pragma.start < span[1]) {
				inBody = true;
				break;
			}
		}
		if (inBody) continue;
		let best = -1;
		let bestStart = Number.POSITIVE_INFINITY;
		for (let i = 0; i < spans.length; i++) {
			const span = spans[i];
			if (span && span[0] >= pragma.end && span[0] < bestStart) {
				bestStart = span[0];
				best = i;
			}
		}
		if (best === -1) continue;
		let codes = targets.get(best);
		if (codes === undefined) {
			codes = new Set();
			targets.set(best, codes);
		}
		codes.add(pragma.code);
	}
	return targets;
}

/**
 * Single-entry analysis memo — watch/HMR rebuilds triggered by source edits
 * re-enter with byte-identical CSS, and re-analyzing would mint a fresh theme
 * object each build, missing every theme-identity-keyed cache downstream
 * (custom-utility maps, variant maps, the per-class compile memo). The theme
 * and directives keep their identity; `warnings`/`warningSeen`/`diagnostics`
 * are mutated by callers, so fresh containers are cloned out per call.
 *
 * Every repeat-compile surface goes through this — the scanned path behind the
 * PostCSS/Vite/CLI builds, and the headless compileProject().
 */
let lastAnalysis: { css: string; analysis: ProjectAnalysis } | null = null;

export function analyzeProjectCSSMemo(css: string): ProjectAnalysis {
	if (lastAnalysis === null || lastAnalysis.css !== css) {
		lastAnalysis = { css, analysis: analyzeProjectCSS(css) };
	}
	const cached = lastAnalysis.analysis;
	return {
		...cached,
		warnings: [...cached.warnings],
		warningSeen: new Set(cached.warningSeen),
		diagnostics: [...cached.diagnostics],
	};
}

export function analyzeProjectCSS(css: string): ProjectAnalysis {
	const parseWarnings: string[] = [];
	const capture: Required<DirectiveCapture> = {
		directiveSpans: [],
		warningSpans: new Map(),
	};
	const directives = extractDirectives(css, parseWarnings, capture);
	const attribution: number[] = [];
	const theme = resolveDirectives(directives, attribution);
	const suppressed = parseFileDisables(css, parseWarnings);
	const targets = nextLineTargets(css, capture.directiveSpans, parseWarnings);
	const warningSeen = new Set<string>(theme.warnings);
	const warnings = [...theme.warnings];
	pushWarningsDeduped(warnings, parseWarnings, warningSeen);

	// Spans, per entry of the final array. Its prefix is [...theme.warnings]
	// verbatim, so resolver warnings map by INDEX through `attribution` to
	// their source directive — identical messages from different directives
	// keep their own spans. The appended entries are deduped parse warnings,
	// which carry their emission-site span looked up by message.
	const kept: string[] = [];
	const diagnostics: Diagnostic[] = [];
	for (let i = 0; i < warnings.length; i++) {
		let span: readonly [number, number] | null = null;
		let directiveIndex: number | undefined;
		if (i < theme.warnings.length) {
			directiveIndex = i < attribution.length ? attribution[i] : undefined;
			if (directiveIndex !== undefined) {
				span = capture.directiveSpans[directiveIndex] ?? null;
			}
		} else {
			span = capture.warningSpans.get(warnings[i]) ?? null;
		}
		const diagnostic = diagnosticFromWarning(warnings[i], span);
		if (
			diagnostic.code !== null &&
			isDisabled(diagnostic, directiveIndex, suppressed, targets, capture)
		) {
			continue;
		}
		kept.push(warnings[i]);
		diagnostics.push(diagnostic);
	}
	// `warningSeen` still holds the dropped messages, which is what we want:
	// a silenced warning must not reappear when a later stage pushes it again.

	return { directives, theme, warnings: kept, warningSeen, diagnostics, suppressed };
}

/** True when a `ri-disable` comment covers this diagnostic. */
function isDisabled(
	diagnostic: Diagnostic,
	directiveIndex: number | undefined,
	suppressed: ReadonlySet<string>,
	targets: ReadonlyMap<number, Set<string>>,
	capture: Required<DirectiveCapture>,
): boolean {
	const code = diagnostic.code;
	if (code === null) return false;
	if (suppressed.has(code)) return true;
	if (directiveIndex !== undefined) return targets.get(directiveIndex)?.has(code) === true;
	// A parse warning carries its own span rather than a directive index, so the
	// guarded directive is found by containment.
	if (diagnostic.start === null) return false;
	for (const [index, codes] of targets) {
		const span = capture.directiveSpans[index];
		if (!span || !codes.has(code)) continue;
		if (diagnostic.start >= span[0] && diagnostic.start < span[1]) return true;
	}
	return false;
}
