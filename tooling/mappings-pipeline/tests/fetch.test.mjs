// Unit tests for src/fetch.mjs — version validation (the path-traversal guard).
// The network path (fetchBundle/fetchVersion) is local-only and not exercised here.
import { describe, expect, it } from 'vitest';
import { assertVersion } from '../src/fetch.mjs';

describe('assertVersion', () => {
  it('accepts a valid x.y.z version', () => {
    expect(assertVersion('0.6.2')).toBe('0.6.2');
    expect(assertVersion('1.2.3')).toBe('1.2.3');
  });

  it('rejects a traversal-laden version (would escape .cache/)', () => {
    expect(() => assertVersion('0.6.2/../../evil')).toThrow(/invalid version/);
    expect(() => assertVersion('../x')).toThrow(/invalid version/);
  });

  it('rejects non-numeric / malformed versions', () => {
    expect(() => assertVersion('latest')).toThrow(/invalid version/);
    expect(() => assertVersion('0.6')).toThrow(/invalid version/);
    expect(() => assertVersion('')).toThrow(/invalid version/);
    expect(() => assertVersion('0.6.2.4')).toThrow(/invalid version/);
  });
});
