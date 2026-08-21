/**
 * Unit tests for lib/detail-header.ts — the `x-tspml-detail` boundary.
 *
 * This exists because of a production 500. `Headers.set` throws a TypeError on any code
 * point above 255, and every transform `detail` is prose containing em-dashes. The
 * throw happens inside the route handler, so the symptom is an empty-bodied 500 on a
 * request that had otherwise fully succeeded — the bundle was fetched, transformed, and
 * ready to serve, and the line describing that is what killed it.
 *
 * It shipped because the one detail with no other way to be reached ("no patches
 * target <file> — served unmodified") requires a surface with NO base patches, and
 * until #98 made chunks surfaces, every proxied surface was main. So the last group of
 * tests here does not use sample strings: it feeds the REAL details out of
 * applyDemoTransform through the REAL header setter. A test with its own copy of the
 * prose would have passed against the broken code too.
 */
import { describe, expect, it } from 'vitest';
import { setDetailHeader, toHeaderAscii } from '../lib/detail-header.js';
import { applyDemoTransform, surfaceForPath, MAIN_SURFACE } from '../lib/demo-transform.js';

describe('toHeaderAscii', () => {
  it('transliterates the punctuation the details actually contain', () => {
    expect(toHeaderAscii('a — b')).toBe('a - b');
    expect(toHeaderAscii('live x ≠ expected y')).toBe('live x != expected y');
    expect(toHeaderAscii('cut…')).toBe('cut...');
    expect(toHeaderAscii('the loader’s hook')).toBe("the loader's hook");
    expect(toHeaderAscii('a “quoted” bit')).toBe('a "quoted" bit');
  });

  it('covers the whole U+2010..U+2015 dash block, not just the em-dash', () => {
    // The bug was one character; fixing exactly one character would leave the en-dash
    // and horizontal bar as the same 500 waiting for the next detail string.
    expect(toHeaderAscii('‐‑‒–—―')).toBe('------');
  });

  it('replaces anything else non-ASCII rather than passing it through', () => {
    expect(toHeaderAscii('emoji \u{1F600} here')).toBe('emoji ?? here');
    expect(toHeaderAscii('café')).toBe('caf?');
  });

  it('strips CR/LF so a detail cannot forge a header break', () => {
    // Header injection: a detail carrying \r\n could otherwise append headers of its
    // own. Details are built from map data and mod-supplied symbol names, so this is
    // not purely theoretical.
    expect(toHeaderAscii('ok\r\nx-injected: 1')).toBe('ok??x-injected: 1');
  });

  it('leaves ordinary ASCII byte-for-byte alone', () => {
    const plain = "symbol 'foo' did not resolve against the pinned map (stale map)";
    expect(toHeaderAscii(plain)).toBe(plain);
  });
});

describe('setDetailHeader', () => {
  it('sets a header Headers.set accepts, where the raw detail throws', () => {
    const raw = 'no patches target 112.bundle.js — served unmodified';
    // The precondition: assert the raw string really is rejected, so this test keeps
    // testing something if a future runtime becomes lenient.
    expect(() => new Headers().set('x-tspml-detail', raw)).toThrow(TypeError);
    const h = new Headers();
    expect(() => setDetailHeader(h, raw)).not.toThrow();
    expect(h.get('x-tspml-detail')).toBe('no patches target 112.bundle.js - served unmodified');
  });

  it('caps at 200 chars', () => {
    const h = new Headers();
    setDetailHeader(h, 'x'.repeat(500));
    expect(h.get('x-tspml-detail')).toHaveLength(200);
  });

  it('caps the OUTPUT, not the input — transliteration expands', () => {
    // Slicing first would cap the wrong string: `…` becomes three characters, so 200
    // ellipses sliced-then-transliterated emit a 600-character header. The cap exists
    // to bound the response head, and a bound that a detail can inflate past is not one.
    const h = new Headers();
    setDetailHeader(h, '…'.repeat(300));
    expect(h.get('x-tspml-detail')).toHaveLength(200);
  });

  it('handles a surrogate pair at the cap boundary without throwing', () => {
    const h = new Headers();
    expect(() => setDetailHeader(h, 'x'.repeat(199) + '\u{1F600}')).not.toThrow();
    expect(h.get('x-tspml-detail')).toHaveLength(200);
  });

  it('sets nothing at all for an empty detail rather than an empty header', () => {
    const h = new Headers();
    setDetailHeader(h, '');
    expect(h.has('x-tspml-detail')).toBe(false);
  });
});

/**
 * The regression gate: real details, real setter, no sample strings.
 *
 * Every branch of applyDemoTransform that produces a detail is driven here and its
 * output pushed through setDetailHeader. If someone adds a detail containing an
 * em-dash — which is the house prose style, so they will — this catches it whether or
 * not they thought about headers.
 */
describe('every real transform detail survives the header boundary (#98 regression)', () => {
  const src = 'const notTheGame = 1;\n';
  const chunk = surfaceForPath(true, ['112.bundle.js']);

  it('the zero-patch chunk detail — the exact string that 500ed production', async () => {
    const r = await applyDemoTransform(src, [], chunk!);
    expect(r.detail).toContain('—'); // the prose is unchanged; the boundary is the fix
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
