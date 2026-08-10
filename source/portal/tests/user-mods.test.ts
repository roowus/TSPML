// Unit tests for lib/user-mods.ts + the user-mod path through lib/mod-loader.ts —
// runtime mod loading, the feature that makes the portal usable to a modder who
// hasn't forked this repo.
//
// The storage layer is tested against fakes (a Map-backed Storage), and the loader
// path with an injected `importUserMod`, because vitest here runs in node where a
// Blob URL cannot feed `import()`. The real Blob-URL import is exercised by the
// headless smoke, which is where browser-only behaviour belongs.
import { describe, expect, it, vi } from 'vitest';
import type { TspmlApi } from '@tspml/api';
import {
  parseMixinsJson,
  readUserMods,
  saveUserMods,
  upsertUserMod,
  userEntrySpecifier,
  userModId,
  type UserModRecord,
} from '../lib/user-mods.js';
import { loadMods } from '../lib/mod-loader.js';

/** A minimal in-memory Storage stand-in. */
function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

function record(overrides: Partial<UserModRecord> & { id?: string } = {}): UserModRecord {
  const { id = 'user-mod', ...rest } = overrides;
  return {
    manifest: {
      schemaVersion: 1,
      id,
      name: 'A user mod',
      version: '1.0.0',
      entrypoint: 'entrypoint.js',
      targets: ['>=0.6.0 <0.7.0'],
    },
    code: 'export default (api) => {};',
    enabled: true,
    addedAt: '2026-08-07T00:00:00.000Z',
    ...rest,
  };
}

/** The full api the loader hands entrypoints; only logger is exercised here. */
function fakeApi(): TspmlApi {
  return {
    events: { on: () => () => {}, once: () => () => {}, off: () => {} },
    keybinds: { register: () => () => {}, dispose: () => {} },
    tracks: { register: () => () => {}, dispose: () => {} },
    audio: { register: () => () => {}, dispose: () => {} },
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    version: '0.0.0',
  } as unknown as TspmlApi;
}

describe('user-mods storage', () => {
  it('round-trips records through storage', () => {
    const storage = memoryStorage();
    const mods = [record({ id: 'alpha' }), record({ id: 'beta', enabled: false })];
    expect(saveUserMods(mods, storage)).toBe(true);
    expect(readUserMods(storage)).toEqual(mods);
  });

  it('degrades to [] on missing storage, corrupt JSON, and non-array JSON', () => {
    expect(readUserMods(null)).toEqual([]);
    expect(readUserMods(memoryStorage({ 'tspml.userMods.v1': 'not json{' }))).toEqual([]);
    expect(readUserMods(memoryStorage({ 'tspml.userMods.v1': '{"a":1}' }))).toEqual([]);
  });

  it('drops malformed entries without discarding the good ones', () => {
    const good = record({ id: 'good' });
    const storage = memoryStorage({
      'tspml.userMods.v1': JSON.stringify([good, { manifest: 'not-an-object' }, 42]),
    });
    expect(readUserMods(storage)).toEqual([good]);
  });

  it('reports storage write failure as false, not a throw', () => {
    const storage = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(saveUserMods([record()], storage)).toBe(false);
  });

  it('userModId reads the claimed id and null when absent', () => {
    expect(userModId(record({ id: 'x' }))).toBe('x');
    expect(userModId({ ...record(), manifest: {} })).toBeNull();
  });

  it('upsertUserMod replaces the same-id record (the modder iterate loop)', () => {
    const v1 = record({ id: 'iterating', code: 'export default () => 1;' });
    const other = record({ id: 'other' });
    const v2 = { ...v1, code: 'export default () => 2;' };
    const next = upsertUserMod([v1, other], v2);
    // One record for the id, holding the NEW code — a dropped/inverted filter
    // would land v2 as a second record and pre-fail it as a duplicate.
    expect(next.filter((m) => userModId(m) === 'iterating')).toEqual([v2]);
    expect(next).toContain(other);
    expect(next).toHaveLength(2);
  });

  it('upsertUserMod appends id-less records without touching the rest', () => {
    const noId = { ...record(), manifest: {} };
    const existing = record({ id: 'kept' });
    expect(upsertUserMod([existing], noId)).toEqual([existing, noId]);
  });

  it('round-trips the optional mixins field and accepts pre-#62 rows without it (#62)', () => {
    const withMixins = record({ id: 'mx', mixins: [{ op: 'before', symbol: 'Car', inject: 'x' }] });
    const legacy = record({ id: 'old' }); // no mixins key at all
    const storage = memoryStorage();
    expect(saveUserMods([withMixins, legacy], storage)).toBe(true);
    expect(readUserMods(storage)).toEqual([withMixins, legacy]);
  });

  it('drops a row whose mixins field is wrong-typed rather than smuggling it through (#62)', () => {
    const good = record({ id: 'good' });
    const storage = memoryStorage({
      'tspml.userMods.v1': JSON.stringify([
        good,
        { ...record({ id: 'bad-shape' }), mixins: 'not-an-array' },
        { ...record({ id: 'bad-entries' }), mixins: [42] },
      ]),
    });
    expect(readUserMods(storage)).toEqual([good]);
  });

  it('round-trips the optional sourceUrl and drops a wrong-typed one (reload-mods)', () => {
    const imported = record({ id: 'from-url', sourceUrl: 'https://host.example/mod.json' });
    const pasted = record({ id: 'pasted' }); // no sourceUrl key at all
    const storage = memoryStorage();
    expect(saveUserMods([imported, pasted], storage)).toBe(true);
    expect(readUserMods(storage)).toEqual([imported, pasted]);
    const corrupt = memoryStorage({
      'tspml.userMods.v1': JSON.stringify([pasted, { ...record({ id: 'bad' }), sourceUrl: 42 }]),
    });
    expect(readUserMods(corrupt)).toEqual([pasted]);
  });
});

