/**
 * Patch / result types for the JS-Mixin transform pipeline (Tier-2 ops,
 * docs/design/hook-system.md). A {@link Patch} declares a mixin operation
 * against a {@link TargetSpec}; the engine resolves the spec to a concrete AST
 * node and applies the op.
 *
 * The target-addressing types (`ModuleAnchor` / `TargetSelector` /
 * `TargetSpec`) are owned by `@tspml/mappings` — the map STORES specs, this
 * package CONSUMES them, and a single definition means the producer and
 * consumer cannot drift apart (#30; this replaced an identical local copy and
 * a stale "extract to @tspml/shared" TODO — `@tspml/shared` exists but owns
 * injected-payload code, not schema types). Re-exported here so transform-only
 * callers need no second import. The import is type-only: the packages stay
 * decoupled at runtime, same as the engine's type-only `GameMap` import.
 */
import type { ModuleAnchor, TargetSelector, TargetSpec } from "@tspml/mappings";

export type { ModuleAnchor, TargetSelector, TargetSpec };

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
    | "op-not-applicable"
    | "param-unresolvable";
  /** Human-readable detail (target description, parse error text, ...). */
  readonly detail?: string;
}

/** Reason the engine refused to apply (fail-closed). */
export type TransformFailureReason = "hash-mismatch";
