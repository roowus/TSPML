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
 * The minified module-scope bindings the per-car race events (#10) read off `this`.
 *
 * Exported and referenced by name from each inject so a game rename is ONE edit
 * here rather than a hunt through three payloads. (The alternative — attaching a
 * stable accessor method to the game's class — was rejected: every patch in this
 * file only READS, and a write is a behaviour change for no gain over a constant.)
 *
 * Both are `var`-declared at MODULE scope in the car-controller module (641),
 * alongside the class whose methods we patch:
 *
 * ```js
 * var D,B,G,…,ee,te,ne,ie,re,…            // module scope
 * ee = new WeakMap; ie = new WeakMap;     // …later in the same scope
 * class ot { start() { … } setCarState(e,t) { … } }
 * ```
 *
 * A `before` inject is spliced lexically INSIDE the method body, so it sits in
 * that scope chain and can name them directly. This is what makes #10 fixable at
 * all: the issue text claims the replay flag is unreachable from an inject, which
 * is wrong — it is a module-scope WeakMap, not a private field.
 *
 * Semantics, read off the constructor (`constructor(e,t,n,i,r,a,s,o,h,d,u)`):
 *
 * ```js
 * if (null == n)                       // n = the carRecording parameter
 *   ie.set(this, ne.get(this) != null) //   live car: true iff it has an input source
 * else {                               // a recording WAS supplied => ghost
 *   if (ne.get(this) != null) throw new Error("Can't control car when recording is set");
 *   ie.set(this, false);
 * }
 * ```
 *
 * So `ie` is the game's own "this car is being driven" flag — it gates whether
 * `update()` records input frames (`ie.get(this) && … re.get(this).recordFrame(…)`).
 * `isReplay` is therefore its NEGATION, not the flag itself.
 *
 * ⚠️ These are minified identifiers, sound only under the hash gate every caller
 * applies — see the header note and [#24].
 */
export const CAR_CONTROLLER_BINDINGS = {
  /** WeakMap<car, boolean> — `true` when the car is driven, `false` for a ghost. */
  isControlled: "ie",
  /** WeakMap<car, number|null> — the physics-worker car id (`null` if none). */
  carId: "ee",
  /**
   * WeakMap<car, CarState> — the car's CURRENT state. At the HEAD of
   * `setCarState` (where the `before` inject runs) it still holds the
   * PREVIOUS frame's state — the method overwrites it later — which is what
   * lets the respawn emit (#64) diff `controls.reset` across frames.
   */
  carState: "te",
} as const;

/**
 * A guarded read of a module-scope WeakMap binding for `car`: `null` on ANY
 * failure (renamed binding, non-WeakMap, throw). `typeof` (not truthiness)
 * because a renamed binding is a ReferenceError in module scope, not
 * `undefined`. Shared by {@link CAR_REF} and the respawn edge-detect (#64);
 * exported ONLY so the binding-constants test can regenerate an instantiation
 * and hold "the minified names never appear outside this helper".
 */
export const READ_BINDING = (binding: string, car: string): string =>
  `(function(__car){ try { return (typeof ${binding} !== "undefined" && ${binding} && typeof ${binding}.get === "function") ? ${binding}.get(__car) : null; } catch (_e) { return null; } })(${car})`;

/**
 * A JS expression yielding `CarRef` (`{ carId, isReplay }`) for a given car.
 *
 * Takes the car explicitly (`CAR_REF("this")`) rather than reading `this` inside
 * its own IIFE. The game module is `"use strict"`, so inside a plain
 * `(function(){…})()` `this` is `undefined` — every read would have thrown, been
 * caught, and degraded to `null`, making the whole fix a silent no-op that still
 * looked correct in the payload. Passing the receiver in is the fix.
 *
 * Every read is individually guarded and every failure degrades to `null` rather
 * than a guess: attributing a ghost's lap to the player by defaulting `isReplay`
 * to `false` would be a silent wrong answer, which is worse than an honest
 * "unknown" a mod can branch on. `typeof` (not truthiness) because a renamed
 * binding is a ReferenceError in module scope, not `undefined`.
 */
const CAR_REF = (receiver: string): string => {
  const { isControlled, carId } = CAR_CONTROLLER_BINDINGS;
  // `ie` holds "is controlled", so isReplay is its negation — and a non-boolean
  // (only reachable if the game's shape changed) stays `null` rather than
  // collapsing to a guess via `!`.
  return (
    `(function(__car){ var __c = ${READ_BINDING(isControlled, "__car")}; var __i = ${READ_BINDING(carId, "__car")};` +
    ` return { carId: typeof __i === "number" ? __i : null,` +
    ` isReplay: typeof __c === "boolean" ? !__c : null }; })(${receiver})`
  );
};

/**
 * Badge + the seven Tier-1 event emits.
 *
 * `car.control` and `car.created` come from the Car module; `race.started`,
 * `checkpoint.passed`, `checkpoint.respawn` and `race.finished` from the
 * car-controller; `track.afterLoad` from the track-data loader.
 *
 * PER-CAR ([#10], fixed): `race.started`, `checkpoint.passed`,
 * `checkpoint.respawn` ([#64]) and `race.finished` fire for ghost/replay cars
 * as well as the player (a ghost's recording replays its resets too). They
 * stay per-car — a ghost-comparison mod needs the ghosts' events — but each
 * carries `{ carId, isReplay }` ({@link CAR_REF}) so a mod can filter.
 *
 * [#10]: https://github.com/roowus/TSPML/issues/10
 * [#64]: https://github.com/roowus/TSPML/issues/64
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
    inject: EMIT(`window.__tspml.events.emit("race.started", ${CAR_REF("this")});`),
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
    // `__ref` is computed lazily INSIDE each transition branch, never once up
    // front: this runs every frame for every car, and the branches are false on
    // almost all of them. WeakMap reads per frame per car would be a real cost
    // on a 60fps hot path for a value nothing reads.
    //
    // checkpoint.respawn (#64) is the RISING EDGE of `controls.reset` — the same
    // edge the game's own reset callbacks fire on (`setCarState` runs
    // `if (t || !old.controls.reset && new.controls.reset) …` right after
    // swapping the state). The reset flag only reaches carState on the
    // checkpoint-respawn path: when no checkpoint is available the scene
    // full-restarts by RECREATING the car (and forces the flag false), which
    // never passes through here. `e.hasCheckpointToRespawnAt === true` is the
    // game's own "reset means respawn" flag (the scene's availability check
    // reads the same field), asserted anyway for ghost recordings that could
    // replay a stray reset frame. The OLD state comes from the carState
    // WeakMap, still un-swapped at the method HEAD. Deliberately silent — no
    // emit, no guess — when:
    //   · `t` is set (a hard state-set: replay scrub / discontinuous jump — the
    //     game resets cameras there, but nothing respawned),
    //   · the old state is unreadable or lacks a boolean-false reset (renamed
    //     binding / changed shape — emitting every held-reset frame would be
    //     worse than missing the event),
    //   · no checkpoint was ever passed (index would be -1).
    // `index` is the checkpoint respawned AT: checkpoints pass in order and a
    // respawn keeps progress, so that is nextCheckpointIndex - 1.
    inject: EMIT(
      `if (e) { if (e.nextCheckpointIndex != null && typeof this.getNextCheckpointIndex === 'function' && e.nextCheckpointIndex > this.getNextCheckpointIndex()) { var __r1 = ${CAR_REF("this")}; window.__tspml.events.emit('checkpoint.passed', { index: this.getNextCheckpointIndex(), carId: __r1.carId, isReplay: __r1.isReplay }); } if (e.finishFrames != null && typeof this.hasFinished === 'function' && !this.hasFinished()) { var __r2 = ${CAR_REF("this")}; window.__tspml.events.emit('race.finished', { frames: e.finishFrames, carId: __r2.carId, isReplay: __r2.isReplay }); } if (!t && e.controls && e.controls.reset === true && e.hasCheckpointToRespawnAt === true && typeof this.getNextCheckpointIndex === 'function' && this.getNextCheckpointIndex() > 0) { var __o = ${READ_BINDING(CAR_CONTROLLER_BINDINGS.carState, "this")}; if (__o && __o.controls && __o.controls.reset === false) { var __r3 = ${CAR_REF("this")}; window.__tspml.events.emit('checkpoint.respawn', { index: this.getNextCheckpointIndex() - 1, carId: __r3.carId, isReplay: __r3.isReplay }); } } }`,
    ),
  },
];

/**
 * The registry capture patches — custom tracks (#12) and audio (#11).
 *
 * (Named for the registries, not for tracks: it began as `TRACK_CAPTURE_PATCHES`,
 * then #11's audio capture landed in the very same inject. A name that lists one of
 * two features invites the next reader to add a third copy somewhere else.)
 *
 * The game's TrackManager and audio manager both live in the BOOTSTRAP, past the
 * wall the module locator cannot reach. Their CALLERS are real modules, though — so
 * rather than locating the class, capture the live instance as it is handed to a
 * caller. Generalized as "instance capture" in docs/design/hook-system.md.
 *
 * Every patch here only READS a reference into `window.__tspml`; none changes game
 * behaviour, so a mis-target degrades to "the capture never happens" rather than
 * corrupted state.
 *
 * TIMING: these fire at very different points. The track-selection constructor
 * (which yields BOTH the track manager and the audio manager) runs when the game
 * builds its menu — late, after a surface's bridge is installed. The codec's module
 * factory, by contrast, runs during BUNDLE INIT, before that bridge exists. A
 * surface must therefore inject {@link EARLY_CAPTURE_STUB} ahead of the game's
 * scripts and replay what it recorded, or the codec capture is silently dropped and
 * the track registry never attaches. Audio needs no early slot for the same reason
 * the track manager does not.
 *
 * [#11]: https://github.com/roowus/TSPML/issues/11
 */
export const REGISTRY_CAPTURE_PATCHES: readonly Patch[] = [
  {
    op: "before",
    target: {
      anchor: {
        literals: ["Custom tracks", "No custom tracks", "Official tracks", "Community tracks"],
        minHits: 3,
      },
      selector: { kind: "method", name: "constructor" },
    },
    // The track-selection UI (module 8185): constructor(e,t,n,r,a,...). `a` is the
    // TrackManager (saveCustomTrack / deleteCustomTrack / forEachCustomTrack); `n`
    // is the AUDIO manager (context / getBuffer / playUIClick / load).
    //
    // Both captures ride ONE inject because they come from the same constructor —
    // which is also why #11 needed no new anchor and no locator change: this module
    // was already a committed, verified target with exactly one constructor in it.
    // Verified against 0.6.2 at the three `new Sr.A(...)` call sites, where param 3
    // is the same private field the game's own `playUIClick()` calls go through.
    inject: `try { if (typeof window !== "undefined" && window.__tspml) { if (window.__tspml.captureTrackManager) window.__tspml.captureTrackManager(a); if (window.__tspml.captureAudioManager) window.__tspml.captureAudioManager(n); } } catch (_e) {}`,
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

/** Badge + Tier-1 events + the registry captures — what a surface applies. */
export const BRIDGE_PATCHES: readonly Patch[] = [
  ...TIER1_BRIDGE_PATCHES,
  ...REGISTRY_CAPTURE_PATCHES,
];
