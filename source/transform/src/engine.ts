/**
 * The transform engine — `transform(bundleSource, patches, options)`.
 *
 * Pipeline (mirrors + generalizes `./spike.mjs`):
 *   1. FAIL-CLOSED hash check. If a live `bundleHash` and an expected hash
 *      (from a `@tspml/mappings` `GameMap` or `expectedBundleHash`) are both
 *      given and DISAGREE, the engine applies NOTHING and reports every patch
 *      failed with `hash-mismatch`. A stale map would resolve stable names to
 *      the WRONG concrete locators — the silent-mis-target risk the mappings
 *      system is built to prevent (docs/design/mappings-system.md,
 *      "Fail-closed on stale maps"). The hash normalization matches
 *      `@tspml/mappings`'s resolver (`normalizeHash`) so either side may carry a
 *      `sha256:`/`sha-256:` prefix or differ in case.
 *   2. Parse (`@babel/parser`, `sourceType:"unambiguous"`, `errorRecovery:true`,
 *      `allowReturnOutsideFunction:true`) — the config proven on the real 1.78 MB
 *      0.6.2 bundle in the spike.
 *   3. Detect `replace` single-winner CONFLICTS up front (same target spec → all
 *      competing replaces fail with `conflict-replace-single-winner`; neither is
 *      applied — docs/design/hook-system.md conflict policy).
 *   4. For each surviving patch: resolve its target via `./locators.ts` (never
 *      throws; a miss is reported) → apply the op via `./ops.ts`. Chained ops
 *      (`before`/`after`/`around`/`modifyArg`/`modifyReturn`/`modifyConstant`)
 *      compose naturally in array order (the loader pre-sorts by priority).
 *   5. Generate (`@babel/generator`, `sourceMaps:true`).
 *   6. RE-PARSE GATE: the regenerated output must re-parse with 0 errors (the
 *      spike's `node --check`-equivalent). On failure `outputValid` is false and
 *      the loader is expected to discard the output.
 *
 * `GameMap` is imported type-only from `@tspml/mappings` (no runtime coupling);
 * callers that already hold a map pass it directly, others pass
 * `expectedBundleHash`.
 *
 * DEFERRED (M9+): per-chunk transforms (the host calls `transform` once per
 * chunk; 0.6.2 splits into numbered chunks — issue #3), and IndexedDB
 * bundle-hash caching of the transformed output (a host concern).
 */
import type { GameMap } from "@tspml/mappings";

import { generate, parse } from "./babel.js";
import { locateTarget } from "./locators.js";
import { applyOp } from "./ops.js";
import type {
  Patch,
  PatchResult,
  TargetSpec,
  TransformFailureReason,
} from "./types.js";

export interface TransformOptions {
  /**
   * Hash of the LIVE bundle source (the bytes about to be transformed). When
   * set together with an expected hash, the engine fails closed on mismatch.
   */
  readonly bundleHash?: string;
  /** Expected bundle hash (e.g. read from a map by the caller). */
  readonly expectedBundleHash?: string;
  /**
   * A `@tspml/mappings` `GameMap`; its `bundleHash` is used as the expected
   * hash. Convenience over `expectedBundleHash` for callers that already hold a
   * loaded, validated map.
   */
  readonly map?: GameMap;
  /** Emit compact (minified-ish) output. Default false (readable). */
  readonly compact?: boolean;
  /** Source filename stamped into the emitted source map + declarations. */
  readonly filename?: string;
}

export interface TransformResult {
  /** Generated bundle source (the original when fail-closed). */
  readonly code: string;
  /** Serialized source-map JSON, or null when none was emitted. */
  readonly map: string | null;
  /** Patches whose op applied successfully. */
  readonly applied: PatchResult[];
  /** Patches that did NOT apply (not-found / conflict / bad source / ...). */
  readonly failed: PatchResult[];
  /** True iff the regenerated output re-parses with 0 errors. */
  readonly outputValid: boolean;
  /** Number of parser errors in the regenerated output (0 on success). */
  readonly parseErrorCount: number;
  /**
   * Present when the engine REFUSED to transform at all (e.g. `hash-mismatch`):
   * `code` is the original source verbatim, every patch is in `failed`.
   */
  readonly failedReason?: TransformFailureReason;
}

