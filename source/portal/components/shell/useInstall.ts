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
 * Installing a registry entry from the launcher.
 *
 * The install is EXACTLY the play page's URL-import path, deliberately: the same
 * `importModFromUrl` (so the same host rules, the same caps, the same browser
 * fetch that never touches `/api/proxy`), the same `upsertUserMod` into the same
 * `tspml.userMods.v1` pool, the same `trackModAdded`. A registry install is a URL
 * import whose URL the player did not have to type. Anything else would mean two
 * import paths with two sets of bugs.
 *
 * The one thing it does NOT do is park patch plans or reload the game. It cannot:
 * the launcher has no iframe, and the plans have to be in the Cache API before
 * the frame's first bundle fetch. Mods installed here are picked up the next time
 * `/play` mounts, which is the next thing the player does. The UI says "installed
 * — it loads next time you play" rather than implying anything happened to a game
 * that is not running.
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

export function useInstall(): UseInstall {
  const [states, setStates] = useState<Readonly<Record<string, InstallState>>>({});
  const [installedAny, setInstalledAny] = useState(false);

  const set = useCallback((id: string, state: InstallState): void => {
    setStates((prev) => ({ ...prev, [id]: state }));
  }, []);

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

      if (entry.kind === 'modpack') {
        // A modpack is a list of URLs, and each line is an ordinary import. A
        // failure on line 2 must not discard lines 1 and 3 — same rule the play
        // page's pack import follows.
        const list = await fetchModpackList(url);
        if (!list.ok) {
          set(entry.id, { phase: 'error', message: list.error });
          return;
        }
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
        if (saveError !== null) {
          set(entry.id, { phase: 'error', message: saveError });
          return;
        }
        if (added === 0) {
          set(entry.id, {
            phase: 'error',
            message: `nothing installed: ${failures[0] ?? 'the pack listed no mods'}`,
          });
          return;
        }
        setInstalledAny(true);
        const partial = failures.length > 0 ? ` (${failures.length} failed)` : '';
        set(entry.id, {
          phase: 'done',
          message: `installed ${added} mod${added === 1 ? '' : 's'}${partial} — they load next time you play`,
        });
        return;
      }

      const result = await importModFromUrl(url, fetch, { format: entry.format });
      if (!result.ok) {
        set(entry.id, { phase: 'error', message: result.error });
        return;
      }
      const record = toRecord(result.mod, url);
      const saveError = persist(upsertUserMod(readUserMods(), record));
      if (saveError !== null) {
        set(entry.id, { phase: 'error', message: saveError });
        return;
      }
      trackModAdded(userModId(record), 'registry');
      setInstalledAny(true);
      set(entry.id, { phase: 'done', message: 'installed — it loads next time you play' });
    },
    [set],
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
