/**
 * Oxlint plugin for Rainbow Index projects.
 *
 * Oxlint loads a JS plugin by module specifier and reads its default export,
 * so this entry keeps a default export even though the rest of the package
 * prefers named ones. Register it from a Vite+ `vite.config.ts`:
 *
 * ```ts
 * export default defineConfig({
 * 	lint: {
 * 		jsPlugins: [{ name: "rainbowindex", specifier: "rainbowindex/oxlint" }],
 * 		rules: { "rainbowindex/prefer-ri": "error" },
 * 	},
 * });
 * ```
 *
 * The types below describe only the slice of the Oxlint rule API this plugin
 * touches. They are declared here rather than imported from `@oxlint/plugins`
 * because that package is a transitive dependency of Oxlint that a consumer
 * cannot resolve, and its `definePlugin` / `defineRule` helpers are identity
 * functions with no runtime behavior to reuse.
 */

interface ImportDeclarationNode {
	source: { value: string };
}

interface RuleContext {
	report(diagnostic: { message: string; node: ImportDeclarationNode }): void;
}

interface RuleVisitor {
	ImportDeclaration(node: ImportDeclarationNode): void;
}

export interface OxlintRule {
	meta: { type: "suggestion"; docs: { description: string } };
	create(context: RuleContext): RuleVisitor;
}

export interface OxlintPlugin {
	meta: { name: string };
	rules: Record<string, OxlintRule>;
}

/**
 * Packages `ri()` replaces, and the job each one does. A project that keeps
 * one of them merges classes with a table of Tailwind utilities, so it
 * resolves conflicts against the wrong utility set: every RI-only utility is
 * unknown to it, and a theme change never reaches it.
 */
const REPLACED_PACKAGES: Readonly<Record<string, string>> = {
	clsx: "composes conditional classes",
	classnames: "composes conditional classes",
	"tailwind-merge": "resolves class conflicts",
};

/** The bare package name of an import specifier, without any subpath. */
function packageName(specifier: string): string {
	return specifier.startsWith("@")
		? specifier.split("/").slice(0, 2).join("/")
		: (specifier.split("/")[0] ?? "");
}

export const preferRiRule: OxlintRule = {
	meta: {
		type: "suggestion",
		docs: { description: "Merge class names with ri() from rainbowindex." },
	},
	create(context) {
		return {
			ImportDeclaration(node) {
				const name = packageName(node.source.value);
				const job = REPLACED_PACKAGES[name];
				if (!job) return;
				context.report({
					message: `Import { ri } from "rainbowindex" instead of "${name}". ri() ${job}, and it reads the same theme the compiler emits.`,
					node,
				});
			},
		};
	},
};

export const plugin: OxlintPlugin = {
	meta: { name: "rainbowindex" },
	rules: { "prefer-ri": preferRiRule },
};

export default plugin;
