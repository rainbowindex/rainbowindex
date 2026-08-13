import { describe, expect, test } from "vitest";
import {
	extractClassCandidates,
	extractClassesFromSource,
	type ClassCandidate,
	type SourceExtractionInput,
} from "../../src/scanner/index.js";

// ---------------------------------------------------------------------------
// Invariant helpers
// ---------------------------------------------------------------------------

/**
 * The two contracts every candidate must satisfy:
 * 1. Non-group candidates: the source slice IS the value.
 * 2. Group members: value === groupPrefix slice + member slice, so the
 *    reported span always points at real text the editor can highlight.
 */
function assertSpanInvariants(input: SourceExtractionInput, candidates: ClassCandidate[]): void {
	for (const candidate of candidates) {
		const slice = input.content.slice(candidate.start, candidate.end);
		if (candidate.groupPrefix) {
			const prefix = input.content.slice(candidate.groupPrefix.start, candidate.groupPrefix.end);
			expect(prefix + slice).toBe(candidate.value);
		} else {
			expect(slice).toBe(candidate.value);
		}
	}
}

/** Candidates' value set must equal the build scanner's Set — always. */
function assertValueParity(input: SourceExtractionInput): ClassCandidate[] {
	const candidates = extractClassCandidates(input);
	const values = new Set(candidates.map((c) => c.value));
	expect(values).toEqual(extractClassesFromSource(input));
	assertSpanInvariants(input, candidates);
	return candidates;
}

function byValue(candidates: ClassCandidate[], value: string): ClassCandidate {
	const found = candidates.find((c) => c.value === value);
	expect(found, `candidate "${value}" missing`).toBeDefined();
	return found as ClassCandidate;
}

// ---------------------------------------------------------------------------
// Value parity + span invariants across file types
// ---------------------------------------------------------------------------

describe("extractClassCandidates parity with extractClassesFromSource", () => {
	test("HTML document", () => {
		assertValueParity({
			path: "index.html",
			content: `<!doctype html>
<div class="flex px-4 gap-2">
	<p class="text-lg hover:text-red-500">hi</p>
	<span class="w-[37rem] bg-(--brand) data-[state=open]:opacity-100">x</span>
</div>`,
		});
	});

	test("JSX with attributes, helpers, template literals, object keys", () => {
		assertValueParity({
			path: "App.tsx",
			content: `import clsx from "clsx";
export function App({ active }) {
	const cls = clsx("px-2 py-1", active && "bg-blue-500", {
		"rounded-lg shadow-md": active,
		underline: !active,
	});
	return (
		<div className={\`flex gap-4 \${active ? "items-center" : "items-start"}\`}>
			<button className={cls} tw="font-bold">ok</button>
		</div>
	);
}`,
		});
	});

	test("cva config with variants, compoundVariants, slots", () => {
		assertValueParity({
			path: "button.ts",
			content: `const button = cva("inline-flex items-center", {
	variants: {
		intent: { primary: "bg-blue-500 text-white", ghost: "bg-transparent" },
		size: { sm: "px-2 text-sm", lg: ["px-6", "text-lg"] },
	},
	compoundVariants: [{ intent: "primary", size: "lg", class: "shadow-lg" }],
	defaultVariants: { intent: "primary", size: "sm" },
});`,
		});
	});

	test("Vue single file component", () => {
		assertValueParity({
			path: "Widget.vue",
			content: `<template>
	<div class="flex flex-col" :class="{ 'bg-red-100 border-red-500': hasError }">x</div>
</template>`,
		});
	});

	test("Svelte class directives", () => {
		assertValueParity({
			path: "Widget.svelte",
			content: `<div class="grid gap-2" class:opacity-50={dim}>y</div>`,
		});
	});

	test("variant groups, arbitrary values, important, negatives", () => {
		assertValueParity({
			path: "kitchen.html",
			content: `<div class="hover:{text-red-500 bg-blue-100 underline} sm:hover:{bg-gray-700} -translate-x-2 p-[13px]! [color:red]"></div>`,
		});
	});

	test("nested variant groups keep value parity and span invariants", () => {
		// Nested groups mangle through single-pass expansion; the same source
		// span can host two different values (the mangled "sm:hover" token and
		// the object-key "hover"), and matches strictly inside a member must
		// not carry the group prefix. Both invariants are checked by
		// assertValueParity → assertSpanInvariants.
		assertValueParity({
			path: "nested.tsx",
			content: `<div className="sm:{hover:{a-1 b-2} c-3}" />`,
		});
	});

	test("safelist calls in plain js", () => {
		assertValueParity({
			path: "icons.js",
			content: `const base = safelist("stroke-cap-round", "stroke-join-round");
const flipped = safelist(base, "-scale-x-100");`,
		});
	});

	test("markdown and unknown file types fall back to the plain scan", () => {
		assertValueParity({
			path: "notes.md",
			content: `Use \`flex items-center\` for rows.`,
		});
		assertValueParity({ content: `class="px-8 underline"` });
	});

	test("empty and classless content", () => {
		expect(extractClassCandidates({ content: "" })).toEqual([]);
		const none = extractClassCandidates({ path: "a.ts", content: "const x = 1 + 2;\n" });
		assertSpanInvariants({ path: "a.ts", content: "const x = 1 + 2;\n" }, none);
	});
});

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

