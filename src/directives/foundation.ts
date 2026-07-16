import type { DarkModeConfig } from "../theme/colors.js";
import type { FontSlot } from "../integrations/font-providers/index.js";
import type {
	AnimationDefinition,
	ColorDefinition,
	CornerShape,
	FluidConfig,
} from "../theme/index.js";

/**
 * Raw-extractable directive names — the single source for the DirectiveType
 * union and the name sets in directives/index.ts (which add the PostCSS-only
 * apply/slot names on top for activation detection).
 */
export const DIRECTIVE_TYPE_NAMES = [
	"color",
	"text",
	"spacing",
	"breakpoint",
	"rounded",
	"shadow",
	"weight",
	"ease",
	"blur",
	"z",
	"animate",
	"fluid",
	"font",
	"preflight",
	"utility",
	"custom",
	"source",
	"leading",
	"tracking",
	"opacity",
	"duration",
	"layer",
	"register",
] as const;

export type DirectiveType = (typeof DIRECTIVE_TYPE_NAMES)[number];

export interface ParsedDirective {
	type: DirectiveType;
	body: string;
	modifier?: string;
}

export interface PreflightConfig {
	core: boolean;
	typography: boolean;
	content: boolean;
	forms: boolean;
	interactive: boolean;
	modern: boolean;
}

export interface CustomUtility {
	name: string;
	functional: boolean;
	body: string;
}

export interface CustomVariant {
	name: string;
	selector: string;
}

export interface SourceDirective {
	pattern: string;
	negated: boolean;
	inline: boolean;
	classes?: string[];
	/**
	 * Marks the pattern as a trusted, fully-qualified absolute path produced
	 * by internal machinery (auto-discovery from installed deps). User-facing
	 * `@source` patterns are validated to be relative — this flag bypasses
	 * that check for patterns we generate ourselves and that intentionally
	 * point outside the project's cwd (into `node_modules`).
	 */
	absolute?: boolean;
}

export interface LayerConfig {
	order: string[] | null;
	utilities: string | null;
	base: string | null;
	wrapAll: string | null;
}

/**
 * A custom-property registration produced by an `@register` directive — the
 * structured form of a CSS `@property` rule. `syntax` is stored already quoted
 * (e.g. `"<length>"`) so it can be emitted verbatim. `initialValue` is optional
 * only when `syntax` is the universal `"*"`; the parser drops typed registrations
 * that lack one (a typed `@property` without `initial-value` is invalid CSS and
 * silently ignored by browsers).
 */
export interface PropertyRegistration {
	name: string;
	syntax: string;
	inherits: boolean;
	initialValue?: string;
}

export interface ResolvedTheme {
	readonly colors: Readonly<Record<string, ColorDefinition>>;
	readonly darkConfig: Readonly<DarkModeConfig>;
	readonly text: Readonly<Record<string, { fontSize: string; lineHeight: string }>>;
	readonly spacing: Readonly<{ base: string }>;
	readonly breakpoints: Readonly<Record<string, string>>;
	readonly rounded: Readonly<Record<string, string>>;
	readonly roundedRoof: string;
	/**
	 * Corner shape set via `@rounded <shape>`. `null` means no shape was configured —
	 * the compiler emits neither a `corner-shape` rule nor the fallback `@supports not`
	 * block. Non-null values trigger both.
	 */
	readonly roundedShape: CornerShape | null;
	/**
	 * Multiplier applied to `border-radius` inside
	 * `@supports (corner-shape: <shape>)` so that — in browsers that do
	 * render the configured shape — radii are bumped to match the visual
	 * weight a plain round corner would have at the raw radius in
	 * non-supporting browsers. Derived from the per-shape default table,
	 * overridable via `--corner-scale` in the `@rounded` body. Ignored when
	 * `roundedShape` is null.
	 */
	readonly roundedShapeScale: number;
	readonly shadows: Readonly<Record<string, string>>;
	readonly weights: Readonly<Record<string, number>>;
	readonly easing: Readonly<Record<string, string>>;
	readonly blur: Readonly<Record<string, string>>;
	readonly z: Readonly<Record<string, string>>;
	readonly animations: Readonly<Record<string, AnimationDefinition>>;
	readonly fluid: Readonly<FluidConfig>;
	readonly textFluid?: Readonly<FluidConfig>;
	readonly spacingFluid?: Readonly<FluidConfig>;
	readonly fonts: readonly FontSlot[];
	readonly preflight: Readonly<PreflightConfig>;
	readonly customUtilities: readonly CustomUtility[];
	readonly customVariants: readonly CustomVariant[];
	readonly sources: readonly SourceDirective[];
	readonly leading: Readonly<Record<string, string>>;
	readonly tracking: Readonly<Record<string, string>>;
	readonly opacity: Readonly<Record<string, string>>;
	readonly duration: Readonly<Record<string, string>>;
	readonly layer: Readonly<LayerConfig> | null;
	/** Custom properties registered via `@register` → emitted as `@property` rules. */
	readonly registeredProperties: readonly PropertyRegistration[];
	readonly warnings: readonly string[];
}

type DeepMutable<T> = T extends readonly (infer U)[]
	? U[]
	: T extends Record<string, unknown>
		? { -readonly [K in keyof T]: DeepMutable<T[K]> }
		: T;

export type WritableTheme = { -readonly [K in keyof ResolvedTheme]: DeepMutable<ResolvedTheme[K]> };

export function findClosingBrace(src: string, start: number): number {
	let depth = 1;
	for (let i = start + 1; i < src.length; i++) {
		const ch = src[i];
		if (ch === '"' || ch === "'") {
			const quote = ch;
			i++;
			while (i < src.length && src[i] !== quote) {
				if (src[i] === "\\" && i + 1 < src.length) i++;
				i++;
			}
			continue;
		}
		if (ch === "/" && src[i + 1] === "*") {
			const end = src.indexOf("*/", i + 2);
			i = end === -1 ? src.length - 1 : end + 1;
			continue;
		}
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}
