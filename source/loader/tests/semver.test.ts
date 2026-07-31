import { describe, expect, it } from 'vitest';
import {
  isValidRange,
  isValidVersion,
  maxSatisfying,
  minVersion,
  satisfies,
} from '../src/index.js';

describe('semver wrapper', () => {
  describe('satisfies', () => {
    it('handles caret ranges', () => {
      expect(satisfies('1.2.3', '^1.0.0')).toBe(true);
      expect(satisfies('2.0.0', '^1.0.0')).toBe(false);
    });

    it('handles tilde ranges', () => {
      expect(satisfies('1.2.9', '~1.2.0')).toBe(true);
      expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
    });

    it('handles OR ranges', () => {
      expect(satisfies('1.0.0', '^1.0.0 || ^2.0.0')).toBe(true);
      expect(satisfies('2.5.0', '^1.0.0 || ^2.0.0')).toBe(true);
      expect(satisfies('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false);
    });

    it('handles hyphen and comparator ranges', () => {
      expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
      expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    });

    it('handles wildcard', () => {
      expect(satisfies('1.0.0', '*')).toBe(true);
      expect(satisfies('99.99.99', '*')).toBe(true);
    });
  });

  it('maxSatisfying picks the highest matching version', () => {
    expect(maxSatisfying(['1.0.0', '1.2.0', '2.0.0'], '^1.0.0')).toBe('1.2.0');
    expect(maxSatisfying(['1.0.0', '2.0.0'], '^3.0.0')).toBeNull();
  });

  it('minVersion gives the lowest possible version of a range', () => {
    expect(minVersion('^1.2.0')).toBe('1.2.0');
    expect(minVersion('>=1.5.0 <2.0.0')).toBe('1.5.0');
  });

  it('isValidRange / isValidVersion', () => {
    expect(isValidRange('^1.0.0')).toBe(true);
    expect(isValidRange('*')).toBe(true);
    expect(isValidRange('not a range')).toBe(false);
    expect(isValidVersion('1.2.3')).toBe(true);
    expect(isValidVersion('^1.2.3')).toBe(false);
  });
});
