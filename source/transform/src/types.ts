// TODO: extract to @tspml/shared
//
// For M3 these types live inside @tspml/transform so the package stays
// self-contained (no workspace dependency on a not-yet-existing @tspml/shared).
// They are re-exported from the package entrypoint. (Mirrors the loader's
// convention in source/loader/src/types.ts.)

/**
 * Target spec / patch / result types for the JS-Mixin transform pipeline
 * (Tier-2 ops, docs/design/hook-system.md). A {@link Patch} declares a mixin
 * operation against a {@link TargetSpec}; the engine resolves the spec to a
 * concrete AST node and applies the op.
 *
 * SELECTOR STRATEGY (docs/research/transform-spike.md — the authoritative M3
 * approach): a module is located by an ANCHOR of distinctive literals that
 * survive minification (NOT by webpack id — ids drift, see the M1 drift spike).
 * Within the module a node is located by a stable name (preserved method name
 * or property KEY, never a literal VALUE).
 */

/**
 * A module anchor: the set of enum/string literals unique to one webpack module
 * factory. The factory is the match if its body contains at least `minHits` of
 * them. This generalizes the spike's `CreateCar` ∧ `ControlCar` ∧
 * `TestDeterminism` anchor (which are TypeScript-compiled protocol enum members
 * — globally unique, minification-stable).
 */
export interface ModuleAnchor {
  /** ≥1 distinctive literals (enum members, magic strings, numeric constants). */
  readonly literals: readonly (string | number)[];
  /**
   * Minimum literal hits required to consider a factory the match. Defaults to
   * `literals.length` (all of them). Lowering it trades precision for resilience
   * when an anchor literal is renamed in a future build.
   */
  readonly minHits?: number;
}

/**
 * Where to narrow WITHIN the found module. Exactly one `kind` is set.
 *
 *   - `method`   — a preserved class/object method name (survives minification;
 *                  terser keeps member names).
 *   - `property` — an `ObjectProperty` selected by KEY, never by value (the
 *                  value changes every release; the property name doesn't).
 *   - `factory`  — the webpack module factory itself (module-load intercept).
 *
 * TODO(M9 / issue #1): add an `invoke` variant — an INVOKE-style call-site
 *   locator analogous to Fabric's `@At("INVOKE", target=...)` — for
 *   `@ModifyArg`/`@Redirect` against a specific call site resolved structurally
 *   (callee name + ordinal). The drift spike flagged ~15% of modules need AST
 *   structural fingerprints; the in-method `modifyArg` op below covers the
 *   common case without a cross-module INVOKE locator.
 */
export type TargetSelector =
  | { readonly kind: "method"; readonly name: string }
  | { readonly kind: "property"; readonly key: string }
  | { readonly kind: "factory" };

/** A stable target: module anchor + within-module selector. */
export interface TargetSpec {
  readonly anchor: ModuleAnchor;
  readonly selector: TargetSelector;
}

/** The mixin operations (docs/design/hook-system.md, docs/api/mixin-reference.md). */
export type MixinOp =
  | "before"
  | "after"
  | "around"
  | "replace"
  | "modifyArg"
  | "modifyReturn"
  | "modifyConstant";

/**
 * Shared shape every patch payload carries. `symbol` is the stable name from
 * the mappings file (for reporting); `priority` orders chained ops across mods
 * (higher first; the loader sorts before calling `transform`, ties break by
 * array order).
 */
export interface PatchBase {
  /** Stable mappings symbol (e.g. `Car.controlCar`) — reporting only. */
  readonly symbol?: string;
  /** Chain priority (higher runs first). Default 0. */
  readonly priority?: number;
}

/**
 * `before` / @Inject(HEAD) — inject `inject` (statement source) at the HEAD of
 * the resolved method body. Chains across mods (priority order).
 */
export interface BeforePatch extends PatchBase {
  readonly op: "before";
  readonly target: TargetSpec;
  /** JS statement source to inject (one or more statements). */
  readonly inject: string;
}

