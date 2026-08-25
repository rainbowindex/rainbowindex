import { afterEach, describe, expect, test } from "vitest";
import {
	createCompilationContext,
	registerCustomUtility,
	finalizeCompilationContext,
} from "../../src/merge/context.js";
import { ri } from "../../src/merge/index.js";
import { BUILTIN_STATIC_KEYS } from "../../src/merge/props.js";
import { assertPrefixPropParity, assertStaticUtilityParity } from "../helpers/merge-parity.js";
import {
	STATIC_UTILITIES,
	MULTI_SEGMENT_PREFIXES,
	PARSER_ONLY_STATICS,
} from "../../src/utilities/parser.js";

// ---------------------------------------------------------------------------
// Edge cases from REFACTOR.md spec
// ---------------------------------------------------------------------------

describe("ri() edge cases", () => {
	test("empty string returns empty string", () => {
		expect(ri("")).toBe("");
	});

	test("all falsy inputs produce empty string", () => {
		expect(ri(null, undefined, false)).toBe("");
	});

	test("duplicates are deduplicated (rightmost wins)", () => {
		expect(ri("p-4 p-4 p-4")).toBe("p-4");
	});

	test("dedup across separate arguments", () => {
		expect(ri("p-4", "p-4")).toBe("p-4");
	});

	test("leading/trailing/extra whitespace is normalized", () => {
		expect(ri("  p-4  m-4  ")).toBe("p-4 m-4");
	});

	test("unknown classes pass through unchanged", () => {
		expect(ri("unknown-class")).toBe("unknown-class");
	});

	test("arbitrary values work", () => {
		expect(ri("p-[20px]")).toBe("p-[20px]");
	});

	test("arbitrary and token-based conflict — rightmost wins", () => {
		expect(ri("p-[20px] p-4")).toBe("p-4");
	});

	test("single class returned as-is", () => {
		expect(ri("flex")).toBe("flex");
	});

	test("no arguments returns empty string", () => {
		expect(ri()).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Falsy value filtering (clsx replacement)
// ---------------------------------------------------------------------------

describe("ri() falsy filtering", () => {
	test("false values are filtered", () => {
		expect(ri("flex", false, "items-center")).toBe("flex items-center");
	});

	test("null values are filtered", () => {
		expect(ri("flex", null, "items-center")).toBe("flex items-center");
	});

	test("undefined values are filtered", () => {
		expect(ri("flex", undefined, "items-center")).toBe("flex items-center");
	});

	test("conditional expression pattern", () => {
		const isActive = true;
		const isDisabled = false;
		expect(ri("flex", isActive && "bg-blue-500", isDisabled && "opacity-50")).toBe(
			"flex bg-blue-500",
		);
	});

	test("nested arrays are flattened", () => {
		expect(ri(["flex", "items-center"], "p-4")).toBe("flex items-center p-4");
	});

	test("deeply nested arrays with falsy values", () => {
		expect(ri(["flex", [null, ["items-center", false]]], "p-4")).toBe("flex items-center p-4");
	});

	test("empty string in array", () => {
		expect(ri(["", "flex", ""])).toBe("flex");
	});
});

// ---------------------------------------------------------------------------
// Basic conflict resolution
// ---------------------------------------------------------------------------

describe("ri() basic conflicts", () => {
	test("rightmost wins for same property", () => {
		expect(ri("p-2 bg-red-500", "p-4")).toBe("bg-red-500 p-4");
	});

	test("display conflict — last wins", () => {
		expect(ri("block", "flex")).toBe("flex");
		expect(ri("flex", "hidden")).toBe("hidden");
		expect(ri("inline-flex", "grid")).toBe("grid");
	});

	test("position conflict — last wins", () => {
		expect(ri("relative", "absolute")).toBe("absolute");
		expect(ri("fixed", "sticky")).toBe("sticky");
	});

	test("flex-direction conflict", () => {
		expect(ri("flex-row", "flex-col")).toBe("flex-col");
	});

	test("alignment conflict", () => {
		expect(ri("items-start", "items-center")).toBe("items-center");
		expect(ri("justify-start", "justify-between")).toBe("justify-between");
	});

	test("text alignment conflict", () => {
		expect(ri("text-left", "text-center")).toBe("text-center");
	});

	test("visibility conflict", () => {
		expect(ri("visible", "invisible")).toBe("invisible");
	});

	test("cursor conflict", () => {
		expect(ri("cursor-pointer", "cursor-not-allowed")).toBe("cursor-not-allowed");
	});

	test("overflow conflict", () => {
		expect(ri("overflow-hidden", "overflow-auto")).toBe("overflow-auto");
	});

	test("scrollbar-width conflict", () => {
		expect(ri("scrollbar-auto", "scrollbar-thin")).toBe("scrollbar-thin");
		expect(ri("scrollbar-thin", "scrollbar-none")).toBe("scrollbar-none");
	});

	test("mask-composite conflict", () => {
		expect(ri("mask-add", "mask-subtract")).toBe("mask-subtract");
		expect(ri("mask-intersect", "mask-exclude")).toBe("mask-exclude");
		// mask-composite is a separate slot from the radial shape var — both kept.
		expect(ri("mask-circle mask-add")).toBe("mask-circle mask-add");
	});

	test("mask gradient stops compose; same end dedupes", () => {
		// from + to touch different stop vars → both survive (shared mask-image is fine).
		expect(ri("mask-linear-from-20% mask-linear-to-80%")).toBe(
			"mask-linear-from-20% mask-linear-to-80%",
		);
		// Same end, two values → rightmost wins.
		expect(ri("mask-linear-from-20% mask-linear-from-50%")).toBe("mask-linear-from-50%");
		// Color vs position on the same end are distinct slots → both kept.
		expect(ri("mask-linear-from-20% mask-linear-from-red-500")).toBe(
			"mask-linear-from-20% mask-linear-from-red-500",
		);
	});

	test("mask longhand last-wins", () => {
		expect(ri("mask-clip-border mask-clip-padding")).toBe("mask-clip-padding");
		expect(ri("mask-alpha", "mask-luminance")).toBe("mask-luminance");
		expect(ri("mask-type-alpha", "mask-type-luminance")).toBe("mask-type-luminance");
		expect(ri("mask-cover", "mask-contain")).toBe("mask-contain");
	});

	test("space-x/y dedupe; reverse composes; scoped from element margins", () => {
		expect(ri("space-x-4 space-x-8")).toBe("space-x-8");
		// reverse sets a different (scoped) property → composes with space-x-N
		expect(ri("space-x-4 space-x-reverse")).toBe("space-x-4 space-x-reverse");
		// space margins are scoped (~space:) so they don't merge with element margins
		expect(ri("space-x-4 mx-2")).toBe("space-x-4 mx-2");
	});

	test("divide-x/y dedupe per axis; reverse composes; scoped from element borders", () => {
		expect(ri("divide-x-2 divide-x-4")).toBe("divide-x-4");
		// x and y claim different scoped props → both survive
		expect(ri("divide-x-2 divide-y-4")).toBe("divide-x-2 divide-y-4");
		// reverse sets a different (scoped) property → composes with divide-x-N
		expect(ri("divide-x-4 divide-x-reverse")).toBe("divide-x-4 divide-x-reverse");
		// divide widths are scoped (~divide:) so they don't merge with element border widths
		expect(ri("divide-x-4 border-2")).toBe("divide-x-4 border-2");
	});

	test("border-bs/be width-vs-color dual-mode; divide style dedupes incl. hidden", () => {
		// bs/be width and color set different logical props → both survive
		expect(ri("border-bs-2 border-bs-[#f00]")).toBe("border-bs-2 border-bs-[#f00]");
		// two bs colors collapse to the last
		expect(ri("border-bs-[#f00] border-bs-[#00f]")).toBe("border-bs-[#00f]");
		// divide styles share the scoped border-style key → last wins (hidden included)
		expect(ri("divide-solid divide-hidden")).toBe("divide-hidden");
	});

	test("text size with line-height modifier merges as font-size, not color", () => {
		expect(ri("text-lg/7 text-xl/8")).toBe("text-xl/8");
		expect(ri("text-lg/7 text-red-500")).toBe("text-lg/7 text-red-500");
	});

	test("flex/grid value utilities dedupe by property", () => {
		expect(ri("flex-3 flex-5")).toBe("flex-5");
		expect(ri("flex-3 flex-auto")).toBe("flex-auto");
		expect(ri("grow-2 grow-3")).toBe("grow-3");
		expect(ri("shrink-0 shrink-2")).toBe("shrink-2");
		expect(ri("col-2 col-3")).toBe("col-3");
		expect(ri("row-2 row-3")).toBe("row-3");
		// bare flex (display) and the flex shorthand are different properties → both kept
		expect(ri("flex flex-1")).toBe("flex flex-1");
	});

	test("logical sizing merges independently of the display overload", () => {
		// inline-size / block-size dedupe by their own property
		expect(ri("inline-4 inline-8")).toBe("inline-8");
		expect(ri("block-4 block-8")).toBe("block-8");
		// display + sizing share the prefix but set different properties → both kept
		expect(ri("inline-block inline-4")).toBe("inline-block inline-4");
		expect(ri("inline inline-4")).toBe("inline inline-4");
		// logical vs physical are distinct properties (not cross-merged), like ms vs ml
		expect(ri("w-8 inline-4")).toBe("w-8 inline-4");
	});

	test("non-conflicting classes preserved", () => {
		expect(ri("flex items-center p-4")).toBe("flex items-center p-4");
	});

	test("multiple non-conflicting classes across arguments", () => {
		expect(ri("flex items-center", "p-4 m-2")).toBe("flex items-center p-4 m-2");
	});
});

// ---------------------------------------------------------------------------
// Spacing conflicts
// ---------------------------------------------------------------------------

describe("ri() spacing conflicts", () => {
	test("padding conflict — rightmost wins", () => {
		expect(ri("p-2", "p-4")).toBe("p-4");
	});

	test("decimal spacing conflicts — rightmost wins", () => {
		expect(ri("px-3.75", "px-4")).toBe("px-4");
		expect(ri("m-0.75", "m-1")).toBe("m-1");
	});

	test("margin conflict — rightmost wins", () => {
		expect(ri("m-2", "m-4")).toBe("m-4");
	});

	test("directional padding doesn't conflict with each other", () => {
		expect(ri("pt-2 pb-4")).toBe("pt-2 pb-4");
	});

	test("padding x and y don't conflict", () => {
		expect(ri("px-2 py-4")).toBe("px-2 py-4");
	});

	test("gap conflict", () => {
		expect(ri("gap-2", "gap-4")).toBe("gap-4");
	});

	test("gap-x and gap-y don't conflict", () => {
		expect(ri("gap-x-2 gap-y-4")).toBe("gap-x-2 gap-y-4");
	});

	test("width conflict", () => {
		expect(ri("w-full", "w-1/2")).toBe("w-1/2");
	});

	test("height conflict", () => {
		expect(ri("h-screen", "h-full")).toBe("h-full");
	});

	test("inset conflict", () => {
		expect(ri("top-0", "top-4")).toBe("top-4");
	});
});

// ---------------------------------------------------------------------------
// Shorthand → longhand overrides
// ---------------------------------------------------------------------------

describe("ri() shorthand/longhand overrides", () => {
	test("p shorthand wins over px/py", () => {
		expect(ri("px-2 py-1", "p-4")).toBe("p-4");
	});

	test("p shorthand wins over pt/pb/pl/pr", () => {
		expect(ri("pt-2 pb-2 pl-2 pr-2", "p-4")).toBe("p-4");
	});

	test("px shorthand wins over pl/pr", () => {
		expect(ri("pl-2 pr-2", "px-4")).toBe("px-4");
	});

	test("longhand doesn't suppress shorthand to the right", () => {
		expect(ri("p-4", "px-2")).toBe("p-4 px-2");
	});

	test("margin shorthand wins over longhands", () => {
		expect(ri("mx-2 my-1", "m-4")).toBe("m-4");
	});

	test("gap shorthand wins over gap-x/gap-y", () => {
		expect(ri("gap-x-2 gap-y-4", "gap-8")).toBe("gap-8");
	});

	test("inset shorthand wins over inset-x/inset-y", () => {
		expect(ri("inset-x-2 inset-y-4", "inset-0")).toBe("inset-0");
	});

	test("border-radius shorthand wins over corners", () => {
		expect(ri("rounded-tl-lg rounded-tr-lg", "rounded-lg")).toBe("rounded-lg");
	});

	test("border-width shorthand wins over sides", () => {
		expect(ri("border-t border-b", "border-2")).toBe("border-2");
	});

	test("rounded side shorthand wins over specific corners", () => {
		expect(ri("rounded-tl-lg rounded-tr-lg", "rounded-t-lg")).toBe("rounded-t-lg");
	});
});

// ---------------------------------------------------------------------------
// Dual-mode: text-{size} vs text-{color}
// ---------------------------------------------------------------------------

describe("ri() text dual-mode", () => {
	test("text-lg and text-red-500 don't conflict", () => {
		expect(ri("text-lg text-red-500")).toBe("text-lg text-red-500");
	});

	test("text-xl and text-lg conflict (both are sizes)", () => {
		expect(ri("text-lg text-xl")).toBe("text-xl");
	});

	test("text-red-500 and text-blue-500 conflict (both are colors)", () => {
		expect(ri("text-red-500 text-blue-500")).toBe("text-blue-500");
	});

	test("slash-alpha colors still conflict as colors", () => {
		expect(ri("text-red-500/50 text-blue-500/75")).toBe("text-blue-500/75");
	});

	test("text-sm and text-black — different properties", () => {
		expect(ri("text-sm text-black")).toBe("text-sm text-black");
	});

	test("text-base and text-inherit — different properties", () => {
		expect(ri("text-base text-inherit")).toBe("text-base text-inherit");
	});

	test("text-lg and text-left don't conflict", () => {
		expect(ri("text-lg text-left")).toBe("text-lg text-left");
	});

	test("text-red-500 and text-left don't conflict", () => {
		expect(ri("text-red-500 text-left")).toBe("text-red-500 text-left");
	});
});

// ---------------------------------------------------------------------------
// Dual-mode: font-{weight} vs font-{family}
// ---------------------------------------------------------------------------

describe("ri() font dual-mode", () => {
	test("font-bold and font-sans don't conflict", () => {
		expect(ri("font-bold font-sans")).toBe("font-bold font-sans");
	});

	test("font-bold and font-semibold conflict (both weights)", () => {
		expect(ri("font-bold font-semibold")).toBe("font-semibold");
	});

	test("font-sans and font-mono conflict (both families)", () => {
		expect(ri("font-sans font-mono")).toBe("font-mono");
	});
});

// ---------------------------------------------------------------------------
// Dual-mode: border-{width} vs border-{color}
// ---------------------------------------------------------------------------

describe("ri() border dual-mode", () => {
	test("border-2 and border-red-500 don't conflict", () => {
		expect(ri("border-2 border-red-500")).toBe("border-2 border-red-500");
	});

	test("border-2 and border-4 conflict (both widths)", () => {
		expect(ri("border-2 border-4")).toBe("border-4");
	});

	test("border-red-500 and border-blue-500 conflict (both colors)", () => {
		expect(ri("border-red-500 border-blue-500")).toBe("border-blue-500");
	});
});

// ---------------------------------------------------------------------------
// Dual-mode: decoration-{thickness} vs decoration-{color}
// ---------------------------------------------------------------------------

describe("ri() decoration dual-mode", () => {
	test("decoration-2 and decoration-red-500 don't conflict", () => {
		expect(ri("decoration-2 decoration-red-500")).toBe("decoration-2 decoration-red-500");
	});

	test("decoration-2 and decoration-4 conflict", () => {
		expect(ri("decoration-2 decoration-4")).toBe("decoration-4");
	});
});

// ---------------------------------------------------------------------------
// Variant-scoped conflicts
// ---------------------------------------------------------------------------

describe("ri() variant-scoped conflicts", () => {
	test("hover:p-4 and p-4 don't conflict (different variants)", () => {
		expect(ri("p-4 hover:p-4")).toBe("p-4 hover:p-4");
	});

	test("hover:p-4 and hover:p-8 conflict (same variant)", () => {
		expect(ri("hover:p-4 hover:p-8")).toBe("hover:p-8");
	});

	test("sm:p-4 and md:p-4 don't conflict (different variants)", () => {
		expect(ri("sm:p-4 md:p-4")).toBe("sm:p-4 md:p-4");
	});

	test("sm:hover:p-4 and sm:hover:p-8 conflict", () => {
		expect(ri("sm:hover:p-4 sm:hover:p-8")).toBe("sm:hover:p-8");
	});

	test("hover:text-lg and hover:text-red-500 don't conflict", () => {
		expect(ri("hover:text-lg hover:text-red-500")).toBe("hover:text-lg hover:text-red-500");
	});

	test("variant with shorthand/longhand", () => {
		expect(ri("hover:px-2 hover:p-4")).toBe("hover:p-4");
	});
});

// ---------------------------------------------------------------------------
// Important (!) prefix
// ---------------------------------------------------------------------------

describe("ri() important suffix", () => {
	test("important and non-important never dominate each other", () => {
		// In CSS, p-4! beats a later p-2 regardless of order — dropping either
		// side would change the rendered result, so both must survive.
		expect(ri("p-2", "p-4!")).toBe("p-2 p-4!");
		expect(ri("p-4!", "p-2")).toBe("p-4! p-2");
		expect(ri("block", "flex!")).toBe("block flex!");
	});

	test("same-importance repeats still merge", () => {
		expect(ri("p-4!", "p-2!")).toBe("p-2!");
		expect(ri("flex!", "block!")).toBe("block!");
		expect(ri("hover:p-4!", "hover:p-2!")).toBe("hover:p-2!");
	});
});

// ---------------------------------------------------------------------------
// Dynamic prefixes
// ---------------------------------------------------------------------------

describe("ri() dynamic prefix conflicts", () => {
	test("z-index conflict", () => {
		expect(ri("z-10 z-50")).toBe("z-50");
	});

	test("order conflict", () => {
		expect(ri("order-1 order-2")).toBe("order-2");
	});

	test("opacity conflict", () => {
		expect(ri("opacity-50 opacity-100")).toBe("opacity-100");
	});

	test("shadow conflict", () => {
		expect(ri("shadow-sm shadow-lg")).toBe("shadow-lg");
	});

	test("rounded conflict", () => {
		expect(ri("rounded-sm rounded-lg")).toBe("rounded-lg");
	});

	test("duration conflict", () => {
		expect(ri("duration-100 duration-300")).toBe("duration-300");
	});

	test("delay conflict", () => {
		expect(ri("delay-100 delay-200")).toBe("delay-200");
	});

	test("translate conflicts", () => {
		expect(ri("translate-x-2 translate-x-4")).toBe("translate-x-4");
	});

	test("translate-x and translate-y are composable (different CSS variables)", () => {
		// translate-x sets --ri-translate-x, translate-y sets --ri-translate-y — both survive
		expect(ri("translate-x-2 translate-y-4")).toBe("translate-x-2 translate-y-4");
	});

	test("scale conflict", () => {
		expect(ri("scale-50 scale-100")).toBe("scale-100");
	});

	test("scale-x and scale-y are composable (different CSS variables)", () => {
		// Per-axis classes set distinct --ri-scale-{axis} vars and the identical
		// `scale:` shorthand, so the merger's "all-props-dominated" rule keeps both.
		expect(ri("scale-x-50 scale-y-75")).toBe("scale-x-50 scale-y-75");
	});

	test("rotate conflict", () => {
		expect(ri("rotate-45 rotate-90")).toBe("rotate-90");
	});

	test("leading conflict", () => {
		expect(ri("leading-tight leading-loose")).toBe("leading-loose");
	});

	test("tracking conflict", () => {
		expect(ri("tracking-tight tracking-wide")).toBe("tracking-wide");
	});

	test("min-w / max-w / min-h / max-h don't conflict with w/h", () => {
		expect(ri("w-full min-w-0 max-w-lg")).toBe("w-full min-w-0 max-w-lg");
	});

	test("grid-cols conflict", () => {
		expect(ri("grid-cols-2 grid-cols-3")).toBe("grid-cols-3");
	});

	test("col-span conflict", () => {
		expect(ri("col-span-2 col-span-full")).toBe("col-span-full");
	});
});

// ---------------------------------------------------------------------------
// Color utility conflicts
// ---------------------------------------------------------------------------

describe("ri() color conflicts", () => {
	test("bg-red-500 and bg-blue-500 conflict", () => {
		expect(ri("bg-red-500 bg-blue-500")).toBe("bg-blue-500");
	});

	test("bg-transparent and bg-red-500 conflict", () => {
		expect(ri("bg-transparent bg-red-500")).toBe("bg-red-500");
	});

	test("accent-red-500 and accent-blue-500 conflict", () => {
		expect(ri("accent-red-500 accent-blue-500")).toBe("accent-blue-500");
	});

	test("fill and stroke don't conflict", () => {
		expect(ri("fill-red-500 stroke-blue-500")).toBe("fill-red-500 stroke-blue-500");
	});

	test("stroke width and stroke color don't conflict", () => {
		expect(ri("stroke-2 stroke-red-500")).toBe("stroke-2 stroke-red-500");
		expect(ri("stroke-red-500 stroke-1.5")).toBe("stroke-red-500 stroke-1.5");
		expect(ri("stroke-[3px] stroke-current")).toBe("stroke-[3px] stroke-current");
	});

	test("same-property stroke conflicts still merge", () => {
		expect(ri("stroke-2 stroke-4")).toBe("stroke-4");
		expect(ri("stroke-2 stroke-[3px]")).toBe("stroke-[3px]");
		expect(ri("stroke-red-500 stroke-blue-500")).toBe("stroke-blue-500");
		expect(ri("stroke-red-500 stroke-none")).toBe("stroke-none");
	});

	test("caret color conflict", () => {
		expect(ri("caret-red-500 caret-blue-500")).toBe("caret-blue-500");
	});
});

// ---------------------------------------------------------------------------
// Gradient conflicts
// ---------------------------------------------------------------------------

describe("ri() gradient conflicts", () => {
	test("from colors conflict", () => {
		expect(ri("from-red-500 from-blue-500")).toBe("from-blue-500");
	});

	test("via colors conflict", () => {
		expect(ri("via-red-500 via-blue-500")).toBe("via-blue-500");
	});

	test("from/via/to don't conflict with each other", () => {
		expect(ri("from-red-500 via-green-500 to-blue-500")).toBe(
			"from-red-500 via-green-500 to-blue-500",
		);
	});
});

// ---------------------------------------------------------------------------
// Animation conflicts
// ---------------------------------------------------------------------------

describe("ri() animation conflicts", () => {
	test("animate-spin and animate-bounce conflict", () => {
		expect(ri("animate-spin animate-bounce")).toBe("animate-bounce");
	});

	test("animate-none wins over animate-spin", () => {
		expect(ri("animate-spin animate-none")).toBe("animate-none");
	});

	test("fade-in and fade-in differ by value", () => {
		expect(ri("fade-in-0 fade-in-50")).toBe("fade-in-50");
	});

	test("fade-in and zoom-in don't conflict", () => {
		expect(ri("fade-in zoom-in")).toBe("fade-in zoom-in");
	});

	test("slide directions enter x vs y don't conflict across axes", () => {
		expect(ri("slide-in-from-top-4 slide-in-from-left-4")).toBe(
			"slide-in-from-top-4 slide-in-from-left-4",
		);
	});

	test("slide same axis conflicts", () => {
		expect(ri("slide-in-from-top-4 slide-in-from-bottom-4")).toBe("slide-in-from-bottom-4");
	});
});

// ---------------------------------------------------------------------------
// Aspect, object, background
// ---------------------------------------------------------------------------

describe("ri() misc property conflicts", () => {
	test("aspect ratio conflict", () => {
		expect(ri("aspect-square aspect-video")).toBe("aspect-video");
	});

	test("object-fit conflict", () => {
		expect(ri("object-cover object-contain")).toBe("object-contain");
	});

	test("object-position conflict", () => {
		expect(ri("object-center object-top")).toBe("object-top");
	});

	test("bg-size conflict", () => {
		expect(ri("bg-cover bg-contain")).toBe("bg-contain");
	});

	test("bg-repeat conflict", () => {
		expect(ri("bg-repeat bg-no-repeat")).toBe("bg-no-repeat");
	});

	test("transition conflict", () => {
		expect(ri("transition transition-all")).toBe("transition-all");
	});

	test("select conflict", () => {
		expect(ri("select-none select-text")).toBe("select-text");
	});
});

// ---------------------------------------------------------------------------
// Order preservation
// ---------------------------------------------------------------------------

describe("ri() order preservation", () => {
	test("non-conflicting classes maintain original order", () => {
		expect(ri("flex items-center justify-between p-4 bg-white")).toBe(
			"flex items-center justify-between p-4 bg-white",
		);
	});

	test("surviving classes keep original order after conflict resolution", () => {
		expect(ri("flex p-2 items-center", "p-4")).toBe("flex items-center p-4");
	});

	test("multiple arguments preserve order", () => {
		expect(ri("flex", "items-center", "p-4")).toBe("flex items-center p-4");
	});
});

// ---------------------------------------------------------------------------
// Complex real-world scenarios
// ---------------------------------------------------------------------------

describe("ri() real-world scenarios", () => {
	test("component base + variant override", () => {
		const base = "flex items-center p-4 bg-white text-black rounded-lg";
		const variant = "p-6 bg-blue-500 text-white";
		expect(ri(base, variant)).toBe("flex items-center rounded-lg p-6 bg-blue-500 text-white");
	});

	test("responsive class merging", () => {
		expect(ri("p-2 sm:p-4 md:p-6", "p-4 sm:p-8")).toBe("md:p-6 p-4 sm:p-8");
	});

	test("hover and focus don't conflict", () => {
		expect(ri("hover:bg-blue-500 focus:bg-blue-700")).toBe("hover:bg-blue-500 focus:bg-blue-700");
	});

	test("mix of static and dynamic with conflicts", () => {
		expect(ri("block flex-1 p-4 m-2", "inline-block p-8")).toBe("flex-1 m-2 inline-block p-8");
	});

	test("size utility conflicts with w and h", () => {
		expect(ri("w-10 h-10 size-20")).toBe("size-20");
	});

	test("shadow static and dynamic conflict", () => {
		expect(ri("shadow shadow-lg")).toBe("shadow-lg");
	});

	test("shadow/inset-shadow/ring/inset-ring compose; same family dedupes", () => {
		// Distinct slot vars → all four layer together (shared box-shadow isn't enough to clobber)
		expect(ri("shadow-md inset-shadow-sm ring-2 inset-ring-2")).toBe(
			"shadow-md inset-shadow-sm ring-2 inset-ring-2",
		);
		// Same family (same slot var) → last wins
		expect(ri("ring-2 ring-4")).toBe("ring-4");
		expect(ri("shadow-sm shadow-lg")).toBe("shadow-lg");
		// ring width vs ring color set different vars → both survive
		expect(ri("ring ring-error-500")).toBe("ring ring-error-500");
		// shadow width vs shadow color → both survive
		expect(ri("shadow-md shadow-error-500")).toBe("shadow-md shadow-error-500");
	});

	test("text-shadow is independent of box-shadow", () => {
		// same property → last wins
		expect(ri("text-shadow-sm text-shadow-lg")).toBe("text-shadow-lg");
		// text-shadow vs box-shadow set different properties → both survive
		expect(ri("shadow-md text-shadow-md")).toBe("shadow-md text-shadow-md");
		// text-shadow color uses --ri-text-shadow-color, box-shadow uses
		// --ri-shadow-color → both colors coexist (no clobber)
		expect(ri("shadow-error-500 text-shadow-info-500")).toBe(
			"shadow-error-500 text-shadow-info-500",
		);
	});

	test("filter composition: drop-shadow slot vs color; explicit filter overrides", () => {
		// drop-shadow width-slot vs its color var → both survive
		expect(ri("drop-shadow-md drop-shadow-error-500")).toBe("drop-shadow-md drop-shadow-error-500");
		// same family dedupes
		expect(ri("drop-shadow-sm drop-shadow-lg")).toBe("drop-shadow-lg");
		// an explicit filter value claims the filter shorthand → dominates composed filters
		expect(ri("blur-md filter-[blur(1px)]")).toBe("filter-[blur(1px)]");
		// grayscale (filter) and backdrop-grayscale (backdrop-filter) are independent
		expect(ri("grayscale-50 backdrop-grayscale-50")).toBe("grayscale-50 backdrop-grayscale-50");
	});

	test("transform axes compose; bare rotate independent; transform/zoom", () => {
		// rotate-x/y/z share `transform` but have distinct slot vars → compose
		expect(ri("rotate-x-2 rotate-y-3")).toBe("rotate-x-2 rotate-y-3");
		// skew axes compose
		expect(ri("skew-x-2 skew-y-3")).toBe("skew-x-2 skew-y-3");
		// bare `rotate` (rotate property) is independent of rotate-x (transform)
		expect(ri("rotate-45 rotate-x-2")).toBe("rotate-45 rotate-x-2");
		// same axis → last wins
		expect(ri("rotate-x-2 rotate-x-8")).toBe("rotate-x-8");
		// zoom dedupes
		expect(ri("zoom-50 zoom-75")).toBe("zoom-75");
	});

	test("scrollbar thumb/track compose; same part dedupes", () => {
		expect(ri("scrollbar-thumb-[#f00] scrollbar-track-[#0f0]")).toBe(
			"scrollbar-thumb-[#f00] scrollbar-track-[#0f0]",
		);
		expect(ri("scrollbar-thumb-[#f00] scrollbar-thumb-[#00f]")).toBe("scrollbar-thumb-[#00f]");
	});

	test("border-spacing x/y compose; bare dominates", () => {
		// distinct axis slot vars → both survive
		expect(ri("border-spacing-x-2 border-spacing-y-4")).toBe(
			"border-spacing-x-2 border-spacing-y-4",
		);
		// bare claims both axes → dominates a prior single-axis
		expect(ri("border-spacing-x-2 border-spacing-4")).toBe("border-spacing-4");
		// same axis → last wins
		expect(ri("border-spacing-x-2 border-spacing-x-8")).toBe("border-spacing-x-8");
	});

	test("outline conflicts", () => {
		// bare outline is a width (like border) → dedupes with outline-<n>
		expect(ri("outline outline-2")).toBe("outline-2");
		// outline-none now sets only outline-style → disjoint from the width, both survive
		expect(ri("outline outline-none")).toBe("outline outline-none");
		// width vs color → coexist
		expect(ri("outline-2 outline-[#f00]")).toBe("outline-2 outline-[#f00]");
	});

	test("sr-only toggles", () => {
		expect(ri("sr-only not-sr-only")).toBe("not-sr-only");
	});

	test("resize conflict", () => {
		expect(ri("resize resize-none")).toBe("resize-none");
	});
});

// ---------------------------------------------------------------------------
// Shadow dual-mode resolution
// ---------------------------------------------------------------------------

describe("shadow dual-mode", () => {
	test("shadow-lg and shadow-red-500 don't conflict (size vs color)", () => {
		expect(ri("shadow-lg shadow-red-500")).toBe("shadow-lg shadow-red-500");
	});

	test("shadow-sm and shadow-lg conflict (both size)", () => {
		expect(ri("shadow-sm shadow-lg")).toBe("shadow-lg");
	});

	test("shadow-red-500 and shadow-blue-500 conflict (both color)", () => {
		expect(ri("shadow-red-500 shadow-blue-500")).toBe("shadow-blue-500");
	});
});

// ---------------------------------------------------------------------------
// Custom utility registration
// ---------------------------------------------------------------------------

describe("custom utility registration", () => {
	/** Helper: register custom utilities via a context and finalize for ri(). */
	function registerAndFinalize(entries: Record<string, string[]>): void {
		const ctx = createCompilationContext();
		for (const [name, props] of Object.entries(entries)) {
			registerCustomUtility(ctx, name, props);
		}
		finalizeCompilationContext(ctx);
	}

	afterEach(() => {
		// Reset to empty state
		finalizeCompilationContext(createCompilationContext());
	});

	test("registered custom utility participates in conflict resolution", () => {
		registerAndFinalize({
			card: ["padding", "background-color", "border-radius", "box-shadow"],
		});
		// p-8 should override card's padding, but card keeps its other properties
		expect(ri("card p-8")).toBe("card p-8");
	});

	test("registered custom utility is overridden by rightmost conflict", () => {
		registerAndFinalize({
			card: ["padding", "background-color", "border-radius", "box-shadow"],
		});
		// bg-black overrides card's background-color
		expect(ri("card bg-black")).toBe("card bg-black");
	});

	test("finalizeCompilationContext with fresh context removes registered utilities", () => {
		registerAndFinalize({ card: ["padding"] });
		finalizeCompilationContext(createCompilationContext());
		// After reset, "card" is unknown and passes through unchanged
		expect(ri("card p-8")).toBe("card p-8");
	});

	test("custom utility overridden by shorthand", () => {
		registerAndFinalize({ card: ["padding", "background-color"] });
		// p-4 overrides card's padding; bg-red-500 overrides card's background-color
		// card is fully dominated
		expect(ri("card", "p-4 bg-red-500")).toBe("p-4 bg-red-500");
	});
});

// ---------------------------------------------------------------------------
// Concurrent compilation detection
// ---------------------------------------------------------------------------

// Parity assertions
// ---------------------------------------------------------------------------

describe("assertStaticUtilityParity()", () => {
	test("all BUILTIN_STATIC_PROPS keys exist in STATIC_UTILITIES", () => {
		const { missingInParser } = assertStaticUtilityParity(STATIC_UTILITIES);
		expect(missingInParser).toEqual([]);
	});
});

describe("assertPrefixPropParity()", () => {
	test("all multi-segment PREFIX_PROPS keys exist in MULTI_SEGMENT_PREFIXES", () => {
		const { missingInParser } = assertPrefixPropParity(MULTI_SEGMENT_PREFIXES);
		expect(missingInParser).toEqual([]);
	});
});

describe("PARSER_ONLY_STATICS parity", () => {
	test("all PARSER_ONLY_STATICS entries exist in STATIC_UTILITIES", () => {
		const missing = PARSER_ONLY_STATICS.filter((s) => !STATIC_UTILITIES.has(s));
		expect(missing).toEqual([]);
	});

	test("all PARSER_ONLY_STATICS entries are NOT in BUILTIN_STATIC_KEYS (they belong to prefix-based resolution)", () => {
		const overlap = PARSER_ONLY_STATICS.filter((s) => BUILTIN_STATIC_KEYS.has(s));
		expect(overlap).toEqual([]);
	});
});
