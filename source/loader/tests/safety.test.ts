import { describe, expect, it } from 'vitest';

import { classifySafety } from '../src/safety.js';
import type { VersionManifest } from '../src/types.js';

function manifest(o: Partial<VersionManifest> = {}): VersionManifest {
  return {
    schemaVersion: 1,
    id: 'test-mod',
    name: 'Test',
    version: '0.1.0',
    entrypoint: 'entrypoint.js',
    targets: ['>=0.6.0 <0.7.0'],
    ...o,
  };
}

describe('classifySafety (M6 — warn-only)', () => {
  it('a vanilla mod with no declarations is safe (no warnings, no risk)', () => {
    const r = classifySafety(manifest());
    expect(r.vanillaSafe).toBe(true);
    expect(r.leaderboardRisk).toBe('none');
    expect(r.warnings).toEqual([]);
  });

  it("vanillaSafe=false => leaderboard-risk warning + 'warn' risk (but NEVER blocked)", () => {
    const r = classifySafety(manifest({ vanillaSafe: false }));
    expect(r.vanillaSafe).toBe(false);
    expect(r.leaderboardRisk).toBe('warn');
    expect(r.warnings.some((w) => w.kind === 'leaderboard-risk')).toBe(true);
    // Warn-only: there is deliberately no 'block' level.
    expect(r.leaderboardRisk).not.toBe('block');
  });

  it('network capability => network warning + warn risk', () => {
    const r = classifySafety(manifest({ capabilities: ['network'] }));
    expect(r.leaderboardRisk).toBe('warn');
    expect(r.warnings.some((w) => w.kind === 'network')).toBe(true);
  });

  it('a non-network capability is surfaced as a capability warning (no leaderboard risk)', () => {
    const r = classifySafety(manifest({ capabilities: ['dom', 'storage'] }));
    const caps = r.warnings.filter((w) => w.kind === 'capability');
    expect(caps).toHaveLength(2);
    expect(r.leaderboardRisk).toBe('none');
  });

  it('vanillaSafe=true + mixins => unsafe-mixin caveat (verify the label)', () => {
    const r = classifySafety(manifest({ mixins: [{ config: 'mixins.json' }] }));
    expect(r.vanillaSafe).toBe(true);
    expect(r.warnings.some((w) => w.kind === 'unsafe-mixin')).toBe(true);
  });

  it('mixins are fine when vanillaSafe=false (already flagged, no double-warning)', () => {
    const r = classifySafety(manifest({ vanillaSafe: false, mixins: [{ config: 'm.json' }] }));
    expect(r.warnings.some((w) => w.kind === 'unsafe-mixin')).toBe(false);
    expect(r.leaderboardRisk).toBe('warn');
  });
});

describe('classifySafety — physics (#43)', () => {
  it('declaring physics is a leaderboard risk on its own', () => {
    const r = classifySafety(manifest({ physics: 'physics.json' }));
    expect(r.leaderboardRisk).toBe('warn');
    expect(r.warnings.some((w) => w.kind === 'physics')).toBe(true);
  });

  it('the risk does NOT depend on what vanillaSafe claims', () => {
    // Every other signal here is the author's own claim, taken at face value.
    // This one cannot be: rewriting a constant in the compiled physics binary
    // changes how each lap time is produced, whatever the manifest asserts.
    const claimed = classifySafety(manifest({ physics: 'physics.json', vanillaSafe: true }));
    expect(claimed.vanillaSafe).toBe(true);
    expect(claimed.leaderboardRisk).toBe('warn');
  });

  it('says so plainly when a physics mod also claims vanillaSafe=true', () => {
    const w = classifySafety(manifest({ physics: 'physics.json', vanillaSafe: true })).warnings.find(
      (x) => x.kind === 'physics',
    );
    expect(w?.message).toMatch(/cannot be true of a physics patch/);
  });

  it('does not repeat the vanillaSafe caveat when the mod already declares false', () => {
    const w = classifySafety(
      manifest({ physics: 'physics.json', vanillaSafe: false }),
    ).warnings.find((x) => x.kind === 'physics');
    expect(w?.message).not.toMatch(/vanillaSafe=true/);
  });

  it('names the mod and what it does, so the warning stands alone in a list', () => {
    const w = classifySafety(manifest({ physics: 'physics.json' })).warnings.find(
      (x) => x.kind === 'physics',
    );
    expect(w?.message).toMatch(/^test-mod: /);
    expect(w?.message).toMatch(/physics binary/);
  });

  it('is still warn-only — a physics mod is labelled, never blocked', () => {
    const r = classifySafety(manifest({ physics: 'physics.json', capabilities: ['network'] }));
    expect(r.leaderboardRisk).toBe('warn');
    expect(r.leaderboardRisk).not.toBe('block');
  });

  it('no physics field => no physics warning', () => {
    expect(classifySafety(manifest()).warnings.some((w) => w.kind === 'physics')).toBe(false);
  });
});
