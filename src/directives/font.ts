/**
 * @font body grammar — slot declarations built from one entry shape.
 *
 * A slot is `<preamble> [{ <body> }]`. The preamble is `system` or a font
 * stack (`"Inter", ui-sans-serif`) optionally followed by `from google`. The
 * body holds slot options (`features`, `variation`, `metrics`), inherited
 * face defaults (`weight`, `style`, `display`, `unicode-range`, `preload`),
 * and repeatable `face: <src> [{ overrides }]` entries for local files.
 *
 * Everything is scanned once via the shared `scanEntries` grammar — no
 * regex preambles, no re-serialization. Removed pre-0.5 forms (`@face`
 * blocks, `italic:`, `from "<path>"`, `from system`, `fallback:`, the
 * five-key metrics cluster, `unicodeRange`, `subset`) still parse for now:
 * they desugar into the new model and warn RI-1218 with the replacement.
 */

import {
	type FontFace,
	type FontMetricsConfig,
	type FontSlot,
	createFontFace,
	createFontSlot,
	SAFE_FONT_FAMILY_CHARS,
	SAFE_FONT_FAMILY_RE,
} from "../integrations/font-providers/model.js";
import {
	findClosingBrace,
	IDENT_KEY_RE,
	parseKeyValueBody,
	scanEntries,
	topLevelIndexOf,
} from "./foundation.js";
import { stripCSSComments } from "../shared.js";

/** Strips characters outside the shared font-family trust boundary
 *  (defense-in-depth against CSS injection). */
const UNSAFE_FONT_FAMILY_CHARS_RE = new RegExp(`[^${SAFE_FONT_FAMILY_CHARS}]`, "g");

/** Maximum number of font configs allowed in @font block to bound fetch requests. */
const MAX_FONT_CONFIGS = 20;

type FontEntry = [string, string];

/** Accepted truthy spellings for boolean font options (e.g. `preload: yes`). */
const TRUTHY_FONT_VALUES = new Set(["true", "yes", "on"]);

/** Grammar-level unquoting for families, paths, and option values. */
function stripQuotes(s: string): string {
	return s.replace(/["']/g, "");
}

/** Strip characters disallowed in a font family name (defense-in-depth against CSS injection). */
function sanitizeFamily(family: string): string {
	return family.replace(UNSAFE_FONT_FAMILY_CHARS_RE, "");
}

/** Run fallback stack entries through the family trust boundary — same
 *  CSS-injection defense as the primary family, applied per entry. */
function sanitizeFallbacks(parts: readonly string[]): string[] {
	return parts
		.map((s) => (SAFE_FONT_FAMILY_RE.test(s) ? s : sanitizeFamily(s).trim()))
		.filter((s) => s.length > 0);
}

/** True when a value would break out of its emitted CSS declaration: a `}`
 *  outside quotes, an unbalanced quote, or a control character. Content inside
 *  balanced quotes is inert in the emitted CSS string. */
function isUnsafeCSSValue(value: string): boolean {
	if (value.includes("\0")) return true;
	for (let i = 0; i < value.length; i++) {
		const c = value[i];
		if (c === '"' || c === "'") {
			i++;
			while (i < value.length && value[i] !== c) {
				if (value[i] === "\\") i++;
				i++;
			}
			if (i >= value.length) return true; // unbalanced quote
			continue;
		}
		if (c === "}") return true;
	}
	return false;
}

/** Warn (RI-1217) and report true when a value can't be emitted safely. */
function dropUnsafeValue(key: string, value: string, slot: string, warnings?: string[]): boolean {
	if (!isUnsafeCSSValue(value)) return false;
	warnings?.push(
		`[RI-1217] @font option "${key}" in slot "${slot}" has a value that can't be emitted safely into CSS — the entry was ignored.`,
	);
	return true;
}

function warnDeprecated(
	warnings: string[] | undefined,
	slot: string,
	oldForm: string,
	replacement: string,
): void {
	warnings?.push(
		`[RI-1218] @font slot "${slot}": ${oldForm} is deprecated — ${replacement}. The old form still works but will be removed.`,
	);
}

// ---------------------------------------------------------------------------
// Preamble — `system` | `<family>[, <fallback>…] [from google]`
// ---------------------------------------------------------------------------

interface Preamble {
	system?: true;
	family: string;
	fallback: string[];
	google?: true;
	/** Desugared `from "<path>"` source (deprecated form). */
	legacyFaceSrc?: string;
}

/** Index of the last whitespace-delimited `from` keyword outside quotes, or -1.
 *  Expects whitespace-collapsed input. */
function topLevelFromIndex(s: string): number {
	let last = -1;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === '"' || c === "'") {
			i++;
			while (i < s.length && s[i] !== c) {
				if (s[i] === "\\") i++;
				i++;
			}
			continue;
		}
		if (c === "f" && i > 0 && s[i - 1] === " " && s.startsWith("from ", i)) last = i;
	}
	return last;
}

