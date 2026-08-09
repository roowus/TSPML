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
