import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CLIOptions } from "./args.js";
import { loadProjectTheme } from "./css-file.js";
import { enumerateClassNames } from "../utilities/enumerate.js";
import { listVariants } from "../engine/variants.js";

export async function generateTypes(opts: CLIOptions, cwd: string): Promise<void> {
	const theme = await loadProjectTheme(opts, cwd);

	const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;
	const validateNames = (names: string[], context: string): string[] => {
		return names.filter((n) => {
			if (SAFE_NAME_RE.test(n)) return true;
			console.error(
				`[RI-1014] Skipping ${context} name "${n}" — contains characters unsafe for TypeScript type generation.`,
			);
			return false;
		});
	};
	/** Quoted string-literal positions only need quote/backslash safety. */
	const literalSafe = (names: string[]): string[] =>
		names.filter((n) => !n.includes('"') && !n.includes("\\"));

	// The same enumeration that powers editor completions drives the generated
	// types — one source of truth, no hand-maintained utility lists.
	const enumeration = enumerateClassNames(theme);
	const variants = listVariants(theme);

	const colorNames = validateNames(Object.keys(theme.colors), "color");
	const textSizes = validateNames(Object.keys(theme.text), "text");
	const weightNames = validateNames(Object.keys(theme.weights), "weight");
	const variantNames = literalSafe(variants.filter((v) => v.kind !== "pattern").map((v) => v.name));
	const finiteClasses = literalSafe(enumeration.classes.map((c) => c.name));
	const spacingRoots = validateNames(
		enumeration.templates.filter((t) => t.kind === "spacing").map((t) => t.root),
		"spacing root",
	);
	const numericRoots = validateNames(
		enumeration.templates.filter((t) => t.kind === "number").map((t) => t.root),
		"numeric root",
	);
	const functionalCustomUtilities = validateNames(
		enumeration.templates.filter((t) => t.kind === "custom").map((t) => t.root),
		"utility",
	);

	const union = (names: string[]): string =>
		names.length > 0 ? names.map((n) => `"${n}"`).join(" | ") : "never";

	/** Multi-line union body: `| "a" | "b" …` wrapped at `perLine` names. */
	const unionLines = (names: string[], perLine: number): string[] => {
		if (names.length === 0) return ["  | never"];
		const lines: string[] = [];
		for (let i = 0; i < names.length; i += perLine) {
			lines.push(
				`  | ${names
					.slice(i, i + perLine)
					.map((n) => `"${n}"`)
					.join(" | ")}`,
			);
		}
		return lines;
	};

	const lines: string[] = [
		"// rainbowindex-env.d.ts (auto-generated — do not edit)",
		"",
		`type ColorName = ${union(colorNames)};`,
		`type ColorStop = "50" | "100" | "150" | "200" | "250" | "300" | "350" | "400" | "450" | "500" | "550" | "600" | "650" | "700" | "750" | "800" | "850" | "900" | "950";`,
		"type SpacingToken = `${number}` | `${number}_${number}`;",
		`type TextSize = ${union(textSizes)};`,
		`type WeightName = ${union(weightNames)};`,
		"",
		"type Variant =",
		...unionLines(variantNames, 8),
		"  ;",
		"",
		"// Every finite class the compiler resolves for this theme — statics plus",
		"// theme-token expansions, enumerated and probe-verified.",
		"type RainbowStatic =",
		...unionLines(finiteClasses, 6),
		"  ;",
	];

	if (spacingRoots.length > 0) {
		lines.push("", `type SpacingRoot = ${union(spacingRoots)};`);
	}
	if (numericRoots.length > 0) {
		lines.push(`type NumericRoot = ${union(numericRoots)};`);
	}

	lines.push("", "type RainbowBase =", "  | RainbowStatic");
	if (spacingRoots.length > 0) {
		lines.push("  | `${SpacingRoot}-${SpacingToken}`");
	}
	if (numericRoots.length > 0) {
		lines.push("  | `${NumericRoot}-${number}`");
	}

	if (functionalCustomUtilities.length > 0) {
		// Functional utilities are declared as `name-*` — accept any suffix string.
		lines.push(`  | ${functionalCustomUtilities.map((n) => `\`${n}-\${string}\``).join(" | ")}`);
	}
	lines.push("  ;");

	lines.push(
		"",
		"type RainbowClass =",
		"  | RainbowBase",
		"  // Variant-prefixed classes validate the variant name (chained prefixes",
		"  // match through the open remainder). Expanding Variant × RainbowBase",
		"  // eagerly would exceed TypeScript's union-size limits.",
		"  | `${Variant}:${string}`",
	);

	if (!opts.strict) {
		lines.push("  | (string & {});");
	} else {
		lines.push("  ;");
	}

	lines.push(
		"",
		'declare module "rainbowindex" {',
		"  type ClassInput = RainbowClass | false | null | undefined | ClassInput[];",
		"  export function ri(...classes: ClassInput[]): string;",
		"  export function createRi(snapshot: unknown): (...classes: ClassInput[]) => string;",
		"}",
		"",
	);

	const outputPath = resolve(cwd, "rainbowindex-env.d.ts");
	const newContent = lines.join("\n");
	if (existsSync(outputPath)) {
		const existing = await readFile(outputPath, "utf-8");
		if (!existing.startsWith("// rainbowindex-env.d.ts (auto-generated")) {
			const backupPath = `${outputPath}.bak`;
			try {
				await writeFile(backupPath, existing);
				console.warn(
					`[RI-1604] "${outputPath}" exists and does not appear to be auto-generated. Original saved to "${backupPath}" before overwrite.`,
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(
					`[RI-1604] "${outputPath}" exists with hand edits and the backup write to "${backupPath}" failed: ${msg}. Aborting to avoid data loss — move the file aside and re-run.`,
				);
				process.exitCode = 1;
				return;
			}
		}
	}
	try {
		await writeFile(outputPath, newContent);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[rainbowindex] Failed to write types file "${outputPath}": ${msg}`);
		process.exitCode = 1;
		return;
	}
	console.log(`[rainbowindex] Generated types: ${outputPath}`);
	console.log(
		'[rainbowindex] Add it to tsconfig.json#include (e.g. "include": ["src", "rainbowindex-env.d.ts"]) so the editor picks up RainbowClass autocomplete.',
	);
}
