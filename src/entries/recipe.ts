/**
 * `rainbowindex/recipe` — typed component variants over `ri()`.
 *
 * A separate entry point so a component library can depend on the variant
 * layer without reaching for the PostCSS plugin: this module imports the merge
 * engine and nothing else, so it is browser-safe by construction and adds
 * nothing to a bundle that does not use it.
 *
 * See `docs/recipe.md`.
 */

export { recipe } from "../recipe.js";
export type {
	CompoundVariant,
	PropsOf,
	Recipe,
	RecipeClassValue,
	RecipeConfig,
	RecipeOptions,
	RecipeProps,
	VariantGroup,
	VariantProps,
	VariantShape,
	VariantValue,
} from "../recipe.js";
export type { ClassInput } from "../merge/index.js";
