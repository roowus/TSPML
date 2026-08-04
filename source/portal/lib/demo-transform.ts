/**
 * @tspml/portal — the portal's bundle transform.
 *
 * Rewrites the PolyTrack main bundle with the loader-owned bridge patches (the LIVE
 * badge, the six Tier-1 event emits, and the custom-track capture patches) plus
 * whatever Tier-2 mixins the loaded mods declare. Emitted events flow to the Tier-1
 * `EventBus` the portal exposes on the iframe as `window.__tspml` (see app/page.tsx),
 * which mods subscribe to.
 *
 * The patches themselves now live in **@tspml/shared** — this file is only the
 * portal-specific half: mappings `{symbol}` resolution and the fail-closed sha256
 * hash-gate. Until #34 the patch bodies were duplicated here and in the dev harness,
 * and had already drifted (the harness had the capture patches; the portal did not).
 *
 * Gated by the TSPML_TRANSFORM env in the proxy route.
 */
import type { Patch } from "@tspml/transform";
import { createHash } from "node:crypto";
import { resolveTarget, validateMap } from "@tspml/mappings";
import type { GameMap } from "@tspml/mappings";
// Imported directly (not loadDefaultMap, which uses import.meta.url and breaks
// under Next's bundler) + validated once at module load.
import mapJson from "@tspml/mappings/maps/polytrack-0.6.2.json";
// Badge + Tier-1 emits + the track-capture patches, shared with the dev harness (#34).
// The proxy route must ALSO inject @tspml/shared's EARLY_CAPTURE_SCRIPT_TAG, or the
// codec capture below fires before the bridge exists and is silently dropped.
import { BRIDGE_PATCHES } from "@tspml/shared";
import { MOD_MIXIN_PATCHES } from "./demo-mods";

const MAP: GameMap = validateMap(mapJson);

/**
 * Resolve a declared patch to a concrete `Patch`. An inline-anchor patch passes
 * through unchanged; a `{ symbol }` patch (M5-C) is resolved fail-closed via the
 * map — returns `null` on stale-map/not-found (the patch is dropped, never
 * applied against a mismatched/wrong target).
 */
function resolveDeclaredPatch(
  p: Record<string, unknown>,
  map: GameMap,
  liveHash: string,
): Patch | null {
  if (typeof p.symbol === "string") {
    const res = resolveTarget(map, p.symbol, { bundleHash: liveHash });
    if (!res.ok) return null; // fail-closed
    const rest = { ...p };
    delete rest.symbol;
    return { ...rest, target: res.target } as unknown as Patch;
  }
  return p as unknown as Patch;
}

/** All applied patches: the shared bridge patches PLUS mod-declared mixins (M5-A).
 *  Loosely typed — mod-declared patches may use `{symbol}` (M5-C) resolved in
 *  applyDemoTransform, or inline anchors. */
const ALL_PATCHES: readonly Record<string, unknown>[] = [
  ...BRIDGE_PATCHES,
  ...MOD_MIXIN_PATCHES,
] as readonly Record<string, unknown>[];

export interface DemoTransformResult {
  /** Bundle source to serve (transformed code, or the original on failure). */
  readonly code: string;
  readonly transformed: boolean;
  readonly detail: string;
}

/**
 * Apply the demo transform. NEVER throws: on any failure it returns the original
 * bundle unchanged (transformed=false) so the game still loads vanilla.
 *
 * @tspml/transform is imported dynamically so @babel/* stays out of the route's
 * bundle unless transform mode is actually on.
 */
export async function applyDemoTransform(
  bundleSource: string,
): Promise<DemoTransformResult> {
  try {
    const { transform } = await import("@tspml/transform");
    // FAIL-CLOSED: hash-gate the transform to the pinned 0.6.2 bundle (the
    // map's bundleHash). On any mismatch the engine applies nothing and returns
    // the original source (failedReason 'hash-mismatch'), so the minified-param
    // inject below can never run against a bundle it wasn't authored for.
    const liveHash = `sha256:${createHash("sha256").update(bundleSource).digest("hex")}`;
    // Resolve mod-declared `{symbol}` patches via the map (fail-closed); inline
    // patches pass through. Dropped (unresolvable) patches are filtered out.
    const patches = ALL_PATCHES.map((p) => resolveDeclaredPatch(p, MAP, liveHash)).filter(
      (p): p is Patch => p !== null,
    );
    const r = transform(bundleSource, patches, {
      bundleHash: liveHash,
      expectedBundleHash: MAP.bundleHash,
      compact: true,
      filename: "main.bundle.js",
    });
    if (r.failedReason === "hash-mismatch") {
      return {
        code: bundleSource,
        transformed: false,
        detail: `hash-mismatch: live ${liveHash} ≠ expected ${MAP.bundleHash} — serving vanilla`,
      };
    }
    const detail = r.applied.map((a) => a?.detail).concat(r.failed.map((f) => f.detail)).join(" | ");
    if (r.outputValid && r.applied.length === patches.length) {
      return { code: r.code, transformed: true, detail };
    }
    return {
      code: bundleSource,
      transformed: false,
      detail: `transform did not apply cleanly (${r.applied.length}/${patches.length} applied): ${detail}`,
    };
  } catch (err) {
    return {
      code: bundleSource,
      transformed: false,
      detail: `transform threw: ${(err as Error).message}`,
    };
  }
}
