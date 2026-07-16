import { describe, expect, test } from "vitest";
import {
	expandApplyGroups,
	expandVariantGroups,
	extractClasses,
	resolveSourceFilesAsync,
	scanSourceFilesAsync,
} from "../../src/scanner/index.js";
import { writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

	test("warns when expanded output exceeds the safety limit", () => {
		const input = "hover:{x} ".repeat(20_001);
		const warnings: string[] = [];
		const expanded = expandVariantGroups(input, warnings);

		expect(warnings).toEqual([expect.stringContaining("[RI-1408]")]);
		expect(expanded).toContain("hover:x");
		expect(expanded).toContain("hover:{x}");
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

describe("expandApplyGroups", () => {
	test("expands a group inside @apply", () => {
		const css = `[data-slot="content-wrapper"] {\n\t@apply hover:{flex-1 z-10 p-4};\n}`;
		expect(expandApplyGroups(css)).toBe(
			`[data-slot="content-wrapper"] {\n\t@apply hover:flex-1 hover:z-10 hover:p-4;\n}`,
		);
	});

	test("expands a group inside @a alias", () => {
		const css = `.foo { @a hover:{px-2 leading-none}; }`;
		expect(expandApplyGroups(css)).toBe(`.foo { @a hover:px-2 hover:leading-none; }`);
	});

	test("expands multiple groups across multiple rules", () => {
		const css = `.a { @apply focus:{outline-2 outline-blue-500}; }\n.b { @a disabled:{opacity-50 cursor-not-allowed}; }`;
		expect(expandApplyGroups(css)).toBe(
			`.a { @apply focus:outline-2 focus:outline-blue-500; }\n.b { @a disabled:opacity-50 disabled:cursor-not-allowed; }`,
		);
	});

	test("expands chained variants", () => {
		const css = `.foo { @apply sm:hover:{bg-gray-700 text-white}; }`;
		expect(expandApplyGroups(css)).toBe(
			`.foo { @apply sm:hover:bg-gray-700 sm:hover:text-white; }`,
		);
	});

	test("leaves @apply without group syntax untouched", () => {
		const css = `.foo { @apply flex items-center p-4; }`;
		expect(expandApplyGroups(css)).toBe(css);
	});

	test("leaves CSS without @apply untouched", () => {
		const css = `.foo { color: red; padding: 4px; }\n.bar:hover { background: blue; }`;
		expect(expandApplyGroups(css)).toBe(css);
	});

	test("does not touch braces in regular CSS rules", () => {
		const css = `.foo:hover { color: red; } .bar { @apply hover:{flex-1}; } .baz { color: blue; }`;
		expect(expandApplyGroups(css)).toBe(
			`.foo:hover { color: red; } .bar { @apply hover:flex-1; } .baz { color: blue; }`,
		);
	});

	test("returns input verbatim when no @ or { present", () => {
		expect(expandApplyGroups(".foo { color: red; }")).toBe(".foo { color: red; }");
		expect(expandApplyGroups("/* nothing here */")).toBe("/* nothing here */");
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

	test("drops arbitrary values containing whitespace and bare numeric brackets", () => {
		const source = '<div class="content-[hello world] data-[12] p-[20px]">';
		const classes = extractClasses(source);

		expect(classes).toContain("p-[20px]");
		expect(classes).not.toContain("content-[hello world]");
		expect(classes).not.toContain("data-[12]");
	});

	test("skips oversized lines during multiline filtering", () => {
		const longLine = `class="${"x".repeat(2100)} p-4"`;
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
