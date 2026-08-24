import { describe, expect, it } from 'vitest';
import {
  addInstance,
  DEFAULT_INSTANCE_ID,
  defaultInstanceStore,
  effectiveEnabledIds,
  findInstance,
  INSTANCE_LIMITS,
  INSTANCES_STORAGE_KEY,
  readInstances,
  removeInstance,
  renameInstance,
  saveInstances,
  slugifyInstanceName,
  touchInstance,
  uniqueInstanceId,
} from '../lib/instances';
import type { InstanceStore } from '../lib/instances';

/**
 * Instances are metadata over a SHARED mod pool, and the two properties that
 * make that safe are easy to break without noticing:
 *
 *  1. Reading never writes. A cold profile must behave byte-identically to the
 *     portal before instances existed — no launcher bytes appearing in a
 *     visitor's storage, and nothing landing in a Playwright profile behind a
 *     smoke's back. A `readInstances` that persisted its synthesized default
 *     would still return the right object, so only a write-observing fake
 *     catches it.
 *  2. The two enable switches COMPOSE. `record.enabled` is the pool-wide toggle
 *     the play page writes (smoke-user-mods leg 6 depends on it); an instance's
 *     `disabledModIds` is an overlay on top. A resolver that read only one of
 *     them would pass any test that set just that one.
 */

/** A storage double that records writes, so "never persists" is observable. */
function fakeStorage(seed?: string): {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  writes: { key: string; value: string }[];
} {
  let value = seed ?? null;
  const writes: { key: string; value: string }[] = [];
  return {
    storage: {
      getItem: () => value,
      setItem: (key: string, v: string) => {
        writes.push({ key, value: v });
        value = v;
      },
    },
    writes,
  };
}

/** Storage that throws on every access, like a locked-down browser profile. */
const hostileStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('readInstances — migration is a lazy read', () => {
  it('synthesizes a Default instance when nothing is stored', () => {
    const { storage } = fakeStorage();
    const store = readInstances(storage);
    expect(store.instances).toHaveLength(1);
    expect(store.instances[0]!.id).toBe(DEFAULT_INSTANCE_ID);
    expect(store.activeId).toBe(DEFAULT_INSTANCE_ID);
  });

  it('does NOT persist the synthesized default', () => {
    // The whole point of lazy migration: a visitor who only LOADED the page has
    // nothing new in their storage afterwards.
    const { storage, writes } = fakeStorage();
    readInstances(storage);
    readInstances(storage);
    expect(writes).toEqual([]);
  });

  it('degrades to the default on corrupt JSON, wrong shape, or a hostile store', () => {
    expect(readInstances(fakeStorage('not json{').storage).instances).toHaveLength(1);
    expect(readInstances(fakeStorage('[]').storage).instances).toHaveLength(1);
    expect(readInstances(fakeStorage('"a string"').storage).instances).toHaveLength(1);
    expect(readInstances(hostileStorage).instances).toHaveLength(1);
    expect(readInstances(null).instances).toHaveLength(1);
  });

  it('refuses a FUTURE schemaVersion rather than reading it leniently', () => {
    // A newer build may have written fields whose absence here would read as a
    // user choice. Downgrading someone's data silently is the failure to avoid.
    const future = JSON.stringify({
      schemaVersion: 2,
      activeId: 'mine',
      instances: [{ id: 'mine', name: 'Mine', gameVersion: '0.6.2', createdAt: '', disabledModIds: [] }],
    });
    const store = readInstances(fakeStorage(future).storage);
    expect(store.instances).toHaveLength(1);
    expect(store.instances[0]!.id).toBe(DEFAULT_INSTANCE_ID);
  });

  it('drops rows with no id or no name but keeps the rest', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      activeId: 'good',
      instances: [
        { name: 'no id', gameVersion: '0.6.2', createdAt: '', disabledModIds: [] },
        { id: 'no-name', gameVersion: '0.6.2', createdAt: '', disabledModIds: [] },
        { id: 'good', name: 'Good', gameVersion: '0.6.2', createdAt: '', disabledModIds: [] },
      ],
    });
    const store = readInstances(fakeStorage(raw).storage);
    expect(store.instances.map((i) => i.id)).toEqual(['good']);
  });

  it('repairs a missing disabledModIds and an unselectable gameVersion', () => {
    // Both have an obviously correct reading, unlike a missing id — so these
    // rows are fixed rather than dropped.
    const raw = JSON.stringify({
      schemaVersion: 1,
      activeId: 'a',
      instances: [{ id: 'a', name: 'A', gameVersion: '0.6.0', createdAt: '2026-01-01' }],
    });
    const store = readInstances(fakeStorage(raw).storage);
    expect(store.instances[0]!.disabledModIds).toEqual([]);
    // 0.6.0 has no symbol map, so it resolves to the one build that works.
    expect(store.instances[0]!.gameVersion).toBe('0.6.2');
  });

  it('never returns an empty instance list', () => {
    // A launcher with nothing in it has no route back to a playable state.
    const raw = JSON.stringify({ schemaVersion: 1, activeId: null, instances: [] });
    expect(readInstances(fakeStorage(raw).storage).instances.length).toBeGreaterThan(0);
  });

  it('falls back to the first instance when activeId names a missing one', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      activeId: 'deleted',
      instances: [{ id: 'a', name: 'A', gameVersion: '0.6.2', createdAt: '', disabledModIds: [] }],
    });
    expect(readInstances(fakeStorage(raw).storage).activeId).toBe('a');
  });

  it('round-trips a real store through save and read', () => {
    const { storage, writes } = fakeStorage();
    const added = addInstance(defaultInstanceStore(), 'Speedrun', '0.6.2');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(saveInstances(added.store, storage)).toBe(true);
    expect(writes[0]!.key).toBe(INSTANCES_STORAGE_KEY);
    const back = readInstances(storage);
    expect(back.instances.map((i) => i.name)).toEqual(['Default', 'Speedrun']);
    expect(back.activeId).toBe('speedrun');
  });

  it('saveInstances returns false rather than throwing on a hostile store', () => {
    expect(saveInstances(defaultInstanceStore(), hostileStorage)).toBe(false);
    expect(saveInstances(defaultInstanceStore(), null)).toBe(false);
  });
});