/** Split on top-level commas (outside quotes/parens), reusing topLevelIndexOf. */
function splitTopLevelCommas(s: string): string[] {
	const parts: string[] = [];
	let rest = s;
	for (;;) {
		const i = topLevelIndexOf(rest, ",");
		if (i === -1) {
			parts.push(rest);
			return parts;
		}
		parts.push(rest.slice(0, i));
		rest = rest.slice(i + 1);
	}
}

function parsePreamble(text: string, slot: string, warnings?: string[]): Preamble {
	const pre = text.replace(/\s+/g, " ").trim();
	if (pre === "system") return { system: true, family: "", fallback: [] };

	let stackText = pre;
	let provider: string | undefined;
	const fromIdx = topLevelFromIndex(pre);
	if (fromIdx !== -1) {
		const tail = stripQuotes(pre.slice(fromIdx + 4).trim());
		if (tail) {
			provider = tail;
			stackText = pre.slice(0, fromIdx).trim();
		}
	}

	const parts = splitTopLevelCommas(stackText).map((s) => stripQuotes(s.trim()).trim());
	const family = parts[0] ?? "";
	const fallback = sanitizeFallbacks(parts.slice(1));

	if (provider === undefined || provider === "google") {
		return provider === "google" ? { family, fallback, google: true } : { family, fallback };
	}
	if (provider === "system") {
		warnDeprecated(warnings, slot, "`from system`", "use the bare `system` keyword");
		return { system: true, family: "", fallback: [] };
	}
	warnDeprecated(
		warnings,
		slot,
		`\`from "${provider}"\``,
		`declare the file as a face entry (\`face: ${provider};\`)`,
	);
	return { family, fallback, legacyFaceSrc: provider };
}

// ---------------------------------------------------------------------------
// metrics: value — `none` | `"<local font>"` | `["<local font>"] N N N N`
// ---------------------------------------------------------------------------

function parseMetricsValue(
	value: string,
	slot: string,
	warnings?: string[],
): FontMetricsConfig | null | undefined {
	if (value === "none") return null;
	const tokens = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
	const familyParts: string[] = [];
	const nums: number[] = [];
	let malformed = false;
	for (const t of tokens) {
		const n = Number.parseFloat(t);
		if (Number.isNaN(n)) {
			if (nums.length > 0) {
				malformed = true;
				break;
			}
			familyParts.push(stripQuotes(t));
		} else {
			nums.push(n);
		}
	}
	const fallbackName = familyParts.join(" ").trim();
	if (
		malformed ||
		(nums.length !== 0 && nums.length !== 4) ||
		(familyParts.length > 0 && fallbackName === "")
	) {
		warnings?.push(
			`[RI-1220] @font slot "${slot}" has an invalid metrics value "${value}" — use \`metrics: none\`, \`metrics: "<local font>"\`, or \`metrics: "<local font>" <size-adjust> <ascent> <descent> <line-gap>\` (four percentages). The entry was ignored.`,
		);
		return undefined;
	}
	const cfg: FontMetricsConfig = {};
	if (fallbackName) cfg.fallback = fallbackName;
	if (nums.length === 4) {
		cfg.sizeAdjust = nums[0];
		cfg.ascent = nums[1];
		cfg.descent = nums[2];
		cfg.lineGap = nums[3];
	}
	return cfg;
}

