/**
 * Golden output tests — the whole emitted stylesheet, per fixture.
 *
 * The unit suite asserts fragments: that a rule contains a declaration, that a
 * warning fires. Nothing asserted the complete output, so a change that moved,
 * reordered, or silently dropped a declaration could pass everything. These
 * fixtures close that gap: each one compiles a small but realistic project and
 * diffs the entire stylesheet against a committed `expected.css`.
 *
 * A fixture is a directory under `fixtures/`:
 *
 *   input.css        the CSS entry
 *   sources/         source files whose classes get scanned (optional)
 *   imports/         files the entry may `@import` (optional; any layout works)
 *   fixture.json     { "mode": "project" | "postcss" } (optional, default project)
 *   expected.css     the committed output — written by the update run
 *
 * Adding one needs no code here; the directory listing is the test list.
 *
 * After an intentional change to emitted CSS:
 *
 *   pnpm test:golden:update
 *
 * Then read the `expected.css` diff. That diff IS the change — anything in it
 * you did not mean to do is a bug in `src/`, not in the fixture.
 *
 * Determinism: fonts resolve through an identity resolver, so no fixture
 * reaches the network and output never depends on what Google Fonts returns
 * today. `mode: "postcss"` runs the real plugin, which scans the fixture's own
 * `sources/` from the fixture directory as cwd.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import rainbowindex from "../../src/integrations/postcss/index.js";
import { compileProject, type SourceEntry } from "../../src/project/index.js";

const FIXTURES_DIR = fileURLToPath(new URL("fixtures", import.meta.url));

/** Identity: keep the authored weights/styles, never ask a font provider. */
const resolveFonts: NonNullable<Parameters<typeof compileProject>[0]["resolveFonts"]> = (fonts) =>
	fonts;

interface FixtureConfig {
	mode?: "project" | "postcss";
}

function readConfig(dir: string): FixtureConfig {
	try {
		return JSON.parse(readFileSync(join(dir, "fixture.json"), "utf8")) as FixtureConfig;
	} catch {
		return {};
	}
}

/** Every file under `sources/`, path-sorted so scan order is stable. */
function readSources(dir: string): SourceEntry[] {
	const root = join(dir, "sources");
	const out: SourceEntry[] = [];
	const walk = (current: string): void => {
		let entries: string[];
		try {
			entries = readdirSync(current).sort();
		} catch {
			return;
		}
		for (const name of entries) {
			const full = join(current, name);
			if (statSync(full).isDirectory()) walk(full);
			else out.push({ path: full, content: readFileSync(full, "utf8") });
		}
	};
	walk(root);
	return out;
}

async function compileFixture(dir: string): Promise<string> {
	const css = readFileSync(join(dir, "input.css"), "utf8");
	if (readConfig(dir).mode === "postcss") {
		// The plugin does its own scanning: cwd is the fixture, and the entry's
		// own `@source` globs point at `sources/`.
		const result = await postcss([rainbowindex({ cwd: dir })]).process(css, {
			from: join(dir, "input.css"),
		});
		return result.css;
	}
	// `cssPath` is what turns on @import inlining, and it is what a real project
	// has — a fixture that imports a token file exercises the same path a build
	// does, rather than a headless special case.
	return (
		await compileProject({
			css,
			cssPath: join(dir, "input.css"),
			sources: readSources(dir),
			resolveFonts,
		})
	).css;
}

const fixtures = readdirSync(FIXTURES_DIR, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

describe("golden output", () => {
	it("has fixtures to check", () => {
		// A glob that silently matches nothing would make this whole file a no-op.
		expect(fixtures.length).toBeGreaterThan(0);
	});

	for (const name of fixtures) {
		const dir = join(FIXTURES_DIR, name);
		it(`${name} emits the committed stylesheet`, async () => {
			await expect(await compileFixture(dir)).toMatchFileSnapshot(join(dir, "expected.css"));
		});
	}
});
