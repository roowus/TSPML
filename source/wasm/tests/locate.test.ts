// Tests for src/locate.ts — the #43 structural-location half.
//
// Synthetic binaries only; see tests/helpers.ts for why.
import { describe, expect, it } from 'vitest';

import {
  f32ConstSites,
  fingerprint,
  fingerprintAll,
  locateBySignature,
  parseFunctions,
  parseSections,
  readULEB,
} from '../src/locate.js';
import { f32const, makeWasm, readF32 } from './helpers.js';

const GRAVITY = -9.81;

/** parseFunctions()[i], asserted present so the tests read without `!` noise. */
function fnAt(buf: Uint8Array, i: number) {
  const fn = parseFunctions(buf)[i];
  if (fn === undefined) throw new Error(`no function at index ${i}`);
  return fn;
}

describe('readULEB', () => {
  it('decodes single- and multi-byte values', () => {
    expect(readULEB(Uint8Array.from([0x00]), 0)).toEqual([0, 1]);
    expect(readULEB(Uint8Array.from([0x7f]), 0)).toEqual([127, 1]);
    expect(readULEB(Uint8Array.from([0x80, 0x01]), 0)).toEqual([128, 2]);
    expect(readULEB(Uint8Array.from([0xe5, 0x8e, 0x26]), 0)).toEqual([624485, 3]);
  });

  it('refuses a truncated or overlong encoding rather than returning junk', () => {
    expect(() => readULEB(Uint8Array.from([0x80]), 0)).toThrow(/truncated/);
    expect(() => readULEB(Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]), 0)).toThrow(
      /too long/,
    );
  });
});

describe('parseSections', () => {
  it('rejects a non-wasm buffer', () => {
    expect(() => parseSections(new TextEncoder().encode('not a wasm file'))).toThrow(
      /bad \\0asm magic/,
    );
  });

  it('rejects a section whose declared size overruns the buffer', () => {
    const bad = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0, 10, 0x7f]);
    expect(() => parseSections(bad)).toThrow(/overruns/);
  });
});

describe('parseFunctions', () => {
  it('splits the code section into bodies that tile it exactly', () => {
    const wasm = makeWasm([[0x01, 0x0b], f32const(1), [...f32const(2), 0x0b]]);
    const fns = parseFunctions(wasm);
    expect(fns.map((f) => f.idx)).toEqual([0, 1, 2]);
    expect(fns.map((f) => f.size)).toEqual([2, 5, 6]);
  });

  it('throws when the bodies do not consume the section exactly', () => {
    // A miscount is the dangerous case: every later offset would be silently wrong.
    const wasm = makeWasm([[0x0b], [0x0b]]);
    wasm[10] = 1; // claim 1 body where 2 are encoded
    expect(() => parseFunctions(wasm)).toThrow(/parse ended at/);
  });
});

describe('fingerprint', () => {
  it('is invariant under relocation — the property the whole approach rests on', () => {
    const body = [...f32const(GRAVITY), 0x0b];
    const a = makeWasm([body]);
    const b = makeWasm([[0x01, 0x01, 0x0b], body]); // same body, later address

    const fa = fnAt(a, 0);
    const fb = fnAt(b, 1);
    expect(fb.start).not.toBe(fa.start); // it really did move
    expect(fingerprint(b, fb)).toBe(fingerprint(a, fa));
  });

  it('changes when a constant changes', () => {
    const a = makeWasm([[...f32const(GRAVITY), 0x0b]]);
    const b = makeWasm([[...f32const(-3.71), 0x0b]]);
    expect(fingerprint(b, fnAt(b, 0))).not.toBe(fingerprint(a, fnAt(a, 0)));
  });

  it('changes when the instruction mix changes but the constants do not', () => {
    const a = makeWasm([[...f32const(GRAVITY), 0x0b]]);
    const b = makeWasm([[0x20, 0x00, 0x94, ...f32const(GRAVITY), 0x0b]]);
    expect(fingerprint(b, fnAt(b, 0))).not.toBe(fingerprint(a, fnAt(a, 0)));
  });
});

describe('locateBySignature', () => {
  it('re-derives a function address after the binary shifts', () => {
    const target = [...f32const(GRAVITY), 0x20, 0x01, 0x94, 0x0b];
    const before = makeWasm([[0x0b], target]);
    const sig = fingerprint(before, fnAt(before, 1));
    const staleOffset = fnAt(before, 1).start;

    // Grow an earlier function: everything after it moves.
    const after = makeWasm([[0x20, 0x00, 0x20, 0x00, 0x20, 0x00, 0x0b], target]);
    const found = locateBySignature(after, sig);

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.fn.start).not.toBe(staleOffset); // a hardcoded offset would be wrong here
    expect(f32ConstSites(after, found.fn, GRAVITY)).toHaveLength(1);
  });

  it('fails closed on an ambiguous match rather than picking the first', () => {
    // Two byte-identical bodies: no signature can tell them apart, and guessing
    // would mean writing a float into a function we did not identify.
    const body = [...f32const(GRAVITY), 0x0b];
    const wasm = makeWasm([body, body]);
    const res = locateBySignature(wasm, fingerprint(wasm, fnAt(wasm, 0)));
    expect(res).toMatchObject({ ok: false, reason: 'ambiguous', count: 2 });
  });

  it('fails closed when the function is gone', () => {
    const gone = makeWasm([[...f32const(GRAVITY), 0x0b]]);
    const sig = fingerprint(gone, fnAt(gone, 0));
    const other = makeWasm([[...f32const(1.5), 0x0b]]);
    expect(locateBySignature(other, sig)).toMatchObject({ ok: false, reason: 'not-found' });
  });
});

describe('f32ConstSites', () => {
  it('points at the payload, not the opcode, so a patcher writes 4 bytes there', () => {
    const wasm = makeWasm([[0x20, 0x00, ...f32const(GRAVITY), 0x0b]]);
    const site = f32ConstSites(wasm, fnAt(wasm, 0), GRAVITY)[0];
    expect(site).toBeDefined();
    expect(wasm[site!.payloadOffset - 1]).toBe(0x43); // opcode sits just before
    expect(readF32(wasm, site!.payloadOffset)).toBeCloseTo(GRAVITY, 5);
  });

  it('matches through float32 rounding of the requested value', () => {
    // The caller passes a JS double; the binary holds a float32. Comparing them
    // naively finds nothing, which would read as "constant not present".
    const wasm = makeWasm([[...f32const(0.02), 0x0b]]);
    expect(f32ConstSites(wasm, fnAt(wasm, 0), 0.02)).toHaveLength(1);
  });

  it('lists every constant when no value is given', () => {
    const wasm = makeWasm([[...f32const(1), ...f32const(2), ...f32const(3), 0x0b]]);
    expect(f32ConstSites(wasm, fnAt(wasm, 0)).map((s) => s.value)).toEqual([1, 2, 3]);
  });
});

describe('fingerprintAll', () => {
  it('reports uniqueness and names the colliding groups', () => {
    const dup = [...f32const(7), 0x0b];
    const wasm = makeWasm([dup, dup, [...f32const(8), 0x0b]]);
    const r = fingerprintAll(wasm);
    expect(r.total).toBe(3);
    expect(r.unique).toBe(1);
    expect(r.collisions).toEqual([[0, 1]]);
  });
});
