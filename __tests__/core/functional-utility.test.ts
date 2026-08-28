import { describe, expect, test } from "vitest";
import postcss from "postcss";
import plugin from "../../src/integrations/postcss/index.js";
import { extractDirectives, resolveDirectives } from "../../src/directives/index.js";
import { createThemeSnapshot } from "../../src/engine/index.js";
import { createRi } from "../../src/merge/index.js";
import { createClassInspector } from "../../src/engine/inspector.js";
import { resolveUtility } from "../../src/utilities/index.js";
import { parseUtility } from "../../src/utilities/parser.js";

const DIRECTIVES = `
@utility glow-* { box-shadow: 0 0 var(--value) gold; }
@utility tab-size-* { tab-size: var(--value); }
@utility pad-* { padding: var(--value); &:hover { padding: var(--value); } }
@utility card { padding: 1rem; }
@utility card-* { padding: var(--value); }
`;

function themeOf(css: string) {
	return resolveDirectives(extractDirectives(css, []));
}
const theme = themeOf(DIRECTIVES);

function resolve(cls: string) {
	const p = parseUtility(cls);
	return resolveUtility(p.utility, p.value, p.negative, theme, [], undefined, p.dataType ?? null);
}

describe("functional @utility name-*", () => {
	test("substitutes the class suffix for var(--value)", () => {
		expect(resolve("glow-4")?.declarations).toEqual([
			{ property: "box-shadow", value: "0 0 4 gold" },
		]);
	});

	test("bracket suffixes carry arbitrary values and decode underscores", () => {
		expect(resolve("glow-[3px]")?.declarations).toEqual([
			{ property: "box-shadow", value: "0 0 3px gold" },
		]);
		expect(resolve("glow-[2px_4px]")?.declarations).toEqual([
			{ property: "box-shadow", value: "0 0 2px 4px gold" },
		]);
	});

	test("substitutes inside nested blocks", () => {
		const result = resolve("pad-8");
		expect(result?.declarations).toEqual([{ property: "padding", value: "8" }]);
		expect(result?.nested).toEqual([
			{ selector: "&:hover", declarations: [{ property: "padding", value: "8" }], nested: [] },
		]);
	});

	test("a multi-segment root matches its own suffix", () => {
		expect(resolve("tab-size-4")?.declarations).toEqual([{ property: "tab-size", value: "4" }]);
		expect(resolve("tab-size-[2ch]")?.declarations).toEqual([
			{ property: "tab-size", value: "2ch" },
		]);
	});

	test("an exact static name beats a functional match", () => {
		expect(resolve("card")?.declarations).toEqual([{ property: "padding", value: "1rem" }]);
		expect(resolve("card-4")?.declarations).toEqual([{ property: "padding", value: "4" }]);
	});

	test("the longest defined root wins", () => {
		const t = themeOf(`@utility a-* { color: red; } @utility a-b-* { color: blue; }`);
		const p = parseUtility("a-b-4");
		expect(resolveUtility(p.utility, p.value, false, t, [])?.declarations).toEqual([
			{ property: "color", value: "blue" },
		]);
	});

	test("a bare root and a negated class do not match", () => {
		expect(resolve("glow")).toBeNull();
		expect(resolve("-glow-4")).toBeNull();
	});

	test("a suffix that would break out of the declaration is rejected", () => {
		const t = themeOf(`@utility x-* { color: var(--value); }`);
		expect(resolveUtility("x", "red}a{b:c", false, t, [])).toBeNull();
	});

	test("ri() treats two suffixes of one root as conflicting", () => {
		const ri = createRi(createThemeSnapshot(theme));
		expect(ri("glow-4 glow-8")).toBe("glow-8");
		expect(ri("glow-4 card")).toBe("glow-4 card");
	});

	test("the inspector accepts a functional class", () => {
		const inspector = createClassInspector(theme);
		expect(inspector.validate("glow-4")).toEqual({ ok: true });
	});

	test("compiles to CSS and works through @apply", async () => {
		const result = await postcss([plugin({ cwd: __dirname, sources: [] })]).process(
			`@import "rainbowindex";\n${DIRECTIVES}\n@source inline("glow-4");\n.x { @apply glow-8; }`,
			{ from: `${__dirname}/x.css` },
		);
		expect(result.css).toContain("0 0 4 gold");
		expect(result.css).toContain("0 0 8 gold");
		expect(result.warnings().map((w) => w.text)).toEqual([]);
	});
});
