import { writeFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { devWarn } from "../runtime.js";

function isIgnorableCleanupError(err: unknown): boolean {
	return (
		!!err &&
		typeof err === "object" &&
		"code" in err &&
		((err as { code?: string }).code === "ENOENT" || (err as { code?: string }).code === "EPERM")
	);
}

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
	const dir = dirname(filePath);
	const tmp = join(dir, `.ri-tmp-${process.pid}-${Date.now()}`);
	try {
		await writeFile(tmp, content);
		await rename(tmp, filePath);
	} catch (err) {
		try {
			await unlink(tmp);
		} catch (cleanupErr) {
			if (!isIgnorableCleanupError(cleanupErr)) {
				const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
				devWarn(`[RI-DEV] Failed to remove temp file "${tmp}": ${msg}`);
			}
		}
		throw err;
	}
}
