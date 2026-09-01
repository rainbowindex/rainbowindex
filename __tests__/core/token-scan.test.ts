import { describe, expect, it } from "vitest";
import { analyzeProjectCSS, finalizeProjectCompilation } from "../../src/project/pipeline.js";

describe("token-scan", () => {
	// No type scale ships, so every text-token check defines its own @text size.
	const TEXT = `@text { lg: 1.25rem, 1.4; }`;

	it("emits --text-lg when user CSS references var(--text-lg)", async () => {
		const css = `@source "none";\n${TEXT}\nbody { font-size: var(--text-lg); }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: [], analysis });
		expect(result.css).toContain("--text-lg:");
	});

	it("emits --font-sans when preflight core is enabled", async () => {
		const css = `@source "none";\n@font { sans: "Onest" from google; }`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: [], analysis });
		expect(result.css).toContain("--font-sans:");
	});

	it("emits --text-lg when utility class text-lg is used", async () => {
		const css = `@source "none";\n${TEXT}`;
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: ["text-lg"], analysis });
		expect(result.css).toContain("--text-lg:");
	});

	it("emits --font-sans and --text-lg with @font + user CSS referencing both", async () => {
		const css = [
			`@source "none";`,
			TEXT,
			`@font { sans: "Onest" from google; mono: "Anonymous Pro" from google; }`,
			`body { font-family: var(--font-sans); font-size: var(--text-lg); line-height: var(--text-lg-leading); }`,
		].join("\n");
		const analysis = analyzeProjectCSS(css);
		const result = await finalizeProjectCompilation({ css, classNames: [], analysis });
		expect(result.css).toContain("--font-sans:");
		expect(result.css).toContain("--text-lg:");
		expect(result.css).toContain("--text-lg-leading:");
	});
});
