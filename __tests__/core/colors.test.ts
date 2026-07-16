import { describe, expect, it } from "vitest";
import {
	DEFAULT_DARK_CONFIG,
	DEFAULT_PALETTE_CONTRAST_LC,
	SEMANTIC_COLORS,
	apcaContrast,
	checkPaletteContrast,
	formatOklch,
	gamutSafeChroma,
	generateAllColorVariables,
	generateColorVariables,
	generateStop,
	isInSrgbGamut,
	lightnessFromSuffix,
	oklabToLinearSrgb,
	oklchToApcaY,
	oklchToOklab,
} from "../../src/theme/colors.js";
import type { ColorDefinition, ColorStop } from "../../src/theme/colors.js";
import { FIXTURE_COLORS } from "../helpers/fixture-colors.js";

/** Run the generative stop pipeline for a set of suffixes (test-local stand-in
 *  for the removed generatePalette wrapper). */
function generateStops(def: ColorDefinition, suffixes: number[]): ColorStop[] {
	if (def.type !== "generative") throw new Error("generateStops requires a generative color");
	return suffixes.map((suffix) => generateStop(def, suffix));
}

describe("isInSrgbGamut", () => {
	it("white is in gamut", () => {
		expect(isInSrgbGamut(1, 0, 0)).toBe(true);
	});

	it("black is in gamut", () => {
		expect(isInSrgbGamut(0, 0, 0)).toBe(true);
	});

	it("neutral gray is in gamut", () => {
		expect(isInSrgbGamut(0.5, 0, 0)).toBe(true);
	});

	it("low chroma colors are in gamut", () => {
		expect(isInSrgbGamut(0.5, 0.01, 260)).toBe(true);
	});

	it("extremely high chroma is out of gamut", () => {
		expect(isInSrgbGamut(0.5, 0.5, 260)).toBe(false);
	});
});

describe("gamutSafeChroma", () => {
	it("returns 0 for 0 chroma", () => {
		expect(gamutSafeChroma(0.5, 0, 260)).toBe(0);
	});

	it("returns requested chroma when in gamut", () => {
		const c = gamutSafeChroma(0.5, 0.01, 0);
		expect(c).toBeCloseTo(0.01, 3);
	});

	it("reduces chroma for out-of-gamut colors", () => {
		const c = gamutSafeChroma(0.5, 0.5, 260);
		expect(c).toBeLessThan(0.5);
		expect(c).toBeGreaterThan(0);
		// Result should be in gamut
		expect(isInSrgbGamut(0.5, c, 260)).toBe(true);
	});

	it("near-white needs less chroma", () => {
		const atWhite = gamutSafeChroma(0.976, 0.15, 260);
		const atMid = gamutSafeChroma(0.58, 0.15, 260);
		expect(atWhite).toBeLessThan(atMid);
	});

	it("near-black needs less chroma", () => {
		const atBlack = gamutSafeChroma(0.184, 0.15, 260);
		const atMid = gamutSafeChroma(0.58, 0.15, 260);
		expect(atBlack).toBeLessThan(atMid);
	});
});

describe("lightnessFromSuffix (reference ramp)", () => {
	it("samples the even-APCA ramp (near-white to near-black)", () => {
		// Even perceived-contrast spacing: matches the reference to <0.005 in the light
		// half and descends to near-black so the ramp spans both poles.
		expect(lightnessFromSuffix(50)).toBeCloseTo(0.9668, 3);
		expect(lightnessFromSuffix(500)).toBeCloseTo(0.663, 3);
		expect(lightnessFromSuffix(950)).toBeCloseTo(0.045, 3);
	});

	it("is monotonic decreasing and clamped to (0,1) across all 1-999", () => {
		let prev = Number.POSITIVE_INFINITY;
		for (let n = 1; n <= 999; n++) {
			const l = lightnessFromSuffix(n);
			expect(l).toBeGreaterThan(0);
			expect(l).toBeLessThan(1);
			expect(l).toBeLessThanOrEqual(prev);
			prev = l;
		}
	});

	it("hugs both poles at the extremes (clamped to a visible band)", () => {
		// Extreme tokens sit at a visible near-white / near-black, not pure white/black.
		expect(lightnessFromSuffix(1)).toBeCloseTo(0.98, 2);
		expect(lightnessFromSuffix(999)).toBeCloseTo(0.02, 2);
	});
});

