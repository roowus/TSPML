/**
 * @tspml/portal — the portal's bundle transform.
 *
 * Rewrites a PolyTrack bundle with the loader-owned bridge patches (the LIVE
 * badge, the six Tier-1 event emits, and the custom-track capture patches) plus
 * whatever Tier-2 mixins the loaded mods declare. Emitted events flow to the Tier-1
 * `EventBus` the portal exposes on the iframe as `window.__tspml` (see app/page.tsx),
 * which mods subscribe to.
 *
 * #98 generalizes "the bundle" to a {@link TransformSurface}: the main bundle OR an
 * allowlisted lazily-loaded chunk. The surface — not this module — owns which pin the
 * bytes are gated against and which base patches apply, because a chunk re-minifies
 * independently of the main bundle and the bridge patches anchor only in main. See
 * lib/transform-surface.ts.
 *
 * The patches themselves now live in **@tspml/shared** — this file is only the
 * portal-specific half: mappings `{symbol}` resolution and the fail-closed sha256
 * hash-gate. Until #34 the patch bodies were duplicated here and in the dev harness,
 * and had already drifted (the harness had the capture patches; the portal did not).
 *
 * #62 adds USER patch sets (pasted mixins carried in the request — see
 * lib/user-patches.ts for the whole mechanism): they compose into the SAME single
 * `transform()` pass as the base patches, but under a different contract —
 *
 *   base patches: ALL-OR-NOTHING. Any base failure serves vanilla, exactly the
 *     pre-#62 behavior. User patches can never change this: a user `replace`
 *     aimed at a base-patched target is PRE-SCREENED OUT (see below), and any
 *     other user failure is per-mod, not fatal.
 *   user patches: PER-MOD ISOLATED. Each mod's failures are reported in
 *     `userReport.mods`; other mods and the base transform are unaffected.
 *
 * The pre-screen exists because the engine's replace single-winner detection
 * only groups replace-vs-replace: a user `replace` on a method a base
 * `before`/`after` already injected into would splice the base inject OUT while
 * reporting success (ops.ts applyReplace swaps the whole current body). That is
 * the one way a user patch could silently violate the all-or-nothing contract,
 * so it is refused up front with reason `conflicts-with-loader-patch`.
 *
 * HASH HONESTY: user `{symbol}` patches resolve against the live hash of the
 * ORIGINAL upstream bundle — the same value the base gate checks. If the
 * upstream is not the pinned 0.6.2 the whole transform fails closed to vanilla
 * before any user patch is attempted.
 *
 * Gated by the TSPML_TRANSFORM env in the proxy route.
 */
import type { Patch, PatchResult } from "@tspml/transform";
import { createHash } from "node:crypto";
import { resolveTarget, targetSurface, validateMap } from "@tspml/mappings";
import type { GameMap } from "@tspml/mappings";
// Imported directly (not loadDefaultMap, which uses import.meta.url and breaks
// under Next's bundler) + validated once at module load.
import mapJson from "@tspml/mappings/maps/polytrack-0.6.2.json";
// Badge + Tier-1 emits + the track-capture patches, shared with the dev harness (#34).
// The proxy route must ALSO inject @tspml/shared's EARLY_CAPTURE_SCRIPT_TAG, or the
// codec capture below fires before the bridge exists and is silently dropped.
import { BRIDGE_PATCHES } from "@tspml/shared";
import { transformSurfaceFor } from "./transform-surface";
import type { TransformSurface } from "./transform-surface";
import type { UserMixinModReport, UserMixinReport, UserPatchSet } from "./user-patches";

const MAP: GameMap = validateMap(mapJson);

/** Cap per-patch failure details in the report (it rides inside the bundle). */
const DETAIL_CAP = 160;
const FAILED_ENTRIES_CAP = 8;

/** Why a declared patch could not be turned into a concrete `Patch`. */
type ResolveFailure = "symbol-unresolved" | "symbol-not-on-this-surface";