/** Mirror `@tspml/mappings` resolver hash normalization (trim/lower/strip prefix). */
function normalizeHash(h: string): string {
  return h.trim().toLowerCase().replace(/^sha-?256:/, "");
}

/**
 * Structural key for a TargetSpec — two specs with the same signature address
 * the same anchor+selector. Used here for replace single-winner conflict
 * grouping, and exported for callers that must screen patch sets that run in
 * SEPARATE `transform()` calls (or separate index ranges of one call) against
 * each other: the engine's own conflict detection only sees replace-vs-replace
 * within a single patch array, and a `replace` applied after a `before`/`after`
 * on the same target splices out the earlier inject while reporting success.
 */
export function targetSignature(spec: TargetSpec): string {
  const lit = spec.anchor.literals.map(String).join("\x1f");
  const minHits = spec.anchor.minHits ?? spec.anchor.literals.length;
  const s = spec.selector;
  const sel =
    s.kind === "method" ? `method:${s.name}` : s.kind === "property" ? `property:${s.key}` : "factory";
  return `${lit}\x1e${minHits}\x1e${sel}`;
}

/**
 * Conditional `symbol` field: returns `{symbol}` only when defined, else `{}`.
 * Spreading the result omits the key entirely on the undefined branch, which is
 * what `PatchResult.symbol?: string` requires under `exactOptionalPropertyTypes`
 * (a present-`undefined` would violate it).
 */
function symbolField(symbol: string | undefined): { readonly symbol: string } | Record<string, never> {
  return symbol === undefined ? {} : { symbol };
}

/** Build a PatchResult (failed) for a whole-bundle refusal. */
function failedAll(
  patches: readonly Patch[],
  reason: NonNullable<PatchResult["reason"]>,
  detail: string,
): PatchResult[] {
  return patches.map((p, index) => ({
    index,
    op: p.op,
    ...symbolField(p.symbol),
    status: "failed" as const,
    reason,
    detail,
  }));
}

/**
 * Transform `bundleSource` by applying `patches`. Never throws on a per-patch
 * miss (those are reported in `failed`); throws only on unrecoverable engine
 * errors (a catastrophic parse/generate failure of the ORIGINAL bundle).
 */
