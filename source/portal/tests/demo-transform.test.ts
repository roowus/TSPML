// Unit tests for lib/demo-transform.ts composeTransform — the #62 compose:
// base + user patch sets in ONE engine pass, base all-or-nothing, user per-mod
// isolated, replace pre-screen, honest per-mod report.
//
// Driven with a SYNTHETIC bundle + map: composeTransform takes the map as a
// parameter precisely so tests don't need a fixture whose sha256 matches the
// pinned real-game map. The engine is the real @tspml/transform except for the
// output-invalid retry test, which stubs `transform` (the only way to reach
// that path deterministically — it needs an inject that parses standalone but
// breaks whole-bundle regeneration).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { targetSignature, transform } from '@tspml/transform';
import type { TransformResult } from '@tspml/transform';
import type { GameMap } from '@tspml/mappings';
import {
  applyDemoTransform,
  composeTransform,
  MAIN_SURFACE,
  surfaceForPath,
} from '../lib/demo-transform.js';
import type { EngineFns } from '../lib/demo-transform.js';
import { transformSurfaceFor } from '../lib/transform-surface.js';
import type { TransformSurface } from '../lib/transform-surface.js';

const ENGINE: EngineFns = { transform, targetSignature };

/** Webpack-module-map-shaped synthetic bundle the locators recognize. Anchors
 *  ride in an array literal — leading expression-statement strings would parse
 *  as directives, which the anchor scan (StringLiteral visitor) never sees. */
const BUNDLE = `
const modules = {
  101: (e, t, n) => {
    const anchors = ["CarAnchorOne", "CarAnchorTwo"];
    class Car {
      controlCar(input) {
        return input;
      }
    }
    t.Car = Car;
  },
  202: (e, t, n) => {
    const anchors = ["HudAnchorOne", "HudAnchorTwo"];
    class Hud {
      draw() {
        return 1;
      }
    }
    t.Hud = Hud;
  }
};
`;

const LIVE_HASH = `sha256:${createHash('sha256').update(BUNDLE).digest('hex')}`;

const CAR_TARGET = {
  anchor: { literals: ['CarAnchorOne', 'CarAnchorTwo'] },
  selector: { kind: 'method', name: 'controlCar' },
} as const;
const HUD_TARGET = {
  anchor: { literals: ['HudAnchorOne', 'HudAnchorTwo'] },
  selector: { kind: 'method', name: 'draw' },
} as const;

const MAP = {
  formatVersion: 1,
  gameVersion: '0.0.0-test',
  bundleHash: LIVE_HASH,
  generated: { from: 'test', matcher: 'test', granularity: 'test', note: 'test' },
  modules: {},
  unresolved: [],
  targets: { Car: CAR_TARGET },
  // #98: one declared chunk, so the chunk-surface tests below resolve through the
  // real allowlist rather than a hand-built surface literal. Its pin is the SAME
  // bytes as the main bundle here — the fixture reuses BUNDLE for both — which is
  // exactly what lets one test isolate "which pin was checked" from "which bytes
  // were served".
  chunks: {
    '112': { id: '112', hash: LIVE_HASH, bytes: BUNDLE.length, role: 'test chunk' },
  },
} as unknown as GameMap;

/** The surfaces under test, resolved through the real resolver (not literals, so a
 *  regression in transformSurfaceFor shows up here too). */
function surface(file: string): TransformSurface {
  const s = transformSurfaceFor(MAP, true, [file]);
  if (!s) throw new Error(`fixture: ${file} is not a surface`);
  return s;
}
const MAIN = surface('main.bundle.js');
const CHUNK = surface('112.bundle.js');

/** One base patch, inline-anchored at Car.controlCar (like the bridge patches). */
const BASE = [{ op: 'before', target: CAR_TARGET, inject: 'globalThis.__base = 1;' }];

