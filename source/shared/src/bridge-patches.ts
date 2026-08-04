/**
 * The loader-owned Tier-1 bridge patches — the SINGLE source of truth for what
 * TSPML injects into the game bundle, shared by every delivery surface
 * (portal, dev harness, and the extension when it grows a transform).
 *
 * Previously the portal (`lib/demo-transform.ts`) and the dev harness
 * (`src/bridge-patches.ts`) each carried a copy. They had already drifted — the
 * harness gained the two custom-track capture patches (#12) that the portal
 * lacked — which is exactly the failure mode [#34] predicted. One copy now.
 *
 * ## Why the minified param names below are safe
 *
 * Several injects reference the bundle's minified parameters (`e`, `t`, `n`, `s`,
 * `a`). That is only sound because every caller HASH-GATES the transform to the
 * pinned bundle recorded in the mappings map: on a hash mismatch the engine
 * applies nothing and the surface serves vanilla, so an inject can never run
 * against a build it was not authored for. If you add a patch here, keep that
 * contract — see docs/design/mappings-system.md. Making these robust to renames
 * is tracked in [#24].
 *
 * ## Anchor discipline
 *
 * Module anchors match string/numeric LITERALS only (never identifiers), and a
 * literal that also appears in another module silently resolves to the WRONG one.
 * Prefer several narrow literals with a matching `minHits`; the codec patch below
 * documents a real instance of this biting.
 *
 * [#24]: https://github.com/roowus/TSPML/issues/24
 * [#34]: https://github.com/roowus/TSPML/issues/34
 */
import type { Patch } from "@tspml/transform";

const MARKER_ID = "tspml-live-marker";

/**
 * A visible on-screen badge + console log, proving a *transformed* bundle boots.
 * Appended at the END of the Car module's factory body, so it runs once at module
 * load (≈ boot) and is side-effect only.
 */
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

/** The Car module (5220), anchored by its protocol-enum literals. */
const CAR_ANCHOR = {
  anchor: { literals: ["CreateCar", "ControlCar", "TestDeterminism"], minHits: 3 },
} as const;

/**
 * The car-controller module (641), located by its string-DATA literals (audio
 * buffer / material names) — NOT by method names: the locator matches string
 * literals, and `setCarState`/`start` are identifiers. `start` and `setCarState`
 * are peers in this module.
 */
const CAR_CONTROLLER_ANCHOR = {
  anchor: { literals: ["skidding", "engine", "tires", "BrakeLight"], minHits: 3 },
} as const;

/** Wrap an emit in the standard guard: no bridge yet (or vanilla) => silent no-op. */
const EMIT = (body: string): string =>
  `try { if (typeof window !== "undefined" && window.__tspml && window.__tspml.events.emit) { ${body} } } catch (_e) {}`;

/**
 * Badge + the six Tier-1 event emits.
 *
 * `car.control` and `car.created` come from the Car module; `race.started`,
 * `checkpoint.passed` and `race.finished` from the car-controller;
 * `track.afterLoad` from the track-data loader.
 *
 * PER-CAR caveat ([#10]): `race.started`, `checkpoint.passed` and `race.finished`
 * fire for ghost/replay cars as well as the player, and (unlike `car.created`)
 * carry no `isReplay` discriminator — the replay flag is a private field at those
 * sites. Player-only filtering needs an accessor.
 *
 * [#10]: https://github.com/roowus/TSPML/issues/10
 */
