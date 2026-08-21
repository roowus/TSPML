import { describe, expect, it } from 'vitest';

import {
  loadDefaultMap,
  MAP_FORMAT_VERSION,
  MapParseError,
  targetSurface,
  transformableChunkIds,
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

  it('declares exactly the four chunks 0.6.2 lazy-loads (#98)', async () => {
    const map = await loadDefaultMap();
    // The set is not a judgement call: it is every `i.e(<id>)` call site in the
    // 0.6.2 webpack runtime — the same list the game itself will request. Probing
    // the CDN for ids would be wrong (it still serves stale chunks from earlier
    // builds with a 200), so this count is the tripwire for a chunk list edited
    // by hand rather than read off the runtime.
    expect(transformableChunkIds(map)).toEqual(['112', '535', '604', '657']);
  });

  it('pins the exact bytes fetched from the CDN for each chunk', async () => {
    const map = await loadDefaultMap();
    // Literal pins, like EXPECTED_BUNDLE_HASH above, because a WRONG pin fails in
    // the silent direction: it can never match live bytes, so the chunk is
    // permanently stale and simply never transforms. Nothing crashes and no test
    // that only checks shape would notice. These are the sha256/byte-length of
    // 0.6.2/<id>.bundle.js as actually fetched; they are the tripwire for a
    // hand-edited or half-regenerated chunks section.
    expect(map.chunks).toEqual({
      '112': {
        id: '112',
        hash: 'sha256:1094551ba359761a1a22d7b13a10f39a995c6efafe56504a093cd946110331f1',
        bytes: 108037,
        role: 'track editor',
      },
      '535': {
        id: '535',
        hash: 'sha256:c74f3117ab7484ac6b2aa4b9796dda3c3875142aad612e1c746a630a5419a374',
        bytes: 13182,
        role: 'track verifier UI',
      },
      '604': {
        id: '604',
        hash: 'sha256:030f3b7e8ee93d5d8339cda5a3341b3b07172b0a057cac6112a27b13dfa3f95a',
        bytes: 74464,
        role: 'profile selection UI',
      },
      '657': {
        id: '657',
        hash: 'sha256:3a98d17d2858c80bd23af315fed0dd3cf582fa5fde5c48d29de6ec503a0c9038',
        bytes: 6391,
        role: 'settings / options UI',
      },
    });
  });

  it('declares the physics binary with its own pin, not the bundle hash (#43)', async () => {
    const map = await loadDefaultMap();
    // A literal pin for the same reason the chunk pins are literal: a WRONG one fails
    // silently. The portal hashes the live binary, sees a mismatch, and serves vanilla
    // physics forever — no crash, no failing shape test, just a physics mod that never
    // does anything. This is the sha256/byte-length of 0.6.2/polytrack_physics.wasm as
    // actually fetched. (It is byte-identical across 0.6.0/0.6.1/0.6.2: the binary is
    // built separately from the JS and does not move with every release.)
    expect(map.wasm).toEqual({
      'polytrack_physics.wasm': {
        file: 'polytrack_physics.wasm',
        hash: 'sha256:d4ef02676973d41afc34b23b5248f6950b35dc4cc7e3047e3a9c6bd88e4c180e',
        bytes: 396005,
        role: 'physics simulation (Bullet, compiled)',
      },
    });
    // Gating physics on the JS bundle's hash would re-pin the binary on every main
    // bundle change even though its bytes never moved.
    expect(map.wasm?.['polytrack_physics.wasm']!.hash).not.toBe(map.bundleHash);
  });

  it('pins each chunk with its own distinct hash', async () => {
    const map = await loadDefaultMap();
    const hashes = Object.values(map.chunks ?? {}).map((c) => c.hash);
    // Per-chunk pins are the point of the section (#98). Reusing the main bundle's
    // hash, or one chunk's for another, would silently break the fail-closed gate
    // in the direction that MATTERS: it would accept bytes nobody verified.
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes).not.toContain(map.bundleHash);
    for (const chunk of Object.values(map.chunks ?? {})) {
      expect(chunk.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(chunk.bytes).toBeGreaterThan(0);
    }
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

describe('validateMap — chunks (#98)', () => {
  const CHUNK_HASH =
    'sha256:1111111111111111111111111111111111111111111111111111111111111111';
  function withChunk(over: Record<string, unknown> = {}): Record<string, unknown> {
    return baseMap({
      chunks: { '112': { id: '112', hash: CHUNK_HASH, bytes: 108037, role: 'track editor', ...over } },
    });
  }

  it('accepts a well-formed chunks section', () => {
    const map = validateMap(withChunk());
    expect(map.chunks?.['112']).toEqual({
      id: '112',
      hash: CHUNK_HASH,
      bytes: 108037,
      role: 'track editor',
    });
  });

  it('treats an absent chunks section as "no transformable chunks"', () => {
    // The pre-#98 surface. Absent must not become an empty-but-present object:
    // a host distinguishes "declares none" from "declares an allowlist".
    expect(validateMap(baseMap()).chunks).toBeUndefined();
  });

  it('rejects a non-digit chunk id — it becomes a request path', () => {
    // The whole reason this is strict: a host builds `<id>.bundle.js` from it.
    expect(() => validateMap(withChunk({ id: '../../evil' }))).toThrowError(/digits/);
  });

  it('rejects an id that disagrees with its key', () => {
    // Lookup is by key; the transform pin and the fetched path would diverge.
    expect(() => validateMap(withChunk({ id: '604' }))).toThrowError(/must equal its key/);
  });

  it('rejects a malformed chunk hash', () => {
    // A pin that can never match would make the chunk permanently, silently vanilla.
    expect(() => validateMap(withChunk({ hash: 'sha256:nope' }))).toThrowError(/hash/);
  });

  it('rejects a non-positive bytes and an empty role', () => {
    expect(() => validateMap(withChunk({ bytes: 0 }))).toThrowError(/bytes/);
    expect(() => validateMap(withChunk({ role: '' }))).toThrowError(/role/);
  });

  it('rejects a non-object chunks section', () => {
    expect(() => validateMap(baseMap({ chunks: [] }))).toThrowError(/chunks/);
  });
});

describe('validateMap — wasm (#43)', () => {
  const WASM_HASH = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
  function withWasm(over: Record<string, unknown> = {}): Record<string, unknown> {
    return baseMap({
      wasm: {
        'polytrack_physics.wasm': {
          file: 'polytrack_physics.wasm',
          hash: WASM_HASH,
          bytes: 396005,
          role: 'physics simulation',
          ...over,
        },
      },
    });
  }

  it('accepts a well-formed wasm section', () => {
    expect(validateMap(withWasm()).wasm?.['polytrack_physics.wasm']).toEqual({
      file: 'polytrack_physics.wasm',
      hash: WASM_HASH,
      bytes: 396005,
      role: 'physics simulation',
    });
  });

  it('treats an absent wasm section as "declares no patchable binaries"', () => {
    // Every pre-#43 map. Absent must stay absent rather than becoming `{}`: a host
    // distinguishes "declares none" from "declares an allowlist", and every .wasm
    // request under the former is proxied verbatim.
    expect(validateMap(baseMap()).wasm).toBeUndefined();
  });

  it('rejects a filename that is not a plain <name>.wasm', () => {
    // The filename becomes a request path, so a lenient rule here is a traversal
    // primitive. Rejected at STORE time as well as at request time, so a bad name
    // cannot sit in a committed map waiting for the request-side check to regress.
    for (const file of ['../polytrack_physics.wasm', 'sub/physics.wasm', 'physics.wasm.js', '']) {
      expect(() => validateMap(withWasm({ file }))).toThrowError(/file/);
    }
  });

  it('rejects a file that disagrees with its key', () => {
    // Lookup is by key; the pin and the fetched path would describe different files.
    expect(() => validateMap(withWasm({ file: 'polytrack_audio.wasm' }))).toThrowError(
      /must equal its key/,
    );
  });

  it('rejects a malformed hash', () => {
    // A pin that can never match makes the binary permanently, silently vanilla —
    // which for physics reads to a player as "the mod does nothing", with no error.
    expect(() => validateMap(withWasm({ hash: 'sha256:nope' }))).toThrowError(/hash/);
    expect(() => validateMap(withWasm({ hash: 'd4ef' }))).toThrowError(/hash/);
  });

  it('rejects a non-positive bytes and an empty role', () => {
    expect(() => validateMap(withWasm({ bytes: 0 }))).toThrowError(/bytes/);
    expect(() => validateMap(withWasm({ role: '' }))).toThrowError(/role/);
  });

  it('rejects a non-object wasm section', () => {
    expect(() => validateMap(baseMap({ wasm: [] }))).toThrowError(/wasm/);
    expect(() => validateMap(baseMap({ wasm: 'polytrack_physics.wasm' }))).toThrowError(/wasm/);
  });
});

describe('validateMap — target surfaces (#98)', () => {
  const CHUNK_HASH =
    'sha256:1111111111111111111111111111111111111111111111111111111111111111';
  const TARGET = {
    anchor: { literals: ['Part index out of bounds'] },
    selector: { kind: 'method', name: 'draw' },
  };
  /** A map with one declared chunk and one target, both overridable. */
  function withTarget(surface?: string, chunkId = '112'): Record<string, unknown> {
    return baseMap({
      chunks: { [chunkId]: { id: chunkId, hash: CHUNK_HASH, bytes: 108037, role: 'track editor' } },
      targets: { Editor: { ...TARGET, ...(surface === undefined ? {} : { surface }) } },
    });
  }

  it('defaults a surface-less target to the main bundle', () => {
    // Every pre-#98 target omits `surface`. If absent ever meant "any file", those
    // targets would silently widen from one verified bundle to all of them.
    const map = validateMap(withTarget());
    expect(map.targets?.Editor?.surface).toBeUndefined();
    expect(targetSurface(map.targets!.Editor!)).toBe('main.bundle.js');
  });

  it('preserves an explicit chunk surface', () => {
    const map = validateMap(withTarget('112.bundle.js'));
    expect(targetSurface(map.targets!.Editor!)).toBe('112.bundle.js');
  });

  it('accepts an explicit main surface', () => {
    expect(targetSurface(validateMap(withTarget('main.bundle.js')).targets!.Editor!)).toBe(
      'main.bundle.js',
    );
  });

  it('rejects a target scoped to an UNDECLARED chunk', () => {
    // Doubly silent otherwise: the host never transforms an undeclared chunk, so the
    // target can never resolve; and the pipeline has no unpacked dir for it, so
    // verification never checks. A map whose two sections disagree is malformed.
    expect(() => validateMap(withTarget('999.bundle.js'))).toThrowError(/does not declare/);
  });

  it('rejects a chunk-scoped target when the map declares NO chunks at all', () => {
    const raw = baseMap({ targets: { Editor: { ...TARGET, surface: '112.bundle.js' } } });
    expect(() => validateMap(raw)).toThrowError(/does not declare/);
  });

  it('rejects a surface that is not a bundle filename', () => {
    // A bare id ('112') or a path is not a served file. Accepting either would make
    // the surface comparison — a string equality against the request filename —
    // quietly never match.
    expect(() => validateMap(withTarget('112'))).toThrowError(/surface/);
    expect(() => validateMap(withTarget('../main.bundle.js'))).toThrowError(/surface/);
    expect(() => validateMap(withTarget(''))).toThrowError(/surface/);
  });
});
