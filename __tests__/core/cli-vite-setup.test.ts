import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViteProject, initViteProject } from "../../src/cli/vite-setup.js";

// `init` and `create` take their package manager, command runner, and env as
// injected deps, so every case here runs against a real temp project with a
// recording runner — no child process, no network.

interface Run {
	command: string;
	args: string[];
	cwd: string;
}

let dir: string;
let logs: string[];
let runs: Run[];

/** Records commands instead of running them. */
const runner = {
	async run(command: string, args: string[], cwd: string): Promise<void> {
		runs.push({ command, args, cwd });
	},
};

/** Records the `create vite` call and materializes the app it would scaffold. */
const scaffoldRunner = {
	async run(command: string, args: string[], cwd: string): Promise<void> {
		runs.push({ command, args, cwd });
		if (!args.includes("vite") && !args.includes("vite@latest")) return;
		const target = join(cwd, args[args.indexOf("create") + 2] ?? "app");
		mkdirSync(join(target, "src"), { recursive: true });
		writeFileSync(
			join(target, "package.json"),
			JSON.stringify({ devDependencies: { vite: "^7" } }),
		);
		writeFileSync(join(target, "tsconfig.json"), "{}");
		writeFileSync(join(target, "src/main.tsx"), "createRoot();\n");
	},
};

function write(rel: string, content: string): void {
	const full = join(dir, rel);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content);
}

function read(rel: string): string {
	return readFileSync(join(dir, rel), "utf-8");
}

/** A config that needs no patch, so a case can isolate the stylesheet. */
const WIRED_CONFIG =
	'import rainbowindex from "rainbowindex/vite";\n\nexport default { plugins: [rainbowindex()] };\n';

/** The minimum that makes `loadViteProject` accept a directory. */
function viteApp(extra: Record<string, unknown> = {}): void {
	write("package.json", JSON.stringify({ devDependencies: { vite: "^7" }, ...extra }));
}

beforeEach(() => {
	dir = mkdtempSync(join(realpathSync(tmpdir()), "ri-vite-setup-"));
	logs = [];
	runs = [];
	vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
		logs.push(args.join(" "));
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	rmSync(dir, { recursive: true, force: true });
});

describe("init — first run", () => {
	it("installs, creates the config, the stylesheet, and the entry import", async () => {
		viteApp();
		write("tsconfig.json", "{}");
		write("src/main.tsx", 'import { createRoot } from "react-dom/client";\n\ncreateRoot();\n');

		await initViteProject({}, dir, { packageManager: "pnpm", runner });

		expect(runs).toEqual([{ command: "pnpm", args: ["add", "-D", "rainbowindex"], cwd: dir }]);
		expect(read("vite.config.ts")).toContain('import rainbowindex from "rainbowindex/vite";');
		expect(read("vite.config.ts")).toContain("plugins: [rainbowindex()]");
		expect(read("src/index.css")).toBe('@import "rainbowindex";\n');
		expect(read("src/main.tsx")).toContain('import "./index.css";');
		const output = logs.join("\n");
		expect(output).toContain("Added dev dependency");
		expect(output).toContain("Created Vite config");
		expect(output).toContain("Created stylesheet");
		expect(output).toContain("Added stylesheet import");
		expect(output).toContain("Next steps");
	});

	it("reports nothing to do on a second run", async () => {
		viteApp({ devDependencies: { vite: "^7", rainbowindex: "^0.6.0" } });
		write("tsconfig.json", "{}");
		await initViteProject({}, dir, { packageManager: "pnpm", runner });
		logs.length = 0;

		await initViteProject({}, dir, { packageManager: "pnpm", runner });

		expect(runs).toEqual([]);
		expect(logs.join("\n")).toContain("already wired");
	});

	it("uses an explicit --css path and creates its directory", async () => {
		viteApp();
		await initViteProject({ cssFile: "styles/app.css" }, dir, { packageManager: "npm", runner });

		expect(read("styles/app.css")).toBe('@import "rainbowindex";\n');
		expect(runs[0]).toEqual({ command: "npm", args: ["install", "-D", "rainbowindex"], cwd: dir });
	});

	it("rejects a directory that is not a Vite project", async () => {
		write("package.json", "{}");
		await expect(initViteProject({}, dir, { packageManager: "npm", runner })).rejects.toThrow(
			/does not look like a Vite project/,
		);
	});

	it("accepts a project that only has a vite script", async () => {
		write("package.json", JSON.stringify({ scripts: { dev: "vite --port 3000" } }));
		await initViteProject({}, dir, { packageManager: "npm", runner });
		expect(read("vite.config.mjs")).toContain("rainbowindex()");
	});
});

