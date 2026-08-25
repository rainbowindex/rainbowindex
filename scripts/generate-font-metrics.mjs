/**
 * Regenerates src/integrations/font-providers/metrics-data.ts from
 * @capsizecss/metrics (a devDependency — the data is checked in so users
 * don't install the 129MB metrics collection).
 *
 * Usage: node scripts/generate-font-metrics.mjs
 *
 * To cover another family, add its capsize entry name (camelCase, see
 * node_modules/@capsizecss/metrics/entireMetricsCollection/) to FAMILIES
 * and re-run.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// ponytail: curated top-of-the-distribution list, not all ~2000 capsize
// families — keeps the generated table ~10KB. Extend the list if a user asks.
const FAMILIES = [
	// Locally-installed fallback fonts (metric-match targets)
	"arial",
	"helvetica",
	"helveticaNeue",
	"timesNewRoman",
	"georgia",
	"courierNew",
	"verdana",
	"tahoma",
	"trebuchetMS",
	"segoeUI",
	"roboto",
	// Popular Google families
	"inter",
	"openSans",
	"notoSans",
	"notoSerif",
	"lato",
	"montserrat",
	"poppins",
	"sourceSans3",
	"sourceSerif4",
	"sourceCodePro",
	"raleway",
	"nunito",
	"nunitoSans",
	"merriweather",
	"playfairDisplay",
	"ubuntu",
	"ubuntuMono",
	"ptSans",
	"ptSerif",
	"workSans",
	"rubik",
	"firaSans",
	"firaCode",
	"jetBrainsMono",
	"ibmPlexSans",
	"ibmPlexSerif",
	"ibmPlexMono",
	"dmSans",
	"dmSerifDisplay",
	"manrope",
	"karla",
	"inconsolata",
	"spaceGrotesk",
	"spaceMono",
	"josefinSans",
	"quicksand",
	"mulish",
	"barlow",
	"heebo",
	"oswald",
	"robotoCondensed",
	"robotoSlab",
	"robotoMono",
	"robotoFlex",
	"libreFranklin",
	"libreBaskerville",
	"crimsonText",
	"crimsonPro",
	"bitter",
	"cabin",
	"archivo",
	"outfit",
	"plusJakartaSans",
	"figtree",
	"sora",
	"lexend",
	"urbanist",
	"redHatDisplay",
	"redHatText",
	"publicSans",
	"kanit",
	"hind",
	"dosis",
	"oxygen",
	"overpass",
	"epilogue",
	"lora",
	"ebGaramond",
	"vollkorn",
	"alegreya",
	"cormorantGaramond",
	"exo2",
	"mavenPro",
	"asap",
	"zillaSlab",
	"spectral",
	"newsreader",
	"fraunces",
	"bricolageGrotesque",
	"schibstedGrotesk",
	"instrumentSans",
	"instrumentSerif",
	"geist",
	"geistMono",
	"gabarito",
	"onest",
	"anonymousPro",
	"victorMono",
	"titilliumWeb",
	"varelaRound",
	"chivo",
	"catamaran",
	"abel",
];

const rows = [];
for (const name of FAMILIES) {
	let m;
	try {
		m = require(`@capsizecss/metrics/${name}`);
	} catch {
		console.warn(`skip ${name}: not in @capsizecss/metrics`);
		continue;
	}
	if (!m.xWidthAvg) {
		console.warn(`skip ${name}: no xWidthAvg`);
		continue;
	}
	rows.push(
		`\t"${m.familyName.toLowerCase()}": [${m.ascent}, ${m.descent}, ${m.lineGap}, ${m.unitsPerEm}, ${m.xWidthAvg}, "${m.category}"],`,
	);
}
rows.sort();

const out = `/**
 * Font metrics for automatic CLS-fallback generation — GENERATED FILE, do not
 * edit. Regenerate with \`node scripts/generate-font-metrics.mjs\` (data from
 * the @capsizecss/metrics devDependency; curated list lives in that script).
 *
 * Keyed by lowercased family name. Tuple:
 * [ascent, descent, lineGap, unitsPerEm, xWidthAvg, category]
 */
export type FontMetricsRow = readonly [
	ascent: number,
	descent: number,
	lineGap: number,
	unitsPerEm: number,
	xWidthAvg: number,
	category: string,
];

export const FONT_METRICS_TABLE: Readonly<Record<string, FontMetricsRow>> = {
${rows.join("\n")}
};
`;

const dest = join(
	dirname(fileURLToPath(import.meta.url)),
	"../src/integrations/font-providers/metrics-data.ts",
);
writeFileSync(dest, out);
console.log(`wrote ${rows.length} families to ${dest}`);
