import { describe, expect, it } from "vitest";
import { parseUtility } from "../../src/utilities/parser.js";

describe("parseUtility", () => {
	describe("static utilities", () => {
		it("parses valueless utilities", () => {
			const r = parseUtility("flex");
			expect(r.utility).toBe("flex");
			expect(r.value).toBeNull();
			expect(r.variants).toEqual([]);
			expect(r.important).toBe(false);
		});

		it("parses compound static utilities", () => {
			const r = parseUtility("flex-row");
			expect(r.utility).toBe("flex-row");
			expect(r.value).toBeNull();
		});

		it("parses inline-flex", () => {
			const r = parseUtility("inline-flex");
			expect(r.utility).toBe("inline-flex");
			expect(r.value).toBeNull();
		});

		it("parses hidden", () => {
			expect(parseUtility("hidden").utility).toBe("hidden");
		});

		it("parses sr-only", () => {
			expect(parseUtility("sr-only").utility).toBe("sr-only");
		});

		it("parses aspect-square", () => {
			const r = parseUtility("aspect-square");
			expect(r.utility).toBe("aspect-square");
			expect(r.value).toBeNull();
		});

		it("parses @container", () => {
			const r = parseUtility("@container");
			expect(r.utility).toBe("@container");
			expect(r.value).toBeNull();
		});
	});

	describe("dynamic utilities", () => {
		it("parses p-4", () => {
			const r = parseUtility("p-4");
			expect(r.utility).toBe("p");
			expect(r.value).toBe("4");
		});

		it("parses bg-red-500", () => {
			const r = parseUtility("bg-red-500");
			expect(r.utility).toBe("bg");
			expect(r.value).toBe("red-500");
		});

		it("parses text-2xl", () => {
			const r = parseUtility("text-2xl");
			expect(r.utility).toBe("text");
			expect(r.value).toBe("2xl");
		});

		it("parses rounded-4", () => {
			const r = parseUtility("rounded-4");
			expect(r.utility).toBe("rounded");
			expect(r.value).toBe("4");
		});

		it("parses w-full as static", () => {
			const r = parseUtility("w-full");
			expect(r.utility).toBe("w-full");
			expect(r.value).toBeNull();
		});

		it("parses w-64", () => {
			const r = parseUtility("w-64");
			expect(r.utility).toBe("w");
			expect(r.value).toBe("64");
		});

		it("parses shadow-md", () => {
			const r = parseUtility("shadow-md");
			expect(r.utility).toBe("shadow");
			expect(r.value).toBe("md");
		});

		it("parses duration-300", () => {
			const r = parseUtility("duration-300");
			expect(r.utility).toBe("duration");
			expect(r.value).toBe("300");
		});
	});

	describe("multi-segment prefixes", () => {
		it("parses space-x-4", () => {
			const r = parseUtility("space-x-4");
			expect(r.utility).toBe("space-x");
			expect(r.value).toBe("4");
		});

		it("parses min-w-0 as static", () => {
			const r = parseUtility("min-w-0");
			expect(r.utility).toBe("min-w-0");
			expect(r.value).toBeNull();
		});

		it("parses min-w-64", () => {
			const r = parseUtility("min-w-64");
			expect(r.utility).toBe("min-w");
			expect(r.value).toBe("64");
		});

		it("parses rounded-tl-lg", () => {
			const r = parseUtility("rounded-tl-lg");
			expect(r.utility).toBe("rounded-tl");
			expect(r.value).toBe("lg");
		});

		it("parses translate-x-4", () => {
			const r = parseUtility("translate-x-4");
			expect(r.utility).toBe("translate-x");
			expect(r.value).toBe("4");
		});

		it("parses slide-in-from-top-8", () => {
			const r = parseUtility("slide-in-from-top-8");
			expect(r.utility).toBe("slide-in-from-top");
			expect(r.value).toBe("8");
		});

		it("parses grid-cols-3", () => {
			const r = parseUtility("grid-cols-3");
			expect(r.utility).toBe("grid-cols");
			expect(r.value).toBe("3");
		});

		it("parses border-t-2", () => {
			const r = parseUtility("border-t-2");
			expect(r.utility).toBe("border-t");
			expect(r.value).toBe("2");
		});

		it("parses bg-linear-to-r", () => {
			const r = parseUtility("bg-linear-to-r");
			expect(r.utility).toBe("bg-linear-to");
			expect(r.value).toBe("r");
		});
	});

	describe("variants", () => {
		it("parses single variant", () => {
			const r = parseUtility("hover:bg-red-500");
			expect(r.variants).toEqual(["hover"]);
			expect(r.utility).toBe("bg");
			expect(r.value).toBe("red-500");
		});

		it("parses multiple variants", () => {
			const r = parseUtility("sm:hover:bg-red-500");
			expect(r.variants).toEqual(["sm", "hover"]);
			expect(r.utility).toBe("bg");
			expect(r.value).toBe("red-500");
		});

		it("parses dark variant", () => {
			const r = parseUtility("dark:shadow-lg");
			expect(r.variants).toEqual(["dark"]);
			expect(r.utility).toBe("shadow");
			expect(r.value).toBe("lg");
		});

		it("parses container query variant", () => {
			const r = parseUtility("@md:flex");
			expect(r.variants).toEqual(["@md"]);
			expect(r.utility).toBe("flex");
		});

		it("parses data attribute variant", () => {
			const r = parseUtility("data-[state=open]:opacity-100");
			expect(r.variants).toEqual(["data-[state=open]"]);
			expect(r.utility).toBe("opacity");
			expect(r.value).toBe("100");
		});

		it("parses aria variant", () => {
			const r = parseUtility("aria-disabled:opacity-50");
			expect(r.variants).toEqual(["aria-disabled"]);
		});

		it("parses has-* variant", () => {
			const r = parseUtility("has-[input:focus]:outline-2");
			expect(r.variants).toEqual(["has-[input:focus]"]);
			expect(r.utility).toBe("outline");
			expect(r.value).toBe("2");
		});

		it("parses not-* variant", () => {
			const r = parseUtility("not-disabled:hover:bg-blue-600");
			expect(r.variants).toEqual(["not-disabled", "hover"]);
			expect(r.utility).toBe("bg");
			expect(r.value).toBe("blue-600");
		});

		it("parses starting variant", () => {
			const r = parseUtility("starting:opacity-0");
			expect(r.variants).toEqual(["starting"]);
			expect(r.utility).toBe("opacity");
			expect(r.value).toBe("0");
		});

		it("parses placeholder variant", () => {
			const r = parseUtility("placeholder:text-gray-400");
			expect(r.variants).toEqual(["placeholder"]);
		});

		it("parses named container variant", () => {
			const r = parseUtility("@sidebar/sm:flex-col");
			expect(r.variants).toEqual(["@sidebar/sm"]);
			expect(r.utility).toBe("flex-col");
		});
	});

	describe("arbitrary values", () => {
		it("parses bracket values", () => {
			const r = parseUtility("p-[13px]");
			expect(r.utility).toBe("p");
			expect(r.value).toBe("[13px]");
			expect(r.arbitrary).toBe(true);
		});

		it("parses rem arbitrary", () => {
			const r = parseUtility("m-[2.5rem]");
			expect(r.utility).toBe("m");
			expect(r.value).toBe("[2.5rem]");
			expect(r.arbitrary).toBe(true);
		});

		it("parses calc arbitrary", () => {
			const r = parseUtility("w-[calc(100%-2rem)]");
			expect(r.utility).toBe("w");
			expect(r.value).toBe("[calc(100%-2rem)]");
			expect(r.arbitrary).toBe(true);
		});

		it("parses negative arbitrary", () => {
			const r = parseUtility("m-[-1px]");
			expect(r.utility).toBe("m");
			expect(r.value).toBe("[-1px]");
			expect(r.arbitrary).toBe(true);
		});

		it("parses aspect ratio arbitrary", () => {
			const r = parseUtility("aspect-[4/3]");
			expect(r.utility).toBe("aspect");
			expect(r.value).toBe("[4/3]");
			expect(r.arbitrary).toBe(true);
		});

		it("parses content arbitrary", () => {
			const r = parseUtility("content-['hello']");
			expect(r.utility).toBe("content");
			expect(r.value).toBe("['hello']");
			expect(r.arbitrary).toBe(true);
		});
	});

	describe("important", () => {
		it("parses !important suffix", () => {
			const r = parseUtility("p-4!");
			expect(r.important).toBe(true);
			expect(r.utility).toBe("p");
			expect(r.value).toBe("4");
		});

		it("parses !important suffix with variants", () => {
			const r = parseUtility("hover:bg-red-500!");
			expect(r.important).toBe(true);
			expect(r.variants).toEqual(["hover"]);
		});
	});

	describe("physical infix", () => {
		it("parses -physical- infix", () => {
			const r = parseUtility("pl-physical-4");
			expect(r.physical).toBe(true);
			expect(r.utility).toBe("pl");
			expect(r.value).toBe("4");
		});

		it("parses margin-physical", () => {
			const r = parseUtility("ml-physical-auto");
			expect(r.physical).toBe(true);
			expect(r.utility).toBe("ml");
			expect(r.value).toBe("auto");
		});

		it("supports -physical- infix with arbitrary values", () => {
			const r = parseUtility("p-physical-[2rem]");
			expect(r.physical).toBe(true);
			expect(r.utility).toBe("p");
			expect(r.value).toBe("[2rem]");
			expect(r.arbitrary).toBe(true);
		});

		it("does not rewrite -physical- inside arbitrary value content", () => {
			const r = parseUtility("bg-[url(https://cdn.example.com/x-physical-y.png)]");
			expect(r.physical).toBe(false);
			expect(r.value).toBe("[url(https://cdn.example.com/x-physical-y.png)]");
		});
	});

	describe("negative values", () => {
		it("parses negative utility", () => {
			const r = parseUtility("-translate-x-4");
			expect(r.negative).toBe(true);
			expect(r.utility).toBe("translate-x");
			expect(r.value).toBe("4");
		});

		it("parses negative margin", () => {
			const r = parseUtility("-m-4");
			expect(r.negative).toBe(true);
			expect(r.utility).toBe("m");
			expect(r.value).toBe("4");
		});
	});

	describe("preserves raw", () => {
		it("stores original class string", () => {
			const r = parseUtility("hover:!bg-red-500");
			expect(r.raw).toBe("hover:!bg-red-500");
		});
	});
});
