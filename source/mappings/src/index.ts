/**
 * @tspml/mappings — versioned symbol map + fail-closed resolver for PolyTrack.
 *
 * Provides the v1 map schema, a loader/validator for map JSON files, the bundled
 * PolyTrack 0.6.2 map, and the fail-closed resolver that maps a stable name to a
 * concrete module locator — but only when the map's bundleHash matches the live
 * bundle (a stale map never returns a locator). Mods target stable names; this
 * package binds them to the current build.
 *
 * The map also declares which lazily-loaded CHUNK bundles a host may transform,
 * each with its own hash pin (#98) — see `resolveChunk`.
 */

// Schema
export type {
  BundleHash,
  ChunkEntry,
  GameMap,
  Locator,
  MapGenerated,
  ModuleAnchor,
  ModuleEntry,
  ModuleLocator,
  ResolveContext,
  ResolveResult,
  SurfaceFile,
  TargetSelector,
  TargetSpec,
  UnresolvedEntry,
} from './types.js';
export { MAIN_SURFACE_FILE, MAP_FORMAT_VERSION, targetSurface } from './types.js';

// Map loader + validator
export {
  defaultMapUrl,
  loadDefaultMap,
  loadMap,
  MapParseError,
  validateMap,
} from './map.js';

// Resolver
export {
  createResolver,
  resolve,
  resolveChunk,
  resolveTarget,
  transformableChunkIds,
} from './resolver.js';
export type { ChunkResolveResult, Resolver, TargetResolveResult } from './resolver.js';
