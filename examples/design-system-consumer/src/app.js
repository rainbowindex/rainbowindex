/**
 * The consumer's own code. Its classes come from two places:
 *
 *   - `brand-*`, which this project declared in `src/index.css`
 *   - the design system's components, whose classes live in `node_modules`
 *     and reach the build only through that package's `safelistSources`
 */

import { buttonClass, cardClass } from "@rainbowindex-example/design-system";

export function render() {
	return `
		<main class="min-h-screen bg-brand-50 p-8">
			<section class="${cardClass()}">
				<h1 class="text-2xl font-bold text-brand-700">Design system</h1>
				<!-- \`rounded-control\` is the package's named radius, written here by
				     hand. It proves the @import half on its own: this class is in the
				     consumer's own source, so the scanner always finds it, and it
				     compiles only if the package's directives were read. -->
				<p class="mt-2 rounded-control border border-brand-200 p-3 text-accent-700">
					Tokens from the package, used directly.
				</p>
				<div class="mt-4 flex gap-3">
					<button class="${buttonClass("solid")}">Solid</button>
					<button class="${buttonClass("quiet")}">Quiet</button>
				</div>
			</section>
		</main>
	`;
}
