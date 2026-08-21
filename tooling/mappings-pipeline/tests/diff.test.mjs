// Unit tests for src/diff.mjs — the pure human-review core (CI-runnable, no bundle).
import { describe, expect, it } from 'vitest';
import {
  diffMaps,
  formatDiff,
  assertTargetsCarried,
  assertChunksCarried,
  assertWasmCarried,
} from '../src/diff.mjs';

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

describe('assertChunksCarried (#98)', () => {
  const chunk = (id, hash, role = 'track editor') => ({ id, hash, bytes: 108037, role });
  const CHUNKS = { 112: chunk('112', 'sha256:c112'), 535: chunk('535', 'sha256:c535', 'verifier UI') };

  it('throws when the candidate dropped a chunk the baseline declares', () => {
    const prev = map({ chunks: CHUNKS });
    const next = map({ gameVersion: '0.7.0', chunks: { 112: chunk('112', 'sha256:new112') } });
    expect(() => assertChunksCarried(prev, next)).toThrow(/missing 535/);
  });

  it('throws when the candidate has no chunks section at all (the gen-map silent-drop case)', () => {
    // The failure this guard exists for: gen-map emits a candidate with no `chunks`,
    // everything still validates and passes, and every chunk quietly serves vanilla.
    expect(() => assertChunksCarried(map({ chunks: CHUNKS }), map({ gameVersion: '0.7.0' })))
      .toThrow(/never transformed/);
  });

  it('no-ops when every baseline chunk survives, even re-pinned', () => {
    const prev = map({ chunks: CHUNKS });
    const next = map({
      gameVersion: '0.7.0',
      chunks: { 112: chunk('112', 'sha256:new112'), 535: chunk('535', 'sha256:new535', 'verifier UI') },
    });
    expect(() => assertChunksCarried(prev, next)).not.toThrow();
  });

  it('no-ops when the baseline declared no chunks (pre-#98 maps)', () => {
    expect(() => assertChunksCarried(map({}), map({ gameVersion: '0.7.0' }))).not.toThrow();
  });

  it('accepts a drop only under the explicit allowDrop override', () => {
    // A build really can stop splitting a chunk out. That is indistinguishable here
    // from the silent-drop bug, so it takes a human saying so — never a heuristic.
    const prev = map({ chunks: CHUNKS });
    const next = map({ gameVersion: '0.7.0', chunks: { 112: chunk('112', 'sha256:new112') } });
    expect(() => assertChunksCarried(prev, next, { allowDrop: true })).not.toThrow();
    expect(() => assertChunksCarried(prev, next, { allowDrop: false })).toThrow(/missing 535/);
  });

  it('points a dropped-chunk failure at the override rather than dead-ending', () => {
    const prev = map({ chunks: CHUNKS });
    expect(() => assertChunksCarried(prev, map({ gameVersion: '0.7.0' })))
      .toThrow(/--allow-chunk-drop/);
  });
});

