import { describe, expect, it } from 'vitest';

import {
  createResolver,
  loadDefaultMap,
  resolve,
  resolveChunk,
  resolveTarget,
  transformableChunkIds,
} from '../src/index.js';
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

describe('createResolver — stable-name collisions rank by evidence, not map order (#1)', () => {
  /**
   * Two modules sharing one stable name — the real shape of the problem. Sibling
   * track-block registries genuinely all declare `TrackPartRotationAxis`, so a name can
   * name several modules and the resolver has to choose.
   *
   * `structuralFirst` puts the STRUCTURALLY-decided module first in key order, which is
   * what the real 0.6.2 map does after the six #1 promotions. Under the old first-wins
   * index that alone decided the winner.
   */
  function collidingMap(structuralFirst: boolean): GameMap {
    const lexical = {
      concept: 'Track Registry (lexical)',
      stableNames: ['TrackPartRotationAxis'],
      subsystem: 'Track',
      subsystems: ['Track'],
      moduleId: '11',
      matchWeight: 40,
      sharedAnchors: 9,
      sourceModuleId: '5440',
      decidedBy: 'lexical' as const,
    };
    const structural = {
      concept: 'Track Registry (structural)',
      stableNames: ['TrackPartRotationAxis'],
      subsystem: 'Track',
      subsystems: ['Track'],
      moduleId: '1648',
      matchWeight: 19,
      sharedAnchors: 4,
      sourceModuleId: '5343',
      decidedBy: 'structural' as const,
      structuralSimilarity: 0.99998,
    };
    const base = toyMap();
    return {
      ...base,
      modules: structuralFirst
        ? { structural, lexical, ...base.modules }
        : { lexical, structural, ...base.modules },
    };
  }

  it('prefers the lexically-decided module even when the structural one comes first', () => {
    // The regression this guards: before #1 was wired into gen-map, buildIndex was
    // first-wins over Object.values(map.modules) — i.e. over JSON key order. Measured on
    // the real pair, the six structural promotions then took EIGHT pre-existing stable
    // names off lexically-matched modules purely by landing earlier in the file. Adding
    // modules must be additive.
    for (const structuralFirst of [true, false]) {
      const res = createResolver(collidingMap(structuralFirst)).resolve(
        'TrackPartRotationAxis',
        MATCHING,
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.locator.moduleId).toBe('11');
    }
  });

  it('breaks a same-evidence collision by matchWeight, then deterministically', () => {
    const base = toyMap();
    const mk = (moduleId: string, matchWeight: number) => ({
      concept: `Registry ${moduleId}`,
      stableNames: ['sharedEnum'],
      subsystem: 'Track',
      subsystems: ['Track'],
      moduleId,
      matchWeight,
      sharedAnchors: 4,
      sourceModuleId: `src-${moduleId}`,
      decidedBy: 'lexical' as const,
    });
    const heavier = createResolver({
      ...base,
      modules: { ...base.modules, a: mk('700', 10), b: mk('900', 50) },
    }).resolve('sharedEnum', MATCHING);
    expect(heavier.ok).toBe(true);
    if (heavier.ok) expect(heavier.locator.moduleId).toBe('900');

    // Equal weight AND equal evidence: the tie must still be stable across key orders,
    // or two runs over one map could disagree about what a name resolves to.
    const tieA = createResolver({
      ...base,
      modules: { ...base.modules, a: mk('700', 10), b: mk('900', 10) },
    }).resolve('sharedEnum', MATCHING);
    const tieB = createResolver({
      ...base,
      modules: { ...base.modules, b: mk('900', 10), a: mk('700', 10) },
    }).resolve('sharedEnum', MATCHING);
    expect(tieA.ok && tieB.ok).toBe(true);
    if (tieA.ok && tieB.ok) expect(tieA.locator.moduleId).toBe(tieB.locator.moduleId);
  });

  it('ranks edge evidence below BOTH content signals', () => {
    // An edge decision says nothing about the module's own body — it is relational
    // evidence used precisely when content signals saturated. On a name collision it
    // must lose to structural (weaker content evidence is still content evidence),
    // and by transitivity to lexical, regardless of key order and matchWeight.
    const base = toyMap();
    const structural = {
      concept: 'Structural Registry',
      stableNames: ['sharedEnum'],
      subsystem: 'Track',
      subsystems: ['Track'],
      moduleId: '1648',
      matchWeight: 4, // deliberately LOWER weight — evidence kind must decide first
      sharedAnchors: 2,
      sourceModuleId: '5343',
      decidedBy: 'structural' as const,
    };
    const edge = {
      concept: 'Edge Registry',
      stableNames: ['sharedEnum'],
      subsystem: 'Track',
      subsystems: ['Track'],
      moduleId: '8734',
      matchWeight: 99,
      sharedAnchors: 40,
      sourceModuleId: '7129',
      decidedBy: 'edge' as const,
      edgeConfirmed: 3,
    };
    for (const modules of [
      { edge, structural, ...base.modules },
      { structural, edge, ...base.modules },
    ]) {
      const res = createResolver({ ...base, modules }).resolve('sharedEnum', MATCHING);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.locator.moduleId).toBe('1648');
    }
  });

  it('still resolves a name only an edge-decided module carries', () => {
    // Ranking is for collisions only. The whole point of the edge pass is that these
    // modules' names were previously unresolvable — an uncontested edge entry must
    // resolve like any other.
    const base = toyMap();
    const edge = {
      concept: 'Part Grid List',
      stableNames: ['rotatePartGridPosition'],
      subsystem: 'Track',
      subsystems: ['Track'],
      moduleId: '8734',
      matchWeight: 6,
      sharedAnchors: 2,
      sourceModuleId: '7129',
      decidedBy: 'edge' as const,
      edgeConfirmed: 3,
    };
    const res = createResolver({ ...base, modules: { edge, ...base.modules } }).resolve(
      'rotatePartGridPosition',
      MATCHING,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.locator.moduleId).toBe('8734');
  });

  it('treats an absent decidedBy as lexical (pre-#1 maps)', () => {
    // Backward compatibility is load-bearing here: a pre-#1 entry has no decidedBy, and
    // reading that as "unknown, therefore weaker" would demote every module in every
    // already-committed map below any structural newcomer.
    const base = toyMap();
    const legacy = {
      concept: 'Legacy Registry',
      stableNames: ['sharedEnum'],
      subsystem: 'Track',
      subsystems: ['Track'],
      moduleId: '11',
      matchWeight: 5, // deliberately LOWER weight — evidence kind must decide first
      sharedAnchors: 2,
      sourceModuleId: '5440',
    };
    const structural = {
      concept: 'New Registry',
      stableNames: ['sharedEnum'],
      subsystem: 'Track',
      subsystems: ['Track'],
      moduleId: '1648',
      matchWeight: 99,
      sharedAnchors: 40,
      sourceModuleId: '5343',
      decidedBy: 'structural' as const,
    };
    const res = createResolver({
      ...base,
      modules: { structural, legacy, ...base.modules },
    }).resolve('sharedEnum', MATCHING);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.locator.moduleId).toBe('11');
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
      expect(res.target.selector).toEqual({ kind: 'method', name: 'controlCar' });
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

describe('resolveChunk (#98) — scoped, fail-closed chunk allowlist', () => {
  const CHUNK_HASH =
    'sha256:1094551ba359761a1a22d7b13a10f39a995c6efafe56504a093cd946110331f1';

  function mapWithChunks(): GameMap {
    return {
      ...toyMap(),
      chunks: {
        '112': { id: '112', hash: CHUNK_HASH, bytes: 108037, role: 'track editor' },
      },
    };
  }

  it('allows a declared chunk whose live hash matches its own pin', () => {
    const res = resolveChunk(mapWithChunks(), '112', CHUNK_HASH);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.chunk.role).toBe('track editor');
  });

  it('accepts a bare-hex live hash for the same bytes', () => {
    // The proxy hashes bytes itself and may hand back an unprefixed digest; the
    // same normalization the main-bundle gate uses has to apply here or every
    // chunk would read as stale and silently never transform.
    const res = resolveChunk(mapWithChunks(), '112', CHUNK_HASH.slice('sha256:'.length).toUpperCase());
    expect(res.ok).toBe(true);
  });

  it("answers the allowlist question alone when no live hash is given", () => {
    // A proxy has to decide whether to BUFFER a response before it can hash it.
    // Asking without bytes must not be mistaken for "hash matched".
    const res = resolveChunk(mapWithChunks(), '112');
    expect(res.ok).toBe(true);
  });

  it("refuses an undeclared chunk as 'not-declared', not as an error", () => {
    // Routine: TSPML has verified no anchors inside it, so a host proxies it verbatim.
    const res = resolveChunk(mapWithChunks(), '999', CHUNK_HASH);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-declared');
    expect('chunk' in res).toBe(false);
  });

  it("refuses a declared chunk whose bytes drifted as 'stale-chunk'", () => {
    const res = resolveChunk(mapWithChunks(), '112', 'sha256:' + 'b'.repeat(64));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('stale-chunk');
    expect('chunk' in res).toBe(false);
  });

  it('does not accept the MAIN bundle hash for a chunk', () => {
    // The failure this guards is the tempting shortcut: gate chunks on the one
    // hash the host already has. Chunks re-minify independently, so that pin
    // says nothing about these bytes.
    const map = mapWithChunks();
    const res = resolveChunk(map, '112', map.bundleHash);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('stale-chunk');
  });

  it('treats a map with no chunks section as declaring none', () => {
    const res = resolveChunk(toyMap(), '112', CHUNK_HASH);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-declared');
    expect(transformableChunkIds(toyMap())).toEqual([]);
  });

  it('a stale chunk does not disturb the main bundle gate', () => {
    // The load-bearing scoping rule: one re-minified chunk must not take the
    // whole session vanilla over code the player may never load.
    const map = mapWithChunks();
    expect(resolveChunk(map, '112', 'sha256:' + 'c'.repeat(64)).ok).toBe(false);
    expect(resolve(map, 'controlCar', MATCHING).ok).toBe(true);
  });

  it('lists ids numerically ascending, not lexicographically', () => {
    // '1000' sorts before '604' as a string; a host printing the allowlist or
    // iterating it in order would report a scrambled list.
    const map: GameMap = {
      ...toyMap(),
      chunks: {
        '604': { id: '604', hash: CHUNK_HASH, bytes: 1, role: 'a' },
        '1000': { id: '1000', hash: CHUNK_HASH, bytes: 1, role: 'b' },
        '112': { id: '112', hash: CHUNK_HASH, bytes: 1, role: 'c' },
      },
    };
    expect(transformableChunkIds(map)).toEqual(['112', '604', '1000']);
  });
});
