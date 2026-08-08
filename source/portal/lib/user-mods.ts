/**
 * @tspml/portal — user-added mods (runtime mod loading).
 *
 * The portal's bundled demo mods are statically imported at build time, which
 * proves the loader works but is useless to a modder: they cannot run their own
 * mod without forking this repo. This module is the missing half — a mod a user
 * pastes into the portal (manifest + built entrypoint JS) is persisted to
 * `localStorage` and loaded through the SAME `@tspml/loader` path as the bundled
 * mods: parsed, validated, dependency-resolved, safety-classified, isolated.
 *
 * Scope (deliberate):
 * - **Tier-1 only.** A user mod's entrypoint gets the full `api` (events,
 *   keybinds, tracks, audio). Its *declared mixins are NOT applied*: the mixin
 *   transform runs server-side in the proxy route when the bundle is fetched,
 *   and the server knows nothing of this browser's localStorage. Rather than
 *   silently ignoring a `mixins` field (PML's failure mode we exist to fix),
 *   the loader surfaces an explicit warning per affected mod. Applying user
 *   mixins needs the patch set to reach the proxy — tracked in #62.
 * - **The code runs unsandboxed in the portal origin, in the user's own
 *   browser.** That is what a mod loader does — a mod IS arbitrary code — and
 *   the portal has no accounts, no cookies worth stealing, and no server state.
 *   The Add form says this in plain words; `classifySafety` labels each mod
 *   (warn-only, per ADR: never hard-block).
 *
 * Storage shape is versioned defensively: `readUserMods` returns only entries it
 * can prove are well-formed, so a corrupted or future-shaped store degrades to
 * "no user mods" rather than a boot loop.
 */

const STORAGE_KEY = 'tspml.userMods.v1';

/** A mod the user added at runtime. `manifest` stays RAW (unknown): the loader
 *  owns validation, and re-validating here would just drift from it. */
export interface UserModRecord {
  /** The parsed-but-unvalidated `mod.json` object. */
  readonly manifest: Record<string, unknown>;
  /** The BUILT entrypoint module source (ES module, default export). */
  readonly code: string;
  /** Disabled mods stay stored but are not loaded. */
  readonly enabled: boolean;
  /** ISO date the mod was added (display only). */
  readonly addedAt: string;
}

/** The `id` a record claims, or null if it doesn't even have one. */
export function userModId(record: UserModRecord): string | null {
  const id = record.manifest.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isUserModRecord(v: unknown): v is UserModRecord {
  return (
    isRecord(v) &&
    isRecord(v.manifest) &&
    typeof v.code === 'string' &&
    typeof v.enabled === 'boolean' &&
    typeof v.addedAt === 'string'
  );
}

/**
 * Read the stored user mods. Never throws: no storage (SSR, disabled cookies),
 * corrupt JSON, or a wrong shape all degrade to `[]` — a broken store must not
 * take the portal down with it. Malformed ENTRIES are dropped individually so
 * one bad row doesn't discard the user's other mods.
 */
export function readUserMods(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): UserModRecord[] {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isUserModRecord);
}

/**
 * Persist the user mods. Returns false (rather than throwing) when storage is
 * unavailable or full — the caller surfaces that; the in-memory session still
 * works, it just won't survive a reload.
 */
export function saveUserMods(
  mods: readonly UserModRecord[],
  storage: Pick<Storage, 'setItem'> | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(mods));
    return true;
  } catch {
    return false;
  }
}

function defaultStorage(): Storage | null {
  // Guarded twice: `window` is absent under SSR/prerender, and ACCESSING
  // `window.localStorage` itself throws when a browser blocks storage.
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The entry-specifier scheme for user mods: `user:<id>`. The loader's
 * `importEntry` hook maps these back to the stored code — a user mod never
 * touches the network or the bundler.
 */
export const USER_ENTRY_PREFIX = 'user:';

export function userEntrySpecifier(id: string): string {
  return `${USER_ENTRY_PREFIX}${id}`;
}

/**
 * Import an ES module from source text via a Blob URL.
 *
 * This is how pasted code becomes a live module without a server round-trip.
 * The URL is revoked after import either way — module namespaces survive their
 * URL, and leaking one object URL per (re)load would pin every old mod version
 * in memory for the tab's lifetime.
 *
 * Browser-only by nature (Blob/createObjectURL); the node-side unit tests cover
 * everything around it and the headless smoke covers this path for real.
 */
export async function importFromSource(code: string): Promise<unknown> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    // webpackIgnore/vite-ignore: a runtime-computed blob: URL must reach the
    // BROWSER's import(), not the bundler's graph.
    return await import(/* webpackIgnore: true */ /* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
