// Unit tests for lib/mod-reload.ts — the "⟳ Reload mods" feature's re-fetch
// half. The import itself is faked (mod-import has its own tests); these pin
// WHICH mods get re-fetched, what survives a failure, and what carries over
// from the stored record.
import { describe, expect, it } from 'vitest';
import type { ImportResult } from '../lib/mod-import.js';
import { refreshFromSources } from '../lib/mod-reload.js';
import type { UserModRecord } from '../lib/user-mods.js';

function record(overrides: Partial<UserModRecord> & { id?: string } = {}): UserModRecord {
  const { id = 'user-mod', ...rest } = overrides;
  return {
    manifest: {
      schemaVersion: 1,
      id,
      name: 'A user mod',
      version: '1.0.0',
      entrypoint: 'entrypoint.js',
      targets: [],
    },
    code: 'export default (api) => {};',
    enabled: true,
    addedAt: '2026-08-07T00:00:00.000Z',
    ...rest,
  };
}

function okImport(
  id: string,
  version: string,
  mixins?: Record<string, unknown>[],
  physics?: Record<string, unknown>,
): ImportResult {
  return {
    ok: true,
    mod: {
      manifest: { schemaVersion: 1, id, version, entrypoint: 'index.js', targets: [] },
      code: `// ${version}\nexport default () => {};`,
      ...(mixins === undefined ? {} : { mixins }),
      ...(physics === undefined ? {} : { physics }),
    },
  };
}

const HASH = 'd4ef02676973d41afc34b23b5248f6950b35dc4cc7e3047e3a9c6bd88e4c180e';
const PHYSICS = {
  wasmHash: HASH,
  patches: [{ name: 'grip', signature: '1'.repeat(64), oldValue: 1.05, newValue: 1.4 }],
};

