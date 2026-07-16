/**
 * Regression tests for the ri() audit fixes: negative utilities, bg/font
 * dual-mode dispatch, arbitrary-value type hints, theme color names, the
 * important-modifier namespace, cache-key disambiguation, OVERRIDES gaps,
 * variant-order claim keys, and non-string inputs.
 */
import { afterEach, describe, expect, test } from "vitest";
import {
	ri,
	createRi,
	createCompilationContext,
	registerColorNames,
	finalizeCompilationContext,
} from "../../src/merge/index.js";
import { createCompiler } from "../../src/engine/index.js";
import { resolveDirectives, type ResolvedTheme } from "../../src/directives/index.js";

afterEach(() => {
	finalizeCompilationContext(createCompilationContext());
});

// ---------------------------------------------------------------------------
// Negative utilities (-mt-4) share claims with their positive form
// ---------------------------------------------------------------------------

describe("ri() negative utilities", () => {
	test("two negatives of the same family conflict", () => {
		expect(ri("-mt-2", "-mt-8")).toBe("-mt-8");
		expect(ri("-z-10", "-z-20")).toBe("-z-20");
	});

	test("negative and positive forms conflict in both directions", () => {
		expect(ri("mt-4", "-mt-4")).toBe("-mt-4");
		expect(ri("-mt-4", "mt-4")).toBe("mt-4");
		expect(ri("-z-10", "z-50")).toBe("z-50");
	});

	test("negative arbitrary values participate", () => {
		expect(ri("-mt-[2px]", "-mt-4")).toBe("-mt-4");
		expect(ri("-translate-x-[10px]", "translate-x-4")).toBe("translate-x-4");
	});

	test("negatives respect variant scoping", () => {
		expect(ri("hover:-mt-2", "hover:mt-8")).toBe("hover:mt-8");
		expect(ri("-mt-2", "hover:-mt-8")).toBe("-mt-2 hover:-mt-8");
	});

	test("negatives of different families don't conflict", () => {
		expect(ri("-mt-2", "-mb-2")).toBe("-mt-2 -mb-2");
	});

	test("negative with important merges within its namespace", () => {
		expect(ri("-mt-2!", "-mt-8!")).toBe("-mt-8!");
	});
});

// ---------------------------------------------------------------------------
// bg dual-mode: background-color vs background-image (never `background`)
// ---------------------------------------------------------------------------

describe("ri() bg dual-mode", () => {
	test("bg color, size, and image set different properties", () => {
		expect(ri("bg-red-500 bg-cover", "bg-[url(/x.png)]")).toBe(
			"bg-red-500 bg-cover bg-[url(/x.png)]",
		);
	});

	test("custom-property bg is a color, not the background shorthand", () => {
		expect(ri("bg-(--brand)", "bg-red-500")).toBe("bg-red-500");
		expect(ri("bg-red-500", "bg-(--brand)")).toBe("bg-(--brand)");
	});

	test("two image values conflict", () => {
		expect(ri("bg-[url(/a.png)]", "bg-[url(/b.png)]")).toBe("bg-[url(/b.png)]");
	});

	test("bg-none (background-image) conflicts with image values", () => {
		expect(ri("bg-none", "bg-[url(/x.png)]")).toBe("bg-[url(/x.png)]");
	});

	test("image: hint forces the image path", () => {
		expect(ri("bg-(image:--pattern)", "bg-[url(/x.png)]")).toBe("bg-[url(/x.png)]");
		expect(ri("bg-[image:linear-gradient(red,blue)]", "bg-red-500")).toBe(
			"bg-[image:linear-gradient(red,blue)] bg-red-500",
		);
	});

	test("gradient values are images", () => {
		expect(ri("bg-[linear-gradient(red,blue)]", "bg-[url(/x.png)]")).toBe("bg-[url(/x.png)]");
	});
});

// ---------------------------------------------------------------------------
// font dual-mode: arbitrary font stacks are families, not weights
// ---------------------------------------------------------------------------

describe("ri() font dual-mode arbitraries", () => {
	test("font stack and weight set different properties", () => {
		expect(ri("font-[Georgia,_serif]", "font-bold")).toBe("font-[Georgia,_serif] font-bold");
		expect(ri("font-bold", "font-[Georgia,_serif]")).toBe("font-bold font-[Georgia,_serif]");
	});

	test("font stack conflicts with family slots in both directions", () => {
		expect(ri("font-[Georgia,_serif]", "font-sans")).toBe("font-sans");
		expect(ri("font-sans", "font-[Georgia,_serif]")).toBe("font-[Georgia,_serif]");
	});

	test("family-name hint and quoted stacks are families", () => {
		expect(ri("font-[family-name:var(--f)]", "font-mono")).toBe("font-mono");
		expect(ri('font-["Inter"]', "font-bold")).toBe('font-["Inter"] font-bold');
	});

	test("plain arbitrary weights still conflict with named weights", () => {
		expect(ri("font-[650]", "font-bold")).toBe("font-bold");
	});
});

