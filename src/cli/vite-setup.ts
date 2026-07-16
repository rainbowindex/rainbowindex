import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { CLIOptions } from "./args.js";
import { CSS_CANDIDATES } from "./css-file.js";

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

interface PackageJSON {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
	packageManager?: string;
	type?: string;
}

interface CommandRunner {
	run(command: string, args: string[], cwd: string): Promise<void>;
}

interface SetupDeps {
	packageManager?: PackageManager;
	runner?: CommandRunner;
	env?: NodeJS.ProcessEnv;
}

const VITE_CONFIG_FILES = [
	"vite.config.ts",
	"vite.config.mts",
	"vite.config.js",
	"vite.config.mjs",
	"vite.config.cts",
	"vite.config.cjs",
] as const;

const ENTRY_FILES = [
	"src/main.tsx",
	"src/main.ts",
	"src/main.jsx",
	"src/main.js",
	"main.tsx",
	"main.ts",
	"main.jsx",
	"main.js",
] as const;

const DEFAULT_CREATE_TEMPLATE = "react-ts";

const DEFAULT_RUNNER: CommandRunner = {
	run(command, args, cwd) {
		return new Promise<void>((resolveRun, rejectRun) => {
			const child = spawn(command, args, {
				cwd,
				stdio: "inherit",
			});
			child.on("error", rejectRun);
			child.on("exit", (code, signal) => {
				if (code === 0) {
					resolveRun();
					return;
				}
				rejectRun(
					new Error(
						signal
							? `Command "${command}" terminated by signal ${signal}.`
							: `Command "${command} ${args.join(" ")}" failed with exit code ${code ?? 1}.`,
					),
				);
			});
		});
	},
};

export async function initViteProject(
	opts: Pick<CLIOptions, "cssFile">,
	cwd: string,
	deps: SetupDeps = {},
): Promise<void> {
	const project = loadViteProject(cwd);
	const packageManager = deps.packageManager ?? detectPackageManager(cwd, deps.env);
	const runner = deps.runner ?? DEFAULT_RUNNER;
	const [cssPath, entryFile] = await Promise.all([
		resolveStylesheetPath(cwd, opts.cssFile),
		findEntryFile(cwd),
	]);

	let dependencyInstalled = false;
	if (!hasRainbowIndexDependency(project.packageJSON)) {
		await installRainbowIndex(cwd, packageManager, runner);
		dependencyInstalled = true;
	}

	const [
		{ path: configPath, changed: configChanged, created: configCreated },
		{ changed: cssChanged, created: cssCreated },
	] = await Promise.all([
		ensureViteConfig(cwd, project.packageJSON, project.viteConfigPath),
		ensureStylesheet(cssPath),
	]);
	const entryChanged = cssCreated ? await ensureStylesheetImport(entryFile, cssPath) : false;

	const rootLabel = relative(process.cwd(), cwd) || ".";
	console.log(`[rainbowindex] Initialized Vite project: ${rootLabel}`);
	if (dependencyInstalled) {
		console.log("[rainbowindex] Added dev dependency: rainbowindex");
	}
	if (configCreated) {
		console.log(
			`[rainbowindex] Created Vite config: ${relative(cwd, configPath).replaceAll("\\", "/")}`,
		);
	} else if (configChanged) {
		console.log(
			`[rainbowindex] Updated Vite config: ${relative(cwd, configPath).replaceAll("\\", "/")}`,
		);
	}
	if (cssCreated) {
		console.log(
			`[rainbowindex] Created stylesheet: ${relative(cwd, cssPath).replaceAll("\\", "/")}`,
		);
	} else if (cssChanged) {
		console.log(
			`[rainbowindex] Updated stylesheet: ${relative(cwd, cssPath).replaceAll("\\", "/")}`,
		);
	}
	if (entryChanged && entryFile) {
		console.log(
			`[rainbowindex] Added stylesheet import: ${relative(cwd, entryFile).replaceAll("\\", "/")}`,
		);
	}
	if (!dependencyInstalled && !configChanged && !configCreated && !cssChanged && !cssCreated) {
		console.log("[rainbowindex] Rainbow Index was already wired for Vite.");
		return;
	}
	console.log("");
	console.log("[rainbowindex] Next steps:");
	console.log("  1. Restart your dev server (Vite must reload vite.config to pick up the plugin).");
	console.log(
		"  2. Add utility classes to your components — autocomplete works after `rainbowindex generate-types`.",
	);
	console.log(
		"  3. Customize via CSS directives (@color, @text, @spacing). See https://github.com/rainbowindex/rainbowindex#theming",
	);
}

