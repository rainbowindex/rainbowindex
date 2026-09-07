/**
 * `rainbowindex/tailwind.css` — the optional Tailwind-default preset.
 *
 * The preset exists so a project arriving from Tailwind gets Tailwind's names
 * without the engine shipping opinions of its own. That promise is only worth
 * something if it is measured, so this file asserts three things:
 *
 * 1. **The compatibility table.** The classes a real Tailwind v4 codebase
 *    writes must all pass `createClassInspector(theme).validate` with the
 *    preset loaded. This list is the seed of the M2 migrator's compatibility
 *    registry — see `docs/next-steps/action-plan.md` — so it is exported.
 * 2. **The known gaps.** Classes Tailwind has that Rainbow Index does not are
 *    asserted to fail, on purpose. A gap that quietly closes should show up as
 *    a failure here and get promoted into the table above, not go unnoticed.
 * 3. **The composed chains.** The preset defines `inset-shadow-*`,
 *    `text-shadow-*`, and `drop-shadow-*` as `@utility` blocks because those
 *    families read no theme namespace. Each block hardcodes the engine's own
 *    `box-shadow` / `filter` composition chain, which is module-private and
 *    could drift. Every block is diffed against what the bare engine emits for
 *    the arbitrary-value spelling of the same value.
 *
 * The preset is read from `src/presets/tailwind.css`, not from `dist`, so this
 * suite runs under `pnpm test` with no build.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createClassInspector } from "../../src/engine/inspector.js";
import { analyzeProjectCSS } from "../../src/project/analyze.js";

const PRESET = readFileSync(
	fileURLToPath(new URL("../../src/presets/tailwind.css", import.meta.url)),
	"utf8",
);

const analysis = analyzeProjectCSS(`@import "rainbowindex";\n${PRESET}`);
const withPreset = createClassInspector(analysis.theme);
const bare = createClassInspector(analyzeProjectCSS('@import "rainbowindex";').theme);

/**
 * Classes a real Tailwind v4 codebase writes, which the preset must make work.
 * Grouped by the section of Tailwind's own documentation they come from.
 *
 * The M2 Tailwind migrator's compatibility registry starts here: a class in
 * this list is one the migrator may report as preserved. When M2 needs to read
 * it, move both tables into `src/` — a test file is the wrong place to import
 * from, which is why neither is exported.
 */
