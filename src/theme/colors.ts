/**
 * Generative color system — color domain model, OKLCH ramp generation,
 * and light-dark() pairing.
 *
 * 2 numbers (chroma + hue) → 19-stop palette with automatic dark mode.
 *
 * The ramp is sampled from a fixed reference profile (`L_PROFILE` / `C_SHAPE` /
 * `H_DRIFT`, captured from the reference palette): lightness is a curved,
 * compressed scale (low suffix → light, high → dark), chroma is an asymmetric
 * bell peaking at stop 500, and hue is near-flat. Dark mode is a simple ramp
 * reversal — the dark value is the stop the ramp reaches at the mirror position
 * (`1000 - suffix`), so stop 500 pivots to itself.
 */

/** Per-color dark mode override strategy. */
export type ColorDarkOverride =
	| { strategy: "mirror" }
	| { strategy: "fixed" }
	| { strategy: "shift"; chromaDelta: number; hueDelta: number };

/**
 * Color definition — discriminated union supporting:
 * - Generative: `brand: 0.18 330;` → 19-stop palette with auto dark mode
 * - Explicit: `accent: oklch(0.72 0.21 330);` → single color value
 * - Pair: `surface: oklch(0.98 0.01 260) / oklch(0.15 0.01 260);` → light/dark pair
 * - Alias: `theme: brand;` → references another color's palette via var()
 */
export type ColorDefinition =
	| {
			type: "generative";
			chroma: number;
			hue: number;
			dark?: ColorDarkOverride;
			inline?: boolean;
			parabolic?: boolean;
			chromaBoost?: boolean;
	  }
	| { type: "explicit"; value: string }
	| { type: "keyword"; value: string }
	| { type: "pair"; light: string; dark: string }
	| { type: "alias"; source: string };

/**
 * Check whether a numeric suffix is a valid color lightness token.
 * Valid range: integers 1–999 (0 and 1000 are black/white, handled by paper/ink).
 */
export function isValidColorSuffix(n: number): boolean {
	return Number.isInteger(n) && n >= 1 && n <= 999;
}

// ---------------------------------------------------------------------------
// Reference ramp profiles
// ---------------------------------------------------------------------------

/**
 * The reference palette is defined at the 19 canonical stops 50…950 (uniform
 * step 50). Arbitrary suffixes 1–999 are sampled by interpolating these three
 * profiles, so any stop a project references stays on the same curves.
 */
const STOP_LO = 50;
const STOP_STEP = 50;

/**
 * Lightness ramp — absolute OKLCH L per stop, hue/chroma-independent, spaced for
 * EVEN PERCEIVED (APCA) CONTRAST rather than even lightness: the steps are small near
 * white and grow toward black, matching the eye's reduced sensitivity to contrast in
 * dark regions (see `.claude/color-expert` — "evenly distribute APCA contrast … APCA
 * accounts for Stevens' law"). This is what makes the dark-mode luminance mirror read
 * with the SAME perceived contrast as light mode at every stop. Stops 50–500 still
 * match the reference to <0.005; the dark half descends to near-black (~0.045 at 950)
 * so the ramp spans both poles.
 */
const L_PROFILE: readonly number[] = [
	0.9668, // 50
	0.936756, // 100
	0.905984, // 150
	0.87442, // 200
	0.841988, // 250
	0.808602, // 300
	0.774158, // 350
	0.73853, // 400
	0.701568, // 450
	0.663082, // 500
	0.622832, // 550
	0.580504, // 600
	0.535677, // 650
	0.487755, // 700
	0.435847, // 750
	0.378506, // 800
	0.313034, // 850
	0.232988, // 900
	0.045, // 950
];

/**
 * Reference chroma — the example's chroma at each stop for the reference input
 * `REF_CHROMA`. Used as a shape: the requested chroma is scaled by
 * `C_REF[stop] / REF_CHROMA`, an asymmetric bell peaking at stop 500 where it
 * slightly *exceeds* the requested chroma (≈1.16×) and tapering to the light
 * (~0.14×) and dark (~0.27×) ends. Stored raw (not pre-divided) so every literal
 * round-trips exactly.
 */
