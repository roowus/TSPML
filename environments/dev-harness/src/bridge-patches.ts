/**
 * @tspml/dev-harness — the Tier-1 bridge patches.
 *
 * These are the SAME loader-owned patches the portal applies
 * (source/portal/lib/demo-transform.ts): a visible badge + the six Tier-1 event
 * emits (car.control/created, race.started, track.afterLoad, checkpoint.passed,
 * race.finished). They are hash-gated to the pinned 0.6.2 bundle, so they are
 * stable until the next PolyTrack release (at which point the M9 regen pipeline
 * reviews them).
 *
 * TODO(extract, #34): these + the portal's are one body of code. Extract to
 * @tspml/shared so the portal and this harness share a single source of truth.
 * Until then this is an intentional, attributed copy — the harness must not
 * churn the portal (which another session may have open).
 */
import type { Patch } from "@tspml/transform";

const MARKER_ID = "tspml-live-marker";

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

const CAR_ANCHOR = {
  anchor: { literals: ["CreateCar", "ControlCar", "TestDeterminism"], minHits: 3 },
};

const EMIT = (body: string) =>
  `try { if (typeof window !== "undefined" && window.__tspml && window.__tspml.events.emit) { ${body} } } catch (_e) {}`;

/** The loader-owned bridge patches (badge + Tier-1 events). All hash-gated to 0.6.2
 *  by applyTransform (game-proxy.ts), so the minified param names are safe. */
export const BRIDGE_PATCHES: readonly Patch[] = [
  {
    op: "after",
    target: { ...CAR_ANCHOR, selector: { kind: "factory" } },
    inject: MARKER_INJECT,
  },
  {
    op: "before",
    target: { ...CAR_ANCHOR, selector: { kind: "method", name: "controlCar" } },
    // controlCar(e=carId, t=up, n=right, i=down, a=left, s=reset)
    inject: EMIT(
      `window.__tspml.events.emit("car.control", { carId: e, up: !!t, right: !!n, down: !!i, left: !!a, reset: !!s });`,
    ),
  },
  {
    op: "modifyReturn",
    target: { ...CAR_ANCHOR, selector: { kind: "method", name: "createCar" } },
    // s (5th param = carRecording) in scope at the return; non-null => ghost/replay.
    wrap: `((__v) => { try { if (typeof window !== 'undefined' && window.__tspml && window.__tspml.events.emit && __v && __v.id != null) window.__tspml.events.emit('car.created', { carId: __v.id, isReplay: s != null }); } catch (_e) {} return __v; })`,
  },
  {
    op: "before",
    target: {
      anchor: { literals: ["skidding", "engine", "tires", "BrakeLight"], minHits: 3 },
      selector: { kind: "method", name: "start" },
    },
    inject: EMIT(`window.__tspml.events.emit("race.started");`),
  },
  {
    op: "after",
    target: {
      anchor: {
        literals: [
          "Track part color does not exist",
          "Track part below ground",
          "Checkpoint has no detector",
          "Track part index out of bounds",
        ],
        minHits: 3,
      },
      selector: { kind: "method", name: "loadTrackData" },
    },
    inject: EMIT(
      `var __tid = ''; try { __tid = (e && typeof e.getId === 'function') ? e.getId() : ''; } catch (_) {} window.__tspml.events.emit("track.afterLoad", __tid);`,
    ),
  },
  {
    op: "before",
    target: {
      anchor: { literals: ["skidding", "engine", "tires", "BrakeLight"], minHits: 3 },
      selector: { kind: "method", name: "setCarState" },
    },
    inject: EMIT(
      `if (e) { if (e.nextCheckpointIndex != null && typeof this.getNextCheckpointIndex === 'function' && e.nextCheckpointIndex > this.getNextCheckpointIndex()) window.__tspml.events.emit('checkpoint.passed', this.getNextCheckpointIndex()); if (e.finishFrames != null && typeof this.hasFinished === 'function' && !this.hasFinished()) window.__tspml.events.emit('race.finished', { frames: e.finishFrames }); }`,
    ),
  },
];
