/**
 * The directive-syntax compatibility matrix, as a test.
 *
 * Four of the current directive spellings are not valid CSS, and the argument
 * for changing them is only as good as the evidence that the replacements are
 * better. A matrix in a document goes stale the first time a parser ships a
 * release; this one is re-measured on every run.
 *
 * Two claims are pinned:
 *
 *   1. Every **canonical** (proposed) spelling parses in all eight parsers.
 *      That is the acceptance bar a canonical spelling has to clear, and a
 *      candidate that fails one cell is not a candidate.
 *   2. Every **current** spelling is rejected by exactly the parsers recorded
 *      here. The list is evidence, not decoration — a parser that starts
 *      accepting one of these (or starts rejecting something else) shows up as
 *      a failing assertion naming it, which is the only way the RFC's premise
 *      stays honest.
 *
 * Lightning CSS and esbuild appear in the matrix and reject nothing: both skip
 * an unknown at-rule's body wholesale rather than parsing it. That is why the
 * build has always worked while the formatters have not.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repoFile = (rel: string): string => fileURLToPath(new URL(`../../${rel}`, import.meta.url));

type Status = "current" | "canonical";

interface Sample {
	id: string;
	/** The RFC section this sample belongs to. */
	form: string;
	status: Status;
	css: string;
}

const SAMPLES: readonly Sample[] = [
	// --- control -----------------------------------------------------------
	{
		id: "control-plain-css",
		form: "control",
		status: "canonical",
		css: ".a {\n\tcolor: red;\n}\n",
	},
	{
		id: "control-directive",
		form: "control",
		status: "canonical",
		css: "@color {\n\tbrand: 0.18 330;\n}\n",
	},

	// --- Form A: a block after a declaration --------------------------------
	{
		id: "font-google-current",
		form: "block-after-declaration",
		status: "current",
		css: '@font {\n\tsans: "Inter", ui-sans-serif from google { weight: 400 700; }\n}\n',
	},
	{
		id: "font-google-canonical",
		form: "block-after-declaration",
		status: "canonical",
		css: '@font {\n\tsans {\n\t\tfamily: "Inter", ui-sans-serif, sans-serif;\n\t\tfrom: google;\n\t\tweight: 400 700;\n\t}\n}\n',
	},
	{
		id: "font-faces-current",
		form: "block-after-declaration",
		status: "current",
		css: '@font {\n\tdisplay: "Satoshi" {\n\t\tweight: 300 900;\n\t\tface: /fonts/Satoshi.woff2;\n\t\tface: /fonts/Satoshi-Italic.woff2 { style: italic; }\n\t}\n}\n',
	},
	{
		id: "font-faces-canonical",
		form: "block-after-declaration",
		status: "canonical",
		css: '@font {\n\tdisplay {\n\t\tfamily: "Satoshi";\n\t\tweight: 300 900;\n\t\tface { src: url("/fonts/Satoshi.woff2"); }\n\t\tface { src: url("/fonts/Satoshi-Italic.woff2"); style: italic; }\n\t}\n}\n',
	},
	{
		id: "animate-current",
		form: "block-after-declaration",
		status: "current",
		css: "@animate {\n\tshimmer: 2s linear infinite {\n\t\tfrom { background-position: 200% 0; }\n\t\tto { background-position: -200% 0; }\n\t}\n}\n",
	},
	{
		id: "animate-canonical",
		form: "block-after-declaration",
		status: "canonical",
		css: "@animate {\n\tshimmer {\n\t\tanimation: 2s linear infinite;\n\t\t@keyframes shimmer {\n\t\t\t0% { background-position: 200% 0; }\n\t\t\t100% { background-position: -200% 0; }\n\t\t}\n\t}\n}\n",
	},

	// --- Form B: removal ----------------------------------------------------
	{
		id: "removal-current",
		form: "removal",
		status: "current",
		css: "@color {\n\t!brand;\n}\n",
	},
	{
		id: "removal-canonical",
		form: "removal",
		status: "canonical",
		css: "@color {\n\tbrand: initial;\n}\n",
	},

	// --- Form C: a bare keyword --------------------------------------------
	{
		id: "fluid-keyword-current",
		form: "bare-keyword",
		status: "current",
		css: "@fluid {\n\tmin: 20rem;\n\tmax: 80rem;\n\tparabolic;\n}\n",
	},
	{
		id: "fluid-keyword-canonical",
		form: "bare-keyword",
		status: "canonical",
		css: "@fluid {\n\tmin: 20rem;\n\tmax: 80rem;\n\tparabolic: true;\n}\n",
	},
	{
		id: "color-options-current",
		form: "bare-keyword",
		status: "current",
		css: "@color {\n\tpunchy: 0.18 330 { inline; dark: shift chroma +0.02 hue +10; }\n}\n",
	},
	{
		id: "color-options-canonical",
		form: "bare-keyword",
		status: "canonical",
		css: "@color {\n\tpunchy {\n\t\tramp: 0.18 330;\n\t\tinline: true;\n\t\tdark: shift chroma +0.02 hue +10;\n\t}\n}\n",
	},

	// --- Form D: a variant group inside @apply ------------------------------
	{
		id: "apply-group-current",
		form: "apply-variant-group",
		status: "current",
		css: ".btn {\n\t@apply hover:{px-2 py-1};\n}\n",
	},
	{
		id: "apply-group-canonical",
		form: "apply-variant-group",
		status: "canonical",
		css: ".btn {\n\t@apply px-2 hover:(bg-red-500 underline) sm:(p-4 gap-2);\n}\n",
	},

	// --- Already-valid forms, kept so a regression in them is visible -------
	{
		id: "utility-block",
		form: "already-valid",
		status: "canonical",
		css: "@utility card {\n\tbackground: var(--color-paper);\n\tpadding: 1rem;\n}\n",
	},
	{
		id: "custom-variant-block",
		form: "already-valid",
		status: "canonical",
		css: "@custom hocus {\n\t&:hover,\n\t&:focus-visible { @slot; }\n}\n",
	},
	{
		id: "source-inline",
		form: "already-valid",
		status: "canonical",
		css: '@source inline("underline text-brand-500");\n',
	},
	{
		id: "register-block",
		form: "already-valid",
		status: "canonical",
		css: '@register --ri-x {\n\tsyntax: "<length>";\n\tinherits: false;\n\tinitial-value: 0px;\n}\n',
	},
];