export const TIER1_BRIDGE_PATCHES: readonly Patch[] = [
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
    // createCar returns {id, carState}, so the carId is in the RETURN value:
    // modifyReturn rewrites `return X` -> `return (wrap)(X)`. `s` (5th param =
    // carRecording) is still in scope at the return; non-null => ghost/replay.
    wrap: `((__v) => { try { if (typeof window !== 'undefined' && window.__tspml && window.__tspml.events.emit && __v && __v.id != null) window.__tspml.events.emit('car.created', { carId: __v.id, isReplay: s != null }); } catch (_e) {} return __v; })`,
  },
  {
    op: "before",
    // Fires on a Car's start() — for the player on first throttle (the caller
    // guards !hasStarted()), but ALSO for ghost cars at their creation, which call
    // start() unconditionally. So it is per-car, not a singleton "race began".
    target: { ...CAR_CONTROLLER_ANCHOR, selector: { kind: "method", name: "start" } },
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
    // At the tail (before the return), `e` is the parsed track data.
    inject: EMIT(
      `var __tid = ''; try { __tid = (e && typeof e.getId === 'function') ? e.getId() : ''; } catch (_) {} window.__tspml.events.emit("track.afterLoad", __tid);`,
    ),
  },
  {
    op: "before",
    // checkpoint.passed + race.finished are both detected by DIFFING carState
    // inside setCarState (a per-frame method), so ONE inject guards both
    // transitions (cheap: a couple of field reads on the hot path). At the HEAD
    // the instance still holds the OLD state — getNextCheckpointIndex() and
    // hasFinished() read it — while `e` is the NEW carState.
    target: { ...CAR_CONTROLLER_ANCHOR, selector: { kind: "method", name: "setCarState" } },
    inject: EMIT(
      `if (e) { if (e.nextCheckpointIndex != null && typeof this.getNextCheckpointIndex === 'function' && e.nextCheckpointIndex > this.getNextCheckpointIndex()) window.__tspml.events.emit('checkpoint.passed', this.getNextCheckpointIndex()); if (e.finishFrames != null && typeof this.hasFinished === 'function' && !this.hasFinished()) window.__tspml.events.emit('race.finished', { frames: e.finishFrames }); }`,
    ),
  },
];

/**
 * The custom-track registry's capture patches (#12).
 *
 * The game's TrackManager lives in the BOOTSTRAP, past the wall the module
 * locator cannot reach (the same wall [#11] hits for audio). Its CALLERS are real
 * modules, though — so rather than locating the class, capture the live instance
 * as it is handed to a caller. Generalized as "instance capture" in
 * docs/design/hook-system.md.
 *
 * Both patches only READ a reference into `window.__tspml`; neither changes game
 * behaviour.
 *
 * TIMING: these two fire at very different points. The manager is captured when
 * the game builds its track-selection menu (late), but the codec's module factory
 * runs during BUNDLE INIT — before a surface's own `load` handler installs the
 * real bridge. A surface must therefore inject {@link EARLY_CAPTURE_STUB} ahead of
 * the game's scripts and replay what it recorded, or the codec capture is silently
 * dropped and the registry never attaches.
 *
 * [#11]: https://github.com/roowus/TSPML/issues/11
 */
export const TRACK_CAPTURE_PATCHES: readonly Patch[] = [
  {
    op: "before",
    target: {
      anchor: {
        literals: ["Custom tracks", "No custom tracks", "Official tracks", "Community tracks"],
        minHits: 3,
      },
      selector: { kind: "method", name: "constructor" },
    },
    // The track-selection UI (module 8185): constructor(e,t,n,r,a,...) — `a` is
    // the TrackManager. The captured object exposes saveCustomTrack /
    // deleteCustomTrack / forEachCustomTrack.
    inject: `try { if (typeof window !== "undefined" && window.__tspml && window.__tspml.captureTrackManager) window.__tspml.captureTrackManager(a); } catch (_e) {}`,
  },
  {
    op: "after",
    target: {
      anchor: {
        literals: [
          "PolyTrack2",
          "Part list does not exist",
          "Part id is out of range",
          "Failed to get canvas context",
        ],
        // ALL FOUR are needed. An earlier attempt anchored on "PolyTrack2" +
        // "Checkpoint has no checkpoint order" and silently resolved to the WRONG
        // module (6582 / 6762 respectively), so fromExportString was simply not a
        // function. "Part id is out of range" and "Failed to get canvas context"
        // are unique to the track-data module (9117).
        minHits: 4,
      },
      selector: { kind: "factory" },
    },
    // The module factory's `t` is the exports object; `t.A` is the track codec
    // class (statics fromExportString / fromSaveString).
    inject: `try { if (typeof window !== "undefined" && window.__tspml && window.__tspml.captureTrackCodec && t && t.A) window.__tspml.captureTrackCodec(t.A); } catch (_e) {}`,
  },
];

/** Badge + Tier-1 events + the track-registry captures — what a surface applies. */
export const BRIDGE_PATCHES: readonly Patch[] = [
  ...TIER1_BRIDGE_PATCHES,
  ...TRACK_CAPTURE_PATCHES,
];
