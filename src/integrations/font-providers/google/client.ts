import type { GoogleFontMeta } from "./state.js";

const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;
const MAX_RETRIES = 2;
const FETCH_TIMEOUT_MS = 5000;

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function toGoogleFontMetaMap(data: {
	familyMetadataList: Array<{
		family: string;
		axes: Array<{ tag: string; min: number; max: number }>;
		category: string;
	}>;
}): Map<string, GoogleFontMeta> {
	const newCache = new Map<string, GoogleFontMeta>();
	for (const font of data.familyMetadataList) {
		const wghtAxis = font.axes.find((a) => a.tag === "wght");
		const axes = font.axes.map((a) => {
			const axis = { tag: a.tag, start: a.min, end: a.max };
			Object.freeze(axis);
			return axis;
		});
		Object.freeze(axes);
		const entry: GoogleFontMeta = {
			family: font.family,
			variable: wghtAxis ? wghtAxis.min !== wghtAxis.max : false,
			axes,
			category: font.category,
		};
		Object.freeze(entry);
		newCache.set(font.family, entry);
	}
	return newCache;
}

async function readJsonResponse(res: Response): Promise<{
	familyMetadataList: Array<{
		family: string;
		axes: Array<{ tag: string; min: number; max: number }>;
		category: string;
	}>;
}> {
	const reader = res.body?.getReader();
	if (!reader) {
		throw new Error("[RI-1207] Google Fonts metadata response has no readable body.");
	}

	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > MAX_RESPONSE_SIZE) {
			reader.cancel();
			throw new Error(
				`[RI-1207] Google Fonts metadata response too large (>${MAX_RESPONSE_SIZE} bytes).`,
			);
		}
		chunks.push(value);
	}

	const text = new TextDecoder().decode(
		chunks.length === 1 ? chunks[0] : await new Blob(chunks as BlobPart[]).arrayBuffer(),
	);
	return JSON.parse(text) as {
		familyMetadataList: Array<{
			family: string;
			axes: Array<{ tag: string; min: number; max: number }>;
			category: string;
		}>;
	};
}

export async function fetchGoogleFontMetadata(): Promise<Map<string, GoogleFontMeta>> {
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		try {
			const res = await fetch("https://fonts.google.com/metadata/fonts", {
				signal: controller.signal,
			});
			const contentLength = res.headers.get("content-length");
			if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE) {
				throw new Error(
					`[RI-1207] Google Fonts metadata response too large (${contentLength} bytes).`,
				);
			}
			// Throw into the shared catch below — it owns the retry/backoff policy,
			// so every retryable failure (HTTP status, content type, network,
			// oversize) backs off identically.
			if (!res.ok) {
				throw new Error(`[RI-1205] Google Fonts metadata request failed with HTTP ${res.status}.`);
			}
			const contentType = res.headers.get("content-type") ?? "";
			if (contentType && !contentType.includes("json")) {
				throw new Error(
					`[RI-1207] Google Fonts metadata returned unexpected Content-Type "${contentType}" instead of JSON.`,
				);
			}

			const data = await readJsonResponse(res);
			return toGoogleFontMetaMap(data);
		} catch (err) {
			if (attempt < MAX_RETRIES) {
				await wait(1000 * 2 ** attempt);
				continue;
			}
			throw err;
		} finally {
			clearTimeout(timeout);
		}
	}

	throw new Error("[RI-1205] Exhausted Google Fonts metadata fetch retries.");
}
