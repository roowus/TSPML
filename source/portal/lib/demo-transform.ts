/**
 * @tspml/portal — demo transform for the browser test.
 *
 * Rewrites the PolyTrack main bundle to (1) inject a VISIBLE on-screen marker +
 * console log, proving a *transformed* bundle boots/runs, and (2) [M4-B] emit a
 * `car.control` event every frame from the Car module's `controlCar` method —
 * the first real mod event fired from inside the running game. The event flows
 * to a Tier-1 `EventBus` the portal exposes on the iframe as `window.__tspml`
 * (see app/page.tsx), which mods subscribe to.
 *
 * Gated by the TSPML_TRANSFORM env in the proxy route. Both patches target the
 * Car module (anchored by its protocol-enum literals). Verified on the real
 * 0.6.2 bundle (applies to module 5220, node --check passes).
 */
import type { Patch } from "@tspml/transform";
import { createHash } from "node:crypto";

const MARKER_ID = "tspml-live-marker";

/**
 * Pinned sha256 of the 0.6.2 main bundle — the same value in
 * source/mappings/maps/polytrack-0.6.2.json. The demo HASH-GATES against it so
 * the inject below never runs against a bundle whose minified params differ
 * (fail-closed: a mismatch makes the engine return the original, vanilla bundle).
 */
const EXPECTED_0_6_2_BUNDLE_HASH =
  "sha256:8495e6a31cfb66b55861188bd8041b38479ee5b50bd412cc1f6c2b17229f6488";

// Inject payload #1: a self-contained IIFE appended at the END of the Car
// module's factory body — runs once at module load (≈ boot), side-effect only.
const MARKER_INJECT = `
(function () {
  try {
    if (typeof document === "undefined") return;
    if (document.getElementById(${JSON.stringify(MARKER_ID)})) return;
    var b = document.createElement("div");
    b.id = ${JSON.stringify(MARKER_ID)};
    b.textContent = "TSPML transform ✔ LIVE";
    b.style.cssText =
      "position:fixed;top:0;left:0;z-index:2147483647;background:#041408;" +
      "color:#39ff14;font:600 13px ui-monospace,Menlo,monospace;padding:6px 10px;" +
      "border-bottom-right-radius:6px;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,.4)";
    (document.body || document.documentElement).appendChild(b);
  } catch (e) {}
  try {
    if (typeof console !== "undefined")
      console.log("%c[TSPML] transform hook fired — Car module loaded", "color:#39ff14");
  } catch (e) {}
})();
`.trim();

const BADGE_PATCH = {
  op: "after",
  target: {
    anchor: { literals: ["CreateCar", "ControlCar", "TestDeterminism"], minHits: 3 },
    selector: { kind: "factory" },
  },
  inject: MARKER_INJECT,
} as const satisfies Patch;

// Inject payload #2 [M4-B]: emit `car.control` each call. `before` on the Car
// module's `controlCar` runs once per call at the head of the body, where the
// minified params are in scope: controlCar(e=carId, t=up, n=right, i=down,
// a=left, s=reset). Referencing those exact names is safe because
// applyDemoTransform HASH-GATES the transform to this 0.6.2 bundle (live
// bundleHash vs EXPECTED_0_6_2_BUNDLE_HASH) — a different build fails closed
// (hash-mismatch) and the demo serves vanilla, so this inject never runs
// against mismatched params. `window.__tspml` is set by the portal
// (app/page.tsx); until then (and in non-portal deliveries) this is a no-op.
const CONTROL_EMIT = `
try {
  if (typeof window !== "undefined" && window.__tspml && window.__tspml.emit)
    window.__tspml.emit("car.control", { carId: e, up: !!t, right: !!n, down: !!i, left: !!a, reset: !!s });
} catch (_tspmlErr) {}
`.trim();

const CONTROL_PATCH = {
  op: "before",
  target: {
    anchor: { literals: ["CreateCar", "ControlCar", "TestDeterminism"], minHits: 3 },
    selector: { kind: "method", name: "controlCar" },
  },
  inject: CONTROL_EMIT,
} as const satisfies Patch;

/** The demo patches, applied together (badge + car.control emit). */
const DEMO_PATCHES: readonly Patch[] = [BADGE_PATCH, CONTROL_PATCH];

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
    // FAIL-CLOSED: hash-gate the transform to the pinned 0.6.2 bundle. On any
    // mismatch the engine applies nothing and returns the original source
    // (failedReason 'hash-mismatch'), so the minified-param inject below can
    // never run against a bundle it wasn't authored for.
    const liveHash = `sha256:${createHash("sha256").update(bundleSource).digest("hex")}`;
    const r = transform(bundleSource, DEMO_PATCHES, {
      bundleHash: liveHash,
      expectedBundleHash: EXPECTED_0_6_2_BUNDLE_HASH,
      compact: true,
      filename: "main.bundle.js",
    });
    if (r.failedReason === "hash-mismatch") {
      return {
        code: bundleSource,
        transformed: false,
        detail: `hash-mismatch: live ${liveHash} ≠ expected ${EXPECTED_0_6_2_BUNDLE_HASH} — serving vanilla`,
      };
    }
    const detail = r.applied.map((a) => a?.detail).concat(r.failed.map((f) => f.detail)).join(" | ");
    if (r.outputValid && r.applied.length === DEMO_PATCHES.length) {
      return { code: r.code, transformed: true, detail };
    }
    return {
      code: bundleSource,
      transformed: false,
      detail: `transform did not apply cleanly (${r.applied.length}/${DEMO_PATCHES.length} applied): ${detail}`,
    };
  } catch (err) {
    return {
      code: bundleSource,
      transformed: false,
      detail: `transform threw: ${(err as Error).message}`,
    };
  }
}