export async function createViteProject(
	opts: Pick<CLIOptions, "targetDir" | "template" | "cssFile">,
	cwd: string,
	deps: SetupDeps = {},
): Promise<void> {
	if (!opts.targetDir) {
		throw new Error("create requires a project directory. Example: rainbowindex create my-app");
	}
	const packageManager = deps.packageManager ?? detectPackageManager(cwd, deps.env);
	const runner = deps.runner ?? DEFAULT_RUNNER;
	const targetDir = opts.targetDir;
	const targetRoot = resolve(cwd, targetDir);
	await ensureScaffoldTargetIsUsable(targetRoot);

	const template = opts.template || DEFAULT_CREATE_TEMPLATE;
	const scaffold = getCreateCommand(packageManager, targetDir, template);

	console.log(`[rainbowindex] Creating Vite app with template "${template}"...`);
	await runner.run(scaffold.command, scaffold.args, cwd);

	await initViteProject({ cssFile: opts.cssFile }, targetRoot, {
		...deps,
		packageManager,
		runner,
	});

	const displayTarget = relative(cwd, targetRoot) || ".";
	console.log(`[rainbowindex] Ready: ${displayTarget}`);
	console.log(`[rainbowindex] Next: cd ${displayTarget} && ${packageManager} run dev`);
}

