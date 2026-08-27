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

/** A LEGACY (0.5.x) PML version manifest: metadata nests under `polymod`, and
 *  `main` here is a bare stem, which the walk completes to `<main>.mod.js`. */
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

/**
 * The CURRENT (0.6.x) layout, copied from PolyProxy as actually served.
 *
 * Identity lives in the index and NOWHERE else; the version manifest is flat and
 * carries only what varies per version. Every mod in PML's registry with a 0.6.2
 * build looks like this, so a walk that cannot do it is a walk that installs no
 * current PML mod at all.
 */
const CURRENT_INDEX = {
  name: 'PolyProxy',
  id: 'polyproxy',
  author: 'Orangy',
  latest: { '0.6.1': '1.1.8', '0.6.2': '10.0.0' },
};
const CURRENT_VERSION = { targets: ['0.6.2'], main: 'main.mod.js', dependencies: [] };

/** The LEGACY index: a bare game→mod version map, no wrapper, no identity. */
const LEGACY_INDEX = { '0.5.1': '1.5.0', '0.5.2': '1.6.0' };

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

  it('reads BOTH PML generations, neither of which looks like the other', () => {
    // `polymod` is not the marker it looks like — no 0.6.x mod has one — and a
    // legacy index has no marker key at all. Sniffing on `polymod`/`latest`
    // alone read three of these four as "not a mod format".
    expect(sniffManifestFormat(CURRENT_INDEX)).toBe('pml');
    expect(sniffManifestFormat(CURRENT_VERSION)).toBe('pml');
    expect(sniffManifestFormat(LEGACY_INDEX)).toBe('pml');
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

describe('importModFromUrl — the PML walk, both generations', () => {
  it('walks a CURRENT mod: index → version manifest → code', async () => {
    // The whole point of the walk. Identity comes from the index, targets and
    // `main` from the version manifest, and the mod version from the index key
    // the game version matched — no single file here has all of it.
    const { impl, requested } = fakeFetch({
      [`${BASE}/manifest.json`]: { body: JSON.stringify(CURRENT_INDEX), contentType: 'application/json' },
      [`${BASE}/10.0.0/version.json`]: {
        body: JSON.stringify(CURRENT_VERSION),
        contentType: 'application/json',
      },
      [`${BASE}/10.0.0/main.mod.js`]: { body: 'export const polyMod = {};' },
    });
    const res = await importModFromUrl(`${BASE}/manifest.json`, impl);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mod.format).toBe('pml');
    expect(res.mod.manifest.id).toBe('polyproxy');
    expect(res.mod.manifest.name).toBe('PolyProxy');
    expect(res.mod.manifest.version).toBe('10.0.0');
    expect(res.mod.manifest.targets).toEqual(['0.6.2']);
    expect(res.mod.code).toBe('export const polyMod = {};');
    // `main` is used VERBATIM. Appending `.mod.js` asked for main.mod.js.mod.js,
    // which 404s — so the exact request list is the assertion.
    expect(requested).toEqual([
      `${BASE}/manifest.json`,
      `${BASE}/10.0.0/version.json`,
      `${BASE}/10.0.0/main.mod.js`,
    ]);
  });

  it('walks a LEGACY mod: bare index → polymod manifest → code', async () => {
    // The old spelling, still served by more than half of PML's registry. The
    // index carries no identity at all, so everything comes from `polymod` —
    // and the version manifest is named `manifest.json` down here, which is why
    // the walk probes by content instead of trusting the filename.
    const { impl, requested } = fakeFetch({
      [`${BASE}/latest.json`]: { body: JSON.stringify(LEGACY_INDEX), contentType: 'application/json' },
      [`${BASE}/1.6.0/manifest.json`]: {
        body: JSON.stringify(PML_MANIFEST),
        contentType: 'application/json',
      },
      [`${BASE}/1.6.0/main.mod.js`]: { body: 'export const polyMod = {};' },
    });
    // A 0.5.x-only index has more than one entry and no 0.6.2 key, so it must
    // refuse rather than guess — that is `pickPmlVersion`'s rule, and it is
    // the correct outcome for a mod that has no build for this game.
    const refused = await importModFromUrl(`${BASE}/latest.json`, impl);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/no build for PolyTrack/);

    // Pointed straight at the version manifest, it installs.
    const res = await importModFromUrl(`${BASE}/1.6.0/manifest.json`, impl);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mod.format).toBe('pml');
    expect(res.mod.manifest.id).toBe('somepmlmod');
    expect(requested.at(-1)).toBe(`${BASE}/1.6.0/main.mod.js`);
  });

  it('follows a bare index when it does name this game version', async () => {
    // Same legacy shape, but with a build for the version this portal serves.
    // The bare map has no `latest` wrapper to recognise it by, so this is what
    // proves the structural test actually drives the walk.
    const { impl } = fakeFetch({
      [`${BASE}/latest.json`]: {
        body: JSON.stringify({ '0.6.2': '1.6.0' }),
        contentType: 'application/json',
      },
      [`${BASE}/1.6.0/manifest.json`]: {
        body: JSON.stringify(PML_MANIFEST),
        contentType: 'application/json',
      },
      [`${BASE}/1.6.0/main.mod.js`]: { body: 'export const polyMod = {};' },
    });
    const res = await importModFromUrl(`${BASE}/latest.json`, impl);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mod.manifest.version).toBe('1.6.0');
  });

  it('walks from a mod ROOT url, which is what a mod page links to', async () => {
    // A directory URL names no file, so both index spellings get probed. This
    // is the form PML addresses mods by and the form the registry stores, so it
    // is the form that has to work.
    const { impl, requested } = fakeFetch({
      [`${BASE}/manifest.json`]: { body: JSON.stringify(CURRENT_INDEX), contentType: 'application/json' },
      [`${BASE}/10.0.0/version.json`]: {
        body: JSON.stringify(CURRENT_VERSION),
        contentType: 'application/json',
      },
      [`${BASE}/10.0.0/main.mod.js`]: { body: 'export const polyMod = {};' },
    });
    const res = await importModFromUrl(`${BASE}/`, impl);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mod.manifest.id).toBe('polyproxy');
    // And the DIRECTORY itself is never fetched. There is nothing to sniff at a
    // directory — the real CDN answers one with a GitHub-style listing ARRAY,
    // which declares no format and would fall through to tspml, reporting a
    // missing 'entrypoint' for something that was never a manifest.
    expect(requested).not.toContain(`${BASE}/`);
  });

  it('treats a root with NO trailing slash as a directory too', async () => {
    // `.../mod` and `.../mod/` are the same mod page link; only one of them
    // ends in a slash, and neither has a dot in its last segment.
    const { impl } = fakeFetch({
      [`${BASE}/manifest.json`]: { body: JSON.stringify(CURRENT_INDEX), contentType: 'application/json' },
      [`${BASE}/10.0.0/version.json`]: {
        body: JSON.stringify(CURRENT_VERSION),
        contentType: 'application/json',
      },
      [`${BASE}/10.0.0/main.mod.js`]: { body: 'export const polyMod = {};' },
    });
    const res = await importModFromUrl(BASE, impl);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mod.manifest.id).toBe('polyproxy');
  });

  it('walks a dotless root that ANSWERS, when the answer is a listing array', async () => {
    // The real CDN shape, and the reason path form alone cannot decide this:
    // `cdn.polymodloader.com/gh/o/r/main/polyproxy` returns HTTP 200 with a
    // GitHub-style array of directory entries. A dotless URL that answers is
    // otherwise indistinguishable from a gist raw serving a TSPML file, so the
    // array — which no manifest of either format can be — is what separates
    // them. Verified against the live CDN, not assumed.
    const { impl } = fakeFetch({
      [BASE]: {
        body: JSON.stringify([
          { name: '1.0.0', path: 'polyproxy/1.0.0', type: 'dir', download_url: null },
          { name: '10.0.0', path: 'polyproxy/10.0.0', type: 'dir', download_url: null },
        ]),
        contentType: 'application/json',
      },
      [`${BASE}/manifest.json`]: { body: JSON.stringify(CURRENT_INDEX), contentType: 'application/json' },
      [`${BASE}/10.0.0/version.json`]: {
        body: JSON.stringify(CURRENT_VERSION),
        contentType: 'application/json',
      },
      [`${BASE}/10.0.0/main.mod.js`]: { body: 'export const polyMod = {};' },
    });
    const res = await importModFromUrl(BASE, impl);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.mod.format).toBe('pml');
      expect(res.mod.manifest.id).toBe('polyproxy');
    }
  });

  it('leaves a dotless URL that serves a real TSPML manifest to tspml', async () => {
    // The other half of the same coin, and the regression this guards: treating
    // every dotless path as a PML root sent gist raws and hash-named CDN
    // objects — ordinary TSPML hosting — into the PML walk, where they failed
    // for a reason having nothing to do with what they were.
    const { impl } = fakeFetch({
      'https://gist.example.com/raw/deadbeef': {
        body: JSON.stringify({ schemaVersion: 1, id: 'gist-mod', entrypoint: 'index.js', targets: [] }),
      },
      'https://gist.example.com/raw/index.js': { body: 'export default () => {};' },
    });
    const res = await importModFromUrl('https://gist.example.com/raw/deadbeef', impl);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.mod.format).toBe('tspml');
      expect(res.mod.manifest.id).toBe('gist-mod');
    }
  });

  it('refuses a CURRENT version manifest reached without its index, by name', async () => {
    // Pointing at `<mod>/10.0.0/version.json` skips the only file that states
    // who the mod is. Refusing is right; refusing while blaming a `polymod`
    // block the mod never had would send the reader to the wrong file.
    const { impl } = fakeFetch({
      [`${BASE}/10.0.0/version.json`]: {
        body: JSON.stringify(CURRENT_VERSION),
        contentType: 'application/json',
      },
    });
    const res = await importModFromUrl(`${BASE}/10.0.0/version.json`, impl);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/'id'/);
      expect(res.error).toMatch(/index manifest/);
    }
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
      expect(res.error).toMatch(/'main'/);
      expect(res.error).toMatch(/'polymod'/);
      expect(res.error).toMatch(/game versions to mod versions/);
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
