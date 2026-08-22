/**
 * Deriving a `physics.json` — the authoring half of #43.
 *
 * `locate` proved a constant can be found structurally and `patch` rewrites it, but
 * both take a `signature` as given. Producing one was, until this module, something
 * only the repo's own dev script could do: the spec documented the field as
 * "…64 hex chars…" and there was no command that emitted any. A capability nobody
 * outside the repo can invoke is not shipped, so this is the missing step.
 *
 * The question an author actually has is not "what is the fingerprint of function
 * 369" — they have no idea which function that is. It is **"where does the number
 * 1.05 live in this binary, and can I safely patch it?"** So the entry point here is
 * a search by VALUE ({@link findConstant}), and a fingerprint is one of the things it
 * reports back about each hit.
 *
 * ── Why every candidate carries a verdict ────────────────────────────────────
 * The writer refuses on ambiguity, and it refuses at apply time — inside a game the
 * author is trying to play, reported through a header, minutes after the paste. That
 * is a terrible place to learn a signature matches two functions. Every gate the
 * writer will apply is therefore evaluated HERE, ahead of time, and a candidate that
 * cannot be patched says so and says which gate it failed ({@link CandidateVerdict}).
 * The two must not drift: `patchable` means precisely "`applyF32Patches` will accept
 * a patch built from this candidate against this binary", and the tests assert that
 * against the real writer rather than restating its rules.
 *
 * This module never picks for the author. A search that quietly returned its
 * best-looking hit would be guessing at which constant governs grip, which is a
 * question about the game's physics that nothing in this repo can answer. It reports
 * every hit with everything needed to choose between them, and refuses to rank.
 */
import { f32ConstSites, fingerprint, parseFunctions } from './locate.js';
import type { WasmFunction } from './locate.js';
import { wasmHash } from './patch.js';

/**
 * Why a candidate cannot be patched, or `'ok'` when it can.
 *
 * These mirror the writer's gates one-for-one, deliberately:
 *
 *  - `ambiguous-function` — the containing function's fingerprint matches more than
 *    one function in this binary, so the signature cannot name it. Structural
 *    location has no tiebreaker and must not invent one (see `locateBySignature`).
 *    Roughly 2% of PolyTrack's physics functions are in this state: small ones whose
 *    constants and opcode histogram genuinely coincide.
 *  - `repeated-constant` — the value occurs at more than one site inside its own
 *    function, so `oldValue` cannot say which. The clamp idiom (`-10` and `+10` in
 *    one function) is the common case.
 */
export type CandidateVerdict = 'ok' | 'ambiguous-function' | 'repeated-constant';

/** One place a searched-for constant occurs, with everything needed to decide. */
export interface ConstantCandidate {
  /** Fingerprint of the containing function — the `signature` a patch carries.
   *  Reported even when `patchable` is false: seeing that two candidates share a
   *  signature is how an `ambiguous-function` verdict becomes legible. */
  readonly signature: string;
  /** The exact f32 at the site. This is the `oldValue` to write, and it may differ
   *  from the searched value in its last bits — physics runs in f32 and a JS double
   *  literal is not generally representable. Copy this, not what you typed. */
  readonly value: number;
  /** Where the 4-byte payload begins. Diagnostic only: it is NOT part of a patch,
   *  and recording one in `physics.json` is the offset-patching mistake this whole
   *  design exists to avoid. Useful for eyeballing a disassembly. */
  readonly payloadOffset: number;
  /** Index of the containing function within the code section. Build-specific and
   *  unstable across recompiles; for reporting only, never for targeting. */
  readonly functionIndex: number;
  /** Total f32 constants in the containing function. A function with three of them
   *  is a plausible tuning site; one with two hundred is a math kernel, and a
   *  constant in it probably does not mean what its value suggests. */
  readonly constantsInFunction: number;
  /** Whether `applyF32Patches` will accept a patch built from this candidate. */
  readonly patchable: boolean;
  readonly verdict: CandidateVerdict;
}