// biome-ignore format: a compatibility table reads as a table — one line per
// Tailwind docs section, not one line per class.
const TAILWIND_COMMON: readonly string[] = Object.freeze([
	// Layout
	"block", "inline-block", "inline", "flex", "inline-flex", "grid", "inline-grid",
	"hidden", "contents", "flow-root", "table", "table-cell", "table-row",
	"static", "fixed", "absolute", "relative", "sticky",
	"isolate", "overflow-hidden", "overflow-auto", "overflow-x-auto", "overflow-y-scroll",
	"overscroll-contain", "float-left", "clear-both", "box-border", "box-content",
	"container", "aspect-video", "aspect-square", "aspect-auto",
	"columns-3", "columns-2xs", "break-after-page", "break-inside-avoid",
	"object-cover", "object-contain", "object-center",
	"visible", "invisible", "collapse",

	// Flexbox and grid
	"flex-row", "flex-row-reverse", "flex-col", "flex-col-reverse",
	"flex-wrap", "flex-nowrap", "flex-1", "flex-auto", "flex-none", "flex-initial",
	"grow", "grow-0", "shrink", "shrink-0", "basis-1/2", "basis-full", "basis-px",
	"order-1", "order-first", "order-last",
	"grid-cols-1", "grid-cols-3", "grid-cols-12", "grid-rows-2", "grid-flow-col",
	"col-span-2", "col-span-full", "col-start-1", "row-span-3", "row-start-2",
	"gap-4", "gap-x-2", "gap-y-8", "gap-px",
	"justify-start", "justify-center", "justify-between", "justify-around", "justify-evenly",
	"justify-items-center", "justify-self-end",
	"items-start", "items-center", "items-end", "items-baseline", "items-stretch",
	"content-center", "content-between", "self-start", "self-center", "self-stretch",
	"place-items-center", "place-content-center", "place-self-center",

	// Spacing and sizing
	"p-0", "p-4", "px-6", "py-3", "pt-2", "pb-8", "ps-4", "pe-4", "p-1.5", "p-px",
	"m-0", "m-auto", "mx-auto", "my-4", "mt-1", "-mt-2", "-mx-4",
	"space-x-4", "space-y-2", "space-y-reverse",
	"w-full", "w-screen", "w-1/2", "w-4", "w-auto", "w-fit", "w-min", "w-max",
	"h-full", "h-screen", "h-4", "h-auto", "h-dvh", "size-10", "size-full",
	"min-w-0", "min-w-full", "max-w-md", "max-w-7xl", "max-w-full", "max-w-prose", "max-w-none",
	"min-w-auto", "min-h-auto", "min-inline-auto", "min-block-auto",
	"w-md", "w-3xs", "min-w-md", "max-w-3xs", "basis-md", "columns-3xs",
	"min-h-0", "min-h-screen", "max-h-96", "max-h-full",
	"inset-0", "inset-x-0", "top-0", "bottom-4", "start-0", "end-2", "-top-1", "inset-1/2",

	// Typography
	"text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-4xl", "text-9xl",
	"font-thin", "font-light", "font-normal", "font-medium", "font-semibold", "font-bold",
	"font-extrabold", "font-black",
	"font-sans", "font-serif", "font-mono",
	"leading-none", "leading-tight", "leading-snug", "leading-normal", "leading-relaxed",
	"leading-loose", "leading-6", "text-sm/6", "text-[20px]/7",
	"tracking-tighter", "tracking-tight", "tracking-normal", "tracking-wide", "tracking-widest",
	"text-left", "text-center", "text-right", "text-justify",
	"uppercase", "lowercase", "capitalize", "normal-case",
	"underline", "line-through", "no-underline", "overline",
	"decoration-2", "decoration-dotted", "underline-offset-4",
	"truncate", "text-ellipsis", "text-wrap", "text-nowrap", "text-balance", "break-words",
	"align-middle", "align-baseline", "whitespace-nowrap", "whitespace-pre-line",
	"list-disc", "list-decimal", "list-none", "list-inside",
	"indent-4", "antialiased", "subpixel-antialiased", "italic", "not-italic",
	"tabular-nums", "slashed-zero",

	// Color
	"text-white", "text-black", "text-slate-900", "text-gray-500", "text-red-600",
	"bg-white", "bg-transparent", "bg-current", "bg-red-500", "bg-blue-600", "bg-emerald-50",
	"bg-zinc-900", "bg-stone-100", "bg-fuchsia-400", "bg-rose-700",
	"bg-red-500/50", "text-slate-900/75", "border-zinc-200/25",
	"accent-blue-600", "caret-pink-500", "decoration-sky-400",
	"placeholder-gray-400", "placeholder-gray-400/50",
	"fill-current", "fill-red-500", "stroke-blue-500", "stroke-2",
	"bg-linear-to-r", "bg-linear-to-br", "from-blue-500", "via-purple-500", "to-pink-500",
	"bg-radial", "bg-conic",

	// Borders and radii
	"rounded", "rounded-none", "rounded-xs", "rounded-sm", "rounded-md", "rounded-lg",
	"rounded-xl", "rounded-2xl", "rounded-4xl", "rounded-full",
	"rounded-t", "rounded-b-lg", "rounded-tl", "rounded-tr-xl", "rounded-s-md",
	"border", "border-0", "border-2", "border-4", "border-t", "border-b-2", "border-s",
	"border-solid", "border-dashed", "border-dotted", "border-none",
	"border-white", "border-gray-300",
	"divide-x", "divide-y-2", "divide-gray-200",
	"outline", "outline-2", "outline-none", "outline-offset-2", "outline-blue-500",
	"ring", "ring-2", "ring-blue-500",
	"ring-inset", "ring-offset-2", "ring-offset-4", "ring-offset-white", "ring-offset-blue-500",

	// Effects and filters
	"shadow", "shadow-2xs", "shadow-xs", "shadow-sm", "shadow-md", "shadow-lg", "shadow-xl",
	"shadow-inner",
	"shadow-2xl", "shadow-none",
	"inset-shadow-2xs", "inset-shadow-xs", "inset-shadow-sm", "inset-shadow-none",
	"text-shadow-2xs", "text-shadow-xs", "text-shadow-sm", "text-shadow-md", "text-shadow-lg",
	"text-shadow-none",
	"drop-shadow", "drop-shadow-xs", "drop-shadow-sm", "drop-shadow-md", "drop-shadow-lg",
	"drop-shadow-xl", "drop-shadow-2xl", "drop-shadow-none",
	"opacity-0", "opacity-50", "opacity-100",
	"mix-blend-multiply", "bg-blend-overlay",
	"blur", "blur-xs", "blur-sm", "blur-lg", "blur-3xl", "blur-none",
	"brightness-110", "contrast-125", "grayscale", "invert", "saturate-150", "sepia",
	"hue-rotate-15", "backdrop-blur-sm", "backdrop-brightness-50",

	// Transitions, transforms, interactivity
	"transition", "transition-all", "transition-colors", "transition-opacity",
	"transition-transform", "transition-none",
	"duration-150", "duration-300", "delay-100",
	"ease-in", "ease-out", "ease-in-out", "ease-linear",
	"animate-none", "animate-spin", "animate-ping", "animate-pulse", "animate-bounce",
	"scale-95", "scale-x-110", "rotate-45", "-rotate-90", "translate-x-4", "-translate-y-2",
	"skew-x-6", "transform-gpu", "origin-center", "origin-top-left",
	// Closed by the Tailwind class-surface parity sweep: the bare chain-enablers,
	// the translate fractions beyond the one hardcoded `1/2`, and translate-3d.
	"transform", "filter", "backdrop-filter",
	"translate-x-1/3", "-translate-y-2/3", "translate-5/12", "translate-3d",
	"perspective-normal", "perspective-dramatic",
	"cursor-pointer", "cursor-not-allowed", "pointer-events-none", "select-none",
	"resize-none", "appearance-none", "touch-pan-y", "will-change-transform",
	"scroll-smooth", "snap-x", "snap-center", "scroll-mt-16",
	"sr-only", "not-sr-only", "z-0", "z-10", "z-50", "z-auto",

	// Variants
	"hover:bg-blue-600", "focus:outline-none", "focus-visible:ring-2", "active:scale-95",
	"disabled:opacity-50", "checked:bg-blue-600", "first:pt-0", "last:pb-0", "odd:bg-gray-50",
	"before:content-none", "after:absolute", "placeholder:text-gray-400", "selection:bg-blue-200",
	"file:mr-4", "marker:text-gray-400",
	"sm:flex", "md:grid", "lg:block", "xl:hidden", "2xl:flex",
	"dark:bg-zinc-900", "print:hidden", "motion-reduce:transition-none",
	"group-hover:underline", "peer-checked:block", "peer-focus:ring-2",
	"data-[state=open]:block", "data-open:block", "aria-expanded:rotate-180",
	"has-[:checked]:bg-blue-50", "not-hover:opacity-75", "supports-[display:grid]:grid",
	"group-data-[state=open]:rotate-180", "group-data-open:block", "group-aria-expanded:rotate-180",
	"peer-data-[open]:block", "peer-has-[:checked]:block", "group-has-[:checked]:bg-blue-50",
	"group-hover/item:underline", "peer-checked/sidebar:block",
	"group", "peer", "group/item", "peer/sidebar",
	"has-checked:bg-blue-50", "not-data-[open]:block", "not-supports-[display:grid]:block",
	"in-focus:underline", "nth-3:underline", "nth-of-type-2:underline",
	"@md:flex", "@container", "@max-md:flex", "@min-md:flex",
	"max-sm:hidden", "min-md:flex", "sm:max-md:flex",
	"sm:hover:bg-red-500", "dark:hover:bg-zinc-800", "md:focus:ring-2",
	"[&>*]:m-0", "[&_p]:leading-relaxed",

	// Arbitrary values and modifiers
	"w-[32px]", "bg-[#ff0000]", "text-[18px]", "p-[3.5rem]", "top-[-4px]",
	"grid-cols-[1fr_auto]", "text-lg/loose", "bg-red-500/[0.06]", "shadow-[0_0_0_1px_black]",
	"blur-[2px]", "rounded-[3px]", "min-w-[600px]", "min-[600px]:flex", "max-[600px]:hidden",
	"font-600", "rounded-4", "z-30",
]);