describe('ids', () => {
  it('slugifies names, and falls back for names with nothing slug-worthy', () => {
    expect(slugifyInstanceName('My Speedrun Setup')).toBe('my-speedrun-setup');
    expect(slugifyInstanceName('  Trim Me  ')).toBe('trim-me');
    expect(slugifyInstanceName('!!!')).toBe('instance');
    expect(slugifyInstanceName('日本語')).toBe('instance');
  });

  it('uniquifies rather than letting two instances alias each other', () => {
    expect(uniqueInstanceId('testing', [])).toBe('testing');
    expect(uniqueInstanceId('testing', ['testing'])).toBe('testing-2');
    expect(uniqueInstanceId('testing', ['testing', 'testing-2'])).toBe('testing-3');
  });

  it('two instances with the same name get distinct ids', () => {
    const one = addInstance(defaultInstanceStore(), 'Testing', '0.6.2');
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    const two = addInstance(one.store, 'Testing', '0.6.2');
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.instance.id).toBe('testing-2');
    expect(new Set(two.store.instances.map((i) => i.id)).size).toBe(two.store.instances.length);
  });
});

describe('mutations', () => {
  it('addInstance refuses a blank name, an over-long one, and a full store', () => {
    expect(addInstance(defaultInstanceStore(), '   ', '0.6.2')).toMatchObject({ ok: false });
    expect(
      addInstance(defaultInstanceStore(), 'x'.repeat(INSTANCE_LIMITS.maxNameChars + 1), '0.6.2'),
    ).toMatchObject({ ok: false });

    let store: InstanceStore = defaultInstanceStore();
    for (let n = store.instances.length; n < INSTANCE_LIMITS.maxInstances; n += 1) {
      const r = addInstance(store, `inst ${n}`, '0.6.2');
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      store = r.store;
    }
    const overflow = addInstance(store, 'one too many', '0.6.2');
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.error).toMatch(new RegExp(String(INSTANCE_LIMITS.maxInstances)));
  });

  it('addInstance resolves an unselectable version instead of storing it', () => {
    const r = addInstance(defaultInstanceStore(), 'Old build', '0.6.0');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.instance.gameVersion).toBe('0.6.2');
  });

  it('renameInstance refuses a blank name and an unknown id', () => {
    expect(renameInstance(defaultInstanceStore(), DEFAULT_INSTANCE_ID, ' ')).toMatchObject({ ok: false });
    expect(renameInstance(defaultInstanceStore(), 'nope', 'Fine')).toMatchObject({ ok: false });
    const ok = renameInstance(defaultInstanceStore(), DEFAULT_INSTANCE_ID, 'Renamed');
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.store.instances[0]!.name).toBe('Renamed');
  });

  it('removing the last instance yields the default, not an empty list', () => {
    const after = removeInstance(defaultInstanceStore(), DEFAULT_INSTANCE_ID);
    expect(after.instances).toHaveLength(1);
    expect(after.instances[0]!.id).toBe(DEFAULT_INSTANCE_ID);
  });

  it('removing the active instance moves active to a surviving one', () => {
    const added = addInstance(defaultInstanceStore(), 'Second', '0.6.2');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.store.activeId).toBe('second');
    const after = removeInstance(added.store, 'second');
    expect(after.activeId).toBe(DEFAULT_INSTANCE_ID);
    expect(findInstance(after, 'second')).toBeNull();
  });

  it('touchInstance stamps lastPlayedAt and activates, and ignores unknown ids', () => {
    const touched = touchInstance(defaultInstanceStore(), DEFAULT_INSTANCE_ID, '2026-08-24T00:00:00.000Z');
    expect(touched.instances[0]!.lastPlayedAt).toBe('2026-08-24T00:00:00.000Z');
    expect(touched.activeId).toBe(DEFAULT_INSTANCE_ID);
    const base = defaultInstanceStore();
    expect(touchInstance(base, 'nope', '2026-08-24T00:00:00.000Z')).toBe(base);
  });

  it('mutations are pure — the input store is never modified', () => {
    const base = defaultInstanceStore();
    const snapshot = JSON.stringify(base);
    addInstance(base, 'New', '0.6.2');
    renameInstance(base, DEFAULT_INSTANCE_ID, 'Other');
    removeInstance(base, DEFAULT_INSTANCE_ID);
    touchInstance(base, DEFAULT_INSTANCE_ID, '2026-08-24T00:00:00.000Z');
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe('effectiveEnabledIds — the two switches compose', () => {
  const pool = [
    { id: 'a', enabled: true },
    { id: 'b', enabled: true },
    { id: 'c', enabled: false },
    { id: null, enabled: true },
  ];

  it('runs the pool-enabled mods this instance has not switched off', () => {
    const instance = { ...defaultInstanceStore().instances[0]!, disabledModIds: ['b'] };
    expect(effectiveEnabledIds(pool, instance)).toEqual(['a']);
  });

  it('honors the pool-wide toggle even when the overlay is empty', () => {
    // record.enabled is what the play page's disable button writes; an overlay
    // that ignored it would resurrect a mod the user turned off globally.
    const instance = defaultInstanceStore().instances[0]!;
    expect(effectiveEnabledIds(pool, instance)).toEqual(['a', 'b']);
  });

  it('a null instance applies NO overlay rather than disabling everything', () => {
    // The pre-instances behaviour, and the only safe fallback: an unresolvable
    // instance id must not silently unload the user's whole mod set.
    expect(effectiveEnabledIds(pool, null)).toEqual(['a', 'b']);
  });

  it('an overlay naming a mod that is not installed changes nothing', () => {
    const instance = { ...defaultInstanceStore().instances[0]!, disabledModIds: ['ghost'] };
    expect(effectiveEnabledIds(pool, instance)).toEqual(['a', 'b']);
  });
});
