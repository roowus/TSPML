// Tests for src/patch.ts — the #43 writer half.
//
// Synthetic binaries only (see tests/helpers.ts). What these pin is the
// fail-closed contract: hash gate, unique location, unique site, finite values,
// all-or-nothing application.
import { describe, expect, it } from 'vitest';

import { fingerprint, parseFunctions } from '../src/locate.js';
import { applyF32Patches, checkPlan, wasmHash } from '../src/patch.js';
import type { WasmPatch, WasmPatchPlan } from '../src/patch.js';
import { f32const, makeWasm, readF32, sameBytes } from './helpers.js';

const GRAVITY = Math.fround(-9.81);

function fnAt(buf: Uint8Array, i: number) {
  const fn = parseFunctions(buf)[i];
  if (fn === undefined) throw new Error(`no function at index ${i}`);
  return fn;
}

/** A binary with a distinctive "gravity function" plus a decoy, and a valid plan. */
function fixture(): { wasm: Uint8Array; sig: string; plan: WasmPatchPlan; patch: WasmPatch } {
  const gravityBody = [0x20, 0x00, ...f32const(GRAVITY), 0x94, 0x0b];
  const decoyBody = [...f32const(1.5), 0x0b];
  const wasm = makeWasm([decoyBody, gravityBody]);
  const sig = fingerprint(wasm, fnAt(wasm, 1));
  const patch: WasmPatch = {
    name: 'gravity',
    signature: sig,
    oldValue: GRAVITY,
    newValue: -3.71,
  };
  return { wasm, sig, plan: { wasmHash: wasmHash(wasm), patches: [patch] }, patch };
}

describe('checkPlan', () => {
  it('accepts the fixture plan', () => {
    expect(checkPlan(fixture().plan)).toBeNull();
  });

  it('names what is wrong: shape, hash, empty patches, bad values', () => {
    expect(checkPlan(null)).toMatch(/not an object/);
    expect(checkPlan({ wasmHash: 'nope', patches: [{}] })).toMatch(/wasmHash/);
    const { plan, patch } = fixture();
    expect(checkPlan({ ...plan, patches: [] })).toMatch(/non-empty/);
    expect(checkPlan({ ...plan, patches: [{ ...patch, name: '' }] })).toMatch(/no name/);
    expect(checkPlan({ ...plan, patches: [{ ...patch, signature: 'xyz' }] })).toMatch(/signature/);
    expect(checkPlan({ ...plan, patches: [{ ...patch, newValue: NaN }] })).toMatch(/newValue/);
    expect(checkPlan({ ...plan, patches: [{ ...patch, oldValue: Infinity }] })).toMatch(/oldValue/);
  });

  it('refuses a plan that is not even the right kind of thing', () => {
    // The plan arrives in a request body since #43's runtime path, so "attacker
    // shaped" is a real input class, not just "the tooling is broken".
    expect(checkPlan('a string')).toMatch(/not an object/);
    expect(checkPlan([])).toMatch(/wasmHash/);
    expect(checkPlan({ wasmHash: 'a'.repeat(64) })).toMatch(/non-empty/);
  });
});

