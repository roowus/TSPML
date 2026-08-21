/**
 * The writer half of #43, built on {@link ./locate}.
 *
 * The locator proved a physics constant can be found structurally. This module is
 * the part that actually rewrites it, and it exists to encode one posture: EVERY
 * ambiguity is a refusal. Offset patching has the bad failure mode (a stale offset
 * writes into whatever is there now); this one's failure mode is "you get vanilla
 * physics and a reason string".
 *
 * A patch plan is data, not code:
 *
 * ```json
 * {
 *   "wasmHash": "<sha256 of the exact binary this plan was verified against>",
 *   "patches": [
 *     { "name": "grip", "signature": "<fingerprint>", "oldValue": 1.05, "newValue": 2 }
 *   ]
 * }
 * ```
 *
 * The gates, in order, all fail-closed:
 *
 *   1. `wasmHash` must match the binary byte-for-byte. Structural location makes a
 *      plan cheap to RE-DERIVE against a new build, but re-deriving is a tooling
 *      step with a human verifying the result — never something the writer does
 *      implicitly against an unknown binary. Same posture as the resolver's
 *      `bundleHash`: serve vanilla rather than mis-target.
 *   2. The signature must locate exactly one function (`locateBySignature` refuses
 *      zero and refuses many).
 *   3. `oldValue` must match exactly one f32.const site inside that function. Two
 *      sites holding the same constant is real ambiguity (the plus/minus-10 clamp
 *      case from the spike); guessing between them is the corruption we exist to
 *      avoid.
 *   4. `newValue` must be a finite number. NaN or Infinity in a physics constant is
 *      not a tuning choice, it is a broken sim.
 *
 * Application is all-or-nothing: if ANY patch in the plan fails a gate, the binary
 * is returned untouched. A half-applied physics plan is not a state anyone asked for.
 *
 * Safety surface: physics patching is exactly the leaderboard-risk category the
 * warn-only classifier (`@tspml/loader`'s `classifySafety`) exists to label, so the
 * result always carries `leaderboardRisk: 'warn'` — the UI surfaces it, the player
 * decides. Nothing here blocks.
 */
import { createHash } from 'node:crypto';

import { f32ConstSites, locateBySignature } from './locate.js';

/** One constant rewrite, located structurally rather than by offset. */
export interface WasmPatch {
  /** Human label, used in reports and refusal strings. */
  readonly name: string;
  /** The containing function's relocation-invariant fingerprint (sha256 hex). */
  readonly signature: string;
  /** The f32 currently at the site. Must occur exactly once in that function. */
  readonly oldValue: number;
  /** What to write. Stored as f32, so it is rounded through `Math.fround`. */
  readonly newValue: number;
}

/** A set of rewrites, pinned to the exact binary they were verified against. */
export interface WasmPatchPlan {
  /** sha256 hex (no prefix) of that binary. */
  readonly wasmHash: string;
  readonly patches: readonly WasmPatch[];
}

/** What a single patch did, once applied. */
export interface AppliedPatch {
  readonly name: string;
  readonly payloadOffset: number;
  readonly oldValue: number;
  readonly newValue: number;
}

/** The report accompanying a successful apply. */
export interface WasmPatchReport {
  readonly applied: readonly AppliedPatch[];
  /** Always `'warn'`: any physics-constant change is ranked-play-relevant. */
  readonly leaderboardRisk: 'warn';
  readonly wasmHash: string;
  readonly patchedHash: string;
}

export type WasmPatchResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly report: WasmPatchReport }
  | { readonly ok: false; readonly reason: string };

/** sha256 hex of a binary — the pin a plan is verified against. */
export function wasmHash(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Validate the shape of a patch plan. Returns a reason string, or null if OK.
 *
 * Deliberately strict. A plan is written by tooling, so anything off-shape means the
 * tooling is broken, not that the user was creative — and since #43's plans ride a
 * request body, "off-shape" also covers attacker-shaped input.
 */
export function checkPlan(plan: unknown): string | null {
  if (typeof plan !== 'object' || plan === null) return 'plan is not an object';
  const p = plan as Record<string, unknown>;
  if (typeof p['wasmHash'] !== 'string' || !/^[0-9a-f]{64}$/.test(p['wasmHash'])) {
    return 'plan.wasmHash is not a sha256 hex string';
  }
  const patches = p['patches'];
  if (!Array.isArray(patches) || patches.length === 0) {
    return 'plan.patches is not a non-empty array';
  }
  for (const [i, raw] of patches.entries()) {
    if (typeof raw !== 'object' || raw === null) return `patch ${i} is not an object`;
    const q = raw as Record<string, unknown>;
    const name = q['name'];
    if (typeof name !== 'string' || name.length === 0) return `patch ${i} has no name`;
    if (typeof q['signature'] !== 'string' || !/^[0-9a-f]{64}$/.test(q['signature'])) {
      return `patch '${name}' signature is not a sha256 hex string`;
    }
    if (typeof q['oldValue'] !== 'number' || !Number.isFinite(q['oldValue'])) {
      return `patch '${name}' oldValue is not a finite number`;
    }
    if (typeof q['newValue'] !== 'number' || !Number.isFinite(q['newValue'])) {
      return `patch '${name}' newValue is not a finite number`;
    }
  }
  return null;
}

/**
 * Apply a plan of f32 constant patches to a wasm binary.
 *
 * Never mutates `buf`. On success returns a patched COPY plus a report; on any
 * failure returns `{ ok: false, reason }` and the caller serves the vanilla bytes.
 */
export function applyF32Patches(buf: Uint8Array, plan: unknown): WasmPatchResult {
  const shape = checkPlan(plan);
  if (shape !== null) return { ok: false, reason: `bad-plan: ${shape}` };
  const valid = plan as WasmPatchPlan;

  const actual = wasmHash(buf);
  if (actual !== valid.wasmHash) {
    // The one gate that will trip on every new PolyTrack release, by design:
    // re-derive the plan with the locator, verify, pin the new hash.
    return {
      ok: false,
      reason: `wasm-hash-mismatch: plan pinned ${valid.wasmHash.slice(0, 12)}…, binary is ${actual.slice(0, 12)}…`,
    };
  }

  // Resolve every site BEFORE writing anything — all-or-nothing.
  const sites: { patch: WasmPatch; payloadOffset: number }[] = [];
  for (const p of valid.patches) {
    const located = locateBySignature(buf, p.signature);
    if (!located.ok) {
      return {
        ok: false,
        reason: `'${p.name}': function ${located.reason} (count ${located.count})`,
      };
    }
    const matches = f32ConstSites(buf, located.fn, p.oldValue);
    const only = matches[0];
    if (matches.length !== 1 || only === undefined) {
      return {
        ok: false,
        reason:
          matches.length === 0
            ? `'${p.name}': f32.const ${p.oldValue} not present in the located function`
            : `'${p.name}': f32.const ${p.oldValue} appears ${matches.length} times — ambiguous, refusing to guess`,
      };
    }
    sites.push({ patch: p, payloadOffset: only.payloadOffset });
  }

  // Distinct patches writing to the same site is a plan bug, not a tie to break.
  const offsets = new Set(sites.map((s) => s.payloadOffset));
  if (offsets.size !== sites.length) {
    return { ok: false, reason: 'two patches resolve to the same byte offset' };
  }

  const bytes = new Uint8Array(buf);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const applied: AppliedPatch[] = [];
  for (const { patch, payloadOffset } of sites) {
    // The binary stores float32; write what f32 arithmetic will actually see.
    const value = Math.fround(patch.newValue);
    view.setFloat32(payloadOffset, value, true);
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
