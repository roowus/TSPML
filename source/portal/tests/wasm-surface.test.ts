/**
 * lib/transform-surface.ts — the WASM half (#43): which proxied binaries may be
 * patched, and against which pin.
 *
 * Same two failure directions as the JS surfaces, with the stakes raised on one side:
 *
 *   too permissive — a path becomes a patchable surface it should not be (an undeclared
 *     binary, a nested path, a non-default host). For JS that risks a patch that misses;
 *     here it is the first step toward writing a float into an unverified binary.
 *   too strict — the declared binary stops being a surface, which is SILENT: it proxies
 *     verbatim, the game drives exactly as normal, and physics mods simply never apply.
 *
 * Driven with a synthetic map, so nothing here depends on the real 0.6.2 pin.
 */
import { describe, expect, it } from 'vitest';
import type { GameMap } from '@tspml/mappings';
import { wasmSurfaceFor } from '../lib/transform-surface';

const PHYSICS_HASH = `sha256:${'d'.repeat(64)}`;

const MAP = {
  formatVersion: 1,
  gameVersion: '0.0.0-test',
  bundleHash: `sha256:${'a'.repeat(64)}`,
  generated: { from: 'test', matcher: 'test', granularity: 'test', note: 'test' },
  modules: {},
  unresolved: [],
  chunks: {
    '112': { id: '112', hash: `sha256:${'b'.repeat(64)}`, bytes: 108037, role: 'track editor' },
  },
  wasm: {
    'polytrack_physics.wasm': {
      file: 'polytrack_physics.wasm',
      hash: PHYSICS_HASH,
      bytes: 396005,
      role: 'physics simulation',
    },
  },
} as unknown as GameMap;

/** A map with no wasm section — every pre-#43 map. Must keep working: nothing is a
 *  wasm surface, and the binary streams through as it always did. */
const MAP_NO_WASM = { ...MAP, wasm: undefined } as unknown as GameMap;

const surf = (file: string, host = true): ReturnType<typeof wasmSurfaceFor> =>
  wasmSurfaceFor(MAP, host, [file]);

describe('wasmSurfaceFor — the declared binary', () => {
  it('is a surface carrying its OWN pin, not the bundle hash', () => {
    const s = surf('polytrack_physics.wasm');
    expect(s).not.toBeNull();
    expect(s?.kind).toBe('wasm');
    expect(s?.file).toBe('polytrack_physics.wasm');
    expect(s?.role).toBe('physics simulation');
    // The load-bearing assertion: gating physics on the JS bundle's hash would trip on
    // every main-bundle change even though the binary is byte-identical across releases.
    expect(s?.expectedHash).toBe(PHYSICS_HASH);
    expect(s?.expectedHash).not.toBe(MAP.bundleHash);
  });
});

describe('wasmSurfaceFor — what must NOT become a surface', () => {
  it('refuses a binary the map does not declare', () => {
    expect(surf('polytrack_audio.wasm')).toBeNull();
    expect(surf('physics.wasm')).toBeNull();
  });

  it('refuses every wasm request when the map declares no wasm section', () => {
    expect(wasmSurfaceFor(MAP_NO_WASM, true, ['polytrack_physics.wasm'])).toBeNull();
  });

  it('refuses a non-default host — no pin in this map applies to it', () => {
    expect(surf('polytrack_physics.wasm', false)).toBeNull();
  });

  it('refuses a nested path, so a declared name cannot be reached through one', () => {
    expect(wasmSurfaceFor(MAP, true, ['sub', 'polytrack_physics.wasm'])).toBeNull();
    expect(wasmSurfaceFor(MAP, true, [])).toBeNull();
  });

  it('refuses traversal and separator characters in the filename', () => {
    // The filename reaches a request path, so a lenient match here is a traversal
    // primitive. These must fail the SHAPE check, before the allowlist is consulted.
    for (const bad of [
      '../polytrack_physics.wasm',
      './polytrack_physics.wasm',
      'a/polytrack_physics.wasm',
      '..%2Fpolytrack_physics.wasm',
      'polytrack_physics.wasm/..',
      '',
    ]) {
      expect(wasmSurfaceFor(MAP, true, [bad])).toBeNull();
    }
  });

  it('refuses a JS bundle — the two surface kinds never overlap', () => {
    expect(surf('main.bundle.js')).toBeNull();
    expect(surf('112.bundle.js')).toBeNull();
  });

  it('requires the .wasm suffix rather than merely containing it', () => {
    expect(surf('polytrack_physics.wasm.js')).toBeNull();
    expect(surf('polytrack_physics')).toBeNull();
  });
});