describe('composeTransform (#62)', () => {
  it('applies user patches alongside the base in one pass, with per-mod rows', () => {
    const r = composeTransform(
      ENGINE,
      BUNDLE,
      BASE,
      [
        // One inline-anchored patch and one `{symbol}` patch resolved via the map.
        { modId: 'inline-mod', patches: [{ op: 'after', target: HUD_TARGET, inject: 'globalThis.__userA = 1;' }] },
        { modId: 'symbol-mod', patches: [{ op: 'before', symbol: 'Car', inject: 'globalThis.__userB = 1;' }] },
      ],
      MAP,
      LIVE_HASH,
      MAIN,
    );
    expect(r.transformed).toBe(true);
    expect(r.code).toContain('__base');
    expect(r.code).toContain('__userA');
    expect(r.code).toContain('__userB');
    expect(r.userReport).toEqual({
      v: 1,
      planStatus: 'applied',
      mods: [
        { modId: 'inline-mod', declared: 1, applied: 1, failed: [] },
        { modId: 'symbol-mod', declared: 1, applied: 1, failed: [] },
      ],
    });
  });

  it('isolates one mod\'s not-found patch from the others and from the base', () => {
    const r = composeTransform(
      ENGINE,
      BUNDLE,
      BASE,
      [
        { modId: 'broken-mod', patches: [{ op: 'before', target: { anchor: { literals: ['NoSuchAnchor'] }, selector: { kind: 'method', name: 'nope' } }, inject: 'globalThis.__never = 1;' }] },
        { modId: 'fine-mod', patches: [{ op: 'after', target: HUD_TARGET, inject: 'globalThis.__fine = 1;' }] },
      ],
      MAP,
      LIVE_HASH,
      MAIN,
    );
    expect(r.transformed).toBe(true);
    expect(r.code).toContain('__base');
    expect(r.code).toContain('__fine');
    expect(r.code).not.toContain('__never');
    expect(r.userReport?.planStatus).toBe('applied');
    const broken = r.userReport?.mods.find((m) => m.modId === 'broken-mod');
    expect(broken?.applied).toBe(0);
    expect(broken?.failed[0]?.reason).toBe('not-found');
    const fine = r.userReport?.mods.find((m) => m.modId === 'fine-mod');
    expect(fine).toEqual({ modId: 'fine-mod', declared: 1, applied: 1, failed: [] });
  });

  it('pre-fails an unresolvable {symbol} patch without reaching the engine', () => {
    const r = composeTransform(
      ENGINE,
      BUNDLE,
      BASE,
      [{ modId: 'stale-mod', patches: [{ op: 'before', symbol: 'NotInTheMap', inject: 'globalThis.__x = 1;' }] }],
      MAP,
      LIVE_HASH,
      MAIN,
    );
    expect(r.transformed).toBe(true);
    const row = r.userReport?.mods[0];
    expect(row?.applied).toBe(0);
    expect(row?.failed[0]?.reason).toBe('symbol-unresolved');
  });

  it('pre-screens a user replace aimed at a base-patched target (the silent-splice hazard)', () => {
    const r = composeTransform(
      ENGINE,
      BUNDLE,
      BASE,
      [{
        modId: 'overwriter',
        patches: [{ op: 'replace', target: CAR_TARGET, source: 'controlCar(input) { return null; }' }],
      }],
      MAP,
      LIVE_HASH,
      MAIN,
    );
    // The base inject SURVIVES — the whole point of the pre-screen: the
    // engine's own conflict detection only groups replace-vs-replace and would
    // have reported this replace as a success while splicing the base out.
    expect(r.transformed).toBe(true);
    expect(r.code).toContain('__base');
    expect(r.userReport?.mods[0]?.failed[0]?.reason).toBe('conflicts-with-loader-patch');
  });

  it('fails closed to vanilla on hash mismatch, blaming no individual patch', () => {
    const r = composeTransform(
      ENGINE,
      BUNDLE,
      BASE,
      [{ modId: 'm', patches: [{ op: 'after', target: HUD_TARGET, inject: 'globalThis.__x = 1;' }] }],
      MAP,
      'sha256:' + '0'.repeat(64),
      MAIN,
    );
    expect(r.transformed).toBe(false);
    expect(r.code).toBe(BUNDLE);
    expect(r.userReport?.planStatus).toBe('base-failed');
    expect(r.userReport?.mods[0]?.failed[0]?.reason).toBe('hash-mismatch');
  });

  it('serves vanilla with base-failed rows when a base patch misses', () => {
    const missingBase = [
      ...BASE,
      { op: 'before', target: { anchor: { literals: ['GoneAnchor'] }, selector: { kind: 'method', name: 'gone' } }, inject: 'globalThis.__gone = 1;' },
    ];
    const r = composeTransform(
      ENGINE,
      BUNDLE,
      missingBase,
      [{ modId: 'm', patches: [{ op: 'after', target: HUD_TARGET, inject: 'globalThis.__x = 1;' }] }],
      MAP,
      LIVE_HASH,
      MAIN,
    );
    expect(r.transformed).toBe(false);
    expect(r.code).toBe(BUNDLE);
    expect(r.userReport?.planStatus).toBe('base-failed');
  });

  it('returns null userReport on the plain path (no user sets)', () => {
    const r = composeTransform(ENGINE, BUNDLE, BASE, [], MAP, LIVE_HASH, MAIN);
    expect(r.transformed).toBe(true);
    expect(r.userReport).toBeNull();
  });

  it('retries base-only when the combined output fails the re-parse gate', () => {
    // Stubbed engine: the only deterministic way into this path — it needs an
    // inject that parses standalone but breaks whole-bundle regeneration.
    const applied = (n: number) =>
      Array.from({ length: n }, (_, index) => ({ index, op: 'before' as const, status: 'applied' as const, detail: 'ok' }));
    const stub: EngineFns = {
      targetSignature,
      transform: (src, patches = []): TransformResult => ({
        code: patches.length > 1 ? 'BROKEN OUTPUT' : 'BASE ONLY OUTPUT',
        map: null,
        applied: applied(patches.length),
        failed: [],
        outputValid: patches.length <= 1,
        parseErrorCount: patches.length > 1 ? 1 : 0,
      }),
    };
    const r = composeTransform(
      stub,
      BUNDLE,
      BASE,
      [{ modId: 'codegen-breaker', patches: [{ op: 'before', target: HUD_TARGET, inject: 'x' }] }],
      MAP,
      LIVE_HASH,
      MAIN,
    );
    expect(r.transformed).toBe(true);
    expect(r.code).toBe('BASE ONLY OUTPUT');
    expect(r.userReport?.planStatus).toBe('output-invalid');
    expect(r.userReport?.mods[0]?.applied).toBe(0);
  });

  it('caps a mod\'s failure rows and appends a truncation marker', () => {
    const bogus = Array.from({ length: 10 }, (_, i) => ({
      op: 'before',
      symbol: `NoSuchSymbol${i}`,
      inject: 'globalThis.__x = 1;',
    }));
    const r = composeTransform(ENGINE, BUNDLE, BASE, [{ modId: 'noisy', patches: bogus }], MAP, LIVE_HASH, MAIN);
    const row = r.userReport?.mods[0];
    expect(row?.declared).toBe(10);
    expect(row?.failed).toHaveLength(9); // 8 capped + 1 truncation marker
    expect(row?.failed[8]?.reason).toBe('truncated');
  });
});

