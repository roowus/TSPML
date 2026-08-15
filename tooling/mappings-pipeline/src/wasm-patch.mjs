// wasm-patch.mjs — the writer half of #43, built on wasm-locate.mjs.
//
// The locator (the spike) proved a physics constant can be found structurally.
// This module is the part that actually rewrites it, and it exists to encode one
// posture: EVERY ambiguity is a refusal. PML's offset patcher has the bad failure
// mode (a stale offset writes into whatever is there now); this one's failure mode
// is "you get vanilla physics and a reason string".
//
// A patch plan is data, not code:
//
//   {
//     wasmHash: "<sha256 of the exact binary this plan was verified against>",
//     patches: [
//       { name: "gravity", signature: "<fingerprint>", oldValue: -9.81, newValue: -3.71 }
//     ]
//   }
//
// The gates, in order, all fail-closed:
//
//   1. `wasmHash` must match the binary byte-for-byte. Structural location makes a
//      plan cheap to RE-DERIVE against a new build, but re-deriving is a tooling
//      step with a human verifying the result — never something the writer does
//      implicitly against an unknown binary. Same posture as the resolver's
//      `bundleHash`: serve vanilla rather than mis-target.
//   2. The signature must locate exactly one function (locateBySignature refuses
//      zero and refuses many).
//   3. `oldValue` must match exactly one f32.const site inside that function. Two
//      sites holding the same constant is real ambiguity (the ±10 clamp case from
//      the spike); guessing between them is the corruption we exist to avoid.
//   4. `newValue` must be a finite number. NaN/Infinity in a physics constant is
//      not a tuning choice, it is a broken sim.
//
// Application is all-or-nothing: if ANY patch in the plan fails a gate, the binary
// is returned untouched. A half-applied physics plan is not a state anyone asked for.
//
// Safety surface: physics patching is exactly the leaderboard-risk category the
// warn-only classifier (source/loader/src/safety.ts) exists to label, so the result
// always carries `leaderboardRisk: 'warn'` — the UI surfaces it, the player decides.
// Nothing here blocks.

import { createHash } from 'node:crypto';
import { f32ConstSites, locateBySignature } from './wasm-locate.mjs';

/** sha256 hex of a binary — the pin a plan is verified against. */
export function wasmHash(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Validate the shape of a patch plan. Returns a reason string, or null if OK.
 * Deliberately strict: a plan is written by tooling, so anything off-shape means
 * the tooling is broken, not that the user was creative.
 */
export function checkPlan(plan) {
  if (typeof plan !== 'object' || plan === null) return 'plan is not an object';
  if (typeof plan.wasmHash !== 'string' || !/^[0-9a-f]{64}$/.test(plan.wasmHash)) {
    return 'plan.wasmHash is not a sha256 hex string';
  }
  if (!Array.isArray(plan.patches) || plan.patches.length === 0) {
    return 'plan.patches is not a non-empty array';
  }
  for (const [i, p] of plan.patches.entries()) {
    if (typeof p !== 'object' || p === null) return `patch ${i} is not an object`;
    if (typeof p.name !== 'string' || p.name.length === 0) return `patch ${i} has no name`;
    if (typeof p.signature !== 'string' || !/^[0-9a-f]{64}$/.test(p.signature)) {
      return `patch '${p.name}' signature is not a sha256 hex string`;
    }
    if (typeof p.oldValue !== 'number' || !Number.isFinite(p.oldValue)) {
      return `patch '${p.name}' oldValue is not a finite number`;
    }
    if (typeof p.newValue !== 'number' || !Number.isFinite(p.newValue)) {
      return `patch '${p.name}' newValue is not a finite number`;
    }
  }
  return null;
}

/**
 * Apply a plan of f32 constant patches to a wasm binary.
 *
 * Never mutates `buf`. On success returns a patched COPY plus a report; on any
 * failure returns `{ ok: false, reason }` and the caller serves the vanilla bytes.
 *
 * @param {Buffer} buf the wasm binary
 * @param {object} plan see module comment
 * @returns {{ ok: true, bytes: Buffer, report: object } | { ok: false, reason: string }}
 */
export function applyF32Patches(buf, plan) {
  const shape = checkPlan(plan);
  if (shape !== null) return { ok: false, reason: `bad-plan: ${shape}` };

  const actual = wasmHash(buf);
  if (actual !== plan.wasmHash) {
    // The one gate that will trip on every new PolyTrack release, by design:
    // re-derive the plan with the locator, verify, pin the new hash.
    return {
      ok: false,
      reason: `wasm-hash-mismatch: plan pinned ${plan.wasmHash.slice(0, 12)}…, binary is ${actual.slice(0, 12)}…`,
    };
  }

  // Resolve every site BEFORE writing anything — all-or-nothing.
  const sites = [];
  for (const p of plan.patches) {
    const located = locateBySignature(buf, p.signature);
    if (!located.ok) {
      return { ok: false, reason: `'${p.name}': function ${located.reason} (count ${located.count})` };
    }
    const matches = f32ConstSites(buf, located.fn, p.oldValue);
    if (matches.length !== 1) {
      return {
        ok: false,
        reason:
          matches.length === 0
            ? `'${p.name}': f32.const ${p.oldValue} not present in the located function`
            : `'${p.name}': f32.const ${p.oldValue} appears ${matches.length} times — ambiguous, refusing to guess`,
      };
    }
    sites.push({ patch: p, payloadOffset: matches[0].payloadOffset });
  }

  // Distinct patches writing to the same site is a plan bug, not a tie to break.
  const offsets = new Set(sites.map((s) => s.payloadOffset));
  if (offsets.size !== sites.length) {
    return { ok: false, reason: 'two patches resolve to the same byte offset' };
  }

  const bytes = Buffer.from(buf);
  const applied = [];
  for (const { patch, payloadOffset } of sites) {
    // The binary stores float32; write what f32 arithmetic will actually see.
    const value = Math.fround(patch.newValue);
    bytes.writeFloatLE(value, payloadOffset);
    applied.push({
      name: patch.name,
      payloadOffset,
      oldValue: Math.fround(patch.oldValue),
      newValue: value,
    });
  }

  return {
    ok: true,
    bytes,
    report: {
      applied,
      // Any physics-constant change is ranked-play-relevant. Warn-only, always:
      // the loader's safety surface shows it, the player decides.
      leaderboardRisk: 'warn',
      wasmHash: actual,
      patchedHash: wasmHash(bytes),
    },
  };
}
