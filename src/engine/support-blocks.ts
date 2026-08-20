/**
 * Support blocks — the @property/@keyframes scaffolding certain CSS features
 * need to work (gradient stops, mask stops, transform axes, enter/exit
 * animations), keyed by the substrings that reveal a feature is in use.
 *
 * One table serves both detection sites: the compile loop (per compiled rule)
 * and scanCSSForTokenUsage (whole user CSS, e.g. @apply output), so the
 * "this CSS implies these support blocks" knowledge cannot drift between them.
 */

/** Pre-computed @keyframes blocks for the enter/exit animation system. */
export const ANIMATION_KEYFRAMES: readonly string[] = Object.freeze([
	`@keyframes enter {
  from {
    opacity: var(--ri-enter-opacity, 1);
    transform: translate(var(--ri-enter-translate-x, 0), var(--ri-enter-translate-y, 0)) scale(var(--ri-enter-scale, 1)) rotate(var(--ri-enter-rotate, 0));
    filter: blur(var(--ri-enter-blur, 0));
  }
}`,
	`@keyframes exit {
  to {
    opacity: var(--ri-exit-opacity, 1);
    transform: translate(var(--ri-exit-translate-x, 0), var(--ri-exit-translate-y, 0)) scale(var(--ri-exit-scale, 1)) rotate(var(--ri-exit-rotate, 0));
    filter: blur(var(--ri-exit-blur, 0));
  }
}`,
]);

/** Pre-computed @property declarations for gradient position variables. */
const GRADIENT_PROPERTIES: readonly string[] = Object.freeze(
	(
		[
			["--ri-gradient-from-position", '"<length-percentage>"', "0%"],
			["--ri-gradient-via-position", '"<length-percentage>"', "50%"],
			["--ri-gradient-to-position", '"<length-percentage>"', "100%"],
		] as const
	).map(
		([name, syntax, initial]) =>
			`@property ${name} {\n  syntax: ${syntax};\n  inherits: false;\n  initial-value: ${initial};\n}`,
	),
);

/**
 * Pre-computed @property declarations for mask gradient stop position variables.
 * Registering 0%/100% defaults lets a lone `mask-*-from-*` or `mask-*-to-*`
 * render correctly when the opposite stop var is never set — mirrors
 * GRADIENT_PROPERTIES. Color/direction/shape/size vars use inline var() fallbacks
 * in utilities/effects/masks.ts instead.
 */
const MASK_PROPERTIES: readonly string[] = Object.freeze(
	(
		[
			["--ri-mask-linear-from-position", '"<length-percentage>"', "0%"],
			["--ri-mask-linear-to-position", '"<length-percentage>"', "100%"],
			["--ri-mask-top-from-position", '"<length-percentage>"', "0%"],
			["--ri-mask-top-to-position", '"<length-percentage>"', "100%"],
			["--ri-mask-right-from-position", '"<length-percentage>"', "0%"],
			["--ri-mask-right-to-position", '"<length-percentage>"', "100%"],
			["--ri-mask-bottom-from-position", '"<length-percentage>"', "0%"],
			["--ri-mask-bottom-to-position", '"<length-percentage>"', "100%"],
			["--ri-mask-left-from-position", '"<length-percentage>"', "0%"],
			["--ri-mask-left-to-position", '"<length-percentage>"', "100%"],
			["--ri-mask-radial-from-position", '"<length-percentage>"', "0%"],
			["--ri-mask-radial-to-position", '"<length-percentage>"', "100%"],
			["--ri-mask-conic-from-position", '"<length-percentage>"', "0%"],
			["--ri-mask-conic-to-position", '"<length-percentage>"', "100%"],
		] as const
	).map(
		([name, syntax, initial]) =>
			`@property ${name} {\n  syntax: ${syntax};\n  inherits: false;\n  initial-value: ${initial};\n}`,
	),
);

/**
 * Pre-computed @property declarations for the steady-state translate/scale
 * variables. Registering identity defaults (`0px` for translate, `1` for
 * scale) makes a single-axis class like `-translate-x-full` or `scale-y-50`
 * produce a valid shorthand declaration even when the other axes' custom
 * properties are never set. The inline `var(..., 0)` / `var(..., 1)` fallback
 * in `utilities/effects/transforms.ts` is the correctness guarantee in browsers without
 * `@property` support; this block additionally makes each axis independently
 * animatable.
 */
