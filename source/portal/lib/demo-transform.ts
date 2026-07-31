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

// ── M4-D/E: more Tier-1 events ───────────────────────────────────────────────
// All hash-gated to 0.6.2 by applyDemoTransform (below), so the minified param
// names referenced here are safe — a different build fails closed.

// car.created: createCar returns {id, carState}; carId is in the RETURN value,
// so modifyReturn wraps it: `return X` -> `return (wrap)(X)`. The wrap emits
// then returns X unchanged. `s` (5th param = carRecording) is in scope at the
// return; non-null => ghost/replay car.
const CAR_CREATED_WRAP =
  "((__v) => { try { if (typeof window !== 'undefined' && window.__tspml && window.__tspml.emit && __v && __v.id != null) window.__tspml.emit('car.created', { carId: __v.id, isReplay: s != null }); } catch (_e) {} return __v; })";
const CAR_CREATED_PATCH = {
  op: "modifyReturn",
  target: {
    anchor: { literals: ["CreateCar", "ControlCar", "TestDeterminism"], minHits: 3 },
    selector: { kind: "method", name: "createCar" },
  },
  wrap: CAR_CREATED_WRAP,
} as const satisfies Patch;

// race.started: fires on a Car's start() — for the PLAYER on first throttle
// (caller guards !hasStarted()), but ALSO for ghost/replay cars at their
// creation (they call start() unconditionally). So it's PER-CAR, not a singleton
// "race began" signal; player-only filtering needs an isReplay accessor (TODO).
// No payload.
const RACE_STARTED_INJECT =
  "try { if (typeof window !== 'undefined' && window.__tspml && window.__tspml.emit) window.__tspml.emit('race.started'); } catch (_e) {}";
const RACE_STARTED_PATCH = {
  op: "before",
  target: {
    anchor: { literals: ["skidding", "engine", "tires", "BrakeLight"], minHits: 3 },
    selector: { kind: "method", name: "start" },
  },
  inject: RACE_STARTED_INJECT,
} as const satisfies Patch;

// track.afterLoad: loadTrackData returns true after parsing the track; emit at
// the tail (before the return). `e` is the parsed track data (in scope there).
const TRACK_AFTERLOAD_INJECT =
  "try { if (typeof window !== 'undefined' && window.__tspml && window.__tspml.emit) { var __tid = ''; try { __tid = (e && typeof e.getId === 'function') ? e.getId() : ''; } catch (_) {} window.__tspml.emit('track.afterLoad', __tid); } } catch (_e) {}";
const TRACK_AFTERLOAD_PATCH = {
  op: "after",
  target: {
    anchor: {
      literals: ["Track part color does not exist", "Track part below ground", "Checkpoint has no detector", "Track part index out of bounds"],
      minHits: 3,
    },
    selector: { kind: "method", name: "loadTrackData" },
  },
  inject: TRACK_AFTERLOAD_INJECT,
} as const satisfies Patch;

// checkpoint.passed + race.finished: both are detected by DIFFING carState
// inside setCarState (a per-frame method), so ONE before-inject guards both
// transitions (cheap: a couple field reads on the hot path). At the HEAD,
// this.te is still the OLD state (getNextCheckpointIndex()/hasFinished() read
// old); `e` is the NEW carState. PER-CAR: fires for the player AND ghosts
// (setCarState runs for every car); these carry no isReplay discriminator
// (carId/replay is a private field here), unlike car.created. Player-only
// filtering needs an isReplay accessor (TODO).
const CHECKPOINT_FINISH_INJECT =
  "try { if (typeof window !== 'undefined' && window.__tspml && window.__tspml.emit && e) {" +
  " if (e.nextCheckpointIndex != null && typeof this.getNextCheckpointIndex === 'function' && e.nextCheckpointIndex > this.getNextCheckpointIndex()) window.__tspml.emit('checkpoint.passed', this.getNextCheckpointIndex());" +
  " if (e.finishFrames != null && typeof this.hasFinished === 'function' && !this.hasFinished()) window.__tspml.emit('race.finished', { frames: e.finishFrames });" +
  " } } catch (_e) {}";
const CHECKPOINT_FINISH_PATCH = {
  op: "before",
  target: {
    // Module 641 (the car-controller) located by its STRING-DATA literals (audio
    // buffer / material names) — NOT method names: the locator matches string
    // literals, and addCheckpointCallback/setCarState are identifiers. This is
    // the same module race.started's `start` lives in; setCarState is its peer.
    anchor: { literals: ["skidding", "engine", "tires", "BrakeLight"], minHits: 3 },
    selector: { kind: "method", name: "setCarState" },
  },
  inject: CHECKPOINT_FINISH_INJECT,
} as const satisfies Patch;

/** The demo patches, applied together (badge + Tier-1 event emits). */
const DEMO_PATCHES: readonly Patch[] = [
  BADGE_PATCH,
  CONTROL_PATCH,
  CAR_CREATED_PATCH,
  RACE_STARTED_PATCH,
  TRACK_AFTERLOAD_PATCH,
  CHECKPOINT_FINISH_PATCH,
];

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
