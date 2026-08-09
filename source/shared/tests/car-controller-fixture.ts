/**
 * A SYNTHETIC stand-in for the game's car-controller module (641), shaped to
 * mirror the two structural facts the per-car race patches (#10) depend on.
 *
 * Why this exists: the real 1.78 MB bundle is gitignored and machine-local, and no
 * headless smoke can reach the bug those patches fix — a ghost car only appears
 * when a saved lap record exists, and every smoke launches a fresh empty browser.
 * So the player-vs-ghost distinction had no executable test anywhere. This fixture
 * is small enough to live in source and real enough to RUN: the tests transform it
 * with the actual `@tspml/transform` engine, execute the result, and assert the
 * emitted payloads.
 *
 * What it deliberately reproduces from the real module:
 *
 * 1. **Module-scope `WeakMap` bindings** (`ee` = car id, `ie` = is-controlled),
 *    `var`-declared in the factory body — NOT class fields. This is the whole
 *    premise of the fix: an inject spliced inside a method body is in that scope
 *    chain and can name them. (Issue #10 claims otherwise.)
 * 2. **The same names**, so the fixture breaks if `CAR_CONTROLLER_BINDINGS` drifts.
 * 3. **`ie`'s inverted sense** — the game stores "is being driven", so `isReplay`
 *    is its negation. A fixture that stored `isReplay` directly would pass even if
 *    the inject forgot the `!`, which is the mistake most worth catching.
 * 4. **The string-data anchor literals** (`skidding`/`engine`/`tires`/`BrakeLight`)
 *    that `CAR_CONTROLLER_ANCHOR` matches on, and only in this module.
 * 5. **`start()` and `setCarState()` as peer methods** of one class, with
 *    `getNextCheckpointIndex()`/`hasFinished()` reading the OLD state — which is
 *    what makes the diff-at-HEAD trick in the combined inject work.
 * 6. **The full state shape the respawn edge-detect reads (#64)** —
 *    `controls.reset` + `hasCheckpointToRespawnAt`, initialized exactly like the
 *    real constructor's placeholder state (`reset: false`, respawn flag false),
 *    with the old state reachable through the `te` WeakMap at the method HEAD.
 *
 * What it does NOT reproduce: physics, Three.js, the recorder, minified helper
 * calls (`(0,l.gn)(this,ie,"f")` becomes a plain `ie.get(this)`). None of that is
 * load-bearing for the payload logic, and the real-bundle path stays covered by
 * the surfaces' headless smokes.
 */

/** The literals `CAR_CONTROLLER_ANCHOR` resolves this module by. */
export const CAR_CONTROLLER_LITERALS = ["skidding", "engine", "tires", "BrakeLight"] as const;

/**
 * The fixture bundle. A webpack bootstrap IIFE with two modules, so anchor
 * uniqueness is exercised rather than assumed:
 *   641  — the car controller (the anchor literals + `class ot`).
 *   111  — a decoy that mentions NONE of the anchor literals.
 *
 * The bootstrap hands the module's exports to `globalThis.__fixture` so a test can
 * construct cars after evaluating the transformed source.
 */
export const CAR_CONTROLLER_BUNDLE = `
(() => {
  const __webpack_modules__ = {
    111: (module, exports, __webpack_require__) => {
      const unrelated = { name: "menu", label: "Settings" };
      module.exports = { unrelated };
    },
    641: (module, exports, __webpack_require__) => {
      "use strict";
      // The string-DATA anchor: audio buffer + material names. Identifiers like
      // \`setCarState\` are invisible to the locator, which matches literals only.
      const AUDIO_KEYS = ["skidding", "engine", "tires"];
      const MATERIALS = { brake: "BrakeLight" };

      // Module-scope WeakMaps — the shape the whole fix rests on. The real module
      // declares ~60 of these in one \`var\` statement; two is enough to prove the
      // scope chain reaches them from inside a method body.
      var ee, ie, te;
      ee = new WeakMap();
      ie = new WeakMap();
      te = new WeakMap();

      class ot {
        /**
         * @param {number|null} id        physics car id (null when no physics car)
         * @param {object|null} recording non-null => this car replays a ghost
         */
        constructor(id, recording) {
          ee.set(this, id);
          // NOTE THE SENSE: the game stores "is controlled", not "is replay".
          ie.set(this, recording == null);
          te.set(this, {
            frames: 0,
            hasStarted: false,
            finishFrames: null,
            nextCheckpointIndex: 0,
            hasCheckpointToRespawnAt: false,
            controls: { up: false, right: false, down: false, left: false, reset: false },
          });
        }
        getCarState() { return te.get(this); }
        getNextCheckpointIndex() { return te.get(this).nextCheckpointIndex; }
        hasFinished() { return te.get(this).finishFrames != null; }
        hasStarted() { return te.get(this).hasStarted; }
        start() {
          te.get(this).hasStarted = true;
        }
        // Params DELIBERATELY named differently from the real bundle's (e, t):
        // the #24 placeholders must resolve by ORDINAL against whatever names
        // the located method declares, so the executable tests prove the
        // patches are name-independent.
        setCarState(newState, hardSet) {
          te.set(this, newState);
        }
      }

      module.exports = { ot, AUDIO_KEYS, MATERIALS };
    },
  };
  const __cache = {};
  function __webpack_require__(id) {
    if (!__cache[id]) {
      const m = { exports: {} };
      __webpack_modules__[id](m, m.exports, __webpack_require__);
      __cache[id] = m;
    }
    return __cache[id];
  }
  globalThis.__fixture = __webpack_require__(641).exports;
})();
`;
