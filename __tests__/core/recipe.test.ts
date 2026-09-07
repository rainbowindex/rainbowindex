/**
 * `recipe()` — the variant layer.
 *
 * Two things need proving and they need proving differently. The runtime half
 * is ordinary: given a config and props, which classes come out and in which
 * order. The typed half is not — "`button({ size: "xl" })` is a type error" is
 * a claim about the compiler, and a runtime assertion cannot make it, so this
 * file runs `tsc` over a fixture and checks the diagnostics.
 *
 * The scanner half is here too: a recipe's classes only reach the build
 * because `recipe` sits in the variant-helper list beside `cva` and `tv`. A
 * recipe whose classes compile but are never *found* would look completely
 * correct in every unit test and render nothing in a real app.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import { createRi } from "../../src/merge/index.js";
import { recipe } from "../../src/recipe.js";
import { extractClassesFromSource } from "../../src/scanner/class-extraction.js";

const button = recipe({
	base: "inline-flex items-center font-medium",
	variants: {
		tone: {
			solid: "bg-red-600 text-white",
			quiet: "text-red-700",
		},
		size: {
			sm: "h-8 px-3",
			md: "h-10 px-4",
		},
		block: { true: "w-full" },
	},
	compoundVariants: [{ tone: "solid", size: "sm", class: "shadow-sm" }],
	defaultVariants: { tone: "solid", size: "md" },
});

/** Class list as a set, since ri() may reorder within one merge. */
const classesOf = (value: string): Set<string> => new Set(value.split(" ").filter(Boolean));

