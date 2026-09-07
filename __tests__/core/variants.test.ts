import { describe, expect, it } from "vitest";
import { compileProject } from "../../src/project/index.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";
import { resolveVariant } from "../../src/engine/variants.js";

/** Compile a single class and return the generated CSS. */
async function css(cls: string): Promise<string> {
	const r = await compileProject({ css: '@import "rainbowindex";', classNames: [cls] });
	return r.css;
}

describe("variants", () => {
	it.each([
		// pseudo-classes (added)
		["target:flex", ":target"],
		["only-of-type:flex", ":only-of-type"],
		["read-only:flex", ":read-only"],
		["placeholder-shown:flex", ":placeholder-shown"],
		["autofill:flex", ":autofill"],
		["in-range:flex", ":in-range"],
		["user-valid:flex", ":user-valid"],
		// media (added)
		["light:flex", "@media (prefers-color-scheme: light)"],
		["contrast-more:flex", "@media (prefers-contrast: more)"],
		["contrast-less:flex", "@media (prefers-contrast: less)"],
		["forced-colors:flex", "@media (forced-colors: active)"],
		["inverted-colors:flex", "@media (inverted-colors: inverted)"],
		["pointer-fine:flex", "@media (pointer: fine)"],
		["any-pointer-coarse:flex", "@media (any-pointer: coarse)"],
		["noscript:flex", "@media (scripting: none)"],
		// special selectors
		["rtl:flex", ':where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)'],
		["ltr:flex", ':where(:dir(ltr), [dir="ltr"], [dir="ltr"] *)'],
		["open:flex", ":is([open], :popover-open, :open)"],
		["inert:flex", ":is([inert], [inert] *)"],
		["*:flex", ":is(.\\*\\:flex > *)"],
		["**:flex", ":is(.\\*\\*\\:flex *)"],
		// dynamic
		["peer-checked:flex", ".peer:checked ~ "],
		["peer-[:disabled]:flex", ".peer:is(:disabled) ~ "],
		["group-[.foo]:flex", ".group:is(.foo) "],
		["supports-[display:grid]:flex", "@supports (display:grid)"],
		["nth-[2n]:flex", ":nth-child(2n)"],
		["nth-last-[1]:flex", ":nth-last-child(1)"],
		["nth-of-type-[3]:flex", ":nth-of-type(3)"],
		["nth-last-of-type-[2]:flex", ":nth-last-of-type(2)"],
		["min-[600px]:flex", "@media (width >= 600px)"],
		["max-[40rem]:flex", "@media (width < 40rem)"],
		["in-[.parent]:flex", ":where(.parent) "],
	])("%s emits %s", async (cls, expected) => {
		expect(await css(cls)).toContain(expected);
	});

	it("rejects unsafe bracket content in new variants", async () => {
		// curly braces / unbalanced parens must not produce a rule
		expect(await css("nth-[2n);x{color:red}]:flex")).not.toContain("display: flex");
		expect(await css("min-[1px;}]:flex")).not.toContain("display: flex");
		expect(await css("supports-[display:grid}]:flex")).not.toContain("display: flex");
	});
});

/**
 * `dark:` and the color tokens are one theme switch, and they used to disagree:
 * tokens flipped through `light-dark()` under `html[data-appearance]`, while
 * `dark:` only ever asked the OS. `@color dark { variant: … }` picks which
 * question both halves ask.
 */
