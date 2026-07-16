import { transform } from "lightningcss";

export function optimizeCSS(css: string): string {
	try {
		const result = transform({
			filename: "output.css",
			code: Buffer.from(css),
			minify: true,
			targets: {
				chrome: 96 << 16,
				firefox: 91 << 16,
				safari: (15 << 16) | (4 << 8),
			},
		});
		return result.code.toString();
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		const sanitized = msg
			.replace(/\/[a-zA-Z][\w.-]*(?:\/[\w.-]+)+/g, "<path>")
			.replace(/[A-Z]:\\[\w.-]+(?:\\[\w.-]+)+/gi, "<path>");
		throw new Error(`CSS optimization failed: ${sanitized}`);
	}
}