describe('refreshFromSources', () => {
  it('re-fetches only mods with a sourceUrl; pasted mods pass through untouched', async () => {
    const pasted = record({ id: 'pasted' });
    const imported = record({ id: 'from-url', sourceUrl: 'https://host.example/mod.json' });
    const urls: string[] = [];
    const r = await refreshFromSources([pasted, imported], undefined, (url) => {
      urls.push(url);
      return Promise.resolve(okImport('from-url', '2.0.0'));
    });
    expect(urls).toEqual(['https://host.example/mod.json']);
    expect(r.refetched).toEqual(['from-url']);
    expect(r.failures).toEqual([]);
    expect(r.noSource).toEqual(['pasted']); // named, so the page can say "stored copy"
    expect(r.next[0]).toBe(pasted); // same object — nothing to rebuild
    expect(r.next[1]!.manifest.version).toBe('2.0.0');
    expect(r.next[1]!.code).toContain('2.0.0');
  });

  it('carries over enabled state, addedAt, and the sourceUrl itself', async () => {
    const imported = record({
      id: 'from-url',
      sourceUrl: 'https://host.example/mod.json',
      enabled: false,
    });
    const r = await refreshFromSources([imported], undefined, () =>
      Promise.resolve(okImport('from-url', '2.0.0')),
    );
    expect(r.next[0]!.enabled).toBe(false);
    expect(r.next[0]!.addedAt).toBe('2026-08-07T00:00:00.000Z');
    expect(r.next[0]!.sourceUrl).toBe('https://host.example/mod.json');
  });

  it('replaces the mixins with the re-fetched ones, and drops stale ones when the source no longer ships any', async () => {
    const withMixins = record({
      id: 'a',
      sourceUrl: 'https://host.example/a.json',
      mixins: [{ op: 'after', symbol: 'Car', inject: 'old();' }],
    });
    const r = await refreshFromSources([withMixins], undefined, () =>
      Promise.resolve(okImport('a', '1.1.0')),
    );
    expect(r.next[0]!.mixins).toBeUndefined();
  });

  it('replaces the stored physics.json with the re-fetched one (#43)', async () => {
    const stale = { ...PHYSICS, patches: [{ ...PHYSICS.patches[0]!, newValue: 9.9 }] };
    const mod = record({ id: 'a', sourceUrl: 'https://host.example/a.json', physics: stale });
    const r = await refreshFromSources([mod], undefined, () =>
      Promise.resolve(okImport('a', '1.1.0', undefined, PHYSICS)),
    );
    expect(r.next[0]!.physics).toEqual(PHYSICS);
  });

  it('drops the stored physics.json when the source no longer ships one (#43)', async () => {
    // Absence upstream MEANS absence. Keeping the old copy would keep writing
    // constants into the binary that the current build was never derived
    // against — the one failure mode this whole path exists to refuse.
    const mod = record({ id: 'a', sourceUrl: 'https://host.example/a.json', physics: PHYSICS });
    const r = await refreshFromSources([mod], undefined, () => Promise.resolve(okImport('a', '1.1.0')));
    expect(r.next[0]!.physics).toBeUndefined();
  });

  it('keeps the stored physics.json when the re-fetch FAILS (#43)', async () => {
    // A host being down is not the author dropping the file — the distinction
    // matters here more than anywhere else, since guessing wrong either way
    // changes what the sim does.
    const mod = record({ id: 'a', sourceUrl: 'https://host.example/a.json', physics: PHYSICS });
    const r = await refreshFromSources([mod], undefined, () =>
      Promise.resolve({ ok: false as const, error: 'HTTP 503 from host.example' }),
    );
    expect(r.next[0]).toBe(mod);
    expect(r.next[0]!.physics).toEqual(PHYSICS);
  });

  it('keeps the stored copy and reports the failure when a re-fetch fails', async () => {
    const good = record({ id: 'good', sourceUrl: 'https://host.example/good.json' });
    const bad = record({ id: 'bad', sourceUrl: 'https://host.example/bad.json' });
    const r = await refreshFromSources([good, bad], undefined, (url) =>
      Promise.resolve(
        url.includes('bad')
          ? { ok: false as const, error: 'HTTP 500 from host.example' }
          : okImport('good', '3.0.0'),
      ),
    );
    expect(r.refetched).toEqual(['good']);
    expect(r.failures).toEqual([{ id: 'bad', error: 'HTTP 500 from host.example' }]);
    expect(r.next[1]).toBe(bad); // stored copy untouched
    expect(r.next[0]!.manifest.version).toBe('3.0.0');
  });

  it('scopes to a single mod when `only` is given', async () => {
    const a = record({ id: 'a', sourceUrl: 'https://host.example/a.json' });
    const b = record({ id: 'b', sourceUrl: 'https://host.example/b.json' });
    const urls: string[] = [];
    const r = await refreshFromSources([a, b], b, (url) => {
      urls.push(url);
      return Promise.resolve(okImport('b', '9.9.9'));
    });
    expect(urls).toEqual(['https://host.example/b.json']);
    expect(r.next[0]).toBe(a);
    expect(r.next[1]!.manifest.version).toBe('9.9.9');
  });

  it('fetches nothing for an all-pasted list, but NAMES the mods it could not re-fetch', async () => {
    const mods = [record({ id: 'a' }), record({ id: 'b' })];
    const r = await refreshFromSources(mods, undefined, () => {
      throw new Error('must not be called');
    });
    expect(r.next).toEqual(mods);
    expect(r.refetched).toEqual([]);
    expect(r.failures).toEqual([]);
    expect(r.noSource).toEqual(['a', 'b']);
  });

  it('an `only` reload of a pasted mod reports just that mod as no-source', async () => {
    const pasted = record({ id: 'pasted' });
    const imported = record({ id: 'from-url', sourceUrl: 'https://host.example/mod.json' });
    const r = await refreshFromSources([pasted, imported], pasted, () => {
      throw new Error('must not be called');
    });
    expect(r.noSource).toEqual(['pasted']);
    expect(r.refetched).toEqual([]);
  });
});
