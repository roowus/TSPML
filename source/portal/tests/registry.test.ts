/**
 * Two jobs, and the second is the one that earns its keep in CI:
 *
 *  1. `lib/registry.ts` behaves — malformed rows are dropped, author URLs are
 *     sanitized, a `pml` entry installs but says what it costs, dependencies
 *     resolve only through the catalog.
 *  2. The COMMITTED `public/registry/index.json` is valid. A catalog is data,
 *     and data is exactly the thing that gets edited by someone who will not
 *     run the app afterwards. A typo'd `format` or a dropped `source.url`
 *     should fail the build, not render as a card that breaks on click.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getRegistryEntry,
  installBlockedReason,
  installCaveat,
  isInstallable,
  listRegistry,
  parseRegistry,
  registryHttpUrl,
  registryIcon,
  registryTags,
  resolveDependencies,
  resolveSourceUrl,
  searchRegistry,
  type Registry,
  type RegistryEntry,
} from '../lib/registry';

const ORIGIN = 'https://tspml.example';

function entry(over: Partial<RegistryEntry> = {}): Record<string, unknown> {
  return {
    kind: 'mod',
    format: 'tspml',
    id: 'a-mod',
    name: 'A mod',
    author: 'someone',
    summary: 'does a thing',
    tags: ['hud'],
    source: { type: 'mod-json', url: 'https://cdn.example/a/mod.json' },
    gameVersions: ['0.6.2'],
    safety: { touchesPhysics: false, leaderboardRisk: 'none' },
    dependencies: [],
    ...over,
  };
}

const wrap = (...entries: Record<string, unknown>[]) => ({ schemaVersion: 1, entries });

function parsed(...entries: Record<string, unknown>[]): Registry {
  const r = parseRegistry(wrap(...entries));
  if (!r.ok) throw new Error(`expected a parse, got: ${r.error}`);
  return r.registry;
}

describe('parseRegistry', () => {
  it('accepts a well-formed catalog', () => {
    const r = parseRegistry(wrap(entry()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.registry.entries).toHaveLength(1);
  });

  it('refuses a schemaVersion it does not know, naming it', () => {
    const r = parseRegistry({ schemaVersion: 2, entries: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('2');
  });

  it.each([
    ['an unknown kind', { kind: 'texturepack' }],
    ['an unknown format', { format: 'forge' }],
    ['a missing id', { id: '' }],
    ['a missing name', { name: '' }],
    ['tags that are not strings', { tags: [1, 2] }],
    ['a source that is not an object', { source: 'https://x.example/m.json' }],
    ['a source with no url', { source: { type: 'mod-json' } }],
    ['an unknown source type', { source: { type: 'zip', url: 'https://x.example/m.zip' } }],
    ['a non-boolean touchesPhysics', { safety: { touchesPhysics: 'yes', leaderboardRisk: 'none' } }],
    ['an unknown leaderboardRisk', { safety: { touchesPhysics: false, leaderboardRisk: 'maybe' } }],
  ])('drops a row with %s rather than defaulting it', (_label, over) => {
    expect(parsed(entry(over as Partial<RegistryEntry>)).entries).toHaveLength(0);
  });

  it('keeps the good rows when one is malformed', () => {
    const r = parsed(entry({ id: 'good' }), entry({ id: 'bad', kind: 'nonsense' } as never));
    expect(r.entries.map((e) => e.id)).toEqual(['good']);
  });

  it('keeps only the first of a duplicated id, so detail routes stay deterministic', () => {
    const r = parsed(entry({ id: 'dupe', name: 'First' }), entry({ id: 'dupe', name: 'Second' }));
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.name).toBe('First');
  });

  it('defaults an absent dependencies array rather than dropping the row', () => {
    const e = entry();
    delete e.dependencies;
    expect(parsed(e).entries[0]?.dependencies).toEqual([]);
  });
});

describe('author-supplied URL sanitizing', () => {
  it('strips a javascript: homepage instead of rendering it as an href', () => {
    // eslint-disable-next-line no-script-url -- the string under test
    expect(registryHttpUrl('javascript:alert(1)')).toBeNull();
    expect(parsed(entry({ homepage: 'javascript:alert(1)' as string })).entries[0]?.homepage).toBeUndefined();
  });

  it('refuses kodub hosts, which the service worker would route into the game proxy', () => {
    expect(registryHttpUrl('https://app-polytrack.kodub.com/icon.png')).toBeNull();
  });

  it('keeps http(s) links', () => {
    expect(registryHttpUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(registryHttpUrl('http://example.com/x')).toBe('http://example.com/x');
  });

  it('allows data:image icons but not other data: payloads', () => {
    expect(registryIcon('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(registryIcon('data:text/html,<script>')).toBeNull();
  });

  it('drops a non-string icon without dropping the entry', () => {
    const r = parsed(entry({ icon: 42 as never }));
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.icon).toBeUndefined();
  });
});

describe('resolveSourceUrl', () => {
  it('resolves a relative source against the serving origin, not a baked-in host', () => {
    const e = parsed(entry({ source: { type: 'mod-json', url: '/sample-mod/mod.json' } }))
      .entries[0] as RegistryEntry;
    expect(resolveSourceUrl(e, 'http://localhost:3000')).toBe('http://localhost:3000/sample-mod/mod.json');
    expect(resolveSourceUrl(e, ORIGIN)).toBe(`${ORIGIN}/sample-mod/mod.json`);
  });

  it('leaves an absolute source alone', () => {
    const e = parsed(entry()).entries[0] as RegistryEntry;
    expect(resolveSourceUrl(e, ORIGIN)).toBe('https://cdn.example/a/mod.json');
  });
});

describe('installBlockedReason', () => {
  it('allows a tspml entry with an importable URL', () => {
    const e = parsed(entry()).entries[0] as RegistryEntry;
    expect(installBlockedReason(e, ORIGIN)).toBeNull();
    expect(isInstallable(e, ORIGIN)).toBe(true);
  });

  it('allows a pml entry — format is no longer a reason to refuse', () => {
    // PML entries install through the compatibility adapter. What they cost is
    // said by `installCaveat`, not by blocking the button: a refusal would be
    // the wrong answer now that the mod runs.
    const e = parsed(entry({ format: 'pml' })).entries[0] as RegistryEntry;
    expect(installBlockedReason(e, ORIGIN)).toBeNull();
    expect(isInstallable(e, ORIGIN)).toBe(true);
  });

  it('applies checkImportUrl to curated entries — a curated file is not a trust upgrade', () => {
    const e = parsed(entry({ source: { type: 'mod-json', url: 'http://cdn.example/a/mod.json' } }))
      .entries[0] as RegistryEntry;
    expect(installBlockedReason(e, ORIGIN)).toContain('https://');
  });

  it('refuses a kodub source URL', () => {
    const e = parsed(entry({ source: { type: 'mod-json', url: 'https://kodub.com/m.json' } }))
      .entries[0] as RegistryEntry;
    expect(installBlockedReason(e, ORIGIN)).toContain('kodub.com');
  });

  it('still refuses a pml entry whose URL fails the host rules', () => {
    // The two checks are independent, and the format one passing must not
    // shortcut the URL one — the curated file gets no exemption either way.
    const e = parsed(entry({ format: 'pml', source: { type: 'mod-json', url: 'https://kodub.com/m.json' } }))
      .entries[0] as RegistryEntry;
    expect(installBlockedReason(e, ORIGIN)).toContain('kodub.com');
  });
});

describe('installCaveat', () => {
  it('says what a PML install costs, next to a button that still works', () => {
    // The advisory a blocked entry used to carry. It has to explain itself for
    // the same reason the refusal did — "half of this mod's patching will be
    // refused" is a fact about what you are getting, and a player who reads it
    // only after installing has already been misled about what they installed.
    const e = parsed(entry({ format: 'pml' })).entries[0] as RegistryEntry;
    const caveat = installCaveat(e);
    expect(caveat).toContain('PML');
    expect(caveat).toContain('symbol map');
    expect(caveat).toContain('mixins');
  });

  it('has nothing to say about a tspml entry', () => {
    expect(installCaveat(parsed(entry()).entries[0] as RegistryEntry)).toBeNull();
  });
});

describe('resolveDependencies', () => {
  it('resolves ids through the registry', () => {
    const r = parsed(entry({ id: 'main', dependencies: ['lib'] }), entry({ id: 'lib' }));
    const main = getRegistryEntry(r, 'main') as RegistryEntry;
    const out = resolveDependencies(r, main);
    expect(out.resolved.map((e) => e.id)).toEqual(['lib']);
    expect(out.missing).toEqual([]);
  });

  it('reports an unlisted dependency by id rather than skipping it', () => {
    const r = parsed(entry({ id: 'main', dependencies: ['nope'] }));
    const main = getRegistryEntry(r, 'main') as RegistryEntry;
    expect(resolveDependencies(r, main).missing).toEqual(['nope']);
  });
});

describe('searchRegistry', () => {
  const r = parsed(
    entry({ id: 'hud', name: 'Speedometer', author: 'ada', summary: 'shows speed', tags: ['hud'] }),
    entry({ id: 'phys', name: 'Grip tweak', author: 'bo', summary: 'more grip', tags: ['physics'] }),
  );

  it('returns everything for an empty query', () => {
    expect(searchRegistry(r.entries, '', null)).toHaveLength(2);
  });

  it('matches name, author, summary, tag, and id case-insensitively', () => {
    expect(searchRegistry(r.entries, 'SPEEDO', null).map((e) => e.id)).toEqual(['hud']);
    expect(searchRegistry(r.entries, 'bo', null).map((e) => e.id)).toEqual(['phys']);
    expect(searchRegistry(r.entries, 'grip', null).map((e) => e.id)).toEqual(['phys']);
    expect(searchRegistry(r.entries, 'physics', null).map((e) => e.id)).toEqual(['phys']);
  });

  it('requires every term to match', () => {
    expect(searchRegistry(r.entries, 'speed ada', null)).toHaveLength(1);
    expect(searchRegistry(r.entries, 'speed bo', null)).toHaveLength(0);
  });

  it('filters by tag, and combines the tag with the query', () => {
    expect(searchRegistry(r.entries, '', 'hud').map((e) => e.id)).toEqual(['hud']);
    expect(searchRegistry(r.entries, 'grip', 'hud')).toHaveLength(0);
  });

  it('collects tags deduped and sorted', () => {
    expect(registryTags(r.entries)).toEqual(['hud', 'physics']);
  });
});

describe('listRegistry', () => {
  const ok = (body: string): typeof fetch =>
    (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

  it('parses a served catalog', async () => {
    const r = await listRegistry(ok(JSON.stringify(wrap(entry()))));
    expect(r.ok).toBe(true);
  });

  it('reports a non-OK response with its status rather than throwing', async () => {
    const r = await listRegistry((async () => new Response('', { status: 404 })) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('404');
  });

  it('reports invalid JSON as invalid JSON', async () => {
    const r = await listRegistry(ok('{oh no'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('JSON');
  });

  it('reports a network failure without throwing', async () => {
    const r = await listRegistry((() => Promise.reject(new Error('offline'))) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
  });

  it('refuses a catalog past the size cap', async () => {
    const r = await listRegistry(ok(' '.repeat(512_001)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('larger');
  });
});

describe('the committed public/registry/index.json', () => {
  const raw = readFileSync(join(__dirname, '..', 'public', 'registry', 'index.json'), 'utf8');
  const json: unknown = JSON.parse(raw);
  const result = parseRegistry(json);

  it('parses', () => {
    expect(result.ok).toBe(true);
  });

  it('drops no rows — every committed entry is well-formed', () => {
    // The load-bearing assertion. parseRegistry drops malformed rows silently
    // by design (a bad row must not break the page for everyone), so a count
    // comparison is the only thing that turns a typo into a failed build.
    const declared = (json as { entries: unknown[] }).entries.length;
    expect(result.ok && result.registry.entries.length).toBe(declared);
  });

  it('has a supported format on every entry, so nothing ships unusable', () => {
    if (!result.ok) throw new Error('did not parse');
    for (const e of result.registry.entries) {
      expect(installBlockedReason(e, ORIGIN)).toBeNull();
    }
  });

  it('has unique ids', () => {
    const ids = (json as { entries: { id: string }[] }).entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points modpack entries at a .txt and mod entries at a mod.json', () => {
    if (!result.ok) throw new Error('did not parse');
    for (const e of result.registry.entries) {
      expect(e.source.type).toBe(e.kind === 'modpack' ? 'modpack-txt' : 'mod-json');
    }
  });
});