describe("candidate positions", () => {
	test("plain attribute tokens carry exact spans", () => {
		const content = `<div class="flex px-4">x</div>`;
		const candidates = extractClassCandidates({ path: "a.html", content });
		const flex = byValue(candidates, "flex");
		expect(content.slice(flex.start, flex.end)).toBe("flex");
		expect(flex.start).toBe(content.indexOf("flex"));
		const px4 = byValue(candidates, "px-4");
		expect(px4.start).toBe(content.indexOf("px-4"));
	});

	test("variant group members map to member tokens with a prefix span", () => {
		const content = `<p class="hover:{bg-red-500 underline} block">t</p>`;
		const candidates = extractClassCandidates({ path: "a.html", content });

		const bg = byValue(candidates, "hover:bg-red-500");
		expect(content.slice(bg.start, bg.end)).toBe("bg-red-500");
		expect(bg.groupPrefix).toBeDefined();
		expect(content.slice(bg.groupPrefix?.start, bg.groupPrefix?.end)).toBe("hover:");

		const underline = byValue(candidates, "hover:underline");
		expect(content.slice(underline.start, underline.end)).toBe("underline");

		const block = byValue(candidates, "block");
		expect(block.groupPrefix).toBeUndefined();
	});

	test("chained variant groups keep the whole prefix chain", () => {
		const content = `<i class="sm:hover:{bg-gray-700 text-white}">z</i>`;
		const candidates = extractClassCandidates({ path: "a.html", content });
		const bg = byValue(candidates, "sm:hover:bg-gray-700");
		expect(content.slice(bg.groupPrefix?.start, bg.groupPrefix?.end)).toBe("sm:hover:");
		expect(content.slice(bg.start, bg.end)).toBe("bg-gray-700");
	});

	test("candidates after a dropped over-long line keep correct offsets", () => {
		const longLine = `const blob = "${"x".repeat(2100)}";`;
		const content = `<div class="flex"></div>\n${longLine}\n<div class="px-6"></div>`;
		const candidates = extractClassCandidates({ path: "a.html", content });
		const px6 = byValue(candidates, "px-6");
		expect(content.slice(px6.start, px6.end)).toBe("px-6");
		expect(px6.start).toBe(content.lastIndexOf("px-6"));
		// The over-long line's contents are not scanned.
		expect(
			candidates.some(
				(c) =>
					c.start > content.indexOf(longLine) &&
					c.end < content.indexOf(longLine) + longLine.length,
			),
		).toBe(false);
	});

	test("template literal chunks around interpolations keep offsets", () => {
		const content = `const c = \`flex gap-2 \${active ? "underline" : ""} px-3\`;`;
		const candidates = extractClassCandidates({ path: "a.ts", content });
		for (const value of ["flex", "gap-2", "underline", "px-3"]) {
			const candidate = byValue(candidates, value);
			expect(content.slice(candidate.start, candidate.end)).toBe(value);
		}
	});

	test("candidates are sorted by position", () => {
		const content = `<div class="z-10 flex px-2">x</div>`;
		const candidates = extractClassCandidates({ path: "a.html", content });
		const starts = candidates.map((c) => c.start);
		expect(starts).toEqual([...starts].sort((a, b) => a - b));
	});
});

