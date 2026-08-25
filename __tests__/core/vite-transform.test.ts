import { describe, expect, it } from "vitest";
import rainbowindexVite from "../../src/integrations/vite.js";

type TransformFn = (code: string, id: string) => string | null;

function transform(code: string): string | null {
	const plugin = rainbowindexVite() as { transform?: unknown };
	return (plugin.transform as TransformFn)(code, "/app/src/index.css");
}

// Every input includes an RI directive so hasRIActivation() is true and the
// transform actually runs.
describe("vite transform — directive-body-scoped rewrites", () => {
	it("converts !name; removals inside key-value directive bodies", () => {
		const out = transform(`@color { !slate; brand: 0.18 330; }`);
		expect(out).toContain("--ri-rm: slate;");
		expect(out).not.toContain("!slate");
	});

	it("converts bare fluid keywords inside @fluid bodies only", () => {
		const out = transform(`@fluid { parabolic; min: 20rem; }\n.x { grid-area: parabolic; }`);
		expect(out).toContain("--ri-parabolic: true;");
		expect(out).toContain("grid-area: parabolic;");
	});

	it("rewrites bare @color option flags into --ri-* declarations", () => {
		const out = transform(`@color { theme: 0.16 222 { inline; }; }`);
		expect(out).toContain("--ri-inline: true;");
		expect(out).not.toMatch(/{\s*inline\s*;/);
	});

	it("rewrites every @color flag form (inline, no-parabolic)", () => {
		const out = transform(`@color { brand: 0.18 330 { inline; no-parabolic; }; }`);
		expect(out).toContain("--ri-inline: true;");
		expect(out).toContain("--ri-parabolic: false;");
	});

	it("leaves a `dark: shift …` override value intact (its shift is not a flag)", () => {
		// `inline` is rewritten (so the transform runs), but the `shift` inside the
		// dark override is a value token, not a standalone flag — it must survive.
		const out = transform(
			`@color { brand: 0.18 330 { inline; dark: shift chroma +0.02 hue +10; }; }`,
		);
		expect(out).toContain("--ri-inline: true;");
		expect(out).toContain("dark: shift chroma +0.02 hue +10;");
		expect(out).not.toContain("--ri-shift:");
	});

	it("copies an unclosed option block through without duplicating it", () => {
		// An unterminated `{` inside a directive body must pass through verbatim —
		// a previous per-caller brace walk re-emitted the text before it.
		const css = `@color { accent: 0.18 330 { inline`;
		const out = transform(css);
		expect(out ?? css).toBe(css);
	});

	it("does not rewrite a depth-0 color value that is a flag word", () => {
		// `muted: shift` is an alias to a color named `shift`, not an option flag —
		// only flags inside an option block are rewritten.
		const out = transform(`@color { muted: shift; brand: 0.18 330 { inline; }; }`);
		expect(out ?? "").toContain("muted: shift;");
		expect(out).toContain("--ri-inline: true;");
	});

	it("leaves !important in user CSS untouched", () => {
		const css = `@color { brand: 0.18 330; }\n.a { color: red !important; }`;
		const out = transform(css);
		expect(out ?? css).toContain("color: red !important;");
		expect(out ?? css).not.toContain("--ri-rm: important");
	});

	it("leaves keyframe and animation names like 'shift' untouched", () => {
		const css = `@color { brand: 0.18 330; }\n@keyframes shift { to { opacity: 0; } }\n.b { animation: shift 1s; }`;
		const out = transform(css);
		expect(out ?? css).toContain("@keyframes shift {");
		expect(out ?? css).toContain("animation: shift 1s;");
	});

	it("preserves !important inside @animate keyframe blocks while converting top-level removals", () => {
		const css = `@animate { !old; flash: flash 1s linear { 50% { opacity: 0 !important; } } }`;
		const out = transform(css);
		expect(out).toContain("--ri-rm: old;");
		expect(out).toContain("opacity: 0 !important;");
	});

	it("does not rewrite @utility bodies (raw CSS)", () => {
		const css = `@color { brand: 0.18 330; }\n@utility card { color: red !important; }`;
		const out = transform(css);
		expect(out ?? css).toContain("color: red !important;");
	});

	it("returns null for CSS without RI activation", () => {
		expect(transform(`.a { color: red !important; }`)).toBeNull();
	});
});
