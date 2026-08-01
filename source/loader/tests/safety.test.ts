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
