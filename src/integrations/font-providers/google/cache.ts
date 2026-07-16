import { createHash, randomUUID } from "node:crypto";
import { open as fsOpen, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { resolve, dirname, join, isAbsolute } from "node:path";
import { isAbsolute as win32IsAbsolute } from "node:path/win32";
import { googleFontInternals, SAFE_FONT_FAMILY_RE, type GoogleFontMeta } from "./state.js";

const MAX_FONT_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

function getFontCacheDir(): string {
	if (googleFontInternals.validatedCacheDir !== null) return googleFontInternals.validatedCacheDir;
	const raw = process.env.RI_CACHE_DIR || "node_modules/.cache/rainbowindex";
	if (isAbsolute(raw) || win32IsAbsolute(raw)) {
		throw new Error(
			`[RI-1208] RI_CACHE_DIR must be a relative path, got absolute path: "${raw}". Use a relative path like "node_modules/.cache/rainbowindex".`,
		);
	}
	if (raw.split(/[\\/]/).some((s) => s === "..")) {
		throw new Error(
			`[RI-1209] RI_CACHE_DIR must not contain ".." segments: "${raw}". Use a direct relative path like "node_modules/.cache/rainbowindex".`,
		);
	}
	googleFontInternals.validatedCacheDir = raw;
	return raw;
}

export function getFontCacheFile(): string {
	return `${getFontCacheDir()}/google.json`;
}

function getResolvedCachePath(): string {
	if (
		googleFontInternals.resolvedCachePath !== null &&
		googleFontInternals.validatedCacheDir !== null
	) {
		return googleFontInternals.resolvedCachePath;
	}
	googleFontInternals.resolvedCachePath = resolve(process.cwd(), getFontCacheFile());
	return googleFontInternals.resolvedCachePath;
}

function getFontCacheTTL(): number {
	const envVal = process.env.RI_FONT_CACHE_TTL;
	if (envVal) {
		const seconds = Number(envVal);
		if (!Number.isNaN(seconds) && seconds >= 0) {
			if (seconds > MAX_FONT_CACHE_TTL_SECONDS) {
				console.warn(
					`[RI-1211] RI_FONT_CACHE_TTL=${seconds} exceeds maximum of ${MAX_FONT_CACHE_TTL_SECONDS} seconds (30 days). Clamping to 30 days.`,
				);
				return MAX_FONT_CACHE_TTL_SECONDS * 1000;
			}
			return seconds * 1000;
		}
	}
	return 7 * 24 * 60 * 60 * 1000;
}

function parseCachedMetaEntries(raw: string): Map<string, GoogleFontMeta> | null {
	const parsed = JSON.parse(raw);
	if (
		!parsed ||
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		!("checksum" in parsed) ||
		!("entries" in parsed)
	) {
		return null;
	}
	if (!Array.isArray(parsed.entries)) return null;
	const entriesJson = JSON.stringify(parsed.entries);
	const expected = createHash("sha256").update(entriesJson).digest("hex");
	if (typeof parsed.checksum !== "string" || parsed.checksum !== expected) return null;
	const entries: unknown[] = parsed.entries;

	const newCache = new Map<string, GoogleFontMeta>();
	for (const rawItem of entries) {
		if (!rawItem || typeof rawItem !== "object") continue;
		const item = rawItem as Record<string, unknown>;
		if (
			typeof item.family !== "string" ||
			typeof item.variable !== "boolean" ||
			typeof item.category !== "string" ||
			(item.axes !== undefined && !Array.isArray(item.axes))
		) {
			continue;
		}
		if (!SAFE_FONT_FAMILY_RE.test(item.family)) continue;
		const axes = Array.isArray(item.axes)
			? item.axes
					.filter((a: unknown): a is { tag: string; start: number; end: number } => {
						if (!a || typeof a !== "object") return false;
						const axis = a as Record<string, unknown>;
						return (
							typeof axis.tag === "string" &&
							typeof axis.start === "number" &&
							Number.isFinite(axis.start) &&
							typeof axis.end === "number" &&
							Number.isFinite(axis.end)
						);
					})
					.map((a) => {
						const axis = { tag: a.tag, start: a.start, end: a.end };
						Object.freeze(axis);
						return axis;
					})
			: undefined;
		if (axes) Object.freeze(axes);
		const entry: GoogleFontMeta = {
			family: item.family,
			variable: item.variable,
			axes,
			category: item.category,
		};
		Object.freeze(entry);
		newCache.set(entry.family, entry);
	}

	return newCache.size > 0 ? newCache : null;
}

export async function loadFontCache(ignoreExpiry = false): Promise<boolean> {
	try {
		const cachePath = getResolvedCachePath();
		const fh = await fsOpen(cachePath, "r");
		let raw: string;
		try {
			if (!ignoreExpiry) {
				const st = await fh.stat();
				if (Date.now() - st.mtimeMs > getFontCacheTTL()) return false;
			}
			raw = await fh.readFile("utf-8");
		} finally {
			await fh.close();
		}

		const newCache = parseCachedMetaEntries(raw);
		if (!newCache) return false;
		googleFontInternals.googleFontState = { cache: newCache, fetched: true };
		return true;
	} catch {
		return false;
	}
}

export async function saveFontCache(): Promise<void> {
	try {
		const cachePath = getResolvedCachePath();
		await mkdir(dirname(cachePath), { recursive: true });
		const entries = Array.from(googleFontInternals.googleFontState.cache.values());
		const entriesJson = JSON.stringify(entries);
		const checksum = createHash("sha256").update(entriesJson).digest("hex");
		const payload = `{"checksum":${JSON.stringify(checksum)},"entries":${entriesJson}}`;
		// Atomic publish: the temp file lives next to the destination (same
		// filesystem, so rename cannot fail with EXDEV) and is best-effort
		// unlinked even on failure so no `.google-*.tmp` files accumulate.
		const tmpPath = join(dirname(cachePath), `.google-${process.pid}-${randomUUID()}.tmp`);
		try {
			await writeFile(tmpPath, payload);
			await rename(tmpPath, cachePath);
		} finally {
			await unlink(tmpPath).catch(() => {});
		}
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		console.warn(
			`[RI-1210] Failed to write font cache to ${getFontCacheFile()}: ${reason}. Each build will fetch from Google Fonts. Set RI_CACHE_DIR to a writable path or use RI_OFFLINE=1 with a pre-populated cache.`,
		);
	}
}
