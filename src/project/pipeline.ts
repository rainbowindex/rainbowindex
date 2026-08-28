import {
	APPLY_LIKE_MATCH_RE,
	type ParsedDirective,
	type ResolvedTheme,
} from "../directives/index.js";
import type { ProjectAnalysis } from "./analyze.js";

export { analyzeProjectCSS } from "./analyze.js";
export type { ProjectAnalysis } from "./analyze.js";
import {
	createCompiler,
	compileCSSFunctions,
	hasCSSFunctions,
	scanCSSForTokenUsage,
} from "../engine/index.js";
import { stripRIDirectives } from "../css/strip.js";
import { assembleSections } from "../assembly.js";
import { expandVariantGroups } from "../scanner/class-extraction.js";
import { pushWarningsDeduped } from "../warnings.js";

export type FontResolver = (
	fonts: ResolvedTheme["fonts"],
) => Promise<ResolvedTheme["fonts"]> | ResolvedTheme["fonts"];

export interface FinalizeProjectOptions {
	css: string;
	classNames: Iterable<string>;
	/** Classes the user wrote by hand. Omit to treat every class as authored. */
	authoredClassNames?: ReadonlySet<string>;
	analysis: ProjectAnalysis;
	resolveFonts?: FontResolver;
	processCssFunctions?: boolean;
}

export interface FinalizeProjectResult {
	css: string;
	/** Generated output only — user CSS is carried separately in `userCSS`. */
	sections: string[];
	/** The user's own CSS (RI directives stripped), appended after `sections` in `css`. */
	userCSS: string;
	classNames: string[];
	theme: ResolvedTheme;
	directives: ParsedDirective[];
	warnings: string[];
}

function collectApplyClassNames(css: string, warnings: string[]): string[] {
	const classes: string[] = [];
	for (const match of css.matchAll(APPLY_LIKE_MATCH_RE)) {
		const params = expandVariantGroups(match[1], warnings);
		for (const className of params.trim().split(/\s+/)) {
			if (className) classes.push(className);
		}
	}

	return classes;
}

/** Effective-theme memo: same pre-scan theme + same resolved-fonts identity →
 *  same effective theme object across rebuilds, so theme-identity-keyed caches
 *  (variant maps, per-class compile memo) survive even when Google metadata
 *  narrowed the font defaults. refreshFontWeightDefaults memoizes its output
 *  per (fonts, metadata-state), so the identity check here is sound. */
const effectiveThemeMemo = new WeakMap<
	ResolvedTheme,
	{ fonts: ResolvedTheme["fonts"]; theme: ResolvedTheme }
>();

export async function finalizeProjectCompilation(
	options: FinalizeProjectOptions,
): Promise<FinalizeProjectResult> {
	const { analysis } = options;
	let effectiveTheme = analysis.theme;

	if (options.resolveFonts) {
		const resolvedFonts = await options.resolveFonts(analysis.theme.fonts);
		// resolveGoogleFonts returns the same array when there are no google slots —
		// only rebuild the theme (and bust identity-keyed caches) when fonts changed.
		if (resolvedFonts !== analysis.theme.fonts) {
			const memo = effectiveThemeMemo.get(analysis.theme);
			if (memo && memo.fonts === resolvedFonts) {
				effectiveTheme = memo.theme;
			} else {
				effectiveTheme = { ...analysis.theme, fonts: [...resolvedFonts] };
				effectiveThemeMemo.set(analysis.theme, { fonts: resolvedFonts, theme: effectiveTheme });
			}
		}
	}

	const expansionWarnings: string[] = [];
	// Dedup without the throwaway concat array — Set takes the iterables directly.
	const classNameSet = new Set(options.classNames);
	// A class written in `@apply` is authored by definition, so it joins the
	// authored set alongside the `@source inline(...)` names.
	const authored = options.authoredClassNames && new Set(options.authoredClassNames);
	for (const cls of collectApplyClassNames(options.css, expansionWarnings)) {
		classNameSet.add(cls);
		authored?.add(cls);
	}
	const classNames = [...classNameSet];
	pushWarningsDeduped(analysis.warnings, expansionWarnings, analysis.warningSeen);
	const compiler = createCompiler();
	const compilation = compiler.compile(classNames, effectiveTheme, authored);

	// Scan user CSS for token references (e.g. var(--text-lg), var(--font-sans))
	// before assembly so the token layer includes variables referenced by user CSS.
	let userCSS = stripRIDirectives(options.css);
	if ((options.processCssFunctions ?? true) && userCSS && hasCSSFunctions(userCSS)) {
		userCSS = compileCSSFunctions(userCSS, effectiveTheme, analysis.warnings);
	}
	if (userCSS) {
		scanCSSForTokenUsage(userCSS, compilation);
	}

	const { sections, warnings: assemblyWarnings } = assembleSections(
		compilation,
		effectiveTheme,
		compiler.fontOutputCache,
	);

	pushWarningsDeduped(analysis.warnings, assemblyWarnings, analysis.warningSeen);
	pushWarningsDeduped(analysis.warnings, compilation.warnings, analysis.warningSeen);

	// The PostCSS plugin consumes `sections`/`userCSS` and never reads `css`,
	// so the full join is computed lazily (at most once) for the CLI/headless
	// consumers that do.
	let joinedCSS: string | null = null;
	return {
		get css(): string {
			if (joinedCSS === null) {
				joinedCSS = userCSS ? [...sections, userCSS].join("\n\n") : sections.join("\n\n");
			}
			return joinedCSS;
		},
		sections,
		userCSS,
		classNames,
		theme: effectiveTheme,
		directives: analysis.directives,
		warnings: analysis.warnings,
	};
}