describe("init — patching an existing Vite config", () => {
	async function patch(name: string, source: string): Promise<string> {
		viteApp({ devDependencies: { vite: "^7", rainbowindex: "^0.6.0" } });
		write(name, source);
		await initViteProject({}, dir, { packageManager: "npm", runner });
		return read(name);
	}

	it("injects into a populated plugins array and adds the import last", async () => {
		const out = await patch(
			"vite.config.ts",
			'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n\tplugins: [react()],\n});\n',
		);
		expect(out).toContain("plugins: [rainbowindex(), react()]");
		expect(out).toMatch(/plugin-react";\nimport rainbowindex from "rainbowindex\/vite";/);
		expect(logs.join("\n")).toContain("Updated Vite config");
	});

	it("injects into an empty plugins array and adds an import to a file with none", async () => {
		const out = await patch("vite.config.js", "export default {\n\tplugins: [],\n};\n");
		expect(out).toBe(
			'import rainbowindex from "rainbowindex/vite";\n\nexport default {\n\tplugins: [rainbowindex()],\n};\n',
		);
	});

	it("adds a plugins key to defineConfig when there is none", async () => {
		const out = await patch(
			"vite.config.ts",
			'import { defineConfig } from "vite";\n\nexport default defineConfig({\n\tserver: { port: 3000 },\n});\n',
		);
		expect(out).toContain("plugins: [rainbowindex()],");
		expect(out).toContain("server: { port: 3000 }");
	});

	it("adds a plugins key to a plain default-exported object", async () => {
		const out = await patch("vite.config.mjs", "export default {\n\tserver: {},\n};\n");
		expect(out).toContain("plugins: [rainbowindex()],");
	});

	it("leaves a config that already registers the plugin alone", async () => {
		write("index.css", '@import "rainbowindex";\n');
		const source =
			'import rainbowindex from "rainbowindex/vite";\n\nexport default { plugins: [rainbowindex()] };\n';
		const out = await patch("vite.config.js", source);
		expect(out).toBe(source);
		expect(logs.join("\n")).toContain("already wired");
	});

	it("skips brackets inside comments and strings when finding the array end", async () => {
		const out = await patch(
			"vite.config.ts",
			[
				'import { defineConfig } from "vite";',
				"",
				"export default defineConfig({",
				"\tplugins: [",
				"\t\t// ]",
				"\t\t/* ] */",
				'\t\tplugin({ label: "]", escaped: "\\\\]" }),',
				"\t\tother(`]`),",
				"\t],",
				"});",
				"",
			].join("\n"),
		);
		expect(out).toContain("plugins: [rainbowindex(), \n");
		expect(out).toContain("other(`]`)");
	});

	it("reports a config it cannot patch", async () => {
		viteApp();
		write("vite.config.ts", 'import { defineConfig } from "vite";\n\nexport default config;\n');
		await expect(initViteProject({}, dir, { packageManager: "npm", runner })).rejects.toThrow(
			/no `defineConfig\({\.\.\.}\)` or `export default \{\.\.\.}` found/,
		);
	});

	it("reports an unterminated plugins array", async () => {
		viteApp();
		write("vite.config.ts", "export default defineConfig({\n\tplugins: [react()\n");
		await expect(initViteProject({}, dir, { packageManager: "npm", runner })).rejects.toThrow(
			/could not find the end of the plugins array/,
		);
	});
});

describe("init — choosing the stylesheet", () => {
	it("patches the stylesheet the entry file already imports", async () => {
		viteApp({ devDependencies: { vite: "^7", rainbowindex: "^0.6.0" } });
		write("vite.config.ts", WIRED_CONFIG);
		write("src/app.css", ".x {\n\tcolor: red;\n}\n");
		write(
			"src/main.tsx",
			'import "pkg/styles.css";\nimport "./missing.css";\nimport "./app.css";\n',
		);

		await initViteProject({}, dir, { packageManager: "npm", runner });

		expect(read("src/app.css")).toBe('@import "rainbowindex";\n\n.x {\n\tcolor: red;\n}\n');
		expect(logs.join("\n")).toContain("Updated stylesheet");
	});

	it("keeps an entry import it already has when it creates the stylesheet", async () => {
		viteApp({ devDependencies: { vite: "^7", rainbowindex: "^0.6.0" } });
		write("vite.config.ts", WIRED_CONFIG);
		write("src/main.tsx", 'import "./index.css";\n');

		await initViteProject({}, dir, { packageManager: "npm", runner });

		expect(read("src/index.css")).toBe('@import "rainbowindex";\n');
		expect(read("src/main.tsx")).toBe('import "./index.css";\n');
		expect(logs.join("\n")).not.toContain("Added stylesheet import");
	});

	it("writes index.css at the root when there is no src directory", async () => {
		viteApp();
		await initViteProject({}, dir, { packageManager: "npm", runner });
		expect(read("index.css")).toBe('@import "rainbowindex";\n');
	});

	it("leaves a stylesheet that already imports rainbowindex alone", async () => {
		viteApp({ devDependencies: { vite: "^7", rainbowindex: "^0.6.0" } });
		write("vite.config.ts", WIRED_CONFIG);
		write("src/index.css", '@import "rainbowindex";\n');
		await initViteProject({}, dir, { packageManager: "npm", runner });
		expect(logs.join("\n")).toContain("already wired");
	});

	it("keeps @charset first and a BOM in place", async () => {
		viteApp();
		write("src/index.css", '﻿@charset "utf-8";\n.x { color: red; }\n');
		await initViteProject({ cssFile: "src/index.css" }, dir, { packageManager: "npm", runner });
		expect(read("src/index.css")).toBe(
			'﻿@charset "utf-8";\n@import "rainbowindex";\n\n.x { color: red; }\n',
		);
	});

	it("writes only the import into an empty stylesheet", async () => {
		viteApp();
		write("src/index.css", "   \n");
		await initViteProject({ cssFile: "src/index.css" }, dir, { packageManager: "npm", runner });
		expect(read("src/index.css")).toBe('@import "rainbowindex";\n');
	});
});

describe("init — naming the config file", () => {
	it.each([
		["tsconfig.app.json", "{}", "vite.config.ts"],
		["src/main.ts", "export {};\n", "vite.config.ts"],
	])("uses vite.config.ts when %s exists", async (file, content, expected) => {
		viteApp();
		write(file, content);
		await initViteProject({}, dir, { packageManager: "npm", runner });
		expect(read(expected)).toContain("rainbowindex()");
	});

	it("uses vite.config.ts when typescript is a dependency", async () => {
		write("package.json", JSON.stringify({ dependencies: { vite: "^7", typescript: "^5" } }));
		await initViteProject({}, dir, { packageManager: "npm", runner });
		expect(read("vite.config.ts")).toContain("rainbowindex()");
	});

	it("uses vite.config.js for an ESM package", async () => {
		write("package.json", JSON.stringify({ type: "module", optionalDependencies: { vite: "^7" } }));
		await initViteProject({}, dir, { packageManager: "npm", runner });
		expect(read("vite.config.js")).toContain("rainbowindex()");
	});
});

describe("package manager detection", () => {
	it.each([
		["pnpm-lock.yaml", "pnpm", ["add", "-D", "rainbowindex"]],
		["yarn.lock", "yarn", ["add", "-D", "rainbowindex"]],
		["bun.lockb", "bun", ["add", "-d", "rainbowindex"]],
		["package-lock.json", "npm", ["install", "-D", "rainbowindex"]],
		["npm-shrinkwrap.json", "npm", ["install", "-D", "rainbowindex"]],
	])("reads %s", async (lockfile, command, args) => {
		viteApp();
		write(lockfile, "");
		await initViteProject({}, dir, { runner, env: {} });
		expect(runs[0]).toEqual({ command, args, cwd: dir });
	});

	it("falls back to the packageManager field", async () => {
		viteApp({ packageManager: "yarn@4.1.0" });
		await initViteProject({}, dir, { runner, env: {} });
		expect(runs[0].command).toBe("yarn");
	});

	it("falls back to the npm user agent", async () => {
		viteApp();
		await initViteProject({}, dir, { runner, env: { npm_config_user_agent: "bun/1.1.0" } });
		expect(runs[0].command).toBe("bun");
	});

	it("ignores an unparseable package.json", async () => {
		write("package.json", "{ not json");
		write("vite.config.js", "export default { plugins: [] };\n");
		await initViteProject({}, dir, { runner, env: {} });
		expect(runs[0].command).toBe("npm");
	});
});

describe("create", () => {
	it.each([
		["pnpm-lock.yaml", "pnpm", ["create", "vite", "app", "--template", "react-ts"]],
		["yarn.lock", "yarn", ["create", "vite", "app", "--template", "react-ts"]],
		["bun.lock", "bun", ["create", "vite", "app", "--template", "react-ts"]],
		["package-lock.json", "npm", ["create", "vite@latest", "app", "--", "--template", "react-ts"]],
	])("scaffolds with %s", async (lockfile, command, args) => {
		write(lockfile, "");
		await createViteProject({ targetDir: "app" }, dir, { runner: scaffoldRunner, env: {} });
		expect(runs[0]).toEqual({ command, args, cwd: dir });
		expect(read("app/vite.config.ts")).toContain("rainbowindex()");
		expect(logs.join("\n")).toContain("Next: cd app");
	});

	it("honours an explicit template and --css path", async () => {
		write("pnpm-lock.yaml", "");
		await createViteProject({ targetDir: "app", template: "vue-ts", cssFile: "src/app.css" }, dir, {
			runner: scaffoldRunner,
			env: {},
		});
		expect(runs[0].args).toContain("vue-ts");
		expect(read("app/src/app.css")).toBe('@import "rainbowindex";\n');
	});

	it("accepts an existing empty directory", async () => {
		mkdirSync(join(dir, "app"));
		await createViteProject({ targetDir: "app" }, dir, {
			packageManager: "pnpm",
			runner: scaffoldRunner,
		});
		expect(read("app/vite.config.ts")).toContain("rainbowindex()");
	});

	it("requires a target directory", async () => {
		await expect(createViteProject({}, dir, { packageManager: "npm", runner })).rejects.toThrow(
			/create requires a project directory/,
		);
	});

	it("refuses a directory that is not empty", async () => {
		mkdirSync(join(dir, "app"));
		write("app/keep.txt", "x");
		await expect(
			createViteProject({ targetDir: "app" }, dir, { packageManager: "npm", runner }),
		).rejects.toThrow(/already exists and is not empty/);
	});
});