/** A representative set of suffixes for testing (the canonical 19-stop set). */
const TEST_SUFFIXES = [
	50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950,
];

describe("generateStop", () => {
	it("samples the reference lightness ramp for a suffix", () => {
		const def = FIXTURE_COLORS["error"] as Extract<
			(typeof FIXTURE_COLORS)["error"],
			{ type: "generative" }
		>;
		const stop = generateStop(def, 276);
		// New model: lightness comes from the reference ramp (low suffix → light),
		// not suffix/1000. Suffix 276 lands around 0.82.
		expect(stop.l).toBeCloseTo(0.82, 1);
		expect(stop.l).toBe(Math.round(lightnessFromSuffix(276) * 1000) / 1000);
		expect(stop.stop).toBe(276);
	});

	it("is gamut-safe for arbitrary suffixes", () => {
		for (const [name, def] of Object.entries(FIXTURE_COLORS)) {
			if (def.type !== "generative") continue;
			for (const suffix of [1, 100, 276, 500, 724, 900, 999]) {
				const stop = generateStop(def, suffix);
				expect(isInSrgbGamut(stop.l, stop.c, stop.h), `${name}-${suffix} should be in gamut`).toBe(
					true,
				);
			}
		}
	});
});

describe("generative stop pipeline (multi-suffix)", () => {
	it("produces stops for given suffixes", () => {
		const stops = generateStops(FIXTURE_COLORS["error"], TEST_SUFFIXES);
		expect(stops).toHaveLength(19);
	});

	it("low suffix is lightest, high suffix is darkest", () => {
		const stops = generateStops(FIXTURE_COLORS["info"], TEST_SUFFIXES);
		const s50 = stops.find((s) => s.stop === 50)!;
		const s950 = stops.find((s) => s.stop === 950)!;
		expect(s50.l).toBeGreaterThan(s950.l);
	});

	it("lightness decreases monotonically with suffix", () => {
		const stops = generateStops(FIXTURE_COLORS["success"], TEST_SUFFIXES);
		for (let i = 1; i < stops.length; i++) {
			expect(stops[i].l).toBeLessThan(stops[i - 1].l);
		}
	});

	it("all stops are gamut-safe", () => {
		for (const [name, def] of Object.entries(FIXTURE_COLORS)) {
			for (const stop of generateStops(def, TEST_SUFFIXES)) {
				expect(
					isInSrgbGamut(stop.l, stop.c, stop.h),
					`${name}-${stop.stop} should be in gamut`,
				).toBe(true);
			}
		}
	});

	it("hue stays near-flat (within ~1° of base) across stops", () => {
		// The lightness-dependent hue fan is gone; hue = base + a sub-degree drift
		// profile captured from the reference, so every stop sits within ~1° of 222°.
		const stops = generateStops(FIXTURE_COLORS["info"], TEST_SUFFIXES);
		for (const stop of stops) {
			expect(Math.abs(stop.h - 222)).toBeLessThanOrEqual(1.5);
		}
	});

	it("neutral has zero chroma and constant hue", () => {
		const stops = generateStops(FIXTURE_COLORS["theme"], TEST_SUFFIXES);
		for (const stop of stops) {
			expect(stop.c).toBe(0);
			expect(stop.h).toBe(0);
		}
	});

	it("chroma peaks at stop 500", () => {
		const stops = generateStops(FIXTURE_COLORS["error"], TEST_SUFFIXES);
		const s50 = stops.find((s) => s.stop === 50)!;
		const s500 = stops.find((s) => s.stop === 500)!;
		const s950 = stops.find((s) => s.stop === 950)!;
		expect(s500.c).toBeGreaterThan(s50.c);
		expect(s500.c).toBeGreaterThan(s950.c);
	});

	it("works with arbitrary suffixes like 276", () => {
		const stops = generateStops(FIXTURE_COLORS["error"], [276, 724]);
		expect(stops).toHaveLength(2);
		expect(stops[0].stop).toBe(276);
		expect(stops[1].stop).toBe(724);
		// Sampled from the ramp: 276 is light (~0.82), 724 is dark (~0.46), and the
		// lower suffix is always the lighter one.
		expect(stops[0].l).toBeCloseTo(0.82, 1);
		expect(stops[1].l).toBeCloseTo(0.46, 1);
		expect(stops[0].l).toBeGreaterThan(stops[1].l);
	});
});