/** What {@link findConstant} found, plus the pin a plan needs. */
export interface FindConstantResult {
  /** Bare-hex sha256 of the binary searched — exactly what `physics.json`'s
   *  `wasmHash` takes. Emitted here so an author never has to run a second tool,
   *  and never pins a hash from a build other than the one they searched. */
  readonly wasmHash: string;
  /** The value as searched, after `Math.fround`. */
  readonly searched: number;
  /** Every occurrence, in binary order. Deliberately unranked. */
  readonly candidates: readonly ConstantCandidate[];
}

/**
 * Find every `f32.const` in `buf` holding `value`, and report whether each can be
 * patched.
 *
 * The comparison is through `Math.fround`, because the binary stores f32 and the
 * caller has a double. Comparing raw would make `findConstant(buf, 1.05)` return
 * nothing for a binary that plainly contains 1.05, and "not found" is exactly the
 * wrong answer to give an author who is right.
 *
 * Non-finite searches return no candidates rather than throwing: `NaN` never equals
 * itself, and an infinity is not a tuning constant. Both are honest empties.
 */
export function findConstant(buf: Uint8Array, value: number): FindConstantResult {
  const searched = Math.fround(value);
  const hash = wasmHash(buf);
  if (!Number.isFinite(searched)) {
    return { wasmHash: hash, searched, candidates: [] };
  }

  const fns = parseFunctions(buf);
  // Fingerprint every function once. The alternative — fingerprinting only the hits
  // — cannot answer "is this signature unique", which is the question that decides
  // whether the writer will accept the patch at all.
  const sigOf = new Map<WasmFunction, string>();
  const countBySig = new Map<string, number>();
  for (const fn of fns) {
    const sig = fingerprint(buf, fn);
    sigOf.set(fn, sig);
    countBySig.set(sig, (countBySig.get(sig) ?? 0) + 1);
  }

  const candidates: ConstantCandidate[] = [];
  for (const fn of fns) {
    const hits = f32ConstSites(buf, fn, searched);
    if (hits.length === 0) continue;
    const sig = sigOf.get(fn) ?? '';
    const sigCount = countBySig.get(sig) ?? 0;
    for (const site of hits) {
      // Checked in the writer's own order, so the reported verdict is the one the
      // writer would report. A candidate failing both gates is named by the first,
      // and that is the right one to show: an ambiguous function cannot be reached
      // at all, so its repeated constant is not yet the author's problem.
      const verdict: CandidateVerdict =
        sigCount !== 1 ? 'ambiguous-function' : hits.length > 1 ? 'repeated-constant' : 'ok';
      candidates.push({
        signature: sig,
        value: site.value,
        payloadOffset: site.payloadOffset,
        functionIndex: fn.idx,
        constantsInFunction: f32ConstSites(buf, fn).length,
        patchable: verdict === 'ok',
        verdict,
      });
    }
  }
  return { wasmHash: hash, searched, candidates };
}

/**
 * Turn one patchable candidate into the `physics.json` a mod ships.
 *
 * Refuses an unpatchable candidate rather than emitting a file the writer will
 * reject later. The failure is already known here; carrying it forward would only
 * move the error from a command an author is running to a game they are playing.
 *
 * `name` is the author's label, echoed in reports and refusals — it is what they
 * will read when a patch stops applying after a game update, so it should say what
 * the constant does rather than where it is.
 */
export function toPhysicsJson(
  wasmHashHex: string,
  name: string,
  candidate: ConstantCandidate,
  newValue: number,
): { ok: true; json: string } | { ok: false; reason: string } {
  if (!candidate.patchable) {
    return {
      ok: false,
      reason: `candidate is ${candidate.verdict} - the writer would refuse it`,
    };
  }
  if (!Number.isFinite(newValue)) {
    return { ok: false, reason: 'newValue must be finite (NaN and Infinity break the sim)' };
  }
  const plan = {
    wasmHash: wasmHashHex,
    patches: [
      {
        name,
        signature: candidate.signature,
        oldValue: candidate.value,
        // Rounded here so what the author reads is what the sim will hold. The
        // writer rounds too; printing the unrounded double would make the file
        // disagree with the value the game reports back.
        newValue: Math.fround(newValue),
      },
    ],
  };
  return { ok: true, json: `${JSON.stringify(plan, null, 2)}\n` };
}