const REF_CHROMA = 0.05;
const C_REF: readonly number[] = [
	0.006863863034589374, // 50
	0.01319862716849036, // 100
	0.019388384668336325, // 150
	0.025429811853816625, // 200
	0.03131716290796655, // 250
	0.03704281264548738, // 300
	0.04259815284255128, // 350
	0.04797259847240491, // 400
	0.053139652622711774, // 450
	0.05807254410984486, // 500
	0.057890440330825195, // 550
	0.05222950205066024, // 600
	0.04663166172903349, // 650
	0.04108661482545571, // 700
	0.035584106512529856, // 750
	0.030108630901677546, // 800
	0.02463007273923548, // 850
	0.01911062262055484, // 900
	0.013470720217073236, // 950
];

/**
 * Hue drift — degrees to add to the requested hue per stop, captured from the
 * reference (its hue minus the nominal 92°). Near-flat (sub-degree). This
 * deliberately carries the reference tool's ~0.6° offset from nominal so the
 * output matches it; base-anchor it (subtract the stop-500 entry) if the typed
 * hue should land exactly at stop 500 instead.
 */
const H_DRIFT: readonly number[] = [
	-0.93815866691077, // 50
	-0.88308454198904, // 100
	-0.82986570023714, // 150
	-0.77925524218887, // 200
	-0.73231968077941, // 250
	-0.69055370894147, // 300
	-0.65608113228225, // 350
	-0.6319804472577, // 400
	-0.62282301825498, // 450
	-0.63542113918918, // 500
	-0.65047025648765, // 550
	-0.64293938410323, // 600
	-0.63626978185344, // 650
	-0.63057786221076, // 700
	-0.62611168444876, // 750
	-0.62332854799372, // 800
	-0.62317507759171, // 850
	-0.62789446720379, // 900
	-0.64378251527182, // 950
];

/**
 * Cubic-Hermite sample of a fixed 19-point profile on the uniform stop grid
 * [50…950]. `monotone` applies the Fritsch–Carlson tangent limiter — used for
 * the lightness ramp so it never overshoots or reverses; the chroma and hue
 * profiles use plain Catmull–Rom tangents for a smooth fit. Outside the grid the
 * end segment's slope is extended linearly, so suffixes 1–999 stay continuous.
 *
 * At an exact canonical stop the result is the stored value (no interpolation),
 * so the reference palette is reproduced exactly there.
 */
function sampleProfile(values: readonly number[], suffix: number, monotone: boolean): number {
	const last = values.length - 1;
	const fx = (suffix - STOP_LO) / STOP_STEP; // fractional knot index

	if (fx <= 0) return values[0] + (values[1] - values[0]) * fx;
	if (fx >= last) return values[last] + (values[last] - values[last - 1]) * (fx - last);

	const i = Math.floor(fx);
	const t = fx - i;
	if (t === 0) return values[i];

	// Secant of the active segment and centered (Catmull–Rom) tangents at its ends.
	const seg = values[i + 1] - values[i];
	const tangent = (k: number): number => {
		if (k <= 0) return values[1] - values[0];
		if (k >= last) return values[last] - values[last - 1];
		return (values[k + 1] - values[k - 1]) / 2;
	};
	let m0 = tangent(i);
	let m1 = tangent(i + 1);

	if (monotone) {
		if (seg === 0) {
			m0 = 0;
			m1 = 0;
		} else {
			const a = m0 / seg;
			const b = m1 / seg;
			const s = a * a + b * b;
			if (s > 9) {
				const tau = 3 / Math.sqrt(s);
				m0 = tau * a * seg;
				m1 = tau * b * seg;
			}
		}
	}

	const t2 = t * t;
	const t3 = t2 * t;
	return (
		(2 * t3 - 3 * t2 + 1) * values[i] +
		(t3 - 2 * t2 + t) * m0 +
		(-2 * t3 + 3 * t2) * values[i + 1] +
		(t3 - t2) * m1
	);
}

