/**
 * Every relative link in the documentation resolves to a file that exists.
 *
 * The docs site used to be this check: it rendered `docs/*.md` with
 * `ignoreDeadLinks` off, so a broken relative link failed the build. The site
 * now lives in its own repository, and the day it left, thirteen broken links
 * to a document that was never written went unnoticed in the README, the
 * changelog and eight pages of `docs/`. This is that gate, as a unit test.
 *
 * Absolute URLs are not checked — this is about links whose target is a file
 * in this repository, which is the half that can be verified offline and the
 * half that rots when a file is renamed.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Targets known to be missing, with the reason.
 *
 * An entry here is a promise that the link is deliberate and the file is
 * coming — not a way to silence a typo. The second test asserts each one is
 * still missing, so the day the file lands this list fails until the entry is
 * deleted, and an allowlist that outlived its reason cannot sit here quietly.
 */
const KNOWN_MISSING: ReadonlyMap<string, string> = new Map([
	// Empty, and worth keeping that way: every documentation link resolves.
]);

/** Markdown files whose links are checked: the root pages plus all of `docs/`. */
function markdownFiles(): string[] {
	const out: string[] = [];
	for (const name of readdirSync(repoRoot)) {
		if (name.endsWith(".md")) out.push(join(repoRoot, name));
	}
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".md")) out.push(full);
		}
	};
	walk(join(repoRoot, "docs"));
	return out.sort();
}

interface Link {
	/** Repo-relative path of the file the link is written in. */
	source: string;
	/** The link target, verbatim. */
	target: string;
	/** Repo-relative path the target resolves to. */
	resolved: string;
}

/** `[label](target)` links whose target is a path in this repository. */
function relativeLinks(): Link[] {
	const links: Link[] = [];
	for (const file of markdownFiles()) {
		const text = readFileSync(file, "utf8");
		for (const [, target] of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
			if (/^(?:https?:|mailto:|#)/.test(target)) continue;
			const path = target.split("#")[0];
			if (path === "") continue;
			links.push({
				source: relative(repoRoot, file),
				target,
				resolved: relative(repoRoot, resolve(dirname(file), path)),
			});
		}
	}
	return links;
}

describe("documentation links", () => {
	it("resolve to files that exist", () => {
		const broken = relativeLinks()
			.filter((link) => !existsSync(join(repoRoot, link.resolved)))
			.filter((link) => !KNOWN_MISSING.has(link.resolved))
			.map((link) => `${link.source} -> ${link.target}`);
		expect(broken).toEqual([]);
	});

	it("check something, so a silent regex change cannot pass this suite", () => {
		// A guard on the guard: if the link pattern stops matching, both tests
		// above go green while checking nothing at all.
		expect(relativeLinks().length).toBeGreaterThan(50);
	});

	it("do not carry a stale allowlist entry", () => {
		const landed = [...KNOWN_MISSING.keys()].filter((path) => existsSync(join(repoRoot, path)));
		expect(landed, "these files now exist — delete their KNOWN_MISSING entries").toEqual([]);
	});
});
