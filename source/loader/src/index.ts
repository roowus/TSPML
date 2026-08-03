/**
 * @tspml/loader — the clean loader core.
 *
 * Discovers mod packages, parses `mod.json`, semver-resolves dependencies,
 * topologically orders mods, and invokes entrypoints. Has no coupling to
 * minified PolyTrack internals (that lives in `@tspml/api-bridge`).
 */

// Types
export type {
  Author,
  AuthorEntry,
  DependencyMap,
  Environment,
  GlobalManifest,
  LoadResult,
  MixinDescriptor,
  Mod,
  ModApi,
  ModLoadStatus,
  ResolveContext,
  ResolveResult,
  VersionManifest,
  Warning,
  WarningKind,
} from './types.js';

export { ID_PATTERN, stubApi, TspmlMod } from './types.js';

// semver predicate engine
export {
  isValidRange,
  isValidVersion,
  maxSatisfying,
  minVersion,
  satisfies,
} from './semver.js';

// manifest parsing + validation
export {
  isValidId,
  ManifestError,
  parseGlobalManifest,
  parseVersionManifest,
} from './manifest.js';

// dependency resolution
export {
  DependencyError,
  modFromManifest,
  resolveDependencies,
} from './dependency.js';

// orchestration
export { load } from './loader.js';
export type { LoadOptions, ModDescriptor } from './loader.js';

// safety (M6, warn-only classification)
export { classifySafety } from './safety.js';
export type { LeaderboardRisk, SafetyReport, SafetyWarning } from './safety.js';
