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

describe('formatVerifications', () => {
  it('summarizes pass/ambiguous/fail and emits a verdict line', () => {
    const txt = formatVerifications([
      { target: 'Car', status: 'pass', modules: ['5220'], literals: 3, minHits: 3, note: 'anchor resolves to module 5220' },
      { target: 'Car.controlCar', status: 'fail', modules: [], literals: 3, minHits: 3, note: 'NOT found' },
    ]);
    expect(txt).toContain('1 pass');
    expect(txt).toContain('1 fail');
    expect(txt).toContain('FAIL');
  });

  it('all-pass => safe-to-carry verdict', () => {
    const txt = formatVerifications([
      { target: 'Car', status: 'pass', modules: ['5220'], literals: 3, minHits: 3, note: '' },
    ]);
    expect(txt).toContain('ALL TARGETS RESOLVE');
  });

  it('0 targets checked => NOT green (the vacuous-gate guard)', () => {
    const txt = formatVerifications([]);
    expect(txt).toContain('0 targets checked');
    expect(txt).not.toContain('ALL TARGETS RESOLVE');
  });
});
