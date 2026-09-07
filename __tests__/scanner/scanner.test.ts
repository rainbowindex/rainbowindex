import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
	expandGroupsInStylesheet,
	expandVariantGroups,
	extractClasses,
	extractClassesFromSource,
} from "../../src/scanner/class-extraction.js";
import { MAX_LINE_LENGTH } from "../../src/scanner/collectors.js";
import {
	disableScanChangeTracking,
	enableScanChangeTracking,
	markSourceFileChanged,
	resolveSourceFilesAsync,
	scanSourceFilesAsync,
} from "../../src/scanner/sources.js";

// ---------------------------------------------------------------------------
// Variant group expansion
// ---------------------------------------------------------------------------

describe("expandVariantGroups", () => {
	test("single variant group", () => {
		expect(expandVariantGroups("hover:{text-red-500 bg-blue-100 underline}")).toBe(
			"hover:text-red-500 hover:bg-blue-100 hover:underline",
		);
	});

	test("chained variant group", () => {
		expect(expandVariantGroups("sm:hover:{bg-gray-700 text-white}")).toBe(
			"sm:hover:bg-gray-700 sm:hover:text-white",
		);
	});

	test("multiple groups in one string", () => {
		expect(
			expandVariantGroups(
				"focus:{outline-2 outline-blue-500} disabled:{opacity-50 cursor-not-allowed}",
			),
		).toBe(
			"focus:outline-2 focus:outline-blue-500 disabled:opacity-50 disabled:cursor-not-allowed",
		);
	});

	test("responsive group", () => {
		expect(expandVariantGroups("md:{flex gap-4 items-center}")).toBe(
			"md:flex md:gap-4 md:items-center",
		);
	});

	test("dark mode group", () => {
		expect(expandVariantGroups("dark:{bg-gray-900 text-white}")).toBe(
			"dark:bg-gray-900 dark:text-white",
		);
	});

	test("no groups — returns unchanged", () => {
		expect(expandVariantGroups("flex items-center p-4")).toBe("flex items-center p-4");
	});

	test("group with single class", () => {
		expect(expandVariantGroups("hover:{underline}")).toBe("hover:underline");
	});

	test("mixed groups and normal classes", () => {
		expect(expandVariantGroups("flex hover:{bg-blue text-white} p-4")).toBe(
			"flex hover:bg-blue hover:text-white p-4",
		);
	});

	test("group with extra whitespace", () => {
		expect(expandVariantGroups("hover:{  a   b  }")).toBe("hover:a hover:b");
	});

	test("returns verbatim and warns when input exceeds expansion limit", () => {
		const input = `${"a".repeat(500_001)}{`;
		const warnings: string[] = [];

		expect(expandVariantGroups(input, warnings)).toBe(input);
		expect(warnings).toEqual([expect.stringContaining("[RI-1407]")]);
	});

	test("warns when expansion growth exceeds the safety limit", () => {
		// Each group copies a 12-character prefix onto 5,000 members and consumes
		// 10,014 characters of input, so it adds 59,985. The first fits; the second
		// would reach 119,970, so it and everything after it stay verbatim.
		const group = `hover:focus:{${"a ".repeat(5_000)}}`;
		const input = `${group} ${group} ${group}`;
		const warnings: string[] = [];
		const expanded = expandVariantGroups(input, warnings);

		expect(warnings).toEqual([expect.stringContaining("[RI-1408]")]);
		expect(expanded).toContain("hover:focus:a");
		// An unexpanded group keeps its brace, so the brace count is how many were
		// left alone — the assertion the old comment's "third" claim needed.
		expect(expanded.split("hover:focus:{").length - 1).toBe(2);
	});

	// The budget bounds what expansion ADDS. Counting plain pass-through text
	// against it made every source file over 100,000 characters warn, since a
	// lone `{` anywhere is enough to start the walk.
	test("does not warn on a large file that holds no variant groups", () => {
		const input = `const x = { a: 1 };\n${"// a plain line with no variant group in it\n".repeat(4_000)}`;
		const warnings: string[] = [];

		expect(input.length).toBeGreaterThan(100_000);
		expect(expandVariantGroups(input, warnings)).toBe(input);
		expect(warnings).toEqual([]);
	});

	// One group copies its prefix onto every member, so it can outgrow the whole
	// budget by itself. Sizing it only between groups would build the string the
	// budget exists to prevent before noticing.
	test("leaves a single over-budget group unexpanded", () => {
		const prefix = `${"x".repeat(2_000)}:`;
		const input = `${prefix}{${"a ".repeat(2_000)}}`;
		const warnings: string[] = [];

		expect(expandVariantGroups(input, warnings)).toBe(input);
		expect(warnings).toEqual([expect.stringContaining("[RI-1408]")]);
	});

	test("names the source file in expansion warnings", () => {
		const warnings: string[] = [];
		expandVariantGroups("a:{a:{a:{a:{a:{a:{a:{a:{a:{a:{a:{x}}}}}}}}}}}", warnings, "src/App.tsx");

		expect(warnings).toEqual([expect.stringContaining("[RI-1409] src/App.tsx:")]);
	});

	test("warns and leaves overly nested groups unexpanded", () => {
		const input = "a:{a:{a:{a:{a:{a:{a:{a:{a:{a:{a:{x}}}}}}}}}}}";
		const warnings: string[] = [];
		const expanded = expandVariantGroups(input, warnings);

		expect(expanded.startsWith("a:{a:")).toBe(true);
		expect(expanded).toContain("x");
		expect(expanded).toContain("{");
		expect(warnings).toEqual([expect.stringContaining("[RI-1409]")]);
	});

	test("ignores braces inside arbitrary values while expanding", () => {
		expect(expandVariantGroups("hover:{content-['{'] bg-red-500}")).toBe(
			"hover:content-['{'] hover:bg-red-500",
		);
	});
});

