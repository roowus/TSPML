import { describe, expect, it } from 'vitest';
import {
  addInstance,
  applyInstanceOverlay,
  DEFAULT_INSTANCE_ID,
  defaultInstanceStore,
  effectiveEnabledIds,
  findInstance,
  INSTANCE_LIMITS,
  INSTANCES_STORAGE_KEY,
  isDisabledInInstance,
  readInstances,
  removeInstance,
  renameInstance,
  saveInstances,
  setInstanceIcon,
  setModDisabledInInstance,
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

  it('drops a bad icon field without dropping the instance', () => {
    // An instance is perfectly launchable without its picture. Losing someone's
    // whole profile over a decoration would be the wrong trade every time.
    const raw = JSON.stringify({
      schemaVersion: 1,
      activeId: 'a',
      instances: [
        {
          id: 'a',
          name: 'A',
          gameVersion: '0.6.2',
          createdAt: '',
          disabledModIds: [],
          icon: 'javascript:alert(1)',
        },
      ],
    });
    const store = readInstances(fakeStorage(raw).storage);
    expect(store.instances).toHaveLength(1);
    expect(store.instances[0]!.icon).toBeUndefined();
  });

  it('keeps a valid icon through a round trip', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      activeId: 'a',
      instances: [
        {
          id: 'a',
          name: 'A',
          gameVersion: '0.6.2',
          createdAt: '',
          disabledModIds: [],
          icon: 'https://example.com/i.png',
        },
      ],
    });
    expect(readInstances(fakeStorage(raw).storage).instances[0]!.icon).toBe(
      'https://example.com/i.png',
    );
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

describe('setModDisabledInInstance', () => {
  const base = defaultInstanceStore();

  it('switches a mod off for one instance only', () => {
    const two = addInstance(base, 'Other', '0.6.2');
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    const next = setModDisabledInInstance(two.store, DEFAULT_INSTANCE_ID, 'a', true);
    expect(findInstance(next, DEFAULT_INSTANCE_ID)?.disabledModIds).toEqual(['a']);
    // The whole point of the feature: the other instance is untouched.
    expect(findInstance(next, two.instance.id)?.disabledModIds).toEqual([]);
  });

  it('switching back on removes the id rather than leaving a tombstone', () => {
    const off = setModDisabledInInstance(base, DEFAULT_INSTANCE_ID, 'a', true);
    const on = setModDisabledInInstance(off, DEFAULT_INSTANCE_ID, 'a', false);
    expect(findInstance(on, DEFAULT_INSTANCE_ID)?.disabledModIds).toEqual([]);
  });

  it('is idempotent — switching off twice does not duplicate the id', () => {
    const once = setModDisabledInInstance(base, DEFAULT_INSTANCE_ID, 'a', true);
    const twice = setModDisabledInInstance(once, DEFAULT_INSTANCE_ID, 'a', true);
    expect(findInstance(twice, DEFAULT_INSTANCE_ID)?.disabledModIds).toEqual(['a']);
    // Unchanged input is returned as-is, so a no-op cannot trigger a write.
    expect(twice).toBe(once);
  });

  it('an unknown instance id changes nothing', () => {
    expect(setModDisabledInInstance(base, 'nope', 'a', true)).toBe(base);
  });
});

describe('setInstanceIcon', () => {
  const base = defaultInstanceStore();

  it('sets a validated icon', () => {
    const next = setInstanceIcon(base, DEFAULT_INSTANCE_ID, 'https://example.com/i.png');
    expect(findInstance(next, DEFAULT_INSTANCE_ID)?.icon).toBe('https://example.com/i.png');
  });

  it('clears the icon on null, dropping the key rather than setting undefined', () => {
    // `{icon: undefined}` and a missing key serialize identically, but only the
    // rebuild keeps the in-memory object matching what a later read produces.
    const set = setInstanceIcon(base, DEFAULT_INSTANCE_ID, 'https://example.com/i.png');
    const cleared = setInstanceIcon(set, DEFAULT_INSTANCE_ID, null);
    const row = findInstance(cleared, DEFAULT_INSTANCE_ID)!;
    expect(row.icon).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(row, 'icon')).toBe(false);
  });

  it('is the last line of defence: an invalid icon clears rather than stores', () => {
    const set = setInstanceIcon(base, DEFAULT_INSTANCE_ID, 'https://example.com/i.png');
    const bad = setInstanceIcon(set, DEFAULT_INSTANCE_ID, 'javascript:alert(1)');
    expect(findInstance(bad, DEFAULT_INSTANCE_ID)?.icon).toBeUndefined();
  });

  it('returns the SAME store for a no-op, so callers do not write for nothing', () => {
    const set = setInstanceIcon(base, DEFAULT_INSTANCE_ID, 'https://example.com/i.png');
    expect(setInstanceIcon(set, DEFAULT_INSTANCE_ID, 'https://example.com/i.png')).toBe(set);
    // Clearing an already-absent icon is a no-op too.
    expect(setInstanceIcon(base, DEFAULT_INSTANCE_ID, null)).toBe(base);
  });

  it('an unknown instance id changes nothing', () => {
    expect(setInstanceIcon(base, 'nope', 'https://example.com/i.png')).toBe(base);
  });

  it('touches only the named instance', () => {
    const two = addInstance(base, 'Other', '0.6.2');
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    const next = setInstanceIcon(two.store, DEFAULT_INSTANCE_ID, 'https://example.com/i.png');
    expect(findInstance(next, two.instance.id)?.icon).toBeUndefined();
  });
});

