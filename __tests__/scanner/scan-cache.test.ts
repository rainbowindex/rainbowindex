import { describe, expect, test } from "vitest";
import { scanSourceFilesAsync } from "../../src/scanner/sources.js";
import { chmodSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Per-file scan cache (mtimeMs + size keyed, module-level in sources.ts)
// ---------------------------------------------------------------------------

const SOURCES = [{ pattern: "src/**/*.tsx", negated: false, inline: false }];

function makeDir(name: string): string {
	const dir = join(tmpdir(), `ri-scan-cache-${name}-${Date.now()}-${Math.random()}`);
	mkdirSync(join(dir, "src"), { recursive: true });
	return dir;
}

function cleanup(dir: string) {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {}
}

describe("per-file scan cache", () => {
	test("second scan of unchanged files returns the same classes", async () => {
		const dir = makeDir("stable");
		try {
			writeFileSync(join(dir, "src/A.tsx"), '<div className="flex items-center">');
			writeFileSync(join(dir, "src/B.tsx"), '<div className="underline">');
			const first = await scanSourceFilesAsync(SOURCES, dir);
			const second = await scanSourceFilesAsync(SOURCES, dir);
			expect([...second.classes].sort()).toEqual([...first.classes].sort());
			expect(second.classes).toContain("flex");
			expect(second.classes).toContain("underline");
		} finally {
			cleanup(dir);
		}
	});

	test("cache is hit on identical mtime+size (stale content replayed)", async () => {
		const dir = makeDir("hit");
		try {
			const file = join(dir, "src/A.tsx");
			writeFileSync(file, '<div className="flex-one">');
			// Pin mtime to whole milliseconds up front — utimesSync can't restore
			// the filesystem's sub-ms precision, which would fake a cache miss.
			const pinned = new Date(Math.floor(statSync(file).mtimeMs));
			utimesSync(file, pinned, pinned);
			await scanSourceFilesAsync(SOURCES, dir);
			// Same byte length, restored mtime → cache must serve the old result
			// without re-reading. This fails if the cache stops being consulted.
			writeFileSync(file, '<div className="flex-two">');
			utimesSync(file, pinned, pinned);
			const { classes } = await scanSourceFilesAsync(SOURCES, dir);
			expect(classes).toContain("flex-one");
			expect(classes).not.toContain("flex-two");
		} finally {
			cleanup(dir);
		}
	});

	test("modified file is re-extracted; unchanged sibling keeps its classes", async () => {
		const dir = makeDir("invalidate");
		try {
			const changed = join(dir, "src/A.tsx");
			writeFileSync(changed, '<div className="old-class">');
			writeFileSync(join(dir, "src/B.tsx"), '<div className="sibling-class">');
			const first = await scanSourceFilesAsync(SOURCES, dir);
			expect(first.classes).toContain("old-class");
			// Different size + fresh mtime → cache entry must be invalidated.
			writeFileSync(changed, '<div className="brand-new-class">');
			const second = await scanSourceFilesAsync(SOURCES, dir);
			expect(second.classes).toContain("brand-new-class");
			expect(second.classes).not.toContain("old-class");
			expect(second.classes).toContain("sibling-class");
		} finally {
			cleanup(dir);
		}
	});

	test("same-size edit with a newer mtime is re-extracted", async () => {
		const dir = makeDir("same-size");
		try {
			const file = join(dir, "src/A.tsx");
			writeFileSync(file, '<div className="flex-one">');
			const first = await scanSourceFilesAsync(SOURCES, dir);
			expect(first.classes).toContain("flex-one");
			// Same byte length, explicitly bumped mtime — kills a cache that
			// compares size alone (the common editor-save case).
			writeFileSync(file, '<div className="flex-two">');
			const future = new Date(statSync(file).mtimeMs + 5_000);
			utimesSync(file, future, future);
			const { classes } = await scanSourceFilesAsync(SOURCES, dir);
			expect(classes).toContain("flex-two");
			expect(classes).not.toContain("flex-one");
		} finally {
			cleanup(dir);
		}
	});

	test("cached results replay extraction warnings deterministically", async () => {
		const dir = makeDir("warnings");
		try {
			// Many short lines (under the long-line filter) of variant
			// groups whose combined expansion overflows the output cap → RI-1408.
			const line = `<div className="hover:{${"aa ".repeat(600)}}">`;
			writeFileSync(join(dir, "src/A.tsx"), `${line}\n`.repeat(60));
			const first = await scanSourceFilesAsync(SOURCES, dir);
			const firstWarnings = first.warnings.filter((w) => w.includes("RI-1408"));
			expect(firstWarnings.length).toBeGreaterThan(0);
			const second = await scanSourceFilesAsync(SOURCES, dir);
			expect(second.warnings.filter((w) => w.includes("RI-1408"))).toEqual(firstWarnings);
		} finally {
			cleanup(dir);
		}
	});

	// Root reads 0o000 files, so the EACCES this relies on never fires.
	test.skipIf(process.getuid?.() === 0)(
		"transient read errors (RI-1403) are not cached",
		async () => {
			const dir = makeDir("transient");
			try {
				const file = join(dir, "src/A.tsx");
				writeFileSync(file, '<div className="recovered-class">');
				// chmod leaves mtime+size untouched, so if the RI-1403 result were
				// cached, the recovery scan below would replay the failure forever.
				chmodSync(file, 0o000);
				const first = await scanSourceFilesAsync(SOURCES, dir);
				expect(first.warnings.some((w) => w.includes("RI-1403"))).toBe(true);
				chmodSync(file, 0o644);
				const second = await scanSourceFilesAsync(SOURCES, dir);
				expect(second.classes).toContain("recovered-class");
				expect(second.warnings.some((w) => w.includes("RI-1403"))).toBe(false);
			} finally {
				cleanup(dir);
			}
		},
	);

	test("cached failure (oversized file) replays without re-stat surprises", async () => {
		const dir = makeDir("oversize");
		try {
			writeFileSync(join(dir, "src/big.tsx"), "x".repeat(1_048_577));
			const first = await scanSourceFilesAsync(SOURCES, dir);
			expect(first.warnings.some((w) => w.includes("RI-1405"))).toBe(true);
			const second = await scanSourceFilesAsync(SOURCES, dir);
			expect(second.warnings.some((w) => w.includes("RI-1405"))).toBe(true);
		} finally {
			cleanup(dir);
		}
	});
});