/**
 * The hash to hand `resolveTarget`'s staleness gate for THIS surface (#98).
 *
 * `resolveTarget` asks one question: "is this map current for the bytes the target
 * lives in?". On main that is `liveHash` vs `map.bundleHash`, unchanged.
 *
 * On a chunk it cannot be: `liveHash` is the CHUNK's hash, which never equals the
 * main bundle's pin, so passing it through would report every chunk target as
 * 'stale map' — a permanent false negative dressed up as a safety check. Nor can we
 * check main's bytes: this request is for a chunk and main's bytes are not in hand.
 *
 * What makes that safe rather than a hole is where the real gate sits. A chunk-scoped
 * target's anchor was verified against the bytes pinned by `chunks[id].hash`, and the
 * engine refuses to transform unless the live chunk matches that same pin
 * (`expectedBundleHash: surface.expectedHash` below). So the integrity question for a
 * chunk target is answered by the chunk's own pin, checked one call later, and
 * answering it a second time with the wrong operand buys nothing. A MAIN-scoped
 * symbol aimed at a chunk is still refused — by the surface check, on the correct
 * grounds, rather than by a hash comparison that is meaningless here.
 */
function resolveGateHash(map: GameMap, liveHash: string, surface: TransformSurface): string {
  return surface.kind === "main" ? liveHash : map.bundleHash;
}

/** The surface a named target IS scoped to, for the mismatch message. Naming the
 *  right file turns "your mixin failed" into "your mixin is on the wrong file". */
function symbolSurface(map: GameMap, symbol: unknown): string {
  const targets = map.targets ?? {};
  const key = Object.keys(targets).find((k) => k.toLowerCase() === String(symbol).toLowerCase());
  const spec = key === undefined ? undefined : targets[key];
  return spec ? targetSurface(spec) : "another file";
}

/**
 * Resolve a declared patch to a concrete `Patch`. An inline-anchor patch passes
 * through unchanged; a `{ symbol }` patch (M5-C) is resolved fail-closed via the
 * map — returns a failure on stale-map/not-found (the patch is dropped, never
 * applied against a mismatched/wrong target).
 *
 * `{ symbol }` is refused when the target's SURFACE is not the file being served
 * (#98). Every target's anchor is verified against exactly one unpacked bundle
 * (verify-targets.mjs), so a target says nothing about any other file — resolving
 * one against a different file and letting the locator hunt for its literals is
 * precisely the silent mis-target the mappings system exists to prevent. Refusing
 * with its own reason also keeps the report honest: gating on the chunk's pin would
 * make every such patch read as "stale map", pointing a mod author at the wrong
 * problem entirely.
 *
 * Note this is a match, not a main-bundle rule: a target the map scopes to
 * `112.bundle.js` resolves when 112 is what is being served, and is refused on main.
 * Inline-anchor patches are unaffected — the author supplied the anchor.
 */
function resolveDeclaredPatch(
  p: Record<string, unknown>,
  map: GameMap,
  liveHash: string,
  surface: TransformSurface,
): { ok: true; patch: Patch } | { ok: false; reason: ResolveFailure } {
  if (typeof p.symbol === "string") {
    // Resolve FIRST, then check the surface: an unknown name is 'symbol-unresolved'
    // whatever file it was aimed at, and reporting it as a surface mismatch would
    // send the author looking for a chunk problem that does not exist.
    //
    // See resolveGateHash: on a chunk the staleness gate is the chunk's own pin,
    // checked by the engine, not a main-bundle hash comparison that cannot hold.
    const res = resolveTarget(map, p.symbol, { bundleHash: resolveGateHash(map, liveHash, surface) });
    if (!res.ok) return { ok: false, reason: "symbol-unresolved" }; // fail-closed
    if (targetSurface(res.target) !== surface.file) {
      return { ok: false, reason: "symbol-not-on-this-surface" };
    }
    const rest = { ...p };
    delete rest.symbol;
    return { ok: true, patch: { ...rest, target: res.target } as unknown as Patch };
  }
  return { ok: true, patch: p as unknown as Patch };
}