// ---------------------------------------------------------------------------
// Type hints: [color:…] / (color:…) classify as colors
// ---------------------------------------------------------------------------

describe("ri() arbitrary type hints", () => {
	test("text color hint conflicts with text colors, not sizes", () => {
		expect(ri("text-[color:var(--x)]", "text-red-500")).toBe("text-red-500");
		expect(ri("text-red-500", "text-[color:var(--x)]")).toBe("text-[color:var(--x)]");
		expect(ri("text-[color:var(--x)]", "text-lg")).toBe("text-[color:var(--x)] text-lg");
	});

	test("non-color hints still claim font-size", () => {
		expect(ri("text-[length:var(--x)]", "text-lg")).toBe("text-lg");
		expect(ri("text-[length:var(--x)]", "text-red-500")).toBe(
			"text-[length:var(--x)] text-red-500",
		);
	});

	test("border color hint conflicts with border colors, coexists with widths", () => {
		expect(ri("border-[color:var(--x)]", "border-red-500")).toBe("border-red-500");
		expect(ri("border-[color:var(--x)]", "border-2")).toBe("border-[color:var(--x)] border-2");
	});

	test("paren color hint behaves like the bracket form", () => {
		expect(ri("border-(color:--x)", "border-red-500")).toBe("border-red-500");
		expect(ri("border-(color:--x)", "border-2")).toBe("border-(color:--x) border-2");
	});

	test("directional border color hint", () => {
		expect(ri("border-t-[color:var(--x)]", "border-t-red-500")).toBe("border-t-red-500");
		expect(ri("border-t-[color:var(--x)]", "border-t-2")).toBe(
			"border-t-[color:var(--x)] border-t-2",
		);
	});
});

// ---------------------------------------------------------------------------
// Theme color names reach the merge (flat custom colors)
// ---------------------------------------------------------------------------

describe("ri() custom flat theme colors", () => {
	test("registered color names classify bare utilities as colors (global path)", () => {
		const ctx = createCompilationContext();
		registerColorNames(ctx, ["accent"]);
		finalizeCompilationContext(ctx);

		expect(ri("border-accent", "border-red-500")).toBe("border-red-500");
		expect(ri("border-accent", "border-2")).toBe("border-accent border-2");
		expect(ri("bg-accent", "bg-red-500")).toBe("bg-red-500");
		expect(ri("bg-accent/50", "bg-red-500")).toBe("bg-red-500");
	});

	test("snapshot-bound createRi() carries its own color names", () => {
		const ctx = createCompilationContext();
		registerColorNames(ctx, ["accent"]);
		const snapshot = finalizeCompilationContext(ctx);
		// Reset globals to prove the bound instance reads the snapshot.
		finalizeCompilationContext(createCompilationContext());

		const boundRi = createRi(snapshot);
		expect(boundRi("border-accent border-red-500")).toBe("border-red-500");
		expect(boundRi("border-accent border-2")).toBe("border-accent border-2");
		// The reset global path no longer knows "accent" → both claim border-width.
		expect(ri("border-accent border-2")).toBe("border-2");
	});

	test("compiled themes register their color names end-to-end", () => {
		// Equivalent of `@color { accent: oklch(0.72 0.21 330); }`, constructed
		// on the resolved theme so the test exercises the engine registration.
		const base = resolveDirectives([]);
		const theme: ResolvedTheme = {
			...base,
			colors: { ...base.colors, accent: { type: "explicit", value: "oklch(0.72 0.21 330)" } },
		};
		const compiler = createCompiler();
		compiler.compile(["border-accent"], theme);
		const boundRi = compiler.createRi();

		expect(boundRi("border-accent", "border-red-500")).toBe("border-red-500");
		expect(boundRi("border-accent", "border-2")).toBe("border-accent border-2");
		// Palette bases keep working via the shade pattern.
		expect(boundRi("border-accent-500", "border-red-500")).toBe("border-red-500");
	});

	test("default generative palette names work after any compile", () => {
		const compiler = createCompiler();
		compiler.compile(["flex"], resolveDirectives([]));
		const boundRi = compiler.createRi();
		expect(boundRi("border-theme", "border-red-500")).toBe("border-red-500");
	});
});

// ---------------------------------------------------------------------------
// Cache key disambiguation (tokens may contain spaces)
// ---------------------------------------------------------------------------

