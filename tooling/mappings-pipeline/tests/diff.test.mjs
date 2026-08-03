// Unit tests for src/diff.mjs — the pure human-review core (CI-runnable, no bundle).
import { describe, expect, it } from 'vitest';
import { diffMaps, formatDiff, assertTargetsCarried } from '../src/diff.mjs';

/** Build a minimal valid GameMap. */
const map = (overrides = {}) => ({
  formatVersion: 1,
  gameVersion: '0.6.2',
  bundleHash: 'sha256:aaa',
  generated: { from: '', matcher: '', granularity: '', note: '' },
  modules: {},
  unresolved: [],
  ...overrides,
});

/** Build a module entry. moduleId = new-build webcrack id (relocates); sourceModuleId
 *  = 0.6.0 bootstrap id (stable across versions — the cross-version key). */
const mod = (sourceModuleId, moduleId, stableNames, opts = {}) => ({
  concept: stableNames[0] ?? `Mod ${sourceModuleId}`,
  stableNames,
  subsystem: 'Car/Physics',
  subsystems: ['Car/Physics'],
  moduleId,
  matchWeight: 100,
  sharedAnchors: 5,
  sourceModuleId,
  ...opts,
});

// The real 3 targets share these literals (mirror polytrack-0.6.2.json).
const CAR_TARGET = (selector) => ({
  anchor: { literals: ['CreateCar', 'ControlCar', 'TestDeterminism'], minHits: 3 },
  selector,
});
const TARGETS = {
  Car: CAR_TARGET({ kind: 'factory' }),
  'Car.controlCar': CAR_TARGET({ kind: 'method', name: 'controlCar' }),
  'Car.createCar': CAR_TARGET({ kind: 'method', name: 'createCar' }),
};

describe('diffMaps — no drift', () => {
  it('identical maps => risk none, nothing relocated', () => {
    const a = map({ modules: { car: mod('1223', '5220', ['ControlCar', 'CreateCar']) } });
    const d = diffMaps(a, a);
    expect(d.bundleHashChanged).toBe(false);
    expect(d.modules.matched).toBe(1);
    expect(d.modules.relocated).toHaveLength(0);
    expect(d.stableNames.relocated).toHaveLength(0);
    expect(d.targetImpacts).toHaveLength(0);
    expect(d.riskLevel).toBe('none');
  });

  it('bundleHash changed but module placement identical => none (matcher says nothing moved)', () => {
    const prev = map({ modules: { car: mod('1223', '5220', ['ControlCar']) } });
    const next = map({ gameVersion: '0.7.0', bundleHash: 'sha256:bbb', modules: { car: mod('1223', '5220', ['ControlCar']) } });
    const d = diffMaps(prev, next);
    expect(d.bundleHashChanged).toBe(true);
    expect(d.riskLevel).toBe('none');
  });
});

describe('diffMaps — module relocation', () => {
  it('same sourceModuleId, different moduleId => relocated + risk low', () => {
    const prev = map({ modules: { car: mod('1223', '5220', ['ControlCar']) } });
    const next = map({ gameVersion: '0.7.0', modules: { car2: mod('1223', '4922', ['ControlCar']) } });
    const d = diffMaps(prev, next);
    expect(d.modules.matched).toBe(1);
    expect(d.modules.relocated).toHaveLength(1);
    expect(d.modules.relocated[0]).toMatchObject({ sourceModuleId: '1223', fromModule: '5220', toModule: '4922' });
    expect(d.riskLevel).toBe('low');
  });

  it('keys by sourceModuleId, NOT concept slug (slug drift does not mis-pair)', () => {
    // Same source module, but the scorer picked a different lead name -> different slug.
    const prev = map({ modules: { controlcar: mod('1223', '5220', ['ControlCar']) } });
    const next = map({ modules: { createcar: mod('1223', '5220', ['CreateCar']) } });
    const d = diffMaps(prev, next);
    expect(d.modules.matched).toBe(1); // still paired by sourceModuleId 1223
    expect(d.modules.relocated).toHaveLength(0); // moduleId unchanged
    expect(d.stableNames.added).toContain('createcar');
    expect(d.stableNames.removed).toContain('controlcar');
  });

  it('added / removed modules', () => {
    const prev = map({ modules: { a: mod('1', '10', ['Foo']), b: mod('2', '20', ['Bar']) } });
    const next = map({ gameVersion: '0.7.0', modules: { a: mod('1', '10', ['Foo']), c: mod('3', '30', ['Baz']) } });
    const d = diffMaps(prev, next);
    expect(d.modules.removed.map((m) => m.sourceModuleId)).toEqual(['2']);
    expect(d.modules.added.map((m) => m.sourceModuleId)).toEqual(['3']);
  });
});

