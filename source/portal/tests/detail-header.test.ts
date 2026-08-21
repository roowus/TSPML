/**
 * Unit tests for lib/detail-header.ts — the portal's `x-tspml-detail` setter.
 *
 * The transliteration itself is tested in @tspml/shared, including that `Headers.set`
 * and `res.setHeader` genuinely throw on the raw prose. What is portal-specific and
 * tested here: the setter's behaviour on a `Headers`, and — the part that matters —
 * that the REAL details coming out of applyDemoTransform survive the boundary.
 *
 * That last group uses no sample strings on purpose. The production 500 was a detail
 * nobody had written a test for, and a test carrying its own copy of the prose would
 * have passed against the broken code. Driving the real strings through the real
 * setter means a detail added later is covered whether or not its author thought
 * about headers — which is the actual failure mode, since the house prose style uses
 * em-dashes and nothing about writing one suggests it could 500 a response.
 */
import { describe, expect, it } from 'vitest';
import { setDetailHeader } from '../lib/detail-header.js';
import { applyDemoTransform, surfaceForPath, MAIN_SURFACE } from '../lib/demo-transform.js';

describe('setDetailHeader', () => {
  it('sets a header Headers.set accepts, where the raw detail throws', () => {
    const raw = 'no patches target 112.bundle.js — served unmodified';
    expect(() => new Headers().set('x-tspml-detail', raw)).toThrow(TypeError);
    const h = new Headers();
    expect(() => setDetailHeader(h, raw)).not.toThrow();
    expect(h.get('x-tspml-detail')).toBe('no patches target 112.bundle.js - served unmodified');
  });

  it('caps the header value', () => {
    const h = new Headers();
    setDetailHeader(h, 'x'.repeat(500));
    expect(h.get('x-tspml-detail')).toHaveLength(200);
  });

  it('sets nothing at all for an empty detail rather than an empty header', () => {
    const h = new Headers();
    setDetailHeader(h, '');
    expect(h.has('x-tspml-detail')).toBe(false);
  });
});

describe('every real transform detail survives the header boundary (#98 regression)', () => {
  const src = 'const notTheGame = 1;\n';
  const chunk = surfaceForPath(true, ['112.bundle.js']);

  it('the zero-patch chunk detail — the exact string that 500ed production', async () => {
    const r = await applyDemoTransform(src, [], chunk!);
    // The prose is deliberately unchanged; the boundary is the fix.
    expect(r.detail).toContain('—');
    const h = new Headers();
    expect(() => setDetailHeader(h, r.detail)).not.toThrow();
    expect(h.get('x-tspml-detail')).toBe('no patches target 112.bundle.js - served unmodified');
  });

  it('the main-bundle hash-mismatch detail (carries both an em-dash and a ≠)', async () => {
    const r = await applyDemoTransform(src, [], MAIN_SURFACE);
    expect(r.detail).toContain('hash-mismatch');
    const h = new Headers();
    expect(() => setDetailHeader(h, r.detail)).not.toThrow();
    const out = h.get('x-tspml-detail') ?? '';
    expect(out).toContain('!=');
    expect(out).not.toContain('≠');
  });

  it('the chunk hash-mismatch detail, reached through a user set', async () => {
    const r = await applyDemoTransform(
      src,
      [
        {
          modId: 'editor-mod',
          patches: [
            { op: 'after', target: { kind: 'literal', value: 'nope' }, inject: 'globalThis.__x = 1;' },
          ],
        },
      ],
      chunk!,
    );
    const h = new Headers();
    expect(() => setDetailHeader(h, r.detail)).not.toThrow();
  });
});