// ---------------------------------------------------------------------------
// @apply group expansion
// ---------------------------------------------------------------------------

describe("expandGroupsInStylesheet", () => {
	test("expands a group inside @apply", () => {
		const css = `[data-slot="content-wrapper"] {\n\t@apply hover:{flex-1 z-10 p-4};\n}`;
		expect(expandGroupsInStylesheet(css)).toBe(
			`[data-slot="content-wrapper"] {\n\t@apply hover:flex-1 hover:z-10 hover:p-4;\n}`,
		);
	});

	test("expands a group inside @a alias", () => {
		const css = `.foo { @a hover:{px-2 leading-none}; }`;
		expect(expandGroupsInStylesheet(css)).toBe(`.foo { @a hover:px-2 hover:leading-none; }`);
	});

	test("expands multiple groups across multiple rules", () => {
		const css = `.a { @apply focus:{outline-2 outline-blue-500}; }\n.b { @a disabled:{opacity-50 cursor-not-allowed}; }`;
		expect(expandGroupsInStylesheet(css)).toBe(
			`.a { @apply focus:outline-2 focus:outline-blue-500; }\n.b { @a disabled:opacity-50 disabled:cursor-not-allowed; }`,
		);
	});

	test("expands chained variants", () => {
		const css = `.foo { @apply sm:hover:{bg-gray-700 text-white}; }`;
		expect(expandGroupsInStylesheet(css)).toBe(
			`.foo { @apply sm:hover:bg-gray-700 sm:hover:text-white; }`,
		);
	});

	test("leaves @apply without group syntax untouched", () => {
		const css = `.foo { @apply flex items-center p-4; }`;
		expect(expandGroupsInStylesheet(css)).toBe(css);
	});

	test("leaves CSS without @apply untouched", () => {
		const css = `.foo { color: red; padding: 4px; }\n.bar:hover { background: blue; }`;
		expect(expandGroupsInStylesheet(css)).toBe(css);
	});

	test("does not touch braces in regular CSS rules", () => {
		const css = `.foo:hover { color: red; } .bar { @apply hover:{flex-1}; } .baz { color: blue; }`;
		expect(expandGroupsInStylesheet(css)).toBe(
			`.foo:hover { color: red; } .bar { @apply hover:flex-1; } .baz { color: blue; }`,
		);
	});

	test("returns input verbatim when no @ or { present", () => {
		expect(expandGroupsInStylesheet(".foo { color: red; }")).toBe(".foo { color: red; }");
		expect(expandGroupsInStylesheet("/* nothing here */")).toBe("/* nothing here */");
	});
});

// ---------------------------------------------------------------------------
// Class extraction
// ---------------------------------------------------------------------------

