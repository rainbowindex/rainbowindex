/**
 * `recipe()` — a typed variant layer whose output is ordinary class names.
 *
 * A component library needs to say "a button has a size and a tone, and these
 * are the only valid values" without giving up plain CSS. `cva` and `tv` do
 * that, and both merge with a table of Tailwind utilities: every utility this
 * project defines is unknown to them, a `@utility` never resolves, and a theme
 * change never reaches them. `recipe()` is the same idea over `ri()`, so the
 * conflict resolution is the one the compiler emitted.
 *
 * The result is a string. Nothing is styled at runtime, nothing is injected,
 * and the classes live in the config where the scanner already reads them —
 * `recipe` sits beside `cva` and `tv` in the variant-helper list, so a build
 * finds them with no extra configuration.
 *
 * ```ts
 * const button = recipe({
 * 	base: "inline-flex items-center rounded-card font-medium",
 * 	variants: {
 * 		tone: { solid: "bg-brand-600 text-white", quiet: "text-brand-700" },
 * 		size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4" },
 * 		block: { true: "w-full" },
 * 	},
 * 	compoundVariants: [{ tone: "solid", size: "sm", class: "shadow-sm" }],
 * 	defaultVariants: { tone: "solid", size: "md" },
 * });
 *
 * button({ size: "sm" });        // → "inline-flex … bg-brand-600 … h-8 px-3 text-sm shadow-sm"
 * button({ size: "xl" });        // ✗ Type error: "xl" is not a size
 * ```
 */

import type { ClassInput } from "./merge/index.js";
import { ri as defaultRi } from "./merge/index.js";
import { devWarn } from "./runtime.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One variant option's classes — anything `ri()` accepts. */
export type RecipeClassValue = ClassInput;

/** One variant group: option name → the classes that option adds. */
export type VariantGroup = Record<string, RecipeClassValue>;

/** All of a recipe's variant groups, by name. */
export type VariantShape = Record<string, VariantGroup>;

type OptionNames<Group> = Extract<keyof Group, string>;

/**
 * A group whose only options are `true`/`false` takes a boolean, not the
 * strings. The tuple brackets keep the check non-distributive, so a group with
 * both options is still recognized as the boolean one.
 */
type IsBooleanGroup<Group> = [OptionNames<Group>] extends ["true" | "false"] ? true : false;

/** The value a caller may pass for one variant group. */
export type VariantValue<Group> = IsBooleanGroup<Group> extends true ? boolean : OptionNames<Group>;

/**
 * The props a recipe accepts, one optional key per variant group.
 *
 * `null` is explicit opt-out: it suppresses the group's default rather than
 * falling back to it, which is the only way to say "no size at all" for a
 * recipe that defines a default size.
 */
export type VariantProps<V extends VariantShape> = {
	[K in keyof V]?: VariantValue<V[K]> | null;
};

/** One compound rule: classes that apply when several variants line up. */
export type CompoundVariant<V extends VariantShape> = {
	[K in keyof V]?: VariantValue<V[K]> | ReadonlyArray<VariantValue<V[K]>>;
} & {
	class?: RecipeClassValue;
	/** Accepted alongside `class`, as `cva` and `tv` do. Both are applied. */
	className?: RecipeClassValue;
};

export interface RecipeConfig<V extends VariantShape> {
	/** Classes every call starts from. */
	base?: RecipeClassValue;
	/** The variant groups. Their declaration order is their merge order. */
	variants?: V;
	/** Classes that apply only when several variants take given values. */
	compoundVariants?: ReadonlyArray<CompoundVariant<V>>;
	/** The value each group takes when the caller passes none. */
	defaultVariants?: VariantProps<V>;
}

/** What a recipe is called with: its variants, plus per-call overrides. */
export type RecipeProps<V extends VariantShape> = VariantProps<V> & {
	class?: RecipeClassValue;
	className?: RecipeClassValue;
};

export interface Recipe<V extends VariantShape> {
	(props?: RecipeProps<V>): string;
	/** The config object this recipe was built from, for composing another. */
	readonly config: RecipeConfig<V>;
}

export interface RecipeOptions {
	/**
	 * The merge function. Defaults to the module-level `ri()`.
	 *
	 * Pass `createRi(snapshot)` where the global one cannot be trusted: a
	 * multi-tenant SSR process compiling more than one theme, or a client
	 * bundle that imports the bound `ri` its generated snapshot exports.
	 */
	merge?: (...inputs: ClassInput[]) => string;
}