// ---------------------------------------------------------------------------
// Face options
// ---------------------------------------------------------------------------

/** Rewrite deprecated face keys to their current spellings (drops `subset`). */
function normalizeFaceEntries(
	entries: readonly FontEntry[],
	slot: string,
	warnings?: string[],
): FontEntry[] {
	const out: FontEntry[] = [];
	for (const [key, value] of entries) {
		if (key === "unicodeRange") {
			warnDeprecated(warnings, slot, "`unicodeRange:`", "use the CSS spelling `unicode-range:`");
			out.push(["unicode-range", value]);
		} else if (key === "subset") {
			warnDeprecated(
				warnings,
				slot,
				"`subset:`",
				"remove the entry (the Google css2 API takes no subset hint)",
			);
		} else {
			out.push([key, value]);
		}
	}
	return out;
}

/** Apply face options — slot-body entries act as defaults for every face,
 *  a `face:` entry's own block overrides them. Expects normalized keys. */
function applyFaceOptions(
	face: FontFace,
	entries: readonly FontEntry[],
	slot: string,
	warnings?: string[],
): void {
	for (const [key, value] of entries) {
		if (dropUnsafeValue(key, value, slot, warnings)) continue;
		switch (key) {
			case "weight":
				face.weight = value;
				face._weightExplicit = true;
				break;
			case "style":
				face.style = value;
				face._styleExplicit = true;
				break;
			case "display":
				face.display = value;
				break;
			case "unicode-range":
				face.unicodeRange = value;
				break;
			case "preload":
				face.preload = TRUTHY_FONT_VALUES.has(value);
				break;
			case "src":
				warnings?.push(
					`[RI-1217] Unknown @font option "src" in slot "${slot}" — the face source is the face: value itself (\`face: /path.woff2 { … }\`). The entry was ignored.`,
				);
				break;
			default:
				warnings?.push(
					`[RI-1217] Unknown @font option "${key}" in slot "${slot}" — the entry was ignored.`,
				);
				break;
		}
	}
}

// ---------------------------------------------------------------------------
// Slot body
// ---------------------------------------------------------------------------

interface FaceDecl {
	src: string;
	entries: FontEntry[];
}

interface SlotBody {
	faceDefaults: FontEntry[];
	faces: FaceDecl[];
	features?: string;
	variation?: string;
	fallbackOverride?: string[];
	metrics?: FontMetricsConfig | null;
	legacyMetrics: FontEntry[];
}

const LEGACY_METRICS_KEYS = new Set([
	"metricsFallback",
	"sizeAdjust",
	"ascent",
	"descent",
	"lineGap",
]);

