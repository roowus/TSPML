/**
 * @tspml/mappings — versioned symbol map + fail-closed resolver for PolyTrack.
 *
 * Provides the v1 map schema, a loader/validator for map JSON files, the bundled
 * PolyTrack 0.6.2 map, and the fail-closed resolver that maps a stable name to a
 * concrete module locator — but only when the map's bundleHash matches the live
 * bundle (a stale map never returns a locator). This is the Yarn analog: mods
 * target stable names; this package binds them to the current build.
 */

// Schema
export type {
  BundleHash,
  GameMap,
  Locator,
  MapGenerated,
  ModuleAnchor,
  ModuleEntry,
  ModuleLocator,
  ResolveContext,
  ResolveResult,
  TargetSelector,
  TargetSpec,
  UnresolvedEntry,
} from './types.js';
export { MAP_FORMAT_VERSION } from './types.js';

// Map loader + validator
export {
  defaultMapUrl,
  loadDefaultMap,
  loadMap,
  MapParseError,
  validateMap,
} from './map.js';

// Resolver
export { createResolver, resolve, resolveTarget } from './resolver.js';
export type { Resolver, TargetResolveResult } from './resolver.js';
