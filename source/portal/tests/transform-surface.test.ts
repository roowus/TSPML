/**
 * lib/transform-surface.ts — which proxied paths may be transformed, and against
 * which pin (#98).
 *
 * This is the gate in front of every byte the proxy rewrites, so the tests are
 * written around the two failure DIRECTIONS rather than around the code:
 *
 *   too permissive — a path becomes a surface it should not be (an undeclared
 *     chunk, a non-default host, a nested path), and the engine runs anchors
 *     against bytes nobody verified;
 *   too strict — a declared chunk stops being a surface, which is SILENT: the
 *     file proxies verbatim, the game works perfectly, and the mixins the author
 *     wrote for it simply never run.
 *
 * Driven with a synthetic map so no assertion depends on the real 0.6.2 pins
 * (those are covered by @tspml/mappings' own literal-pin test).
 */
import { describe, expect, it } from 'vitest';
import type { GameMap } from '@tspml/mappings';
import { BRIDGE_PATCHES, EDITOR_PATCHES } from '@tspml/shared';
import { transformSurfaceFor } from '../lib/transform-surface';

const MAIN_HASH = `sha256:${'a'.repeat(64)}`;
const CHUNK_112_HASH = `sha256:${'b'.repeat(64)}`;
const CHUNK_535_HASH = `sha256:${'c'.repeat(64)}`;

const MAP = {
  formatVersion: 1,
  gameVersion: '0.0.0-test',
  bundleHash: MAIN_HASH,
  generated: { from: 'test', matcher: 'test', granularity: 'test', note: 'test' },
  modules: {},
  unresolved: [],
  targets: {},
  chunks: {
    '112': { id: '112', hash: CHUNK_112_HASH, bytes: 108037, role: 'track editor' },
    '535': { id: '535', hash: CHUNK_535_HASH, bytes: 13182, role: 'track verifier UI' },
  },
} as unknown as GameMap;

/** The same map with no chunks section at all — a pre-#98 map, which must keep
 *  working: main transforms, every chunk proxies verbatim. */
const MAP_NO_CHUNKS = { ...MAP, chunks: undefined } as unknown as GameMap;

const surface = (file: string, host = true): ReturnType<typeof transformSurfaceFor> =>
  transformSurfaceFor(MAP, host, [file]);

describe('transformSurfaceFor — the main bundle', () => {
  it('is a surface gated on the map bundle hash, carrying the bridge patches', () => {
    const s = surface('main.bundle.js');
    expect(s).not.toBeNull();
    expect(s?.kind).toBe('main');
    expect(s?.chunkId).toBeNull();
    expect(s?.file).toBe('main.bundle.js');
    expect(s?.expectedHash).toBe(MAIN_HASH);
    // The loader's bridge patches are what make the main bundle worth transforming;
    // an empty base here would serve the game unhooked while still reporting success.
    expect(s?.basePatches.length).toBeGreaterThan(0);
  });

  it('stays a surface on a map with no chunks section (pre-#98 map)', () => {
    const s = transformSurfaceFor(MAP_NO_CHUNKS, true, ['main.bundle.js']);
    expect(s?.kind).toBe('main');
    expect(s?.expectedHash).toBe(MAIN_HASH);
  });
});

describe('transformSurfaceFor — declared chunks', () => {
  it('resolves a declared chunk against ITS OWN pin, not the main bundle hash', () => {
    const s = surface('112.bundle.js');
    expect(s?.kind).toBe('chunk');
    expect(s?.chunkId).toBe('112');
    expect(s?.file).toBe('112.bundle.js');
    expect(s?.expectedHash).toBe(CHUNK_112_HASH);
    // The whole point of a per-chunk pin: sharing the main hash would gate this
    // chunk on bytes it has nothing to do with.
    expect(s?.expectedHash).not.toBe(MAIN_HASH);
  });

  it('gives each declared chunk its own distinct pin', () => {
    expect(surface('112.bundle.js')?.expectedHash).toBe(CHUNK_112_HASH);
    expect(surface('535.bundle.js')?.expectedHash).toBe(CHUNK_535_HASH);
  });

  it('gives chunk 112 the EDITOR base patches, not the bridge patches (#87 Phase C)', () => {
    const base = surface('112.bundle.js')?.basePatches ?? [];
    expect(base.length).toBeGreaterThan(0);
    expect(base).toEqual(EDITOR_PATCHES);
    // The direction that matters. Feeding the bridge patches here would make every
    // one of them miss, and base patches are all-or-nothing, so the chunk would
    // fail closed to vanilla for a reason that is not drift.
    expect(base).not.toEqual(BRIDGE_PATCHES);
    for (const p of base) {
      expect(BRIDGE_PATCHES).not.toContain(p);
    }
  });

  it('gives every OTHER declared chunk an empty base — a live path, not a no-op', () => {
    // 535 has no loader-owned patches, and user mixins still compose against it.
    // This is also the branch whose detail string shipped a bodyless 500 (#106),
    // so it stays asserted rather than assumed gone.
    expect(surface('535.bundle.js')?.basePatches).toEqual([]);
  });

  it('never hands one chunk another chunk’s base patches', () => {
    // The editor patches anchor in module 7112 of chunk 112 and nowhere else. If
    // the lookup ever keyed on `kind` instead of the chunk id, 535 would inherit
    // them and fail closed.
    const editorBase = surface('112.bundle.js')?.basePatches ?? [];
    const otherBase = surface('535.bundle.js')?.basePatches ?? [];
    expect(editorBase).not.toEqual(otherBase);
  });
});

describe('transformSurfaceFor — what must NOT become a surface', () => {
  it('refuses a chunk the map does not declare', () => {
    // Routine, not an error: TSPML has verified no anchors against it.
    expect(surface('999.bundle.js')).toBeNull();
  });

  it('refuses EVERY chunk when the map declares no chunks section', () => {
    expect(transformSurfaceFor(MAP_NO_CHUNKS, true, ['112.bundle.js'])).toBeNull();
  });

  it('refuses a non-default host — no pin in this map applies to it', () => {
    expect(surface('main.bundle.js', false)).toBeNull();
    expect(surface('112.bundle.js', false)).toBeNull();
  });

  it('refuses nested and multi-segment paths', () => {
    expect(transformSurfaceFor(MAP, true, ['chunks', '112.bundle.js'])).toBeNull();
    expect(transformSurfaceFor(MAP, true, [])).toBeNull();
  });

  it.each([
    ['main.bundle.js.map', 'a source map, not the code'],
    ['main.bundle.jsx', 'trailing characters past the extension'],
    ['xmain.bundle.js', 'a prefixed lookalike'],
    ['112.bundle.js?v=1', 'a query string left on the segment'],
    ['112.chunk.js', 'the wrong infix'],
    ['112.bundle.JS', 'the wrong case'],
    ['11a.bundle.js', 'a non-numeric id'],
    ['1234567.bundle.js', 'an id past the digit cap'],
    ['', 'an empty segment'],
  ])('refuses %s (%s)', (file) => {
    expect(surface(file)).toBeNull();
  });

  it('refuses a chunk id that only LOOKS declared', () => {
    // '1120' shares a prefix with '112'. An unanchored or prefix match here would
    // hand chunk 1120 the pin of a completely different file.
    expect(surface('1120.bundle.js')).toBeNull();
    expect(surface('11.bundle.js')).toBeNull();
  });
});
