import { describe, expect, test } from "vitest";
import * as cliEntry from "../../src/entries/cli.js";

describe("rainbowindex CLI entry", () => {
	test("importing the module does not execute the CLI", () => {
		// The entry runs main() only under the isDirectExecution realpath check
		// (argv[1] keeps the .bin symlink path while import.meta.url is
		// realpathed). Importing it — as this test just did — must be
		// side-effect free: no help output, no build, no exit code.
		expect(Object.keys(cliEntry)).toEqual([]);
		expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
	});
});
