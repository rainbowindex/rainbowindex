/**
 * Class inspector — single-class validation and explanation for editor
 * tooling, running the exact resolution the compile loop performs.
 *
 * The compiler intentionally drops unknown utilities silently (reserved
 * RI-1001): the build scanner over-collects, so at build time an unresolved
 * candidate is usually noise. Inside an editor the certainty is inverted — a
 * token in a class attribute is meant to be a class — so the inspector
 * finally gives RI-1001 a voice: `validate()` reports WHY a class produces no
 * CSS, with a typo suggestion when one is close enough.
 *
 * An inspector instance owns the per-theme caches the compile loop rebuilds
 * per pass (custom-variant map, variant memo, breakpoint weights) plus a
 * resolution cache, so per-keystroke validation of the same classes is cheap.
 * Create one per theme and drop it when the theme changes.
 */

import type { ResolvedTheme } from "../directives/foundation.js";
import { enumerateClassNames } from "../utilities/enumerate.js";
import { STATIC_UTILITIES } from "../utilities/metadata.js";
import { parseUtility, type ParsedUtility } from "../utilities/parser.js";
import type { CSSDeclaration } from "../utilities/helpers.js";
import { buildBreakpointWeights } from "./ordering.js";
import { findClosest } from "./suggest.js";
import { listVariants, type VariantInfo, type VariantWrapper } from "./variants.js";
import {
	compileUtility,
	createEmptyCompilationResult,
	type ClassResolutionDetail,
} from "./index.js";

export type ClassValidation =
	| { ok: true }
	| {
			ok: false;
			reason: "unknown-utility" | "unknown-variant" | "invalid-arbitrary";
			/** The failing fragment — the variant for "unknown-variant", the
			 *  base class (variants stripped) otherwise. */
			offender: string;
			/** Closest known name within typo distance, when one exists. */
			suggestion?: string;
	  };

export interface ClassExplanation {
	parsed: ParsedUtility;
	/** Root declarations before variant wrapping. */
	declarations: CSSDeclaration[];
	/** Escaped selector, including variant suffixes (`.hover\:px-2:hover`). */
	selector: string;
	/** The complete rule text, including wrapping at-rules. */
	css: string;
	/** Deterministic ordering key — lower emits earlier in generated CSS. */
	sortKey: number;
}

export interface ClassInspector {
	readonly theme: ResolvedTheme;
	/** Would this class produce CSS under the theme? Reports why not. */
	validate(className: string): ClassValidation;
	/** Structured breakdown + generated CSS, or null when invalid. */
	explain(className: string): ClassExplanation | null;
	/** Every variant the theme resolves (cached). */
	variants(): readonly VariantInfo[];
}

/** Resolution outcomes cached per class string. Cleared wholesale at the cap
 *  — an editor session rarely sees this many unique candidates, and clearing
 *  beats an LRU's per-hit bookkeeping for a cache that almost never fills. */
const RESOLUTION_CACHE_CAP = 10_000;

const OK: ClassValidation = Object.freeze({ ok: true });

interface CachedResolution {
	validation: ClassValidation;
	explanation: ClassExplanation | null;
}