const PARSERS = [
	"postcss",
	"prettier",
	"stylelint",
	"lightningcss",
	"esbuild",
	"vscode",
	"oxfmt",
	"biome",
] as const;
type Parser = (typeof PARSERS)[number];

/** parser → the sample ids it refuses to parse. Filled by the probe below. */
const rejects = new Map<Parser, Set<string>>(PARSERS.map((p) => [p, new Set<string>()]));

const OXFMT_BIN = repoFile("node_modules/.bin/oxfmt");
const BIOME_BIN = repoFile("node_modules/.bin/biome");
/** Both are native binaries; a platform without one is a skip, not a failure. */
const haveOxfmt = existsSync(OXFMT_BIN);
const haveBiome = existsSync(BIOME_BIN);

function reject(parser: Parser, id: string): void {
	rejects.get(parser)?.add(id);
}

/** Which parsers rejected this sample, in matrix order. */
function rejectedBy(id: string): Parser[] {
	return PARSERS.filter((p) => rejects.get(p)?.has(id));
}

/** The slice of biome's (experimental) JSON report this reads. */
interface BiomeReport {
	summary: { diagnosticsNotPrinted: number };
	diagnostics: Array<{ category: string; location: { path: string } }>;
}

/** Strip ANSI colour so a diagnostic can be matched by shape. */
function plain(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI is the point.
	return text.replace(/\[[0-9;]*m/g, "");
}

beforeAll(async () => {
	// --- in-process parsers ------------------------------------------------
	const [{ default: postcss }, prettier, stylelintNs, lightning, esbuild, cssService, textDoc] =
		await Promise.all([
			import("postcss"),
			import("prettier"),
			import("stylelint"),
			import("lightningcss"),
			import("esbuild"),
			import("vscode-css-languageservice"),
			import("vscode-languageserver-textdocument"),
		]);
	const stylelint = stylelintNs.default;
	const service = cssService.getCSSLanguageService();

	for (const { id, css } of SAMPLES) {
		try {
			postcss.parse(css, { from: `${id}.css` });
		} catch {
			reject("postcss", id);
		}

		try {
			await prettier.format(css, { parser: "css" });
		} catch {
			reject("prettier", id);
		}

		const linted = await stylelint.lint({
			code: css,
			config: { rules: {} },
			codeFilename: "a.css",
		});
		const result = linted.results[0];
		const syntaxErrors = (result?.warnings ?? []).filter((w) => w.rule === "CssSyntaxError");
		if ((result?.parseErrors ?? []).length + syntaxErrors.length > 0) reject("stylelint", id);

		try {
			lightning.transform({ filename: "a.css", code: Buffer.from(css), minify: false });
		} catch {
			reject("lightningcss", id);
		}

		try {
			const out = await esbuild.transform(css, { loader: "css", logLevel: "silent" });
			if ((out.warnings ?? []).length > 0) reject("esbuild", id);
		} catch {
			reject("esbuild", id);
		}

		// The VS Code CSS service warns "Unknown at rule" for every directive,
		// which is a lint opinion rather than a parse failure. Only errors count.
		const doc = textDoc.TextDocument.create("file:///a.css", "css", 1, css);
		const diagnostics = service.doValidation(doc, service.parseStylesheet(doc));
		if (diagnostics.some((d) => d.severity === 1)) reject("vscode", id);
	}

	// --- spawned formatters, one run each ----------------------------------
	const dir = mkdtempSync(join(tmpdir(), "ri-rfc0001-"));
	const write = (): void => {
		for (const { id, css } of SAMPLES) writeFileSync(join(dir, `${id}.css`), css);
	};
	write();

	if (haveOxfmt) {
		// oxfmt rewrites in place, so a reformat is acceptance; only a file it
		// names in a diagnostic is a rejection.
		let output = "";
		try {
			execFileSync(
				OXFMT_BIN,
				SAMPLES.map(({ id }) => join(dir, `${id}.css`)),
				{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
			);
		} catch (error) {
			const err = error as { stdout?: string; stderr?: string };
			output = plain(`${err.stdout ?? ""}${err.stderr ?? ""}`);
		}
		for (const { id } of SAMPLES) {
			if (output.includes(`${id}.css`)) reject("oxfmt", id);
		}
		write(); // restore the originals for biome
	}

	if (haveBiome) {
		// `tailwindDirectives` is required for `@apply` / `@utility` / `@source`
		// in ANY spelling — Tailwind's own included — so it is part of the
		// baseline rather than something a spelling could avoid. See the RFC.
		writeFileSync(
			join(dir, "biome.json"),
			JSON.stringify({
				linter: { enabled: false },
				formatter: { enabled: true },
				css: { parser: { tailwindDirectives: true } },
			}),
		);
		let output = "";
		try {
			output = execFileSync(
				BIOME_BIN,
				["format", ".", "--reporter=json", "--max-diagnostics=200"],
				{ cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
			);
		} catch (error) {
			// biome exits non-zero on a formatting diff too, so the exit code
			// says nothing; the report is on stdout either way.
			output = String((error as { stdout?: string }).stdout ?? "");
		}
		// The JSON reporter rather than the human one, because the human one
		// caps at 20 diagnostics by default: with a file per sample, most of
		// them reformatted, the cap silently swallowed real parse errors and
		// the matrix reported a form as *accepted* that biome had rejected.
		const report = JSON.parse(output) as BiomeReport;
		expect(
			report.summary.diagnosticsNotPrinted,
			"biome truncated its report; the matrix would under-report rejections",
		).toBe(0);
		for (const diagnostic of report.diagnostics) {
			if (diagnostic.category !== "parse") continue;
			const id = diagnostic.location.path.replace(/^\.\//, "").replace(/\.css$/, "");
			reject("biome", id);
		}
	}
}, 60_000);

const canonical = SAMPLES.filter((s) => s.status === "canonical");
const current = SAMPLES.filter((s) => s.status === "current");

describe("every canonical spelling parses in every parser", () => {
	for (const sample of canonical) {
		it(`${sample.form}: ${sample.id}`, () => {
			expect(
				rejectedBy(sample.id),
				`${sample.id} is the canonical spelling; a parser that rejects it disqualifies it.\n${sample.css}`,
			).toEqual([]);
		});
	}
});

/**
 * The evidence table. Each entry is what the RFC's matrix reports, so a
 * changed parser shows up here first and the document can be corrected.
 */
const EXPECTED_REJECTIONS: Record<string, Parser[]> = {
	// A block after a declaration is still a *declaration* to postcss and to
	// everything built on it, which is why the build has always worked and
	// `vp check` has not: only the two Rust formatters read the body as CSS.
	"font-google-current": ["oxfmt", "biome"],
	"font-faces-current": ["oxfmt", "biome"],
	"animate-current": ["oxfmt", "biome"],
	// The other three forms are not declarations at all, so postcss — and
	// Prettier and Stylelint, which parse CSS with it — reject them too.
	"removal-current": ["postcss", "prettier", "stylelint", "oxfmt", "biome"],
	"fluid-keyword-current": ["postcss", "prettier", "stylelint", "oxfmt", "biome"],
	"color-options-current": ["postcss", "prettier", "stylelint", "oxfmt", "biome"],
	"apply-group-current": ["postcss", "prettier", "stylelint", "oxfmt", "biome"],
};

describe("every current spelling is rejected by the parsers the RFC names", () => {
	for (const sample of current) {
		it(`${sample.form}: ${sample.id}`, () => {
			const expected = EXPECTED_REJECTIONS[sample.id];
			expect(expected, `no expected-rejection row for ${sample.id}`).toBeDefined();
			const skipped = new Set<Parser>();
			if (!haveOxfmt) skipped.add("oxfmt");
			if (!haveBiome) skipped.add("biome");
			expect(rejectedBy(sample.id)).toEqual(expected.filter((p) => !skipped.has(p)));
		});
	}
});

describe("the matrix itself", () => {
	it("measured both native formatters", () => {
		// A silent skip would turn the RFC's strongest column into no column at
		// all. Fail loudly on the platforms that do have them — which is every
		// platform CI runs on.
		expect(
			haveOxfmt && haveBiome,
			"oxfmt and/or biome is not installed for this platform; the matrix is incomplete",
		).toBe(true);
	});

	it("finds no parser that rejects an already-valid form", () => {
		for (const sample of SAMPLES.filter((s) => s.form === "already-valid")) {
			expect(rejectedBy(sample.id), sample.id).toEqual([]);
		}
	});

	it("lightningcss and esbuild reject nothing, which is why builds pass", () => {
		expect([...(rejects.get("lightningcss") ?? [])]).toEqual([]);
		expect([...(rejects.get("esbuild") ?? [])]).toEqual([]);
	});
});