/**
 * #98 — composing against a CHUNK surface.
 *
 * The fixture makes chunk `112` pin the same bytes as main, so these tests isolate
 * one variable at a time: identical input, different surface, different behaviour.
 * That is deliberate — with different bytes, a "chunk did not transform" result
 * could always be explained away as the hash gate doing its job.
 */
describe('composeTransform — chunk surfaces (#98)', () => {
  it('applies a user INLINE-anchored mixin to a chunk (the whole point of #98)', () => {
    const r = composeTransform(
      ENGINE,
      BUNDLE,
      CHUNK.basePatches,
      [{ modId: 'editor-mod', patches: [{ op: 'after', target: HUD_TARGET, inject: 'globalThis.__chunk = 1;' }] }],
      MAP,
      LIVE_HASH,
      CHUNK,
    );
    expect(r.transformed).toBe(true);
    expect(r.code).toContain('__chunk');
    // No bridge patches ran — they anchor in main and are not this surface's base.
    expect(r.code).not.toContain('__base');
    expect(r.userReport?.mods[0]).toEqual({ modId: 'editor-mod', declared: 1, applied: 1, failed: [] });
  });

  it('REFUSES a {symbol} patch on a chunk, with its own reason', () => {
    // 'Car' resolves fine on main. Resolving it here and letting the locator hunt
    // for its literals inside a different file is the silent mis-target the whole
    // mappings system exists to prevent — the anchors were only ever verified
    // against the unpacked MAIN bundle.
    const r = composeTransform(
      ENGINE,
      BUNDLE,
      CHUNK.basePatches,
      [{ modId: 'symbol-mod', patches: [{ op: 'before', symbol: 'Car', inject: 'globalThis.__nope = 1;' }] }],
      MAP,
      LIVE_HASH,
      CHUNK,
    );
    expect(r.code).not.toContain('__nope');
    const row = r.userReport?.mods[0];
    expect(row?.applied).toBe(0);
    // Not 'symbol-unresolved': gating on the chunk's pin instead would read as
    // "stale map" and point the author at entirely the wrong problem.
    expect(row?.failed[0]?.reason).toBe('symbol-not-on-this-surface');
    expect(row?.failed[0]?.detail).toContain('112.bundle.js');
  });

  it('applies the SAME symbol patch when the surface is main', () => {
    // The pair proves the refusal is about the surface, not about the patch.
    const r = composeTransform(
      ENGINE,
      BUNDLE,
      [],
      [{ modId: 'symbol-mod', patches: [{ op: 'before', symbol: 'Car', inject: 'globalThis.__yes = 1;' }] }],
      MAP,
      LIVE_HASH,
      MAIN,
    );
    expect(r.code).toContain('__yes');
    expect(r.userReport?.mods[0]?.applied).toBe(1);
  });

  it('gates a chunk on ITS pin: drifted chunk bytes serve that chunk vanilla', () => {
    const drifted = { ...CHUNK, expectedHash: `sha256:${'9'.repeat(64)}` };
    const r = composeTransform(
      ENGINE,
      BUNDLE,
      drifted.basePatches,
      [{ modId: 'editor-mod', patches: [{ op: 'after', target: HUD_TARGET, inject: 'globalThis.__chunk = 1;' }] }],
      MAP,
      LIVE_HASH,
      drifted,
    );
    expect(r.transformed).toBe(false);
    expect(r.code).toBe(BUNDLE);
    expect(r.detail).toContain('112.bundle.js');
    expect(r.userReport?.planStatus).toBe('base-failed');
  });

  it('stamps the surface filename into the hash-mismatch detail, not "the bundle"', () => {
    // The header is how a chunk served vanilla by a stale pin is told apart from
    // one that was never a surface — both look like an ordinary proxied file.
    const mainMismatch = composeTransform(ENGINE, BUNDLE, BASE, [], MAP, 'sha256:' + '0'.repeat(64), MAIN);
    expect(mainMismatch.detail).toContain('main.bundle.js');
  });
});