describe('diffMaps — chunk pins (#98)', () => {
  const chunk = (id, hash, bytes = 100, role = 'track editor') => ({ id, hash, bytes, role });
  const byId = (d, id) => d.chunks.find((c) => c.id === id);

  it('classifies added / removed / repinned / unchanged', () => {
    const prev = map({
      chunks: { 112: chunk('112', 'sha256:a'), 535: chunk('535', 'sha256:b'), 604: chunk('604', 'sha256:c') },
    });
    const next = map({
      gameVersion: '0.7.0',
      bundleHash: 'sha256:bbb',
      chunks: { 112: chunk('112', 'sha256:a'), 535: chunk('535', 'sha256:B2', 200), 657: chunk('657', 'sha256:d') },
    });
    const d = diffMaps(prev, next);
    expect(byId(d, '112').kind).toBe('unchanged');
    expect(byId(d, '535').kind).toBe('repinned');
    expect(byId(d, '604').kind).toBe('removed');
    expect(byId(d, '657').kind).toBe('added');
    expect(d.chunks.map((c) => c.id)).toEqual(['112', '535', '604', '657']); // numeric order
  });

  it('reports no chunks when neither map declares any', () => {
    expect(diffMaps(map({}), map({ gameVersion: '0.7.0' })).chunks).toEqual([]);
  });

  it('does not let chunk drift change riskLevel', () => {
    // Deliberate: a re-pin is the NORMAL outcome of a new build. Scoring it as risk
    // would make every regen read HIGH and train reviewers to ignore the field.
    const prev = map({ chunks: { 112: chunk('112', 'sha256:a') } });
    const next = map({ gameVersion: '0.7.0', bundleHash: 'sha256:bbb', chunks: { 112: chunk('112', 'sha256:z') } });
    expect(diffMaps(prev, next).riskLevel).toBe('none');
  });

  it('warns about a pin that did NOT move while the main bundle did', () => {
    // The signature of a regen run without --chunks: gen-map carries the old pins,
    // which can never match the new build's chunk bytes, so the chunk silently
    // never transforms. Indistinguishable from a genuinely identical chunk except
    // by a human, so it is called out rather than scored.
    const prev = map({ chunks: { 112: chunk('112', 'sha256:a') } });
    const next = map({ gameVersion: '0.7.0', bundleHash: 'sha256:bbb', chunks: { 112: chunk('112', 'sha256:a') } });
    const d = diffMaps(prev, next);
    expect(byId(d, '112').note).toMatch(/carried forward without a --chunks fetch/);
    expect(formatDiff(d)).toContain('[UNCHANGED] 112.bundle.js');
  });

  it('stays quiet about an unchanged pin when the main bundle did not change either', () => {
    // Same map twice: nothing was rebuilt, so an identical chunk pin is expected and
    // a warning here would be noise on every no-op regen.
    const a = map({ chunks: { 112: chunk('112', 'sha256:a') } });
    const d = diffMaps(a, a);
    expect(byId(d, '112').note).toBe('pin unchanged');
    expect(formatDiff(d)).not.toContain('[UNCHANGED]');
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

  it('summarises the chunk tally and calls out a DROPPED chunk in the body', () => {
    const c = (id, hash) => ({ id, hash, bytes: 100, role: 'ui' });
    const prev = map({ chunks: { 112: c('112', 'sha256:a'), 604: c('604', 'sha256:c') } });
    const next = map({
      gameVersion: '0.7.0', bundleHash: 'sha256:bbb',
      chunks: { 112: c('112', 'sha256:a2'), 657: c('657', 'sha256:d') },
    });
    const txt = formatDiff(diffMaps(prev, next));
    expect(txt).toContain('chunks     : 2 declared, 1 re-pinned, +1 new, -1 DROPPED');
    expect(txt).toContain('[REMOVED] 604.bundle.js');
    expect(txt).toContain('[ADDED] 657.bundle.js');
  });

  it('omits the chunk section entirely for a map with no chunks', () => {
    const a = map({ modules: { a: mod('1', '10', ['Foo']) } });
    const txt = formatDiff(diffMaps(a, a));
    expect(txt).not.toContain('chunk pins');
    expect(txt).not.toContain('chunks     :');
  });
});

describe('assertWasmCarried (#43)', () => {
  const wasm = (file, hash) => ({ file, hash, bytes: 396005, role: 'physics simulation' });
  const WASM = { 'polytrack_physics.wasm': wasm('polytrack_physics.wasm', 'sha256:d4ef') };

  it('throws when the candidate dropped the physics binary', () => {
    // The guard's whole reason to exist. gen-map carries `wasm` across from the
    // baseline; if that step ever stops running, the candidate still validates, still
    // resolves, still serves a perfectly playable game — with physics patching
    // silently off. Quieter than the chunk case, since regen has no fresh-pin path
    // for the binary that could make the loss visible.
    expect(() => assertWasmCarried(map({ wasm: WASM }), map({ gameVersion: '0.7.0' })))
      .toThrow(/missing polytrack_physics\.wasm/);
  });

  it('explains the consequence, not just the delta', () => {
    expect(() => assertWasmCarried(map({ wasm: WASM }), map({ gameVersion: '0.7.0' })))
      .toThrow(/never patched/);
  });

  it('no-ops when the entry survives, even carrying a stale pin', () => {
    // A stale pin is self-limiting: the portal hashes the live binary and serves
    // vanilla on mismatch. A missing entry is not self-limiting, which is why one is
    // a hard failure and the other is not even a warning here.
    const prev = map({ wasm: WASM });
    const next = map({ gameVersion: '0.7.0', wasm: WASM });
    expect(() => assertWasmCarried(prev, next)).not.toThrow();
  });

  it('no-ops when the baseline declared no wasm (every pre-#43 map)', () => {
    expect(() => assertWasmCarried(map({}), map({ gameVersion: '0.7.0' }))).not.toThrow();
    expect(() => assertWasmCarried(map({}), map({ wasm: WASM }))).not.toThrow();
  });

  it('has no allowDrop escape hatch, unlike the chunk guard', () => {
    // Deliberate asymmetry. A build really can stop splitting a chunk out, so that
    // drop needs a human override. A game does not stop shipping its physics engine
    // between point releases, so there is no legitimate drop to wave through — and an
    // override nobody needs is an override somebody eventually uses to silence this.
    const prev = map({ wasm: WASM });
    const next = map({ gameVersion: '0.7.0' });
    expect(() => assertWasmCarried(prev, next, { allowDrop: true })).toThrow(/missing/);
  });
});
