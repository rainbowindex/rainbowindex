/**
 * RI-1002 accuses a class of being a typo, so it must only fire for classes the
 * user wrote by hand. Scanning reads whole files, prose comments included.
 */
import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject } from "../../src/project/index.js";
import { compileScannedProject } from "../../src/project/scan.js";
import { createCompiler } from "../../src/engine/index.js";
import { extractDirectives, resolveDirectives } from "../../src/directives/index.js";

const theme = resolveDirectives(extractDirectives("", []));
const ri1002 = (warnings: readonly string[]): string[] =>
	warnings.filter((w) => w.includes("RI-1002"));

function projectWith(fileContent: string): string {
	const dir = mkdtempSync(join(tmpdir(), "ri-provenance-"));
	mkdirSync(join(dir, "src"));
	writeFileSync(join(dir, "src", "app.tsx"), fileContent);
	return dir;
}

describe("RI-1002 provenance", () => {
	test("stays silent for a bracket token found in a code comment", async () => {
		const cwd = projectWith(
			'// Arbitrary variants ([&>p], min-[437px]) form an unbounded memo cache.\nexport const A = () => <div className="p-4">hi</div>;\n',
		);
		const { compiled } = await compileScannedProject({
			css: '@import "rainbowindex";',
			cwd,
			sources: [],
		});
		expect(ri1002(compiled.warnings)).toEqual([]);
	});

	test("still reports a class written in @source inline", async () => {
		const cwd = projectWith("export const A = 1;\n");
		const { compiled } = await compileScannedProject({
			css: '@import "rainbowindex";\n@source inline("xyzunknown-[notavalue]");',
			cwd,
			sources: [],
		});
		expect(ri1002(compiled.warnings)).toHaveLength(1);
		expect(ri1002(compiled.warnings)[0]).toContain("xyzunknown-[notavalue]");
	});

	test("still reports a class written in @apply", async () => {
		const cwd = projectWith("export const A = 1;\n");
		const { compiled } = await compileScannedProject({
			css: '@import "rainbowindex";\n.x { @apply xyzunknown-[notavalue]; }',
			cwd,
			sources: [],
		});
		expect(ri1002(compiled.warnings)).toHaveLength(1);
	});

	test("compileProject separates its class list from its scanned sources", async () => {
		const scanned = await compileProject({
			css: '@import "rainbowindex";',
			sources: [{ path: "a.tsx", content: "// see min-[437px] and xyzunknown-[notavalue]" }],
		});
		expect(ri1002(scanned.warnings)).toEqual([]);

		const listed = await compileProject({
			css: '@import "rainbowindex";',
			classNames: ["xyzunknown-[notavalue]"],
		});
		expect(ri1002(listed.warnings)).toHaveLength(1);
	});

	test("compile() without an authored set treats every class as authored", () => {
		const result = createCompiler().compile(["xyzunknown-[notavalue]"], theme);
		expect(ri1002(result.warnings)).toHaveLength(1);
	});

	test("one class compiled under both provenances warns once, not never", () => {
		const compiler = createCompiler();
		const scannedOnly = compiler.compile(["xyzunknown-[notavalue]"], theme, new Set<string>());
		expect(ri1002(scannedOnly.warnings)).toEqual([]);
		// The memo is shared across compiles; provenance must not be baked into it.
		const authoredToo = compiler.compile(
			["xyzunknown-[notavalue]"],
			theme,
			new Set(["xyzunknown-[notavalue]"]),
		);
		expect(ri1002(authoredToo.warnings)).toHaveLength(1);
	});
});