describe('applyF32Patches', () => {
  it('patches the constant, leaves the input untouched, and reports warn-only risk', () => {
    const { wasm, plan } = fixture();
    const before = new Uint8Array(wasm);
    const r = applyF32Patches(wasm, plan);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sameBytes(wasm, before)).toBe(true); // never mutates the input
    expect(r.bytes.length).toBe(wasm.length);
    expect(r.report.applied).toHaveLength(1);
    expect(readF32(r.bytes, r.report.applied[0]?.payloadOffset ?? -1)).toBeCloseTo(-3.71, 5);
    expect(r.report.leaderboardRisk).toBe('warn'); // physics = ranked-play-relevant, always
    expect(r.report.patchedHash).not.toBe(r.report.wasmHash);
  });

  it('refuses a binary whose hash does not match the plan pin', () => {
    const { wasm, plan } = fixture();
    const other = new Uint8Array(wasm);
    const last = other.length - 1;
    other[last] = (other[last] ?? 0) ^ 0xff; // any byte difference
    const r = applyF32Patches(other, plan);
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.reason).toMatch(/wasm-hash-mismatch/);
  });

  it('refuses when the signature matches zero or multiple functions', () => {
    const { wasm, plan, patch } = fixture();
    const gone = { ...plan, patches: [{ ...patch, signature: '0'.repeat(64) }] };
    const r1 = applyF32Patches(wasm, gone);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toMatch(/not-found/);

    // Two byte-identical gravity functions: locate must refuse, so apply must too.
    const body = [0x20, 0x00, ...f32const(GRAVITY), 0x94, 0x0b];
    const twin = makeWasm([body, body]);
    const twinPlan = {
      wasmHash: wasmHash(twin),
      patches: [
        {
          name: 'gravity',
          signature: fingerprint(twin, fnAt(twin, 0)),
          oldValue: GRAVITY,
          newValue: -3.71,
        },
      ],
    };
    const r2 = applyF32Patches(twin, twinPlan);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/ambiguous/);
  });

  it('refuses when oldValue is absent or appears at more than one site', () => {
    const { wasm, plan, patch } = fixture();
    const wrongOld = { ...plan, patches: [{ ...patch, oldValue: 123.5 }] };
    const r1 = applyF32Patches(wasm, wrongOld);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toMatch(/not present/);

    // The plus/minus-clamp shape from the spike: one function holding the same
    // constant twice.
    const body = [...f32const(10), 0x8c, ...f32const(10), 0x0b];
    const clampy = makeWasm([body]);
    const clampPlan = {
      wasmHash: wasmHash(clampy),
      patches: [
        {
          name: 'clamp',
          signature: fingerprint(clampy, fnAt(clampy, 0)),
          oldValue: 10,
          newValue: 20,
        },
      ],
    };
    const r2 = applyF32Patches(clampy, clampPlan);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/appears 2 times/);
  });

  it('is all-or-nothing: one failing patch leaves every other patch unapplied', () => {
    const { wasm, sig, plan, patch } = fixture();
    const mixed = {
      ...plan,
      patches: [
        patch, // would succeed alone
        { name: 'phantom', signature: sig, oldValue: 55.5, newValue: 1 }, // fails: value absent
      ],
    };
    const r = applyF32Patches(wasm, mixed);
    expect(r.ok).toBe(false);
    // The caller keeps serving `wasm` itself, which was never touched:
    expect(wasmHash(wasm)).toBe(plan.wasmHash);
  });

  it('refuses two patches that resolve to the same byte offset', () => {
    const { wasm, plan, patch } = fixture();
    const dup = { ...plan, patches: [patch, { ...patch, name: 'gravity-again' }] };
    const r = applyF32Patches(wasm, dup);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/same byte offset/);
  });

  it('writes the float32 rounding of a double newValue (what f32 arithmetic sees)', () => {
    const { wasm, plan, patch } = fixture();
    const precise = { ...plan, patches: [{ ...patch, newValue: 0.1 }] };
    const r = applyF32Patches(wasm, precise);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(readF32(r.bytes, r.report.applied[0]!.payloadOffset)).toBe(Math.fround(0.1));
  });

  it('applies several patches across different functions in one pass', () => {
    // The multi-patch success path: the all-or-nothing test above only proves the
    // refusal side, so nothing yet showed two patches BOTH landing.
    const a = [0x20, 0x00, ...f32const(2.5), 0x94, 0x0b];
    const b = [0x20, 0x01, 0x20, 0x01, ...f32const(7.25), 0x0b];
    const wasm = makeWasm([a, b]);
    const plan = {
      wasmHash: wasmHash(wasm),
      patches: [
        { name: 'a', signature: fingerprint(wasm, fnAt(wasm, 0)), oldValue: 2.5, newValue: 5 },
        { name: 'b', signature: fingerprint(wasm, fnAt(wasm, 1)), oldValue: 7.25, newValue: 1 },
      ],
    };
    const r = applyF32Patches(wasm, plan);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.applied.map((p) => p.newValue)).toEqual([5, 1]);
    for (const p of r.report.applied) {
      expect(readF32(r.bytes, p.payloadOffset)).toBe(p.newValue);
    }
  });
});
