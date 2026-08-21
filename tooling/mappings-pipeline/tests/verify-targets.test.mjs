// Unit tests for src/verify-targets.mjs — the carried-forward anchor gate (CI-runnable).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadModuleSources, modulesContaining, verifyTargets, formatVerifications } from '../src/verify-targets.mjs';

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tspml-verify-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const writeMod = async (moduleId, code) => writeFile(join(dir, `${moduleId}.js`), code);

const target = (literals, minHits, selector = { kind: 'method', name: 'controlCar' }) => ({
  anchor: { literals, minHits }, selector,
});

describe('loadModuleSources', () => {
  it('loads each <moduleId>.js keyed by stem, skipping the aggregate', async () => {
    await writeMod('5220', 'var ControlCar = 1, CreateCar = 2, TestDeterminism = 3;');
    await writeMod('4922', 'var Other = 1;');
    // aggregate sinks that must be skipped (mirror match.mjs isAggregate)
    await writeFile(join(dir, 'deobfuscated.js'), 'x'.repeat(50));
    const big = 'y'.repeat(1_000_001);
    await writeFile(join(dir, '9999.js'), big);
    const src = await loadModuleSources(dir);
    expect([...src.keys()].sort()).toEqual(['4922', '5220']);
  });
});

describe('modulesContaining', () => {
  beforeEach(async () => {
    await writeMod('5220', 'function CreateCar(){} function ControlCar(){} const TestDeterminism=1');
    await writeMod('4922', 'function CreateCar(){}'); // partial
    await writeMod('10', 'unrelated code');
  });

  it('returns the module(s) containing ALL literals', async () => {
    const src = await loadModuleSources(dir);
    expect(modulesContaining(src, ['CreateCar', 'ControlCar', 'TestDeterminism'], 3)).toEqual(['5220']);
  });

  it('respects a lower minHits (partial matches count)', async () => {
    const src = await loadModuleSources(dir);
    expect(modulesContaining(src, ['CreateCar', 'ControlCar', 'TestDeterminism'], 1).sort()).toEqual(['4922', '5220']);
  });

  it('returns nothing when no module meets minHits', async () => {
    const src = await loadModuleSources(dir);
    expect(modulesContaining(src, ['NoSuchSymbol'], 1)).toEqual([]);
  });
});

describe('verifyTargets', () => {
  it('PASS when exactly one module contains the anchor', async () => {
    await writeMod('5220', 'CreateCar ControlCar TestDeterminism');
    const src = await loadModuleSources(dir);
    const v = verifyTargets(
      { targets: { 'Car.controlCar': target(['CreateCar', 'ControlCar', 'TestDeterminism'], 3) } },
      src,
    );
    expect(v).toHaveLength(1);
    expect(v[0].status).toBe('pass');
    expect(v[0].modules).toEqual(['5220']);
  });

  it('AMBIGUOUS when the anchor appears in multiple modules', async () => {
    await writeMod('5220', 'CreateCar ControlCar TestDeterminism');
    await writeMod('4922', 'CreateCar ControlCar TestDeterminism'); // duplicated
    const src = await loadModuleSources(dir);
    const v = verifyTargets({ targets: { Car: target(['CreateCar', 'ControlCar', 'TestDeterminism'], 3, { kind: 'factory' }) } }, src);
    expect(v[0].status).toBe('ambiguous');
    expect(v[0].modules).toHaveLength(2);
  });

  it('FAIL when no module contains the anchor (drifted target)', async () => {
    await writeMod('5220', 'completely different literals');
    const src = await loadModuleSources(dir);
    const v = verifyTargets({ targets: { Car: target(['CreateCar', 'ControlCar', 'TestDeterminism'], 3, { kind: 'factory' }) } }, src);
    expect(v[0].status).toBe('fail');
    expect(v[0].modules).toEqual([]);
  });

  it('handles a map with no targets gracefully', async () => {
    const src = await loadModuleSources(dir);
    expect(verifyTargets({}, src)).toEqual([]);
  });
});

