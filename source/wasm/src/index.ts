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
export { applyF32Patches, checkPlan, wasmHash } from './patch.js';
export type {
  AppliedPatch,
  WasmPatch,
  WasmPatchPlan,
  WasmPatchReport,
  WasmPatchResult,
} from './patch.js';
