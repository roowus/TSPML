// Unit tests for lib/modpack.ts — modpacks as a plain-text list of mod URLs
// (#80). The invariants under test: a list carries LINKS ONLY and every line is
// re-checked against the import URL rules; one bad line never takes the pack
// down; and the pasted-vs-linked dispatch is the predictable extension rule,
// not a heuristic.
import { describe, expect, it, vi } from 'vitest';
import {
  classifyModpackInput,
  fetchModpackList,
  MODPACK_LIMITS,
  parseModpackList,
} from '../lib/modpack.js';

const LIST_URL = 'https://host.example/packs/starter.txt';

describe('parseModpackList', () => {
  it('reads one URL per line, in order', () => {
    const r = parseModpackList(
      ['https://host.example/a/mod.json', 'https://host.example/b.js'].join('\n'),
    );
    expect(r.urls).toEqual(['https://host.example/a/mod.json', 'https://host.example/b.js']);
    expect(r.invalid).toEqual([]);
    expect(r.dropped).toBe(0);
  });

  it('ignores blank lines, comment lines and surrounding whitespace', () => {
    const r = parseModpackList(
      [
        '# my starter pack',
        '',
        '   https://host.example/a/mod.json   ',
        '',
        '#https://host.example/disabled.js',
        'https://host.example/b.js',
        '',
      ].join('\r\n'),
    );
    expect(r.urls).toEqual(['https://host.example/a/mod.json', 'https://host.example/b.js']);
  });

  it('keeps a # fragment inside a URL (it is not a trailing comment)', () => {
    // Stripping from the first '#' would silently rewrite the link, and the
    // import would then fetch a different file than the pack named.
    const r = parseModpackList('https://host.example/a/mod.json#pinned');
    expect(r.urls).toEqual(['https://host.example/a/mod.json#pinned']);
  });

  it('reports a bad line by NUMBER and keeps every good line', () => {
    // #80: fail per mod, not per pack.
    const r = parseModpackList(
      [
        'https://host.example/a/mod.json',
        'not a url at all',
        'https://vps.kodub.com/evil.js',
        'https://host.example/b.js',
      ].join('\n'),
    );
    expect(r.urls).toEqual(['https://host.example/a/mod.json', 'https://host.example/b.js']);
    expect(r.invalid.map((i) => i.line)).toEqual([2, 3]);
    expect(r.invalid[0]!.text).toBe('not a url at all');
    expect(r.invalid[1]!.error).toMatch(/kodub/i);
  });

  it('refuses http:// and other non-https schemes, via the import rules', () => {
    const r = parseModpackList(
      ['http://host.example/a.js', 'javascript:alert(1)', 'file:///etc/passwd'].join('\n'),
    );
    expect(r.urls).toEqual([]);
    expect(r.invalid).toHaveLength(3);
  });

  it('refuses a line pointing at another .txt list', () => {
    // Nesting can loop, can fan out past every cap, and makes "what will this
    // install?" unanswerable from the list in front of the user.
    const r = parseModpackList(
      ['https://host.example/a/mod.json', 'https://host.example/packs/other.txt'].join('\n'),
    );
    expect(r.urls).toEqual(['https://host.example/a/mod.json']);
    expect(r.invalid[0]!.error).toMatch(/does not include other modpacks/i);
  });

  it('dedupes repeated URLs', () => {
    const r = parseModpackList(
      ['https://host.example/a.js', 'https://host.example/a.js'].join('\n'),
    );
    expect(r.urls).toEqual(['https://host.example/a.js']);
    expect(r.dropped).toBe(0);
  });

  it('caps at maxMods and reports how many were dropped', () => {
    const many = Array.from(
      { length: MODPACK_LIMITS.maxMods + 3 },
      (_, i) => `https://host.example/m${i}.js`,
    );
    const r = parseModpackList(many.join('\n'));
    expect(r.urls).toHaveLength(MODPACK_LIMITS.maxMods);
    expect(r.dropped).toBe(3);
    expect(r.urls[0]).toBe('https://host.example/m0.js');
  });

  it('refuses a list with absurdly many lines unread', () => {
    const r = parseModpackList(
      Array.from({ length: MODPACK_LIMITS.maxLines + 1 }, (_, i) => `https://h.example/m${i}.js`).join('\n'),
    );
    expect(r.urls).toEqual([]);
    expect(r.invalid[0]!.error).toMatch(/the limit is/);
  });

  describe('with a base (a FETCHED list)', () => {
    it('resolves relative lines against the list URL', () => {
      const r = parseModpackList(['mods/turbo/mod.json', './solo.js'].join('\n'), LIST_URL);
      expect(r.urls).toEqual([
        'https://host.example/packs/mods/turbo/mod.json',
        'https://host.example/packs/solo.js',
      ]);
    });

    it('re-checks a RESOLVED line against the host rules', () => {
      // A relative line cannot reach kodub, but an absolute one in a fetched
      // list can — resolution must not be a way around checkImportUrl.
      const r = parseModpackList('https://app-polytrack.kodub.com/x.js', LIST_URL);
      expect(r.urls).toEqual([]);
      expect(r.invalid[0]!.error).toMatch(/kodub/i);
    });

    it('dedupes a mod written both relatively and absolutely', () => {
      const r = parseModpackList(
        ['solo.js', 'https://host.example/packs/solo.js'].join('\n'),
        LIST_URL,
      );
      expect(r.urls).toEqual(['https://host.example/packs/solo.js']);
    });
  });

  it('without a base, a relative line is refused rather than guessed at', () => {
    // A pasted list has nothing to resolve against; inventing the portal's own
    // origin would point every relative line at a host that serves no mods.
    const r = parseModpackList('mods/turbo/mod.json');
    expect(r.urls).toEqual([]);
    expect(r.invalid[0]!.error).toMatch(/absolute URL/i);
  });
});