function detectPackageManager(cwd: string, env: NodeJS.ProcessEnv = process.env): PackageManager {
	if (existsSync(resolve(cwd, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(resolve(cwd, "yarn.lock"))) return "yarn";
	if (existsSync(resolve(cwd, "bun.lock")) || existsSync(resolve(cwd, "bun.lockb"))) return "bun";
	if (
		existsSync(resolve(cwd, "package-lock.json")) ||
		existsSync(resolve(cwd, "npm-shrinkwrap.json"))
	) {
		return "npm";
	}

	const packageJSON = readPackageJSONSync(cwd);
	const packageManagerField = packageJSON?.packageManager ?? "";
	if (packageManagerField.startsWith("pnpm@")) return "pnpm";
	if (packageManagerField.startsWith("yarn@")) return "yarn";
	if (packageManagerField.startsWith("bun@")) return "bun";
	if (packageManagerField.startsWith("npm@")) return "npm";

	const userAgent = env.npm_config_user_agent ?? "";
	if (userAgent.startsWith("pnpm/")) return "pnpm";
	if (userAgent.startsWith("yarn/")) return "yarn";
	if (userAgent.startsWith("bun/")) return "bun";
	return "npm";
}

function loadViteProject(cwd: string): {
	packageJSON: PackageJSON | null;
	viteConfigPath: string | null;
} {
	const packageJSON = readPackageJSONSync(cwd);
	const hasViteDependency =
		packageJSON?.dependencies?.vite ||
		packageJSON?.devDependencies?.vite ||
		packageJSON?.optionalDependencies?.vite;
	const hasViteScript = Object.values(packageJSON?.scripts ?? {}).some((script) =>
		/\bvite\b/.test(script),
	);
	const viteConfigPath = findExistingViteConfig(cwd);
	if (!hasViteDependency && !hasViteScript && !viteConfigPath) {
		throw new Error(
			`"${cwd}" does not look like a Vite project. Add Vite first or run rainbowindex create <app-name>.`,
		);
	}
	return { packageJSON, viteConfigPath };
}

async function ensureScaffoldTargetIsUsable(targetRoot: string): Promise<void> {
	if (!existsSync(targetRoot)) return;
	const entries = await readdir(targetRoot);
	if (entries.length > 0) {
		throw new Error(
			`Target directory "${targetRoot}" already exists and is not empty. Choose a new directory.`,
		);
	}
}

async function installRainbowIndex(
	cwd: string,
	packageManager: PackageManager,
	runner: CommandRunner,
): Promise<void> {
	const install = getInstallCommand(packageManager);
	await runner.run(install.command, install.args, cwd);
}

async function ensureViteConfig(
	cwd: string,
	packageJSON: PackageJSON | null,
	// Probed once by loadViteProject — nothing between the probe and this call
	// creates a Vite config.
	existingPath: string | null,
): Promise<{ path: string; changed: boolean; created: boolean }> {
	if (!existingPath) {
		const fileName = chooseViteConfigName(cwd, packageJSON);
		const configPath = resolve(cwd, fileName);
		const content =
			'import { defineConfig } from "vite";\nimport rainbowindex from "rainbowindex/vite";\n\nexport default defineConfig({\n\tplugins: [rainbowindex()],\n});\n';
		await writeFile(configPath, content, "utf-8");
		return { path: configPath, changed: true, created: true };
	}

	const original = await readFile(existingPath, "utf-8");
	const updated = patchViteConfig(original, existingPath);
	if (updated === original) {
		return { path: existingPath, changed: false, created: false };
	}
	await writeFile(existingPath, updated, "utf-8");
	return { path: existingPath, changed: true, created: false };
}

const VITE_CONFIG_MANUAL_SNIPPET = `
  import { defineConfig } from "vite";
  import rainbowindex from "rainbowindex/vite";

  export default defineConfig({
    plugins: [rainbowindex()],
  });
`;

function configPatchError(configPath: string, reason: string): Error {
	return new Error(
		`Could not update "${configPath}" automatically (${reason}).\n\n` +
			`Add the following to your Vite config manually:\n${VITE_CONFIG_MANUAL_SNIPPET}`,
	);
}

function patchViteConfig(source: string, configPath: string): string {
	let next = source;

	if (!/["']rainbowindex\/vite["']/.test(next)) {
		next = insertImportStatement(next, 'import rainbowindex from "rainbowindex/vite";');
	}

	if (/\brainbowindex\s*\(/.test(next)) {
		return next;
	}

	const pluginsMatch = /\bplugins\s*:\s*\[/.exec(next);
	if (pluginsMatch) {
		const arrayStart = next.indexOf("[", pluginsMatch.index);
		const arrayEnd = findMatchingDelimiter(next, arrayStart, "[", "]");
		if (arrayEnd === -1) {
			throw configPatchError(configPath, "could not find the end of the plugins array");
		}
		const inner = next.slice(arrayStart + 1, arrayEnd).trim();
		const injection = inner.length === 0 ? "rainbowindex()" : "rainbowindex(), ";
		return `${next.slice(0, arrayStart + 1)}${injection}${next.slice(arrayStart + 1)}`;
	}

	const objectStart = findConfigObjectStart(next);
	if (objectStart === -1) {
		throw configPatchError(configPath, "no `defineConfig({...})` or `export default {...}` found");
	}

	return `${next.slice(0, objectStart + 1)}\n\tplugins: [rainbowindex()],${next.slice(objectStart + 1)}`;
}

function insertImportStatement(source: string, statement: string): string {
	let insertAt = 0;
	const importRe = /^\s*import .*$/gm;
	for (const match of source.matchAll(importRe)) {
		insertAt = match.index + match[0].length;
		if (source[insertAt] === "\n") insertAt++;
	}
	if (insertAt === 0) {
		return `${statement}\n\n${source}`;
	}
	return `${source.slice(0, insertAt)}${statement}\n${source.slice(insertAt)}`;
}

function findConfigObjectStart(source: string): number {
	const defineConfigMatch = /defineConfig\s*\(\s*\{/.exec(source);
	if (defineConfigMatch) {
		return source.indexOf("{", defineConfigMatch.index);
	}
	const exportDefaultMatch = /export\s+default\s+\{/.exec(source);
	if (exportDefaultMatch) {
		return source.indexOf("{", exportDefaultMatch.index);
	}
	return -1;
}

function findMatchingDelimiter(input: string, start: number, open: string, close: string): number {
	let depth = 0;
	let quote: '"' | "'" | "`" | null = null;
	let inLineComment = false;
	let inBlockComment = false;

	for (let i = start; i < input.length; i++) {
		const ch = input[i];
		const next = input[i + 1];

		if (inLineComment) {
			if (ch === "\n") inLineComment = false;
			continue;
		}
		if (inBlockComment) {
			if (ch === "*" && next === "/") {
				inBlockComment = false;
				i++;
			}
			continue;
		}
		if (quote) {
			if (ch === "\\") {
				i++;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}

		if (ch === "/" && next === "/") {
			inLineComment = true;
			i++;
			continue;
		}
		if (ch === "/" && next === "*") {
			inBlockComment = true;
			i++;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			continue;
		}
		if (ch === open) {
			depth++;
			continue;
		}
		if (ch === close) {
			depth--;
			if (depth === 0) return i;
		}
	}

	return -1;
}

async function resolveStylesheetPath(cwd: string, cssFile?: string): Promise<string> {
	if (cssFile) return resolve(cwd, cssFile);

	const importedCSS = await findImportedStylesheet(cwd);
	if (importedCSS) return importedCSS;

	for (const candidate of CSS_CANDIDATES) {
		const fullPath = resolve(cwd, candidate);
		if (existsSync(fullPath)) return fullPath;
	}

	return existsSync(resolve(cwd, "src"))
		? resolve(cwd, "src/index.css")
		: resolve(cwd, "index.css");
}

async function ensureStylesheet(cssPath: string): Promise<{ changed: boolean; created: boolean }> {
	if (!existsSync(cssPath)) {
		await mkdir(dirname(cssPath), { recursive: true });
		await writeFile(cssPath, '@import "rainbowindex";\n', "utf-8");
		return { changed: true, created: true };
	}

	const original = await readFile(cssPath, "utf-8");
	if (/@import\s+["']rainbowindex["']/.test(original)) {
		return { changed: false, created: false };
	}
	const updated = insertRainbowImport(original);
	await writeFile(cssPath, updated, "utf-8");
	return { changed: true, created: false };
}

function insertRainbowImport(source: string): string {
	const bom = source.charCodeAt(0) === 0xfeff ? "\ufeff" : "";
	const content = bom ? source.slice(1) : source;
	const charsetMatch = /^\s*@charset\s+[^;]+;\s*/i.exec(content);
	if (charsetMatch) {
		return `${bom}${charsetMatch[0]}@import "rainbowindex";\n\n${content.slice(charsetMatch[0].length)}`;
	}
	if (content.trim().length === 0) {
		return `${bom}@import "rainbowindex";\n`;
	}
	return `${bom}@import "rainbowindex";\n\n${content}`;
}

async function ensureStylesheetImport(entryFile: string | null, cssPath: string): Promise<boolean> {
	if (!entryFile || !existsSync(entryFile)) return false;
	const original = await readFile(entryFile, "utf-8");
	const relativePath = toImportPath(dirname(entryFile), cssPath);
	if (hasStylesheetImport(original, relativePath)) {
		return false;
	}
	const updated = insertImportStatement(original, `import "${relativePath}";`);
	await writeFile(entryFile, updated, "utf-8");
	return true;
}

async function findImportedStylesheet(cwd: string): Promise<string | null> {
	for (const entryFile of ENTRY_FILES) {
		const fullPath = resolve(cwd, entryFile);
		if (!existsSync(fullPath)) continue;
		const content = await readFile(fullPath, "utf-8");
		const matches = content.matchAll(
			/import\s+(?:.+?\s+from\s+)?["']([^"']+\.css(?:\?[^"']*)?)["']/g,
		);
		for (const match of matches) {
			const importPath = match[1].split("?")[0];
			if (!importPath.startsWith(".")) continue;
			const stylesheet = resolve(dirname(fullPath), importPath);
			if (existsSync(stylesheet)) return stylesheet;
		}
	}
	return null;
}

async function findEntryFile(cwd: string): Promise<string | null> {
	for (const entryFile of ENTRY_FILES) {
		const fullPath = resolve(cwd, entryFile);
		if (existsSync(fullPath)) return fullPath;
	}
	return null;
}

function hasStylesheetImport(source: string, importPath: string): boolean {
	const escapedPath = importPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`import\\s+(?:.+?\\s+from\\s+)?["']${escapedPath}["']`).test(source);
}

function toImportPath(fromDir: string, targetFile: string): string {
	const rel = relative(fromDir, targetFile).replaceAll("\\", "/");
	return rel.startsWith(".") ? rel : `./${rel}`;
}

function findExistingViteConfig(cwd: string): string | null {
	for (const name of VITE_CONFIG_FILES) {
		const fullPath = resolve(cwd, name);
		if (existsSync(fullPath)) return fullPath;
	}
	return null;
}

function chooseViteConfigName(cwd: string, packageJSON: PackageJSON | null): string {
	if (
		existsSync(resolve(cwd, "tsconfig.json")) ||
		existsSync(resolve(cwd, "tsconfig.app.json")) ||
		existsSync(resolve(cwd, "src/main.ts")) ||
		existsSync(resolve(cwd, "src/main.tsx")) ||
		packageJSON?.dependencies?.typescript ||
		packageJSON?.devDependencies?.typescript
	) {
		return "vite.config.ts";
	}
	return packageJSON?.type === "module" ? "vite.config.js" : "vite.config.mjs";
}

function hasRainbowIndexDependency(packageJSON: PackageJSON | null): boolean {
	if (!packageJSON) return false;
	return Boolean(
		packageJSON.dependencies?.rainbowindex ||
			packageJSON.devDependencies?.rainbowindex ||
			packageJSON.optionalDependencies?.rainbowindex,
	);
}

function getCreateCommand(
	packageManager: PackageManager,
	targetDir: string,
	template: string,
): { command: string; args: string[] } {
	switch (packageManager) {
		case "pnpm":
			return {
				command: "pnpm",
				args: ["create", "vite", targetDir, "--template", template],
			};
		case "yarn":
			return {
				command: "yarn",
				args: ["create", "vite", targetDir, "--template", template],
			};
		case "bun":
			return {
				command: "bun",
				args: ["create", "vite", targetDir, "--template", template],
			};
		default:
			return {
				command: "npm",
				args: ["create", "vite@latest", targetDir, "--", "--template", template],
			};
	}
}

function getInstallCommand(packageManager: PackageManager): { command: string; args: string[] } {
	switch (packageManager) {
		case "pnpm":
			return { command: "pnpm", args: ["add", "-D", "rainbowindex"] };
		case "yarn":
			return { command: "yarn", args: ["add", "-D", "rainbowindex"] };
		case "bun":
			return { command: "bun", args: ["add", "-d", "rainbowindex"] };
		default:
			return { command: "npm", args: ["install", "-D", "rainbowindex"] };
	}
}

function readPackageJSONSync(cwd: string): PackageJSON | null {
	const packagePath = resolve(cwd, "package.json");
	if (!existsSync(packagePath)) return null;
	try {
		return JSON.parse(readFileSync(packagePath, "utf-8")) as PackageJSON;
	} catch {
		return null;
	}
}
