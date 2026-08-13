export {
	CLASS_HELPER_NAMES,
	expandApplyGroups,
	expandVariantGroups,
	extractClasses,
	extractClassCandidates,
	extractClassesFromSource,
	VARIANT_HELPER_NAMES,
} from "./class-extraction.js";
export type {
	CandidateOrigin,
	ClassCandidate,
	SourceExtractionInput,
} from "./class-extraction.js";
export { isSourceFile } from "./source-files.js";
export {
	DEFAULT_PATTERNS,
	DEFAULT_EXCLUDES,
	collectProjectClasses,
	resolveSourceFilesAsync,
	scanSourceFilesAsync,
} from "./sources.js";
export { discoverPackageSafelistSources } from "./package-discovery.js";
export type { SafelistDiscoveryResult } from "./package-discovery.js";
