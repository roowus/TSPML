// Tests for src/wasm-patch.mjs — the #43 writer half.
//
// Synthetic binaries only (same rule as wasm-locate.test.mjs): the real physics
// binary is proprietary, lives in the gitignored `.cache/`, and must never be
// needed by CI. What these pin is the fail-closed contract: hash gate, unique
// location, unique site, finite values, all-or-nothing application.
import { describe, expect, it } from 'vitest';
import { fingerprint, parseFunctions } from '../src/wasm-locate.mjs';
import { applyF32Patches, checkPlan, wasmHash } from '../src/wasm-patch.mjs';

function uleb(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}

function f32const(v) {
  const b = Buffer.alloc(4);
  b.writeFloatLE(v);
  return [0x43, ...b];
}

function makeWasm(bodies) {
  const encoded = bodies.map((b) => [...uleb(b.length), ...b]);
  const content = [...uleb(bodies.length), ...encoded.flat()];
  return Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    10, ...uleb(content.length), ...content,
  ]);
}

const GRAVITY = Math.fround(-9.81);

/** A binary with a distinctive "gravity function" plus a decoy, and a valid plan. */
function fixture() {
  const gravityBody = [0x20, 0x00, ...f32const(GRAVITY), 0x94, 0x0b];
  const decoyBody = [...f32const(1.5), 0x0b];
  const wasm = makeWasm([decoyBody, gravityBody]);
  const sig = fingerprint(wasm, parseFunctions(wasm)[1]);
  const plan = {
    wasmHash: wasmHash(wasm),
    patches: [{ name: 'gravity', signature: sig, oldValue: GRAVITY, newValue: -3.71 }],
  };
  return { wasm, sig, plan };
}

describe('checkPlan', () => {
  it('accepts the fixture plan', () => {
    expect(checkPlan(fixture().plan)).toBeNull();
  });

  it('names what is wrong: shape, hash, empty patches, bad values', () => {
    expect(checkPlan(null)).toMatch(/not an object/);
    expect(checkPlan({ wasmHash: 'nope', patches: [{}] })).toMatch(/wasmHash/);
    const { plan } = fixture();
    expect(checkPlan({ ...plan, patches: [] })).toMatch(/non-empty/);
    expect(checkPlan({ ...plan, patches: [{ ...plan.patches[0], name: '' }] })).toMatch(/no name/);
    expect(checkPlan({ ...plan, patches: [{ ...plan.patches[0], signature: 'xyz' }] })).toMatch(/signature/);
    expect(checkPlan({ ...plan, patches: [{ ...plan.patches[0], newValue: NaN }] })).toMatch(/newValue/);
    expect(checkPlan({ ...plan, patches: [{ ...plan.patches[0], oldValue: Infinity }] })).toMatch(/oldValue/);
  });
});

describe('applyF32Patches', () => {
  it('patches the constant, leaves the input untouched, and reports warn-only risk', () => {
    const { wasm, plan } = fixture();
    const before = Buffer.from(wasm);
    const r = applyF32Patches(wasm, plan);

    expect(r.ok).toBe(true);
    expect(wasm.equals(before)).toBe(true); // never mutates the input
    expect(r.bytes.length).toBe(wasm.length);
    expect(r.report.applied).toHaveLength(1);
    expect(r.bytes.readFloatLE(r.report.applied[0].payloadOffset)).toBeCloseTo(-3.71, 5);
    expect(r.report.leaderboardRisk).toBe('warn'); // physics = ranked-play-relevant, always surfaced
    expect(r.report.patchedHash).not.toBe(r.report.wasmHash);
  });

  it('refuses a binary whose hash does not match the plan pin', () => {
    const { wasm, plan } = fixture();
    const other = Buffer.from(wasm);
    other[other.length - 1] ^= 0xff; // any byte difference
    const r = applyF32Patches(other, plan);
    expect(r).toMatchObject({ ok: false });
    expect(r.reason).toMatch(/wasm-hash-mismatch/);
  });

  it('refuses when the signature matches zero or multiple functions', () => {
    const { wasm, plan } = fixture();
    const gone = { ...plan, patches: [{ ...plan.patches[0], signature: '0'.repeat(64) }] };
    expect(applyF32Patches(wasm, gone).reason).toMatch(/not-found/);

    // Two byte-identical gravity functions: locate must refuse, so apply must too.
    const body = [0x20, 0x00, ...f32const(GRAVITY), 0x94, 0x0b];
    const twin = makeWasm([body, body]);
    const twinPlan = {
      wasmHash: wasmHash(twin),
      patches: [
        {
          name: 'gravity',
          signature: fingerprint(twin, parseFunctions(twin)[0]),
          oldValue: GRAVITY,
          newValue: -3.71,
        },
      ],
    };
    expect(applyF32Patches(twin, twinPlan).reason).toMatch(/ambiguous/);
  });

  it('refuses when oldValue is absent or appears at more than one site', () => {
    const { wasm, plan } = fixture();
    const wrongOld = { ...plan, patches: [{ ...plan.patches[0], oldValue: 123.5 }] };
    expect(applyF32Patches(wasm, wrongOld).reason).toMatch(/not present/);

    // The ±clamp shape from the spike: one function holding the same constant twice.
    const body = [...f32const(10), 0x8c, ...f32const(10), 0x0b];
    const clampy = makeWasm([body]);
    const clampPlan = {
      wasmHash: wasmHash(clampy),
      patches: [
        {
          name: 'clamp',
          signature: fingerprint(clampy, parseFunctions(clampy)[0]),
          oldValue: 10,
          newValue: 20,
        },
      ],
    };
    const r = applyF32Patches(clampy, clampPlan);
    expect(r.reason).toMatch(/appears 2 times/);
  });

  it('is all-or-nothing: one failing patch leaves every other patch unapplied', () => {
    const { wasm, sig, plan } = fixture();
    const mixed = {
      ...plan,
      patches: [
        plan.patches[0], // would succeed alone
        { name: 'phantom', signature: sig, oldValue: 55.5, newValue: 1 }, // fails: value absent
      ],
    };
    const r = applyF32Patches(wasm, mixed);
    expect(r.ok).toBe(false);
    // The caller keeps serving `wasm` itself, which was never touched:
    expect(wasmHash(wasm)).toBe(plan.wasmHash);
  });

  it('refuses two patches that resolve to the same byte offset', () => {
    const { wasm, plan } = fixture();
    const dup = { ...plan, patches: [plan.patches[0], { ...plan.patches[0], name: 'gravity-again' }] };
    expect(applyF32Patches(wasm, dup).reason).toMatch(/same byte offset/);
  });

  it('writes the float32 rounding of a double newValue (what f32 arithmetic sees)', () => {
    const { wasm, plan } = fixture();
    const precise = { ...plan, patches: [{ ...plan.patches[0], newValue: 0.1 }] };
    const r = applyF32Patches(wasm, precise);
    expect(r.ok).toBe(true);
    expect(r.bytes.readFloatLE(r.report.applied[0].payloadOffset)).toBe(Math.fround(0.1));
  });
});
