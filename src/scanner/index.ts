export {
	expandApplyGroups,
	expandVariantGroups,
	extractClasses,
	extractClassesFromSource,
} from "./class-extraction.js";
export type { SourceExtractionInput } from "./class-extraction.js";
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
