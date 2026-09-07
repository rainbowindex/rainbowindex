/**
 * The example is only proof if it checks itself.
 *
 * The preset protocol has two independent halves, and each fails *silently*:
 * an unresolved `@import` leaves the package's tokens undefined, and a missing
 * `safelistSources` entry leaves the package's own classes unscanned. Neither
 * produces an error — just a stylesheet with less in it. So assert both, and
 * keep them separable: each half is checked with a class the *other* half
 * cannot explain, so a failure says which one broke.
 */

import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./dist/app.css", import.meta.url), "utf8");

/** Does the sheet hold a rule for this class? Matches the escaped selector. */
const hasRule = (className) =>
	new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(css);

const halves = [
	[
		'@import "…/rainbow.css" — the package\'s directives were read',
		[
			// Both are written by hand in the consumer's own source, so the
			// scanner finds them either way — they compile only if the package's
			// directives were read. That is what keeps this half separable from
			// the next one: neither class appears anywhere in the package's lib.
			["the package's named radius", () => hasRule("rounded-control")],
			["a stop from the package's generated ramp", () => hasRule("text-accent-700")],
		],
	],
	[
		"rainbowindex.safelistSources — the package's own classes were scanned",
		[
			// These exist only inside node_modules/@…/design-system/lib.
			["a class only the package's lib names", () => hasRule("bg-accent-500")],
			["another, from a different tone", () => hasRule("bg-surface")],
			["the package's custom utility", () => hasRule("ds-focus-ring")],
		],
	],
	[
		"the consumer's own theme still works alongside it",
		[
			["the consumer's own token", () => hasRule("text-brand-700")],
			["a plain utility", () => hasRule("min-h-screen")],
		],
	],
];

let failures = 0;
for (const [half, checks] of halves) {
	const failed = checks.filter(([, check]) => !check()).map(([name]) => name);
	if (failed.length === 0) continue;
	failures += failed.length;
	console.error(`design-system-consumer: ${half} — FAILED`);
	for (const name of failed) console.error(`  - missing ${name}`);
}
if (failures > 0) process.exit(1);

const total = halves.reduce((n, [, checks]) => n + checks.length, 0);
console.log(`design-system-consumer: all ${total} protocol checks passed.`);
