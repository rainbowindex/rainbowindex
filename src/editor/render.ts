/**
 * `renderStylesheet` — a theme plus a class list in, a stylesheet out.
 *
 * The rest of `rainbowindex/editor` answers questions *about* classes:
 * is this one valid, what does it mean, what could you type next. This one
 * produces the artifact itself, which is what a playground, a docs example,
 * and a "show me the generated CSS" hover all need.
 *
 * It is the pure core of the build pipeline: the same `createCompiler()` and
 * `assembleSections()` the PostCSS plugin and the CLI run, with the two steps
 * that touch the world left out.
 *
 *   - **Fonts are not resolved.** `@font … from google` needs the Google
 *     metadata endpoint to narrow a family's weights, which is IO. The slot
 *     still emits its `@import` and its `--font-*` variable; only the weight
 *     narrowing is missing, so the sheet differs from a Node build only for a
 *     Google slot whose declared weights the provider would have trimmed.
 *   - **`@apply` is not expanded.** That rewrite is PostCSS's job — it edits
 *     the user's own rules in place — and pulling PostCSS in would double the
 *     weight of an entry that exists to stay small. An `@apply` left in
 *     `userCSS` passes through verbatim.
 *
 * Everything else — token pruning, `@property` registration, preflight,
 * `[data-theme]` overrides, rule ordering — is the production path.
 */

import { assembleSections } from "../assembly.js";
import { compileCSSFunctions, hasCSSFunctions } from "../css/functions.js";
import type { ResolvedTheme } from "../directives/foundation.js";
import { createCompiler, scanCSSForTokenUsage } from "../engine/index.js";

export interface RenderStylesheetOptions {
	/**
	 * Classes the user wrote by hand, when that is a subset of `classNames`.
	 * Diagnostics that would be noise for a generated class — an unknown
	 * utility inside a scanned template literal, say — are raised only for
	 * these. Omit to treat every class as authored.
	 */
	authoredClassNames?: ReadonlySet<string>;
	/**
	 * The project's own CSS, with RI directives already removed (the entry's
	 * `stripRIDirectives` does that). It is scanned for `var(--color-…)` and
	 * friends before assembly, so a token only the user's CSS names survives
	 * pruning, and it is appended to the output after the generated sections —
	 * the same order a real build emits.
	 */
	userCSS?: string;
}

export interface RenderedStylesheet {
	/** The generated sections and `userCSS`, joined as a build would emit them. */
	css: string;
	/** Generated output only, in canonical section order. */
	sections: string[];
	/** `userCSS` after `--ri-*` CSS functions were compiled, or "". */
	userCSS: string;
	/** Compile and assembly warnings, in `[RI-NNNN] message` form. */
	warnings: string[];
}

/**
 * Compile `classNames` against `theme` and assemble the stylesheet.
 *
 * Pure: no filesystem, no network, no module-level state. Two calls with the
 * same arguments return the same CSS, and concurrent calls cannot see each
 * other's fonts — the compiler owns its caches.
 */
export function renderStylesheet(
	theme: ResolvedTheme,
	classNames: Iterable<string>,
	options: RenderStylesheetOptions = {},
): RenderedStylesheet {
	const compiler = createCompiler();
	const compilation = compiler.compile([...classNames], theme, options.authoredClassNames);

	const warnings: string[] = [];
	let userCSS = options.userCSS ?? "";
	if (userCSS && hasCSSFunctions(userCSS)) {
		userCSS = compileCSSFunctions(userCSS, theme, warnings);
	}
	// Before assembly: the token layer prunes to what the build demands, and a
	// `var(--color-brand-500)` written by hand is demand like any other.
	if (userCSS) scanCSSForTokenUsage(userCSS, compilation);

	const assembled = assembleSections(compilation, theme, compiler.fontOutputCache);
	warnings.push(...assembled.warnings, ...compilation.warnings);

	const sections = assembled.sections;
	return {
		css: userCSS ? [...sections, userCSS].join("\n\n") : sections.join("\n\n"),
		sections,
		userCSS,
		warnings,
	};
}
