/**
 * The theme-aware lint rules, in the shape ESLint reads.
 *
 * `rainbowindex/eslint` is a flat-config plugin object:
 *
 * ```js
 * // eslint.config.js
 * import rainbowindex from "rainbowindex/eslint";
 *
 * export default [
 * 	{
 * 		files: ["src/**\/*.{js,jsx,ts,tsx}"],
 * 		plugins: { rainbowindex },
 * 		rules: {
 * 			"rainbowindex/no-unknown-class": "error",
 * 			"rainbowindex/no-conflicting-classes": "warn",
 * 		},
 * 	},
 * ];
 * ```
 *
 * The rules themselves are shared with `rainbowindex/oxlint`; only the
 * packaging differs. Both find the project's CSS entry on their own — pass
 * `{ css: "styles/app.css" }` as the rule's option when it lives somewhere the
 * candidate list does not look.
 */

export { noConflictingClassesRule, noUnknownClassRule, rules } from "./rules.js";
export type {
	LintContext,
	LintFix,
	LintFixer,
	LintLoc,
	LintReport,
	LintRule,
	LintSourceCode,
	LintSuggestion,
	LintVisitor,
} from "./rules.js";
export { clearSessionCache, findCSSEntry, getSession } from "./theme.js";
export type { ThemeSourceOptions as ThemeLintOptions } from "./theme.js";

import { rules } from "./rules.js";

/** The flat-config plugin object. `plugins: { rainbowindex }`. */
export const plugin = {
	meta: { name: "rainbowindex" },
	rules,
};

export default plugin;
