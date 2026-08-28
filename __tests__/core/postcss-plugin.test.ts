import postcss from "postcss";
import { beforeEach, describe, expect, it, vi } from "vitest";
import rainbowindex from "../../src/integrations/postcss/index.js";
import { compileScannedProject } from "../../src/project/scan.js";

// Real scan by default; individual tests override it to drive the plugin's
// error-wrapping contract, which no valid CSS input can reach.
vi.mock("../../src/project/scan.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/project/scan.js")>();
	return { ...actual, compileScannedProject: vi.fn(actual.compileScannedProject) };
});

const ACTIVATE = `@import "rainbowindex";\n`;

async function compile(
	css: string,
	options: Record<string, unknown> = {},
): Promise<{ css: string; warnings: string[] }> {
	const result = await postcss([rainbowindex({ cwd: process.cwd(), ...options } as never)]).process(
		css,
		{ from: undefined },
	);
	return { css: result.css, warnings: result.warnings().map((w) => w.text) };
}

beforeEach(() => {
	vi.mocked(compileScannedProject).mockClear();
});

describe("PostCSS plugin — option validation", () => {
	it("rejects a non-string cwd with RI-0002", async () => {
		await expect(compile(ACTIVATE, { cwd: 42 })).rejects.toThrow(/\[RI-0002\]/);
	});

	it("rejects a cwd containing a null byte with RI-0002", async () => {
		await expect(compile(ACTIVATE, { cwd: "/tmp/no\0pe" })).rejects.toThrow(/\[RI-0002\]/);
	});

	it("rejects a relative cwd with RI-0002", async () => {
		await expect(compile(ACTIVATE, { cwd: "relative/dir" })).rejects.toThrow(
			/\[RI-0002\].*relative path/s,
		);
	});

	it("warns RI-1015 for an unusable @source pattern instead of failing the build", async () => {
		const { warnings } = await compile(ACTIVATE, { sources: ["src/**/*\0.tsx"] });
		expect(warnings.some((w) => w.includes("[RI-1015]"))).toBe(true);
	});
});

describe("PostCSS plugin — activation and limits", () => {
	it("leaves CSS without an activating import untouched", async () => {
		const { css } = await compile(`.x { color: red; }`);
		expect(css.trim()).toBe(`.x { color: red; }`);
		expect(compileScannedProject).not.toHaveBeenCalled();
	});

	it("warns RI-1019 and skips input past the 5 MB directive limit", async () => {
		const filler = `/* ${"x".repeat(5_242_880)} */\n`;
		const { css, warnings } = await compile(`${ACTIVATE}${filler}.x { color: red; }`);
		expect(warnings.some((w) => w.includes("[RI-1019]"))).toBe(true);
		// Nothing was generated, and the activating import survives untouched.
		expect(css).toContain('@import "rainbowindex"');
		expect(compileScannedProject).not.toHaveBeenCalled();
	});
});

describe("PostCSS plugin — CSS function compilation", () => {
	it("resolves --spacing() in user declarations", async () => {
		const { css } = await compile(`${ACTIVATE}.x { padding: --spacing(4); }`);
		expect(css).toMatch(/\.x \{\s*padding: calc\(/);
		expect(css).not.toContain("--spacing(4)");
	});

	it("resolves --alpha() against a theme color", async () => {
		const { css } = await compile(`${ACTIVATE}
			@color { brand: 0.18 330; }
			.x { color: --alpha(var(--color-brand) / 50%); }
		`);
		expect(css).not.toContain("--alpha(");
	});
});

describe("PostCSS plugin — failure wrapping", () => {
	it("passes an [RI-*] failure through unchanged", async () => {
		vi.mocked(compileScannedProject).mockRejectedValueOnce(
			new Error("[RI-1234] something specific went wrong"),
		);
		await expect(compile(ACTIVATE)).rejects.toThrow(/^\[RI-1234\] something specific went wrong$/);
	});

	it("wraps an unlabelled failure as RI-0001 with the source file", async () => {
		vi.mocked(compileScannedProject).mockRejectedValueOnce(new Error("boom"));
		await expect(compile(ACTIVATE)).rejects.toThrow(/\[RI-0001\].*failed at.*: boom/s);
	});

	it("keeps the original error as `cause`", async () => {
		const original = new Error("boom");
		vi.mocked(compileScannedProject).mockRejectedValueOnce(original);
		await expect(compile(ACTIVATE)).rejects.toMatchObject({ cause: original });
	});

	it("adds line/column and a syntax hint for a CssSyntaxError", async () => {
		const err = Object.assign(new Error("Unclosed block"), {
			name: "CssSyntaxError",
			line: 7,
			column: 12,
		});
		vi.mocked(compileScannedProject).mockRejectedValueOnce(err);
		await expect(compile(ACTIVATE)).rejects.toThrow(/:7:12.*CSS syntax error/s);
	});

	it("adds a @source hint when the failure mentions a glob", async () => {
		vi.mocked(compileScannedProject).mockRejectedValueOnce(new Error("bad glob given"));
		await expect(compile(ACTIVATE)).rejects.toThrow(/glob\/source error/);
	});

	it("stringifies a non-Error rejection", async () => {
		vi.mocked(compileScannedProject).mockRejectedValueOnce("just a string");
		await expect(compile(ACTIVATE)).rejects.toThrow(/\[RI-0001\].*just a string/s);
	});
});
