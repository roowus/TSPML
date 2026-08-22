// Tests for src/derive.ts — the #43 authoring half.
//
// Synthetic binaries only (see tests/helpers.ts). The central property is not that
// `findConstant` finds things — it is that its `patchable` verdict AGREES WITH THE
// WRITER. A derive step that says "yes" where `applyF32Patches` says "no" sends the
// author away with a file that fails inside a running game, which is the exact
// failure this module exists to move earlier. So the verdict is asserted against the
// real writer rather than against a restatement of its rules: a copy of the rules
// would keep passing while the two drifted apart.
import { describe, expect, it } from 'vitest';

import { findConstant, toPhysicsJson } from '../src/derive.js';
import { fingerprint, parseFunctions } from '../src/locate.js';
import { applyF32Patches, wasmHash } from '../src/patch.js';
import { f32const, makeWasm, readF32 } from './helpers.js';

const GRIP = Math.fround(1.05);

function fnAt(buf: Uint8Array, i: number) {
  const fn = parseFunctions(buf)[i];
  if (fn === undefined) throw new Error(`no function at index ${i}`);
  return fn;
}

/** One uniquely-fingerprinted function holding GRIP exactly once, plus a decoy that
 *  holds a different constant. The clean case. */
function clean(): Uint8Array {
  return makeWasm([
    [...f32const(2.5), 0x0b],
    [0x20, 0x00, ...f32const(GRIP), 0x94, 0x0b],
  ]);
}

describe('findConstant', () => {
  it('finds the constant and reports the pin a plan needs', () => {
    const wasm = clean();
    const r = findConstant(wasm, GRIP);
    expect(r.candidates).toHaveLength(1);
    // Emitted so the author never pins a hash from a different build than the one
    // they searched — the single easiest way to produce a plan that always refuses.
    expect(r.wasmHash).toBe(wasmHash(wasm));
    expect(r.searched).toBe(GRIP);
  });

  it('reports the signature the writer will accept as a patch target', () => {
    const wasm = clean();
    const c = findConstant(wasm, GRIP).candidates[0];
    expect(c?.signature).toBe(fingerprint(wasm, fnAt(wasm, 1)));
    expect(c?.functionIndex).toBe(1);
  });

  it('matches through Math.fround, because the binary stores f32', () => {
    // The author has a double; the binary has 4 bytes. Comparing raw would answer
    // "not found" for a binary that plainly contains 1.05.
    const r = findConstant(clean(), 1.05);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]?.value).toBe(GRIP);
  });

  it('finds nothing for a value that is not there, without throwing', () => {
    expect(findConstant(clean(), 7.25).candidates).toEqual([]);
  });

  it('treats NaN and Infinity as honest empties', () => {
    // NaN never equals itself and an infinity is not a tuning constant. Neither is
    // an error worth throwing over.
    expect(findConstant(clean(), NaN).candidates).toEqual([]);
    expect(findConstant(clean(), Infinity).candidates).toEqual([]);
  });

  it('reports how many constants the containing function holds', () => {
    // The signal that separates a tuning site from a math kernel.
    const wasm = makeWasm([[...f32const(GRIP), ...f32const(2), ...f32const(3), 0x0b]]);
    expect(findConstant(wasm, GRIP).candidates[0]?.constantsInFunction).toBe(3);
  });

  it('returns every occurrence and ranks none of them', () => {
    // Two DIFFERENT functions both holding the constant. Which one governs grip is a
    // question about the game's physics; nothing here can answer it, so nothing here
    // should pick. Both are reported, in binary order.
    const wasm = makeWasm([
      [0x20, 0x00, ...f32const(GRIP), 0x94, 0x0b],
      [0x20, 0x01, ...f32const(GRIP), 0x95, 0x0b],
    ]);
    const c = findConstant(wasm, GRIP).candidates;
    expect(c).toHaveLength(2);
    expect(c.map((x) => x.functionIndex)).toEqual([0, 1]);
    expect(c.every((x) => x.patchable)).toBe(true);
  });
});

