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
  readUserMods,
  saveUserMods,
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
});

describe('loadMods with user mods', () => {
  it('loads an enabled user mod through the loader alongside the bundled mods', async () => {
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
    // The bundled demo mods still load — a user mod joins them, never replaces them.
    expect(summary.loaded).toContain('tspml-example-hud');
    expect(entered).toEqual(['my-mod']);
    // And it is safety-classified like any other mod.
    expect(summary.safety.map((s) => s.id)).toContain('my-mod');
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
      userMods: [{ ...record(), manifest: { schemaVersion: 1, id: 'bad-mod' } }],
      importUserMod: async () => ({ default: () => {} }),
    });
    const failure = summary.failed.find((f) => f.id === 'bad-mod');
    expect(failure).toBeDefined();
    expect(failure!.reason).toMatch(/name/); // the first missing required field
    expect(summary.loaded).toContain('tspml-example-hud');
  });

  it('fails (only) the user mod when its code throws on import', async () => {
    const summary = await loadMods(fakeApi(), {
      userMods: [record({ id: 'boom-mod' })],
      importUserMod: async () => {
        throw new Error('SyntaxError: nope');
      },
    });
    expect(summary.failed.find((f) => f.id === 'boom-mod')?.reason).toMatch(/nope/);
    expect(summary.loaded).toContain('tspml-example-hud');
  });

  it('pre-fails a user mod whose id collides with a bundled mod, WITHOUT aborting the load', async () => {
    // The loader treats duplicate ids as abortive for the whole set; the portal
    // must catch the collision first so one bad user entry can't take the
    // bundled mods down.
    const summary = await loadMods(fakeApi(), {
      userMods: [record({ id: 'tspml-example-hud' })],
      importUserMod: async () => ({ default: () => {} }),
    });
    expect(summary.failed.find((f) => f.id === 'tspml-example-hud')?.reason).toMatch(/duplicate/);
    expect(summary.loaded).toContain('tspml-example-hud');
    expect(summary.loaded).toContain('tspml-checkpoint-counter');
  });

  it('pre-fails the SECOND user mod claiming the same id', async () => {
    const summary = await loadMods(fakeApi(), {
      userMods: [record({ id: 'twin' }), record({ id: 'twin' })],
      importUserMod: async () => ({ default: () => {} }),
    });
    expect(summary.loaded).toContain('twin');
    expect(summary.failed.filter((f) => f.id === 'twin')).toHaveLength(1);
  });

  it('reports declared mixins as skipped rather than silently ignoring them (#62)', async () => {
    const withMixins = record({ id: 'mixin-mod' });
    (withMixins.manifest as Record<string, unknown>).mixins = [{ config: 'mixins.json' }];
    const summary = await loadMods(fakeApi(), {
      userMods: [withMixins],
      importUserMod: async () => ({ default: () => {} }),
    });
    expect(summary.loaded).toContain('mixin-mod');
    expect(summary.mixinsSkipped).toEqual(['mixin-mod']);
    // Bundled mods' mixins ARE applied (server-side) — they must not appear here.
    expect(summary.mixinsSkipped).not.toContain('tspml-example-hud');
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
