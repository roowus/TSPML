import { describe, expect, it } from 'vitest';

import {
  loadDefaultMap,
  MAP_FORMAT_VERSION,
  MapParseError,
  validateMap,
} from '../src/index.js';

/** The sha256 of tooling/mappings-pipeline/.cache/pt-0.6.2-raw-main.js. */
const EXPECTED_BUNDLE_HASH =
  'sha256:8495e6a31cfb66b55861188bd8041b38479ee5b50bd412cc1f6c2b17229f6488';

/** Minimal valid map object, mutated per test. */
function baseMap(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    formatVersion: 1,
    gameVersion: '0.6.2',
    bundleHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    generated: { from: 'test', matcher: 'test', granularity: 'module', note: 'note' },
    modules: {
      'car-protocol': {
        concept: 'Car Protocol',
        stableNames: ['controlCar'],
        subsystem: 'Car/Physics',
        subsystems: ['Car/Physics'],
        moduleId: '5220',
        matchWeight: 100,
        sharedAnchors: 18,
        sourceModuleId: '1223',
      },
    },
    unresolved: [],
    ...over,
  };
}

describe('loadDefaultMap (the bundled 0.6.2 map)', () => {
  it('parses and pins the expected bundleHash', async () => {
    const map = await loadDefaultMap();
    expect(map.formatVersion).toBe(MAP_FORMAT_VERSION);
    expect(map.gameVersion).toBe('0.6.2');
    expect(map.bundleHash).toBe(EXPECTED_BUNDLE_HASH);
  });

  it('has at least 40 module entries', async () => {
    const map = await loadDefaultMap();
    const count = Object.keys(map.modules).length;
    expect(count).toBeGreaterThanOrEqual(40);
  });

  it('has well-formed module entries and an unresolved list', async () => {
    const map = await loadDefaultMap();
    expect(Array.isArray(map.unresolved)).toBe(true);
    for (const entry of Object.values(map.modules)) {
      expect(entry.stableNames.length).toBeGreaterThan(0);
      expect(entry.moduleId).toMatch(/^[0-9]+$/);
      expect(entry.subsystem).toBeTypeOf('string');
    }
    // 66 game-logic modules in the 0.6.0-renamed corpus, each one either matched or
    // explicitly unresolved. The split was 56/10 on lexical anchors alone; the #1
    // structural tie-break promoted six of the residual ten, and the #1 edge pass
    // rescued two more (7129->8734, 8739->8482) by unique exact require-graph
    // agreement — all hand-verified against both module bodies
    // (docs/research/structural-fingerprints.md). The last two (3025, 6979) are
    // css-loader modules with no pass-1-matched neighbours; honestly unresolved.
    // Exact counts rather than a floor: they are the tripwire for an unreviewed
    // regeneration, which is the one way a wrong target reaches a shipped mod.
    expect(Object.keys(map.modules).length).toBe(64);
    expect(map.unresolved.length).toBe(2);
    expect(Object.keys(map.modules).length + map.unresolved.length).toBe(66);
  });
});

describe('validateMap', () => {
  it('accepts a minimal valid map', () => {
    const map = validateMap(baseMap());
    expect(map.modules['car-protocol']!.moduleId).toBe('5220');
    expect(map.bundleHash).toBe(
      'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );
  });

  it('rejects a wrong formatVersion', () => {
    expect(() => validateMap(baseMap({ formatVersion: 2 }))).toThrowError(MapParseError);
  });

  it('rejects a malformed bundleHash', () => {
    expect(() => validateMap(baseMap({ bundleHash: 'not-a-hash' }))).toThrowError(MapParseError);
  });

  it('rejects a module entry missing stableNames', () => {
    const bad = baseMap();
    delete (bad.modules as Record<string, Record<string, unknown>>)['car-protocol']!.stableNames;
    expect(() => validateMap(bad)).toThrowError(/stableNames/);
  });

  it('rejects a module entry with an empty moduleId', () => {
    const bad = baseMap();
    (bad.modules as Record<string, Record<string, unknown>>)['car-protocol']!.moduleId = '';
    expect(() => validateMap(bad)).toThrowError(/moduleId/);
  });

  it('rejects a non-array unresolved', () => {
    expect(() => validateMap(baseMap({ unresolved: {} }))).toThrowError(/unresolved/);
  });

  it("accepts decidedBy 'edge' and preserves edgeConfirmed", () => {
    const raw = baseMap();
    Object.assign((raw.modules as Record<string, Record<string, unknown>>)['car-protocol']!, {
      decidedBy: 'edge',
      edgeConfirmed: 3,
    });
    const map = validateMap(raw);
    expect(map.modules['car-protocol']!.decidedBy).toBe('edge');
    expect(map.modules['car-protocol']!.edgeConfirmed).toBe(3);
  });

  it('rejects an unrecognised decidedBy — fail closed, not "not structural"', () => {
    // The resolver ranks evidence kinds on stable-name collisions. A typo'd or
    // future value tolerated as "unknown" would default to the strongest rank and
    // quietly win collisions it should lose.
    const raw = baseMap();
    (raw.modules as Record<string, Record<string, unknown>>)['car-protocol']!.decidedBy = 'edgy';
    expect(() => validateMap(raw)).toThrowError(/decidedBy/);
  });

  it('rejects a non-object root', () => {
    expect(() => validateMap('nope')).toThrowError(MapParseError);
  });
});