export function transform(
  bundleSource: string,
  patches: readonly Patch[] = [],
  options: TransformOptions = {},
): TransformResult {
  // ---- 1. Fail-closed hash check -------------------------------------------
  const expected = options.map?.bundleHash ?? options.expectedBundleHash;
  if (options.bundleHash !== undefined && expected !== undefined) {
    if (normalizeHash(options.bundleHash) !== normalizeHash(expected)) {
      return {
        code: bundleSource,
        map: null,
        applied: [],
        failed: failedAll(patches, "hash-mismatch", "live bundle hash does not match the map — refusing to apply (stale-map)"),
        outputValid: true,
        parseErrorCount: 0,
        failedReason: "hash-mismatch",
      };
    }
  }

  // ---- 2. Parse -------------------------------------------------------------
  const filename = options.filename ?? "bundle.js";
  const ast = parse(bundleSource, {
    sourceType: "unambiguous",
    errorRecovery: true,
    allowReturnOutsideFunction: true,
    sourceFilename: filename,
  });

  // ---- 3. Replace single-winner conflict detection -------------------------
  // Group `replace` patches by target signature; any group with >1 is a
  // load-time CONFLICT (all members fail, none applied).
  // TODO(M9): broaden to a full per-mod compatibility report; for now this
  // enforces the one hard rule (@Overwrite is single-winner).
  const replaceSigs = new Map<string, number>();
  for (const p of patches) {
    if (p.op === "replace") {
      const sig = targetSignature(p.target);
      replaceSigs.set(sig, (replaceSigs.get(sig) ?? 0) + 1);
    }
  }
  const conflictSigs = new Set<string>();
  for (const [sig, n] of replaceSigs) if (n > 1) conflictSigs.add(sig);

  // ---- 4. Resolve + apply ---------------------------------------------------
  const applied: PatchResult[] = [];
  const failed: PatchResult[] = [];

  for (let index = 0; index < patches.length; index++) {
    const patch = patches[index]!;
    const sf = symbolField(patch.symbol);
    const op = patch.op;

    if (patch.op === "replace" && conflictSigs.has(targetSignature(patch.target))) {
      failed.push({
        index,
        op,
        ...sf,
        status: "failed",
        reason: "conflict-replace-single-winner",
        detail: "another mod replaces the same target; @Overwrite is single-winner (load-time conflict)",
      });
      continue;
    }

    const located = locateTarget(ast, patch.target);
    if (!located.ok) {
      failed.push({ index, op, ...sf, status: "failed", reason: "not-found", detail: located.reason });
      continue;
    }

    const outcome = applyOp(located.path, patch);
    if (outcome.applied) {
      applied.push({ index, op, ...sf, status: "applied", detail: `${located.desc}: ${outcome.detail}` });
    } else {
      failed.push({
        index,
        op,
        ...sf,
        status: "failed",
        reason: outcome.reason,
        detail: `${located.desc}: ${outcome.detail}`,
      });
    }
  }

  // ---- 5. Generate (with source map) ---------------------------------------
  const generated = generate(ast, {
    sourceMaps: true,
    sourceFileName: filename,
    filename,
    compact: options.compact ?? false,
    retainLines: false,
  });
  const code = generated.code;
  const map = generated.map ? JSON.stringify(generated.map) : null;

  // ---- 6. Re-parse gate -----------------------------------------------------
  // The regenerated output MUST re-parse with 0 errors (the spike's
  // `node --check`-equivalent gate). `outputValid:false` means the generated
  // code is unusable; the loader is expected to discard it and fall back to the
  // original bundle. We do NOT retroactively move applied patches to `failed`:
  // they did apply to the AST — the failure is in codegen, surfaced here.
  let outputValid = true;
  let parseErrorCount = 0;
  try {
    const reAst = parse(code, {
      sourceType: "unambiguous",
      errorRecovery: true,
      allowReturnOutsideFunction: true,
    });
    parseErrorCount = (reAst.errors ?? []).length;
    outputValid = parseErrorCount === 0;
  } catch (err) {
    outputValid = false;
    parseErrorCount = 1;
    void err; // surfaced via outputValid:false + parseErrorCount
  }

  return {
    code,
    map,
    applied,
    failed,
    outputValid,
    parseErrorCount,
  };
}

/**
 * Stable-sort `patches` by `priority` DESC (higher first; ties keep original
 * order). The engine applies patches in array order, so the caller should sort
 * before calling `transform`. This gives mods a deterministic priority hook.
 *
 * NOTE on runtime order (#13): the engine applies in sorted order; for `before`
 * (unshift at HEAD), a later-applied patch ends up CLOSER to the method head
 * (runs first). So desc-sort → highest-priority applied first → lowest runs
 * first for `before`. For `around` (wrap), desc-sort → highest wraps outermost
 * (runs last / outermost). Full per-op "higher-priority-runs-first" semantics
 * is a tracked refinement; this helper provides the sort hook mods need today.
 */
export function sortPatchesByPriority(patches: readonly Patch[]): Patch[] {
  return patches
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (b.p.priority ?? 0) - (a.p.priority ?? 0) || a.i - b.i)
    .map(({ p }) => p);
}