/**
 * applyDemoTransform against the REAL pinned map (#98).
 *
 * composeTransform takes its base patches as a parameter, so the tests above can
 * never observe which set the wrapper CHOOSES for a surface — and choosing wrong
 * is silent: feed a chunk the bridge patches and all of them miss, base is
 * all-or-nothing, and the chunk serves vanilla looking exactly like honest drift.
 * These tests pin the choice itself. No fixture can match the real pins, which is
 * fine: the assertions are about which path was taken, not about a hash.
 */
describe('applyDemoTransform — base selection per surface (#98)', () => {
  const src = 'const notTheGame = 1;\n';

  it('serves a declared chunk UNTOUCHED when nothing targets it', async () => {
    const chunk = surfaceForPath(true, ['112.bundle.js']);
    expect(chunk?.kind).toBe('chunk');
    const r = await applyDemoTransform(src, [], chunk!);
    // Untouched, and honestly labelled: parsing and regenerating ~100 KB of minified
    // code to emit identical semantics can only ever be a no-op or a break.
    expect(r.code).toBe(src);
    expect(r.transformed).toBe(false);
    expect(r.detail).toBe('no patches target 112.bundle.js — served unmodified');
  });

  it('does NOT hand a chunk the main bundle base patches', async () => {
    const chunk = surfaceForPath(true, ['112.bundle.js']);
    const r = await applyDemoTransform(src, [], chunk!);
    // The tell: with main's patches the wrapper would run the pass and report the
    // hash gate instead of the no-op. Either way the served bytes are vanilla, which
    // is precisely why this needs asserting rather than eyeballing.
    expect(r.detail).not.toContain('hash-mismatch');
  });

  it('DOES run the pass for the main bundle, and fails closed off the real pin', async () => {
    const r = await applyDemoTransform(src, [], MAIN_SURFACE);
    expect(r.code).toBe(src);
    expect(r.transformed).toBe(false);
    expect(r.detail).toContain('hash-mismatch');
    expect(r.detail).toContain('main.bundle.js');
  });

  it('still runs the pass for a chunk once a user set targets it', async () => {
    const chunk = surfaceForPath(true, ['112.bundle.js']);
    const r = await applyDemoTransform(
      src,
      [{ modId: 'editor-mod', patches: [{ op: 'after', target: HUD_TARGET, inject: 'globalThis.__x = 1;' }] }],
      chunk!,
    );
    // An empty base is not a dead surface — user mixins are the reason chunks became
    // surfaces at all. This one fails the real pin, but it REACHED the gate.
    expect(r.detail).toContain('hash-mismatch');
    expect(r.detail).toContain('112.bundle.js');
    expect(r.userReport?.planStatus).toBe('base-failed');
  });

  it('is a no-op only for surfaces with nothing to do — undeclared chunks never get here', () => {
    expect(surfaceForPath(true, ['999.bundle.js'])).toBeNull();
  });
});
