import { extractClassesFromSource } from "../scanner/index.js";
import { resolveGoogleFonts } from "../integrations/font-providers/index.js";
import { pushWarningsDeduped } from "../warnings.js";
import {
	analyzeProjectCSS,
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
}

/** compileProject returns the pipeline result unmodified — one shape, two names. */
export type CompileProjectResult = FinalizeProjectResult;

export async function compileProject(
	options: CompileProjectOptions,
): Promise<CompileProjectResult> {
	const analysis = analyzeProjectCSS(options.css);
	const classNames = new Set<string>();
	if (options.classNames) {
		for (const cls of options.classNames) {
			classNames.add(cls);
		}
	}
	if (options.sources) {
		const extractionWarnings: string[] = [];
		for (const source of options.sources) {
			for (const cls of extractClassesFromSource(source, extractionWarnings)) {
				classNames.add(cls);
			}
		}
		pushWarningsDeduped(analysis.warnings, extractionWarnings, analysis.warningSeen);
	}
	return finalizeProjectCompilation({
		css: options.css,
		classNames,
		analysis,
		// Default to resolving google font weights so headless callers aren't silently
		// stuck with "100 900" defaults; opt out with RI_OFFLINE / RI_FETCH_FONTS.
		resolveFonts: options.resolveFonts ?? resolveGoogleFonts,
		processCssFunctions: options.processCssFunctions,
	});
}
