/**
 * Modular CSS reset, grouped into the PreflightConfig categories.
 *
 * All modules are enabled by default. Users control via @preflight directive:
 *   @preflight;                    → all on (default)
 *   @preflight { forms: off; }    → disable forms category
 *   @preflight off;               → disable entirely
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { PreflightConfig } from "../directives/foundation.js";

export const DEFAULT_PREFLIGHT: PreflightConfig = {
	core: true,
	typography: true,
	content: true,
	forms: true,
	interactive: true,
	modern: true,
};

// ---------------------------------------------------------------------------
// Module Definitions
// ---------------------------------------------------------------------------

interface PreflightModule {
	name: string;
	category: keyof PreflightConfig;
	css: string;
}

const modules: PreflightModule[] = [
	// ── Core ─────────────────────────────────────────────────

	{
		name: "box-sizing",
		category: "core",
		css: `*, *::before, *::after {
  box-sizing: border-box;
}`,
	},
	{
		name: "margins",
		category: "core",
		css: `body, h1, h2, h3, h4, h5, h6, p, figure, blockquote, dl, dd, pre, ol, ul, menu {
  margin: 0;
}`,
	},
	{
		name: "borders",
		category: "core",
		css: `*, *::before, *::after {
  border-width: 0;
  border-style: solid;
  border-color: inherit;
}`,
	},
	{
		name: "root-defaults",
		category: "core",
		css: `:root {
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
  tab-size: 4;
}
body {
  line-height: inherit;
  font-family: var(--font-sans);
}
code, kbd, samp, pre {
  font-family: var(--font-mono);
  font-size: 1em;
}`,
	},

	// ── Typography ───────────────────────────────────────────

	{
		name: "font-smoothing",
		category: "typography",
		css: `body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}`,
	},
	{
		name: "font-inherit",
		category: "typography",
		css: `button, input, optgroup, select, textarea {
  font-family: inherit;
  font-feature-settings: inherit;
  font-variation-settings: inherit;
  font-size: 100%;
  font-weight: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  color: inherit;
}`,
	},
	{
		name: "heading-sizes",
		category: "typography",
		css: `h1, h2, h3, h4, h5, h6 {
  font-size: inherit;
  font-weight: inherit;
}`,
	},
	{
		name: "link-reset",
		category: "typography",
		css: `a {
  color: inherit;
  text-decoration: inherit;
}`,
	},

	// ── Content ──────────────────────────────────────────────

	{
		name: "media-block",
		category: "content",
		css: `img, svg, video, canvas, audio, iframe, embed, object {
  display: block;
  max-inline-size: 100%;
}
img, video {
  block-size: auto;
}`,
	},
	{
		name: "list-reset",
		category: "content",
		css: `ol, ul, menu {
  list-style: none;
  padding: 0;
}`,
	},
	{
		name: "table-reset",
		category: "content",
		css: `table {
  text-indent: 0;
  border-color: inherit;
  border-collapse: collapse;
}`,
	},
	{
		name: "hr-reset",
		category: "content",
		css: `hr {
  block-size: 0;
  border-top-width: 1px;
  color: inherit;
}`,
	},

	// ── Forms ────────────────────────────────────────────────

	{
		name: "button-reset",
		category: "forms",
		css: `button, [role="button"] {
  cursor: pointer;
  padding: 0;
}
button {
  background-color: transparent;
  background-image: none;
}`,
	},
	{
		name: "input-reset",
		category: "forms",
		css: `input::placeholder, textarea::placeholder {
  opacity: 1;
  color: color-mix(in oklab, currentColor 48%, transparent);
}
input:where([type="button"], [type="reset"], [type="submit"]) {
  -webkit-appearance: button;
  appearance: button;
}`,
	},
	{
		name: "textarea-reset",
		category: "forms",
		css: `textarea {
  resize: vertical;
}`,
	},
	{
		name: "fieldset-reset",
		category: "forms",
		css: `fieldset {
  margin: 0;
  padding: 0;
}
legend {
  padding: 0;
}`,
	},

	// ── Interactive ──────────────────────────────────────────

	{
		name: "focus-visible",
		category: "interactive",
		css: `:focus-visible {
  outline-width: 2px;
  outline-style: solid;
  outline-offset: 2px;
  outline-color: currentColor;
}`,
	},
	{
		name: "dialog-reset",
		category: "interactive",
		css: `dialog {
  padding: 0;
}
dialog::backdrop {
  background-color: oklch(0 0 0 / 0.5);
}`,
	},
	{
		name: "summary-reset",
		category: "interactive",
		css: `summary {
  display: list-item;
  cursor: pointer;
}`,
	},

	// ── Modern ───────────────────────────────────────────────

	{
		name: "interpolate-size",
		category: "modern",
		css: `@supports (interpolate-size: allow-keywords) {
  :root {
    interpolate-size: allow-keywords;
  }
}`,
	},
	{
		name: "overflow-wrap",
		category: "modern",
		css: `body {
  overflow-wrap: break-word;
}`,
	},
	{
		name: "color-scheme",
		category: "modern",
		css: `html {
  color-scheme: light dark;
}
html[data-appearance="dark"] {
  color-scheme: dark;
}
html[data-appearance="light"] {
  color-scheme: light;
}`,
	},
];

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate the preflight CSS string based on configuration.
 *
 * @param config - Which categories to enable. Defaults to all on.
 * @returns CSS string with all enabled modules.
 */
export function generatePreflight(config: PreflightConfig = DEFAULT_PREFLIGHT): string {
	const enabledModules = modules.filter((m) => config[m.category]);

	if (enabledModules.length === 0) return "";

	return enabledModules.map((m) => `/* preflight: ${m.name} */\n${m.css}`).join("\n\n");
}
