/**
 * Which PolyTrack builds the portal can actually mod.
 *
 * The honest answer today is: exactly one. Every PolyTrack release re-minifies
 * and re-splits the webpack bundle, so TSPML pins a per-build symbol map
 * (`source/mappings/maps/polytrack-<ver>.json`) with a `bundleHash` integrity
 * pin. On a hash mismatch the resolver fails CLOSED — it serves vanilla rather
 * than risk mis-targeting a patch into whatever now occupies that position. Only
 * `polytrack-0.6.2.json` exists, so 0.6.2 is the only version where mods run.
 *
 * This module exists so the launcher can say that out loud instead of offering a
 * dropdown that silently hands you an unmodded game. A disabled option carrying
 * its reason is strictly better information than a working-looking control whose
 * effect is invisible until you notice none of your mods did anything.
 *
 * Making a second version selectable is a runtime-seam change, not a data edit
 * here. Three places currently hardcode 0.6.2 independently:
 *  - `lib/demo-transform.ts` and `lib/wasm-serve.ts` both STATICALLY import
 *    `@tspml/mappings/maps/polytrack-0.6.2.json` at build time;
 *  - `public/sw.js` declares `GAME_VERSION`, compared character-for-character
 *    against `lib/rewrite.ts` by `tests/sw-sync.test.ts`;
 *  - the proxy route has its own `DEFAULT_VERSION`.
 * Generating the 0.6.0 map (the regen pipeline can, its bundle is already
 * cached) is the easy half; threading the version through those three is the
 * actual work, and it is deliberately a separate change.
 */

export interface GameVersion {
  readonly id: string;
  /** False when no symbol map exists for this build. */
  readonly selectable: boolean;
  /** Shown next to a disabled option. Empty for selectable ones. */
  readonly reason: string;
}

export const GAME_VERSIONS: readonly GameVersion[] = [
  { id: '0.6.2', selectable: true, reason: '' },
  {
    id: '0.6.0',
    selectable: false,
    reason: 'no symbol map for this build yet — mods would fall back to vanilla',
  },
] as const;

/** The version a new instance gets. */
export const DEFAULT_GAME_VERSION = '0.6.2';

export function isSelectableGameVersion(id: string): boolean {
  return GAME_VERSIONS.some((v) => v.id === id && v.selectable);
}

/**
 * `id` if it is selectable, else {@link DEFAULT_GAME_VERSION}. Stored instances
 * are validated through this on READ rather than on write: the selectable set
 * grows over time, and a stored version that was unavailable when it was written
 * should start working when its map ships, not stay pinned to a fallback that
 * was baked in months earlier.
 */
export function resolveGameVersion(id: unknown): string {
  return typeof id === 'string' && isSelectableGameVersion(id) ? id : DEFAULT_GAME_VERSION;
}

/**
 * Why the picker only offers one option. Shown in the launcher next to it.
 * Deliberately explains the failure MODE, not just the absence: "there is no
 * map" invites "so what?", while "your mods would silently not run" does not.
 */
export const VERSION_PICKER_NOTE =
  '0.6.2 only, for now. TSPML rewrites the game bundle using a map pinned to one build. ' +
  'On any other version the bundle-hash check fails and every modded surface falls back to ' +
  'vanilla, so a picker that let you choose 0.6.0 today would just hand you an unmodded game. ' +
  'A 0.6.0 map is planned.';