describe("recipe", () => {
	test("applies base plus the default variants when called with nothing", () => {
		expect(classesOf(button())).toEqual(
			classesOf("inline-flex items-center font-medium bg-red-600 text-white h-10 px-4"),
		);
	});

	test("a prop overrides the default for its group only", () => {
		const result = classesOf(button({ size: "sm" }));
		expect(result).toContain("h-8");
		expect(result).not.toContain("h-10");
		// tone still comes from the default.
		expect(result).toContain("bg-red-600");
	});

	test("a compound rule applies only when every variant it names lines up", () => {
		expect(classesOf(button({ tone: "solid", size: "sm" }))).toContain("shadow-sm");
		expect(classesOf(button({ tone: "quiet", size: "sm" }))).not.toContain("shadow-sm");
		expect(classesOf(button({ tone: "solid", size: "md" }))).not.toContain("shadow-sm");
	});

	test("a compound rule fires off the defaults, not just off explicit props", () => {
		// tone defaults to solid, so `{ size: "sm" }` alone satisfies the rule.
		expect(classesOf(button({ size: "sm" }))).toContain("shadow-sm");
	});

	test("a boolean group takes a boolean", () => {
		expect(classesOf(button({ block: true }))).toContain("w-full");
		expect(classesOf(button({ block: false }))).not.toContain("w-full");
		expect(classesOf(button())).not.toContain("w-full");
	});

	test("null suppresses a default instead of falling back to it", () => {
		const result = classesOf(button({ size: null }));
		expect(result).not.toContain("h-10");
		expect(result).not.toContain("h-8");
		expect(result).toContain("bg-red-600");
	});

	test("the caller's own classes win over everything the recipe produced", () => {
		// px-8 and px-4 are the same property, so the merge keeps the later one.
		expect(classesOf(button({ class: "px-8" }))).toContain("px-8");
		expect(classesOf(button({ class: "px-8" }))).not.toContain("px-4");
		expect(classesOf(button({ className: "px-8" }))).toContain("px-8");
	});

	test("conflicts inside the recipe resolve through ri(), not by concatenation", () => {
		const padded = recipe({
			base: "p-2",
			variants: { size: { lg: "p-8" } },
		});
		expect(classesOf(padded({ size: "lg" }))).toEqual(classesOf("p-8"));
	});

	test("an unknown option at runtime contributes nothing and does not throw", () => {
		// TypeScript rejects this; JavaScript callers and untyped data do not.
		const loose = button as (props: Record<string, unknown>) => string;
		expect(() => loose({ size: "xl" })).not.toThrow();
		expect(classesOf(loose({ size: "xl" }))).not.toContain("h-10");
	});

	test("an option named like an Object prototype member resolves to nothing", () => {
		const sneaky = recipe({ base: "flex", variants: { kind: { real: "p-2" } } });
		const loose = sneaky as (props: Record<string, unknown>) => string;
		expect(loose({ kind: "toString" })).toBe("flex");
		expect(loose({ kind: "constructor" })).toBe("flex");
	});

	test("an array in a compound rule matches any of its values", () => {
		const card = recipe({
			base: "block",
			variants: {
				size: { sm: "p-2", md: "p-4", lg: "p-8" },
				tone: { plain: "", loud: "font-bold" },
			},
			compoundVariants: [{ size: ["sm", "md"], tone: "loud", class: "tracking-tight" }],
		});
		expect(classesOf(card({ size: "sm", tone: "loud" }))).toContain("tracking-tight");
		expect(classesOf(card({ size: "md", tone: "loud" }))).toContain("tracking-tight");
		expect(classesOf(card({ size: "lg", tone: "loud" }))).not.toContain("tracking-tight");
		expect(classesOf(card({ size: "sm", tone: "plain" }))).not.toContain("tracking-tight");
	});

	test("a compound rule needs every group it names to have a value", () => {
		// No defaults here, so an unset group really is unset — a compound rule
		// states a combination, and a missing variant is not part of one.
		const card = recipe({
			base: "block",
			variants: { size: { sm: "p-2" }, tone: { loud: "font-bold" } },
			compoundVariants: [{ size: "sm", tone: "loud", class: "tracking-tight" }],
		});
		expect(classesOf(card({ size: "sm" }))).not.toContain("tracking-tight");
		expect(classesOf(card({ tone: "loud" }))).not.toContain("tracking-tight");
		expect(classesOf(card({ size: "sm", tone: "loud" }))).toContain("tracking-tight");
	});

	test("hands the merge function class values and nothing else", () => {
		// A variant option named after an Object.prototype member would
		// otherwise resolve through the prototype chain to a function. `ri()`
		// happens to ignore one, so the output alone cannot show the
		// difference — what the merge function *receives* can.
		const received: unknown[] = [];
		const sneaky = recipe(
			{ base: "flex", variants: { kind: { real: "p-2" } } },
			{
				merge: (...inputs) => {
					received.push(...inputs);
					return createRi()(...inputs);
				},
			},
		);
		const loose = sneaky as (props: Record<string, unknown>) => string;
		loose({ kind: "toString" });
		loose({ kind: "__proto__" });
		loose({ kind: "constructor" });
		for (const input of received) {
			expect(
				input === undefined || typeof input === "string" || Array.isArray(input),
				`recipe passed ${typeof input} to its merge function`,
			).toBe(true);
		}
	});

	test("takes a bound merge, for a snapshot the global ri() cannot see", () => {
		const calls: string[][] = [];
		const bound = createRi();
		const spy = (...inputs: Parameters<typeof bound>): string => {
			calls.push(inputs.filter((i): i is string => typeof i === "string"));
			return bound(...inputs);
		};
		const themed = recipe({ base: "flex", variants: { size: { sm: "p-2" } } }, { merge: spy });
		expect(classesOf(themed({ size: "sm" }))).toEqual(classesOf("flex p-2"));
		expect(calls).toHaveLength(1);
	});

	test("exposes the config it was built from, so a recipe can extend another", () => {
		expect(button.config.defaultVariants).toEqual({ tone: "solid", size: "md" });
		const outlined = recipe({
			...button.config,
			base: [button.config.base, "border"],
		});
		expect(classesOf(outlined())).toContain("border");
		expect(classesOf(outlined())).toContain("inline-flex");
	});

	test("a compound rule may spell its classes `class` or `className`", () => {
		const card = recipe({
			variants: { size: { sm: "p-2" } },
			compoundVariants: [
				{ size: "sm", class: "tracking-tight" },
				{ size: "sm", className: "uppercase" },
			],
		});
		expect(classesOf(card({ size: "sm" }))).toEqual(classesOf("p-2 tracking-tight uppercase"));
	});

	test("warns once when a compound rule names a group that does not exist", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			recipe({
				variants: { size: { sm: "p-2" } },
				// A rule that can never apply, and reads as if it does.
				compoundVariants: [{ shape: "pill", class: "rounded-full" } as never],
			});
			expect(warn).toHaveBeenCalledTimes(1);
			const message = String(warn.mock.calls[0]?.[0]);
			expect(message).toContain("[RI-2013]");
			expect(message).toContain('"shape"');
			expect(message).toContain('"size"');
		} finally {
			warn.mockRestore();
		}
	});

	test("says nothing when every compound key is a real group", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			recipe({
				variants: { size: { sm: "p-2" }, tone: { loud: "font-bold" } },
				compoundVariants: [{ size: "sm", tone: "loud", class: "x", className: "y" }],
			});
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	test("an empty recipe is an empty string, not a crash", () => {
		expect(recipe({})()).toBe("");
		expect(recipe({ variants: {} })({})).toBe("");
	});
});

/** The same config, called through whichever helper name is under test. */
const configSource = (helper: string): string => `
	import { ${helper} } from "somewhere";
	export const button = ${helper}({
		base: "inline-flex rounded-lg",
		variants: {
			tone: { solid: "bg-red-600", quiet: "text-red-700" },
			size: { sm: "h-8 px-3", md: "h-10 px-4" },
		},
		compoundVariants: [{ tone: "solid", size: "sm", class: "shadow-sm" }],
		defaultVariants: { tone: "solid" },
	});
`;

