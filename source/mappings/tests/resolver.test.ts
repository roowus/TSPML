import { describe, expect, it } from 'vitest';

import { createResolver, loadDefaultMap, resolve, resolveTarget } from '../src/index.js';
import type { GameMap } from '../src/index.js';

/** A tiny hand-rolled map for deterministic resolver tests. */
function toyMap(): GameMap {
  return {
    formatVersion: 1,
    gameVersion: '0.6.2',
    bundleHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    generated: { from: 'toy', matcher: 'toy', granularity: 'module', note: 'note' },
    modules: {
      'car-protocol': {
        concept: 'Car Protocol',
        stableNames: ['controlCar', 'createCar'],
        subsystem: 'Car/Physics',
        subsystems: ['Car/Physics'],
        moduleId: '5220',
        matchWeight: 100,
        sharedAnchors: 18,
        sourceModuleId: '1223',
      },
      'track-blocks': {
        concept: 'Track Blocks',
        stableNames: ['wallTrack'],
        subsystem: 'Track',
        subsystems: ['Track'],
        moduleId: '8043',
        matchWeight: 90,
        sharedAnchors: 12,
        sourceModuleId: '2203',
      },
    },
    unresolved: [],
  };
}

const MATCHING = { bundleHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
const STALE = { bundleHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' };

describe('createResolver — happy path', () => {
  it('resolves a known stable name to the correct module', () => {
    const r = createResolver(toyMap());
    const res = r.resolve('controlCar', MATCHING);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.locator.type).toBe('module');
      expect(res.locator.moduleId).toBe('5220');
    }
  });

  it('resolves case-insensitively', () => {
    const r = createResolver(toyMap());
    const res = r.resolve('WALLTRACK', MATCHING);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.locator.moduleId).toBe('8043');
  });

  it('accepts a bare-hex bundleHash (no sha256: prefix)', () => {
    const r = createResolver(toyMap());
    const res = r.resolve('controlCar', {
      bundleHash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(res.ok).toBe(true);
  });
});

describe('createResolver — fail closed on stale map', () => {
  it('returns stale-map and NO locator when the bundleHash mismatches', () => {
    const r = createResolver(toyMap());
    const res = r.resolve('controlCar', STALE);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('stale-map');
      expect(res.message).toMatch(/bundleHash/);
    }
    // The load-bearing assertion: a stale map must never hand out a locator.
    expect('locator' in res).toBe(false);
  });

  it('does not even resolve when the name would otherwise be unknown', () => {
    // Stale-map takes precedence over not-found: reason is stale-map, not not-found.
    const r = createResolver(toyMap());
    const res = r.resolve('this-name-does-not-exist', STALE);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('stale-map');
  });
});

describe('createResolver — not-found', () => {
  it('returns not-found for an unknown stable name when the hashes match', () => {
    const r = createResolver(toyMap());
    const res = r.resolve('noSuchSymbol', MATCHING);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('not-found');
      expect(res.message).toContain('noSuchSymbol');
    }
    expect('locator' in res).toBe(false);
  });
});

describe('resolve (stateless) against the real bundled map', () => {
  let map: GameMap;
  it('loads', async () => {
    map = await loadDefaultMap();
    expect(Object.keys(map.modules).length).toBeGreaterThan(0);
  });

  it('resolves controlCar -> module 5220 (Car/Physics protocol)', async () => {
    map = await loadDefaultMap();
    const res = resolve(map, 'controlCar', { bundleHash: map.bundleHash });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.locator.moduleId).toBe('5220');
  });

  it('resolves checkpointOrder -> module 11', async () => {
    map = await loadDefaultMap();
    const res = resolve(map, 'checkpointOrder', { bundleHash: map.bundleHash });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.locator.moduleId).toBe('11');
  });

  it('fails closed on a mismatched live bundle', async () => {
    map = await loadDefaultMap();
    const res = resolve(map, 'controlCar', {
      bundleHash: 'sha256:deadbeef'.padEnd(71, '0'),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('stale-map');
    expect('locator' in res).toBe(false);
  });
});

describe('resolveTarget (M5-C) — stable name -> TargetSpec, fail-closed', () => {
  it('resolves a known target from the real 0.6.2 map', async () => {
    const map = await loadDefaultMap();
    const res = resolveTarget(map, 'Car.controlCar', { bundleHash: map.bundleHash });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.target.selector.kind).toBe('method');
      expect(res.target.selector.name).toBe('controlCar');
      expect(res.target.anchor.literals).toContain('ControlCar');
    }
  });

  it('resolves the Car factory target', async () => {
    const map = await loadDefaultMap();
    const res = resolveTarget(map, 'Car', { bundleHash: map.bundleHash });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.target.selector.kind).toBe('factory');
  });

  it('resolves case-insensitively', async () => {
    const map = await loadDefaultMap();
    const res = resolveTarget(map, 'car.createcar', { bundleHash: map.bundleHash });
    expect(res.ok).toBe(true);
  });

  it('fails closed (stale-map) on a hash mismatch — returns no target', async () => {
    const map = await loadDefaultMap();
    const res = resolveTarget(map, 'Car.controlCar', {
      bundleHash: 'sha256:deadbeef'.padEnd(71, '0'),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('stale-map');
    expect('target' in res).toBe(false);
  });

  it('returns not-found for an unknown target', async () => {
    const map = await loadDefaultMap();
    const res = resolveTarget(map, 'Nope.nada', { bundleHash: map.bundleHash });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-found');
  });
});
