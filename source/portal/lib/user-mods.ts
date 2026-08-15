/**
 * @tspml/portal — user-added mods (runtime mod loading).
 *
 * A mod a user pastes into the portal (manifest + built entrypoint JS) is
 * persisted to `localStorage` and loaded through the standard `@tspml/loader`
 * path: parsed, validated, dependency-resolved, safety-classified, isolated.
 * This is what makes the portal usable to a modder who hasn't forked this
 * repo — and since the bundled demo mods were removed, it is the ONLY way
 * mods enter the portal.
 *
 * Scope (deliberate):
 * - **Tier-1 entrypoint + pasted Tier-2 mixins.** A user mod's entrypoint gets
 *   the full `api` (events, keybinds, tracks, audio). Its pasted `mixins.json`
 *   patches reach the server-side transform via the request-carried patch plan
 *   (#62 — see ./user-patches.ts): the server knows nothing of this browser's
 *   localStorage, so the plan rides the bundle request itself. A manifest that
 *   DECLARES mixins with no pasted mixins.json still surfaces the explicit
 *   `mixinsSkipped` warning rather than silence (PML's failure mode we exist
 *   to fix).
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
  /**
   * The `patches` array from the pasted `mixins.json` (optional third paste,
   * #62). Absent = the author pasted none; a manifest that still DECLARES
   * mixins then surfaces the honest `mixinsSkipped` warning. Entries stay raw
   * (unknown): the transform engine owns deep validation, same division of
   * labor as `manifest`.
   */
  readonly mixins?: readonly Record<string, unknown>[];
  /** Disabled mods stay stored but are not loaded. */
  readonly enabled: boolean;
  /** ISO date the mod was added (display only). */
  readonly addedAt: string;
  /**
   * The URL the mod was imported from (#80). Absent for pasted mods. This is
   * what makes a mod reloadable: "⟳ Reload mods" re-runs the import from this
   * URL and replaces the stored copy (lib/mod-reload.ts).
   */
  readonly sourceUrl?: string;
}

/** The `id` a record claims, or null if it doesn't even have one. */
export function userModId(record: UserModRecord): string | null {
  const id = record.manifest.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * The manifest's `homepage` as a clickable docs link, or null. The manifest is
 * author-supplied and unvalidated here, so only http(s) URLs come back — a
 * `javascript:` href in a rendered anchor would run in the portal's origin.
 */
export function userModHomepage(record: UserModRecord): string | null {
  const raw = record.manifest.homepage;
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The manifest's `icon` as a renderable `<img>` src, or null. Same trust
 * posture as {@link userModHomepage}: the field is author-supplied, so only
 * shapes that are inert inside an `<img>` element come back —
 * - **http(s) URLs**, absolute or (for URL-imported mods) relative to the
 *   record's `sourceUrl`, mirroring how the import path resolves `entrypoint`
 *   against the manifest URL. A pasted mod has no base, so a relative icon
 *   honestly falls back to the letter tile instead of guessing a host.
 * - **`data:image/*` URIs**, because a pasted mod's only copy is this
 *   browser's storage — there is no host to serve an icon from. SVG-as-image
 *   contexts don't execute scripts, and a data: URI in an img src can't
 *   navigate anywhere, so this stays display-only.
 * kodub hosts are refused like the import path refuses them: the service
 * worker rewrites those into the game proxy, which images must not transit.
 */
export function userModIcon(record: UserModRecord): string | null {
  const raw = record.manifest.icon;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (/^data:image\//i.test(raw)) return raw;
  let url: URL;
  try {
    url = record.sourceUrl === undefined ? new URL(raw) : new URL(raw, record.sourceUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname === 'kodub.com' || url.hostname.endsWith('.kodub.com')) return null;
  return url.href;
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
    typeof v.addedAt === 'string' &&
    // `mixins` is optional (pre-#62 rows lack it) but when present must be an
    // array of objects — a wrong-typed field drops the row like any other
    // malformed entry rather than smuggling junk into the transform path.
    (v.mixins === undefined || (Array.isArray(v.mixins) && v.mixins.every(isRecord))) &&
    // `sourceUrl` is optional (pasted mods and pre-reload rows lack it); when
    // present it must be a string — reload hands it straight to the import
    // path, which re-checks the host rules on every use.
    (v.sourceUrl === undefined || typeof v.sourceUrl === 'string')
  );
}

/**
 * Shallow paste-time validation of a `mixins.json` paste: valid JSON, an
 * object, with a `patches` array of objects. DEEP validation (ops, anchors,
 * symbols) is deliberately NOT done here — the transform engine owns it and
 * reports per-patch failures honestly; duplicating its rules here would drift.
 */
export function parseMixinsJson(
  text: string,
): { ok: true; patches: Record<string, unknown>[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `mixins.json is not valid JSON: ${(e as Error).message.slice(0, 80)}` };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: 'mixins.json must be a JSON object (the contents of mixins.json)' };
  }
  const patches = parsed.patches;
  if (!Array.isArray(patches) || patches.length === 0) {
    return { ok: false, error: 'mixins.json must have a non-empty "patches" array' };
  }
  if (!patches.every(isRecord)) {
    return { ok: false, error: 'every entry in "patches" must be an object' };
  }
  return { ok: true, patches: patches as Record<string, unknown>[] };
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
 * Add `record` to `mods`, REPLACING any stored record claiming the same id —
 * that is how a modder iterates on their mod without a remove/add dance. An
 * id-less record can only append (there is nothing to match it against).
 *
 * Pure and extracted from the Add form's handler so the replace semantics are
 * unit-testable: the regression here (filter dropped or inverted) makes every
 * re-paste land as a second record, pre-failed as a duplicate, and the
 * modder's updated code silently never takes effect.
 */
export function upsertUserMod(
  mods: readonly UserModRecord[],
  record: UserModRecord,
): UserModRecord[] {
  const id = userModId(record);
  return id === null
    ? [...mods, record]
    : [...mods.filter((m) => userModId(m) !== id), record];
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
