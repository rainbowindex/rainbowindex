import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { analyzeProjectCSS } from "../../src/project/analyze.js";
import { processApply } from "../../src/integrations/postcss/apply.js";
import type { ResolvedTheme } from "../../src/directives/foundation.js";

const CIRCULAR = `@utility one { color: red; @apply two; }
@utility two { color: blue; @apply one; }`;

function run(theme: ResolvedTheme, css: string): { css: string; warnings: string[] } {
	const root = postcss.parse(css);
	const warnings: string[] = [];
	processApply(root, theme, warnings);
	return { css: root.toString(), warnings };
}

describe("@apply cross-rebuild theme cache", () => {
	it("repeats identical output and warnings on a rerun with the same theme", () => {
		const theme = analyzeProjectCSS(CIRCULAR).theme;
		const css = ".x { @apply flex nope one hover:px-4; }";
		const first = run(theme, css);
		const second = run(theme, css);
		// The second run is served from the theme-keyed cache — expansion and
		// per-occurrence warning replay must be indistinguishable from a cold run.
		expect(second.css).toBe(first.css);
		expect(second.warnings).toEqual(first.warnings);
		expect(first.css).toContain("display: flex");
		expect(first.warnings.some((w) => w.includes('Unknown utility "nope"'))).toBe(true);
		expect(first.warnings.some((w) => w.includes("[RI-1005]") && w.includes("Circular"))).toBe(
			true,
		);
	});

	it("replays body-walk warnings for a class first seen on a later rebuild", () => {
		const theme = analyzeProjectCSS(CIRCULAR).theme;
		run(theme, ".a { @apply one; }");
		// "hover:one" is a fresh cache entry hitting an already-walked utility —
		// the cached walk warnings must reach it, or a rebuild that drops ".a"
		// would silently lose the circularity diagnostic.
		const later = run(theme, ".b { @apply hover:one; }");
		expect(later.warnings.some((w) => w.includes("[RI-1005]") && w.includes("Circular"))).toBe(
			true,
		);
	});

	it("does not reuse the cache across different themes", () => {
		const red = analyzeProjectCSS("@utility tab { color: red; }").theme;
		const blue = analyzeProjectCSS("@utility tab { color: blue; }").theme;
		expect(run(red, ".x { @apply tab; }").css).toContain("color: red");
		expect(run(blue, ".x { @apply tab; }").css).toContain("color: blue");
	});
});
