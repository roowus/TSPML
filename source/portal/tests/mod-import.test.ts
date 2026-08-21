/**
 * URL mod import (#80 first slice, lib/mod-import.ts).
 *
 * All network is a fake fetch — these tests pin the DISPATCH (manifest URL vs
 * single file vs sniffed), the relative resolution of entrypoint/mixins, the
 * host checks (kodub + /api refused, also for URLs a manifest resolves to),
 * and the add-time caps. No test touches the real network.
 */
import { describe, expect, it } from 'vitest';
import { checkImportUrl, importModFromUrl, IMPORT_LIMITS } from '@/lib/mod-import';

type Route = { body: string; contentType?: string; status?: number };

/** fetch stub serving a fixed URL→body table; anything else 404s. */
function fakeFetch(routes: Record<string, Route>) {
  const requested: string[] = [];
  const impl = (url: string): Promise<Response> => {
    requested.push(url);
    const r = routes[url];
    if (!r) return Promise.resolve(new Response('not found', { status: 404 }));
    return Promise.resolve(
      new Response(r.body, {
        status: r.status ?? 200,
        headers: { 'content-type': r.contentType ?? 'text/plain' },
      }),
    );
  };
  return { impl, requested };
}

const BASE = 'https://raw.example.com/you/mod/main';
const MANIFEST = {
  schemaVersion: 1,
  id: 'url-mod',
  name: 'URL Mod',
  version: '1.0.0',
  environment: 'web',
  entrypoint: 'index.js',
};

describe('checkImportUrl', () => {
  it('accepts https and localhost http', () => {
    expect(checkImportUrl('https://example.com/mod.json').ok).toBe(true);
    expect(checkImportUrl('http://localhost:3000/mod.js').ok).toBe(true);
  });

  it('refuses non-URLs, plain http, kodub hosts', () => {
    expect(checkImportUrl('not a url').ok).toBe(false);
    expect(checkImportUrl('http://example.com/mod.js').ok).toBe(false);
    expect(checkImportUrl('https://kodub.com/x.js').ok).toBe(false);
    expect(checkImportUrl('https://app-polytrack.kodub.com/0.6.2/main.bundle.js').ok).toBe(false);
  });
});

describe('importModFromUrl — single file', () => {
  it('imports a bare .js URL with a synthesized manifest', async () => {
    const { impl } = fakeFetch({
      [`${BASE}/My_Mod.v2.js`]: { body: 'export default () => {};' },
    });
    const r = await importModFromUrl(`${BASE}/My_Mod.v2.js`, impl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.code).toContain('export default');
    expect(r.mod.manifest).toMatchObject({
      schemaVersion: 1,
      id: 'my-mod-v2',
      environment: 'web',
      targets: [], // required by the loader's validator; empty = any version
    });
    expect(r.mod.note).toContain('minimal manifest');
    expect(r.mod.mixins).toBeUndefined();
  });

  it('sniffs an extension-less URL served as code', async () => {
    const url = 'https://cdn.example.com/abc123';
    const { impl } = fakeFetch({ [url]: { body: 'export default (api) => {};' } });
    const r = await importModFromUrl(url, impl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.manifest.id).toBe('abc123');
  });
});

