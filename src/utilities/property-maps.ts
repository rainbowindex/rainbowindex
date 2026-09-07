/**
 * Which CSS properties each utility family writes.
 *
 * The single source of truth for both sides of the pipeline: the generators
 * (utilities/spacing.ts, utilities/borders.ts, utilities/effects/filters.ts)
 * emit declarations from these maps, and the merge tables (merge/static-props.ts,
 * merge/prefix-props.ts) spread them into their claim entries — so the
 * properties `ri()` claims can never drift from the CSS the engine emits.
 *
 * It lives in the utilities layer because that is what owns the question:
 * merge consumes the answer. Frozen pure data with no imports, so a browser
 * bundle pays only for the bytes.
 */

export const PADDING_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	p: ["padding"],
	px: ["padding-inline"],
	py: ["padding-block"],
	pt: ["padding-block-start"],
	pb: ["padding-block-end"],
	pl: ["padding-inline-start"],
	pr: ["padding-inline-end"],
	ps: ["padding-inline-start"],
	pe: ["padding-inline-end"],
	pbs: ["padding-block-start"],
	pbe: ["padding-block-end"],
});

export const MARGIN_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	m: ["margin"],
	mx: ["margin-inline"],
	my: ["margin-block"],
	mt: ["margin-block-start"],
	mb: ["margin-block-end"],
	ml: ["margin-inline-start"],
	mr: ["margin-inline-end"],
	ms: ["margin-inline-start"],
	me: ["margin-inline-end"],
	mbs: ["margin-block-start"],
	mbe: ["margin-block-end"],
});

export const GAP_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	gap: ["gap"],
	"gap-x": ["column-gap"],
	"gap-y": ["row-gap"],
});

export const INSET_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	inset: ["inset"],
	"inset-x": ["inset-inline"],
	"inset-y": ["inset-block"],
	top: ["inset-block-start"],
	bottom: ["inset-block-end"],
	left: ["inset-inline-start"],
	right: ["inset-inline-end"],
	start: ["inset-inline-start"],
	end: ["inset-inline-end"],
	"inset-s": ["inset-inline-start"],
	"inset-e": ["inset-inline-end"],
	"inset-bs": ["inset-block-start"],
	"inset-be": ["inset-block-end"],
});

export const SCROLL_MARGIN_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	"scroll-m": ["scroll-margin"],
	"scroll-mx": ["scroll-margin-inline"],
	"scroll-my": ["scroll-margin-block"],
	"scroll-mt": ["scroll-margin-block-start"],
	"scroll-mb": ["scroll-margin-block-end"],
	"scroll-ml": ["scroll-margin-inline-start"],
	"scroll-mr": ["scroll-margin-inline-end"],
	"scroll-ms": ["scroll-margin-inline-start"],
	"scroll-me": ["scroll-margin-inline-end"],
	"scroll-mbs": ["scroll-margin-block-start"],
	"scroll-mbe": ["scroll-margin-block-end"],
});

export const SCROLL_PADDING_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
	"scroll-p": ["scroll-padding"],
	"scroll-px": ["scroll-padding-inline"],
	"scroll-py": ["scroll-padding-block"],
	"scroll-pt": ["scroll-padding-block-start"],
	"scroll-pb": ["scroll-padding-block-end"],
	"scroll-pl": ["scroll-padding-inline-start"],
	"scroll-pr": ["scroll-padding-inline-end"],
	"scroll-ps": ["scroll-padding-inline-start"],
	"scroll-pe": ["scroll-padding-inline-end"],
	"scroll-pbs": ["scroll-padding-block-start"],
	"scroll-pbe": ["scroll-padding-block-end"],
});

/** Directional border-width prefixes → per-side logical width property.
 *  The generator (utilities/borders.ts) derives its trailing-dash entries
 *  from this map at module init. */
export const BORDER_DIR_PROPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	"border-t": ["border-block-start-width"],
	"border-b": ["border-block-end-width"],
	"border-l": ["border-inline-start-width"],
	"border-r": ["border-inline-end-width"],
	"border-s": ["border-inline-start-width"],
	"border-e": ["border-inline-end-width"],
	"border-bs": ["border-block-start-width"],
	"border-be": ["border-block-end-width"],
	"border-x": ["border-inline-width"],
	"border-y": ["border-block-width"],
});
/**
 * Every slot variable in the composable `filter` / `backdrop-filter` chains.
 *
 * These belong to the spellings that REPLACE the chain — `filter-none`,
 * `filter-[v]` and the backdrop equivalents — so those dominate any individual
 * filter function to their left. An individual function claims only its own
 * slot plus the shared shorthand, which is what lets `blur-sm grayscale`
 * survive as a pair while `blur-sm blur-md` still dedupes.
 *
 * The shadow and ring families work the same way and need no such list:
 * nothing expands `box-shadow`, so claiming it never reaches another family's
 * slot. Filters only needed one because the reset is spelled as a member of
 * the family rather than as a separate property.
 */
// Listed in CSS application order — filter functions compose in the order they
// are written, so this order is the emitted one. The merge side treats the list
// as a set and does not care.
export const FILTER_SLOTS: readonly string[] = Object.freeze([
	"--ri-blur",
	"--ri-brightness",
	"--ri-contrast",
	"--ri-grayscale",
	"--ri-hue-rotate",
	"--ri-invert",
	"--ri-saturate",
	"--ri-sepia",
	"--ri-drop-shadow",
]);

export const BACKDROP_FILTER_SLOTS: readonly string[] = Object.freeze([
	"--ri-backdrop-blur",
	"--ri-backdrop-brightness",
	"--ri-backdrop-contrast",
	"--ri-backdrop-grayscale",
	"--ri-backdrop-hue-rotate",
	"--ri-backdrop-invert",
	"--ri-backdrop-saturate",
	"--ri-backdrop-sepia",
	"--ri-backdrop-opacity",
]);

/**
 * The composed chains those slots stand in, in application order.
 *
 * Derived rather than written out a second time: filter functions compose in
 * the order they appear, so this string and the slot list above have to hold
 * the same names — and did, as two hand-maintained copies, until this.
 */
export const FILTER_COMPOSED = FILTER_SLOTS.map((slot) => `var(${slot}, )`).join(" ");
export const BACKDROP_FILTER_COMPOSED = BACKDROP_FILTER_SLOTS.map((slot) => `var(${slot}, )`).join(
	" ",
);
