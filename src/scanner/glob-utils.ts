import { isAbsolute, win32 } from "node:path";

export function validateGlobPattern(pattern: string): string | null {
	if (!pattern?.trim()) {
		return "Glob pattern is empty.";
	}
	if (pattern.includes("\0")) {
		return "Glob pattern contains a null byte, which is invalid in file paths.";
	}
	if (isAbsolute(pattern) || win32.isAbsolute(pattern)) {
		return `Glob pattern "${pattern}" must be relative, not absolute.`;
	}
	const segments = pattern.split(/[\\/]+/);
	for (const seg of segments) {
		if (seg === "..") {
			return `Glob pattern "${pattern}" must not traverse parent directories (".."). Restructure your project layout so source files are within the project root, or use @source with a pattern rooted at the project directory.`;
		}
	}
	return null;
}
