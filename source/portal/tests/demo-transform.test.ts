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
import { composeTransform } from '../lib/demo-transform.js';
import type { EngineFns } from '../lib/demo-transform.js';

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
} as unknown as GameMap;

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
    );
    expect(r.transformed).toBe(false);
    expect(r.code).toBe(BUNDLE);
    expect(r.userReport?.planStatus).toBe('base-failed');
  });

  it('returns null userReport on the plain path (no user sets)', () => {
    const r = composeTransform(ENGINE, BUNDLE, BASE, [], MAP, LIVE_HASH);
    expect(r.transformed).toBe(true);
    expect(r.userReport).toBeNull();
  });

  it('retries base-only when the combined output fails the re-parse gate', () => {
    // Stubbed engine: the only deterministic way into this path — it needs an
    // inject that parses standalone but breaks whole-bundle regeneration.
    const applied = (n: number) =>
      Array.from({ length: n }, (_, index) => ({ index, op: 'before', status: 'applied' as const, detail: 'ok' }));
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
    const r = composeTransform(ENGINE, BUNDLE, BASE, [{ modId: 'noisy', patches: bogus }], MAP, LIVE_HASH);
    const row = r.userReport?.mods[0];
    expect(row?.declared).toBe(10);
    expect(row?.failed).toHaveLength(9); // 8 capped + 1 truncation marker
    expect(row?.failed[8]?.reason).toBe('truncated');
  });
});
