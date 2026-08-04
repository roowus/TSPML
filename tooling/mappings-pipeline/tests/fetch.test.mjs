// Unit tests for src/fetch.mjs — version validation (the path-traversal guard) and
// chunk discovery (#3). The network path (fetchBundle/fetchVersion) is local-only and
// not exercised here; chunk *discovery* is pure string work, so it is.
import { describe, expect, it } from 'vitest';
import { assertVersion, chunkBundle, parseChunkIds } from '../src/fetch.mjs';

describe('assertVersion', () => {
  it('accepts a valid x.y.z version', () => {
    expect(assertVersion('0.6.2')).toBe('0.6.2');
    expect(assertVersion('1.2.3')).toBe('1.2.3');
  });

  it('rejects a traversal-laden version (would escape .cache/)', () => {
    expect(() => assertVersion('0.6.2/../../evil')).toThrow(/invalid version/);
    expect(() => assertVersion('../x')).toThrow(/invalid version/);
  });

  it('rejects non-numeric / malformed versions', () => {
    expect(() => assertVersion('latest')).toThrow(/invalid version/);
    expect(() => assertVersion('0.6')).toThrow(/invalid version/);
    expect(() => assertVersion('')).toThrow(/invalid version/);
    expect(() => assertVersion('0.6.2.4')).toThrow(/invalid version/);
  });
});

describe('parseChunkIds (#3)', () => {
  // Shaped like the real 0.6.2 runtime: `i.u = e => e + ".bundle.js"` plus `i.e(N)`
  // call sites. Verified against the live bundle, which yields exactly 112/535/604/657.
  const runtime = 'i.u=e=>e+".bundle.js",i.e(604).then(x),Promise.all([i.e(112),i.e(535)]),i.e(657)';

  it('reads chunk ids out of the webpack runtime, sorted and deduped', () => {
    expect(parseChunkIds(runtime)).toEqual(['112', '535', '604', '657']);
    expect(parseChunkIds('i.e(9),i.e(9),i.e(10)')).toEqual(['9', '10']); // numeric, not lexical
  });

  it('returns nothing for a build with no split chunks', () => {
    // True of 0.6.0: a single bundle, no `i.e()` anywhere. Must be empty, not a throw —
    // `--chunks` on an unchunked release is a legitimate no-op.
    expect(parseChunkIds('const a=1;function e(){}')).toEqual([]);
  });

  it('does not invent ids the runtime never references', () => {
    // The reason discovery beats probing. `0.6.2/57.bundle.js` returns HTTP 200 with
    // real code — a leftover from an earlier build that 0.6.2 never loads. A probe
    // loop banks it; reading the runtime does not.
    expect(parseChunkIds(runtime)).not.toContain('57');
  });
});

describe('chunkBundle (#3)', () => {
  it('builds the CDN path and a distinct cache name', () => {
    const b = chunkBundle('112');
    expect(b.file).toBe('112.bundle.js');
    expect(b.cacheName('0.6.2')).toBe('pt-0.6.2-raw-chunk-112.js');
    // Must not collide with main/simworker, or a chunk would overwrite the bundle
    // gen-map matches against.
    expect(b.cacheName('0.6.2')).not.toBe('pt-0.6.2-raw-main.js');
  });

  it('refuses a non-numeric id', () => {
    // Same posture as assertVersion: the id lands in both a URL and a cache filename,
    // so `../../evil` would escape the gitignored .cache/ and could write the
    // proprietary bundle into a committed path.
    expect(() => chunkBundle('../../evil')).toThrow(/invalid chunk id/);
    expect(() => chunkBundle('12a')).toThrow(/invalid chunk id/);
    expect(() => chunkBundle('')).toThrow(/invalid chunk id/);
  });
});