/** The props type of an existing recipe, for a component's own props. */
export type PropsOf<R> = R extends Recipe<infer V> ? RecipeProps<V> : never;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Keys of a compound entry that name classes rather than a variant. */
const COMPOUND_CLASS_KEYS = new Set(["class", "className"]);

/**
 * Does this compound rule apply to the resolved selection?
 *
 * Every named group has to match. An array matches any of its values, which is
 * how `{ size: ["sm", "md"], class: "…" }` covers two sizes in one rule. A
 * group the caller left unset (or set to `null`) matches nothing — a compound
 * rule states a combination, and an absent variant is not part of one.
 */
function compoundApplies(
	compound: Record<string, unknown>,
	selection: Record<string, string>,
): boolean {
	for (const key of Object.keys(compound)) {
		if (COMPOUND_CLASS_KEYS.has(key)) continue;
		const expected = compound[key];
		if (expected === undefined) continue;
		const actual = selection[key];
		if (actual === undefined) return false;
		if (Array.isArray(expected)) {
			if (!expected.some((value) => String(value) === actual)) return false;
		} else if (String(expected) !== actual) {
			return false;
		}
	}
	return true;
}

/** Dev-only: a compound rule naming a group the recipe does not define can
 *  never apply, and reads as if it does. Reported once, at definition. */
function warnUnknownCompoundKeys<V extends VariantShape>(config: RecipeConfig<V>): void {
	const groups = new Set(Object.keys(config.variants ?? {}));
	const unknown = new Set<string>();
	for (const compound of config.compoundVariants ?? []) {
		for (const key of Object.keys(compound as Record<string, unknown>)) {
			if (COMPOUND_CLASS_KEYS.has(key)) continue;
			if (!groups.has(key)) unknown.add(key);
		}
	}
	if (unknown.size === 0) return;
	const named = [...unknown].map((key) => `"${key}"`).join(", ");
	const known = [...groups].map((key) => `"${key}"`).join(", ") || "none";
	devWarn(
		`[RI-2013] recipe() compoundVariants name ${named}, which ${unknown.size === 1 ? "is not a variant group" : "are not variant groups"} of this recipe (defined: ${known}). Those rules can never apply. Check the spelling, or add the group to \`variants\`.`,
	);
}

/**
 * Build a recipe: a function from variant props to a merged class string.
 *
 * The merge order is base, then each variant group in declaration order, then
 * the compound rules in array order, then the caller's own `class`/`className`
 * — so a per-call override always wins, and a compound rule always beats the
 * plain variants it is refining.
 */
export function recipe<V extends VariantShape>(
	config: RecipeConfig<V>,
	options: RecipeOptions = {},
): Recipe<V> {
	const merge = options.merge ?? defaultRi;
	warnUnknownCompoundKeys(config);

	const build = (props?: RecipeProps<V>): string => {
		const parts: ClassInput[] = [config.base];
		const selection: Record<string, string> = {};

		const variants = config.variants;
		if (variants) {
			const supplied = props as Record<string, unknown> | undefined;
			const defaults = config.defaultVariants as Record<string, unknown> | undefined;
			for (const name of Object.keys(variants)) {
				const fromProps = supplied?.[name];
				// `undefined` means "not passed" and falls back; `null` means
				// "explicitly none" and does not.
				const chosen = fromProps === undefined ? defaults?.[name] : fromProps;
				if (chosen === null || chosen === undefined) continue;
				const option = String(chosen);
				selection[name] = option;
				const group = variants[name];
				// hasOwn, not `group[option]`: a group is a plain object literal,
				// and a variant option spelled "constructor" or "toString" must
				// not resolve through the prototype chain to a function.
				if (Object.hasOwn(group, option)) parts.push(group[option]);
			}
		}

		for (const compound of config.compoundVariants ?? []) {
			const entry = compound as Record<string, unknown>;
			if (!compoundApplies(entry, selection)) continue;
			parts.push(entry.class as ClassInput, entry.className as ClassInput);
		}

		if (props) parts.push(props.class, props.className);
		return merge(...parts);
	};

	return Object.assign(build, { config }) as Recipe<V>;
}