/**
 * OKLCH lightness for a numeric suffix, sampled from the reference lightness
 * ramp. Low suffix → light, high suffix → dark, spanning near-white (~0.97) to
 * near-black (~0.045) with even-perceived-contrast spacing. Exact at the canonical
 * stops 50…950, monotone and continuous (clamped to a visible band) for any 1…999.
 */
export function lightnessFromSuffix(suffix: number): number {
	// Clamp to a visible near-pole band so the extreme tokens stay distinct from the
	// page (pure white / black) in both light and dark modes.
	return Math.min(0.98, Math.max(0.02, sampleProfile(L_PROFILE, suffix, true)));
}

// Frozen (shallow) — resolveDirectives spread-copies this into every theme, so
// a mutation here would silently leak into all subsequent compilations.
//
// Only the achromatic `theme` palette ships by default: it is the neutral base
// every project re-tints via `@color { theme: <chroma> <hue>; }` or a
// `[data-theme]` override. No semantic or tonal palettes (error, info, success,
// …) are bundled — a project declares exactly the colors it needs with `@color`
// directives, so nothing unused reaches the emitted token layer.
export const DEFAULT_COLORS: Record<string, ColorDefinition> = Object.freeze({
	theme: {
		type: "generative",
		chroma: 0,
		hue: 0,
		parabolic: false,
		chromaBoost: false,
	},
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColorStop {
	stop: number;
	l: number;
	c: number;
	h: number;
}

export interface DarkModeConfig {
	mode: "auto" | "off";
	chromaBoost: number;
	hueShift: number;
}

export const DEFAULT_DARK_CONFIG: DarkModeConfig = {
	mode: "auto",
	// 0 → dark keeps the light stop's chroma exactly (same tone in both modes).
	// Raise it via `@color dark { chroma-boost }` for punchier dark-mode colors.
	chromaBoost: 0,
	hueShift: 0,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum binary-search iterations for gamut clamping. */
const GAMUT_CLAMP_ITERATIONS = 20;

// ---------------------------------------------------------------------------
// OKLCH → sRGB Gamut Checking
// ---------------------------------------------------------------------------

/**
 * Convert OKLCH to OKLab.
 */
export function oklchToOklab(l: number, c: number, h: number): [number, number, number] {
	const hRad = (h * Math.PI) / 180;
	return [l, c * Math.cos(hRad), c * Math.sin(hRad)];
}

/**
 * Convert OKLab to linear sRGB.
 * Uses the OKLab→LMS→linear-sRGB matrix chain.
 */
export function oklabToLinearSrgb(l: number, a: number, b: number): [number, number, number] {
	// OKLab to LMS (cube root domain)
	const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = l - 0.0894841775 * a - 1.291485548 * b;

	// Undo cube root
	const lc = l_ * l_ * l_;
	const mc = m_ * m_ * m_;
	const sc = s_ * s_ * s_;

	// LMS to linear sRGB
	const r = +4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
	const g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
	const bv = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc;

	return [r, g, bv];
}

/**
 * Check if an OKLCH color is within the sRGB gamut.
 * Returns true if all linear sRGB channels are in [0, 1] (with small epsilon).
 */
export function isInSrgbGamut(l: number, c: number, h: number): boolean {
	const [la, a, b] = oklchToOklab(l, c, h);
	const [r, g, bv] = oklabToLinearSrgb(la, a, b);
	const eps = 0.001;
	return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && bv >= -eps && bv <= 1 + eps;
}

/**
 * Gamut-safe chroma scaling via binary search.
 * Reduces chroma until the OKLCH color fits within sRGB.
 */
export function gamutSafeChroma(l: number, requestedChroma: number, h: number): number {
	if (requestedChroma <= 0) return 0;
	if (isInSrgbGamut(l, requestedChroma, h)) return requestedChroma;

	let lo = 0;
	let hi = requestedChroma;
	for (let i = 0; i < GAMUT_CLAMP_ITERATIONS; i++) {
		const mid = (lo + hi) / 2;
		if (isInSrgbGamut(l, mid, h)) {
			lo = mid;
		} else {
			hi = mid;
		}
		// Early termination when convergence is reached
		if (hi - lo < 0.0005) break;
	}
	return lo;
}

// ---------------------------------------------------------------------------
// APCA Contrast (WCAG 3 draft — Accessible Perceptual Contrast Algorithm)
// ---------------------------------------------------------------------------

// Constants from Myndex's APCA-W3 reference implementation.
const APCA_MAIN_TRC = 2.4;
const APCA_NORM_BG = 0.56;
const APCA_NORM_TXT = 0.57;
const APCA_REV_TXT = 0.62;
const APCA_REV_BG = 0.65;
const APCA_BLK_THRS = 0.022;
const APCA_BLK_CLMP = Math.SQRT2;
const APCA_SCALE = 1.14;
const APCA_LO_BOW_OFFSET = 0.027;
const APCA_LO_WOB_OFFSET = 0.027;
const APCA_DELTA_Y_MIN = 0.0005;
const APCA_LO_CLIP = 0.1;

/** sRGB encoding transfer (linear → display). */
function linearToSrgb(c: number): number {
	const x = Math.max(0, Math.min(1, c));
	return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

/**
 * APCA Y_s — perceptually weighted screen luminance from OKLCH.
 *
 * APCA gates contrast on this value rather than the WCAG 2.x relative
 * luminance formula. The 2.4 power on sRGB display values is APCA's
 * intentional simplification of the sRGB transfer.
 */
export function oklchToApcaY(l: number, c: number, h: number): number {
	const [la, a, b] = oklchToOklab(l, c, h);
	const [lr, lg, lb] = oklabToLinearSrgb(la, a, b);
	const r = linearToSrgb(lr);
	const g = linearToSrgb(lg);
	const bv = linearToSrgb(lb);
	return 0.2126 * r ** APCA_MAIN_TRC + 0.7152 * g ** APCA_MAIN_TRC + 0.0722 * bv ** APCA_MAIN_TRC;
}

/**
 * APCA Lc contrast value (Myndex W3 algorithm, scaled to ±108).
 *
 * Positive Lc = dark text on light background; negative = light text on
 * dark background. The absolute value is the contrast magnitude. Typical
 * thresholds: |Lc| ≥ 75 (body), ≥ 60 (large text), ≥ 90 (preferred body).
 *
 * Use this in preference to WCAG 2.x for new work: WCAG 2 is known to
 * over- and under-estimate perceived contrast across the lightness range.
 */
export function apcaContrast(yText: number, yBg: number): number {
	if (yText < 0 || yBg < 0) return 0;
	if (Math.max(yText, yBg) < APCA_BLK_THRS) return 0;

	// Soft clamp near black so values just above zero do not produce
	// disproportionate contrast magnitudes.
	const txtY = yText < APCA_BLK_THRS ? yText + (APCA_BLK_THRS - yText) ** APCA_BLK_CLMP : yText;
	const bgY = yBg < APCA_BLK_THRS ? yBg + (APCA_BLK_THRS - yBg) ** APCA_BLK_CLMP : yBg;

	if (Math.abs(bgY - txtY) < APCA_DELTA_Y_MIN) return 0;

	if (bgY > txtY) {
		const sapc = (bgY ** APCA_NORM_BG - txtY ** APCA_NORM_TXT) * APCA_SCALE;
		return sapc < APCA_LO_CLIP ? 0 : (sapc - APCA_LO_BOW_OFFSET) * 100;
	}
	const sapc = (bgY ** APCA_REV_BG - txtY ** APCA_REV_TXT) * APCA_SCALE;
	return sapc > -APCA_LO_CLIP ? 0 : (sapc + APCA_LO_WOB_OFFSET) * 100;
}

// ---------------------------------------------------------------------------
// Palette Generation
// ---------------------------------------------------------------------------

/** Memo for generateStop: one compile resolves the same (def, suffix) pairs
 *  from the token layer, dark overrides, and contrast checks. The pipeline is
 *  pure and theme definitions are frozen, so cross-compile reuse is safe. */
const _stopMemo = new WeakMap<object, Map<number, ColorStop>>();

/**
 * Generate a single color stop from a generative definition and a suffix.
 * Samples the reference profiles (lightness ramp, chroma bell, hue drift) and
 * gamut-clamps the chroma.
 */
export function generateStop(
	def: Extract<ColorDefinition, { type: "generative" }>,
	suffix: number,
): ColorStop {
	let bySuffix = _stopMemo.get(def);
	if (!bySuffix) {
		bySuffix = new Map();
		_stopMemo.set(def, bySuffix);
	}
	const cached = bySuffix.get(suffix);
	if (cached) return cached;
	const stop = computeStop(def, suffix);
	bySuffix.set(suffix, stop);
	return stop;
}

function computeStop(
	def: Extract<ColorDefinition, { type: "generative" }>,
	suffix: number,
): ColorStop {
	const roundedL = Math.round(lightnessFromSuffix(suffix) * 1000) / 1000;

	// Hue: the requested hue plus the reference's sub-degree drift profile.
	// Achromatic colors keep hue 0 — hue is meaningless at zero chroma, and the
	// neutral `theme` ramp must stay a pure gray.
	const h = def.chroma > 0 ? def.hue + sampleProfile(H_DRIFT, suffix, false) : def.hue;
	const roundedH = Math.round(h * 1000) / 1000;

	// Chroma: the requested chroma scaled by the reference bell (peak ~1.16× at
	// stop 500), or flat across the ramp when `parabolic` is off. gamutSafeChroma
	// keeps it inside sRGB; floor to 4dp (never rounds up, so it can't land back out
	// of gamut) — 4 decimals keeps near-neutral palettes faithful where 3 would
	// quantize a low chroma to ~1 significant figure.
	const shapedChroma =
		def.parabolic === false
			? def.chroma
			: (def.chroma * sampleProfile(C_REF, suffix, false)) / REF_CHROMA;
	const safeC = gamutSafeChroma(roundedL, shapedChroma, roundedH);
	const roundedC = Math.floor(safeC * 10000) / 10000;

	return {
		stop: suffix,
		l: roundedL,
		c: roundedC,
		h: roundedH,
	};
}

// ---------------------------------------------------------------------------
// CSS Generation
// ---------------------------------------------------------------------------

/**
 * Format an OKLCH value as a CSS string.
 */
export function formatOklch(l: number, c: number, h: number): string {
	return `oklch(${l} ${c} ${h})`;
}

/**
 * Generate CSS custom properties for a generative palette with light-dark() pairing.
 *
 * The suffix indexes the reference ramp directly: `generateStop(def, suffix)` is
 * the light-mode value (low suffix → light, high → dark).
 *
 * Dark mode keeps the **same tone, mirrored luminance**: the dark value reuses the light
 * stop's chroma and hue and takes the lightness of the mirror stop (`1000 - suffix`). The
 * two modes share one luminance ramp — reverse-aligning the tokens, each dark stop has the
 * exact lightness of its light counterpart, so neither mode reads lighter than the other
 * and stop 500 pivots to itself. `gamutSafeChroma` re-clamps the (rare) saturated stop
 * whose chroma will not fit at the mirror L. The global `chroma-boost` (default 0) /
 * `hue-shift` knobs nudge the dark tone.
 *
 * Per-color dark overrides control the strategy:
 * - mirror (default): same tone, mirrored luminance (above)
 * - fixed: same value in both modes
 * - shift: mirrored luminance plus per-color chroma/hue deltas
 */
export function generateColorVariables(
	name: string,
	def: Extract<ColorDefinition, { type: "generative" }>,
	suffixes: number[],
	darkConfig: DarkModeConfig = DEFAULT_DARK_CONFIG,
	darkOverride?: ColorDarkOverride,
): string[] {
	const vars: string[] = [];
	const strategy = darkOverride?.strategy ?? "mirror";

	for (const suffix of suffixes) {
		const lightStop = generateStop(def, suffix);
		const lightValue = formatOklch(lightStop.l, lightStop.c, lightStop.h);

		if (darkConfig.mode === "off" || strategy === "fixed") {
			// No dark mode or fixed: use light value only
			if (darkConfig.mode === "off") {
				vars.push(`--color-${name}-${suffix}: ${lightValue};`);
			} else {
				vars.push(`--color-${name}-${suffix}: light-dark(${lightValue}, ${lightValue});`);
			}
		} else {
			// Same tone, mirrored luminance: keep the light stop's chroma + hue and take
			// the lightness of the mirror stop (1000 - suffix). The two modes share ONE
			// luminance ramp — reverse-aligning the tokens, a dark stop has the exact
			// lightness of its light counterpart, so neither mode reads lighter than the
			// other (and stop 500 pivots to itself).
			const darkL = generateStop(def, 1000 - suffix).l;

			let extraChroma = 0;
			let extraHue = 0;
			if (darkOverride?.strategy === "shift") {
				extraChroma = darkOverride.chromaDelta;
				extraHue = darkOverride.hueDelta;
			}
			const darkH = lightStop.h + darkConfig.hueShift + extraHue;
			const globalChromaBoost = def.chromaBoost !== false ? darkConfig.chromaBoost : 0;
			// gamutSafeChroma re-clamps: the light chroma may not fit at the mirror L for
			// very saturated stops, where it is reduced to the gamut boundary.
			const requestedChroma = lightStop.c + globalChromaBoost + extraChroma;

			const darkC = Math.floor(gamutSafeChroma(darkL, requestedChroma, darkH) * 10000) / 10000;

			const darkValue = formatOklch(darkL, darkC, darkH);
			vars.push(`--color-${name}-${suffix}: light-dark(${lightValue}, ${darkValue});`);
		}
	}

	return vars;
}

/** Semantic paper/ink variables (constant). */
export const SEMANTIC_COLORS: readonly string[] = Object.freeze([
	"--color-paper: light-dark(oklch(1 0 0), oklch(0 0 0));",
	"--color-ink: light-dark(oklch(0 0 0), oklch(1 0 0));",
]);

/** Default APCA |Lc| threshold for `checkPaletteContrast` — medium-text level. */
export const DEFAULT_PALETTE_CONTRAST_LC = 60;

export interface PaletteContrastOptions {
	/**
	 * Minimum APCA |Lc| a stop must achieve against the better of paper or ink
	 * to avoid warning. Defaults to 60 (Bronze medium-text level). Common values:
	 *   45 — Bronze large-text minimum
	 *   60 — Bronze medium-text (>24px)
	 *   75 — Bronze body-text (>18px)
	 */
	minLc?: number;
}

/**
 * Warn for color stops that achieve less than `minLc` APCA contrast against
 * BOTH `--color-paper` (white) and `--color-ink` (black). Such stops cannot
 * serve as text on either polar background — they are background-fill-only.
 *
 * Emits `RI-1106` warnings for the assembly layer to forward to consumers.
 * Stops not present in `usedColorStops` are skipped (the warning fires only
 * for stops actually referenced in source).
 */
export function checkPaletteContrast(
	colors: Record<string, ColorDefinition>,
	usedColorStops: Map<string, Set<number>>,
	options: PaletteContrastOptions = {},
): string[] {
	const minLc = options.minLc ?? DEFAULT_PALETTE_CONTRAST_LC;
	const warnings: string[] = [];

	const paperY = oklchToApcaY(1, 0, 0);
	const inkY = oklchToApcaY(0, 0, 0);

	for (const [name, def] of Object.entries(colors)) {
		if (def.type !== "generative") continue;
		const stops = usedColorStops.get(name);
		if (!stops || stops.size === 0) continue;

		const sorted = [...stops].sort((a, b) => a - b);
		for (const suffix of sorted) {
			const stop = generateStop(def, suffix);
			const fgY = oklchToApcaY(stop.l, stop.c, stop.h);
			const lcPaper = Math.abs(apcaContrast(fgY, paperY));
			const lcInk = Math.abs(apcaContrast(fgY, inkY));
			const best = Math.max(lcPaper, lcInk);
			if (best < minLc) {
				warnings.push(
					`[RI-1106] @color "${name}-${suffix}" has low APCA contrast (best |Lc| ${best.toFixed(0)} < ${minLc}; paper ${lcPaper.toFixed(0)}, ink ${lcInk.toFixed(0)}). Stop is unsuitable as text on either --color-paper or --color-ink — use a darker (lower suffix) or lighter (higher suffix) variant for text roles.`,
				);
			}
		}
	}

	return warnings;
}

/**
 * Generate all color CSS variables for used color stops.
 * Only emits variables for suffixes actually used in the source.
 *
 * @param colors - Color definitions from theme
 * @param darkConfig - Dark mode configuration
 * @param usedColorStops - Map of hue name → set of used suffixes
 */
export function generateAllColorVariables(
	colors: Record<string, ColorDefinition> = DEFAULT_COLORS,
	darkConfig: DarkModeConfig = DEFAULT_DARK_CONFIG,
	usedColorStops?: Map<string, Set<number>>,
): string[] {
	const allVars: string[] = [];

	// Semantic colors
	allVars.push(...SEMANTIC_COLORS);

	for (const [name, def] of Object.entries(colors)) {
		switch (def.type) {
			case "generative": {
				const suffixes = usedColorStops?.get(name);
				if (!suffixes || suffixes.size === 0) break;
				const sorted = [...suffixes].sort((a, b) => a - b);
				allVars.push(...generateColorVariables(name, def, sorted, darkConfig, def.dark));
				break;
			}
			case "explicit": {
				// Single explicit value — no stops, just one variable
				allVars.push(`--color-${name}: ${def.value};`);
				break;
			}
			case "pair": {
				// Light/dark pair — emit light-dark()
				if (darkConfig.mode === "off") {
					allVars.push(`--color-${name}: ${def.light};`);
				} else {
					allVars.push(`--color-${name}: light-dark(${def.light}, ${def.dark});`);
				}
				break;
			}
			case "alias": {
				// Alias — reference another color's variables via var()
				const source = colors[def.source];
				if (source && source.type === "generative") {
					const suffixes = usedColorStops?.get(name);
					if (!suffixes || suffixes.size === 0) break;
					const sorted = [...suffixes].sort((a, b) => a - b);
					for (const suffix of sorted) {
						allVars.push(`--color-${name}-${suffix}: var(--color-${def.source}-${suffix});`);
					}
				} else if (source) {
					allVars.push(`--color-${name}: var(--color-${def.source});`);
				}
				break;
			}
		}
	}

	return allVars;
}

/**
 * Generate `[data-theme]` override blocks for the "theme" color.
 *
 * When a color named "theme" is defined, this generates CSS rule blocks
 * that allow switching the theme palette via `data-theme` attribute on
 * the HTML element:
 *
 *   `<html data-theme="blue">` → `--color-theme-*` maps to `--color-blue-*`
 *
 * Only generative colors get override selectors.
 * Only suffixes actually used for "theme" are aliased.
 */
export function generateThemeOverrides(
	colors: Record<string, ColorDefinition>,
	usedThemeSuffixes?: Set<number>,
): string[] {
	// Only generate if "theme" is defined as a color
	if (!Object.hasOwn(colors, "theme")) return [];
	if (!usedThemeSuffixes || usedThemeSuffixes.size === 0) return [];

	const sorted = [...usedThemeSuffixes].sort((a, b) => a - b);
	const blocks: string[] = [];

	for (const [name, def] of Object.entries(colors)) {
		// Skip the theme color itself, non-generative colors, and colors without inline flag
		if (name === "theme") continue;
		if (def.type !== "generative") continue;
		if (!def.inline) continue;

		const vars: string[] = [];
		for (const suffix of sorted) {
			vars.push(`  --color-theme-${suffix}: var(--color-${name}-${suffix});`);
		}
		// Sanitize color name for use in a CSS attribute selector to prevent
		// injection if a name contains `"`, `]`, or `\` (user-defined via @color).
		const safeName = name.replace(/[\\"'\]]/g, "");
		if (!safeName) continue;
		blocks.push(`[data-theme="${safeName}"] {\n${vars.join("\n")}\n}`);
	}

	return blocks;
}
