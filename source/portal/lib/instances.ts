/**
 * @tspml/portal — instances: named launch profiles for the launcher.
 *
 * An instance is a MultiMC-shaped idea. It has a name, a game version, and a
 * record of when it was last played; launching one means navigating to
 * `/play?instance=<id>`, and closing it means navigating away, which unmounts
 * the game iframe and actually stops the game.
 *
 * ## Instances do NOT own mods
 *
 * There is exactly one mod pool — {@link USER_MODS_STORAGE_KEY} — and instances
 * OVERLAY it. An instance stores `disabledModIds`, a list of ids it turns off
 * for itself; it never holds a copy of a record.
 *
 * That is a quota decision before it is a design one. `IMPORT_LIMITS`
 * permits a 2 MB entrypoint against a localStorage budget of roughly 5 MB, so
 * three instances holding two mods each would exceed it — and `saveUserMods`
 * returns `false` rather than throwing when a write fails, so the failure mode
 * is a mod silently not persisting rather than a visible error. The launcher
 * has to say this out loud: instances share one mod library and differ in
 * which mods are switched on.
 *
 * There is a testing reason too. Two smokes seed `tspml.userMods.v1` directly
 * via `addInitScript` and then require that mod to load. A model that read mods
 * from a per-instance key first would ignore the seed and fail for a reason
 * that has nothing to do with what the smoke is checking.
 *
 * ## Migration is a lazy READ, never a write
 *
 * When nothing is stored — a first visit, a cold Playwright profile, a cleared
 * browser — {@link readInstances} SYNTHESIZES a single `Default` instance and
 * returns it unpersisted. Nothing is written until a real mutation happens.
 *
 * The alternative (write-on-first-read) would mean the portal mutates a
 * visitor's storage merely because they loaded a page, and would put bytes into
 * a smoke's profile behind its back. A cold profile should behave exactly as it
 * did before instances existed, and this is what makes that true.
 *
 * Reads never throw. Corrupt JSON, a wrong shape, a future schemaVersion, or
 * storage that is blocked outright all degrade to the synthesized default — a
 * broken store must not take the launcher down with it.
 */

import { DEFAULT_GAME_VERSION, resolveGameVersion } from './game-versions';

/** Where the instance store lives. Distinct from the mod pool, by design. */
export const INSTANCES_STORAGE_KEY = 'tspml.instances.v1';

/** The id of the instance synthesized for a profile that has none. */
export const DEFAULT_INSTANCE_ID = 'default';

/** How many instances one browser may hold. */
export const INSTANCE_LIMITS = {
  /** Generous but finite: the store is metadata only, so this is a sanity
   *  bound against a runaway loop, not a resource budget. */
  maxInstances: 50,
  maxNameChars: 60,
} as const;

export interface Instance {
  /** Slug, unique within the store. `default` for the migrated one. */
  readonly id: string;
  readonly name: string;
  /**
   * The PolyTrack build this instance launches. Validated through
   * {@link resolveGameVersion} on READ, not on write: the selectable set grows
   * when a new symbol map ships, and an instance stored while its version was
   * unavailable should start working then rather than stay pinned to whatever
   * fallback was baked in at write time.
   */
  readonly gameVersion: string;
  readonly createdAt: string;
  readonly lastPlayedAt?: string;
  /**
   * Mods from the shared pool this instance turns OFF.
   *
   * Reserved and honored by the resolver ({@link effectiveEnabledIds}) but not
   * yet written by any UI — the launcher gains the per-instance toggle in a
   * later slice. It composes with, and does not replace, `record.enabled`: that
   * stays the global switch the play page's disable button writes, which
   * `smoke-user-mods` depends on. A mod runs when BOTH say so.
   */
  readonly disabledModIds: readonly string[];
}

export interface InstanceStore {
  readonly schemaVersion: 1;
  /** Which instance the launcher highlights. Null when nothing was chosen. */
  readonly activeId: string | null;
  readonly instances: readonly Instance[];
}

const SCHEMA_VERSION = 1;

/**
 * A slug safe to put in a URL and to compare by equality. Falls back to
 * `instance` when a name has nothing slug-worthy in it (all punctuation, all
 * non-Latin script) — the caller uniquifies, so a shared fallback is fine and
 * strictly better than rejecting a name the user is entitled to choose.
 */