describe('the verdict agrees with the writer', () => {
  /** Ask the REAL writer whether a candidate-shaped patch applies. */
  function writerAccepts(wasm: Uint8Array, sig: string, oldValue: number): boolean {
    return applyF32Patches(wasm, {
      wasmHash: wasmHash(wasm),
      patches: [{ name: 'probe', signature: sig, oldValue, newValue: 2 }],
    }).ok;
  }

  it('patchable=true means the writer accepts it', () => {
    const wasm = clean();
    const c = findConstant(wasm, GRIP).candidates[0];
    expect(c?.patchable).toBe(true);
    expect(writerAccepts(wasm, c?.signature ?? '', c?.value ?? 0)).toBe(true);
  });

  it('a repeated constant is refused HERE, and by the writer too', () => {
    // The clamp idiom: -10 and +10 in one function. `oldValue` cannot say which
    // site is meant, and guessing between them is the corruption to avoid.
    const wasm = makeWasm([[...f32const(GRIP), 0x20, 0x00, ...f32const(GRIP), 0x0b]]);
    const c = findConstant(wasm, GRIP).candidates;
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.verdict === 'repeated-constant')).toBe(true);
    expect(c.every((x) => !x.patchable)).toBe(true);
    expect(writerAccepts(wasm, c[0]?.signature ?? '', GRIP)).toBe(false);
  });

  it('an ambiguous fingerprint is refused HERE, and by the writer too', () => {
    // Two byte-identical functions fingerprint identically, so the signature cannot
    // name either. Structural location has no tiebreaker and must not invent one.
    const body = [0x20, 0x00, ...f32const(GRIP), 0x94, 0x0b];
    const wasm = makeWasm([body, body]);
    const c = findConstant(wasm, GRIP).candidates;
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.verdict === 'ambiguous-function')).toBe(true);
    expect(writerAccepts(wasm, c[0]?.signature ?? '', GRIP)).toBe(false);
  });

  it('reports the signature even when the candidate is unpatchable', () => {
    // Seeing that two candidates share one signature is how 'ambiguous-function'
    // becomes legible rather than mysterious.
    const body = [0x20, 0x00, ...f32const(GRIP), 0x94, 0x0b];
    const c = findConstant(makeWasm([body, body]), GRIP).candidates;
    expect(c[0]?.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(c[0]?.signature).toBe(c[1]?.signature);
  });

  it('names the unreachable gate first when a candidate fails both', () => {
    // Identical functions that ALSO repeat the constant. 'ambiguous-function' is the
    // right report: the function cannot be reached at all, so its repeated constant
    // is not yet the author's problem.
    const body = [...f32const(GRIP), 0x20, 0x00, ...f32const(GRIP), 0x0b];
    const c = findConstant(makeWasm([body, body]), GRIP).candidates;
    expect(c.every((x) => x.verdict === 'ambiguous-function')).toBe(true);
  });
});

describe('toPhysicsJson', () => {
  it('emits a plan the writer applies, end to end', () => {
    // The whole point of the module in one assertion: search a binary by value,
    // emit a file, and have the real writer accept that file against that binary.
    const wasm = clean();
    const found = findConstant(wasm, GRIP);
    const c = found.candidates[0];
    if (c === undefined) throw new Error('no candidate');
    const r = toPhysicsJson(found.wasmHash, 'grip', c, 1.4);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const plan: unknown = JSON.parse(r.json);
    const applied = applyF32Patches(wasm, plan);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.report.applied).toHaveLength(1);
    expect(readF32(applied.bytes, applied.report.applied[0]?.payloadOffset ?? 0)).toBe(
      Math.fround(1.4),
    );
  });

  it('rounds newValue so the file agrees with what the sim will hold', () => {
    const wasm = clean();
    const found = findConstant(wasm, GRIP);
    const c = found.candidates[0];
    if (c === undefined) throw new Error('no candidate');
    const r = toPhysicsJson(found.wasmHash, 'grip', c, 0.1 + 0.2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const parsed = JSON.parse(r.json) as { patches: Array<{ newValue: number }> };
    expect(parsed.patches[0]?.newValue).toBe(Math.fround(0.30000000000000004));
  });

  it('refuses an unpatchable candidate rather than deferring the failure', () => {
    // The refusal is already known here. Emitting the file anyway would only move
    // the error from a command the author is running to a game they are playing.
    const body = [0x20, 0x00, ...f32const(GRIP), 0x94, 0x0b];
    const wasm = makeWasm([body, body]);
    const found = findConstant(wasm, GRIP);
    const c = found.candidates[0];
    if (c === undefined) throw new Error('no candidate');
    const r = toPhysicsJson(found.wasmHash, 'grip', c, 1.4);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/ambiguous-function/);
  });

  it('refuses a non-finite newValue', () => {
    const wasm = clean();
    const found = findConstant(wasm, GRIP);
    const c = found.candidates[0];
    if (c === undefined) throw new Error('no candidate');
    expect(toPhysicsJson(found.wasmHash, 'grip', c, NaN).ok).toBe(false);
    expect(toPhysicsJson(found.wasmHash, 'grip', c, Infinity).ok).toBe(false);
  });

  it('the emitted file is the shape mod.json documents', () => {
    const wasm = clean();
    const found = findConstant(wasm, GRIP);
    const c = found.candidates[0];
    if (c === undefined) throw new Error('no candidate');
    const r = toPhysicsJson(found.wasmHash, 'grip', c, 1.4);
    if (!r.ok) throw new Error('expected ok');
    const parsed = JSON.parse(r.json) as {
      wasmHash: string;
      patches: Array<{ name: string; signature: string; oldValue: number; newValue: number }>;
    };
    // Bare hex, no `sha256:` prefix — the portal's plan validator compares this
    // byte-for-byte against wasmHash() output, and a prefix fails every plan.
    expect(parsed.wasmHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.patches[0]?.name).toBe('grip');
    expect(parsed.patches[0]?.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.patches[0]?.oldValue).toBe(GRIP);
  });
});