describe("extractClasses", () => {
	test("extracts from HTML class attribute", () => {
		const source = '<div class="flex items-center p-4">';
		const classes = extractClasses(source);
		expect(classes).toContain("flex");
		expect(classes).toContain("items-center");
		expect(classes).toContain("p-4");
	});

	test("extracts from JSX className", () => {
		const source = '<div className="bg-blue-500 text-white">';
		const classes = extractClasses(source);
		expect(classes).toContain("bg-blue-500");
		expect(classes).toContain("text-white");
	});

	test("extracts from template literals", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture string deliberately contains a literal ${...} to exercise template-literal class extraction
		const source = 'const cls = `flex ${isActive ? "bg-blue-500" : "bg-gray-200"}`';
		const classes = extractClasses(source);
		expect(classes).toContain("flex");
		expect(classes).toContain("bg-blue-500");
		expect(classes).toContain("bg-gray-200");
	});

	test("extracts variant-prefixed classes", () => {
		const source = '<div class="hover:bg-blue-500 sm:flex dark:text-white">';
		const classes = extractClasses(source);
		expect(classes).toContain("hover:bg-blue-500");
		expect(classes).toContain("sm:flex");
		expect(classes).toContain("dark:text-white");
	});

	test("extracts negative values", () => {
		const source = '<div class="-translate-x-4 -mt-2">';
		const classes = extractClasses(source);
		expect(classes).toContain("-translate-x-4");
		expect(classes).toContain("-mt-2");
	});

	test("extracts arbitrary values", () => {
		const source = '<div class="p-[20px] bg-[#ff0000] w-[calc(100%-2rem)]">';
		const classes = extractClasses(source);
		expect(classes).toContain("p-[20px]");
		expect(classes).toContain("bg-[#ff0000]");
		expect(classes).toContain("w-[calc(100%-2rem)]");
	});

	test("extracts important suffix", () => {
		const source = '<div class="font-bold! p-4!">';
		const classes = extractClasses(source);
		expect(classes).toContain("font-bold!");
		expect(classes).toContain("p-4!");
	});

	test("extracts fractions", () => {
		const source = '<div class="w-1/2 w-2/3">';
		const classes = extractClasses(source);
		expect(classes).toContain("w-1/2");
		expect(classes).toContain("w-2/3");
	});

	test("extracts from single quotes", () => {
		const source = "<div class='flex p-4'>";
		const classes = extractClasses(source);
		expect(classes).toContain("flex");
		expect(classes).toContain("p-4");
	});

	test("expands variant groups during extraction", () => {
		const source = '<div class="hover:{bg-blue-500 text-white}">';
		const classes = extractClasses(source);
		expect(classes).toContain("hover:bg-blue-500");
		expect(classes).toContain("hover:text-white");
	});

	test("deduplicates classes", () => {
		const source = '<div class="flex p-4 flex p-4">';
		const classes = extractClasses(source);
		expect(classes).toContain("flex");
		expect(classes).toContain("p-4");
		// Both flex and p-4 appear twice in source but should only be in set once
		const flexCount = [...classes].filter((c) => c === "flex").length;
		expect(flexCount).toBe(1);
	});

	test("extracts @container classes", () => {
		const source = '<div class="@container @md:flex">';
		const classes = extractClasses(source);
		expect(classes).toContain("@container");
		expect(classes).toContain("@md:flex");
	});

	test("handles Vue template", () => {
		const source = `
<template>
  <div :class="['flex', isActive && 'bg-blue-500']">
    <span class="text-sm text-gray-600">Hello</span>
  </div>
</template>`;
		const classes = extractClasses(source);
		expect(classes).toContain("flex");
		expect(classes).toContain("bg-blue-500");
		expect(classes).toContain("text-sm");
		expect(classes).toContain("text-gray-600");
	});

	test("handles Svelte template", () => {
		const source = `<div class="flex {isActive ? 'bg-blue-500' : 'bg-gray-200'}">`;
		const classes = extractClasses(source);
		expect(classes).toContain("flex");
		expect(classes).toContain("bg-blue-500");
		expect(classes).toContain("bg-gray-200");
	});

	test("empty source returns empty set", () => {
		expect(extractClasses("").size).toBe(0);
	});

	test("does not treat JS array indexing expressions as classes", () => {
		const source = "const x = lessons[activeIndex - 1];";
		const classes = extractClasses(source);
		expect(classes).not.toContain("lessons[activeIndex - 1]");
	});

	test("keeps arbitrary values that are a bare integer", () => {
		// Regression: the index-access filter rejected anything ending in
		// `[digits]`, which is JS subscripting AND a whole family of real
		// utilities. `z-[60]` compiled when handed to the compiler directly and
		// disappeared when scanned out of markup — a class that works in
		// `safelist()` and not in a class attribute.
		const classes = extractClasses(
			`<div class="z-[60] order-[3] flex-[2] col-span-[7] line-clamp-[8]">`,
		);
		expect([...classes]).toEqual(
			expect.arrayContaining(["z-[60]", "order-[3]", "flex-[2]", "col-span-[7]", "line-clamp-[8]"]),
		);
	});

	test("drops a bare bracket holding nothing but a number", () => {
		// A bracket-only class is a real shape — `[color:red]` sets a property
		// directly — so these cannot be waved through on the grounds that
		// nothing bracket-only is a class. What rejects them is the tokenizer,
		// not a candidate filter: CLASS_RE's arbitrary-property branch demands a
		// letter or `-` after the bracket and a `:` inside. Pinned here because
		// the index-access filter leans on that guarantee instead of repeating
		// it, and would need an `^` branch back if it ever stopped holding.
		const classes = extractClasses('<div class="[0] [12] [] [color:red]">');

		expect(classes).toContain("[color:red]");
		expect(classes).not.toContain("[0]");
		expect(classes).not.toContain("[12]");
		expect(classes).not.toContain("[]");
	});

	test("still rejects subscripts and TypeScript array types next to the fixed filter", () => {
		const classes = extractClasses(`
			const a = items[0];
			const b = rows[12];
			let c: string[] = [];
			let d: Props[] = [];
		`);
		expect(classes).not.toContain("items[0]");
		expect(classes).not.toContain("rows[12]");
		expect(classes).not.toContain("string[]");
		expect(classes).not.toContain("Props[]");
	});

	test("keeps a numeric modifier, and drops an empty bracket", () => {
		// `text-lg/[6]` is a real class — the bracket is a line-height modifier,
		// not a subscript — and the old digits-only filter dropped it too, since
		// the character before `[` is `/` rather than a letter.
		const kept = extractClasses('<div class="text-lg/[6] bg-red-500/[50] border-red-500/[10]">');
		expect(kept).toContain("text-lg/[6]");
		expect(kept).toContain("bg-red-500/[50]");
		expect(kept).toContain("border-red-500/[10]");

		// An empty bracket is a typo, and it used to be caught only as a side
		// effect of the digits pattern (`\d*` matches nothing). Left in, it
		// reaches the compiler and emits `padding: ;`.
		const dropped = extractClasses('<div class="p-[] gap-[] m-[] p-4">');
		expect(dropped).toContain("p-4");
		expect(dropped).not.toContain("p-[]");
		expect(dropped).not.toContain("gap-[]");
		expect(dropped).not.toContain("m-[]");
	});

	test("does not treat JS property access with dashed string keys as classes", () => {
		// Regression: rest["aria-invalid"] etc. used to slip through the
		// JS-property-access filter because the value's dash satisfied the
		// loose `base.includes("-")` check. CSS utility arbitrary values
		// require a dash IMMEDIATELY before the bracket — JS access never
		// has that, so the tightened filter rejects them.
		const source = `
			const x = rest["aria-invalid"];
			const y = rest["aria-labelledby"];
			const z = obj.foo["data-state"];
		`;
		const classes = extractClasses(source);
		expect(classes).not.toContain('rest["aria-invalid"]');
		expect(classes).not.toContain('rest["aria-labelledby"]');
		expect(classes).not.toContain('obj.foo["data-state"]');
	});

	test("preserves arbitrary utilities with dashes in their value", () => {
		// Companion to the regression above — the filter must NOT reject
		// legitimate utilities like text-[length:1rem] just because the
		// value carries a dash.
		const source = '<div class="bg-[var(--x)] text-[length:1rem] p-[1px_2px]">';
		const classes = extractClasses(source);
		expect(classes).toContain("bg-[var(--x)]");
		expect(classes).toContain("text-[length:1rem]");
		expect(classes).toContain("p-[1px_2px]");
	});

	test("drops classes with uppercase base names", () => {
		const source = '<div class="text-red-500 FooBar sm:MixedCase">';
		const classes = extractClasses(source);

		expect(classes).toContain("text-red-500");
		expect(classes).not.toContain("FooBar");
		expect(classes).not.toContain("sm:MixedCase");
	});

	test("drops arbitrary values containing whitespace", () => {
		const source = '<div class="content-[hello world] p-[20px]">';
		const classes = extractClasses(source);

		expect(classes).toContain("p-[20px]");
		expect(classes).not.toContain("content-[hello world]");
	});

	test("lets a dashed bracket through even when its value is a bare number", () => {
		// This test used to assert `data-[12]` was dropped, as a side effect of
		// an index-access filter that rejected everything ending in `[digits]`.
		// That filter also rejected `z-[60]` and `order-[3]`, which are real
		// utilities, and `data-[12]` is not valid JavaScript in the first place
		// — nothing in a source file produces it by accident. The filter now
		// keys on the dash the way PROPERTY_ACCESS_RE already did, so a token
		// like this reaches the compiler and is rejected there as an unknown
		// utility, which is where unknown utilities belong.
		const classes = extractClasses('<div class="data-[12] z-[60] p-[20px]">');

		expect(classes).toContain("z-[60]");
		expect(classes).toContain("p-[20px]");
		expect(classes).toContain("data-[12]");
	});

	test("skips oversized lines during multiline filtering", () => {
		const longLine = `class="${"x".repeat(MAX_LINE_LENGTH + 100)} p-4"`;
		const source = `${longLine}\n<div class="m-2">`;
		const classes = extractClasses(source);

		expect(classes).toContain("m-2");
		expect(classes).not.toContain("p-4");
	});
});

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