export function slugifyInstanceName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length > 0 ? slug : 'instance';
}

/** `base`, or `base-2`, `base-3`… until it collides with nothing in `taken`. */
export function uniqueInstanceId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  // Unreachable in practice (maxInstances is 50); a distinct id still beats a
  // collision, which would make two instances alias each other's state.
  return `${base}-${taken.length + 1}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Coerce one stored row into an Instance, or null if it cannot be trusted.
 *
 * Deliberately lenient about what it can repair and strict about what it
 * cannot: a missing `disabledModIds` becomes `[]` and an unselectable
 * `gameVersion` resolves to the default, because both have an obviously correct
 * reading. A missing `id` or `name` does not — there is nothing to launch and
 * nothing to label it with — so that row is dropped rather than guessed at.
 */
function coerceInstance(raw: unknown): Instance | null {
  if (!isRecord(raw)) return null;
  const { id, name, gameVersion, createdAt, lastPlayedAt, disabledModIds } = raw;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof name !== 'string' || name.length === 0) return null;
  const disabled =
    Array.isArray(disabledModIds) ? disabledModIds.filter((m): m is string => typeof m === 'string') : [];
  return {
    id,
    name: name.slice(0, INSTANCE_LIMITS.maxNameChars),
    gameVersion: resolveGameVersion(gameVersion),
    createdAt: typeof createdAt === 'string' ? createdAt : '',
    ...(typeof lastPlayedAt === 'string' ? { lastPlayedAt } : {}),
    disabledModIds: disabled,
  };
}

/**
 * The store a profile with nothing stored behaves as. Not persisted — see the
 * module header on why migration is a read.
 *
 * `createdAt` is empty rather than "now": this object is synthesized on every
 * read until something is actually written, so a timestamp here would change
 * on each call and mean nothing. The UI treats empty as unknown.
 */
export function defaultInstanceStore(): InstanceStore {
  return {
    schemaVersion: SCHEMA_VERSION,
    activeId: DEFAULT_INSTANCE_ID,
    instances: [
      {
        id: DEFAULT_INSTANCE_ID,
        name: 'Default',
        gameVersion: DEFAULT_GAME_VERSION,
        createdAt: '',
        disabledModIds: [],
      },
    ],
  };
}

function defaultStorage(): Storage | null {
  // Guarded twice, like readUserMods: `window` is absent under SSR/prerender,
  // and ACCESSING `window.localStorage` throws outright when a browser blocks
  // storage (Safari private mode, a lockdown profile) rather than returning null.
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the instance store, synthesizing the default for anything unreadable.
 *
 * Never throws and never returns an empty instance list: a launcher with zero
 * instances has no way back to a playable state, so "nothing stored" and
 * "stored garbage" both resolve to the same one-instance store the portal
 * behaved as before instances existed.
 */
export function readInstances(
  storage: Pick<Storage, 'getItem'> | null = defaultStorage(),
): InstanceStore {
  if (!storage) return defaultInstanceStore();
  let raw: string | null;
  try {
    raw = storage.getItem(INSTANCES_STORAGE_KEY);
  } catch {
    return defaultInstanceStore();
  }
  if (!raw) return defaultInstanceStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultInstanceStore();
  }
  if (!isRecord(parsed)) return defaultInstanceStore();
  // A FUTURE schemaVersion is refused rather than read leniently. A newer build
  // may have written fields whose absence here would be misread as a user
  // choice — silently turning a mod off, say — and quietly downgrading someone's
  // data is worse than showing them a fresh default.
  if (parsed.schemaVersion !== SCHEMA_VERSION) return defaultInstanceStore();
  if (!Array.isArray(parsed.instances)) return defaultInstanceStore();
  const instances = parsed.instances
    .map(coerceInstance)
    .filter((i): i is Instance => i !== null)
    .slice(0, INSTANCE_LIMITS.maxInstances);
  if (instances.length === 0) return defaultInstanceStore();
  const activeId =
    typeof parsed.activeId === 'string' && instances.some((i) => i.id === parsed.activeId)
      ? parsed.activeId
      : (instances[0]?.id ?? null);
  return { schemaVersion: SCHEMA_VERSION, activeId, instances };
}

/**
 * Persist the store. Returns false rather than throwing when storage is
 * unavailable or full, matching `saveUserMods` — the caller surfaces it, and
 * the in-memory session keeps working, it just will not survive a reload.
 */
export function saveInstances(
  store: InstanceStore,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(INSTANCES_STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/** Look one up by id, or null. */
export function findInstance(store: InstanceStore, id: string | null): Instance | null {
  if (id === null) return null;
  return store.instances.find((i) => i.id === id) ?? null;
}

/**
 * Add a new instance. Pure: returns the next store, or the reason it refused.
 * The id is derived from the name and uniquified, so two instances called
 * "Testing" get `testing` and `testing-2` rather than aliasing each other.
 */
export function addInstance(
  store: InstanceStore,
  name: string,
  gameVersion: string,
): { ok: true; store: InstanceStore; instance: Instance } | { ok: false; error: string } {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, error: 'give the instance a name' };
  if (trimmed.length > INSTANCE_LIMITS.maxNameChars) {
    return { ok: false, error: `names are capped at ${INSTANCE_LIMITS.maxNameChars} characters` };
  }
  if (store.instances.length >= INSTANCE_LIMITS.maxInstances) {
    return { ok: false, error: `you already have ${INSTANCE_LIMITS.maxInstances} instances` };
  }
  const id = uniqueInstanceId(
    slugifyInstanceName(trimmed),
    store.instances.map((i) => i.id),
  );
  const instance: Instance = {
    id,
    name: trimmed,
    gameVersion: resolveGameVersion(gameVersion),
    createdAt: new Date().toISOString(),
    disabledModIds: [],
  };
  return {
    ok: true,
    store: { ...store, activeId: id, instances: [...store.instances, instance] },
    instance,
  };
}

/** Rename, or refuse with a reason. Pure. */
export function renameInstance(
  store: InstanceStore,
  id: string,
  name: string,
): { ok: true; store: InstanceStore } | { ok: false; error: string } {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, error: 'give the instance a name' };
  if (trimmed.length > INSTANCE_LIMITS.maxNameChars) {
    return { ok: false, error: `names are capped at ${INSTANCE_LIMITS.maxNameChars} characters` };
  }
  if (!store.instances.some((i) => i.id === id)) return { ok: false, error: 'no such instance' };
  return {
    ok: true,
    store: {
      ...store,
      instances: store.instances.map((i) => (i.id === id ? { ...i, name: trimmed } : i)),
    },
  };
}

/**
 * Remove an instance. Removing the last one hands back the synthesized default
 * rather than an empty list, for the same reason `readInstances` never returns
 * one: a launcher with nothing in it has no route back to a playable state.
 *
 * Deleting an instance deletes NO MODS. The pool is shared, so a mod another
 * instance uses (or that this one merely had switched off) must survive. The
 * confirm copy has to say so, or "delete" reads as more destructive than it is.
 */
export function removeInstance(store: InstanceStore, id: string): InstanceStore {
  const instances = store.instances.filter((i) => i.id !== id);
  if (instances.length === 0) return defaultInstanceStore();
  const activeId = store.activeId === id ? (instances[0]?.id ?? null) : store.activeId;
  return { ...store, activeId, instances };
}

/** Stamp `lastPlayedAt` and make it active. Called when a launch happens. */
export function touchInstance(store: InstanceStore, id: string, nowIso: string): InstanceStore {
  if (!store.instances.some((i) => i.id === id)) return store;
  return {
    ...store,
    activeId: id,
    instances: store.instances.map((i) => (i.id === id ? { ...i, lastPlayedAt: nowIso } : i)),
  };
}

/**
 * Which mod ids actually run for this instance.
 *
 * Both switches must agree: `record.enabled` is the pool-wide toggle the play
 * page writes, and `disabledModIds` is this instance's overlay. Passing a null
 * instance (no launcher context, or an id that no longer resolves) applies no
 * overlay at all, which is exactly how the portal behaved before instances —
 * the fallback has to be "everything enabled runs", never "nothing runs".
 */
export function effectiveEnabledIds(
  pool: readonly { readonly id: string | null; readonly enabled: boolean }[],
  instance: Instance | null,
): string[] {
  const off = new Set(instance?.disabledModIds ?? []);
  return pool
    .filter((m) => m.id !== null && m.enabled && !off.has(m.id))
    .map((m) => m.id as string);
}
