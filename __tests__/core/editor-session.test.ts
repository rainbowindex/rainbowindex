import { describe, expect, test } from "vitest";
import { createEditorSession } from "../../src/editor/session.js";

const CSS = `
@color { brand: 0.18 330; }
@utility card { background: red; padding: 1rem; }
`;

describe("createEditorSession", () => {
	test("everything runs off one lazily analyzed theme", () => {
		const session = createEditorSession({ css: CSS });
		expect(session.inspector.validate("bg-brand-500")).toEqual({ ok: true });
		expect(session.enumerate().classes.some((c) => c.name === "card")).toBe(true);
		expect(session.tokens().colors.some((c) => c.name === "brand")).toBe(true);
		expect(session.swatch("brand", 500)?.light.hex).toMatch(/^#[0-9a-f]{6}$/);
		expect(session.diagnostics).toEqual([]);
	});

	test("merge analysis is bound to the session theme", () => {
		const session = createEditorSession({ css: CSS });
		// card claims background/padding/border-radius via the snapshot; a
		// partial override keeps it.
		expect(session.analyzeMerge(["card", "p-8"]).dropped).toEqual([]);
		expect(session.analyzeMerge(["px-2", "px-4"]).dropped).toHaveLength(1);
	});

	test("caches hold identity until setCss invalidates them", () => {
		const session = createEditorSession({ css: CSS });
		const inspector = session.inspector;
		const enumeration = session.enumerate();
		expect(session.inspector).toBe(inspector);
		expect(session.enumerate()).toBe(enumeration);

		session.setCss(CSS); // unchanged text — no invalidation
		expect(session.inspector).toBe(inspector);

		session.setCss(`@color { ocean: 0.12 220; }`);
		expect(session.inspector).not.toBe(inspector);
		expect(session.inspector.validate("bg-brand-500").ok).toBe(false);
		expect(session.inspector.validate("bg-ocean-500")).toEqual({ ok: true });
		expect(session.enumerate().classes.some((c) => c.name === "bg-ocean-500")).toBe(true);
	});

	test("diagnostics flow through with spans", () => {
		const css = `@color { brand: banana fruit; }`;
		const session = createEditorSession({ css });
		expect(session.diagnostics.length).toBeGreaterThan(0);
		const [first] = session.diagnostics;
		expect(css.slice(first.start ?? 0, first.end ?? 0).startsWith("@color")).toBe(true);
	});

	test("candidate extraction passes through", () => {
		const session = createEditorSession({ css: CSS });
		const candidates = session.extractCandidates(`<div class="flex px-2"></div>`, "a.html");
		expect(candidates.some((c) => c.value === "flex" && c.origin === "attribute")).toBe(true);
	});

	test("an empty session still works on the default theme", () => {
		const session = createEditorSession();
		expect(session.css).toBe("");
		expect(session.inspector.validate("flex")).toEqual({ ok: true });
	});
});
