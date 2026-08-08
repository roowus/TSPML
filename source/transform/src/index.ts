/**
 * @tspml/transform — the JS-Mixin transform pipeline (Tier-2 escape hatch).
 *
 * Applies declarative mixin patches ({@link Patch}) to a PolyTrack bundle's
 * source via Babel AST surgery, resolving each patch's stable {@link TargetSpec}
 * to a concrete AST node. Integrates with `@tspml/mappings` for fail-closed
 * bundle-hash checking: when the live bundle's hash disagrees with the map's,
 * the engine applies nothing (a stale map must never silently mis-target).
 *
 * Validated on the real minified 0.6.2 bundle in the M3 de-risk spike
 * (`./spike.mjs`, docs/research/transform-spike.md).
 *
 * @example
 * ```ts
 * import { transform } from "@tspml/transform";
 *
 * const r = transform(bundleSource, [
 *   {
 *     op: "before",
 *     target: {
 *       anchor: { literals: ["CreateCar", "ControlCar", "TestDeterminism"] },
 *       selector: { kind: "method", name: "controlCar" },
 *     },
 *     inject: "console.log('[mod] controlCar');",
 *   },
 * ]);
 * // r.code      — transformed bundle source
 * // r.map       — serialized source-map JSON
 * // r.applied   — patches that applied
 * // r.failed    — patches that did not (not-found / conflict / bad source)
 * // r.outputValid — regenerated output re-parses with 0 errors
 * ```
 */
export { sortPatchesByPriority, targetSignature, transform } from "./engine.js";
export { applyOp } from "./ops.js";
export { findModulePath, locateTarget } from "./locators.js";

export type {
  TransformOptions,
  TransformResult,
} from "./engine.js";
export type { OpOutcome } from "./ops.js";
export type { Found, LocateResult, NotFound } from "./locators.js";
export type {
  AfterPatch,
  AroundPatch,
  BeforePatch,
  MixinOp,
  ModifyArgPatch,
  ModifyConstantPatch,
  ModifyReturnPatch,
  ModuleAnchor,
  Patch,
  PatchBase,
  PatchResult,
  ReplacePatch,
  TargetSelector,
  TargetSpec,
  TransformFailureReason,
} from "./types.js";

/**
 * Pass-through re-export of the `@tspml/mappings` types the engine integrates
 * with, so callers can build a typed options object without a second import.
 */
export type { GameMap, ResolveContext } from "@tspml/mappings";
