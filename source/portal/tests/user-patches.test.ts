// Unit tests for lib/user-patches.ts — the request-carried user-mixin patch
// plan (#62): page-side projection (buildUserPatchPlan), change detection
// (planFingerprint), server-side defensive re-validation (parseUserPatchPlan),
// and the in-bundle report prelude (reportPrelude).
import { describe, expect, it } from 'vitest';
import type { UserModRecord } from '../lib/user-mods.js';
import {
  buildUserPatchPlan,
  parseUserPatchPlan,
  planFingerprint,
  reportPrelude,
  USER_PATCH_LIMITS,
} from '../lib/user-patches.js';
import type { UserMixinReport, UserPatchPlan } from '../lib/user-patches.js';

function record(overrides: Partial<UserModRecord> & { id?: string } = {}): UserModRecord {
  const { id = 'user-mod', ...rest } = overrides;
  return {
    manifest: { schemaVersion: 1, id, name: 'A user mod', version: '1.0.0' },
    code: 'export default (api) => {};',
    enabled: true,
    addedAt: '2026-08-08T00:00:00.000Z',
    ...rest,
  };
}

const PATCH = { op: 'before', symbol: 'Car', inject: 'globalThis.__x = 1;' };

describe('buildUserPatchPlan', () => {
  it('projects enabled mods with pasted mixins, keyed by manifest id', () => {
    const { plan, overCap } = buildUserPatchPlan([
      record({ id: 'with-mixins', mixins: [PATCH] }),
      record({ id: 'no-mixins' }),
      record({ id: 'disabled', mixins: [PATCH], enabled: false }),
      record({ id: 'empty-mixins', mixins: [] }),
      { ...record({ mixins: [PATCH] }), manifest: {} }, // id-less
    ]);
    expect(plan.sets).toEqual([{ modId: 'with-mixins', patches: [PATCH] }]);
    expect(overCap).toEqual([]);
  });

  it('excludes over-cap mods from the plan and returns them in overCap', () => {
    const tooMany = Array.from({ length: USER_PATCH_LIMITS.maxPatchesPerMod + 1 }, () => PATCH);
    const hugeInject = {
      op: 'before',
      symbol: 'Car',
      inject: 'x'.repeat(USER_PATCH_LIMITS.maxInjectChars + 1),
    };
    const { plan, overCap } = buildUserPatchPlan([
      record({ id: 'too-many', mixins: tooMany }),
      record({ id: 'huge-inject', mixins: [hugeInject] }),
      record({ id: 'fine', mixins: [PATCH] }),
    ]);
    expect(plan.sets.map((s) => s.modId)).toEqual(['fine']);
    expect(overCap.sort()).toEqual(['huge-inject', 'too-many']);
  });

  it('keeps the FIRST maxMods sets and flags the rest', () => {
    const mods = Array.from({ length: USER_PATCH_LIMITS.maxMods + 2 }, (_, i) =>
      record({ id: `mod-${String(i).padStart(2, '0')}`, mixins: [PATCH] }),
    );
    const { plan, overCap } = buildUserPatchPlan(mods);
    expect(plan.sets).toHaveLength(USER_PATCH_LIMITS.maxMods);
    expect(plan.sets[0]!.modId).toBe('mod-00');
    expect(overCap.sort()).toEqual([`mod-${USER_PATCH_LIMITS.maxMods}`, `mod-${USER_PATCH_LIMITS.maxMods + 1}`]);
  });
});

describe('planFingerprint', () => {
  it('is stable for the same effective patch set and changes when it changes', () => {
    const a = buildUserPatchPlan([record({ id: 'm', mixins: [PATCH] })]).plan;
    const b = buildUserPatchPlan([record({ id: 'm', mixins: [PATCH] })]).plan;
    const c = buildUserPatchPlan([
      record({ id: 'm', mixins: [{ ...PATCH, inject: 'globalThis.__y = 2;' }] }),
    ]).plan;
    expect(planFingerprint(a)).toBe(planFingerprint(b));
    expect(planFingerprint(a)).not.toBe(planFingerprint(c));
    expect(planFingerprint(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('parseUserPatchPlan', () => {
  const valid: UserPatchPlan = { v: 1, sets: [{ modId: 'm', patches: [PATCH] }] };

  it('accepts a valid plan (round-trip through JSON, as the route sees it)', () => {
    expect(parseUserPatchPlan(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it('rejects wrong shapes wholesale', () => {
    expect(parseUserPatchPlan(null)).toBeNull();
    expect(parseUserPatchPlan([])).toBeNull();
    expect(parseUserPatchPlan({ v: 2, sets: [] })).toBeNull();
    expect(parseUserPatchPlan({ v: 1 })).toBeNull();
    expect(parseUserPatchPlan({ v: 1, sets: {} })).toBeNull();
    expect(parseUserPatchPlan({ v: 1, sets: ['x'] })).toBeNull();
    expect(parseUserPatchPlan({ v: 1, sets: [{ modId: '', patches: [PATCH] }] })).toBeNull();
    expect(parseUserPatchPlan({ v: 1, sets: [{ modId: 'm', patches: [] }] })).toBeNull();
    expect(parseUserPatchPlan({ v: 1, sets: [{ modId: 'm', patches: ['not-object'] }] })).toBeNull();
  });

  it('rejects duplicate modIds (one report row per mod is the contract)', () => {
    expect(
      parseUserPatchPlan({
        v: 1,
        sets: [
          { modId: 'twin', patches: [PATCH] },
          { modId: 'twin', patches: [PATCH] },
        ],
      }),
    ).toBeNull();
  });

  it('re-enforces every cap server-side (the body is attacker-shaped)', () => {
    const sets = Array.from({ length: USER_PATCH_LIMITS.maxMods + 1 }, (_, i) => ({
      modId: `m${i}`,
      patches: [PATCH],
    }));
    expect(parseUserPatchPlan({ v: 1, sets })).toBeNull();
    const tooMany = Array.from({ length: USER_PATCH_LIMITS.maxPatchesPerMod + 1 }, () => PATCH);
    expect(parseUserPatchPlan({ v: 1, sets: [{ modId: 'm', patches: tooMany }] })).toBeNull();
    const huge = { op: 'before', inject: 'x'.repeat(USER_PATCH_LIMITS.maxInjectChars + 1) };
    expect(parseUserPatchPlan({ v: 1, sets: [{ modId: 'm', patches: [huge] }] })).toBeNull();
  });

  it('passes a non-string inject through (the engine reports it honestly)', () => {
    const weird = { op: 'before', inject: 42 };
    expect(parseUserPatchPlan({ v: 1, sets: [{ modId: 'm', patches: [weird] }] })).not.toBeNull();
  });
});

describe('reportPrelude', () => {
  it('emits the report as a window global assignment with </ escaped', () => {
    const report: UserMixinReport = {
      v: 1,
      planStatus: 'applied',
      mods: [{ modId: 'm', declared: 1, applied: 0, failed: [{ reason: 'x', detail: '</script><b>' }] }],
    };
    const prelude = reportPrelude(report);
    expect(prelude.startsWith(';window.__tspmlUserMixins=')).toBe(true);
    expect(prelude).not.toContain('</script>');
    // And it parses back to the same report when evaluated as JS.
    const json = prelude.slice(prelude.indexOf('=') + 1, prelude.lastIndexOf(';'));
    expect(JSON.parse(json)).toEqual(report);
  });
});
