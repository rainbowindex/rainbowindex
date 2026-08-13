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
	const warningSeen = new Set<string>(theme.warnings);
	const warnings = [...theme.warnings];
	pushWarningsDeduped(warnings, parseWarnings, warningSeen);

	// Spans, per entry of the final array. Its prefix is [...theme.warnings]
	// verbatim, so resolver warnings map by INDEX through `attribution` to
	// their source directive — identical messages from different directives
	// keep their own spans. The appended entries are deduped parse warnings,
	// which carry their emission-site span looked up by message.
	const diagnostics: Diagnostic[] = [];
	for (let i = 0; i < warnings.length; i++) {
		let span: readonly [number, number] | null = null;
		if (i < theme.warnings.length) {
			const directiveIndex = i < attribution.length ? attribution[i] : undefined;
			if (directiveIndex !== undefined) {
				span = capture.directiveSpans[directiveIndex] ?? null;
			}
		} else {
			span = capture.warningSpans.get(warnings[i]) ?? null;
		}
		diagnostics.push(diagnosticFromWarning(warnings[i], span));
	}

	return { directives, theme, warnings, warningSeen, diagnostics };
}
