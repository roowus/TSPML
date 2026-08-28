// Unit tests for lib/user-patches.ts — the request-carried user-mixin patch
// plan (#62): page-side projection (buildUserPatchPlan), change detection
// (planFingerprint), server-side defensive re-validation (parseUserPatchPlan),
// and the in-bundle report prelude (reportPrelude).
import { describe, expect, it } from 'vitest';
import type { UserModRecord } from '../lib/user-mods.js';
import {
  buildUserPatchPlan,
  CHUNK_REPORT_EVENT,
  modAppliedOn,
  parseUserPatchPlan,
  planFingerprint,
  REPORT_GLOBAL,
  reportPrelude,
  surfaceReports,
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

  it('projects a PML mod from its COLLECTED splice specs, one set per mod', () => {
    // A PML mod has no pasted mixins.json; its plan content is the specs the
    // shim collected at runtime and the page persisted. One set per mod holds
    // for the mixed case too — the caps and the report are per mod, not per
    // patch kind.
    const splice = {
      op: 'pml-splice',
      type: 'INSERT',
      token: 'e.car.setCarState(t, !1)',
      func: '(x)',
    };
    const { plan } = buildUserPatchPlan([
      record({ id: 'pml-only', format: 'pml', pmlMixins: [splice] }),
      record({ id: 'pml-both', format: 'pml', mixins: [PATCH], pmlMixins: [splice] }),
    ]);
    expect(plan.sets).toEqual([
      { modId: 'pml-only', patches: [splice] },
      { modId: 'pml-both', patches: [PATCH, splice] },
    ]);
  });

  it('caps a PML splice by its func exactly as an inject is capped', () => {
    // The payload field differs but the exposure is the same: the func is
    // spliced into the served bundle, so its size is bounded at ADD time.
    const big = {
      op: 'pml-splice',
      type: 'INSERT',
      token: 'x',
      func: 'y'.repeat(USER_PATCH_LIMITS.maxInjectChars + 1),
    };
    const { plan, overCap } = buildUserPatchPlan([record({ id: 'big', format: 'pml', pmlMixins: [big] })]);
    expect(plan.sets).toEqual([]);
    expect(overCap).toEqual(['big']);
    // And the server-side re-validation refuses it too, by the same field.
    const parsed = parseUserPatchPlan({ v: 1, sets: [{ modId: 'big', patches: [big] }] });
    expect(parsed).toBeNull();
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

  it('excludes mods whose declared mixins are all for another environment, reported in envSkipped (#21)', () => {
    const desktopOnly = record({ id: 'desktop-mixins', mixins: [PATCH] });
    (desktopOnly.manifest as Record<string, unknown>).mixins = [
      { config: 'mixins.json', environment: 'desktop' },
    ];
    const webToo = record({ id: 'web-mixins', mixins: [PATCH] });
    (webToo.manifest as Record<string, unknown>).mixins = [
      { config: 'desktop.json', environment: 'desktop' },
      { config: 'web.json', environment: 'web' },
    ];
    const undeclared = record({ id: 'undeclared', mixins: [PATCH] }); // no manifest mixins field
    const { plan, overCap, envSkipped } = buildUserPatchPlan([desktopOnly, webToo, undeclared]);
    expect(plan.sets.map((s) => s.modId)).toEqual(['web-mixins', 'undeclared']);
    expect(envSkipped).toEqual(['desktop-mixins']);
    expect(overCap).toEqual([]);
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

  it('treats an explicit main surface exactly like an absent one', () => {
    const report: UserMixinReport = { v: 1, planStatus: 'applied', mods: [], surface: 'main.bundle.js' };
    expect(reportPrelude(report).startsWith(';window.__tspmlUserMixins=')).toBe(true);
  });
});

/**
 * The CHUNK prelude (#98) is RUN, not string-matched.
 *
 * It is the one piece of this feature that ships as generated source executed inside
 * the game frame, and every property that matters is a runtime one: does it merge or
 * clobber, does it fire, does it survive arriving first. A `toContain` on the emitted
 * text would pass on code that throws the moment the game evaluates it — and a throw
 * there lands inside the game's own script, not ours.
 */
function runPrelude(win: Record<string, unknown>, code: string): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- executing the
  // generated prelude is the entire point; the input is our own serializer's output.
  new Function('window', 'CustomEvent', code)(win, CustomEvent);
}

/** A window stand-in with just the two things the prelude touches. */
function fakeWindow(): Record<string, unknown> & EventTarget {
  const target = new EventTarget();
  return Object.assign(target, {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  }) as Record<string, unknown> & EventTarget;
}

const mainReport: UserMixinReport = {
  v: 1,
  planStatus: 'applied',
  surface: 'main.bundle.js',
  mods: [{ modId: 'editor-mod', declared: 1, applied: 0, failed: [{ reason: 'not-found', detail: 'no match' }] }],
};
const chunkReport: UserMixinReport = {
  v: 1,
  planStatus: 'applied',
  surface: '112.bundle.js',
  mods: [{ modId: 'editor-mod', declared: 1, applied: 1, failed: [] }],
};

describe('reportPrelude — chunk surfaces (#98)', () => {
  it('MERGES into the main report instead of replacing it', () => {
    const w = fakeWindow();
    runPrelude(w, reportPrelude(mainReport));
    runPrelude(w, reportPrelude(chunkReport));
    const merged = w[REPORT_GLOBAL] as UserMixinReport;
    // The clobber is the failure this guards: a plain assignment would blank every
    // row the mixin panel is already showing, mid-session, with nothing logged.
    expect(merged.mods).toEqual(mainReport.mods);
    expect(merged.surface).toBe('main.bundle.js');
    expect(merged.chunks?.['112.bundle.js']).toEqual(chunkReport);
  });

  it('dispatches the chunk event so a listener that missed iframe load still hears it', () => {
    const w = fakeWindow();
    runPrelude(w, reportPrelude(mainReport));
    const seen: UserMixinReport[] = [];
    w.addEventListener(CHUNK_REPORT_EVENT, (e) => {
      seen.push((e as CustomEvent<UserMixinReport>).detail);
    });
    runPrelude(w, reportPrelude(chunkReport));
    // Without this signal the rows exist in the frame and never reach the UI: the
    // page reads the global on iframe `load`, which fired long before the chunk ran.
    expect(seen).toEqual([chunkReport]);
  });

  it('creates the container when a chunk somehow runs FIRST', () => {
    // Transform off for main, or a load order nobody predicted. Throwing here would
    // throw inside the game's own script.
    const w = fakeWindow();
    expect(() => runPrelude(w, reportPrelude(chunkReport))).not.toThrow();
    const merged = w[REPORT_GLOBAL] as UserMixinReport;
    expect(merged.mods).toEqual([]);
    expect(merged.chunks?.['112.bundle.js']).toEqual(chunkReport);
  });

  it('survives a non-object sitting on the global', () => {
    const w = fakeWindow();
    w[REPORT_GLOBAL] = 'not a report';
    expect(() => runPrelude(w, reportPrelude(chunkReport))).not.toThrow();
    expect((w[REPORT_GLOBAL] as UserMixinReport).chunks?.['112.bundle.js']).toEqual(chunkReport);
  });

  it('accumulates several chunks without any of them evicting another', () => {
    const w = fakeWindow();
    runPrelude(w, reportPrelude(mainReport));
    runPrelude(w, reportPrelude(chunkReport));
    runPrelude(w, reportPrelude({ ...chunkReport, surface: '535.bundle.js' }));
    const merged = w[REPORT_GLOBAL] as UserMixinReport;
    expect(Object.keys(merged.chunks ?? {})).toEqual(['112.bundle.js', '535.bundle.js']);
  });

  it('escapes </ in a chunk prelude too', () => {
    const nasty: UserMixinReport = {
      ...chunkReport,
      mods: [{ modId: 'm', declared: 1, applied: 0, failed: [{ reason: 'x', detail: '</script><b>' }] }],
    };
    expect(reportPrelude(nasty)).not.toContain('</script>');
  });
});

describe('surfaceReports / modAppliedOn — per-file display (#98)', () => {
  const merged: UserMixinReport = { ...mainReport, chunks: { '112.bundle.js': chunkReport } };

  it('lists main first, then chunks', () => {
    expect(surfaceReports(merged).map((s) => s.file)).toEqual(['main.bundle.js', '112.bundle.js']);
  });

  it('defaults a surface-less (pre-#98) report to the main bundle', () => {
    const legacy: UserMixinReport = { v: 1, planStatus: 'applied', mods: [] };
    expect(surfaceReports(legacy).map((s) => s.file)).toEqual(['main.bundle.js']);
  });

  it('orders chunks NUMERICALLY, not lexicographically', () => {
    // '1120' before '535' is what a string sort produces, and it reads as a bug in
    // a panel listing files the player can see the game load in the other order.
    const many: UserMixinReport = {
      ...mainReport,
      chunks: {
        '1120.bundle.js': chunkReport,
        '535.bundle.js': chunkReport,
        '112.bundle.js': chunkReport,
      },
    };
    expect(surfaceReports(many).map((s) => s.file)).toEqual([
      'main.bundle.js',
      '112.bundle.js',
      '535.bundle.js',
      '1120.bundle.js',
    ]);
  });

  it('reports where a mod applied when it shows 0 on this surface', () => {
    const all = surfaceReports(merged);
    // The plan carries every mod's patches to every surface, so a mixin anchored in
    // the editor chunk legitimately reads 0/1 on main. Naming the file it DID apply
    // to is the difference between "your mixin is broken" and "your mixin is fine".
    expect(modAppliedOn(all, 'editor-mod', 'main.bundle.js')).toEqual(['112.bundle.js']);
  });

  it('never names the surface being displayed', () => {
    const all = surfaceReports(merged);
    expect(modAppliedOn(all, 'editor-mod', '112.bundle.js')).toEqual([]);
  });

  it('says nothing for a mod that applied nowhere', () => {
    const all = surfaceReports(merged);
    expect(modAppliedOn(all, 'no-such-mod', 'main.bundle.js')).toEqual([]);
  });
});
