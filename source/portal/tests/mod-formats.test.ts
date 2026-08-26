/**
 * Format dispatch for mod import (lib/mod-formats/).
 *
 * `tests/mod-import.test.ts` already pins the TSPML format's behaviour end to
 * end through `importModFromUrl`, and it kept passing unchanged across the
 * split — that is the regression net for the move itself. What THIS file covers
 * is the seam the split added: which format gets chosen, and whether a format
 * that cannot run is refused by name rather than by accident.
 *
 * The distinction matters. Before the seam, pointing the importer at a PML
 * manifest produced "the manifest has no 'entrypoint'" — true, and useless: it
 * describes a missing TSPML field instead of the real situation, which is a
 * valid mod in another loader's format. A test that only asserted `ok === false`
 * would have passed then and would pass now, so these assert on the REASON.
 *
 * Since the compatibility adapter landed, a PML manifest is no longer refused —
 * it is walked, translated and stamped `format: 'pml'` so the runtime knows to
 * execute it through `lib/pml/`. The assertions below moved with it: what they
 * pin is that the DISPATCH is right (which format ran, what it stamped), not
 * that the translation is (that is `tests/pml-manifest.test.ts`'s job).
 */
import { describe, expect, it } from 'vitest';
import { importModFromUrl } from '@/lib/mod-import';
import {
  isSupportedFormat,
  sniffManifestFormat,
  SUPPORTED_FORMATS,
} from '@/lib/mod-formats';

type Route = { body: string; contentType?: string; status?: number };

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

/** A real PML manifest's shape: the mod metadata nests under `polymod`, and
 *  the entry file is named by `main` (resolved as `<main>.mod.js`). */
const PML_MANIFEST = {
  polymod: {
    name: 'Some PML Mod',
    id: 'somepmlmod',
    author: 'someone',
    targets: ['0.5.0'],
    main: 'main',
  },
  dependencies: [],
};

const TSPML_MANIFEST = {
  schemaVersion: 1,
  id: 'url-mod',
  name: 'URL Mod',
  version: '1.0.0',
  environment: 'web',
  entrypoint: 'index.js',
};

describe('sniffManifestFormat', () => {
  it('reads entrypoint as tspml and polymod as pml', () => {
    expect(sniffManifestFormat(TSPML_MANIFEST)).toBe('tspml');
    expect(sniffManifestFormat(PML_MANIFEST)).toBe('pml');
  });

  it('prefers tspml when a manifest declares BOTH', () => {
    // Shipping one mod for both loaders means one manifest carrying both
    // markers. Resolving that to the format we can actually run is the whole
    // reason the checks are ordered rather than exclusive.
    expect(sniffManifestFormat({ ...TSPML_MANIFEST, ...PML_MANIFEST })).toBe('tspml');
  });

  it('returns null for shapes that declare neither', () => {
    expect(sniffManifestFormat({ name: 'no markers' })).toBeNull();
    expect(sniffManifestFormat([1, 2, 3])).toBeNull();
    expect(sniffManifestFormat(null)).toBeNull();
    expect(sniffManifestFormat('a string')).toBeNull();
    // An empty-string entrypoint is not an entrypoint.
    expect(sniffManifestFormat({ entrypoint: '' })).toBeNull();
    // ...and neither is a null polymod.
    expect(sniffManifestFormat({ polymod: null })).toBeNull();
  });
});

describe('SUPPORTED_FORMATS', () => {
  it('is tspml and pml — pml through the compatibility adapter', () => {
    expect(SUPPORTED_FORMATS).toEqual(['tspml', 'pml']);
    expect(isSupportedFormat('tspml')).toBe(true);
    expect(isSupportedFormat('pml')).toBe(true);
    expect(isSupportedFormat('nonsense')).toBe(false);
  });
});

