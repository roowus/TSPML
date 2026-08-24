'use client';

import { useCallback, useState } from 'react';
import { trackModAdded } from '@/lib/analytics';
import { importModFromUrl } from '@/lib/mod-import';
import type { ImportedMod } from '@/lib/mod-formats/types';
import { fetchModpackList } from '@/lib/modpack';
import {
  readUserMods,
  saveUserMods,
  upsertUserMod,
  userModId,
  type UserModRecord,
} from '@/lib/user-mods';
import { installBlockedReason, resolveSourceUrl, type RegistryEntry } from '@/lib/registry';

/**
 * Installing a registry entry.
 *
 * The install is EXACTLY the play page's URL-import path, deliberately: the same
 * `importModFromUrl` (so the same host rules, the same caps, the same browser
 * fetch that never touches `/api/proxy`), the same `upsertUserMod` into the same
 * `tspml.userMods.v1` pool, the same `trackModAdded`. A registry install is a URL
 * import whose URL the player did not have to type. Anything else would mean two
 * import paths with two sets of bugs.
 *
 * ## Where the install LANDS is a seam, because it genuinely differs
 *
 * From the launcher there is no iframe and no plan to park, so an install can
 * only write the pool; the mod is picked up the next time `/play` mounts. From
 * the in-play drawer there IS a running game, and the play page owns the
 * unload/re-park/reload chain that makes a new mod actually run. Same fetch,
 * same pool, different ending — so {@link InstallTarget} names the ending and
 * this hook stays the state machine around it.
 *
 * The messages differ with the target, and that is the point: telling someone
 * their mod "loads next time you play" while it is already running, or claiming
 * it is running when nothing was reloaded, is the kind of small lie that costs
 * a bug report.
 *
 * `readUserMods()` is re-read at each install rather than held in state: another
 * tab may have added a mod, and clobbering someone's library with a stale snapshot
 * to save one localStorage read would be a bad trade.
 */

export type InstallState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'busy' }
  | { readonly phase: 'done'; readonly message: string }
  | { readonly phase: 'error'; readonly message: string };

/** What one install attempt produced, in words the card can show verbatim. */
export type InstallResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly error: string };

/**
 * Where an install lands. Both methods receive the RESOLVED absolute URL — the
 * catalog's may be relative, and a relative URL reaching an importer would
 * resolve against whatever page happened to be open.
 */
export interface InstallTarget {
  readonly mod: (url: string, entry: RegistryEntry) => Promise<InstallResult>;
  readonly pack: (url: string, entry: RegistryEntry) => Promise<InstallResult>;
}

export interface UseInstall {
  /** Per-entry-id state, so several cards can report independently. */
  readonly states: Readonly<Record<string, InstallState>>;
  readonly install: (entry: RegistryEntry) => Promise<void>;
  /** True once a mod has been installed in this session — the "go play" nudge. */
  readonly installedAny: boolean;
}

function persist(records: readonly UserModRecord[]): string | null {
  return saveUserMods(records)
    ? null
    : 'the mod was fetched but could not be saved — your browser storage is full';
}

/**
 * The launcher's ending: write the shared pool and say so honestly. Nothing is
 * loaded, because there is no game running to load it into.
 */
export const LAUNCHER_INSTALL_TARGET: InstallTarget = {
  async mod(url, entry) {
    const result = await importModFromUrl(url, fetch, { format: entry.format });
    if (!result.ok) return { ok: false, error: result.error };
    const record = toRecord(result.mod, url);
    const saveError = persist(upsertUserMod(readUserMods(), record));
    if (saveError !== null) return { ok: false, error: saveError };
    trackModAdded(userModId(record), 'registry');
    return { ok: true, message: 'installed — it loads next time you play' };
  },
  async pack(url, entry) {
    // A modpack is a list of URLs, and each line is an ordinary import. A
    // failure on line 2 must not discard lines 1 and 3 — same rule the play
    // page's pack import follows.
    const list = await fetchModpackList(url);
    if (!list.ok) return { ok: false, error: list.error };
    let records = readUserMods();
    let added = 0;
    // Lines the pack parser already refused count as failures too, so the
    // reported number matches what the player asked for, not what survived
    // parsing.
    const failures: string[] = list.parsed.invalid.map((i) => `line ${i.line}: ${i.error}`);
    for (const modUrl of list.parsed.urls) {
      const result = await importModFromUrl(modUrl, fetch, { format: entry.format });
      if (!result.ok) {
        failures.push(result.error);
        continue;
      }
      records = upsertUserMod(records, toRecord(result.mod, modUrl));
      trackModAdded(userModId(records[records.length - 1] as UserModRecord), 'modpack');
      added += 1;
    }
    const saveError = added > 0 ? persist(records) : null;
    if (saveError !== null) return { ok: false, error: saveError };
    if (added === 0) {
      return { ok: false, error: `nothing installed: ${failures[0] ?? 'the pack listed no mods'}` };
    }
    const partial = failures.length > 0 ? ` (${failures.length} failed)` : '';
    return {
      ok: true,
      message: `installed ${added} mod${added === 1 ? '' : 's'}${partial} — they load next time you play`,
    };
  },
};

export function useInstall(target: InstallTarget = LAUNCHER_INSTALL_TARGET): UseInstall {
  const [states, setStates] = useState<Readonly<Record<string, InstallState>>>({});
  const [installedAny, setInstalledAny] = useState(false);

  const set = useCallback((id: string, state: InstallState): void => {
    setStates((prev) => ({ ...prev, [id]: state }));
  }, []);

  // `target` is intentionally NOT memoized by callers: the play page's version
  // closes over handlers rebuilt every render, and a stale one would import
  // into a mod list that has since changed. `install` only runs on a click, so
  // a fresh identity each render costs nothing.
  const install = useCallback(
    async (entry: RegistryEntry): Promise<void> => {
      const origin = window.location.origin;
      const blocked = installBlockedReason(entry, origin);
      if (blocked !== null) {
        set(entry.id, { phase: 'error', message: blocked });
        return;
      }
      set(entry.id, { phase: 'busy' });
      const url = resolveSourceUrl(entry, origin);
      const result =
        entry.kind === 'modpack' ? await target.pack(url, entry) : await target.mod(url, entry);
      if (!result.ok) {
        set(entry.id, { phase: 'error', message: result.error });
        return;
      }
      setInstalledAny(true);
      set(entry.id, { phase: 'done', message: result.message });
    },
    [set, target],
  );

  return { states, install, installedAny };
}

/**
 * The imported mod as a stored record — the same construction the play page's
 * URL import does, so a registry install and a typed URL produce byte-identical
 * rows in the pool.
 *
 * The spreads are not style: the portal builds with `exactOptionalPropertyTypes`,
 * so writing `mixins: mod.mixins` would put an explicit `undefined` in the record
 * and fail to typecheck against an optional property.
 *
 * `sourceUrl` is what the play page's reload button re-fetches, so it must be
 * the resolved absolute URL rather than the catalog's possibly-relative one.
 */
function toRecord(mod: ImportedMod, sourceUrl: string): UserModRecord {
  return {
    manifest: mod.manifest,
    code: mod.code,
    ...(mod.mixins === undefined ? {} : { mixins: mod.mixins }),
    ...(mod.physics === undefined ? {} : { physics: mod.physics }),
    enabled: true,
    addedAt: new Date().toISOString(),
    sourceUrl,
  };
}
