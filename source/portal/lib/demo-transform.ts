/**
 * @tspml/portal — demo transform for the browser test.
 *
 * Rewrites the PolyTrack main bundle to inject a VISIBLE on-screen marker +
 * console log via @tspml/transform. Purpose: prove that a *transformed* game
 * bundle still boots and plays in a browser — "parse-valid" (node --check) is
 * NOT "run-valid", and only a real browser load can confirm the latter.
 *
 * Gated by the TSPML_TRANSFORM env in the proxy route. The patch is an `after`
 * on the Car-protocol module FACTORY (module-load intercept): it appends a
 * self-contained IIFE at the end of the factory body, leaving the original
 * logic and any "use strict" prologue intact, and runs once when the module
 * loads during boot. Verified on the real 0.6.2 bundle (applies to module 5220,
 * node --check passes).
 */
import type { Patch } from "@tspml/transform";

const MARKER_ID = "tspml-live-marker";

// Inject payload: a self-contained IIFE. Appended at the END of the Car module's
// factory body, so it runs once when the module loads (≈ game boot) and never
// interferes with the factory's own logic. Keep it side-effect-only.
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

const DEMO_PATCH = {
  op: "after",
  target: {
    anchor: { literals: ["CreateCar", "ControlCar", "TestDeterminism"], minHits: 3 },
    selector: { kind: "factory" },
  },
  inject: MARKER_INJECT,
} as const satisfies Patch;

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
    const r = transform(bundleSource, [DEMO_PATCH], {
      compact: true,
      filename: "main.bundle.js",
    });
    const applied = r.applied[0];
    const failed = r.failed[0];
    const detail = applied?.detail ?? failed?.detail ?? "no-op";
    if (r.outputValid && applied) {
      return { code: r.code, transformed: true, detail };
    }
    return {
      code: bundleSource,
      transformed: false,
      detail: `transform did not apply cleanly: ${detail}`,
    };
  } catch (err) {
    return {
      code: bundleSource,
      transformed: false,
      detail: `transform threw: ${(err as Error).message}`,
    };
  }
}