describe("resolveSourceFilesAsync", () => {
	const testDir = join(tmpdir(), `ri-scanner-test-${Date.now()}`);

	// Setup temp directory with test files
	function setup() {
		mkdirSync(join(testDir, "src/components"), { recursive: true });
		mkdirSync(join(testDir, "app"), { recursive: true });
		writeFileSync(join(testDir, "src/page.tsx"), '<div class="flex">');
		writeFileSync(join(testDir, "src/components/Button.tsx"), '<button class="p-4">');
		writeFileSync(join(testDir, "app/layout.tsx"), '<main class="min-h-screen">');
		writeFileSync(join(testDir, "src/utils.ts"), "export const x = 1;"); // not a template
	}

	function cleanup() {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {}
	}

	test("uses default patterns when no sources", async () => {
		setup();
		try {
			const { files } = await resolveSourceFilesAsync([], testDir);
			// Vite defaults scan index.html and src/
			expect(files.length).toBeGreaterThan(0);
			expect(files.some((f) => f.endsWith("page.tsx"))).toBe(true);
			expect(files.some((f) => f.endsWith("layout.tsx"))).toBe(false);
			expect(files.some((f) => f.endsWith("utils.ts"))).toBe(true);
		} finally {
			cleanup();
		}
	});

	test("uses @source patterns when provided", async () => {
		setup();
		try {
			const { files } = await resolveSourceFilesAsync(
				[{ pattern: "src/**/*.tsx", negated: false, inline: false }],
				testDir,
			);
			expect(files.length).toBe(2); // page.tsx + Button.tsx
			expect(files.some((f) => f.endsWith("page.tsx"))).toBe(true);
			expect(files.some((f) => f.endsWith("Button.tsx"))).toBe(true);
			// Should NOT include app/
			expect(files.some((f) => f.includes("/app/"))).toBe(false);
		} finally {
			cleanup();
		}
	});

	test("handles negated patterns", async () => {
		setup();
		try {
			const { files } = await resolveSourceFilesAsync(
				[
					{ pattern: "src/**/*.tsx", negated: false, inline: false },
					{ pattern: "src/components/**/*", negated: true, inline: false },
				],
				testDir,
			);
			expect(files.length).toBe(1); // Only page.tsx
			expect(files.some((f) => f.endsWith("page.tsx"))).toBe(true);
			expect(files.some((f) => f.endsWith("Button.tsx"))).toBe(false);
		} finally {
			cleanup();
		}
	});

	test("inline-only sources still use default patterns", async () => {
		setup();
		try {
			const { files } = await resolveSourceFilesAsync(
				[{ pattern: "", classes: ["underline", "text-red-500"], negated: false, inline: true }],
				testDir,
			);
			// Inline sources don't suppress defaults — files should be found
			expect(files.length).toBeGreaterThan(0);
			expect(files.some((f) => f.endsWith("page.tsx"))).toBe(true);
		} finally {
			cleanup();
		}
	});

	test("negation-only sources still use default patterns", async () => {
		setup();
		try {
			const { files } = await resolveSourceFilesAsync(
				[{ pattern: "app/**/*", negated: true, inline: false }],
				testDir,
			);
			// Negation doesn't suppress defaults — src/ files should still be found
			expect(files.some((f) => f.endsWith("page.tsx"))).toBe(true);
			// But app/ files should be excluded
			expect(files.some((f) => f.includes("/app/"))).toBe(false);
		} finally {
			cleanup();
		}
	});

	test("explicit positive @source replaces defaults", async () => {
		setup();
		try {
			const { files } = await resolveSourceFilesAsync(
				[{ pattern: "src/**/*.tsx", negated: false, inline: false }],
				testDir,
			);
			// Should only match the explicit pattern — not app/
			expect(files.some((f) => f.endsWith("page.tsx"))).toBe(true);
			expect(files.some((f) => f.includes("/app/"))).toBe(false);
		} finally {
			cleanup();
		}
	});
});