describe('verifyTargets — per-surface routing (#98)', () => {
  /** Two surfaces whose modules deliberately share a moduleId AND a literal, which is
   *  what makes routing observable: only the surface decides which one answers. */
  const mainSources = () => new Map([
    ['5220', 'CreateCar ControlCar TestDeterminism'],
    ['100', 'shared literal Part index out of bounds'],
  ]);
  const chunkSources = () => new Map([
    ['100', 'How to use the editor / Part index out of bounds'],
  ]);
  const EDITOR = {
    anchor: { literals: ['How to use the editor'], minHits: 1 },
    selector: { kind: 'method', name: 'draw' },
    surface: '112.bundle.js',
  };

  it('checks a chunk-scoped target against ITS chunk, not main', async () => {
    const v = verifyTargets(
      { targets: { Editor: EDITOR } },
      new Map([['main.bundle.js', mainSources()], ['112.bundle.js', chunkSources()]]),
    );
    expect(v[0]).toMatchObject({ status: 'pass', surface: '112.bundle.js', modules: ['100'] });
    expect(v[0].note).toContain('112.bundle.js');
  });

  it('does not let a main-surface hit answer for a chunk-scoped target', async () => {
    // 'Part index out of bounds' exists in BOTH surfaces here. If routing were
    // ignored, main's module 100 would satisfy the chunk target and report a pass
    // for a file that was never checked — the exact silent mis-verify #98 is about.
    const spec = { ...EDITOR, anchor: { literals: ['Part index out of bounds'], minHits: 1 } };
    const v = verifyTargets(
      { targets: { Editor: spec } },
      new Map([['main.bundle.js', mainSources()], ['112.bundle.js', new Map([['7', 'nothing relevant']])]]),
    );
    expect(v[0].status).toBe('fail');
    expect(v[0].surface).toBe('112.bundle.js');
  });

  it('SKIPS (never passes) a target whose surface was not supplied', async () => {
    const v = verifyTargets(
      { targets: { Editor: EDITOR } },
      new Map([['main.bundle.js', mainSources()]]),
    );
    expect(v[0].status).toBe('skipped');
    expect(v[0].modules).toEqual([]);
    expect(v[0].note).toMatch(/no unpacked sources supplied for 112\.bundle\.js/);
  });

  it('routes a surface-less target to main (every pre-#98 target keeps its meaning)', async () => {
    const v = verifyTargets(
      { targets: { Car: target(['CreateCar', 'ControlCar', 'TestDeterminism'], 3) } },
      new Map([['main.bundle.js', mainSources()], ['112.bundle.js', chunkSources()]]),
    );
    expect(v[0]).toMatchObject({ status: 'pass', surface: 'main.bundle.js', modules: ['5220'] });
  });

  it('accepts the flat pre-#98 sources Map as "all targets are main-scoped"', async () => {
    // Backward compatibility is load-bearing: --verify with a single dir, and any
    // caller written before #98, still mean exactly what they used to.
    const v = verifyTargets(
      { targets: { Car: target(['CreateCar', 'ControlCar', 'TestDeterminism'], 3) } },
      mainSources(),
    );
    expect(v[0]).toMatchObject({ status: 'pass', surface: 'main.bundle.js' });
  });

  it('refuses a sources argument that mixes the two shapes', async () => {
    // Guessing would mean routing some targets to a dir chosen by accident.
    expect(() =>
      verifyTargets({ targets: {} }, new Map([['main.bundle.js', mainSources()], ['5220', 'raw text']])),
    ).toThrow(/mixes module text with per-surface maps/);
  });

  it('reports each target with the surface it was checked against', async () => {
    const v = verifyTargets(
      { targets: { Car: target(['CreateCar'], 1), Editor: EDITOR } },
      new Map([['main.bundle.js', mainSources()], ['112.bundle.js', chunkSources()]]),
    );
    expect(v.map((x) => x.surface)).toEqual(['main.bundle.js', '112.bundle.js']);
  });
});

describe('formatVerifications', () => {
  it('summarizes pass/ambiguous/fail and emits a verdict line', () => {
    const txt = formatVerifications([
      { target: 'Car', status: 'pass', surface: 'main.bundle.js', modules: ['5220'], literals: 3, minHits: 3, note: 'anchor resolves to module 5220' },
      { target: 'Car.controlCar', status: 'fail', surface: 'main.bundle.js', modules: [], literals: 3, minHits: 3, note: 'NOT found' },
    ]);
    expect(txt).toContain('1 pass');
    expect(txt).toContain('1 fail');
    expect(txt).toContain('FAIL');
  });

  it('all-pass => safe-to-carry verdict', () => {
    const txt = formatVerifications([
      { target: 'Car', status: 'pass', surface: 'main.bundle.js', modules: ['5220'], literals: 3, minHits: 3, note: '' },
    ]);
    expect(txt).toContain('ALL TARGETS RESOLVE');
  });

  it('a SKIPPED target blocks the green verdict (#98)', () => {
    // The failure mode this exists for: everything that WAS checked passed, so a
    // pass-only verdict would read as full coverage of a map it never fully checked.
    const txt = formatVerifications([
      { target: 'Car', status: 'pass', surface: 'main.bundle.js', modules: ['5220'], literals: 3, minHits: 3, note: '' },
      { target: 'Editor', status: 'skipped', surface: '112.bundle.js', modules: [], literals: 1, minHits: 1, note: 'no unpacked sources' },
    ]);
    expect(txt).not.toContain('ALL TARGETS RESOLVE');
    expect(txt).toContain('1 SKIPPED');
    expect(txt).toContain('INCOMPLETE');
    expect(txt).toContain('112.bundle.js');
  });

  it('names the surface on every line, not just failures', () => {
    // Without this a wholesale mis-route renders as an ordinary green list.
    const txt = formatVerifications([
      { target: 'Editor', status: 'pass', surface: '112.bundle.js', modules: ['100'], literals: 1, minHits: 1, note: '' },
    ]);
    expect(txt).toContain('Editor [112.bundle.js]');
  });

  it('0 targets checked => NOT green (the vacuous-gate guard)', () => {
    const txt = formatVerifications([]);
    expect(txt).toContain('0 targets checked');
    expect(txt).not.toContain('ALL TARGETS RESOLVE');
  });
});