/** All base patches for the MAIN bundle: the loader-owned bridge patches (badge +
 *  Tier-1 emits + captures). Mod-declared mixins ride the request-carried user patch
 *  plan (#62) — since the bundled demo mods left the portal, nothing else
 *  contributes to the base transform. Loosely typed — patches may use
 *  `{symbol}` (M5-C) resolved in applyDemoTransform, or inline anchors.
 *
 *  Chunk surfaces get their own (currently empty) base set from
 *  lib/transform-surface.ts — these anchor in main and would all miss. */
const ALL_PATCHES: readonly Record<string, unknown>[] = [
  ...BRIDGE_PATCHES,
] as unknown as readonly Record<string, unknown>[];

export interface DemoTransformResult {
  /** Bundle source to serve (transformed code, or the original on failure). */
  readonly code: string;
  readonly transformed: boolean;
  readonly detail: string;
  /** sha256 of the ORIGINAL upstream bundle (`sha256:`-prefixed) — surfaced for
   *  observability (`x-tspml-vanilla-hash`); the fail-closed gate's input. */
  readonly vanillaHash: string;
  /** Per-mod user-mixin outcome; null when no user sets were passed (the plain
   *  GET path — its served bytes are identical to pre-#62). */
  readonly userReport: UserMixinReport | null;
}

/** A user patch that failed before reaching the engine (resolution/pre-screen). */
interface PreFailed {
  readonly reason: string;
  readonly detail: string;
}

/** One mod's engine-ready patches plus its pre-failures, index range assigned
 *  once the combined patch array is final. */
interface PreparedSet {
  readonly modId: string;
  readonly declared: number;
  readonly patches: Patch[];
  readonly preFailed: PreFailed[];
  startIndex: number;
}

function truncate(s: string): string {
  return s.length > DETAIL_CAP ? `${s.slice(0, DETAIL_CAP - 1)}…` : s;
}

function failedEntry(reason: string, detail: string): { reason: string; detail: string } {
  return { reason, detail: truncate(detail) };
}

/** Build the per-mod report rows from engine results + pre-failures. */
function buildModReports(
  sets: readonly PreparedSet[],
  applied: readonly PatchResult[],
  failed: readonly PatchResult[],
): UserMixinModReport[] {
  const appliedByIndex = new Set(applied.map((r) => r.index));
  const failedByIndex = new Map(failed.map((r) => [r.index, r]));
  return sets.map((set) => {
    const failures: { reason: string; detail: string }[] = set.preFailed.map((f) =>
      failedEntry(f.reason, f.detail),
    );
    let appliedCount = 0;
    for (let i = 0; i < set.patches.length; i++) {
      const index = set.startIndex + i;
      if (appliedByIndex.has(index)) {
        appliedCount++;
      } else {
        const f = failedByIndex.get(index);
        failures.push(failedEntry(f?.reason ?? "unknown", f?.detail ?? "no engine result for this patch"));
      }
    }
    const overflow = failures.length - FAILED_ENTRIES_CAP;
    const capped = overflow > 0 ? failures.slice(0, FAILED_ENTRIES_CAP) : failures;
    if (overflow > 0) capped.push(failedEntry("truncated", `${overflow} more failure(s) omitted`));
    return { modId: set.modId, declared: set.declared, applied: appliedCount, failed: capped };
  });
}

/** Every mod reported failed with one shared reason (plan-level refusals). */
function allFailed(
  sets: readonly UserPatchSet[],
  planStatus: UserMixinReport["planStatus"],
  reason: string,
  detail: string,
): UserMixinReport {
  return {
    v: 1,
    planStatus,
    mods: sets.map((s) => ({
      modId: s.modId,
      declared: s.patches.length,
      applied: 0,
      failed: [failedEntry(reason, detail)],
    })),
  };
}

/** The engine functions `composeTransform` needs — injected by the wrapper
 *  (dynamic import) and by the unit tests (static import). */
export interface EngineFns {
  readonly transform: typeof import("@tspml/transform").transform;
  readonly targetSignature: typeof import("@tspml/transform").targetSignature;
}