describe('parseMixinsJson (#62)', () => {
  it('accepts a valid mixins.json paste', () => {
    const r = parseMixinsJson('{"patches": [{"op": "after", "symbol": "Car", "inject": "x"}]}');
    expect(r).toEqual({ ok: true, patches: [{ op: 'after', symbol: 'Car', inject: 'x' }] });
  });

  it('rejects bad JSON, non-objects, and missing/empty/non-object patches with distinct messages', () => {
    expect(parseMixinsJson('nope{')).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') });
    expect(parseMixinsJson('[1]')).toMatchObject({ ok: false, error: expect.stringContaining('JSON object') });
    expect(parseMixinsJson('{}')).toMatchObject({ ok: false, error: expect.stringContaining('"patches"') });
    expect(parseMixinsJson('{"patches": []}')).toMatchObject({ ok: false, error: expect.stringContaining('non-empty') });
    expect(parseMixinsJson('{"patches": ["x"]}')).toMatchObject({ ok: false, error: expect.stringContaining('object') });
  });
});

describe('loadMods with user mods', () => {
  it('loads an enabled user mod through the loader', async () => {
    const entered: string[] = [];
    const summary = await loadMods(fakeApi(), {
      userMods: [record({ id: 'my-mod' })],
      importUserMod: async () => ({
        default: () => {
          entered.push('my-mod');
        },
      }),
    });
    expect(summary.loaded).toContain('my-mod');
    expect(entered).toEqual(['my-mod']);
    // And it is safety-classified like any other mod.
    expect(summary.safety.map((s) => s.id)).toContain('my-mod');
  });

  it('loads nothing when the user has no mods — there are no bundled mods', async () => {
    const summary = await loadMods(fakeApi(), { userMods: [] });
    expect(summary.loaded).toEqual([]);
    expect(summary.failed).toEqual([]);
    expect(summary.safety).toEqual([]);
  });

  it('skips disabled user mods entirely', async () => {
    const importUserMod = vi.fn();
    const summary = await loadMods(fakeApi(), {
      userMods: [record({ id: 'off-mod', enabled: false })],
      importUserMod,
    });
    expect(importUserMod).not.toHaveBeenCalled();
    expect(summary.loaded).not.toContain('off-mod');
    expect(summary.failed.map((f) => f.id)).not.toContain('off-mod');
  });

  it('fails (only) the user mod on a manifest error, isolated from the rest', async () => {
    const summary = await loadMods(fakeApi(), {
      userMods: [{ ...record(), manifest: { schemaVersion: 1, id: 'bad-mod' } }, record({ id: 'good-mod' })],
      importUserMod: async () => ({ default: () => {} }),
    });
    const failure = summary.failed.find((f) => f.id === 'bad-mod');
    expect(failure).toBeDefined();
    expect(failure!.reason).toMatch(/name/); // the first missing required field
    expect(summary.loaded).toContain('good-mod');
  });

  it('fails (only) the user mod when its code throws on import', async () => {
    const summary = await loadMods(fakeApi(), {
      userMods: [record({ id: 'boom-mod' })],
      importUserMod: async () => {
        throw new Error('SyntaxError: nope');
      },
    });
    expect(summary.failed.find((f) => f.id === 'boom-mod')?.reason).toMatch(/nope/);
  });

  it('pre-fails the SECOND user mod claiming the same id', async () => {
    const summary = await loadMods(fakeApi(), {
      userMods: [record({ id: 'twin' }), record({ id: 'twin' })],
      importUserMod: async () => ({ default: () => {} }),
    });
    expect(summary.loaded).toContain('twin');
    expect(summary.failed.filter((f) => f.id === 'twin')).toHaveLength(1);
  });

  it('pre-fails a user mod with an unmet dependency, WITHOUT aborting the load', async () => {
    // Resolution errors (missing depends, breaks, cycles) are abortive in the
    // loader, exactly like duplicate ids — a pasted manifest saying
    // `depends: {"anything": "*"}` must not take the user's other mods down.
    const needy = record({ id: 'needy-mod' });
    (needy.manifest as Record<string, unknown>).depends = { 'not-installed': '^1.0.0' };
    const summary = await loadMods(fakeApi(), {
      userMods: [needy, record({ id: 'innocent-mod' })],
      importUserMod: async () => ({ default: () => {} }),
    });
    expect(summary.failed.find((f) => f.id === 'needy-mod')?.reason).toMatch(/not installed/);
    expect(summary.loaded).toContain('innocent-mod');
  });

  it('pre-fails a user mod that breaks another loaded mod, WITHOUT aborting the load', async () => {
    const victim = record({ id: 'victim-mod' });
    const breaker = record({ id: 'breaker-mod' });
    (breaker.manifest as Record<string, unknown>).breaks = { 'victim-mod': '*' };
    const summary = await loadMods(fakeApi(), {
      userMods: [victim, breaker],
      importUserMod: async () => ({ default: () => {} }),
    });
    expect(summary.failed.find((f) => f.id === 'breaker-mod')?.reason).toMatch(/breaks/);
    expect(summary.loaded).toContain('victim-mod');
  });

  it('loads a user mod depending on another user mod, in either paste order', async () => {
    const base = record({ id: 'base-mod' });
    const addon = record({ id: 'addon-mod' });
    (addon.manifest as Record<string, unknown>).depends = { 'base-mod': '^1.0.0' };
    // addon pasted FIRST: the fixpoint pass must still accept it once base is in.
    const summary = await loadMods(fakeApi(), {
      userMods: [addon, base],
      importUserMod: async () => ({ default: () => {} }),
    });
    expect(summary.loaded).toContain('base-mod');
    expect(summary.loaded).toContain('addon-mod');
    expect(summary.failed).toEqual([]);
  });

  it('reports declared-but-unpasted mixins as skipped rather than silently ignoring them (#62)', async () => {
    const withMixins = record({ id: 'mixin-mod' });
    (withMixins.manifest as Record<string, unknown>).mixins = [{ config: 'mixins.json' }];
    const summary = await loadMods(fakeApi(), {
      userMods: [withMixins],
      importUserMod: async () => ({ default: () => {} }),
    });
    expect(summary.loaded).toContain('mixin-mod');
    expect(summary.mixinsSkipped).toEqual(['mixin-mod']);
  });

  it('does NOT nag for unpasted mixins declared for another environment — pasting them would change nothing here (#21)', async () => {
    const desktopMixins = record({ id: 'desktop-mixin-mod' });
    (desktopMixins.manifest as Record<string, unknown>).mixins = [
      { config: 'mixins.json', environment: 'desktop' },
    ];
    const summary = await loadMods(fakeApi(), {
      userMods: [desktopMixins],
      importUserMod: async () => ({ default: () => {} }),
    });
    expect(summary.loaded).toContain('desktop-mixin-mod');
    expect(summary.mixinsSkipped).toEqual([]);
  });

  it('does NOT report a mod whose mixins.json WAS pasted — those ride the patch plan (#62)', async () => {
    const pasted = record({
      id: 'pasted-mod',
      mixins: [{ op: 'after', symbol: 'Car', inject: 'x' }],
    });
    (pasted.manifest as Record<string, unknown>).mixins = [{ config: 'mixins.json' }];
    const summary = await loadMods(fakeApi(), {
      userMods: [pasted],
      importUserMod: async () => ({ default: () => {} }),
    });
    expect(summary.loaded).toContain('pasted-mod');
    expect(summary.mixinsSkipped).toEqual([]);
  });

  it("reports a desktop-only user mod as failed-with-reason on this web host, never invoked (#21)", async () => {
    const desktopOnly = record({ id: 'desktop-mod' });
    (desktopOnly.manifest as Record<string, unknown>).environment = 'desktop';
    const importUserMod = vi.fn(async () => ({ default: () => {} }));
    const summary = await loadMods(fakeApi(), {
      userMods: [desktopOnly, record({ id: 'web-mod' })],
      importUserMod,
    });
    const failure = summary.failed.find((f) => f.id === 'desktop-mod');
    expect(failure?.reason).toMatch(/environment 'desktop'/);
    // Soft, not abortive: the user's other mods are untouched.
    expect(summary.loaded).toContain('web-mod');
  });

  it('reports a stale-targets user mod as failed-with-reason against the pinned game version (#21)', async () => {
    const stale = record({ id: 'stale-mod' });
    (stale.manifest as Record<string, unknown>).targets = ['>=0.7.0'];
    const summary = await loadMods(fakeApi(), {
      userMods: [stale, record({ id: 'fitting-mod' })],
      importUserMod: async () => ({ default: () => {} }),
    });
    expect(summary.failed.find((f) => f.id === 'stale-mod')?.reason).toMatch(/targets '>=0\.7\.0'/);
    expect(summary.loaded).toContain('fitting-mod');
  });

  it('the context is overridable — a pinned desktop context flips which mods fit (#21)', async () => {
    const desktopOnly = record({ id: 'desktop-mod' });
    (desktopOnly.manifest as Record<string, unknown>).environment = 'desktop';
    const summary = await loadMods(fakeApi(), {
      userMods: [desktopOnly],
      importUserMod: async () => ({ default: () => {} }),
      context: { hostEnvironment: 'desktop', polytrackVersion: '0.6.2' },
    });
    expect(summary.loaded).toContain('desktop-mod');
  });

  it('unloads a user mod via the standard disposer path (#17)', async () => {
    let disposed = false;
    const summary = await loadMods(fakeApi(), {
      userMods: [record({ id: 'clean-mod' })],
      importUserMod: async () => ({
        default: () => () => {
          disposed = true;
        },
      }),
    });
    expect(summary.loaded).toContain('clean-mod');
    await summary.unload();
    expect(disposed).toBe(true);
  });

  it('entry specifiers are namespaced so user mods cannot shadow bundled specifiers', () => {
    expect(userEntrySpecifier('x')).toBe('user:x');
  });
});