// ---------------------------------------------------------------------------
// Cross-rebuild caches
// ---------------------------------------------------------------------------

describe("incremental class union", () => {
	const dir = join(tmpdir(), `ri-scanner-union-${Date.now()}`);
	const fileA = join(dir, "src/A.tsx");
	const fileB = join(dir, "src/B.tsx");
	const sources = [{ pattern: "src/**/*.tsx", negated: false, inline: false }];

	// Rewrites change the byte length, so the scan cache sees a new size even
	// when two writes land in the same millisecond.
	const scan = () => scanSourceFilesAsync(sources, dir);

	test("drops a class only when the last file using it stops", async () => {
		mkdirSync(join(dir, "src"), { recursive: true });
		try {
			writeFileSync(fileA, '<div className="flex underline">');
			writeFileSync(fileB, '<div className="flex italic">');
			let { classes } = await scan();
			expect(classes).toContain("flex");
			expect(classes).toContain("underline");
			expect(classes).toContain("italic");

			// A alone had "underline", so dropping it there drops it everywhere.
			writeFileSync(fileA, '<div className="flex">');
			({ classes } = await scan());
			expect(classes).not.toContain("underline");
			expect(classes).toContain("flex");
			expect(classes).toContain("italic");

			// A gives up "flex" too, but B still has it — the count, not the edit,
			// decides. This is what a plain "remove what the file had" would break.
			writeFileSync(fileA, '<div className="truncate">');
			({ classes } = await scan());
			expect(classes).toContain("flex");
			expect(classes).toContain("truncate");

			// Now the last mention goes.
			writeFileSync(fileB, '<div className="italic">');
			({ classes } = await scan());
			expect(classes).not.toContain("flex");
			expect(classes).toContain("italic");
			expect(classes).toContain("truncate");

			// A file appearing changes the list length, restarting the union.
			writeFileSync(join(dir, "src/C.tsx"), '<div className="underline">');
			({ classes } = await scan());
			expect(classes).toContain("underline");
			expect(classes).toContain("italic");
			expect(classes).not.toContain("flex");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("scan change tracking", () => {
	const dir = join(tmpdir(), `ri-scanner-track-${Date.now()}`);
	const file = join(dir, "src/App.tsx");
	const sources = [{ pattern: "src/**/*.tsx", negated: false, inline: false }];

	test("trusts cached files until the watcher reports them changed", async () => {
		mkdirSync(join(dir, "src"), { recursive: true });
		try {
			writeFileSync(file, '<div className="flex">');
			enableScanChangeTracking();
			expect((await scanSourceFilesAsync(sources, dir)).classes).toContain("flex");

			// Armed tracking skips the stat, so an unreported edit stays invisible —
			// this is the bargain that lets a rebuild skip one stat per file.
			writeFileSync(file, '<div className="underline italic">');
			let { classes } = await scanSourceFilesAsync(sources, dir);
			expect(classes).toContain("flex");
			expect(classes).not.toContain("underline");

			markSourceFileChanged(file);
			({ classes } = await scanSourceFilesAsync(sources, dir));
			expect(classes).toContain("underline");
			expect(classes).not.toContain("flex");

			// Disarmed, the stat is back and an unreported edit is seen again.
			disableScanChangeTracking();
			writeFileSync(file, '<div className="truncate">');
			({ classes } = await scanSourceFilesAsync(sources, dir));
			expect(classes).toContain("truncate");
			expect(classes).not.toContain("underline");
		} finally {
			disableScanChangeTracking();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("resolves a watcher-relative path against its cwd", async () => {
		mkdirSync(join(dir, "src"), { recursive: true });
		try {
			writeFileSync(file, '<div className="flex">');
			enableScanChangeTracking();
			expect((await scanSourceFilesAsync(sources, dir)).classes).toContain("flex");

			writeFileSync(file, '<div className="underline italic">');
			markSourceFileChanged("src/App.tsx", dir);
			expect((await scanSourceFilesAsync(sources, dir)).classes).toContain("underline");
		} finally {
			disableScanChangeTracking();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// Full scan pipeline
// ---------------------------------------------------------------------------

describe("scanSourceFilesAsync", () => {
	const testDir0 = join(tmpdir(), `ri-scanner-full-${Date.now()}`);

	function setup0() {
		mkdirSync(join(testDir0, "src"), { recursive: true });
		writeFileSync(
			join(testDir0, "src/App.tsx"),
			'<div className="flex items-center hover:{bg-blue-500 text-white}">',
		);
	}

	function cleanup0() {
		try {
			rmSync(testDir0, { recursive: true, force: true });
		} catch {}
	}

	test("scans files and extracts classes", async () => {
		setup0();
		try {
			const { classes } = await scanSourceFilesAsync(
				[{ pattern: "src/**/*.tsx", negated: false, inline: false }],
				testDir0,
			);
			expect(classes).toContain("flex");
			expect(classes).toContain("items-center");
			expect(classes).toContain("hover:bg-blue-500");
			expect(classes).toContain("hover:text-white");
		} finally {
			cleanup0();
		}
	});

	test("includes inline source classes", async () => {
		setup0();
		try {
			const { classes } = await scanSourceFilesAsync(
				[
					{ pattern: "src/**/*.tsx", negated: false, inline: false },
					{ pattern: "", classes: ["underline", "font-bold"], negated: false, inline: true },
				],
				testDir0,
			);
			// From files
			expect(classes).toContain("flex");
			// From inline
			expect(classes).toContain("underline");
			expect(classes).toContain("font-bold");
		} finally {
			cleanup0();
		}
	});

	test("handles no matching files gracefully", async () => {
		const { classes, warnings } = await scanSourceFilesAsync(
			[{ pattern: "nonexistent/**/*.tsx", negated: false, inline: false }],
			testDir0,
		);
		expect(classes.size).toBe(0);
		expect(warnings.length).toBeGreaterThan(0);
		expect(warnings[0]).toContain("RI-1401");
	});

	test("warns when files are skipped for exceeding size limit", async () => {
		setup0();
		try {
			const largeFile = join(testDir0, "src/Large.tsx");
			// MAX_FILE_SIZE in scanner.ts is 1,048,576 bytes.
			writeFileSync(largeFile, "a".repeat(1_048_577));

			const { warnings } = await scanSourceFilesAsync(
				[{ pattern: "src/**/*.tsx", negated: false, inline: false }],
				testDir0,
			);
			expect(warnings.some((w) => w.includes("RI-1405"))).toBe(true);
		} finally {
			cleanup0();
		}
	});
});

describe("scanSourceFilesAsync — unreadable files", () => {
	const testDir = join(tmpdir(), `ri-scanner-async-${Date.now()}`);

	function setup() {
		mkdirSync(join(testDir, "src"), { recursive: true });
		writeFileSync(join(testDir, "src/App.tsx"), '<div className="flex">');
	}

	function cleanup() {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {}
	}

	test("includes file path when a source file cannot be read", async () => {
		setup();
		const unreadableFile = join(testDir, "src/Unreadable.tsx");
		writeFileSync(unreadableFile, '<div className="p-4">');
		chmodSync(unreadableFile, 0o000);
		try {
			const { warnings } = await scanSourceFilesAsync(
				[{ pattern: "src/**/*.tsx", negated: false, inline: false }],
				testDir,
			);
			expect(warnings.some((w) => w.includes("RI-1403") && w.includes("Unreadable.tsx"))).toBe(
				true,
			);
		} finally {
			chmodSync(unreadableFile, 0o644);
			cleanup();
		}
	});
});

/**
 * `.astro` is HTML-shaped markup over a JavaScript frontmatter block, so it
 * needs both halves. Before this it fell to the generic token scan: static
 * classes came through by accident, while `class:list={…}` and any helper call
 * in the frontmatter did not, and the dev server never recompiled on save
 * because `.astro` was not a source file.
 */
describe("Astro extraction", () => {
	const astro = (content: string): string[] => [
		...extractClassesFromSource({ path: "/app/src/Page.astro", content }),
	];

	test("reads static class, class:list, and frontmatter helpers", () => {
		const classes = astro(`---
import Card from "./Card.astro";
const extra = clsx("text-lg", cond && "font-bold");
---
<div class="flex gap-4" class:list={["shadow-md", extra, { underline: on }]}>
	<span class="tracking-widest">Hi</span>
</div>`);
		for (const c of [
			"flex",
			"gap-4",
			"shadow-md",
			"underline",
			"text-lg",
			"font-bold",
			"tracking-widest",
		]) {
			expect(classes).toContain(c);
		}
	});

	test("reads a recipe config in the frontmatter", () => {
		const classes = astro(`---
const styles = cva("rounded", { variants: { size: { sm: "p-2", lg: "p-8" } } });
---
<div class={styles({ size: "sm" })}>x</div>`);
		expect(classes).toEqual(expect.arrayContaining(["rounded", "p-2", "p-8"]));
	});

	test("does not mistake a --- inside markup for frontmatter", () => {
		// Only a fence at the very top opens one; a separator in the body is body.
		const classes = astro(`<div class="flex">---</div>
<p class="p-4">after</p>`);
		expect(classes).toEqual(expect.arrayContaining(["flex", "p-4"]));
	});

	test("reads class:list on a line the whole-file scan drops", () => {
		// The token scan skips lines over MAX_LINE_LENGTH, which is exactly why
		// the attribute passes run unconditionally rather than as a nicety: on a
		// long line they are the only thing that sees the class list. Generated
		// markup hits this routinely.
		const filler = "x".repeat(MAX_LINE_LENGTH);
		const classes = astro(
			`<div data-x="${filler}" class:list={["shadow-md"]} class="gap-4">y</div>`,
		);
		expect(classes).toContain("shadow-md");
		expect(classes).toContain("gap-4");
	});

	test("treats frontmatter noise exactly as a .tsx file's imports are treated", () => {
		// The scanner over-collects by design — a candidate that is not a utility
		// compiles to nothing — so the bar is parity with the JS extractor, not an
		// empty result. Anything astro-specific beyond that would be a real leak.
		const source = `import Card from "./Card";
export const prerender = true;`;
		const tsx = [
			...extractClassesFromSource({
				path: "/app/src/Page.tsx",
				content: `${source}\n<div className="flex">x</div>`,
			}),
		];
		const classes = astro(`---\n${source}\n---\n<div class="flex">x</div>`);
		expect(classes).toContain("flex");
		// `---` is the fence itself; everything else must already appear for .tsx.
		expect(classes.filter((c) => c !== "---").sort()).toEqual(tsx.sort());
	});
});

/**
 * The scanner had the same flat-bracket bug as the parser, one level up: a
 * token with a nested bracket tore in half. The tail was often a valid utility,
 * so the compiler emitted a real rule for a class nobody wrote — the quietest
 * possible failure, since the CSS looks fine and simply is not yours.
 */
/**
 * The named-group variant landed in the parser but not here, so it worked in
 * `validate()` and `@apply` and not from a source file — the half that actually
 * matters. Worse, the torn tail was a valid utility, so `.underline` got a rule
 * nobody wrote, exactly as the nested-bracket bug below did.
 */
describe("named groups survive tokenization", () => {
	const scan = (content: string): string[] => [
		...extractClassesFromSource({ path: "/app/index.html", content }),
	];

	test("keeps a named group as one token", () => {
		const classes = scan(
			`<div class="group/item"><span class="group-hover/item:underline">x</span></div>`,
		);
		expect(classes).toContain("group-hover/item:underline");
		expect(classes).toContain("group/item");
		expect(classes).not.toContain("underline");
	});

	test("keeps a named peer and a named container as one token", () => {
		expect(scan(`<div class="peer-checked/sidebar:block">x</div>`)).toContain(
			"peer-checked/sidebar:block",
		);
		expect(scan(`<div class="@sidebar/sm:flex">x</div>`)).toContain("@sidebar/sm:flex");
	});

	test("leaves a utility's own value modifier alone", () => {
		// `text-lg/7` and `bg-red-500/50` carry a slash too, in the value rather
		// than the variant, and were never affected.
		const classes = scan(`<span class="text-lg/7 bg-red-500/50">x</span>`);
		expect(classes).toEqual(expect.arrayContaining(["text-lg/7", "bg-red-500/50"]));
	});
});

describe("nested brackets survive tokenization", () => {
	const scan = (content: string): string[] => [
		...extractClassesFromSource({ path: "/app/index.html", content }),
	];

	test("keeps a nested-bracket variant as one token", () => {
		expect(scan(`<div class="group-[&[href]]:underline">x</div>`)).toContain(
			"group-[&[href]]:underline",
		);
		expect(scan(`<div class="has-[[data-x]]:flex">x</div>`)).toContain("has-[[data-x]]:flex");
	});

	test("no longer invents a class from the torn tail", () => {
		// This is the bug that mattered: `.underline` got a real rule.
		expect(scan(`<div class="group-[&[href]]:underline">x</div>`)).not.toContain("underline");
	});

	test("warns on whitespace inside a variant's own bracket", () => {
		// Stripping the variant before the whitespace test hid this: the base
		// became `flex`, carried no bracket, and skipped every filter.
		const warnings: string[] = [];
		const classes = [
			...extractClassesFromSource(
				{ path: "/app/index.html", content: `<div class="group-[&[a b]]:flex">x</div>` },
				warnings,
			),
		];
		expect(warnings.some((w) => w.includes("RI-1412"))).toBe(true);
		expect(classes).not.toContain("flex");
	});
});