describe("ri() cache key", () => {
	test("malformed bracket calls don't poison well-formed ones (raw-args path)", () => {
		expect(ri("p-[1px 2px]", "p-4")).toBe("p-4");
		expect(ri("p-[1px", "2px]", "p-4")).toBe("2px] p-4");
		// Repeat in reverse order to hit both cache entries.
		expect(ri("p-[1px", "2px]", "p-4")).toBe("2px] p-4");
		expect(ri("p-[1px 2px]", "p-4")).toBe("p-4");
	});

	test("malformed bracket calls don't poison well-formed ones (token path)", () => {
		expect(ri(["p-[1px 2px]"], "p-4")).toBe("p-4");
		expect(ri(["p-[1px", "2px]"], "p-4")).toBe("2px] p-4");
		expect(ri(["p-[1px", "2px]"], "p-4")).toBe("2px] p-4");
		expect(ri(["p-[1px 2px]"], "p-4")).toBe("p-4");
	});

	test("raw fast path matches the flattened path", () => {
		expect(ri("  p-4   m-2  ")).toBe("p-4 m-2");
		expect(ri("p-2 bg-red-500", "p-4")).toBe(ri(["p-2 bg-red-500"], ["p-4"]));
		// Repeat calls (cache hits) stay stable.
		expect(ri("p-2 bg-red-500", "p-4")).toBe("bg-red-500 p-4");
		expect(ri("p-2 bg-red-500", "p-4")).toBe("bg-red-500 p-4");
	});
});

// ---------------------------------------------------------------------------
// OVERRIDES gaps: place-self, animation, border
// ---------------------------------------------------------------------------

describe("ri() shorthand override gaps", () => {
	test("place-self overrides align-self and justify-self", () => {
		expect(ri("self-center", "place-self-start")).toBe("place-self-start");
		expect(ri("justify-self-end", "place-self-start")).toBe("place-self-start");
		// Longhand to the right of the shorthand survives.
		expect(ri("place-self-start", "self-center")).toBe("place-self-start self-center");
	});

	test("animation shorthand overrides its longhands", () => {
		expect(ri("animate-infinite", "animate-spin")).toBe("animate-spin");
		expect(ri("animate-paused", "animate-spin")).toBe("animate-spin");
		expect(ri("animate-duration-300", "[animation:spin_1s_linear_infinite]")).toBe(
			"[animation:spin_1s_linear_infinite]",
		);
		// Longhand to the right composes with the shorthand.
		expect(ri("animate-spin", "animate-infinite")).toBe("animate-spin animate-infinite");
	});

	test("border shorthand overrides width, style, color, and sides", () => {
		expect(ri("border-2", "[border:1px_solid_red]")).toBe("[border:1px_solid_red]");
		expect(ri("border-red-500", "[border:1px_solid_red]")).toBe("[border:1px_solid_red]");
		expect(ri("border-dashed", "[border:1px_solid_red]")).toBe("[border:1px_solid_red]");
		expect(ri("border-t-2", "[border:1px_solid_red]")).toBe("[border:1px_solid_red]");
		expect(ri("border-t-red-500", "[border:1px_solid_red]")).toBe("[border:1px_solid_red]");
	});
});

// ---------------------------------------------------------------------------
// Variant order: sm:hover: and hover:sm: claim the same namespace
// ---------------------------------------------------------------------------

describe("ri() variant order normalization", () => {
	test("reordered variants conflict in both directions", () => {
		expect(ri("sm:hover:p-4", "hover:sm:p-2")).toBe("hover:sm:p-2");
		expect(ri("hover:sm:p-2", "sm:hover:p-4")).toBe("sm:hover:p-4");
	});

	test("three variants normalize too", () => {
		expect(ri("dark:sm:hover:p-4", "hover:dark:sm:p-2")).toBe("hover:dark:sm:p-2");
	});

	test("different variant sets stay independent", () => {
		expect(ri("sm:hover:p-4", "sm:focus:p-2")).toBe("sm:hover:p-4 sm:focus:p-2");
		expect(ri("sm:p-4", "hover:p-2")).toBe("sm:p-4 hover:p-2");
	});

	test("bracketed colons don't count as variant separators", () => {
		expect(ri("data-[state=open]:p-4", "data-[state=open]:p-2")).toBe("data-[state=open]:p-2");
		expect(ri("data-[a:b]:p-4", "data-[a:b]:p-2")).toBe("data-[a:b]:p-2");
	});
});

// ---------------------------------------------------------------------------
// Non-string inputs (clsx-style objects) are skipped, not crashed on
// ---------------------------------------------------------------------------

describe("ri() non-string inputs", () => {
	test("objects and numbers are skipped without throwing", () => {
		expect(ri("p-4", { active: true } as never, 0 as never)).toBe("p-4");
		expect(ri("p-4", 5 as never)).toBe("p-4");
		expect(ri({ active: true } as never)).toBe("");
	});
});

// ---------------------------------------------------------------------------
// via-none keeps its pre-simplification behavior
// ---------------------------------------------------------------------------

describe("ri() via-none regression", () => {
	test("via-none merges with via colors and composes with positions", () => {
		expect(ri("via-none", "via-red-500")).toBe("via-red-500");
		expect(ri("via-red-500", "via-none")).toBe("via-none");
		expect(ri("via-30%", "via-none")).toBe("via-30% via-none");
	});
});