describe('importModFromUrl — PML detection', () => {
  it('routes a PML manifest to the pml format and stamps the result', async () => {
    const { impl } = fakeFetch({
      [`${BASE}/manifest.json`]: { body: JSON.stringify(PML_MANIFEST), contentType: 'application/json' },
      [`${BASE}/main.mod.js`]: { body: 'export const polyMod = {};' },
    });
    const res = await importModFromUrl(`${BASE}/manifest.json`, impl);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The stamp is the load-bearing part: it is what decides, later, that this
    // code runs through `lib/pml/` rather than down the native path. A mod that
    // imported cleanly and lost its format would fail at load time in someone
    // else's file.
    expect(res.mod.format).toBe('pml');
    expect(res.mod.manifest.id).toBe('somepmlmod');
    expect(res.mod.code).toBe('export const polyMod = {};');
    // And the import says what it is, up front, rather than leaving the player
    // to discover the adapter's limits by wondering why nothing happened.
    expect(res.mod.note).toMatch(/compatibility adapter/);
  });

  it('detects it when served as text/plain too (raw hosts do this)', async () => {
    const { impl } = fakeFetch({
      [`${BASE}/manifest.json`]: { body: JSON.stringify(PML_MANIFEST), contentType: 'text/plain' },
      [`${BASE}/main.mod.js`]: { body: 'export const polyMod = {};' },
    });
    const res = await importModFromUrl(`${BASE}/manifest.json`, impl);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mod.format).toBe('pml');
  });

  it('fetches the entry named by `main`, resolved against the manifest', async () => {
    // PML names its code file by stem — `"main": "main"` means `main.mod.js`,
    // relative to the manifest that named it. Getting this wrong is a 404 the
    // player reads as "the mod is gone" rather than "we looked in the wrong
    // place", so the exact request list is the assertion.
    const { impl, requested } = fakeFetch({
      [`${BASE}/manifest.json`]: { body: JSON.stringify(PML_MANIFEST), contentType: 'application/json' },
      [`${BASE}/main.mod.js`]: { body: 'export const polyMod = {};' },
    });
    const res = await importModFromUrl(`${BASE}/manifest.json`, impl);
    expect(res.ok).toBe(true);
    expect(requested).toEqual([`${BASE}/manifest.json`, `${BASE}/main.mod.js`]);
  });

  it('reports a missing entry file by name rather than as a broken manifest', async () => {
    const { impl } = fakeFetch({
      [`${BASE}/manifest.json`]: { body: JSON.stringify(PML_MANIFEST), contentType: 'application/json' },
    });
    const res = await importModFromUrl(`${BASE}/manifest.json`, impl);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/entry \(main\.mod\.js\)/);
  });
});

describe('importModFromUrl — explicit format option', () => {
  it('honours an explicit tspml without sniffing', async () => {
    const { impl } = fakeFetch({
      [`${BASE}/mod.json`]: { body: JSON.stringify(TSPML_MANIFEST), contentType: 'application/json' },
      [`${BASE}/index.js`]: { body: 'export default () => ({});' },
    });
    const res = await importModFromUrl(`${BASE}/mod.json`, impl, { format: 'tspml' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mod.manifest.id).toBe('url-mod');
  });

  it('an explicit pml fails on a tspml manifest rather than falling back to a sniff', async () => {
    // The caller stating a format is a claim about the mod, not a request to
    // guess — so a wrong claim must fail rather than silently fall back to a
    // sniff that would have worked. The reason names both shapes the PML walk
    // accepts, so an author who mislabelled a catalog entry can see which of
    // them their file was measured against.
    const { impl } = fakeFetch({
      [`${BASE}/mod.json`]: { body: JSON.stringify(TSPML_MANIFEST), contentType: 'application/json' },
      [`${BASE}/index.js`]: { body: 'export default () => ({});' },
    });
    const res = await importModFromUrl(`${BASE}/mod.json`, impl, { format: 'pml' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/does not look like a PML manifest/);
      expect(res.error).toMatch(/'polymod'/);
      expect(res.error).toMatch(/'latest'/);
    }
  });

  it('an explicit format skips the SNIFF fetch — the format does its own', async () => {
    // The dispatcher's probe exists only to decide which format to run. With
    // the format already stated there is nothing to decide, so the one request
    // that happens is the chosen format's own first hop, not a probe plus it.
    const { impl, requested } = fakeFetch({});
    await importModFromUrl(`${BASE}/manifest.json`, impl, { format: 'pml' });
    expect(requested).toEqual([`${BASE}/manifest.json`]);
  });
});

describe('importModFromUrl — the probe is not an extra round-trip', () => {
  it('fetches a manifest exactly once despite detection', async () => {
    // Detection reads the same bytes the format needs. If the probe body were
    // dropped instead of threaded through ImportContext, this would be 2.
    const { impl, requested } = fakeFetch({
      [`${BASE}/mod.json`]: { body: JSON.stringify(TSPML_MANIFEST), contentType: 'application/json' },
      [`${BASE}/index.js`]: { body: 'export default () => ({});' },
    });
    const res = await importModFromUrl(`${BASE}/mod.json`, impl);
    expect(res.ok).toBe(true);
    expect(requested.filter((u) => u === `${BASE}/mod.json`)).toHaveLength(1);
  });

  it('fetches a bare .js exactly once, with no probe at all', async () => {
    const { impl, requested } = fakeFetch({
      [`${BASE}/thing.js`]: { body: 'export default () => ({});' },
    });
    const res = await importModFromUrl(`${BASE}/thing.js`, impl);
    expect(res.ok).toBe(true);
    expect(requested).toEqual([`${BASE}/thing.js`]);
  });
});
