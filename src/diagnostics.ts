/**
 * Structured diagnostics — the typed view of the `[RI-NNNN] message` warning
 * strings, for editor tooling that anchors problems to source spans.
 *
 * The legacy string arrays stay the wire format everywhere (and the warning
 * budget/dedup in warnings.ts keeps operating on them); a Diagnostic carries
 * the same full message text verbatim, plus the parsed code, a severity
 * derived from the documented code-range convention, and — when the emission
 * site knew one — a [start, end) span into the CSS input. Consumers can rely
 * on `diagnostics[i].message === warnings[i]` wherever both are returned.
 */

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
	/** The RI-NNNN code, or null when the message carries no parseable code. */
	code: string | null;
	severity: DiagnosticSeverity;
	/** The full legacy warning text, including the `[RI-NNNN]` prefix. */
	message: string;
	/** [start, end) span in the analyzed CSS input, or null when unknown. */
	start: number | null;
	end: number | null;
}

const WARNING_CODE_RE = /^\[(RI-\d{4})\]/;

/** Extract the RI-NNNN code from a legacy warning string, or null. */
export function warningCode(message: string): string | null {
	const match = WARNING_CODE_RE.exec(message);
	return match ? match[1] : null;
}

/**
 * Severity by code range — the same convention warnings.ts budgets by:
 * RI-0xxx (fatal/bootstrap) and RI-2xxx (compile/runtime errors) are errors,
 * everything else (informational 1xxx ranges) is a warning.
 */
export function severityForCode(code: string | null): DiagnosticSeverity {
	if (code !== null && (code.startsWith("RI-0") || code.startsWith("RI-2"))) return "error";
	return "warning";
}

/** Wrap a legacy warning string as a Diagnostic, with an optional span. */
export function diagnosticFromWarning(
	message: string,
	span?: readonly [number, number] | null,
): Diagnostic {
	const code = warningCode(message);
	return {
		code,
		severity: severityForCode(code),
		message,
		start: span ? span[0] : null,
		end: span ? span[1] : null,
	};
}