/**
 * The whole compose: base + user patches in ONE engine pass, per the contracts
 * in the file header. Pure and synchronous given the engine — exported so the
 * unit tests can drive it with a synthetic bundle + map (the wrapper below
 * binds the real pinned MAP, whose hash no test fixture can match).
 */
export function composeTransform(
  engine: EngineFns,
  bundleSource: string,
  declaredBase: readonly Record<string, unknown>[],
  userSets: readonly UserPatchSet[],
  map: GameMap,
  liveHash: string,
  surface: TransformSurface,
): Omit<DemoTransformResult, "vanillaHash"> {
  const { transform, targetSignature } = engine;
  const wantReport = userSets.length > 0;
  // FAIL-CLOSED: hash-gate the transform to THIS SURFACE's pin — the main bundle's
  // for main, the chunk's own for a chunk (#98). On any mismatch the engine applies
  // nothing and returns the original source (failedReason 'hash-mismatch'), so the
  // minified-param injects can never run against bytes they weren't authored for.
  // Resolve mod-declared `{symbol}` patches via the map (fail-closed); inline
  // patches pass through. Dropped (unresolvable) patches are filtered out.
  const patches = declaredBase
    .map((p) => resolveDeclaredPatch(p, map, liveHash, surface))
    .filter((r): r is { ok: true; patch: Patch } => r.ok)
    .map((r) => r.patch);

  // ── #62: prepare user sets ──────────────────────────────────────────────
  // Base target signatures, for the replace pre-screen (see file header).
  const baseSignatures = new Set(patches.map((p) => targetSignature(p.target)));
  const prepared: PreparedSet[] = userSets.map((set) => {
    const ready: Patch[] = [];
    const preFailed: PreFailed[] = [];
    for (const raw of set.patches) {
      const r = resolveDeclaredPatch(raw, map, liveHash, surface);
      if (!r.ok) {
        preFailed.push({
          reason: r.reason,
          detail:
            r.reason === "symbol-not-on-this-surface"
              ? `symbol '${String(raw.symbol)}' names a target verified against ${symbolSurface(map, raw.symbol)}, not ${surface.file}; its anchor says nothing about this file — use an inline anchor here`
              : `symbol '${String(raw.symbol)}' did not resolve against the pinned map (stale map or unknown name)`,
        });
        continue;
      }
      const resolved = r.patch;
      if (resolved.op === "replace" && baseSignatures.has(targetSignature(resolved.target))) {
        preFailed.push({
          reason: "conflicts-with-loader-patch",
          detail:
            "replace targets a method the loader's bridge patches inject into — applying it would silently erase the bridge hook",
        });
        continue;
      }
      ready.push(resolved);
    }
    return { modId: set.modId, declared: set.patches.length, patches: ready, preFailed, startIndex: 0 };
  });
  const combined: Patch[] = [...patches];
  for (const set of prepared) {
    set.startIndex = combined.length;
    combined.push(...set.patches);
  }

  const r = transform(bundleSource, combined, {
    bundleHash: liveHash,
    expectedBundleHash: surface.expectedHash,
    compact: true,
    filename: surface.file,
  });
  if (r.failedReason === "hash-mismatch") {
    return {
      code: bundleSource,
      transformed: false,
      detail: `hash-mismatch: live ${liveHash} ≠ expected ${surface.expectedHash} — serving ${surface.file} vanilla`,
      userReport: wantReport
        ? allFailed(
            userSets,
            "base-failed",
            "hash-mismatch",
            `live ${surface.file} is not the pinned 0.6.2 build — nothing was applied to it`,
          )
        : null,
    };
  }

  const appliedIndices = new Set(r.applied.map((a) => a.index));
  const baseAllApplied = patches.every((_, i) => appliedIndices.has(i));
  const detail = r.applied.map((a) => a?.detail).concat(r.failed.map((f) => f.detail)).join(" | ");

  if (baseAllApplied && r.outputValid) {
    return {
      code: r.code,
      transformed: true,
      detail,
      userReport: wantReport
        ? { v: 1, planStatus: "applied", mods: buildModReports(prepared, r.applied, r.failed) }
        : null,
    };
  }

  // Base applied but the combined output failed the re-parse gate: a user
  // inject broke codegen in a way the engine's per-patch checks missed.
  // Retry base-only so the session still gets the bridge (today's bundle),
  // and blame the user patches honestly (v1 blames all; per-mod bisection is
  // a follow-up — this path requires an inject that PARSES standalone but
  // breaks the whole-bundle regeneration, which bad-inject-source screening
  // makes rare).
  if (baseAllApplied && !r.outputValid && wantReport && combined.length > patches.length) {
    const retry = transform(bundleSource, patches, {
      bundleHash: liveHash,
      expectedBundleHash: surface.expectedHash,
      compact: true,
      filename: surface.file,
    });
    if (retry.outputValid && retry.applied.length === patches.length) {
      return {
        code: retry.code,
        transformed: true,
        detail: `combined output failed re-parse; served base-only retry`,
        userReport: allFailed(
          userSets,
          "output-invalid",
          "output-invalid",
          "combined output failed the re-parse gate — user patches discarded, base transform served",
        ),
      };
    }
  }

  return {
    code: bundleSource,
    transformed: false,
    detail: `transform did not apply cleanly (${r.applied.length}/${combined.length} applied): ${detail}`,
    userReport: wantReport
      ? allFailed(userSets, "base-failed", "base-failed", "the base transform did not apply cleanly — serving vanilla")
      : null,
  };
}

