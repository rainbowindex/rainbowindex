/**
 * `sortClasses` — one ordering, shared by every consumer.
 *
 * The contract worth pinning is not "produces some order" but "produces the
 * emission order": a sorted class list has to read the same way the generated
 * stylesheet does, or an editor command and the CSS it is describing disagree.
 * So the central test compiles the same classes and compares the two orders
 * directly, rather than asserting a hand-written expectation that would drift
 * the moment a property group moves.
 */

import { describe, expect, test } from "vitest";
import { createEditorSession } from "../../src/editor/session.js";
import { sortClasses } from "../../src/editor/sort.js";
import { createCompiler } from "../../src/engine/index.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";

const THEME_CSS = `@color { brand: 0.18 330; }\n@breakpoint { sm: 40rem; lg: 64rem; }`;
const theme = analyzeProjectCSS(THEME_CSS).theme;

/** The order the compiler emits rules in, as class names. */
function emissionOrder(classes: string[]): string[] {
	const result = createCompiler().compile(classes, theme);
	const bySelector = new Map<string, string>();
	for (const cls of classes) {
		// `.hover\:px-4:hover` — the class name is the escaped head of it.
		bySelector.set(cls, cls);
	}
	return result.rules
		.map((rule) => {
			for (const cls of bySelector.keys()) {
				// Unescape enough to match: the selector always contains the
				// class name with `:` and `/` and `[` escaped.
				const escaped = cls.replace(/([:.[\]/!])/g, "\\$1");
				if (rule.selector.includes(`.${escaped}`)) return cls;
			}
			return null;
		})
		.filter((cls): cls is string => cls !== null);
}

describe("sortClasses", () => {
	test("matches the order the compiler emits the rules in", () => {
		const classes = [
			"text-brand-500",
			"lg:flex",
			"p-4",
			"hover:bg-brand-600",
			"flex",
			"pt-8",
			"sm:block",
			"z-10",
		];
		expect(sortClasses(theme, classes)).toEqual(emissionOrder(classes));
	});

	test("puts shorthands before their longhands", () => {
		expect(sortClasses(theme, ["pt-8", "p-4"])).toEqual(["p-4", "pt-8"]);
		expect(sortClasses(theme, ["mt-2", "m-1"])).toEqual(["m-1", "mt-2"]);
	});

	test("puts unresolvable classes first, in the order they were written", () => {
		const sorted = sortClasses(theme, ["p-4", "my-component", "flex", "felx", "card-body"]);
		expect(sorted.slice(0, 3)).toEqual(["my-component", "felx", "card-body"]);
		expect(sorted.slice(3)).toEqual(["flex", "p-4"]);
	});

	test("ties break on the escaped selector, not on the class name", () => {
		// `pt-4!` and `pt-40` are both padding-block-start with no variant, so
		// they share a sort key and only the tie-break separates them. The two
		// candidates disagree: by class name `!` (0x21) sorts before `0`, by
		// selector the escaping backslash (0x5C) sorts after it. The emitted
		// CSS uses the selector, so this is the one that has to win.
		expect(sortClasses(theme, ["pt-4!", "pt-40"])).toEqual(["pt-40", "pt-4!"]);
		expect(sortClasses(theme, ["pt-4!", "pt-40"])).toEqual(emissionOrder(["pt-4!", "pt-40"]));
	});

	test("keeps duplicates — a formatter must not delete a class", () => {
		expect(sortClasses(theme, ["p-4", "flex", "p-4"])).toEqual(["flex", "p-4", "p-4"]);
		expect(sortClasses(theme, ["nope", "nope"])).toEqual(["nope", "nope"]);
	});

	test("orders variants after the base utilities they modify", () => {
		const sorted = sortClasses(theme, ["hover:bg-brand-600", "bg-brand-500", "sm:bg-brand-700"]);
		expect(sorted[0]).toBe("bg-brand-500");
		expect(sorted).toContain("sm:bg-brand-700");
		expect(sorted).toContain("hover:bg-brand-600");
	});

	test("is idempotent and does not mutate its input", () => {
		const input = ["pt-8", "flex", "p-4", "custom"];
		const frozen = Object.freeze([...input]);
		const once = sortClasses(theme, frozen);
		expect(sortClasses(theme, once)).toEqual(once);
		expect([...frozen]).toEqual(input);
		expect(once).not.toBe(frozen);
	});

	test("is total: the result is a permutation of the input", () => {
		const input = ["z-10", "grid", "gap-2", "unknown-thing", "sm:hidden", "group", "p-4"];
		const sorted = sortClasses(theme, input);
		expect([...sorted].sort()).toEqual([...input].sort());
	});

	test("a marker class sorts with the classes that carry no cascade position", () => {
		// `group` is valid and emits nothing, so it cannot compete for a slot.
		const sorted = sortClasses(theme, ["p-4", "group", "flex"]);
		expect(sorted.indexOf("group")).toBeLessThan(sorted.indexOf("flex"));
	});

	test("theme-defined breakpoints order by their own widths", () => {
		const wide = analyzeProjectCSS(`@breakpoint { tiny: 20rem; huge: 90rem; }`).theme;
		expect(sortClasses(wide, ["huge:flex", "tiny:flex", "flex"])).toEqual([
			"flex",
			"tiny:flex",
			"huge:flex",
		]);
	});

	test("the same input gives the same output regardless of input order", () => {
		const a = ["p-4", "flex", "hover:underline", "z-10"];
		const b = ["z-10", "hover:underline", "flex", "p-4"];
		expect(sortClasses(theme, a)).toEqual(sortClasses(theme, b));
	});
});

describe("EditorSession.sortClasses", () => {
	test("sorts through the session's theme", () => {
		const session = createEditorSession({ css: THEME_CSS });
		expect(session.sortClasses(["pt-8", "p-4", "text-brand-500"])).toEqual(
			sortClasses(theme, ["pt-8", "p-4", "text-brand-500"]),
		);
	});

	test("follows setCss", () => {
		const session = createEditorSession({ css: `@color { brand: 0.18 330; }` });
		// `zzz` resolves to nothing under either theme, so it stays in front.
		expect(session.sortClasses(["bg-brand-500", "zzz"])).toEqual(["zzz", "bg-brand-500"]);

		// brand is gone; bg-brand-500 becomes unresolvable and joins it there.
		session.setCss(`@color { ocean: 0.12 220; }`);
		expect(session.sortClasses(["flex", "bg-brand-500"])).toEqual(["bg-brand-500", "flex"]);
	});
});