/**
 * Tailwind v4 classes the engine has no answer for, and the preset cannot
 * supply because they are utilities rather than tokens. Asserted red so the
 * gap is recorded in one place: when one closes, this test names it and the
 * class moves up into TAILWIND_COMMON.
 *
 * The `bg-gradient-to-*` / `max-w-screen-*` family is different in kind —
 * those are Tailwind v3 spellings that v4 itself renamed or removed, so they
 * belong to the migrator's rename table, not here.
 *
 * `shadow-inner` used to be listed there too, and that was simply wrong:
 * v4.3.3's own class list still contains it and still renders it. It lives in
 * upstream's deprecated block rather than the `--shadow-*` namespace, which is
 * why the preset generator's namespace sweep missed it. It is now generated
 * and appears in TAILWIND_COMMON below.
 */
/**
 * Empty, and that is the assertion.
 *
 * The last two entries — `ring-offset-2` and `ring-inset` — were the whole
 * remaining Tailwind parity gap, and they are implemented now. The table stays
 * because the test below is the one that would catch a *new* gap opening: a
 * name added here has to come with the reason it cannot be closed, the way the
 * three false premises below were removed once checking upstream showed they
 * were not Tailwind classes at all.
 */
const TAILWIND_UNSUPPORTED: readonly string[] = Object.freeze([]);