function parseSlotBody(body: string, slot: string, warnings?: string[]): SlotBody {
	const out: SlotBody = { faceDefaults: [], faces: [], legacyMetrics: [] };
	for (const entry of scanEntries(body, { newlineTerminates: true })) {
		if (entry.unclosedBlock) {
			warnings?.push(
				`[RI-1217] @font slot "${slot}" has an unterminated { block after "${entry.key || entry.value}" — the entry was ignored.`,
			);
			continue;
		}
		if (entry.fragment) {
			// Legacy `@face { src: …; … }` sub-block — desugar into a face entry.
			if (entry.value === "@face" && entry.block !== undefined) {
				warnDeprecated(warnings, slot, "`@face { src: …; }`", "use `face: <src> { … }`");
				let src = "";
				const own: FontEntry[] = [];
				for (const [k, v] of parseKeyValueBody(entry.block, warnings, "font").entries) {
					if (k === "src") src = stripQuotes(v);
					else own.push([k, v]);
				}
				out.faces.push({ src, entries: own });
			} else if (entry.value) {
				warnings?.push(
					`[RI-1217] @font slot "${slot}" has a stray value "${entry.value.slice(0, 60)}" with no key — if it continues the previous entry's value, keep the entry on one line. The text was ignored.`,
				);
			}
			continue;
		}
		if (entry.removal || !entry.key) continue;
		if (!IDENT_KEY_RE.test(entry.key)) {
			warnings?.push(
				`[RI-1035] Invalid @font entry key "${entry.key}" — keys may only contain letters, numbers, hyphens, and underscores. The entry was skipped.`,
			);
			continue;
		}
		if (entry.block !== undefined && entry.key !== "face") {
			warnings?.push(
				`[RI-1217] @font option "${entry.key}" in slot "${slot}" takes no { … } block — the block was ignored.`,
			);
		}
		if (entry.key === "face" && !entry.value) {
			warnings?.push(
				`[RI-1217] @font slot "${slot}" has a face: entry with no source — use \`face: <src> [{ … }]\`. The entry was ignored.`,
			);
			continue;
		}
		if (!entry.value) continue;

		if (LEGACY_METRICS_KEYS.has(entry.key)) {
			out.legacyMetrics.push([entry.key, entry.value]);
			continue;
		}
		switch (entry.key) {
			case "face":
				out.faces.push({
					src: stripQuotes(entry.value),
					entries:
						entry.block !== undefined
							? parseKeyValueBody(entry.block, warnings, "font").entries
							: [],
				});
				break;
			case "features":
				if (!dropUnsafeValue(entry.key, entry.value, slot, warnings)) out.features = entry.value;
				break;
			case "variation":
				if (!dropUnsafeValue(entry.key, entry.value, slot, warnings)) out.variation = entry.value;
				break;
			case "metrics": {
				const cfg = parseMetricsValue(entry.value, slot, warnings);
				if (cfg !== undefined) out.metrics = cfg;
				break;
			}
			case "weight":
			case "style":
			case "display":
			case "unicode-range":
			case "preload":
				out.faceDefaults.push([entry.key, entry.value]);
				break;
			case "italic":
				warnDeprecated(warnings, slot, "`italic: <src>`", "use `face: <src> { style: italic; }`");
				out.faces.push({ src: stripQuotes(entry.value), entries: [["style", "italic"]] });
				break;
			case "fallback":
				warnDeprecated(
					warnings,
					slot,
					"`fallback:`",
					'list fallbacks after the family in the slot preamble (`sans: "Inter", ui-sans-serif from google;`)',
				);
				out.fallbackOverride = sanitizeFallbacks(
					splitTopLevelCommas(entry.value).map((s) => stripQuotes(s.trim()).trim()),
				);
				break;
			case "unicodeRange":
				warnDeprecated(warnings, slot, "`unicodeRange:`", "use the CSS spelling `unicode-range:`");
				out.faceDefaults.push(["unicode-range", entry.value]);
				break;
			case "subset":
				warnDeprecated(
					warnings,
					slot,
					"`subset:`",
					"remove the entry (the Google css2 API takes no subset hint)",
				);
				break;
			default:
				warnings?.push(
					`[RI-1217] Unknown @font option "${entry.key}" in slot "${slot}" — the entry was ignored.`,
				);
				break;
		}
	}
	foldLegacyMetrics(out, slot, warnings);
	return out;
}

