'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addInstance,
  defaultInstanceStore,
  readInstances,
  removeInstance,
  renameInstance,
  saveInstances,
  setModDisabledInInstance,
  touchInstance,
} from '@/lib/instances';
import type { Instance, InstanceStore } from '@/lib/instances';

/**
 * The launcher's view of the instance store.
 *
 * `lib/instances.ts` is pure and storage-agnostic; this is the one place that
 * couples it to `localStorage` and to React.
 *
 * ## Reading happens on mount, never during render
 *
 * Every launcher surface is server-rendered, and `localStorage` does not exist
 * on the server. Reading it during render would either throw or — worse, since
 * it would look like it worked — produce markup the client cannot reproduce,
 * and React would discard the whole subtree. So the first render on BOTH sides
 * is the same placeholder: `ready` is false and the store is
 * {@link defaultInstanceStore}'s shape. The real read lands in a mount effect.
 *
 * Callers must gate on `ready` rather than on `store.instances.length`. The two
 * look interchangeable and are not: the pre-read store already holds one
 * synthesized instance, so a length check renders a confident "you have one
 * instance called Default" during the window before anything has been read —
 * which is a lie for anyone who has several.
 *
 * ## Every mutation writes
 *
 * The store is only persisted when something actually changes (see the module
 * header in `lib/instances.ts` on why migration is a read). `persistFailed`
 * carries a storage refusal up to the UI instead of throwing, matching how the
 * play page treats `saveUserMods` — the in-memory session keeps working, it
 * just will not survive a reload, and the user is entitled to know that.
 */
export interface UseInstances {
  readonly store: InstanceStore;
  /** False until the mount effect has read storage. Gate rendering on this. */
  readonly ready: boolean;
  /** Set when a write was refused (quota, or a locked-down profile). */
  readonly persistFailed: boolean;
  create(name: string, gameVersion: string): { ok: true; instance: Instance } | { ok: false; error: string };
  rename(id: string, name: string): { ok: true } | { ok: false; error: string };
  remove(id: string): void;
  /** Stamp `lastPlayedAt` and make active. Call this as a launch happens. */
  touch(id: string, nowIso: string): void;
  /**
   * Switch one mod off (or back on) FOR ONE INSTANCE. Writes the instance
   * store only — the shared mod pool is untouched, which is the entire point:
   * the same mod stays exactly as it is for every other instance.
   */
  setModDisabled(instanceId: string, modId: string, disabled: boolean): void;
}

export function useInstances(): UseInstances {
  const [store, setStore] = useState<InstanceStore>(defaultInstanceStore);
  const [ready, setReady] = useState(false);
  const [persistFailed, setPersistFailed] = useState(false);

  useEffect(() => {
    setStore(readInstances());
    setReady(true);
  }, []);

  /** Commit a computed next store: state first, then storage. */
  const commit = useCallback((next: InstanceStore): void => {
    setStore(next);
    setPersistFailed(!saveInstances(next));
  }, []);

  const create = useCallback(
    (name: string, gameVersion: string) => {
      const result = addInstance(store, name, gameVersion);
      if (!result.ok) return result;
      commit(result.store);
      return { ok: true as const, instance: result.instance };
    },
    [store, commit],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      const result = renameInstance(store, id, name);
      if (!result.ok) return result;
      commit(result.store);
      return { ok: true as const };
    },
    [store, commit],
  );

  const remove = useCallback(
    (id: string): void => {
      commit(removeInstance(store, id));
    },
    [store, commit],
  );

  const touch = useCallback(
    (id: string, nowIso: string): void => {
      const next = touchInstance(store, id, nowIso);
      // touchInstance returns the SAME object for an unknown id. Persisting
      // then would write the synthesized default into a profile that has
      // nothing stored, purely because a stale link named a missing instance.
      if (next === store) return;
      commit(next);
    },
    [store, commit],
  );

  const setModDisabled = useCallback(
    (instanceId: string, modId: string, disabled: boolean): void => {
      const next = setModDisabledInInstance(store, instanceId, modId, disabled);
      // Same identity guard as `touch`, for the same reason: a no-op (or an
      // unknown instance id) returns the input store, and persisting that would
      // write the synthesized default into a profile that has nothing stored.
      if (next === store) return;
      commit(next);
    },
    [store, commit],
  );

  return { store, ready, persistFailed, create, rename, remove, touch, setModDisabled };
}