describe('importModFromUrl — manifest URL', () => {
  it('fetches entrypoint and web-host mixins relative to the manifest', async () => {
    const manifest = {
      ...MANIFEST,
      mixins: [
        { config: 'mixins.json', environment: 'web' },
        { config: 'desktop.json', environment: 'desktop' }, // must NOT be fetched (#21)
      ],
    };
    const { impl, requested } = fakeFetch({
      [`${BASE}/mod.json`]: { body: JSON.stringify(manifest), contentType: 'application/json' },
      [`${BASE}/index.js`]: { body: 'export default () => {};' },
      [`${BASE}/mixins.json`]: {
        body: JSON.stringify({ patches: [{ op: 'after', symbol: 'Car.controlCar', inject: '1;' }] }),
        contentType: 'application/json',
      },
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.manifest.id).toBe('url-mod');
    expect(r.mod.mixins).toHaveLength(1);
    expect(r.mod.note).toBeUndefined();
    expect(requested).not.toContain(`${BASE}/desktop.json`);
  });

  it('sniffs a manifest served without .json extension as text/plain', async () => {
    const url = 'https://gist.example.com/raw/xyz';
    const { impl } = fakeFetch({
      [url]: { body: JSON.stringify(MANIFEST) },
      ['https://gist.example.com/raw/index.js']: { body: 'export default () => {};' },
    });
    const r = await importModFromUrl(url, impl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.manifest.id).toBe('url-mod');
  });

  it('fails clearly when the manifest lacks an entrypoint', async () => {
    const { impl } = fakeFetch({
      [`${BASE}/mod.json`]: {
        body: JSON.stringify({ schemaVersion: 1, id: 'x' }),
        contentType: 'application/json',
      },
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('entrypoint') });
  });

  it('refuses a manifest whose entrypoint resolves to a kodub URL', async () => {
    const { impl, requested } = fakeFetch({
      [`${BASE}/mod.json`]: {
        body: JSON.stringify({ ...MANIFEST, entrypoint: 'https://app-polytrack.kodub.com/x.js' }),
        contentType: 'application/json',
      },
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r.ok).toBe(false);
    expect(requested).toHaveLength(1); // the kodub URL was never fetched
  });

  it('surfaces HTTP failures with the status and host', async () => {
    const { impl } = fakeFetch({
      [`${BASE}/mod.json`]: { body: JSON.stringify(MANIFEST), contentType: 'application/json' },
      // index.js missing → 404
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('HTTP 404') });
  });

  it('enforces the mixin patch caps at import time', async () => {
    const patches = Array.from({ length: 33 }, () => ({ op: 'after', symbol: 'X', inject: '1;' }));
    const { impl } = fakeFetch({
      [`${BASE}/mod.json`]: {
        body: JSON.stringify({ ...MANIFEST, mixins: [{ config: 'mixins.json', environment: 'web' }] }),
        contentType: 'application/json',
      },
      [`${BASE}/index.js`]: { body: 'export default () => {};' },
      [`${BASE}/mixins.json`]: { body: JSON.stringify({ patches }), contentType: 'application/json' },
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('limit is 32') });
  });

  it('enforces the code size cap', async () => {
    const { impl } = fakeFetch({
      [`${BASE}/big.js`]: { body: 'x'.repeat(IMPORT_LIMITS.maxCodeChars + 1) },
    });
    const r = await importModFromUrl(`${BASE}/big.js`, impl);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('limit') });
  });
});

