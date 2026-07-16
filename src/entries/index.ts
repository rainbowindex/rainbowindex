export { default } from "../integrations/postcss/index.js";

export type { RainbowIndexOptions } from "../integrations/postcss/index.js";

export { defaultTheme } from "../theme/index.js";
export type {
	ColorDefinition,
	FluidConfig,
	TextSize,
	Theme,
} from "../theme/index.js";

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

export type {
	CompileProjectOptions,
	CompileProjectResult,
} from "../project/index.js";
export { compileProject } from "../project/index.js";

export type { CompilationResult, CompiledRule } from "../engine/index.js";
export { createCompiler } from "../engine/index.js";

export { safelist } from "../safelist.js";