describe('addInstance — icon', () => {
  it('stores a validated icon given at creation', () => {
    const made = addInstance(defaultInstanceStore(), 'Iconic', '0.6.2', 'https://example.com/i.png');
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.instance.icon).toBe('https://example.com/i.png');
  });

  it('drops an invalid icon rather than refusing the instance', () => {
    const made = addInstance(defaultInstanceStore(), 'Iconic', '0.6.2', 'javascript:alert(1)');
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.instance.icon).toBeUndefined();
  });
});

describe('isDisabledInInstance', () => {
  const instance = { ...defaultInstanceStore().instances[0]!, disabledModIds: ['b'] };

  it('reports the instance switch, not the pool one', () => {
    expect(isDisabledInInstance(instance, 'b')).toBe(true);
    expect(isDisabledInInstance(instance, 'a')).toBe(false);
  });

  it('no instance and no id are both "not disabled here"', () => {
    expect(isDisabledInInstance(null, 'b')).toBe(false);
    expect(isDisabledInInstance(instance, null)).toBe(false);
  });
});

describe('applyInstanceOverlay — the projection the runtime consumes', () => {
  const rec = (id: string | null, enabled: boolean) => ({
    enabled,
    ...(id === null ? {} : { manifest: { id } }),
  });

  it('flattens the overlay into enabled so every consumer sees one rule', () => {
    // The loader, the mixin plan, the physics plan and the share builder each
    // read record.enabled independently. Flattening first is what stops them
    // from disagreeing about what is running.
    const pool = [rec('a', true), rec('b', true)];
    const instance = { ...defaultInstanceStore().instances[0]!, disabledModIds: ['b'] };
    expect(applyInstanceOverlay(pool, instance).map((m) => m.enabled)).toEqual([true, false]);
  });

  it('never re-enables a mod the pool switch turned off', () => {
    const pool = [rec('a', false)];
    const instance = { ...defaultInstanceStore().instances[0]!, disabledModIds: [] };
    expect(applyInstanceOverlay(pool, instance)[0]?.enabled).toBe(false);
  });

  it('leaves the input records untouched — the pool is what gets persisted', () => {
    // The projection must never reach saveUserMods; mutating in place would
    // make one instance's choices everyone's on the next write.
    const pool = [rec('a', true)];
    const instance = { ...defaultInstanceStore().instances[0]!, disabledModIds: ['a'] };
    const out = applyInstanceOverlay(pool, instance);
    expect(pool[0]?.enabled).toBe(true);
    expect(out[0]?.enabled).toBe(false);
    expect(out[0]).not.toBe(pool[0]);
  });

  it('a null instance returns an untouched copy — the pre-instances behaviour', () => {
    const pool = [rec('a', true), rec('b', false)];
    expect(applyInstanceOverlay(pool, null).map((m) => m.enabled)).toEqual([true, false]);
  });

  it('a mod with no manifest id is out of the overlay’s reach, not disabled by it', () => {
    // The overlay addresses mods by id. A record without one cannot be named,
    // so it must keep running rather than be swept up by an unrelated entry.
    const pool = [rec(null, true)];
    const instance = { ...defaultInstanceStore().instances[0]!, disabledModIds: ['a'] };
    expect(applyInstanceOverlay(pool, instance)[0]?.enabled).toBe(true);
  });
});
