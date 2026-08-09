// Unit tests for lib/mixin-env.ts — mixin-descriptor environment gating (#21).
// The portal is a WEB host: a mod.json mixin descriptor declared for
// desktop/worker must not contribute patches here, and the predicate must be
// shared verbatim by demo-mods, the user patch plan, and mixinsSkipped.
import { describe, expect, it } from 'vitest';
import {
  mixinEnvironmentAppliesToHost,
  modMixinsApplyToHost,
  PORTAL_HOST_ENVIRONMENT,
} from '../lib/mixin-env.js';

describe('mixinEnvironmentAppliesToHost', () => {
  it("accepts undefined, '*', and the host's own environment", () => {
    expect(mixinEnvironmentAppliesToHost(undefined)).toBe(true);
    expect(mixinEnvironmentAppliesToHost('*')).toBe(true);
    expect(mixinEnvironmentAppliesToHost('web')).toBe(true);
  });

  it('rejects a different concrete environment', () => {
    expect(mixinEnvironmentAppliesToHost('desktop')).toBe(false);
    expect(mixinEnvironmentAppliesToHost('worker')).toBe(false);
  });

  it('rejects garbage values (the loader rejects the manifest; patches must not ride meanwhile)', () => {
    expect(mixinEnvironmentAppliesToHost(42)).toBe(false);
    expect(mixinEnvironmentAppliesToHost('WEB')).toBe(false);
  });

  it('the portal host constant is web (the resolve context reads the same constant)', () => {
    expect(PORTAL_HOST_ENVIRONMENT).toBe('web');
  });
});

describe('modMixinsApplyToHost', () => {
  it('admits the paste when ANY descriptor applies (one paste box, no per-config attribution)', () => {
    expect(
      modMixinsApplyToHost({
        mixins: [
          { config: 'desktop.json', environment: 'desktop' },
          { config: 'web.json', environment: 'web' },
        ],
      }),
    ).toBe(true);
  });

  it('rejects when every descriptor names another environment', () => {
    expect(
      modMixinsApplyToHost({
        mixins: [
          { config: 'a.json', environment: 'desktop' },
          { config: 'b.json', environment: 'worker' },
        ],
      }),
    ).toBe(false);
  });

  it('an undeclared or empty mixins field gates nothing (the paste is the stated intent)', () => {
    expect(modMixinsApplyToHost({})).toBe(true);
    expect(modMixinsApplyToHost({ mixins: [] })).toBe(true);
    expect(modMixinsApplyToHost({ mixins: 'not-an-array' })).toBe(true);
  });

  it('a descriptor with no environment means anywhere', () => {
    expect(modMixinsApplyToHost({ mixins: [{ config: 'mixins.json' }] })).toBe(true);
  });
});
