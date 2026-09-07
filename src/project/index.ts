import { dirname } from "node:path";
import { extractClassesFromSource } from "../scanner/class-extraction.js";
import { resolveGoogleFonts } from "../integrations/font-providers/index.js";
import { pushWarningsDeduped } from "../warnings.js";
import { inlineDirectiveImports, type ImportResolver } from "./imports.js";
import { createNodeImportResolver } from "./resolve-import.js";
import {
	analyzeProjectCSSMemo,
	finalizeProjectCompilation,
	type FinalizeProjectResult,
	type FontResolver,
} from "./pipeline.js";

export interface SourceEntry {
	path?: string;
	content: string;
}

export interface CompileProjectOptions {
	css: string;
	sources?: Iterable<SourceEntry>;
	classNames?: Iterable<string>;
	resolveFonts?: FontResolver;
	processCssFunctions?: boolean;
	/** Path of the CSS entry — the base for relative `@import` specifiers. */
	cssPath?: string;
	/**
	 * How `@import` specifiers become files, so directives in imported files
	 * are read. Defaults to the filesystem once `cssPath` says where the entry
	 * lives; with neither, imports pass through untouched as they always have.
	 * Pass `null` to keep that behavior even when `cssPath` is set.
	 */
	resolveImport?: ImportResolver | null;
}

/** compileProject returns the pipeline result unmodified — one shape, two names. */
export type CompileProjectResult = FinalizeProjectResult;

export async function compileProject(
	options: CompileProjectOptions,
): Promise<CompileProjectResult> {
	// Only inline when the caller gave us a way to: a bare CSS string with no
	// path has no base a relative specifier could resolve against.
	const resolveImport =
		options.resolveImport === undefined
			? options.cssPath === undefined
				? null
				: createNodeImportResolver({ cwd: dirname(options.cssPath) })
			: options.resolveImport;
	const inlined =
		resolveImport === null
			? { css: options.css, warnings: [] as string[] }
			: inlineDirectiveImports(options.css, { resolve: resolveImport, from: options.cssPath });

	const analysis = analyzeProjectCSSMemo(inlined.css);
	pushWarningsDeduped(
		analysis.warnings,
		inlined.warnings,
		analysis.warningSeen,
		analysis.suppressed,
	);
	const classNames = new Set<string>();
	// A caller-supplied list is authored; `sources` content is scanned text.
	if (options.classNames) {
		for (const cls of options.classNames) {
			classNames.add(cls);
		}
	}
	const authored = new Set(classNames);
	if (options.sources) {
		const extractionWarnings: string[] = [];
		for (const source of options.sources) {
			for (const cls of extractClassesFromSource(source, extractionWarnings)) {
				classNames.add(cls);
			}
		}
		pushWarningsDeduped(
			analysis.warnings,
			extractionWarnings,
			analysis.warningSeen,
			analysis.suppressed,
		);
	}
	return finalizeProjectCompilation({
		css: inlined.css,
		cssPath: options.cssPath,
		classNames,
		authoredClassNames: authored,
		analysis,
		// Default to resolving google font weights so headless callers aren't silently
		// stuck with "100 900" defaults; opt out with RI_OFFLINE / RI_FETCH_FONTS.
		resolveFonts: options.resolveFonts ?? resolveGoogleFonts,
		processCssFunctions: options.processCssFunctions,
	});
}