describe("@color dark variant strategies", () => {
	const compile = async (config: string, classNames: string[]): Promise<string> => {
		const r = await compileProject({
			css: `@import "rainbowindex";\n@color { brand: 0.18 330; }\n${config}`,
			classNames,
		});
		return r.css;
	};

	it("defaults to the OS preference, unchanged", async () => {
		const out = await compile("", ["dark:flex", "light:flex"]);
		expect(out).toContain("@media (prefers-color-scheme: dark)");
		expect(out).toContain("@media (prefers-color-scheme: light)");
		// The preflight always sets color-scheme from `data-appearance`; what the
		// default strategy must not do is put it in the utility rules.
		const rules = out.split("\n\n").filter((b) => b.includes("\\:flex"));
		expect(rules).toHaveLength(2);
		expect(rules.join("\n")).not.toContain("data-appearance");
	});

	it("appearance emits both the explicit attribute and the unoverridden OS preference", async () => {
		// Two rules, because no single one can say "attribute set, OR preference
		// with no attribute". Dropping either silently halves the strategy: the
		// first alone ignores the OS, the second alone ignores the toggle.
		const out = await compile("@color dark { variant: appearance; }", ["dark:flex"]);
		expect(out).toContain(':where(html[data-appearance="dark"]) .dark\\:flex');
		expect(out).toMatch(
			/@media \(prefers-color-scheme: dark\) \{\n:where\(html:not\(\[data-appearance="light"\]\)\) \.dark\\:flex/,
		);
	});

	it("appearance mirrors itself for light:", async () => {
		const out = await compile("@color dark { variant: appearance; }", ["light:flex"]);
		expect(out).toContain(':where(html[data-appearance="light"]) .light\\:flex');
		expect(out).toContain(':where(html:not([data-appearance="dark"])) .light\\:flex');
	});

	it("appearance agrees with the preflight that flips the tokens", async () => {
		// The Done-when: one switch drives both halves. The preflight sets
		// color-scheme from the same attribute the variant now reads.
		const out = await compile("@color dark { variant: appearance; }", ["dark:flex"]);
		expect(out).toContain('html[data-appearance="dark"] {\n  color-scheme: dark;');
		expect(out).toContain(':where(html[data-appearance="dark"]) .dark\\:flex');
	});

	it("selector emits one rule and ignores the OS preference", async () => {
		const out = await compile("@color dark { variant: selector(.dark); }", ["dark:flex"]);
		expect(out).toContain(":where(.dark, .dark *) .dark\\:flex");
		expect(out).not.toContain("prefers-color-scheme");
	});

	it("selector makes light: the negation, so the two never both match", async () => {
		const out = await compile("@color dark { variant: selector(.dark); }", ["light:flex"]);
		expect(out).toContain(":where(:not(.dark, .dark *)) .light\\:flex");
	});

	it("keeps zero specificity, so a later utility still wins", async () => {
		// `:where()` is the reason `dark:bg-white` loses to a later `bg-black`
		// exactly as the media-query form does.
		const out = await compile("@color dark { variant: selector(.dark); }", ["dark:flex"]);
		expect(out).toContain(":where(.dark");
		expect(out).not.toMatch(/(?<!:where\()\.dark \.dark\\:flex/);
	});

	it("stacks with other variants, wrapping every branch", async () => {
		const r = await compileProject({
			css: '@import "rainbowindex";\n@breakpoint { sm: 40rem; }\n@color dark { variant: appearance; }',
			classNames: ["sm:dark:hover:flex"],
		});
		const branches = r.css.split("\n\n").filter((b) => b.includes("sm\\:dark\\:hover\\:flex"));
		expect(branches).toHaveLength(2);
		for (const branch of branches) {
			expect(branch).toContain("@media (min-width: 40rem)");
			expect(branch).toContain(":hover");
		}
	});

	it("warns on an unknown strategy and keeps the default", async () => {
		const r = await compileProject({
			css: '@import "rainbowindex";\n@color dark { variant: nonsense; }',
			classNames: ["dark:flex"],
		});
		expect(r.warnings.some((w) => w.includes("RI-1111"))).toBe(true);
		expect(r.css).toContain("@media (prefers-color-scheme: dark)");
	});

	it("rejects an empty selector rather than disabling dark: silently", async () => {
		const r = await compileProject({
			css: '@import "rainbowindex";\n@color dark { variant: selector(); }',
			classNames: ["dark:flex"],
		});
		expect(r.warnings.some((w) => w.includes("RI-1111"))).toBe(true);
		expect(r.css).toContain("@media (prefers-color-scheme: dark)");
	});
});

/**
 * A variant nested inside another used to be a second, much smaller grammar:
 * `group-` accepted a pseudo-class or a bracket selector and nothing else, so
 * `group-hover:` worked and `group-data-[state=open]:` did not — even though
 * `data-[state=open]:` on its own always had. The inner segment now resolves as
 * a variant in its own right, which is the same grammar rather than a copy of
 * part of it.
 */
describe("variants that compose", () => {
	it.each([
		// group-/peer- over an attribute, a boolean attribute, aria, and :has()
		[
			"group-data-[state=open]:flex",
			".group[data-state=open] .group-data-\\[state\\=open\\]\\:flex",
		],
		["group-data-open:flex", ".group[data-open] "],
		["group-aria-expanded:flex", '.group[aria-expanded="true"] '],
		["peer-data-[open]:flex", ".peer[data-open] ~ "],
		["peer-has-[:checked]:flex", ".peer:has(:checked) ~ "],
		["group-has-[:checked]:flex", ".group:has(:checked) "],
		// has-/not-/in- take a variant too, not only a bracket
		["has-checked:flex", ":has(:checked)"],
		["not-data-[open]:flex", ":not([data-open])"],
		["in-focus:flex", ":where(*:focus) "],
		// the bare positional shorthand
		["nth-3:flex", ":nth-child(3)"],
		["nth-of-type-2:flex", ":nth-of-type(2)"],
	])("%s emits %s", async (cls, expected) => {
		expect(await css(cls)).toContain(expected);
	});

	it("negates an at-rule condition, which no selector can express", async () => {
		expect(await css("not-supports-[display:grid]:flex")).toContain("@supports not (display:grid)");
	});

	it("declines an inner variant that describes the viewport, not the anchor", async () => {
		// `group-sm:` is meaningless — a breakpoint is not a state an ancestor
		// can be in — so it stays unknown rather than emitting something odd.
		const r = await compileProject({
			css: '@import "rainbowindex";\n@breakpoint { sm: 40rem; }',
			classNames: ["group-sm:flex"],
		});
		expect(r.css).not.toContain("group-sm");
		expect(r.warnings.some((w) => w.includes("RI-1004"))).toBe(true);
	});

	it("declines an inner variant that rewrites the selector's position", async () => {
		// `in-[.foo]` means "somewhere inside .foo" — a position in the tree, not
		// a state an ancestor can be in. Accepting it would splice a second `&`
		// into the selector and emit nonsense.
		const r = await compileProject({
			css: '@import "rainbowindex";',
			classNames: ["group-in-[.foo]:flex"],
		});
		expect(r.css).not.toContain("group-in-");
		expect(r.warnings.some((w) => w.includes("RI-1004"))).toBe(true);
	});

	it("declines an inner variant that carries an at-rule alongside its selector", async () => {
		// Under `appearance`, `dark:` is a selector AND a media query AND a second
		// branch. None of that can be pinned to an ancestor.
		const r = await compileProject({
			css: '@import "rainbowindex";\n@color dark { variant: appearance; }',
			classNames: ["group-dark:flex"],
		});
		expect(r.css).not.toContain("group-dark");
		expect(r.warnings.some((w) => w.includes("RI-1004"))).toBe(true);
	});

	it("terminates on absurd nesting instead of recursing forever", async () => {
		const out = await css(`${"not-".repeat(12)}hover:flex`);
		expect(out).not.toContain("display: flex");
	});
});

/**
 * Named groups let nested markup address the group it means. The slash used to
 * defeat the variant-prefix check, so the colon after it was never found and
 * the whole class was read as a utility name.
 */
describe("named groups and peers", () => {
	it("anchors on the named class, not on any .group", async () => {
		expect(await css("group-hover/item:flex")).toContain(
			".group\\/item:hover .group-hover\\/item\\:flex",
		);
	});

	it("works for peers and composes with the inner grammar", async () => {
		expect(await css("peer-checked/sidebar:flex")).toContain(".peer\\/sidebar:checked ~ ");
		expect(await css("group-data-[state=open]/item:flex")).toContain(
			".group\\/item[data-state=open] ",
		);
	});

	it("leaves an unnamed group alone", async () => {
		expect(await css("group-hover:flex")).toContain(".group:hover ");
	});

	it("rejects a malformed name rather than styling every group", async () => {
		// Silently dropping the name would make this match any `.group`, which is
		// the one outcome worse than not compiling. The class parser rejects most
		// of these before the resolver sees them, so the resolver is checked
		// directly too — it is exported, and a caller that does its own parsing
		// would otherwise get the silent fallback.
		expect(await css("group-hover/:flex")).not.toContain("display: flex");
		expect(await css("group-hover/a b:flex")).not.toContain("display: flex");
		const theme = analyzeProjectCSS('@import "rainbowindex";').theme;
		expect(resolveVariant("group-hover/bad name", theme)).toBeNull();
		expect(resolveVariant("group-hover/item", theme)).not.toBeNull();
	});

	it("does not split a slash inside an arbitrary value", async () => {
		// The name is found from the right and only outside brackets, so a slash
		// in the value is left where the author put it.
		expect(await css("group-data-[a/b]:flex")).toContain(".group[data-a/b] ");
		expect(await css("group-[.a/b]:flex")).toContain(".group:is(.a/b) ");
	});

	it("takes the outer slash as the name and leaves an inner one alone", async () => {
		expect(await css("group-data-[a/b]/item:flex")).toContain(".group\\/item[data-a/b] ");
	});
});

/**
 * `min-`/`max-` took a bracketed length and nothing else, seven lines below the
 * branch that resolves a breakpoint by name. `max-sm:` is ordinary Tailwind, so
 * the two spellings of the same idea disagreed for no reason.
 */
describe("named breakpoint width ranges", () => {
	const withBreakpoints = async (cls: string): Promise<string> => {
		const r = await compileProject({
			css: '@import "rainbowindex";\n@breakpoint { sm: 40rem; md: 48rem; }',
			classNames: [cls],
		});
		return r.css;
	};

	it.each([
		["max-sm:hidden", "@media (width < 40rem)"],
		["min-md:flex", "@media (width >= 48rem)"],
		["@max-md:flex", "@container (width < 48rem)"],
		["@min-md:flex", "@container (width >= 48rem)"],
		["@sidebar/max-md:flex", "@container sidebar (width < 48rem)"],
	])("%s emits %s", async (cls, expected) => {
		expect(await withBreakpoints(cls)).toContain(expected);
	});

	it("keeps the bracket forms and plain breakpoints exactly as they were", async () => {
		expect(await withBreakpoints("max-[600px]:hidden")).toContain("@media (width < 600px)");
		expect(await withBreakpoints("min-[600px]:flex")).toContain("@media (width >= 600px)");
		// `sm:` keeps `min-width`, not `width >=`. Equivalent queries, but changing
		// it would churn every golden fixture for nothing.
		expect(await withBreakpoints("sm:flex")).toContain("@media (min-width: 40rem)");
	});

	it("stacks with a plain breakpoint", async () => {
		const out = await withBreakpoints("sm:max-md:flex");
		expect(out).toContain("@media (min-width: 40rem)");
		expect(out).toContain("@media (width < 48rem)");
	});

	it("leaves a `max-` custom variant alone", async () => {
		// The reason the branch falls through instead of returning null: claiming
		// the whole `max-` prefix would swallow a user's own variant.
		const r = await compileProject({
			css: '@import "rainbowindex";\n@custom max-touch { @media (pointer: coarse) { @slot; } }',
			classNames: ["max-touch:flex"],
		});
		expect(r.css).toContain("@media (pointer: coarse)");
	});

	it("refuses a breakpoint whose value could break out of the at-rule", async () => {
		// The value is interpolated into `@media (...)` unescaped, and `@breakpoint`
		// itself accepts the entry — so this guard is the only thing between a
		// crafted token file and arbitrary CSS. All three branches read it through
		// the same helper, so all three are checked.
		const r = await compileProject({
			css: '@import "rainbowindex";\n@breakpoint { evil: 40rem) { } body { color: red }; }',
			classNames: ["evil:flex", "max-evil:flex", "min-evil:flex", "@evil:flex"],
		});
		expect(r.css).not.toContain("color: red");
		expect(r.css).not.toContain("display: flex");
	});

	it("still rejects a name that is no breakpoint, and a bracketed container size", async () => {
		expect(await withBreakpoints("max-nope:flex")).not.toContain("display: flex");
		// An arbitrary container size is spelled `[@container(min-width:600px)]`;
		// docs/class-syntax.md says so, and accepting this would contradict it.
		expect(await withBreakpoints("@[600px]:flex")).not.toContain("display: flex");
	});
});

/**
 * A variant's arbitrary value could not contain a nested `]`. The bracket was
 * matched with `[^\]]*`, which stops at the first one, so `has-[[data-x]]:` —
 * the canonical Tailwind spelling for "has a descendant with this attribute" —
 * failed the variant-prefix test, the colon after it was never found, and the
 * whole class was read as a utility name. That is why it reported
 * `unknown-utility` and looked like a different problem than it was.
 */
describe("nested brackets in a variant's arbitrary value", () => {
	it.each([
		["has-[[data-x]]:flex", ":has([data-x])"],
		["peer-[[type=checkbox]]:flex", ".peer:is([type=checkbox]) ~ "],
		["in-[[data-panel]]:flex", ":where([data-panel]) "],
		["not-[[hidden]]:flex", ":not([hidden])"],
		["group-[[data-x]]/item:flex", ".group\\/item:is([data-x]) "],
	])("%s emits %s", async (cls, expected) => {
		expect(await css(cls)).toContain(expected);
	});

	it("treats a `]` inside quotes as content, not the end of the bracket", async () => {
		expect(await css('data-[x="]"]:flex')).toContain('[data-x="]"]');
	});

	it("leaves an unclosed quote alone", async () => {
		// The quote is an ordinary character when it never closes, so this kept
		// working before and has to keep working now.
		expect(await css("data-[x=it's]:flex")).toContain("[data-x=it's]");
	});

	it("keeps every flat form exactly as it was", async () => {
		expect(await css("group-[.a]:flex")).toContain(".group:is(.a) ");
		expect(await css("data-[state=open]:flex")).toContain("[data-state=open]");
		expect(await css("group-hover/item:flex")).toContain(".group\\/item:hover ");
		expect(await css("hover:flex")).toContain(":hover");
	});

	it("rejects an unterminated bracket rather than reading it as a utility", async () => {
		expect(await css("has-[[data-x]:flex")).not.toContain("display: flex");
	});
});

/**
 * `&` inside a relational variant's bracket is the anchor — the `.group` or
 * `.peer` element the selector describes. It used to be left for the generic
 * ampersand pass, which substitutes the accumulated base selector, so
 * `group-[&.foo]:flex` emitted `.group:is(<this class>.foo) <this class>` — an
 * element required to be its own ancestor, which nothing can match. The failure
 * was silent: valid CSS, dead rule.
 */
describe("& inside a relational variant", () => {
	it.each([
		["group-[&.foo]:flex", ".group.foo .group-\\[\\&\\.foo\\]\\:flex"],
		["group-[&[href]]:flex", ".group[href] "],
		["peer-[&.foo]:flex", ".peer.foo ~ "],
		["group-[&.foo]/item:flex", ".group\\/item.foo "],
	])("%s anchors on the group, not the utility", async (cls, expected) => {
		expect(await css(cls)).toContain(expected);
	});

	it("substitutes every &, not just the first", async () => {
		// `group-[&.a:not(&.b)]` — the group, having .a, not having .b. One
		// leftover `&` is invalid CSS, which is the bug this whole block is about.
		expect(await css("group-[&.a:not(&.b)]:flex")).toContain(".group.a:not(.group.b) ");
	});

	it("never leaves a bare & in the emitted selector", async () => {
		for (const cls of ["group-[&.foo]:flex", "peer-[&[href]]:flex", "group-[&.a]/x:flex"]) {
			const out = await css(cls);
			// The escaped `\&` in the class name itself is fine; a raw one in the
			// selector is not, and is what `:has(&.foo)` used to ship.
			expect(out.replace(/\\&/g, "")).not.toContain("&");
		}
	});

	it("leaves the &-free relational forms exactly as they were", async () => {
		expect(await css("group-[.foo]:flex")).toContain(".group:is(.foo) ");
		expect(await css("group-[[href]]:flex")).toContain(".group:is([href]) ");
		expect(await css("in-[.foo]:flex")).toContain(":where(.foo) ");
		expect(await css("has-[[data-x]]:flex")).toContain(":has([data-x])");
	});

	it("rejects & where it names nothing the bracket does not already say", async () => {
		// `:has(&.foo)` and `:not(&.foo)` are not valid in the flat CSS this
		// emits, and an element cannot contain itself. Failing loudly beats
		// shipping either.
		for (const cls of ["has-[&.foo]:flex", "not-[&.foo]:flex", "in-[&.foo]:flex"]) {
			expect(await css(cls)).not.toContain("display: flex");
		}
	});

	it("leaves the standalone arbitrary variant alone", async () => {
		// There `&` really is the element being styled, and always worked.
		expect(await css("[&.foo]:flex")).toContain(".\\[\\&\\.foo\\]\\:flex.foo");
		expect(await css("[&_p]:flex")).toContain(" p");
		expect(await css("[&>*]:flex")).toContain(">*");
	});
});
