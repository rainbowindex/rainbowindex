/**
 * Runtime policy helpers shared across source and bundled execution.
 *
 * These helpers keep environment-sensitive behavior explicit and avoid
 * build-only injected globals for simple dev diagnostics.
 */

const IS_PROD = typeof process !== "undefined" && process.env?.NODE_ENV === "production";

export const IS_DEV = !IS_PROD;

export function devWarn(message: string): void {
	if (!IS_PROD) console.warn(message);
}
