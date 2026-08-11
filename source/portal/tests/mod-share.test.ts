// Unit tests for lib/mod-share.ts — shareable mod-set links. The invariant
// under test everywhere: a share link carries LINKS ONLY (never code), and a
// parsed link is untrusted input re-checked against the import URL rules.
import { describe, expect, it } from 'vitest';
import { buildShareUrl, parseShareUrls, SHARE_LIMITS, SHARE_PARAM } from '../lib/mod-share.js';
import type { UserModRecord } from '../lib/user-mods.js';

function record(id: string, overrides: Partial<UserModRecord> = {}): UserModRecord {
  return {
    manifest: { schemaVersion: 1, id, version: '1.0.0', entrypoint: 'index.js', targets: [] },
    code: 'export default () => {};',
    enabled: true,
    addedAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

const BASE = 'https://tspml.vercel.app/';

describe('buildShareUrl', () => {
  it('carries one mods= param per enabled URL-imported mod, in order', () => {
    const r = buildShareUrl(
      [
        record('a', { sourceUrl: 'https://host.example/a/mod.json' }),
        record('b', { sourceUrl: 'https://host.example/b.js' }),
      ],
      BASE,
    );
    expect(r.included).toEqual(['a', 'b']);
    expect(r.noSource).toEqual([]);
    const params = new URL(r.url!).searchParams.getAll(SHARE_PARAM);
    expect(params).toEqual(['https://host.example/a/mod.json', 'https://host.example/b.js']);
  });

  it('skips disabled mods and NAMES pasted mods it cannot carry', () => {
    const r = buildShareUrl(
      [
        record('pasted'),
        record('off', { sourceUrl: 'https://host.example/off.json', enabled: false }),
        record('on', { sourceUrl: 'https://host.example/on.json' }),
      ],
      BASE,
    );
    expect(r.included).toEqual(['on']);
    expect(r.noSource).toEqual(['pasted']); // disabled mods are neither carried nor warned about
    expect(new URL(r.url!).searchParams.getAll(SHARE_PARAM)).toHaveLength(1);
  });

  it('returns url null when nothing qualifies', () => {
    const r = buildShareUrl([record('pasted-only')], BASE);
    expect(r.url).toBeNull();
    expect(r.noSource).toEqual(['pasted-only']);
  });

  it('strips unrelated query params and any stale mods= from the base', () => {
    const r = buildShareUrl(
      [record('a', { sourceUrl: 'https://host.example/a.json' })],
      `${BASE}?mods=https%3A%2F%2Fstale.example%2Fx.js&utm_source=x#frag`,
    );
    const u = new URL(r.url!);
    expect(u.searchParams.getAll(SHARE_PARAM)).toEqual(['https://host.example/a.json']);
    expect(u.searchParams.has('utm_source')).toBe(false);
    expect(u.hash).toBe('');
  });

  it('caps the number of carried links', () => {
    const mods = Array.from({ length: SHARE_LIMITS.maxMods + 3 }, (_, i) =>
      record(`m${i}`, { sourceUrl: `https://host.example/${i}.json` }),
    );
    const r = buildShareUrl(mods, BASE);
    expect(r.included).toHaveLength(SHARE_LIMITS.maxMods);
    expect(new URL(r.url!).searchParams.getAll(SHARE_PARAM)).toHaveLength(SHARE_LIMITS.maxMods);
  });
});

describe('parseShareUrls', () => {
  const q = (...urls: string[]): string =>
    '?' + urls.map((u) => `${SHARE_PARAM}=${encodeURIComponent(u)}`).join('&');

  it('returns the deduped links in order', () => {
    const r = parseShareUrls(
      q('https://host.example/a.json', 'https://host.example/b.js', 'https://host.example/a.json'),
    );
    expect(r.urls).toEqual(['https://host.example/a.json', 'https://host.example/b.js']);
    expect(r.invalid).toEqual([]);
    expect(r.dropped).toBe(0);
  });

  it('refuses links the import rules refuse (kodub, plain http), keeping the rest', () => {
    const r = parseShareUrls(
      q('https://app-polytrack.kodub.com/x.js', 'http://insecure.example/m.js', 'https://ok.example/m.js'),
    );
    expect(r.urls).toEqual(['https://ok.example/m.js']);
    expect(r.invalid).toHaveLength(2);
    expect(r.invalid[0]!.url).toContain('kodub');
  });

  it('drops (and counts) links past the cap', () => {
    const urls = Array.from({ length: SHARE_LIMITS.maxMods + 2 }, (_, i) => `https://host.example/${i}.js`);
    const r = parseShareUrls(q(...urls));
    expect(r.urls).toHaveLength(SHARE_LIMITS.maxMods);
    expect(r.dropped).toBe(2);
  });

  it('an unrelated or empty query string parses to nothing', () => {
    expect(parseShareUrls('').urls).toEqual([]);
    expect(parseShareUrls('?utm_source=x').urls).toEqual([]);
    expect(parseShareUrls(`?${SHARE_PARAM}=`).urls).toEqual([]);
  });
});