describe("formatOklch", () => {
	it("formats correctly", () => {
		expect(formatOklch(0.5, 0.15, 260)).toBe("oklch(0.5 0.15 260)");
	});
});

describe("generateColorVariables", () => {
	const errorDef = FIXTURE_COLORS["error"] as Extract<
		(typeof FIXTURE_COLORS)["error"],
		{ type: "generative" }
	>;
	const infoDef = FIXTURE_COLORS["info"] as Extract<
		(typeof FIXTURE_COLORS)["info"],
		{ type: "generative" }
	>;

	it("generates light-dark() pairs in auto mode", () => {
		const vars = generateColorVariables("error", errorDef, TEST_SUFFIXES);

		expect(vars).toHaveLength(19);
		expect(vars[0]).toMatch(/^--color-error-50: light-dark\(/);
		expect(vars[0]).toContain("light-dark(");
	});

	it("generates plain values in off mode", () => {
		const vars = generateColorVariables("error", errorDef, TEST_SUFFIXES, {
			...DEFAULT_DARK_CONFIG,
			mode: "off",
		});

		expect(vars[0]).toMatch(/^--color-error-50: oklch\(/);
		expect(vars[0]).not.toContain("light-dark");
	});

	it("fixed strategy mirrors the light value into both light-dark() slots", () => {
		const vars = generateColorVariables("error", errorDef, [300], DEFAULT_DARK_CONFIG, {
			strategy: "fixed",
		});
		const match = vars[0].match(/^--color-error-300: light-dark\((.+), (.+)\);$/);
		expect(match).not.toBeNull();
		expect(match![1]).toBe(match![2]);
		// The light value is generateStop(300) directly (no mirror), identical to auto mode's light side.
		const auto = generateColorVariables("error", errorDef, [300], DEFAULT_DARK_CONFIG);
		expect(auto[0].startsWith(`--color-error-300: light-dark(${match![1]},`)).toBe(true);
	});

	it("dark lightness equals the mirror stop's light lightness", () => {
		// Luminance mirror: the dark value at N has the light lightness of token 1000-N.
		const darkOf100 = generateColorVariables("info", infoDef, [100])[0].match(
			/light-dark\(oklch\([^)]+\), oklch\(([\d.]+) /,
		);
		const lightOf900 = generateColorVariables("info", infoDef, [900])[0].match(
			/light-dark\(oklch\(([\d.]+) /,
		);
		expect(darkOf100?.[1]).toBe(lightOf900?.[1]);
	});

	it("generates variables for arbitrary suffix like 276", () => {
		const vars = generateColorVariables("error", errorDef, [276]);
		expect(vars).toHaveLength(1);
		expect(vars[0]).toMatch(/^--color-error-276: light-dark\(/);
		// Should contain two oklch values (light and dark)
		const matches = vars[0].match(/oklch\([\d.]+ [\d.]+ [\d.]+\)/g);
		expect(matches).toHaveLength(2);
	});
});

describe("dark mode (same tone, mirrored luminance)", () => {
	function parsePair(v: string) {
		const m = v.match(
			/light-dark\(oklch\(([\d.]+) ([\d.]+) ([\d.-]+)\), oklch\(([\d.]+) ([\d.]+) ([\d.-]+)\)\)/,
		);
		if (!m) throw new Error(`unparseable pair: ${v}`);
		return {
			light: [Number(m[1]), Number(m[2]), Number(m[3])] as const,
			dark: [Number(m[4]), Number(m[5]), Number(m[6])] as const,
		};
	}

	it("dark luminance mirrors light: darkL(N) equals lightL(1000-N)", () => {
		// Reverse-aligning the two modes, each token's dark lightness equals the light
		// lightness of its mirror token — so the modes share one luminance ramp and
		// neither mode reads lighter than the other.
		const def = FIXTURE_COLORS["theme"] as Extract<ColorDefinition, { type: "generative" }>;
		for (const n of [25, 100, 300, 500, 700, 900, 975]) {
			const darkL = parsePair(generateColorVariables("theme", def, [n])[0]).dark[0];
			const mirrorLightL = parsePair(generateColorVariables("theme", def, [1000 - n])[0]).light[0];
			expect(darkL).toBeCloseTo(mirrorLightL, 5);
		}
	});

	it("keeps the light stop's chroma and hue in dark mode (same tone)", () => {
		// Low-chroma palette: the chroma fits in gamut at every mirrored lightness,
		// so each token is the SAME tone (chroma + hue) in both modes, just light↔dark.
		const def: ColorDefinition = { type: "generative", chroma: 0.05, hue: 92 };
		for (const n of [50, 100, 300, 500, 700, 900, 950]) {
			const { light, dark } = parsePair(generateColorVariables("ex", def, [n])[0]);
			expect(dark[1]).toBe(light[1]); // same chroma
			expect(dark[2]).toBe(light[2]); // same hue
		}
	});

	it("perceived contrast translates evenly between modes (even-APCA spacing)", () => {
		// The core fix: a token pair reads with ~equal perceived contrast in both modes.
		// e.g. theme-50 / theme-150 squares on a theme-100 surface.
		const ramp = (yFg: number, yBg: number) => {
			const s = yBg > yFg ? yBg ** 0.56 - yFg ** 0.57 : yBg ** 0.65 - yFg ** 0.62;
			return Math.abs(s) * 1.14 * 100;
		};
		const def = FIXTURE_COLORS["theme"] as Extract<ColorDefinition, { type: "generative" }>;
		const bg = parsePair(generateColorVariables("theme", def, [100])[0]);
		for (const sq of [50, 150, 250]) {
			const p = parsePair(generateColorVariables("theme", def, [sq])[0]);
			const lightC = ramp(oklchToApcaY(p.light[0], 0, 0), oklchToApcaY(bg.light[0], 0, 0));
			const darkC = ramp(oklchToApcaY(p.dark[0], 0, 0), oklchToApcaY(bg.dark[0], 0, 0));
			expect(Math.abs(lightC - darkC)).toBeLessThanOrEqual(2);
		}
	});

	it("dark-mode lightness is monotonic in suffix", () => {
		const suffixes = [100, 200, 300, 400, 500, 600, 700, 800, 900];
		const vars = generateColorVariables("info", FIXTURE_COLORS["info"], suffixes);
		let prev = -1;
		for (const v of vars) {
			const { dark } = parsePair(v);
			expect(dark[0]).toBeGreaterThanOrEqual(prev);
			prev = dark[0];
		}
	});

	it("dark base hugs black (visible) and dark text reaches near-white", () => {
		const def = FIXTURE_COLORS["theme"] as Extract<ColorDefinition, { type: "generative" }>;
		// theme-25 in dark mode = the darkest usable surface: a visible near-black.
		const low = parsePair(generateColorVariables("theme", def, [25])[0]).dark[0];
		expect(low).toBeGreaterThan(0.005); // not crushed to pure black
		expect(low).toBeLessThan(0.06); // hugs the black page
		// theme-975 in dark mode = the lightest text: near-white.
		const high = parsePair(generateColorVariables("theme", def, [975])[0]).dark[0];
		expect(high).toBeGreaterThan(0.95);
	});

	it("light and dark ramps change smoothly between adjacent suffixes (no cliffs)", () => {
		// Adjacent stops differ by a small, bounded lightness step in both modes,
		// across the full 1-999 range — the ramp and its reversal are continuous.
		const suffixes = Array.from({ length: 999 }, (_, i) => i + 1);
		for (const name of ["theme", "info"]) {
			const def = FIXTURE_COLORS[name] as Extract<ColorDefinition, { type: "generative" }>;
			const vars = generateColorVariables(name, def, suffixes);
			let prevLight = Number.NaN;
			let prevDark = Number.NaN;
			for (const v of vars) {
				const { light, dark } = parsePair(v);
				if (!Number.isNaN(prevDark)) {
					expect(Math.abs(dark[0] - prevDark), `dark step at ${v}`).toBeLessThanOrEqual(0.03);
					expect(Math.abs(light[0] - prevLight), `light step at ${v}`).toBeLessThanOrEqual(0.03);
				}
				prevLight = light[0];
				prevDark = dark[0];
			}
		}
	});
});

describe("SEMANTIC_COLORS", () => {
	it("contains paper and ink", () => {
		expect(SEMANTIC_COLORS).toHaveLength(2);
		expect(SEMANTIC_COLORS[0]).toContain("--color-paper");
		expect(SEMANTIC_COLORS[1]).toContain("--color-ink");
	});

	it("paper is white-in-light, black-in-dark", () => {
		expect(SEMANTIC_COLORS[0]).toContain("light-dark(oklch(1 0 0), oklch(0 0 0))");
	});

	it("ink is black-in-light, white-in-dark", () => {
		expect(SEMANTIC_COLORS[1]).toContain("light-dark(oklch(0 0 0), oklch(1 0 0))");
	});
});

describe("generateAllColorVariables", () => {
	it("generates only used color stops + semantics", () => {
		const stops = new Map<string, Set<number>>([
			["error", new Set([500])],
			["info", new Set([200, 800])],
		]);
		const vars = generateAllColorVariables(FIXTURE_COLORS, DEFAULT_DARK_CONFIG, stops);
		// 2 semantic (paper, ink) + 1 error stop + 2 info stops = 5
		expect(vars).toHaveLength(5);
	});

	it("first two are paper and ink", () => {
		const vars = generateAllColorVariables(FIXTURE_COLORS, DEFAULT_DARK_CONFIG, new Map());
		expect(vars[0]).toContain("--color-paper");
		expect(vars[1]).toContain("--color-ink");
	});

	it("generates no palette vars when no stops are used", () => {
		const vars = generateAllColorVariables(FIXTURE_COLORS, DEFAULT_DARK_CONFIG, new Map());
		// Only semantic colors
		expect(vars).toHaveLength(2);
	});

	it("includes specific stop numbers in output", () => {
		const stops = new Map<string, Set<number>>([["error", new Set([276, 500])]]);
		const vars = generateAllColorVariables(FIXTURE_COLORS, DEFAULT_DARK_CONFIG, stops);
		const text = vars.join("\n");
		expect(text).toContain("--color-error-276:");
		expect(text).toContain("--color-error-500:");
		expect(text).not.toContain("--color-error-100:");
	});
});

describe("generateAllColorVariables — non-generative aliases", () => {
	it("aliases a pair color via var()", () => {
		const vars = generateAllColorVariables(
			{
				"ri-blue": {
					type: "pair",
					light: "oklch(0.59 0.08 250)",
					dark: "oklch(0.69 0.07 246)",
				},
				"code-keyword": { type: "alias", source: "ri-blue" },
			},
			DEFAULT_DARK_CONFIG,
			new Map(),
		);
		expect(vars).toContainEqual("--color-code-keyword: var(--color-ri-blue);");
	});

	it("aliases an explicit color via var()", () => {
		const vars = generateAllColorVariables(
			{
				accent: { type: "explicit", value: "oklch(0.7 0.2 300)" },
				highlight: { type: "alias", source: "accent" },
			},
			DEFAULT_DARK_CONFIG,
			new Map(),
		);
		expect(vars).toContainEqual("--color-highlight: var(--color-accent);");
	});

	it("aliases a keyword color via var()", () => {
		const vars = generateAllColorVariables(
			{
				clear: { type: "keyword", value: "transparent" },
				overlay: { type: "alias", source: "clear" },
			},
			DEFAULT_DARK_CONFIG,
			new Map(),
		);
		expect(vars).toContainEqual("--color-overlay: var(--color-clear);");
	});

	it("aliases a generative color with specific suffixes", () => {
		const vars = generateAllColorVariables(
			{
				brand: { type: "generative", chroma: 0.18, hue: 330 },
				accent: { type: "alias", source: "brand" },
			},
			DEFAULT_DARK_CONFIG,
			new Map([
				["brand", new Set([500])],
				["accent", new Set([500, 700])],
			]),
		);
		const text = vars.join("\n");
		expect(text).toContain("--color-brand-500:");
		expect(text).toContain("--color-accent-500: var(--color-brand-500);");
		expect(text).toContain("--color-accent-700: var(--color-brand-700);");
	});
});

describe("oklchToApcaY", () => {
	it("white has Y close to 1", () => {
		expect(oklchToApcaY(1, 0, 0)).toBeCloseTo(1, 2);
	});

	it("black has Y close to 0", () => {
		expect(oklchToApcaY(0, 0, 0)).toBeCloseTo(0, 2);
	});

	it("brighter OKLCH L produces higher Y", () => {
		expect(oklchToApcaY(0.8, 0, 0)).toBeGreaterThan(oklchToApcaY(0.3, 0, 0));
	});
});

describe("apcaContrast", () => {
	it("black-text-on-white returns positive Lc near 106", () => {
		// APCA peak for max contrast (per Myndex reference) is ~106 for black on white.
		const yBlack = oklchToApcaY(0, 0, 0);
		const yWhite = oklchToApcaY(1, 0, 0);
		const lc = apcaContrast(yBlack, yWhite);
		expect(lc).toBeGreaterThan(100);
		expect(lc).toBeLessThan(112);
	});

	it("white-text-on-black returns negative Lc near -108", () => {
		const yBlack = oklchToApcaY(0, 0, 0);
		const yWhite = oklchToApcaY(1, 0, 0);
		const lc = apcaContrast(yWhite, yBlack);
		expect(lc).toBeLessThan(-100);
		expect(lc).toBeGreaterThan(-112);
	});

	it("identical colors return 0", () => {
		const y = oklchToApcaY(0.5, 0, 0);
		expect(apcaContrast(y, y)).toBe(0);
	});

	it("polarity flips sign", () => {
		const yDark = oklchToApcaY(0.2, 0, 0);
		const yLight = oklchToApcaY(0.8, 0, 0);
		expect(apcaContrast(yDark, yLight)).toBeGreaterThan(0);
		expect(apcaContrast(yLight, yDark)).toBeLessThan(0);
	});

	it("low-contrast pair returns 0 (below loClip)", () => {
		const y1 = oklchToApcaY(0.5, 0, 0);
		const y2 = oklchToApcaY(0.51, 0, 0);
		expect(Math.abs(apcaContrast(y1, y2))).toBeLessThan(10);
	});
});

describe("checkPaletteContrast", () => {
	it("returns no warnings when usedColorStops is empty", () => {
		const result = checkPaletteContrast(FIXTURE_COLORS, new Map());
		expect(result).toEqual([]);
	});

	it("ignores non-generative colors entirely", () => {
		const colors: Record<string, ColorDefinition> = {
			brand: { type: "explicit", value: "oklch(0.5 0.1 100)" },
			alias: { type: "alias", source: "brand" },
			pair: { type: "pair", light: "oklch(0.5 0 0)", dark: "oklch(0.5 0 0)" },
		};
		const used = new Map<string, Set<number>>([
			["brand", new Set([500])],
			["alias", new Set([500])],
			["pair", new Set([500])],
		]);
		expect(checkPaletteContrast(colors, used)).toEqual([]);
	});

	it("fires RI-1106 for a stop unusable as text on both poles", () => {
		// Under the example ramp, pure gray's worst-case APCA band sits near L≈0.70
		// (suffix ~450): both LcVsPaper and LcVsInk land in the low 50s — below the default 60.
		const colors: Record<string, ColorDefinition> = {
			fog: { type: "generative", chroma: 0, hue: 0 },
		};
		const used = new Map<string, Set<number>>([["fog", new Set([450])]]);
		const result = checkPaletteContrast(colors, used);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatch(/^\[RI-1106\]/);
		expect(result[0]).toContain('"fog-450"');
	});

	it("does NOT fire for the text-friendly stops 50/100/900/950 in default colors", () => {
		// These suffixes anchor each default color in the high-contrast extremes
		// where APCA easily passes the medium-text threshold against one polar bg.
		const used = new Map<string, Set<number>>();
		for (const name of Object.keys(FIXTURE_COLORS)) {
			used.set(name, new Set([50, 100, 900, 950]));
		}
		const result = checkPaletteContrast(FIXTURE_COLORS, used);
		expect(result).toEqual([]);
	});

	it("honors a custom minLc threshold", () => {
		// At threshold 90 (preferred body text), a mid-light gray that comfortably
		// passes the default 60 will instead warn.
		const colors: Record<string, ColorDefinition> = {
			fog: { type: "generative", chroma: 0, hue: 0 },
		};
		const used = new Map<string, Set<number>>([["fog", new Set([600])]]);
		const lax = checkPaletteContrast(colors, used);
		const strict = checkPaletteContrast(colors, used, { minLc: 90 });
		expect(lax).toEqual([]);
		expect(strict.length).toBeGreaterThan(0);
	});

	it("DEFAULT_PALETTE_CONTRAST_LC is the documented medium-text level", () => {
		expect(DEFAULT_PALETTE_CONTRAST_LC).toBe(60);
	});

	it("warning text includes the per-pole Lc values for actionable feedback", () => {
		const colors: Record<string, ColorDefinition> = {
			fog: { type: "generative", chroma: 0, hue: 0 },
		};
		const used = new Map<string, Set<number>>([["fog", new Set([450])]]);
		const [warning] = checkPaletteContrast(colors, used);
		expect(warning).toMatch(/paper \d+/);
		expect(warning).toMatch(/ink \d+/);
		expect(warning).toMatch(/best \|Lc\| \d+/);
	});

	it("emits stops in ascending suffix order for deterministic output", () => {
		// Multiple stops in the low-contrast band — output order must not depend
		// on Set iteration order, which is otherwise insertion-based.
		const colors: Record<string, ColorDefinition> = {
			fog: { type: "generative", chroma: 0, hue: 0 },
		};
		const used = new Map<string, Set<number>>([["fog", new Set([450, 400, 425])]]);
		const result = checkPaletteContrast(colors, used);
		expect(result.length).toBeGreaterThanOrEqual(2);
		const suffixes = result.map((w) => Number(w.match(/fog-(\d+)/)?.[1]));
		expect(suffixes).toEqual([...suffixes].sort((a, b) => a - b));
	});
});

describe("color vision deficiency (deuteranopia) distinguishability", () => {
	// Viénot-Brettel-Mollon 1999 simplified linear-RGB matrix for deuteranopia.
	function simulateDeuteranopia(r: number, g: number, b: number): [number, number, number] {
		return [
			0.625 * r + 0.375 * g + 0.0 * b,
			0.7 * r + 0.3 * g + 0.0 * b,
			0.0 * r + 0.3 * g + 0.7 * b,
		];
	}

	// Inverse of oklabToLinearSrgb — Ottosson 2020 forward matrices.
	function linearSrgbToOklab(r: number, g: number, b: number): [number, number, number] {
		const lv = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
		const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
		const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
		const l_ = Math.cbrt(lv);
		const m_ = Math.cbrt(m);
		const s_ = Math.cbrt(s);
		return [
			0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
			1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
			0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
		];
	}

	function deuteranopiaOklab(l: number, c: number, h: number): [number, number, number] {
		const [la, a, b] = oklchToOklab(l, c, h);
		const [lr, lg, lb] = oklabToLinearSrgb(la, a, b);
		const [dr, dg, db] = simulateDeuteranopia(
			Math.max(0, Math.min(1, lr)),
			Math.max(0, Math.min(1, lg)),
			Math.max(0, Math.min(1, lb)),
		);
		return linearSrgbToOklab(dr, dg, db);
	}

	function oklabDistance(a: [number, number, number], b: [number, number, number]): number {
		return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
	}

	it("info, success, and general remain pairwise distinct under deuteranopia at suffix 600", () => {
		// info (blue, 222°), success (green, 154°), general (magenta, 296°) span
		// the blue↔yellow axis that deuteranopes preserve. They should remain
		// clearly distinguishable.
		const names = ["info", "success", "general"];
		const labs = names.map((n) => {
			const def = FIXTURE_COLORS[n] as Extract<ColorDefinition, { type: "generative" }>;
			const stop = generateStop(def, 600);
			return { name: n, lab: deuteranopiaOklab(stop.l, stop.c, stop.h) };
		});

		const MIN_DISTANCE = 0.04; // ~1 OKLab JND
		for (let i = 0; i < labs.length; i++) {
			for (let j = i + 1; j < labs.length; j++) {
				const d = oklabDistance(labs[i].lab, labs[j].lab);
				expect(d, `${labs[i].name} ↔ ${labs[j].name} distance ${d.toFixed(3)}`).toBeGreaterThan(
					MIN_DISTANCE,
				);
			}
		}
	});

	it("warm-end semantic colors (error/warning/alert) collide under deuteranopia at matched suffix — regression watch", () => {
		// Documents the known limitation: error (red 32°), warning (amber 62°), and
		// alert (yellow-green 103°) collapse onto the same deuteranope confusion line
		// at the same lightness. Anyone relying on these for distinct meaning must
		// add a non-color signal (icon, lightness offset, position).
		const ed = FIXTURE_COLORS["error"] as Extract<ColorDefinition, { type: "generative" }>;
		const wd = FIXTURE_COLORS["warning"] as Extract<ColorDefinition, { type: "generative" }>;
		const ad = FIXTURE_COLORS["alert"] as Extract<ColorDefinition, { type: "generative" }>;

		const e = generateStop(ed, 600);
		const w = generateStop(wd, 600);
		const a = generateStop(ad, 600);

		const eLab = deuteranopiaOklab(e.l, e.c, e.h);
		const wLab = deuteranopiaOklab(w.l, w.c, w.h);
		const aLab = deuteranopiaOklab(a.l, a.c, a.h);

		// They are far less distinguishable than the cross-axis triplet above.
		// We assert the actual ceiling so a future "fix" that improves separation
		// surfaces here and prompts a refresh of the documentation/guidance.
		const minPairwise = Math.min(
			oklabDistance(eLab, wLab),
			oklabDistance(wLab, aLab),
			oklabDistance(eLab, aLab),
		);
		expect(minPairwise).toBeLessThan(0.15);
	});
});