// ---------------------------------------------------------------------------
// Origins
// ---------------------------------------------------------------------------

describe("candidate origins", () => {
	test("attribute collectors upgrade the whole-file scan's origin", () => {
		const content = `<Btn className="flex px-2" />`;
		const candidates = extractClassCandidates({ path: "a.tsx", content });
		expect(byValue(candidates, "flex").origin).toBe("attribute");
		expect(byValue(candidates, "px-2").origin).toBe("attribute");
	});

	test("helper calls report origin and helper name", () => {
		const content = `const c = clsx("items-center", cond && "gap-4");`;
		const candidates = extractClassCandidates({ path: "a.ts", content });
		const item = byValue(candidates, "items-center");
		expect(item.origin).toBe("helper");
		expect(item.helperName).toBe("clsx");
	});

	test("cva classes report the variant helper name", () => {
		const content = `const v = cva("inline-flex", { variants: { s: { sm: "px-2" } } });`;
		const candidates = extractClassCandidates({ path: "a.ts", content });
		expect(byValue(candidates, "inline-flex").helperName).toBe("cva");
		expect(byValue(candidates, "px-2").helperName).toBe("cva");
	});

	test("safelist literals report safelist origin", () => {
		const content = `const s = safelist("stroke-cap-round");`;
		const candidates = extractClassCandidates({ path: "a.js", content });
		const stroke = byValue(candidates, "stroke-cap-round");
		expect(stroke.origin).toBe("safelist");
		expect(stroke.helperName).toBe("safelist");
	});

	test("tokens outside any known context stay plain", () => {
		const content = `Use flex-col for stacking.`;
		const candidates = extractClassCandidates({ path: "notes.md", content });
		expect(byValue(candidates, "flex-col").origin).toBe("plain");
	});
});

// ---------------------------------------------------------------------------
// Pruning parity
// ---------------------------------------------------------------------------

describe("candidate pruning", () => {
	test("cva structural keys are pruned unless quoted elsewhere", () => {
		const input: SourceExtractionInput = {
			path: "a.ts",
			content: `const v = cva("flex", { variants: { rounded: { yes: "rounded-lg" } } });`,
		};
		const candidates = assertValueParity(input);
		// "rounded" is a variant key with no quoted provenance outside the call.
		expect(candidates.some((c) => c.value === "rounded")).toBe(false);
		expect(candidates.some((c) => c.value === "rounded-lg")).toBe(true);
	});

	test("a variant key quoted outside the helper call survives", () => {
		const input: SourceExtractionInput = {
			path: "a.tsx",
			content: `const v = cva("flex", { variants: { rounded: { yes: "rounded-lg" } } });
const el = <div className="rounded" />;`,
		};
		const candidates = assertValueParity(input);
		expect(candidates.some((c) => c.value === "rounded")).toBe(true);
	});

	test("helper identifiers never surface as candidates", () => {
		const input: SourceExtractionInput = {
			path: "a.ts",
			content: `import clsx from "clsx"; const c = clsx("flex");`,
		};
		const candidates = assertValueParity(input);
		expect(candidates.some((c) => c.value === "clsx")).toBe(false);
	});
});