describe('importModFromUrl — physics.json (#43)', () => {
  const HASH = 'd4ef02676973d41afc34b23b5248f6950b35dc4cc7e3047e3a9c6bd88e4c180e';
  const SIG = '1'.repeat(64);
  const PHYSICS = { wasmHash: HASH, patches: [{ name: 'grip', signature: SIG, oldValue: 1.05, newValue: 1.4 }] };

  it('fetches the declared physics.json relative to the manifest', async () => {
    const { impl, requested } = fakeFetch({
      [`${BASE}/mod.json`]: {
        body: JSON.stringify({ ...MANIFEST, physics: 'physics.json' }),
        contentType: 'application/json',
      },
      [`${BASE}/index.js`]: { body: 'export default () => {};' },
      [`${BASE}/physics.json`]: { body: JSON.stringify(PHYSICS), contentType: 'application/json' },
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.physics).toEqual(PHYSICS);
    expect(requested).toContain(`${BASE}/physics.json`);
  });

  it('resolves a subdirectory path the same way the entrypoint does', async () => {
    const { impl, requested } = fakeFetch({
      [`${BASE}/mod.json`]: {
        body: JSON.stringify({ ...MANIFEST, physics: 'data/physics.json' }),
        contentType: 'application/json',
      },
      [`${BASE}/index.js`]: { body: 'export default () => {};' },
      [`${BASE}/data/physics.json`]: { body: JSON.stringify(PHYSICS), contentType: 'application/json' },
    });
    expect((await importModFromUrl(`${BASE}/mod.json`, impl)).ok).toBe(true);
    expect(requested).toContain(`${BASE}/data/physics.json`);
  });

  it('leaves physics undefined when the manifest declares none', async () => {
    const { impl } = fakeFetch({
      [`${BASE}/mod.json`]: { body: JSON.stringify(MANIFEST), contentType: 'application/json' },
      [`${BASE}/index.js`]: { body: 'export default () => {};' },
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.physics).toBeUndefined();
  });

  it('fails the WHOLE import when the declared physics.json is missing', async () => {
    // Not a partial success: the mod said it patches the binary, and importing
    // it minus that file would install something that quietly is not the mod.
    const { impl } = fakeFetch({
      [`${BASE}/mod.json`]: {
        body: JSON.stringify({ ...MANIFEST, physics: 'physics.json' }),
        contentType: 'application/json',
      },
      [`${BASE}/index.js`]: { body: 'export default () => {};' },
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('HTTP 404') });
    if (r.ok) return;
    expect(r.error).toContain('physics');
  });

  it('refuses a physics.json this build cannot parse, at import time', async () => {
    // The author is here NOW. Storing it and excluding it from the plan an hour
    // later would report the failure to whoever is playing, not whoever can fix it.
    const { impl } = fakeFetch({
      [`${BASE}/mod.json`]: {
        body: JSON.stringify({ ...MANIFEST, physics: 'physics.json' }),
        contentType: 'application/json',
      },
      [`${BASE}/index.js`]: { body: 'export default () => {};' },
      [`${BASE}/physics.json`]: {
        body: JSON.stringify({ patches: PHYSICS.patches }), // no wasmHash
        contentType: 'application/json',
      },
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('wasmHash') });
  });

  it('refuses a physics path that resolves to a kodub URL, without fetching it', async () => {
    const { impl, requested } = fakeFetch({
      [`${BASE}/mod.json`]: {
        body: JSON.stringify({ ...MANIFEST, physics: 'https://app-polytrack.kodub.com/p.json' }),
        contentType: 'application/json',
      },
      [`${BASE}/index.js`]: { body: 'export default () => {};' },
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r.ok).toBe(false);
    expect(requested).not.toContain('https://app-polytrack.kodub.com/p.json');
  });

  it('enforces the physics size cap', async () => {
    const { impl } = fakeFetch({
      [`${BASE}/mod.json`]: {
        body: JSON.stringify({ ...MANIFEST, physics: 'physics.json' }),
        contentType: 'application/json',
      },
      [`${BASE}/index.js`]: { body: 'export default () => {};' },
      [`${BASE}/physics.json`]: { body: 'x'.repeat(IMPORT_LIMITS.maxPhysicsChars + 1) },
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('limit') });
  });

  it('stores the RAW file, not this build’s normalised plan', async () => {
    // The record's contract is "the file as the author wrote it": it is re-parsed
    // on every use, so freezing today's normalisation into storage would make an
    // upgraded parser disagree with what the author actually shipped.
    const raw = {
      wasmHash: `sha256:${HASH.toUpperCase()}`,
      patches: [{ name: 'grip', signature: SIG.toUpperCase(), oldValue: 1.05, newValue: 1.4 }],
      note: 'a field this build ignores',
    };
    const { impl } = fakeFetch({
      [`${BASE}/mod.json`]: {
        body: JSON.stringify({ ...MANIFEST, physics: 'physics.json' }),
        contentType: 'application/json',
      },
      [`${BASE}/index.js`]: { body: 'export default () => {};' },
      [`${BASE}/physics.json`]: { body: JSON.stringify(raw), contentType: 'application/json' },
    });
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.physics).toEqual(raw);
  });
});

describe('importModFromUrl — fresh (the ⟳ reload path)', () => {
  // A stub that matches routes IGNORING the query string and records what the
  // import actually sent, so the cache-defeat contract is pinned: without
  // `fresh` a reload can be silently satisfied by the browser's HTTP cache or
  // the host CDN's (raw.githubusercontent.com: max-age=300) — the "I pushed a
  // new build but reload didn't update" bug.
  function recordingFetch(routes: Record<string, Route>) {
    const calls: { url: string; cache: RequestCache | undefined }[] = [];
    const impl = (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, cache: init?.cache });
      const bare = url.split('?')[0]!;
      const r = routes[bare];
      if (!r) return Promise.resolve(new Response('not found', { status: 404 }));
      return Promise.resolve(
        new Response(r.body, { status: 200, headers: { 'content-type': r.contentType ?? 'text/plain' } }),
      );
    };
    return { impl, calls };
  }

  const routes: Record<string, Route> = {
    [`${BASE}/mod.json`]: {
      body: JSON.stringify({ ...MANIFEST, mixins: [{ config: 'mixins.json', environment: 'web' }] }),
      contentType: 'application/json',
    },
    [`${BASE}/index.js`]: { body: 'export default () => {};' },
    [`${BASE}/mixins.json`]: {
      body: JSON.stringify({ patches: [{ op: 'after', symbol: 'Car.controlCar', inject: '1;' }] }),
      contentType: 'application/json',
    },
  };

  it('busts both cache layers on EVERY fetched file: no-cache mode + one shared tspml_fresh param', async () => {
    const { impl, calls } = recordingFetch(routes);
    const r = await importModFromUrl(`${BASE}/mod.json`, impl, { fresh: true });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(3); // manifest + entrypoint + mixins
    const busts = calls.map((c) => new URL(c.url).searchParams.get('tspml_fresh'));
    expect(busts.every((b) => typeof b === 'string' && b.length > 0)).toBe(true);
    expect(new Set(busts).size).toBe(1); // one freshness horizon per import
    expect(calls.every((c) => c.cache === 'no-cache')).toBe(true);
  });

  it('a plain import stays cache-friendly: no param, default cache mode', async () => {
    const { impl, calls } = recordingFetch(routes);
    const r = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(r.ok).toBe(true);
    expect(calls.every((c) => !c.url.includes('tspml_fresh'))).toBe(true);
    expect(calls.every((c) => c.cache === 'default')).toBe(true);
  });
});