/**
 * `after` / @Inject(RETURN) — inject `inject` immediately before each return
 * in the resolved method (and at the end if the method has no explicit return).
 * Chains across mods.
 */
export interface AfterPatch extends PatchBase {
  readonly op: "after";
  readonly target: TargetSpec;
  readonly inject: string;
}

/**
 * `around` — wrap the resolved method. `inject` becomes the new method body and
 * may call `proceed` (bound to the original body, preserving params + `this`).
 * Chains by nesting (priority order); short-circuits by not calling `proceed`.
 * Mods that may short-circuit should declare it via their manifest so others can
 * detect incompatibility at load.
 */
export interface AroundPatch extends PatchBase {
  readonly op: "around";
  readonly target: TargetSpec;
  /** JS statement source for the new body; may reference `proceed`. */
  readonly inject: string;
  /** Name of the proceed binding inside `inject`. Default `proceed`. */
  readonly proceedName?: string;
}

/**
 * `replace` / @Overwrite — overwrite the resolved method body with `inject`.
 * LAST RESORT. SINGLE-WINNER: two mods replacing the same target produce a
 * load-time CONFLICT ERROR (the engine reports both failed; neither is applied).
 */
export interface ReplacePatch extends PatchBase {
  readonly op: "replace";
  readonly target: TargetSpec;
  /** JS statement source for the full replacement body. */
  readonly inject: string;
}

/**
 * `modifyArg` / @ModifyArg — within the resolved method, replace argument
 * `index` of every call to `callee` with `replaceWith` (expression source).
 * Chains across mods.
 */
export interface ModifyArgPatch extends PatchBase {
  readonly op: "modifyArg";
  readonly target: TargetSpec;
  /** Callee to match (identifier name, or member-expression property name). */
  readonly callee: string;
  /** 0-based argument index to replace. */
  readonly index: number;
  /** JS expression source for the replacement argument. */
  readonly replaceWith: string;
}

/**
 * `modifyReturn` — wrap each return value in the resolved method:
 * `return X` becomes `return (<wrap>)(X)`. `wrap` is an expression that
 * evaluates to a function (e.g. `(v) => v + 1`). Chains across mods.
 */
export interface ModifyReturnPatch extends PatchBase {
  readonly op: "modifyReturn";
  readonly target: TargetSpec;
  /** Expression evaluating to a function applied to each return value. */
  readonly wrap: string;
}

/**
 * `modifyConstant` / @ModifyConstant — replace the value of the `ObjectProperty`
 * resolved by a `property` selector (selected by KEY). Generalizes the spike's
 * `version:"0.6.2"` → `version:"0.6.2-tspml"` literal rewrite. Chains across
 * mods.
 */
export interface ModifyConstantPatch extends PatchBase {
  readonly op: "modifyConstant";
  readonly target: TargetSpec;
  /** JS expression source for the new property value. */
  readonly replaceWith: string;
}

/** A declarative mixin patch. */
export type Patch =
  | BeforePatch
  | AfterPatch
  | AroundPatch
  | ReplacePatch
  | ModifyArgPatch
  | ModifyReturnPatch
  | ModifyConstantPatch;

/** Per-patch outcome recorded by the engine. */
export interface PatchResult {
  /** Index into the `patches` array passed to `transform`. */
  readonly index: number;
  readonly op: MixinOp;
  readonly symbol?: string;
  readonly status: "applied" | "failed";
  /** Present when `status === "failed"`: machine-readable reason slug. */
  readonly reason?:
    | "not-found"
    | "hash-mismatch"
    | "conflict-replace-single-winner"
    | "bad-inject-source"
    | "op-not-applicable";
  /** Human-readable detail (target description, parse error text, ...). */
  readonly detail?: string;
}

/** Reason the engine refused to apply (fail-closed). */
export type TransformFailureReason = "hash-mismatch";
