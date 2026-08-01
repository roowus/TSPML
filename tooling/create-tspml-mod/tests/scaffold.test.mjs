import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { modFiles, scaffoldMod, titleFromId } from '../src/scaffold.mjs';

describe('create-tspml-mod — titleFromId', () => {
  it('title-cases a hyphenated id', () => {
    expect(titleFromId('my-cool-mod')).toBe('My Cool Mod');
    expect(titleFromId('speedometer')).toBe('Speedometer');
  });
});

describe('create-tspml-mod — modFiles', () => {
  it('generates a loader-valid manifest + entrypoint + mixin', () => {
    const f = modFiles('speedometer');
    const mod = JSON.parse(f['mod.json']);
    expect(mod.schemaVersion).toBe(1); // required by the loader
    expect(mod.id).toBe('speedometer');
    expect(mod.targets).toEqual(['>=0.6.0 <0.7.0']);
    expect(mod.entrypoint).toBe('entrypoint.js');
    expect(mod.mixins[0].config).toBe('mixins.json');

    const mixins = JSON.parse(f['mixins.json']);
    expect(mixins.patches[0].symbol).toBe('Car'); // mappings-resolved target

    const entry = f['src/entrypoint.ts'];
    expect(entry).toContain("api.events.on('car.control'"); // Tier-1 event
    expect(entry).toContain("'speedometer.toggle'"); // keybind id
  });
});

describe('create-tspml-mod — scaffoldMod (disk)', () => {
  it('writes all files to the target dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tspml-scaffold-'));
    try {
      const created = await scaffoldMod('neon-trails', dir);
      expect(created).toContain('mod.json');
      expect(created).toContain('src/entrypoint.ts');
      const mod = JSON.parse(await readFile(join(dir, 'mod.json'), 'utf8'));
      expect(mod.id).toBe('neon-trails');
      const entry = await readFile(join(dir, 'src/entrypoint.ts'), 'utf8');
      expect(entry).toContain('api.keybinds.register');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an invalid id (dots, caps, empty)', async () => {
    await expect(scaffoldMod('Bad.Id', '/tmp/x')).rejects.toThrow(/Invalid mod id/);
    await expect(scaffoldMod('Caps', '/tmp/x')).rejects.toThrow(/Invalid mod id/);
    await expect(scaffoldMod('', '/tmp/x')).rejects.toThrow(/Invalid mod id/);
  });
});