describe('classifyModpackInput', () => {
  it('treats a lone .txt URL as a link TO a list', () => {
    const r = classifyModpackInput(`  ${LIST_URL}  `);
    expect(r).toEqual({ kind: 'list', url: LIST_URL });
  });

  it('treats a lone mod URL as a one-line inline list', () => {
    const r = classifyModpackInput('https://host.example/a/mod.json');
    expect(r.kind).toBe('inline');
    if (r.kind !== 'inline') throw new Error('unreachable');
    expect(r.parsed.urls).toEqual(['https://host.example/a/mod.json']);
  });

  it('treats several lines as inline even when one is a .txt', () => {
    // Only a LONE .txt line is a link to a list; among others it is a nested
    // pack, which parseModpackList refuses by line.
    const r = classifyModpackInput(['https://host.example/a.js', LIST_URL].join('\n'));
    expect(r.kind).toBe('inline');
    if (r.kind !== 'inline') throw new Error('unreachable');
    expect(r.parsed.urls).toEqual(['https://host.example/a.js']);
    expect(r.parsed.invalid).toHaveLength(1);
  });

  it('ignores comments when deciding (a commented list URL is still one line)', () => {
    const r = classifyModpackInput(['# starter pack', '', LIST_URL].join('\n'));
    expect(r).toEqual({ kind: 'list', url: LIST_URL });
  });
});

describe('fetchModpackList', () => {
  function fakeFetch(body: string, init: { status?: number } = {}) {
    // Params are declared though unused: a zero-arg `vi.fn` types `mock.calls`
    // as `[]`, and the tests below assert on the URL it was CALLED with.
    return vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(body, { status: init.status ?? 200, headers: { 'content-type': 'text/plain' } }),
    );
  }

  it('fetches, parses, and resolves lines against the list URL', async () => {
    const f = fakeFetch(['# pack', 'mods/a/mod.json', 'https://host.example/b.js'].join('\n'));
    const r = await fetchModpackList(LIST_URL, f);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.source).toBe(LIST_URL);
    expect(r.parsed.urls).toEqual([
      'https://host.example/packs/mods/a/mod.json',
      'https://host.example/b.js',
    ]);
  });

  it('resolves relative lines against the POST-REDIRECT URL', async () => {
    // github.com/u/r/raw/main/pack.txt redirects to raw.githubusercontent.com.
    // Resolving `mod.json` against the URL that was asked for would point it
    // at a host that never served the list.
    const f = vi.fn(async () => {
      const res = new Response('mods/a/mod.json', { status: 200 });
      Object.defineProperty(res, 'url', { value: 'https://cdn.example/u/r/pack.txt' });
      return res;
    });
    const r = await fetchModpackList(LIST_URL, f);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.source).toBe('https://cdn.example/u/r/pack.txt');
    expect(r.parsed.urls).toEqual(['https://cdn.example/u/r/mods/a/mod.json']);
  });

  it('a redirect is not a way past the host rules', async () => {
    // The base decides where relative lines POINT, never what is allowed:
    // every resolved line still goes through checkImportUrl.
    const f = vi.fn(async () => {
      const res = new Response('x.js', { status: 200 });
      Object.defineProperty(res, 'url', { value: 'https://app-polytrack.kodub.com/pack.txt' });
      return res;
    });
    const r = await fetchModpackList(LIST_URL, f);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.parsed.urls).toEqual([]);
    expect(r.parsed.invalid[0]!.error).toMatch(/kodub/i);
  });

  it('never fetches through /api/proxy — it calls the URL directly', async () => {
    // The #80 invariant: the browser fetches, the server never becomes a
    // fetcher of arbitrary user-pointed URLs.
    const f = fakeFetch('https://host.example/a.js');
    await fetchModpackList(LIST_URL, f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![0]).toBe(LIST_URL);
  });

  it('refuses a list URL the import rules reject, without fetching', async () => {
    const f = fakeFetch('anything');
    const r = await fetchModpackList('https://kodub.com/pack.txt', f);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toMatch(/kodub/i);
    expect(f).not.toHaveBeenCalled();
  });

  it('reports an HTTP failure with the status and host', async () => {
    const r = await fetchModpackList(LIST_URL, fakeFetch('nope', { status: 404 }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toMatch(/HTTP 404/);
    expect(r.error).toMatch(/host\.example/);
  });

  it('reports a CORS/network failure with the advice that fixes it', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await fetchModpackList(LIST_URL, f);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toMatch(/CORS/);
  });

  it('refuses an oversized body', async () => {
    const r = await fetchModpackList(LIST_URL, fakeFetch('x'.repeat(MODPACK_LIMITS.maxListChars + 1)));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toMatch(/the limit is/);
  });
});