/** The MAIN-bundle surface, resolved once off the pinned map. */
export const MAIN_SURFACE: TransformSurface = (() => {
  const s = transformSurfaceFor(MAP, true, ["main.bundle.js"]);
  /* c8 ignore next */
  if (!s) throw new Error("main.bundle.js is not a transform surface — impossible");
  return s;
})();

/**
 * The surface for a proxied path against the pinned map, or null when the request
 * must be proxied verbatim (#98). Thin wrapper binding the real MAP so callers that
 * do not hold one (the route) need not import it.
 */
export function surfaceForPath(
  isDefaultHost: boolean,
  segments: readonly string[],
): TransformSurface | null {
  return transformSurfaceFor(MAP, isDefaultHost, segments);
}

/**
 * Apply the demo transform to one surface's bytes. NEVER throws: on any failure it
 * returns the original source unchanged (transformed=false) so the game still loads
 * vanilla.
 *
 * @tspml/transform is imported dynamically so @babel/* stays out of the route's
 * bundle unless transform mode is actually on.
 */
export async function applyDemoTransform(
  bundleSource: string,
  userSets: readonly UserPatchSet[] = [],
  surface: TransformSurface = MAIN_SURFACE,
): Promise<DemoTransformResult> {
  const vanillaHash = `sha256:${createHash("sha256").update(bundleSource).digest("hex")}`;
  const base = surface.kind === "main" ? ALL_PATCHES : surface.basePatches;
  // Nothing to do: a chunk with no base patches (the state until #87 Phase C) and no
  // user sets. Skipping the pass is not just an optimization — parsing and
  // regenerating ~100 KB of minified code to emit identical semantics is a round-trip
  // whose only possible outcomes are "unchanged" and "broken". Report it honestly as
  // untransformed rather than claiming a transform that applied nothing.
  if (base.length === 0 && userSets.length === 0) {
    return {
      code: bundleSource,
      transformed: false,
      detail: `no patches target ${surface.file} — served unmodified`,
      vanillaHash,
      userReport: null,
    };
  }
  try {
    const engine = await import("@tspml/transform");
    const r = composeTransform(engine, bundleSource, base, userSets, MAP, vanillaHash, surface);
    return { ...r, vanillaHash };
  } catch (err) {
    return {
      code: bundleSource,
      transformed: false,
      detail: `transform threw: ${(err as Error).message}`,
      vanillaHash,
      userReport: userSets.length > 0
        ? allFailed(userSets, "base-failed", "transform-threw", (err as Error).message)
        : null,
    };
  }
}
