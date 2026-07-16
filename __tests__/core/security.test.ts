/**
 * Adversarial security tests for CSS injection prevention.
 *
 * Tests sanitizeArbitraryValue (via parseUtility) and sanitizeVariantBracket
 * (via resolveVariant / compile) against known CSS injection vectors.
 */
import { describe, expect, it } from "vitest";
import { parseUtility } from "../../src/utilities/parser.js";
import { createCompiler, resolveVariant } from "../../src/engine/index.js";
import { resolveDirectives } from "../../src/directives/index.js";

const theme = resolveDirectives([]);
const compile = (classNames: string[], activeTheme = theme) =>
	createCompiler().compile(classNames, activeTheme);

// ---------------------------------------------------------------------------
// sanitizeArbitraryValue — tested via parseUtility
// ---------------------------------------------------------------------------

describe("sanitizeArbitraryValue — CSS injection prevention", () => {
	it("strips semicolons (declaration breakout)", () => {
		const p = parseUtility("p-[20px;color:red]");
		// Semicolons should be stripped; the value should not contain them
		expect(p.value).not.toContain(";");
	});

	it("strips curly braces (rule breakout)", () => {
		const p = parseUtility("p-[20px}*{color:red]");
		expect(p.value).not.toContain("}");
		expect(p.value).not.toContain("{");
	});

	// Defense-in-depth: expression() is an IE-only vector, but we strip it
	// unconditionally to guard against any future parser that re-enables it.
	it("strips expression() — legacy IE injection", () => {
		const p = parseUtility("w-[expression(alert(1))]");
		expect(p.value).not.toContain("expression(");
	});

	it("strips CSS hex escape bypass for expression — \\65xpression", () => {
		// \\65 is CSS escape for 'e', so \\65xpression = expression
		const p = parseUtility("w-[\\65xpression(alert(1))]");
		// The hex escape should be stripped first, then expression() can't form
		expect(p.value).not.toMatch(/expression\s*\(/i);
		// The hex escape itself should be stripped
		expect(p.value).not.toMatch(/\\[0-9a-fA-F]/);
	});

	it("strips multi-byte CSS hex escape — \\000065xpression", () => {
		const p = parseUtility("w-[\\000065xpression(alert(1))]");
		expect(p.value).not.toMatch(/expression\s*\(/i);
	});

	it("strips -moz-binding injection", () => {
		const p = parseUtility("bg-[-moz-binding:url(evil)]");
		expect(p.value).not.toMatch(/-moz-binding\s*:/i);
	});

	it("neutralizes javascript: URL scheme", () => {
		const p = parseUtility("bg-[url(javascript:alert(1))]");
		expect(p.value).not.toContain("javascript:");
	});

	it("neutralizes data:text/html URL scheme", () => {
		const p = parseUtility("bg-[url(data:text/html,<script>alert(1)</script>)]");
		expect(p.value).not.toMatch(/data\s*:\s*text\/html/i);
	});

	it("neutralizes data:text/html with base64 encoding", () => {
		const p = parseUtility(
			"bg-[url('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')]",
		);
		expect(p.value).not.toMatch(/data\s*:\s*text\/html/i);
	});

	it("rejects empty brackets", () => {
		const p = parseUtility("p-[]");
		expect(p.arbitrary).toBe(false);
	});

	it("rejects excessively long values", () => {
		const longValue = "a".repeat(600);
		const p = parseUtility(`p-[${longValue}]`);
		// Should be rejected (over MAX_ARBITRARY_VALUE_LENGTH)
		expect(p.arbitrary).toBe(false);
	});

	it("strips expression with spaces — expression (alert(1))", () => {
		const p = parseUtility("w-[expression  (alert(1))]");
		expect(p.value).not.toMatch(/expression\s*\(/i);
	});

	it("strips case variations of expression — EXPRESSION()", () => {
		const p = parseUtility("w-[EXPRESSION(alert(1))]");
		expect(p.value).not.toMatch(/expression\s*\(/i);
	});

	it("handles nested quotes in url()", () => {
		// Valid CSS url() with quotes should work
		const p = parseUtility("bg-[url('image.png')]");
		expect(p.arbitrary).toBe(true);
		expect(p.value).toContain("image.png");
	});

	it("all data: URLs in url() are neutralized (defense-in-depth)", () => {
		// All data: URIs inside url() are blocked, not just text/html.
		// This prevents potential vectors via data:text/javascript, data:application/xhtml+xml, etc.
		const p = parseUtility("bg-[url(data:image/png;base64,abc)]");
		expect(p.arbitrary).toBe(true);
		expect(p.value).not.toContain("data:");
		expect(p.value).toContain("about:");
	});

	// --- Unicode confusable / NFKC bypass vectors ---

	it("neutralizes fullwidth parentheses via NFKC normalization", () => {
		// Fullwidth ( = U+FF08, fullwidth ) = U+FF09 — NFKC decomposes to ASCII
		const p = parseUtility("w-[expression\uFF08alert(1)\uFF09]");
		expect(p.value).not.toMatch(/expression\s*\(/i);
	});

	it("strips fullwidth semicolons (U+FF1B) as structural confusables", () => {
		const p = parseUtility("p-[20px\uFF1Bcolor:red]");
		expect(p.value).not.toContain("\uFF1B");
		expect(p.value).not.toContain(";");
	});

	it("strips fullwidth curly braces (U+FF5B, U+FF5D)", () => {
		const p = parseUtility("p-[20px\uFF5D*\uFF5Bcolor:red]");
		expect(p.value).not.toContain("\uFF5B");
		expect(p.value).not.toContain("\uFF5D");
		expect(p.value).not.toContain("{");
		expect(p.value).not.toContain("}");
	});

	it("strips ornate bracket confusables (U+FE5B, U+FE5D)", () => {
		const p = parseUtility("p-[20px\uFE5D*\uFE5Bcolor:red]");
		expect(p.value).not.toContain("\uFE5B");
		expect(p.value).not.toContain("\uFE5D");
	});

	// --- CSS escape + expression() interaction vectors ---

	it("handles CSS escape interleaved with expression keyword", () => {
		// \\65 = 'e' in CSS, attempt to reconstruct expression via escapes
		const p = parseUtility("w-[\\45xpression(alert(1))]");
		expect(p.value).not.toMatch(/expression\s*\(/i);
	});

	it("handles multi-escape expression bypass — \\65\\78pression", () => {
		const p = parseUtility("w-[\\65\\78pression(alert(1))]");
		expect(p.value).not.toMatch(/expression\s*\(/i);
		expect(p.value).not.toMatch(/\\[0-9a-fA-F]/);
	});

	it("strips expression with trailing whitespace in hex escape — \\65 xpression", () => {
		// CSS spec: hex escape can have optional trailing space
		const p = parseUtility("w-[\\65 xpression(alert(1))]");
		expect(p.value).not.toMatch(/expression\s*\(/i);
	});

	// --- Nested function call vectors ---

	it("neutralizes javascript: with CSS escapes in url()", () => {
		const p = parseUtility("bg-[url(java\\73cript:alert(1))]");
		// Hex escapes stripped first, then javascript: check may not match,
		// but the result should not contain a functional javascript: URI
		expect(p.value).not.toMatch(/javascript\s*:/i);
	});

	it("neutralizes data: URI with uppercase scheme", () => {
		const p = parseUtility("bg-[url(DATA:text/html,<script>alert(1)</script>)]");
		expect(p.value).not.toMatch(/data\s*:/i);
	});

	it("strips @import injection in arbitrary values", () => {
		const p = parseUtility("bg-[@import url('evil.css')]");
		expect(p.value).not.toMatch(/@import/i);
	});

	it("strips @charset injection in arbitrary values", () => {
		const p = parseUtility("bg-[@charset 'utf-7']");
		expect(p.value).not.toMatch(/@charset/i);
	});

	it("strips @keyframes injection in arbitrary values", () => {
		const p = parseUtility("bg-[@keyframes evil]");
		expect(p.value).not.toMatch(/@keyframes/i);
	});

	it("strips control characters (C0/C1 range)", () => {
		// Null bytes and other control chars should be removed
		const p = parseUtility("p-[20px\x00\x01\x1f]");
		expect([...(p.value ?? "")].some((ch) => ch.charCodeAt(0) <= 0x1f)).toBe(false);
	});

	it("handles line/paragraph separator characters (U+2028, U+2029)", () => {
		const p = parseUtility("p-[20px\u2028\u2029]");
		expect(p.value).not.toContain("\u2028");
		expect(p.value).not.toContain("\u2029");
	});
});

// ---------------------------------------------------------------------------
// sanitizeVariantBracket — tested via resolveVariant / compile
// ---------------------------------------------------------------------------

describe("sanitizeVariantBracket — selector injection prevention", () => {
	it("strips curly braces from data-[] variant", () => {
		const w = resolveVariant("data-[state={open}]", theme);
		// Curly braces should be stripped or rejected
		if (w) {
			expect(w.selectorSuffix).not.toContain("{");
			expect(w.selectorSuffix).not.toContain("}");
		}
	});

	it("strips semicolons from data-[] variant", () => {
		const w = resolveVariant("data-[state=open;color:red]", theme);
		if (w) {
			expect(w.selectorSuffix).not.toContain(";");
		}
	});

	it("rejects unbalanced parentheses in has-[] (breakout attempt)", () => {
		// Unbalanced ) could close the :has() and inject arbitrary selectors
		const w = resolveVariant("has-[.foo):not(.safe]", theme);
		expect(w).toBeNull();
	});

	it("rejects unbalanced open parenthesis", () => {
		const w = resolveVariant("has-[.foo(bar]", theme);
		expect(w).toBeNull();
	});

	it("rejects empty bracket content", () => {
		const w = resolveVariant("data-[]", theme);
		// data-[] should fall through to boolean data-* path, not crash
		// The bracket content is empty after slice — sanitizeVariantBracket returns null
		expect(w).toBeNull();
	});

	it("allows balanced parentheses in has-[]", () => {
		const w = resolveVariant("has-[input:focus]", theme);
		expect(w).not.toBeNull();
		expect(w!.selectorSuffix).toContain(":has(input:focus)");
	});

	it("allows balanced nested parens in has-[]", () => {
		const w = resolveVariant("has-[:not(:disabled)]", theme);
		expect(w).not.toBeNull();
		expect(w!.selectorSuffix).toContain(":has(:not(:disabled))");
	});

	it("data-[...] with valid content compiles successfully", () => {
		const result = compile(["data-[state=open]:opacity-100"], theme);
		expect(result.rules.length).toBe(1);
		expect(result.rules[0].css).toContain("[data-state=open]");
	});

	it("aria-[...] with curly braces is sanitized", () => {
		const w = resolveVariant("aria-[label={bad}]", theme);
		if (w) {
			expect(w.selectorSuffix).not.toContain("{");
		}
	});

	it("not-[...] with unbalanced parens is rejected", () => {
		const w = resolveVariant("not-[.foo)]", theme);
		expect(w).toBeNull();
	});

	it("boolean data-* variant validates attribute name", () => {
		// Only alphanumeric + hyphens allowed
		const valid = resolveVariant("data-state", theme);
		expect(valid).not.toBeNull();
		expect(valid!.selectorSuffix).toBe("[data-state]");

		// Injection attempt via attribute name
		const invalid = resolveVariant("data-]=evil", theme);
		expect(invalid).toBeNull();
	});

	it("boolean aria-* variant validates attribute name", () => {
		const valid = resolveVariant("aria-disabled", theme);
		expect(valid).not.toBeNull();

		const invalid = resolveVariant("aria-]=evil", theme);
		expect(invalid).toBeNull();
	});
});