export function createClassInspector(theme: ResolvedTheme): ClassInspector {
	const customVariantMap = new Map(theme.customVariants.map((cv) => [cv.name, cv] as const));
	const breakpointWeights = buildBreakpointWeights(theme.breakpoints);
	const variantMemo = new Map<string, VariantWrapper | null>();
	// Warning/token bookkeeping sink — compileUtility needs one; discarded.
	const scratch = createEmptyCompilationResult();
	const warnSeen = new Set<string>();
	const detail: ClassResolutionDetail = { reason: null, variant: null, declarations: null };
	const cache = new Map<string, CachedResolution>();

	let variantList: readonly VariantInfo[] | null = null;
	let variantNames: string[] | null = null;
	let utilityCorpus: string[] | null = null;

	function variants(): readonly VariantInfo[] {
		if (!variantList) variantList = Object.freeze(listVariants(theme));
		return variantList;
	}

	/** Concrete variant names — pattern families can't be typo targets. */
	function variantSuggestionCorpus(): string[] {
		if (!variantNames) {
			const names: string[] = [];
			for (const v of variants()) {
				if (v.kind !== "pattern") names.push(v.name);
			}
			variantNames = names;
		}
		return variantNames;
	}

	/** Whole-name suggestion corpus: built-in statics + custom static
	 *  utilities + the enumerated completion universe, so value typos
	 *  (bg-blu-500) suggest their concrete neighbor. Built lazily on the first
	 *  unknown-utility miss — enumeration walks the whole value-space table —
	 *  and kept for the inspector's lifetime, which is one theme by contract. */
	function utilitySuggestionCorpus(): string[] {
		if (!utilityCorpus) {
			const names = new Set<string>(STATIC_UTILITIES);
			for (const custom of theme.customUtilities) {
				if (!custom.functional) names.add(custom.name);
			}
			for (const entry of enumerateClassNames(theme).classes) names.add(entry.name);
			utilityCorpus = [...names];
		}
		return utilityCorpus;
	}

	/** The class minus its variant prefix and important suffix — what the
	 *  utility resolver actually saw, reconstructed from the parse. */
	function baseName(raw: string, parsed: ParsedUtility): string {
		let base = raw;
		if (parsed.variants.length > 0) {
			const prefix = `${parsed.variants.join(":")}:`;
			if (base.startsWith(prefix)) base = base.slice(prefix.length);
		}
		if (parsed.important && base.endsWith("!")) base = base.slice(0, -1);
		return base;
	}

	function resolve(className: string): CachedResolution {
		const cached = cache.get(className);
		if (cached) return cached;
		if (cache.size >= RESOLUTION_CACHE_CAP) {
			cache.clear();
			// Arbitrary variants ([&>p], min-[437px]) form an unbounded memo
			// key family — recycle it with the cache so neither outlives the cap.
			variantMemo.clear();
		}
		// The scratch sink only exists to satisfy compileUtility's signature.
		// Reset per resolution: direct generator pushes (RI-1501/1502 bypass
		// the dedup budget) would otherwise accumulate for the inspector's
		// lifetime across a long editor session.
		scratch.warnings.length = 0;
		warnSeen.clear();

		const parsed = parseUtility(className);
		const rule = compileUtility(
			parsed,
			theme,
			scratch,
			customVariantMap,
			warnSeen,
			breakpointWeights,
			variantMemo,
			detail,
		);

		let entry: CachedResolution;
		if (rule) {
			entry = {
				validation: OK,
				explanation: {
					parsed,
					declarations: detail.declarations ? [...detail.declarations] : [],
					selector: rule.selector,
					css: rule.css,
					sortKey: rule.sortKey,
				},
			};
		} else if (detail.reason === "unknown-variant" && detail.variant !== null) {
			const suggestion = findClosest(detail.variant, variantSuggestionCorpus());
			entry = {
				validation: {
					ok: false,
					reason: "unknown-variant",
					offender: detail.variant,
					...(suggestion ? { suggestion } : {}),
				},
				explanation: null,
			};
		} else {
			const base = baseName(className, parsed);
			// Same distinction the compile loop's RI-1002 heuristic draws:
			// bracket syntax that failed to resolve is a malformed arbitrary
			// value, not a typo'd utility name.
			if (parsed.arbitrary || parsed.arbitraryProperty !== null) {
				entry = {
					validation: { ok: false, reason: "invalid-arbitrary", offender: base },
					explanation: null,
				};
			} else {
				const suggestion = findClosest(base, utilitySuggestionCorpus());
				entry = {
					validation: {
						ok: false,
						reason: "unknown-utility",
						offender: base,
						...(suggestion ? { suggestion } : {}),
					},
					explanation: null,
				};
			}
		}

		cache.set(className, entry);
		return entry;
	}

	return {
		theme,
		validate: (className) => resolve(className).validation,
		explain: (className) => resolve(className).explanation,
		variants,
	};
}