/** Fold the removed five-key metrics cluster into a `metrics` config. */
function foldLegacyMetrics(body: SlotBody, slot: string, warnings?: string[]): void {
	if (body.legacyMetrics.length === 0) return;
	warnDeprecated(
		warnings,
		slot,
		"the metricsFallback/sizeAdjust/ascent/descent/lineGap keys",
		'use the single `metrics:` key (e.g. `metrics: "Arial" 107.64 90.49 22.48 0;`) or omit it for automatic metrics',
	);
	if (body.metrics !== undefined) return; // the new key wins
	const cfg: FontMetricsConfig = {};
	for (const [key, value] of body.legacyMetrics) {
		if (key === "metricsFallback") {
			cfg.fallback = stripQuotes(value);
		} else {
			const n = Number.parseFloat(value);
			if (!Number.isNaN(n)) cfg[key as "sizeAdjust" | "ascent" | "descent" | "lineGap"] = n;
		}
	}
	const numeric = [cfg.sizeAdjust, cfg.ascent, cfg.descent, cfg.lineGap].filter(
		(n) => n !== undefined,
	).length;
	if (numeric === 4 || (numeric === 0 && cfg.fallback !== undefined)) {
		body.metrics = cfg;
	} else if (numeric > 0) {
		warnings?.push(
			`[RI-1220] @font slot "${slot}" sets only ${numeric} of the four metric overrides — size-adjust, ascent, descent, and line-gap are all required. The values were ignored (automatic metrics still apply).`,
		);
	}
}

// ---------------------------------------------------------------------------
// Slot assembly
// ---------------------------------------------------------------------------

function buildFace(
	provider: string,
	defaults: readonly FontEntry[],
	slot: string,
	warnings?: string[],
	own?: readonly FontEntry[],
): FontFace {
	const face = createFontFace({ provider });
	applyFaceOptions(face, defaults, slot, warnings);
	if (own) applyFaceOptions(face, own, slot, warnings);
	return face;
}

/** Warn (RI-1214) when a slot has two faces sharing the same weight+style. */
function warnDuplicateFaces(slot: FontSlot, warnings?: string[]): void {
	if (!warnings || slot.faces.length < 2) return;
	const seen = new Set<string>();
	for (const face of slot.faces) {
		const key = `${face.weight}|${face.style}`;
		if (seen.has(key)) {
			warnings.push(
				`[RI-1214] @font slot "${slot.slot}" has duplicate faces with weight "${face.weight}" and style "${face.style}" — the later @font-face wins. Remove the duplicate or give it a distinct weight/style.`,
			);
		}
		seen.add(key);
	}
}