const TRANSFORM_PROPERTIES: readonly string[] = Object.freeze(
	(
		[
			["--ri-translate-x", '"<length-percentage>"', "0px"],
			["--ri-translate-y", '"<length-percentage>"', "0px"],
			["--ri-translate-z", '"<length>"', "0px"],
			["--ri-scale-x", '"<number>"', "1"],
			["--ri-scale-y", '"<number>"', "1"],
			["--ri-scale-z", '"<number>"', "1"],
		] as const
	).map(
		([name, syntax, initial]) =>
			`@property ${name} {\n  syntax: ${syntax};\n  inherits: false;\n  initial-value: ${initial};\n}`,
	),
);

/** Pre-computed @property declarations for animation variables. */
export const ANIMATION_PROPERTIES: readonly string[] = Object.freeze(
	(
		[
			["--ri-enter-opacity", '"<number>"', "1"],
			["--ri-enter-scale", '"<number>"', "1"],
			["--ri-enter-rotate", '"<angle>"', "0deg"],
			["--ri-enter-translate-x", '"<length-percentage>"', "0px"],
			["--ri-enter-translate-y", '"<length-percentage>"', "0px"],
			["--ri-enter-blur", '"<length>"', "0px"],
			["--ri-exit-opacity", '"<number>"', "1"],
			["--ri-exit-scale", '"<number>"', "1"],
			["--ri-exit-rotate", '"<angle>"', "0deg"],
			["--ri-exit-translate-x", '"<length-percentage>"', "0px"],
			["--ri-exit-translate-y", '"<length-percentage>"', "0px"],
			["--ri-exit-blur", '"<length>"', "0px"],
		] as const
	).map(
		([name, syntax, initial]) =>
			`@property ${name} {\n  syntax: ${syntax};\n  inherits: false;\n  initial-value: ${initial};\n}`,
	),
);

export interface SupportBlock {
	/** Substring test revealing that a chunk of CSS uses this feature. */
	test(css: string): boolean;
	/** Utility roots that force the block even when `test` misses their output
	 *  (compile-loop only — it is the sole caller with parsed classes). */
	utilities?: readonly string[];
	/** Substring identifying this block inside result.properties, so scanning
	 *  user CSS never re-pushes a block the compile loop already emitted. */
	sentinel: string;
	properties: readonly string[];
	keyframes?: readonly string[];
	/** True = only the compile loop emits this block; scanCSSForTokenUsage
	 *  (user CSS) skips it. Today only the animation block is marked — user CSS
	 *  referencing --ri-enter-/--ri-exit- has never triggered keyframe emission,
	 *  and this flag makes that asymmetry explicit instead of an omission. */
	compileLoopOnly?: boolean;
}

/**
 * Rows in emission order — matched blocks push their @property/@keyframes
 * data in this order, preserving the output byte layout.
 */
export const SUPPORT_BLOCKS: readonly SupportBlock[] = Object.freeze([
	{
		// Gradient position vars — needed whenever a rule mentions the gradient
		// stop vars or builds a gradient image directly.
		test: (css) =>
			css.includes("--ri-gradient-") ||
			css.includes("linear-gradient(") ||
			css.includes("radial-gradient(") ||
			css.includes("conic-gradient("),
		sentinel: "--ri-gradient-from-position",
		properties: GRADIENT_PROPERTIES,
	},
	{
		// Mask gradient stop position vars (same idea as gradients above).
		test: (css) => css.includes("--ri-mask-"),
		sentinel: "--ri-mask-linear-from-position",
		properties: MASK_PROPERTIES,
	},
	{
		// Steady-state translate/scale axes. The substrings deliberately exclude
		// `--ri-enter-translate-` and `--ri-exit-translate-`, which belong to the
		// animation block below.
		test: (css) => css.includes("--ri-translate-") || css.includes("--ri-scale-"),
		sentinel: "--ri-translate-x",
		properties: TRANSFORM_PROPERTIES,
	},
	{
		// Enter/exit animation system: keyframes + the vars they read. animate-in
		// and animate-out are forced by utility name because their bare forms
		// reference the keyframes without necessarily emitting any --ri-enter-/
		// --ri-exit- var.
		test: (css) => css.includes("--ri-enter-") || css.includes("--ri-exit-"),
		utilities: ["animate-in", "animate-out"],
		sentinel: "--ri-enter-opacity",
		properties: ANIMATION_PROPERTIES,
		keyframes: ANIMATION_KEYFRAMES,
		compileLoopOnly: true,
	},
]);