describe('diffMaps — stable-name relocation', () => {
  it('a stable name present in both but in a different module is flagged', () => {
    const prev = map({ modules: { a: mod('1', '10', ['Foo']), b: mod('2', '20', ['Bar']) } });
    const next = map({ gameVersion: '0.7.0', modules: { a: mod('1', '10', ['Foo', 'Bar']), b: mod('2', '20', []) } });
    const d = diffMaps(prev, next);
    const r = d.stableNames.relocated.find((s) => s.name === 'bar');
    expect(r).toMatchObject({ name: 'bar', fromModule: '20', toModule: '10' });
    expect(d.riskLevel).toBe('low');
  });
});

describe('diffMaps — target impacts (the critical signal)', () => {
  const prevWithTargets = () => map({
    modules: { car: mod('1223', '5220', ['CreateCar', 'ControlCar', 'TestDeterminism']) },
    targets: TARGETS,
  });

  it('target backing module relocated => high risk', () => {
    const prev = prevWithTargets();
    const next = map({
      gameVersion: '0.7.0',
      modules: { car: mod('1223', '4922', ['CreateCar', 'ControlCar', 'TestDeterminism']) },
      targets: TARGETS,
    });
    const d = diffMaps(prev, next);
    expect(d.targetImpacts.length).toBe(3); // all three Car.* targets share the module
    expect(d.targetImpacts[0]).toMatchObject({ target: 'Car', reason: 'relocated', fromModule: '5220', toModule: '4922' });
    expect(d.riskLevel).toBe('high');
  });

  it('target orphaned (literals no longer map to any module) => high risk', () => {
    const prev = prevWithTargets();
    // Next map's module dropped the literal stable names -> can't correlate.
    const next = map({
      gameVersion: '0.7.0',
      modules: { car: mod('1223', '5220', ['SomethingElse']) },
      targets: TARGETS,
    });
    const d = diffMaps(prev, next);
    expect(d.targetImpacts.length).toBe(3);
    expect(d.targetImpacts[0].reason).toBe('orphaned');
    expect(d.riskLevel).toBe('high');
  });

  it('target backing module became unresolved => high risk', () => {
    const prev = prevWithTargets();
    const next = map({
      gameVersion: '0.7.0',
      modules: {}, // the Car module fell out of `modules` ...
      unresolved: [{ sourceModuleId: '1223', subsystem: 'Car/Physics', subsystems: ['Car/Physics'], reason: 'no confident match' }],
      targets: TARGETS,
    });
    const d = diffMaps(prev, next);
    // prev can correlate (1223 backs the target); next has 1223 unresolved.
    expect(d.targetImpacts.some((t) => t.reason === 'unresolved')).toBe(true);
    expect(d.riskLevel).toBe('high');
  });

  it('a target that stays put is not flagged', () => {
    const prev = prevWithTargets();
    const next = map({
      gameVersion: '0.7.0',
      modules: { car: mod('1223', '5220', ['CreateCar', 'ControlCar', 'TestDeterminism']) },
      targets: TARGETS,
    });
    const d = diffMaps(prev, next);
    expect(d.targetImpacts).toHaveLength(0);
    expect(d.riskLevel).toBe('none');
  });

  it('correlates by MAX OVERLAP, not subset (stableNames need not list every literal)', () => {
    // The committed Car module lists ControlCar + TestDeterminism but NOT CreateCar
    // (the scorer picked other names). The target still correlates to it, so a
    // relocation of that module flags the target.
    const prev = map({
      modules: { car: mod('1223', '5220', ['ControlCar', 'TestDeterminism', 'carStateBuffers']) },
      targets: { 'Car.controlCar': CAR_TARGET({ kind: 'method', name: 'controlCar' }) },
    });
    const next = map({
      gameVersion: '0.7.0',
      modules: { car: mod('1223', '4922', ['ControlCar', 'TestDeterminism', 'carStateBuffers']) },
      targets: { 'Car.controlCar': CAR_TARGET({ kind: 'method', name: 'controlCar' }) },
    });
    const d = diffMaps(prev, next);
    expect(d.targetImpacts).toHaveLength(1);
    expect(d.targetImpacts[0]).toMatchObject({ reason: 'relocated', fromModule: '5220', toModule: '4922' });
    expect(d.riskLevel).toBe('high');
  });
});

