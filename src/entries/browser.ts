import { devWarn } from "../runtime.js";

export { defaultTheme } from "../theme/index.js";
export type { ColorDefinition, FluidConfig, TextSize, Theme } from "../theme/index.js";

export {
	createCompilationContext,
	createRi,
	DEFAULT_TEXT_SIZES,
	finalizeCompilationContext,
	registerColorNames,
	registerCustomFontFamilies,
	registerCustomTextSizes,
	registerCustomUtility,
	ri,
} from "../merge/index.js";
export type { CompilationContext, CompilationSnapshot } from "../merge/index.js";

export { safelist } from "../safelist.js";

function browserEntryUnavailable(): never {
	devWarn(
		'[RI-2003] The default export from "rainbowindex" is the PostCSS plugin and is not available in browser bundles. Use named imports like `import { ri } from "rainbowindex"` in client code, or import the plugin in Node/PostCSS only.',
	);
	throw new Error(
		'[RI-2003] The default export from "rainbowindex" is not available in browser bundles.',
	);
}

export default browserEntryUnavailable;