const scanned = (helper: string): Set<string> =>
	new Set(extractClassesFromSource({ content: configSource(helper), path: "a.tsx" }));

describe("recipe classes reach the build", () => {
	test("finds every class a recipe config holds", () => {
		const found = scanned("recipe");
		for (const cls of [
			"inline-flex",
			"rounded-lg",
			"bg-red-600",
			"text-red-700",
			"h-8",
			"px-3",
			"h-10",
			"px-4",
			"shadow-sm",
		]) {
			expect(found, `scanner missed ${cls}`).toContain(cls);
		}
	});

	test("treats recipe() exactly as it treats cva() and tv()", () => {
		expect(scanned("recipe")).toEqual(scanned("cva"));
		expect(scanned("recipe")).toEqual(scanned("tv"));
	});

	test("the registration is what does it, not the config's shape", () => {
		// An unregistered helper's config is walked by the generic token scan,
		// which cannot tell a variant name from a class: `size`, `solid` and
		// `tone` survive as candidates, and structural keys with them. That is
		// the state `recipe` would be in if it were not on the helper list —
		// harmless for the build, and wrong for everything that reads the
		// candidate set.
		const unregistered = scanned("notAHelper");
		for (const key of ["size", "solid", "tone", "md", "quiet"]) {
			expect(unregistered, `expected the unregistered baseline to keep ${key}`).toContain(key);
			expect(scanned("recipe"), `recipe leaked the structural token ${key}`).not.toContain(key);
		}
	});
});

// ---------------------------------------------------------------------------
// The typed half
// ---------------------------------------------------------------------------

/**
 * `button({ size: "xl" })` has to be a *type* error — that is the whole point
 * of the layer, and no runtime assertion can show it. So compile a fixture and
 * read the diagnostics: each `// @ts-expect-error` line passes only if the
 * line under it really does fail to compile, and `tsc` reports the unused
 * directives as errors of their own when it does not.
 */
describe("recipe types", () => {
	test("rejects an unknown option, an unknown group, and the wrong shape", () => {
		const dir = mkdtempSync(join(tmpdir(), "ri-recipe-types-"));
		const recipeModule = fileURLToPath(new URL("../../src/recipe.js", import.meta.url)).replace(
			/\.js$/,
			"",
		);
		writeFileSync(
			join(dir, "fixture.ts"),
			`
import { recipe, type PropsOf } from ${JSON.stringify(recipeModule)};

const button = recipe({
	base: "inline-flex",
	variants: {
		tone: { solid: "bg-red-600", quiet: "text-red-700" },
		size: { sm: "h-8", md: "h-10" },
		block: { true: "w-full" },
	},
	defaultVariants: { tone: "solid" },
});

// Valid calls.
button();
button({ size: "sm" });
button({ tone: "quiet", size: "md", block: true });
button({ size: null });
button({ class: "px-8", className: "py-2" });

// @ts-expect-error "xl" is not a size
button({ size: "xl" });
// @ts-expect-error there is no "shape" group
button({ shape: "pill" });
// @ts-expect-error a boolean group does not take its option name as a string
button({ block: "true" });
// @ts-expect-error a string group does not take a boolean
button({ size: true });

// The props type is reusable, and still exact.
type ButtonProps = PropsOf<typeof button>;
const ok: ButtonProps = { size: "sm" };
// @ts-expect-error still rejects the unknown option through the alias
const bad: ButtonProps = { size: "xl" };
void ok;
void bad;

// A compound rule is checked against the same option names.
recipe({
	variants: { size: { sm: "h-8", md: "h-10" } },
	// @ts-expect-error "xl" is not a size here either
	compoundVariants: [{ size: "xl", class: "shadow" }],
});
`,
		);
		writeFileSync(
			join(dir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					target: "ES2022",
					lib: ["ES2022", "DOM"],
					module: "NodeNext",
					moduleResolution: "NodeNext",
					strict: true,
					noEmit: true,
					skipLibCheck: true,
					// The module graph reaches `process` through runtime.ts, and
					// the fixture lives outside the repository, so point at the
					// repository's own @types rather than leaving `types` empty.
					types: ["node"],
					typeRoots: [fileURLToPath(new URL("../../node_modules/@types", import.meta.url))],
				},
				include: ["fixture.ts"],
			}),
		);

		let output = "";
		let failed = false;
		try {
			execFileSync(
				process.execPath,
				[
					fileURLToPath(new URL("../../node_modules/typescript/bin/tsc", import.meta.url)),
					"-p",
					dir,
				],
				{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
			);
		} catch (error) {
			failed = true;
			const err = error as { stdout?: string; stderr?: string };
			output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
		}
		// Every ts-expect-error is satisfied and nothing else went wrong, so tsc
		// must be silent. When it is not, the message is the diff worth reading.
		expect(failed ? output : "", output).toBe("");
	});
});
