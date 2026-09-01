import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileProject } from "../../src/project/index.js";
import { compileScannedProject } from "../../src/project/scan.js";
import { isSuppressible, parseEntryDisables } from "../../src/directives/suppress.js";
import { pushWarningsDeduped } from "../../src/warnings.js";

/** Warnings of one code, from a CSS entry with no source files. */
const codes = async (css: string): Promise<string[]> => {
	const result = await compileProject({ css, sources: [] });
	return result.warnings.map((w) => w.slice(1, 8));
};

// Two RI-1124 warnings, one per directive — the baseline every case below trims.
const TWO = "@rounded { full: 30px; }\n@shadow { none: 0 0 1px red; }";

describe("ri-disable", () => {
	it("warns twice with no comment", async () => {
		expect(await codes(TWO)).toEqual(["RI-1124", "RI-1124"]);
	});

	it("silences a code for the whole file", async () => {
		expect(await codes(`/* ri-disable RI-1124 */\n${TWO}`)).toEqual([]);
	});

	it("takes several codes in one comment", async () => {
		expect(
			await codes("/* ri-disable RI-1124, RI-1122 */\n@rounded { full: 30px; --nope: 1; }"),
		).toEqual([]);
	});

	it("reaches codes no stylesheet position could reach", () => {
		// Scanner and compile warnings carry no CSS position, so only the
		// file-wide form can silence them. They all pass through this one funnel,
		// which every stage now calls with the file's suppressed set.
		const target: string[] = [];
		pushWarningsDeduped(
			target,
			["[RI-1401] No source files found.", "[RI-1403] Could not read source file."],
			new Set(),
			new Set(["RI-1401"]),
		);
		expect(target).toEqual(["[RI-1403] Could not read source file."]);
	});

	it("refuses to silence a high-severity code", async () => {
		const warnings = await codes("/* ri-disable RI-2001 */\n@rounded { roof: 1px; }");
		expect(warnings).toEqual(["RI-1040"]);
	});

	it("warns on a comment it cannot read", async () => {
		expect(await codes("/* ri-disable nonsense */\n@rounded { roof: 1px; }")).toEqual(["RI-1040"]);
	});

	it("warns on a bare `ri-disable` and silences nothing", async () => {
		expect(await codes("/* ri-disable */\n@rounded { full: 30px; }")).toEqual([
			"RI-1124",
			"RI-1040",
		]);
	});
});

describe("ri-disable-next-line", () => {
	it("pins one entry inside a body and leaves its siblings checked", async () => {
		const css = `@rounded {
			/* ri-disable-next-line RI-1124 */
			full: 30px;
			none: 4px;
		}`;
		const result = await compileProject({ css, sources: [] });
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('"rounded-none"');
	});

	it("guards the next directive when it sits outside a body", async () => {
		const result = await compileProject({
			css: `/* ri-disable-next-line RI-1124 */\n${TWO}`,
			sources: [],
		});
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('"shadow-none"');
	});

	it("does not leak from inside a body to a later directive", async () => {
		// The pragma names an entry in its own block. A `@shadow` block further
		// down must keep its warning.
		const css = `@rounded {
			/* ri-disable-next-line RI-1124 */
			full: 30px;
		}
		@shadow { none: 0 0 1px red; }`;
		const result = await compileProject({ css, sources: [] });
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('"shadow-none"');
	});

	it("silences a parse-time code inside the directive it guards", async () => {
		const noisy = "@rounded { --nope: 1; }";
		expect(await codes(noisy)).toEqual(["RI-1122"]);
		expect(await codes(`/* ri-disable-next-line RI-1122 */\n${noisy}`)).toEqual([]);
	});
});

describe("pragma parsing", () => {
	it("does not read `ri-disable-next-line` as the file-wide form", async () => {
		// `ri-disable` needs whitespace after it, so the longer word cannot match
		// the shorter pattern — otherwise every next-line comment would silence
		// its code for the whole file.
		const result = await compileProject({
			css: `/* ri-disable-next-line RI-1124 */\n${TWO}`,
			sources: [],
		});
		expect(result.warnings).toHaveLength(1);
	});

	it("names the entry that follows, skipping comments and blank lines", () => {
		const disables = parseEntryDisables(
			"roof: 1px;\n/* ri-disable-next-line RI-1124 */\n\n/* why */\nfull: 30px;",
		);
		expect(disables.get("RI-1124")).toEqual(new Set(["full"]));
	});

	it("names a functional block", () => {
		const disables = parseEntryDisables(
			"/* ri-disable-next-line RI-1035 */\nroof-minus-* { border-radius: 0; }",
		);
		expect(disables.get("RI-1035")).toEqual(new Set(["roof-minus-*"]));
	});

	it("treats only RI-00xx and RI-20xx as unsilenceable", () => {
		expect(isSuppressible("RI-1124")).toBe(true);
		expect(isSuppressible("RI-1401")).toBe(true);
		expect(isSuppressible("RI-0001")).toBe(false);
		expect(isSuppressible("RI-2001")).toBe(false);
	});

	// The resolver only ever sees directive bodies, so nothing read a pragma
	// that sits outside one — a typo there was silently ignored.
	it("reports an unreadable next-line comment outside every directive body", async () => {
		expect(await codes(`/* ri-disable-next-line nonsense */\n${TWO}`)).toContain("RI-1040");
	});

	it("reports an unsilenceable code named outside every directive body", async () => {
		expect(await codes(`/* ri-disable-next-line RI-0001 */\n${TWO}`)).toContain("RI-1040");
	});

	it("reports an in-body pragma's RI-1040 once, not once per reader", async () => {
		const warnings = await codes("@rounded {\n/* ri-disable-next-line nonsense */\nfull: 30px;\n}");
		expect(warnings.filter((c) => c === "RI-1040")).toEqual(["RI-1040"]);
	});
});

// Scan warnings (RI-14xx) carry no position in the CSS, so the file-wide
// comment is the only form that can reach them. It reached them on the headless
// path but not on the scanned one, which is what every real surface uses.
describe("ri-disable on the scanned path", () => {
	const OVERLY_NESTED = "a:{a:{a:{a:{a:{a:{a:{a:{a:{a:{a:{x}}}}}}}}}}}";

	const scanWith = async (css: string): Promise<string[]> => {
		const dir = join(
			tmpdir(),
			`ri-suppress-scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		);
		mkdirSync(join(dir, "src"), { recursive: true });
		try {
			writeFileSync(join(dir, "src", "App.tsx"), `<div className="${OVERLY_NESTED}" />`);
			const { compiled } = await compileScannedProject({
				css: `${css}\n@source "src/**/*.tsx";`,
				cwd: dir,
				onInvalidPattern: () => undefined,
				resolveFonts: async () => new Map(),
			});
			return compiled.warnings;
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	};

	it("warns without the comment", async () => {
		expect((await scanWith("")).filter((w) => w.includes("[RI-1409]"))).toHaveLength(1);
	});

	it("silences a scanner code for the whole file", async () => {
		expect(
			(await scanWith("/* ri-disable RI-1409 */")).filter((w) => w.includes("[RI-1409]")),
		).toEqual([]);
	});
});
