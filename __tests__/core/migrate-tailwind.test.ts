/**
 * The Tailwind v4 migrator's translation half.
 *
 * The bar a migrator has to clear is not "it produced a file" but "the file it
 * produced compiles, and compiles to the same thing". So most of these assert
 * through the real compiler: translate, compile the result, and check that the
 * classes the original theme supported still resolve. A translation that
 * type-checks and emits a stylesheet nobody can build is the failure mode worth
 * testing for.
 *
 * The other half of the bar is honesty about what it cannot do. A migrator that
 * silently drops a plugin is worse than one that stops and says so, so every
 * unsupported construct has a test that it reaches the manual list.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { detectTailwind, migrateTailwindCSS } from "../../src/migrate/tailwind.js";
import { createClassInspector } from "../../src/engine/inspector.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";

/** Compile a migrated entry and return an inspector over its theme. */
function inspectorFor(css: string) {
	// The preset import cannot be resolved without a filesystem, so drop it:
	// these tests are about what the *translation* contributed.
	const withoutPreset = css.replace(/@import "rainbowindex\/tailwind\.css";\n?/, "");
	const analysis = analyzeProjectCSS(withoutPreset);
	return { inspector: createClassInspector(analysis.theme), analysis };
}

const found = (result: ReturnType<typeof migrateTailwindCSS>, needle: string): boolean =>
	result.manual.some((step) => step.found.includes(needle));

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe("detection", () => {
	test("recognises a v4 entry by its import", () => {
		const detected = detectTailwind({ css: '@import "tailwindcss";' });
		expect(detected.isTailwind).toBe(true);
		expect(detected.signals).toContain('@import "tailwindcss"');
	});

	test("recognises a v4 entry by @theme alone", () => {
		expect(detectTailwind({ css: "@theme { --color-brand: red; }" }).isTailwind).toBe(true);
	});

	test("recognises the package, not only the CSS", () => {
		const detected = detectTailwind({
			css: ".a { color: red; }",
			packageJson: { devDependencies: { "@tailwindcss/vite": "^4.0.0" } },
		});
		expect(detected.isTailwind).toBe(true);
		expect(detected.signals).toContain("@tailwindcss/vite in package.json");
	});

	test("reports a v3 config rather than trying to read it", () => {
		const detected = detectTailwind({
			css: '@import "tailwindcss";',
			files: ["package.json", "tailwind.config.ts"],
		});
		expect(detected.legacyConfig).toBe("tailwind.config.ts");
	});

	test("says no for a project that is not Tailwind", () => {
		expect(detectTailwind({ css: '@import "rainbowindex";' }).isTailwind).toBe(false);
	});

	test("a mention inside a comment is not a signal", () => {
		expect(detectTailwind({ css: '/* was @import "tailwindcss"; */' }).isTailwind).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Namespaces
// ---------------------------------------------------------------------------

describe("theme namespaces", () => {
	test("every mapped namespace produces classes that resolve", () => {
		const result = migrateTailwindCSS(`@import "tailwindcss";
@theme {
	--color-brand-500: oklch(0.66 0.21 329);
	--breakpoint-tablet: 48rem;
	--radius-card: 0.75rem;
	--shadow-card: 0 1px 2px rgb(0 0 0 / 0.1);
	--blur-soft: 6px;
	--ease-snap: cubic-bezier(0.2, 0, 0, 1);
	--font-weight-chunky: 850;
	--tracking-loose: 0.05em;
	--leading-airy: 2;
	--text-huge: 4rem;
	--spacing: 0.3rem;
}`);
		const { inspector } = inspectorFor(result.css);
		for (const className of [
			"bg-brand-500",
			"tablet:flex",
			"rounded-card",
			"shadow-card",
			"blur-soft",
			"ease-snap",
			"font-chunky",
			"tracking-loose",
			"leading-airy",
			"text-huge",
		]) {
			expect(inspector.validate(className), className).toEqual({ ok: true });
		}
	});

	test("the migrated stylesheet has no diagnostics of its own", () => {
		const result = migrateTailwindCSS(`@import "tailwindcss";
@theme { --color-brand-500: oklch(0.66 0.21 329); --radius-card: 0.75rem; }`);
		expect(inspectorFor(result.css).analysis.warnings).toEqual([]);
	});

	test("longest prefix wins: a weight is not a font", () => {
		const result = migrateTailwindCSS(
			"@theme { --font-display: Satoshi, sans-serif; --font-weight-chunky: 850; }",
		);
		const { inspector } = inspectorFor(result.css);
		expect(inspector.validate("font-display")).toEqual({ ok: true });
		expect(inspector.validate("font-chunky")).toEqual({ ok: true });
		// And neither leaked into the other's directive.
		expect(result.css).toMatch(/@weight \{[^}]*chunky/);
		expect(result.css).toMatch(/@font \{[^}]*display/);
	});

	test("a text size and its line height become one entry", () => {
		const result = migrateTailwindCSS(
			"@theme { --text-lg: 1.125rem; --text-lg--line-height: 1.75rem; }",
		);
		expect(result.css).toContain("lg: 1.125rem, 1.75rem;");
		expect(inspectorFor(result.css).inspector.validate("text-lg")).toEqual({ ok: true });
	});

	test("`--spacing` becomes the spacing base", () => {
		const result = migrateTailwindCSS("@theme { --spacing: 0.3rem; }");
		expect(result.css).toContain("@spacing {\n\tbase: 0.3rem;\n}");
	});

	test("an animation is joined to its keyframes", () => {
		const result = migrateTailwindCSS(`@theme { --animate-shimmer: shimmer 2s linear infinite; }
@keyframes shimmer { from { opacity: 0; } to { opacity: 1; } }`);
		expect(result.css).toContain("animation: shimmer 2s linear infinite;");
		expect(result.css).toContain("@keyframes shimmer {");
		expect(result.css).toContain("opacity: 0");
		expect(inspectorFor(result.css).inspector.validate("animate-shimmer")).toEqual({ ok: true });
	});

	test("an animation with no keyframes is reported, not emitted broken", () => {
		const result = migrateTailwindCSS("@theme { --animate-ghost: ghost 1s linear; }");
		expect(result.css).not.toContain("@animate");
		expect(found(result, "--animate-ghost")).toBe(true);
	});

	test("a namespace with no counterpart is reported with what to do", () => {
		const result = migrateTailwindCSS(`@theme {
	--drop-shadow-glow: 0 0 8px red;
	--perspective-near: 300px;
	--aspect-golden: 1.618;
	--container-prose: 40rem;
}`);
		expect(result.manual).toHaveLength(4);
		expect(result.manual.every((step) => step.action !== undefined)).toBe(true);
		expect(found(result, "--drop-shadow-glow")).toBe(true);
	});

	test("an unnamespaced custom property is carried into :root, not dropped", () => {
		const result = migrateTailwindCSS("@theme { --my-own-thing: 4px; }");
		expect(result.css).toContain(":root {\n\t--my-own-thing: 4px;\n}");
	});

	test("`--namespace-*: initial` is a no-op, because nothing ships a default scale", () => {
		const result = migrateTailwindCSS("@theme { --color-*: initial; --color-brand: red; }");
		expect(result.css).toContain("brand: red;");
		// The clearing entry itself produces no directive entry.
		expect(result.css).toMatch(/@color \{\n\tbrand: red;\n\}/);
	});
});

// ---------------------------------------------------------------------------
// At-rules
// ---------------------------------------------------------------------------

describe("at-rules", () => {
	test("the activation import is replaced, and the preset is added", () => {
		const result = migrateTailwindCSS('@import "tailwindcss";\n.a { color: red; }');
		expect(result.css).toContain('@import "rainbowindex";');
		expect(result.css).toContain('@import "rainbowindex/tailwind.css";');
		expect(result.css).not.toContain('@import "tailwindcss"');
	});

	test("a dark custom variant becomes the theme's dark strategy", () => {
		const result = migrateTailwindCSS(
			'@import "tailwindcss";\n@custom-variant dark (&:where(.dark, .dark *));',
		);
		expect(result.darkVariant).toBe("selector");
		expect(result.css).toContain("@color dark {\n\tvariant: selector(.dark);\n}");
		// And it is not also carried through as a custom variant, which would
		// fight the built-in `dark:`.
		expect(result.css).not.toContain("@custom dark");
	});

	test("a media-query dark variant is recognised as the default strategy", () => {
		const result = migrateTailwindCSS(
			"@custom-variant dark (@media (prefers-color-scheme: dark));",
		);
		expect(result.darkVariant).toBe("media");
		// `media` is already the default, so no dark block is emitted.
		expect(result.css).not.toContain("@color dark");
	});

	test("any other custom variant becomes @custom", () => {
		const result = migrateTailwindCSS("@custom-variant pointer-fine (@media (pointer: fine));");
		expect(result.css).toContain("@custom pointer-fine (@media (pointer: fine));");
		expect(inspectorFor(result.css).inspector.validate("pointer-fine:flex")).toEqual({ ok: true });
	});

	test("@utility and @source are carried through untouched", () => {
		const result = migrateTailwindCSS(`@import "tailwindcss";
@source "../components";
@utility card { padding: 1rem; }`);
		expect(result.css).toContain('@source "../components";');
		expect(result.css).toContain("@utility card { padding: 1rem; }");
		expect(inspectorFor(result.css).inspector.validate("card")).toEqual({ ok: true });
	});

	test("@plugin and @config are reported as manual", () => {
		const result = migrateTailwindCSS(`@plugin "@tailwindcss/typography";
@config "./tailwind.config.js";`);
		expect(result.manual).toHaveLength(2);
		expect(found(result, "@plugin")).toBe(true);
		expect(found(result, "@config")).toBe(true);
		// And neither survives into the output, where it would break the build.
		expect(result.css).not.toContain("@plugin");
		expect(result.css).not.toContain("@config");
	});

	test("`@theme inline` is flagged, because the emitted values differ", () => {
		const result = migrateTailwindCSS("@theme inline { --color-brand: red; }");
		expect(found(result, "@theme inline")).toBe(true);
		// The tokens still translate.
		expect(result.css).toContain("brand: red;");
	});

	test("the project's own rules survive, in source order", () => {
		const result = migrateTailwindCSS(`@import "tailwindcss";
@theme { --color-brand: red; }
.a { color: var(--color-brand); }
.b { color: blue; }`);
		expect(result.css.indexOf(".a")).toBeLessThan(result.css.indexOf(".b"));
		expect(result.css).toContain("color: var(--color-brand)");
	});
});

// ---------------------------------------------------------------------------
// A whole file
// ---------------------------------------------------------------------------

describe("a realistic entry", () => {
	const INPUT = `@import "tailwindcss";
@plugin "@tailwindcss/forms";
@custom-variant dark (&:where(.dark, .dark *));

@theme {
	--color-brand-500: oklch(0.66 0.21 329);
	--color-brand-700: oklch(0.49 0.15 329);
	--font-display: "Satoshi", sans-serif;
	--text-hero: 3rem;
	--text-hero--line-height: 1.1;
	--radius-card: 0.75rem;
	--breakpoint-tablet: 48rem;
	--drop-shadow-glow: 0 0 8px oklch(0.66 0.21 329);
	--animate-shimmer: shimmer 2s linear infinite;
}

@keyframes shimmer {
	from { background-position: 200% 0; }
	to { background-position: -200% 0; }
}

@utility card { border-radius: var(--radius-card); }

.prose { max-width: 65ch; }
`;

	test("translates every namespace it can and reports the rest", () => {
		const result = migrateTailwindCSS(INPUT);
		const directives = result.translated.map((t) => t.directive).sort();
		expect(directives).toEqual(["@animate", "@breakpoint", "@color", "@font", "@rounded", "@text"]);
		// Only the plugin and the drop-shadow namespace need a person.
		expect(result.manual.map((m) => m.found.split(":")[0].trim()).sort()).toEqual([
			"--drop-shadow-glow",
			'@plugin "@tailwindcss/forms"',
		]);
	});

	test("the result compiles with no warnings and keeps the classes working", () => {
		const { inspector, analysis } = inspectorFor(migrateTailwindCSS(INPUT).css);
		expect(analysis.warnings).toEqual([]);
		for (const className of [
			"bg-brand-500",
			"text-brand-700",
			"font-display",
			"text-hero",
			"rounded-card",
			"tablet:flex",
			"animate-shimmer",
			"card",
			"dark:bg-brand-700",
		]) {
			expect(inspector.validate(className), className).toEqual({ ok: true });
		}
	});

	test("running it twice changes nothing the second time", () => {
		// A migrator that is not idempotent is one nobody dares re-run.
		const once = migrateTailwindCSS(INPUT).css;
		const twice = migrateTailwindCSS(once).css;
		expect(twice).toBe(once);
	});
});

// ---------------------------------------------------------------------------
// Tailwind's own default theme
// ---------------------------------------------------------------------------

/**
 * The real thing, and the only test here that is not a fixture I wrote.
 *
 * A migrator validated against its author's idea of the input passes for
 * exactly as long as that idea is right. Tailwind ships its default theme as a
 * 510-line stylesheet — the benchmark harness has it installed — and running
 * the migrator over it found three defects no hand-written fixture had: its
 * `@keyframes` live *inside* the `@theme` block, so every keyframe declaration
 * was read as a theme token; its font stacks wrap across lines, so
 * `--font-sans` arrived with no value at all; and `--shadow` / `--radius` /
 * `--blur` with no suffix are the DEFAULT tokens, which fell through to
 * `:root`.
 */
const tailwindTheme = ((): string | null => {
	try {
		const require = createRequire(
			fileURLToPath(new URL("../../bench/__resolve__.js", import.meta.url)),
		);
		const root = dirname(require.resolve("tailwindcss/package.json"));
		return readFileSync(join(root, "theme.css"), "utf8");
	} catch {
		return null;
	}
})();

describe.skipIf(tailwindTheme === null)("Tailwind's own default theme", () => {
	const result = () => migrateTailwindCSS(tailwindTheme as string);

	test("every scale Rainbow Index has is filled", () => {
		const byDirective = new Map(result().translated.map((t) => [t.directive, t.entries]));
		// The counts are Tailwind's, so a change upstream moves them; the
		// assertion is that each scale is populated, not that it is this size.
		for (const directive of [
			"@color",
			"@font",
			"@text",
			"@weight",
			"@tracking",
			"@leading",
			"@breakpoint",
			"@rounded",
			"@shadow",
			"@blur",
			"@ease",
			"@animate",
			"@spacing",
		]) {
			expect(byDirective.get(directive) ?? 0, directive).toBeGreaterThan(0);
		}
		expect(byDirective.get("@color")).toBeGreaterThan(200);
	});

	test("the classes a Tailwind project actually writes all resolve", () => {
		const { inspector } = inspectorFor(result().css);
		for (const className of [
			"bg-red-500",
			"text-blue-700",
			"font-sans",
			"font-serif",
			"font-mono",
			"text-lg",
			"rounded-lg",
			"shadow-md",
			"blur-sm",
			"ease-in",
			"tracking-tight",
			"leading-snug",
			"font-bold",
			"sm:flex",
			"animate-spin",
			"animate-ping",
			"animate-pulse",
			"animate-bounce",
			// The DEFAULT tokens, which Tailwind spells with no suffix.
			"rounded",
			"shadow",
			"blur",
		]) {
			expect(inspector.validate(className), className).toEqual({ ok: true });
		}
	});

	test("a DEFAULT of an unsupported namespace is reported, not carried to :root", () => {
		// Tailwind's theme has a bare `--drop-shadow` alongside `--drop-shadow-*`.
		// The suffixed ones are already reported; the bare one is the same token
		// family and has to go the same way, or it lands in `:root` as a custom
		// property nothing reads.
		const migrated = result();
		expect(migrated.manual.some((step) => step.found.startsWith("--drop-shadow:"))).toBe(true);
		expect(migrated.css).not.toMatch(/^\t--drop-shadow: /m);
	});

	test("nothing from inside a @keyframes block leaks into the theme", () => {
		// The declarations in `@keyframes spin { to { transform: rotate(…) } }`
		// are not tokens, and a reader that walks the body straight through
		// files them as if they were.
		const css = result().css;
		expect(css).not.toMatch(/^\ttransform: /m);
		expect(css).not.toMatch(/^\topacity: /m);
	});

	test("the migrated theme compiles with only the two warnings it should", () => {
		const { analysis } = inspectorFor(result().css);
		// `black` and `white` shadow built-in utilities — a real heads-up
		// (RI-1124) that a Tailwind project inherits, not a migration defect.
		expect(analysis.warnings.every((w) => w.includes("RI-1124"))).toBe(true);
		expect(analysis.warnings).toHaveLength(2);
	});

	test("is idempotent on a file this size too", () => {
		const once = result().css;
		expect(migrateTailwindCSS(once).css).toBe(once);
	});

	test("every manual step names something with no counterpart, and says what to do", () => {
		const manual = result().manual;
		expect(manual.length).toBeGreaterThan(0);
		expect(manual.every((step) => step.action !== undefined)).toBe(true);
		// Nothing that *does* have a counterpart should be in here.
		for (const step of manual) {
			expect(step.found, step.found).not.toMatch(/^--(?:color|breakpoint|radius|ease)-/);
		}
	});
});
