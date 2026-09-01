/**
 * The package ships two defaults — the colour palette and the spacing base.
 * Every named scale starts empty. This is the end-to-end guard for that: the
 * same classes are compiled twice, once against a bare theme and once against
 * a theme whose directives name the tokens, so a default that creeps back in
 * fails here rather than in a consumer's stylesheet.
 */
import { describe, expect, it } from "vitest";
import { extractDirectives, resolveDirectives } from "../../src/directives/index.js";
import { createCompiler } from "../../src/engine/index.js";

const TOKEN_CLASSES = [
	"sm:flex",
	"@sm:flex",
	"font-bold",
	"ease-in",
	"blur-md",
	"animate-spin",
	"p-fluid-4",
	"text-fluid-lg",
	"fluid-compact",
];

/** Classes that need no token: CSS keywords and arbitrary values. */
const KEYWORD_CLASSES = [
	"blur-none",
	"ease-linear",
	"ease-[cubic-bezier(0.4,0,1,1)]",
	"animate-none",
	"animate-in",
	"fade-in-50",
	"blur-in-8",
	"font-[850]",
	"blur-[3px]",
];

const DECLARED = `
@breakpoint { sm: 40rem; }
@weight { bold: 700; }
@ease { in: cubic-bezier(0.4, 0, 1, 1); }
@blur { md: 12px; }
@text { md: 1rem, 1.5; lg: 1.25rem, 1.4; }
@animate { spin: spin 1s linear infinite { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } }
@fluid { min: 20rem; max: 80rem; }
@fluid compact { min: 20rem; max: 48rem; }
`;

const compile = (classNames: string[], css = "") =>
	createCompiler().compile(classNames, resolveDirectives(extractDirectives(css, [])));

describe("no scale ships", () => {
	it("a named-token class resolves to nothing on a bare theme", () => {
		expect(compile(TOKEN_CLASSES).rules).toEqual([]);
	});

	it("every one of them comes back once a directive names the token", () => {
		const { rules } = compile(TOKEN_CLASSES, DECLARED);
		expect(rules).toHaveLength(TOKEN_CLASSES.length);
	});

	it("keyword and arbitrary forms need no theme", () => {
		const { rules } = compile(KEYWORD_CLASSES);
		expect(rules).toHaveLength(KEYWORD_CLASSES.length);
	});
});