/**
 * Three entries left this table without any code changing, because checking
 * Tailwind v4.3.3's own source showed they are not Tailwind classes:
 *
 * - `items-normal` — upstream registers eight `items-*` values and this is not
 *   among them. `justify-items-normal` exists, `items-normal` does not; the
 *   asymmetry is Tailwind's, reproduced faithfully.
 * - `bg-position-center`, `bg-size-cover` — upstream registers `bg-position`
 *   and `bg-size` with no bare-value handling, so only the arbitrary and
 *   custom-property forms exist there too. The `bg-center` / `bg-cover`
 *   statics are the named spelling in both.
 *
 * A compatibility table is only worth its assertions if the things in it are
 * real, so they were removed rather than carried as gaps nobody could close.
 */

describe("rainbowindex/tailwind.css", () => {
	it("parses with no warnings", () => {
		expect(analysis.warnings).toEqual([]);
	});

	it("covers at least 200 classes in the compatibility table", () => {
		// A table that shrank silently would make every assertion below weaker
		// without failing anything.
		expect(TAILWIND_COMMON.length).toBeGreaterThanOrEqual(200);
		expect(new Set(TAILWIND_COMMON).size).toBe(TAILWIND_COMMON.length);
	});

	it("resolves every class in the compatibility table", () => {
		// Collected, not thrown on first failure: one run should name every
		// reject, because that list is the actual work item.
		const failures = TAILWIND_COMMON.filter((c) => !withPreset.validate(c).ok);
		expect(failures).toEqual([]);
	});

	it("leaves the recorded gaps unsupported", () => {
		const unexpectedlyWorking = TAILWIND_UNSUPPORTED.filter((c) => withPreset.validate(c).ok);
		expect(unexpectedlyWorking).toEqual([]);
	});

	it("supplies the scales the bare engine does not have", () => {
		// The whole reason the preset exists: each of these renders nothing on a
		// fresh install. If one starts passing bare, the engine grew a default
		// scale and the preset's framing in the docs is out of date.
		const presetOnly = [
			"text-lg",
			"font-bold",
			"shadow-md",
			"rounded-lg",
			"rounded",
			"blur-sm",
			"ease-in",
			"animate-spin",
			"leading-tight",
			"tracking-widest",
			"bg-red-500",
			"sm:flex",
			"container",
		];
		expect(presetOnly.filter((c) => bare.validate(c).ok)).toEqual([]);
		expect(presetOnly.filter((c) => !withPreset.validate(c).ok)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Composed box-shadow / filter chains
// ---------------------------------------------------------------------------

/**
 * The preset's shadow-family `@utility` blocks, as [name, declarations]. The
 * `container` block is a different animal — nested media queries, no composed
 * chain — and has no arbitrary-value twin to compare against.
 */
function presetUtilities(): Array<[string, Array<[string, string]>]> {
	const out: Array<[string, Array<[string, string]>]> = [];
	const block =
		/@utility\s+((?:inset-shadow|text-shadow|drop-shadow)(?:-[a-z0-9-]+)?)\s*\{([^}]*)\}/g;
	for (const match of PRESET.matchAll(block)) {
		const declarations: Array<[string, string]> = [];
		for (const line of match[2].split(";")) {
			const colon = line.indexOf(":");
			if (colon === -1) continue;
			declarations.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
		}
		out.push([match[1], declarations]);
	}
	return out;
}

/**
 * The arbitrary-value class that should emit the same declarations as the
 * preset's named one. Spaces become underscores, which is how the class
 * grammar spells a value containing whitespace.
 */
function arbitraryTwin(name: string, declarations: Array<[string, string]>): string {
	const value = (property: string): string => declarations.find(([p]) => p === property)?.[1] ?? "";
	if (name.startsWith("inset-shadow-")) {
		return `inset-shadow-[${value("--ri-inset-shadow").replace(/ /g, "_")}]`;
	}
	if (name.startsWith("text-shadow-")) {
		return `text-shadow-[${value("text-shadow").replace(/ /g, "_")}]`;
	}
	// drop-shadow: the utility wraps EACH layer in its own drop-shadow(…),
	// because the function takes exactly one shadow. The arbitrary form takes
	// the bare layers, comma-separated — so unwrapping has to be per layer. A
	// single greedy `^drop-shadow\((.*)\)$` turned the two-layer default into
	// `A) drop-shadow(B`, a value whose delimiters do not close.
	return `drop-shadow-[${dropShadowLayers(value("--ri-drop-shadow")).join(", ").replace(/ /g, "_")}]`;
}

/** The inner value of each `drop-shadow(…)` call in a composed chain. */
function dropShadowLayers(composed: string): string[] {
	const layers: string[] = [];
	const CALL = "drop-shadow(";
	for (let i = composed.indexOf(CALL); i !== -1; i = composed.indexOf(CALL, i)) {
		let depth = 0;
		let j = i + CALL.length - 1;
		for (; j < composed.length; j++) {
			if (composed[j] === "(") depth++;
			else if (composed[j] === ")" && --depth === 0) break;
		}
		layers.push(composed.slice(i + CALL.length, j));
		i = j + 1;
	}
	return layers;
}

describe("preset @utility blocks match what the engine composes natively", () => {
	const utilities = presetUtilities();

	it("finds every shadow-family utility block", () => {
		// A regex that silently matched nothing would make this whole block a
		// no-op: 3 inset-shadow, 5 text-shadow, 7 drop-shadow.
		expect(utilities.map(([name]) => name)).toEqual([
			"inset-shadow-2xs",
			"inset-shadow-xs",
			"inset-shadow-sm",
			"text-shadow-2xs",
			"text-shadow-xs",
			"text-shadow-sm",
			"text-shadow-md",
			"text-shadow-lg",
			"drop-shadow",
			"drop-shadow-xs",
			"drop-shadow-sm",
			"drop-shadow-md",
			"drop-shadow-lg",
			"drop-shadow-xl",
			"drop-shadow-2xl",
		]);
	});

	for (const [name, declarations] of utilities) {
		it(`${name} emits the engine's own composition chain`, () => {
			// The chains are module-private constants in src/utilities/effects/,
			// so the only way to compare is against the engine's real output for
			// the same value written as an arbitrary utility. A change to either
			// chain that the generator was not re-run for fails right here.
			const twin = bare.explain(arbitraryTwin(name, declarations));
			expect(twin, `${name}: arbitrary twin did not resolve`).not.toBeNull();
			expect(twin?.declarations.map((d) => [d.property, d.value])).toEqual(declarations);
		});
	}
});
