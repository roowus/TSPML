/**
 * @tspml/portal — which proxied files may be transformed, and against which pin (#98).
 *
 * Before this, "transformable" meant one hardcoded string: `main.bundle.js`. But the
 * game splits real feature code into numbered webpack chunks fetched on demand
 * (`i.e(112)` -> `<version>/112.bundle.js`), so anything living in a chunk — the whole
 * track editor — could not be anchored, injected, or captured. That is the blocker
 * under the full #87 editor API.
 *
 * A SURFACE is the answer to "may I transform this request, and what do I check it
 * against". Three things vary per file and every one of them is a correctness trap if
 * shared:
 *
 *  - the PIN. A chunk re-minifies independently of the main bundle. Gating a chunk on
 *    `map.bundleHash` would trip on every main-bundle change (over-trip) or, worse,
 *    accept a re-minified chunk whose anchors no longer fit (under-protect).
 *  - the BASE PATCHES. The loader's bridge patches anchor in the main bundle. Feeding
 *    them to a chunk makes every one of them miss, and base patches are all-or-nothing,
 *    so the chunk would fail-closed to vanilla *for a reason that is not drift*.
 *  - the FILENAME stamped into the emitted source map.
 *
 * The ALLOWLIST is map data, never a constant here: the set of chunks and their hashes
 * is per-build and regenerated with the rest of the map (see `@tspml/mappings`'s
 * `chunks` section). A chunk absent from the map is proxied verbatim.
 *
 * Pure and map-injected so the unit tests can drive it without the real pinned map.
 */
import { resolveChunk } from '@tspml/mappings';
import type { GameMap } from '@tspml/mappings';
import { BRIDGE_PATCHES, EDITOR_PATCHES } from '@tspml/shared';

/** `<id>.bundle.js` / `main.bundle.js` — the only shapes a surface can name. */
const BUNDLE_FILE_RE = /^(main|\d{1,6})\.bundle\.js$/;

/**
 * The chunk carrying the track editor at 0.6.2 (#87).
 *
 * A build-specific id, so it lives next to the code that uses it rather than being
 * spread through the codebase: a PolyTrack release can renumber chunks, and when it
 * does this constant and the map's `chunks` section are what move together.
 */
const EDITOR_CHUNK_ID = '112';

export interface TransformSurface {
  /** `'main'` = the main bundle; `'chunk'` = an allowlisted `<id>.bundle.js`. */
  readonly kind: 'main' | 'chunk';
  /** Requested filename, also stamped into the emitted source map. */
  readonly file: string;
  /** Chunk id for `kind: 'chunk'`; null for the main bundle. */
  readonly chunkId: string | null;
  /**
   * The pin THESE bytes must match. The engine's fail-closed gate compares the live
   * hash against it and applies nothing on mismatch, so a re-minified chunk serves
   * vanilla — that chunk only. The main bundle's gate is untouched by a chunk verdict.
   */
  readonly expectedHash: string;
  /**
   * Loader-owned patches for THIS file. Per-surface, never shared: the main bundle gets
   * the bridge patches, chunk 112 gets the editor patches (#87 Phase C), and every other
   * declared chunk gets an empty base and composes only user mixins.
   */
  readonly basePatches: readonly Record<string, unknown>[];
}

/**
 * Loader-owned base patches per surface.
 *
 * Keyed by the CHUNK ID, not by `kind`. The bridge patches anchor in the main bundle and
 * the editor patches anchor in chunk 112's module 7112; feeding either set to the other
 * file makes every patch in it miss, and base patches are all-or-nothing, so that file
 * would fail closed to vanilla *for a reason that is not drift*.
 *
 * Chunk 112 is the first chunk with a non-empty base (#87 Phase C). The other declared
 * chunks (535, 604, 657) still have none, and that empty-base path stays live and stays
 * tested: it is not a no-op branch (user mixins still compose against those chunks) and
 * it is the branch that shipped a bodyless 500 in #106.
 */
function basePatchesFor(
  kind: 'main' | 'chunk',
  chunkId: string | null,
): readonly Record<string, unknown>[] {
  if (kind === 'main') return BRIDGE_PATCHES as unknown as readonly Record<string, unknown>[];
  if (chunkId === EDITOR_CHUNK_ID) {
    return EDITOR_PATCHES as unknown as readonly Record<string, unknown>[];
  }
  return [];
}

/**
 * The transform surface for a proxied path, or null when the request is not
 * transformable (and must be proxied verbatim).
 *
 * Null covers three distinct situations that all mean "pass it through":
 *   - the path is not a bundle file at all (assets, HTML, the sim worker);
 *   - it is a chunk the map does not declare — routine, not an error: TSPML has
 *     verified no anchors against it;
 *   - the host is not the default game host, so no pin in this map applies to it.
 *
 * Note what this does NOT decide: whether the live bytes match the pin. That needs the
 * bytes, which a caller does not have when it is choosing whether to buffer the
 * response at all. It is the engine's hash gate that fails closed on the mismatch.
 */
export function transformSurfaceFor(
  map: GameMap,
  isDefaultHost: boolean,
  segments: readonly string[],
): TransformSurface | null {
  if (!isDefaultHost) return null;
  if (segments.length !== 1) return null;
  const file = segments[0] ?? '';
  const m = BUNDLE_FILE_RE.exec(file);
  if (!m) return null;
  const id = m[1]!;
  if (id === 'main') {
    return {
      kind: 'main',
      file,
      chunkId: null,
      expectedHash: map.bundleHash,
      basePatches: basePatchesFor('main', null),
    };
  }
  // Allowlist question only — `resolveChunk` without a live hash answers "is this id
  // declared", never "did the bytes match".
  const res = resolveChunk(map, id);
  if (!res.ok) return null;
  return {
    kind: 'chunk',
    file,
    chunkId: id,
    expectedHash: res.chunk.hash,
    basePatches: basePatchesFor('chunk', id),
  };
}
