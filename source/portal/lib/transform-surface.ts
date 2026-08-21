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
import { BRIDGE_PATCHES } from '@tspml/shared';

/** `<id>.bundle.js` / `main.bundle.js` — the only shapes a surface can name. */
const BUNDLE_FILE_RE = /^(main|\d{1,6})\.bundle\.js$/;

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
  /** Loader-owned patches for this file. Empty for chunks until #87 Phase B. */
  readonly basePatches: readonly Record<string, unknown>[];
}

/**
 * Loader-owned base patches per surface.
 *
 * Chunks have none yet: #98 builds the surface, #87 Phase B is what puts undo-integrated
 * editor patches on chunk 112. An empty base is not a no-op path — user mixins still
 * compose against the chunk — but with neither base nor applicable user patches the
 * caller serves the upstream bytes untouched rather than running them through a babel
 * round-trip that can only change them.
 */
function basePatchesFor(kind: 'main' | 'chunk'): readonly Record<string, unknown>[] {
  return kind === 'main'
    ? (BRIDGE_PATCHES as unknown as readonly Record<string, unknown>[])
    : [];
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
      basePatches: basePatchesFor('main'),
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
    basePatches: basePatchesFor('chunk'),
  };
}
