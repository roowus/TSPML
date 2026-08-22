/**
 * @tspml/wasm — locating and rewriting constants inside PolyTrack's physics binary (#43).
 *
 * Two halves, and the split is the design:
 *
 * 1. {@link ./locate} — structural, relocation-invariant location. A map entry can
 *    record a function FINGERPRINT instead of a byte offset, and the offset is
 *    computed at load time against the binary actually present. A recompile that
 *    preserves a function's logic keeps working with no map edit; one that changes
 *    it produces `not-found`, not a mis-write.
 * 2. {@link ./patch} — the fail-closed writer. Hash-pinned, unique-location,
 *    unique-site, finite-value, all-or-nothing.
 * 3. {@link ./derive} — the authoring step, which turns "where does 1.05 live in
 *    this binary" into a `physics.json`. Without it the other two are only usable
 *    from inside this repo: a `signature` had no command that could emit one.
 *
 * The package exists so both the portal (which serves the patched bytes) and the
 * mappings pipeline (which derives and verifies plans) run the SAME implementation.
 * It previously lived only in the pipeline, which is dev-only tooling nothing at
 * runtime can depend on.
 */
export {
  constantsIn,
  f32ConstSites,
  fingerprint,
  fingerprintAll,
  locateBySignature,
  parseFunctions,
  parseSections,
  readULEB,
} from './locate.js';
export type {
  F32Site,
  FingerprintReport,
  LocateResult,
  WasmFunction,
  WasmSection,
} from './locate.js';
export { findConstant, toPhysicsJson } from './derive.js';
export type { CandidateVerdict, ConstantCandidate, FindConstantResult } from './derive.js';
export { applyF32Patches, checkPlan, wasmHash } from './patch.js';
export type {
  AppliedPatch,
  WasmPatch,
  WasmPatchPlan,
  WasmPatchReport,
  WasmPatchResult,
} from './patch.js';
