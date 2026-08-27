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
import { DEFAULT_GAME_VERSION } from '../lib/game-versions';
import {
  buildsForGameVersion,
  entryTags,
  gameVersionNote,
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

  it('accepts a mod-root source, which is how PML addresses every one of its mods', () => {
    // Not a cosmetic third enum value: PML's whole registry is directory URLs
    // with no trailing slash, and a row that had to call itself a `mod-json` to
    // be accepted would be lying in our own catalog about what lives there.
    const r = parsed(
      entry({ format: 'pml', source: { type: 'mod-root', url: 'https://cdn.example/gh/o/r/main/m' } }),
    );
    expect(r.entries[0]?.source.type).toBe('mod-root');
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

describe('buildsForGameVersion', () => {
  const at = (versions: string[], v = '0.6.2'): boolean =>
    buildsForGameVersion(parsed(entry({ gameVersions: versions })).entries[0] as RegistryEntry, v);

  it('matches an exact version in the list, which is how PML publishes', () => {
    expect(at(['0.6.0', '0.6.2'])).toBe(true);
    expect(at(['0.5.0', '0.5.1', '0.5.2'])).toBe(false);
  });

  it('honours a semver RANGE, which a naive includes() would call unsupported', () => {
    // The regression this function exists for. poly-to-track ships the range
    // form, covers 0.6.2 by syntax rather than by listing it, and a substring
    // check would have put a false "no build" warning on the one native mod in
    // the catalog.
    expect(at(['>=0.6.0 <0.7.0'])).toBe(true);
    expect(at(['>=0.7.0'])).toBe(false);
    expect(at(['^0.5.0'])).toBe(false);
  });

  it('does not let a prerelease target stand in for the release', () => {
    // 0.6.0-beta1 is a real value in the committed file. Semver deliberately
    // excludes prereleases from ranges, and an exact match is the only way it
    // should ever count — for itself, not for 0.6.0 or 0.6.2.
    expect(at(['0.6.0-beta1'])).toBe(false);
    expect(at(['0.6.0-beta1'], '0.6.0-beta1')).toBe(true);
  });

  it('stays quiet on a version string it cannot parse', () => {
    // Not evidence of a missing build — evidence that we cannot tell. Warning
    // here would print "no build for 0.6.2" on a mod that installs fine.
    expect(at(['whatever the author wrote'])).toBe(true);
  });

  it('needs only one of several values to match', () => {
    expect(at(['0.5.0', 'nonsense', '0.6.2'])).toBe(true);
  });
});

describe('gameVersionNote', () => {
  it('names the version, and lists what the mod does offer', () => {
    const e = parsed(entry({ gameVersions: ['0.5.0', '0.5.2'] })).entries[0] as RegistryEntry;
    const note = gameVersionNote(e, DEFAULT_GAME_VERSION);
    expect(note).toContain(DEFAULT_GAME_VERSION);
    expect(note).toContain('0.5.0, 0.5.2');
  });

  it('is silent when there is a build, rather than saying so', () => {
    const e = parsed(entry({ gameVersions: ['0.6.2'] })).entries[0] as RegistryEntry;
    expect(gameVersionNote(e, DEFAULT_GAME_VERSION)).toBeNull();
  });

  it('never blocks the install — the mod index is the authority', () => {
    // Advisory and gate are deliberately separate. The catalog copies what an
    // index said at curation time; the install reads that index live, and if
    // the author has since published a build the install should succeed while
    // this warning is merely stale.
    const e = parsed(entry({ gameVersions: ['0.5.0'] })).entries[0] as RegistryEntry;
    expect(gameVersionNote(e, DEFAULT_GAME_VERSION)).not.toBeNull();
    expect(installBlockedReason(e, ORIGIN)).toBeNull();
    expect(isInstallable(e, ORIGIN)).toBe(true);
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

describe('entryTags', () => {
  it('leads with the loader format, then the content tags', () => {
    const e = parsed(entry({ format: 'pml', tags: ['ui', 'car'] })).entries[0] as RegistryEntry;
    expect(entryTags(e)).toEqual(['pml', 'ui', 'car']);
  });

  it('derives the format tag rather than trusting a hand-written one', () => {
    // The point of deriving: `format` is what `useInstall` passes to the
    // importer, so a row whose `tags` disagreed with it would render a chip
    // that contradicts the code path that actually runs.
    const e = parsed(entry({ format: 'tspml', tags: ['pml'] })).entries[0] as RegistryEntry;
    expect(entryTags(e)).toEqual(['tspml', 'pml']);
  });

  it('renders one chip when a row also hand-wrote its own format', () => {
    // Duplicate keys in the chip loop would be a React warning at best and a
    // dropped chip at worst. The derived copy is the authoritative one.
    const e = parsed(entry({ format: 'pml', tags: ['pml', 'ui'] })).entries[0] as RegistryEntry;
    expect(entryTags(e)).toEqual(['pml', 'ui']);
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

  it('filters by loader format exactly, because that chip is a real filter', () => {
    // The chip row renders `pml` and `tspml`; selecting one has to narrow to
    // exactly that set, or the chip is a control in appearance and decoration
    // in behaviour. Tag filtering is an equality test on entryTags, so it is.
    const mixed = parsed(entry({ id: 'native' }), entry({ id: 'adapted', format: 'pml' }));
    expect(searchRegistry(mixed.entries, '', 'pml').map((e) => e.id)).toEqual(['adapted']);
    expect(searchRegistry(mixed.entries, '', 'tspml').map((e) => e.id)).toEqual(['native']);
  });

  it('matches the format tag as a substring in free text, "pml" included', () => {
    // Typing "pml" also matches `tspml`, and that is the documented behaviour
    // of every term here rather than a format-specific quirk: substring, no
    // ranking. Asserted so the looseness is a decision on record and not a
    // surprise the day someone wonders why both cards came back.
    const mixed = parsed(entry({ id: 'native' }), entry({ id: 'adapted', format: 'pml' }));
    expect(searchRegistry(mixed.entries, 'pml', null).map((e) => e.id)).toEqual(['native', 'adapted']);
    expect(searchRegistry(mixed.entries, 'tspml', null).map((e) => e.id)).toEqual(['native']);
  });

  it('collects tags deduped and sorted, formats first', () => {
    // Formats lead so `pml` and `tspml` sit together at the head of the filter
    // row rather than being scattered alphabetically among the content tags.
    expect(registryTags(r.entries)).toEqual(['tspml', 'hud', 'physics']);
    const mixed = parsed(entry({ tags: ['ui'] }), entry({ id: 'b', format: 'pml', tags: ['car'] }));
    expect(registryTags(mixed.entries)).toEqual(['pml', 'tspml', 'car', 'ui']);
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

  it('points modpack entries at a .txt, and mod entries at a manifest or a root', () => {
    // Mods are addressed two ways and both are legitimate: a `mod.json` URL, or
    // a directory the format's own walk descends. PML uses the latter for every
    // mod it publishes. Modpacks stay a single shape — a list file is a list
    // file, and there is no directory form of one to allow.
    if (!result.ok) throw new Error('did not parse');
    for (const e of result.registry.entries) {
      if (e.kind === 'modpack') expect(e.source.type).toBe('modpack-txt');
      else expect(['mod-json', 'mod-root']).toContain(e.source.type);
    }
  });

  it('never hand-writes a loader format into a row\'s content tags', () => {
    // entryTags dedupes, so a stray one would not render twice — it would just
    // sit in the file as a second, unenforced copy of `format`, waiting to
    // disagree with it. Catching it here keeps `format` the single source.
    if (!result.ok) throw new Error('did not parse');
    for (const e of result.registry.entries) {
      expect(e.tags).not.toContain('pml');
      expect(e.tags).not.toContain('tspml');
    }
  });

  it('never hand-writes the no-build warning into a summary', () => {
    // Same rule as the format tag, for the other derivable claim in this file.
    // These rows USED to carry the fact as prose, in two different phrasings
    // ("NO BUILD FOR THIS GAME VERSION" and "its newest build targets X, not
    // Y") — a second copy of `gameVersions` that could disagree with it the
    // moment either was edited, and did not even agree with itself on wording.
    // gameVersionNote derives it now; a row restating it would be that copy
    // coming back.
    if (!result.ok) throw new Error('did not parse');
    for (const e of result.registry.entries) {
      expect(e.summary).not.toMatch(/no build for/i);
      expect(e.summary).not.toMatch(/not 0\.\d/);
      expect(e.summary).not.toMatch(/newest build targets/i);
    }
  });

  it('warns on exactly the entries whose index lacks a build for the played version', () => {
    // The count is asserted rather than just the predicate because the whole
    // point of deriving is that this number tracks the file. Thirteen of the
    // twenty-one rows stop before 0.6.2; poly-to-track's RANGE covers it and
    // must not be miscounted among them.
    if (!result.ok) throw new Error('did not parse');
    const warned = result.registry.entries.filter(
      (e) => gameVersionNote(e, DEFAULT_GAME_VERSION) !== null,
    );
    expect(warned.length).toBe(13);
    for (const e of warned) {
      expect(e.gameVersions).not.toContain(DEFAULT_GAME_VERSION);
    }
  });

  it('declares dependencies only on ids the catalog actually lists', () => {
    // A missing dep renders as a named warning rather than breaking the page,
    // which is right for a third-party id — but inside our OWN file it means a
    // typo, and a typo should fail the build instead of shipping the warning.
    if (!result.ok) throw new Error('did not parse');
    for (const e of result.registry.entries) {
      expect(resolveDependencies(result.registry, e).missing).toEqual([]);
    }
  });

  it('gives every entry at least one game version to show', () => {
    // Shown, not parsed — but an empty list renders as an empty fact row, and
    // "we do not know" is not something this catalog is ever entitled to say:
    // the value comes from the mod's own index.
    if (!result.ok) throw new Error('did not parse');
    for (const e of result.registry.entries) {
      expect(e.gameVersions.length).toBeGreaterThan(0);
    }
  });

  it('routes every pml entry through a mod-root, which is how PML publishes', () => {
    if (!result.ok) throw new Error('did not parse');
    const pml = result.registry.entries.filter((e) => e.format === 'pml');
    expect(pml.length).toBeGreaterThan(0);
    for (const e of pml) expect(e.source.type).toBe('mod-root');
  });

  it('lists none of the smoke fixtures, which are not content for players', () => {
    // /sample-mod and friends exist so the Playwright smokes have same-origin
    // URLs that cannot rot with someone else's repo. Advertising demo content
    // in the catalog would be the failure mode this guards.
    if (!result.ok) throw new Error('did not parse');
    for (const e of result.registry.entries) {
      expect(e.source.url).not.toContain('/sample-');
    }
  });
});