describe('diffMaps — confidence + unresolved', () => {
  it('large match-weight drop => confidenceDrops + risk low', () => {
    const prev = map({ modules: { a: mod('1', '10', ['Foo'], { matchWeight: 200 }) } });
    const next = map({ gameVersion: '0.7.0', modules: { a: mod('1', '10', ['Foo'], { matchWeight: 90 }) } });
    const d = diffMaps(prev, next);
    expect(d.confidenceDrops).toHaveLength(1);
    expect(d.confidenceDrops[0].weightDelta).toBe(-110);
    expect(d.riskLevel).toBe('low');
  });

  it('small match-weight change is not a confidence drop', () => {
    const prev = map({ modules: { a: mod('1', '10', ['Foo'], { matchWeight: 200 }) } });
    const next = map({ gameVersion: '0.7.0', modules: { a: mod('1', '10', ['Foo'], { matchWeight: 180 }) } });
    const d = diffMaps(prev, next);
    expect(d.confidenceDrops).toHaveLength(0);
  });

  it('newly resolved / newly unresolved tracking', () => {
    const prev = map({
      modules: { a: mod('1', '10', ['Foo']) },
      unresolved: [{ sourceModuleId: '2', subsystem: 'X', subsystems: ['X'], reason: '' }],
    });
    const next = map({
      gameVersion: '0.7.0',
      modules: { a: mod('1', '10', ['Foo']), b: mod('2', '20', ['Bar']) }, // src 2 now matched
      unresolved: [{ sourceModuleId: '3', subsystem: 'Y', subsystems: ['Y'], reason: '' }],
    });
    const d = diffMaps(prev, next);
    expect(d.unresolved.newlyResolved).toEqual(['2']);
    expect(d.unresolved.newlyUnresolved).toEqual(['3']);
  });
});

describe('diffMaps — confidence-drop threshold (relative only)', () => {
  it('flags exactly a 50% drop (boundary)', () => {
    const prev = map({ modules: { a: mod('1', '10', ['Foo'], { matchWeight: 100 }) } });
    const next = map({ gameVersion: '0.7.0', modules: { a: mod('1', '10', ['Foo'], { matchWeight: 50 }) } });
    expect(diffMaps(prev, next).confidenceDrops).toHaveLength(1);
  });

  it('does not flag a drop just under 50%', () => {
    const prev = map({ modules: { a: mod('1', '10', ['Foo'], { matchWeight: 100 }) } });
    const next = map({ gameVersion: '0.7.0', modules: { a: mod('1', '10', ['Foo'], { matchWeight: 51 }) } });
    expect(diffMaps(prev, next).confidenceDrops).toHaveLength(0);
  });

  it('does not flag a small absolute drop on a heavy module (scale-invariant)', () => {
    // weights span into the thousands; a 40-point drop on a 13k module is noise.
    const prev = map({ modules: { a: mod('1', '10', ['Foo'], { matchWeight: 13959 }) } });
    const next = map({ gameVersion: '0.7.0', modules: { a: mod('1', '10', ['Foo'], { matchWeight: 13919 }) } });
    expect(diffMaps(prev, next).confidenceDrops).toHaveLength(0);
  });
});

describe('assertTargetsCarried', () => {
  it('throws when the candidate lost targets vs the baseline', () => {
    const prev = map({ targets: { Car: CAR_TARGET({ kind: 'factory' }), 'Car.controlCar': CAR_TARGET({ kind: 'method', name: 'controlCar' }) } });
    const next = map({ gameVersion: '0.7.0', targets: { Car: CAR_TARGET({ kind: 'factory' }) } });
    expect(() => assertTargetsCarried(prev, next)).toThrow(/lost targets: baseline has 2, candidate has 1/);
  });

  it('throws when the baseline had targets and the candidate has none (the vacuous-gate case)', () => {
    const prev = map({ targets: { Car: CAR_TARGET({ kind: 'factory' }) } });
    const next = map({ gameVersion: '0.7.0' }); // no targets key
    expect(() => assertTargetsCarried(prev, next)).toThrow(/candidate has 0/);
  });

  it('no-ops when the candidate carries all targets', () => {
    const prev = map({ targets: { Car: CAR_TARGET({ kind: 'factory' }) } });
    const next = map({ gameVersion: '0.7.0', targets: { Car: CAR_TARGET({ kind: 'factory' }) } });
    expect(() => assertTargetsCarried(prev, next)).not.toThrow();
  });

  it('no-ops when the baseline itself had no targets', () => {
    expect(() => assertTargetsCarried(map({}), map({ gameVersion: '0.7.0' }))).not.toThrow();
  });
});

describe('formatDiff', () => {
  it('renders a high-risk report with the target-impact section', () => {
    const prev = map({
      modules: { car: mod('1223', '5220', ['CreateCar', 'ControlCar', 'TestDeterminism']) },
      targets: { Car: CAR_TARGET({ kind: 'factory' }) },
    });
    const next = map({
      gameVersion: '0.7.0',
      modules: { car: mod('1223', '4922', ['CreateCar', 'ControlCar', 'TestDeterminism']) },
      targets: { Car: CAR_TARGET({ kind: 'factory' }) },
    });
    const txt = formatDiff(diffMaps(prev, next));
    expect(txt).toContain('TARGETS AT RISK');
    expect(txt).toContain('HIGH RISK');
    expect(txt).toContain('5220 -> 4922');
  });

  it('renders a no-drift verdict', () => {
    const a = map({ modules: { a: mod('1', '10', ['Foo']) } });
    const txt = formatDiff(diffMaps(a, a));
    expect(txt).toContain('NO DRIFT');
  });
});
