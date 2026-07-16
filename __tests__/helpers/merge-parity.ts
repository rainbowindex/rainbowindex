import { BUILTIN_STATIC_PROPS, PREFIX_PROPS } from "../../src/merge/props.js";

export function assertStaticUtilityParity(staticUtilities: ReadonlySet<string>): {
	missingInParser: string[];
	missingInMerge: string[];
} {
	const missingInParser: string[] = [];
	const missingInMerge: string[] = [];

	for (const key of Object.keys(BUILTIN_STATIC_PROPS)) {
		if (Object.hasOwn(PREFIX_PROPS, key)) continue;
		if (!staticUtilities.has(key)) {
			missingInParser.push(key);
		}
	}

	for (const key of staticUtilities) {
		if (!Object.hasOwn(BUILTIN_STATIC_PROPS, key)) {
			missingInMerge.push(key);
		}
	}

	return { missingInParser, missingInMerge };
}

export function assertPrefixPropParity(multiSegmentPrefixes: readonly string[]): {
	missingInParser: string[];
	missingInMerge: string[];
} {
	const multiSegSet = new Set(multiSegmentPrefixes);
	const missingInParser: string[] = [];
	const missingInMerge: string[] = [];

	for (const key of Object.keys(PREFIX_PROPS)) {
		if (key.includes("-") && !multiSegSet.has(key)) {
			missingInParser.push(key);
		}
	}

	for (const prefix of multiSegmentPrefixes) {
		if (!Object.hasOwn(PREFIX_PROPS, prefix)) {
			missingInMerge.push(prefix);
		}
	}

	return { missingInParser, missingInMerge };
}
