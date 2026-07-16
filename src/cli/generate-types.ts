import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CLIOptions } from "./args.js";
import { loadProjectTheme } from "./css-file.js";

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

	const colorNames = validateNames(Object.keys(theme.colors), "color");
	const textSizes = validateNames(Object.keys(theme.text), "text");
	const breakpoints = validateNames(Object.keys(theme.breakpoints), "breakpoint");
	const weightNames = validateNames(Object.keys(theme.weights), "weight");
	const staticCustomUtilities = validateNames(
		theme.customUtilities.filter((u) => !u.functional).map((u) => u.name),
		"utility",
	);
	const functionalCustomUtilities = validateNames(
		theme.customUtilities.filter((u) => u.functional).map((u) => u.name),
		"utility",
	);

	const union = (names: string[]): string =>
		names.length > 0 ? names.map((n) => `"${n}"`).join(" | ") : "never";

	const lines: string[] = [
		"// rainbowindex-env.d.ts (auto-generated — do not edit)",
		"",
		`type ColorName = ${union(colorNames)};`,
		`type ColorStop = "50" | "100" | "150" | "200" | "250" | "300" | "350" | "400" | "450" | "500" | "550" | "600" | "650" | "700" | "750" | "800" | "850" | "900" | "950";`,
		"type SpacingToken = `${number}` | `${number}_${number}`;",
		`type TextSize = ${union(textSizes)};`,
		`type Variant = ${union(breakpoints)} | "hover" | "focus" | "focus-visible" | "active" | "disabled" | "dark" | "first" | "last" | "odd" | "even";`,
		`type WeightName = ${union(weightNames)};`,
		"",
		"type RainbowClass =",
		'  | `${"bg" | "text" | "border" | "outline" | "accent" | "caret" | "fill" | "stroke"}-${ColorName}-${ColorStop}`',
		'  | `${"p" | "px" | "py" | "pt" | "pb" | "pl" | "pr" | "ps" | "pe" | "pbs" | "pbe" | "m" | "mx" | "my" | "mt" | "mb" | "ml" | "mr" | "ms" | "me" | "mbs" | "mbe" | "gap" | "gap-x" | "gap-y"}-${SpacingToken}`',
		"  | `text-${TextSize}`",
		"  | `text-fluid-${TextSize}`",
		'  | `font-${"sans" | "serif" | "mono"}`',
		"  | `font-${WeightName}`",
		"  | `w-${SpacingToken}` | `h-${SpacingToken}` | `size-${SpacingToken}`",
	];

	if (staticCustomUtilities.length > 0) {
		lines.push(`  | ${staticCustomUtilities.map((n) => `"${n}"`).join(" | ")}`);
	}

	if (functionalCustomUtilities.length > 0) {
		// Functional utilities are declared as `name-*` — accept any suffix string.
		lines.push(`  | ${functionalCustomUtilities.map((n) => `\`${n}-\${string}\``).join(" | ")}`);
	}

	lines.push("  | `${Variant}:${Exclude<RainbowClass, `${string}:${string}`>}`");

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