/** Build one FontSlot from a preamble and an optional body block. */
function buildSlot(
	slot: string,
	preambleText: string,
	blockBody: string | undefined,
	warnings?: string[],
): FontSlot {
	const pre = parsePreamble(preambleText, slot, warnings);
	// The body is scanned even for slots that ignore it (system, unsafe family)
	// so its diagnostics — deprecations, unknown keys, metrics problems — fire.
	const body = parseSlotBody(blockBody ?? "", slot, warnings);
	const preloadDefault = body.faceDefaults.some(([k]) => k === "preload");

	if (pre.system) {
		if (preloadDefault) {
			warnings?.push(
				`[RI-1219] @font slot "${slot}": preload has no effect on system fonts — only local font files can be preloaded.`,
			);
		}
		return createFontSlot({ slot, family: "", kind: "system" });
	}

	// Validate the family at the parse boundary to prevent CSS injection
	// (e.g. `"Inter};.foo{color:red"`). The body config is ignored, as before.
	if (!SAFE_FONT_FAMILY_RE.test(pre.family)) {
		if (pre.family === "") {
			warnings?.push(
				`[RI-1217] @font slot "${slot}" has no font family — the slot emits an empty font variable.`,
			);
		}
		return createFontSlot({ slot, family: sanitizeFamily(pre.family), kind: "manual" });
	}
	const srcFaces: FaceDecl[] = pre.legacyFaceSrc
		? [{ src: pre.legacyFaceSrc, entries: [] }, ...body.faces]
		: body.faces;

	let config: FontSlot;
	if (pre.google) {
		if (srcFaces.length > 0) {
			warnings?.push(
				`[RI-1204] @font slot "${slot}" loads "${pre.family}" from google but also declares local face entries — provider fonts can't be combined with local faces. The extra faces were ignored.`,
			);
		}
		config = createFontSlot({
			slot,
			family: pre.family,
			kind: "google",
			fallback: pre.fallback,
			faces: [buildFace("google", body.faceDefaults, slot, warnings)],
		});
	} else if (srcFaces.length > 0) {
		config = createFontSlot({
			slot,
			family: pre.family,
			kind: "local",
			fallback: pre.fallback,
			faces: srcFaces.map((f) =>
				buildFace(
					f.src,
					body.faceDefaults,
					slot,
					warnings,
					normalizeFaceEntries(f.entries, slot, warnings),
				),
			),
		});
		warnDuplicateFaces(config, warnings);
	} else {
		// Manual font stack — no @font-face, just the variable.
		config = createFontSlot({
			slot,
			family: pre.family,
			kind: "manual",
			fallback: pre.fallback,
			faces: [buildFace("", body.faceDefaults, slot, warnings)],
		});
	}

	if (body.fallbackOverride) config.fallback = body.fallbackOverride;
	if (body.features !== undefined) config.features = body.features;
	if (body.variation !== undefined) config.variation = body.variation;
	if (body.metrics !== undefined) {
		if (config.kind === "manual") {
			warnings?.push(
				`[RI-1220] @font slot "${slot}" sets metrics on a manual font stack — metrics apply to loaded (google or local file) fonts only. The entry has no effect.`,
			);
		}
		config.metrics = body.metrics;
	}
	if (config.kind !== "local" && preloadDefault) {
		warnings?.push(
			`[RI-1219] @font slot "${slot}": preload has no effect on ${config.kind} fonts — only local font files can be preloaded.`,
		);
	}
	return config;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a single @font slot declaration into a FontSlot.
 *
 * Forms:
 * - `system`
 * - `"Inter" from google { weight: 100 900; }`
 * - `"Inter", ui-sans-serif, sans-serif from google`                (fallbacks in the preamble)
 * - `"Inter", ui-sans-serif, sans-serif { features: "cv11"; }`     (manual stack)
 * - `"Satoshi" { weight: 300 900; face: /Satoshi.woff2; face: /Satoshi-Italic.woff2 { style: italic; } }`
 */
export function parseFontBody(body: string, slot: string, warnings?: string[]): FontSlot {
	const src = stripCSSComments(body).trim();
	const braceIdx = topLevelIndexOf(src, "{");
	if (braceIdx === -1) return buildSlot(slot, src, undefined, warnings);
	const close = findClosingBrace(src, braceIdx);
	const block = src.slice(braceIdx + 1, close === -1 ? src.length : close);
	return buildSlot(slot, src.slice(0, braceIdx), block, warnings);
}

/**
 * Parse nested @font block body into multiple FontConfigs.
 *
 * ```
 * sans: "Inter" from google;
 * serif: "Merriweather" from google;
 * mono: "Fira Code" from google { weight: 300 700; }
 * ```
 */
export function parseNestedFontBlock(body: string, warnings?: string[]): FontSlot[] {
	const cleanedBody = stripCSSComments(body);
	const configs: FontSlot[] = [];

	// Slot values (`"Inter",\n  ui-sans-serif`) legally wrap across newlines
	// to their `;`/`{`, so newlines never end an entry.
	for (const entry of scanEntries(cleanedBody, { newlineTerminates: false })) {
		// @font blocks support no removals; colon-less fragments are dropped.
		if (entry.removal || entry.fragment) continue;
		// An unterminated `{ … }` block yields no usable slot — stop, as before.
		if (entry.unclosedBlock) break;
		if (!entry.key) continue;

		// Guard against pathological input with excessive font slot definitions.
		// Checked per scanned entry so the warning only fires when real content
		// was actually truncated.
		if (configs.length >= MAX_FONT_CONFIGS) {
			warnings?.push(
				`[RI-1216] @font block exceeds ${MAX_FONT_CONFIGS} slot definitions — the remaining slots were skipped. Split rarely-used slots into a separate stylesheet or remove unused ones.`,
			);
			break;
		}

		if (entry.block !== undefined) {
			configs.push(buildSlot(entry.key, entry.value, entry.block, warnings));
		} else if (entry.value) {
			configs.push(buildSlot(entry.key, entry.value, undefined, warnings));
		}
	}

	return configs;
}
