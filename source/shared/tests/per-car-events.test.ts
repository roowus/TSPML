/**
 * EXECUTABLE guards on the per-car race-event payloads (#10).
 *
 * The other suite in this package (`bridge-patches.test.ts`) checks the injects
 * statically — they parse, they guard the bridge, their anchors are sane. That is
 * necessary and not sufficient: a payload can parse perfectly and still compute the
 * wrong answer. `isReplay` is exactly that kind of value — the game stores the
 * INVERSE (`ie` = "is controlled"), so a missing `!` yields a payload that is
 * well-formed, plausible, and backwards on every car.
 *
 * So this suite runs the real transform over a synthetic car-controller module
 * (`./car-controller-fixture.ts`), EXECUTES the transformed output, and asserts
 * what a mod would actually receive for a player car and for a ghost.
 *
 * Why the fixture and not the real bundle: the real one is gitignored, and — more
 * to the point — no headless smoke can produce a ghost at all. Ghosts require a
 * saved lap record; every smoke launches a fresh empty browser, so the
 * player-vs-ghost path has never been exercised anywhere. That gap is what this
 * closes. The real-bundle anchor resolution stays covered by the surfaces' smokes.
 *
 * See docs/design/hook-system.md and conventions.md ("Verifying the parts is not
 * verifying the whole").
 */
import { beforeEach, describe, expect, it } from "vitest";

import { transform } from "@tspml/transform";

import {
  CAR_CONTROLLER_BINDINGS,
  READ_BINDING,
  TIER1_BRIDGE_PATCHES,
} from "../src/bridge-patches.js";
import { CAR_CONTROLLER_BUNDLE, CAR_CONTROLLER_LITERALS } from "./car-controller-fixture.js";

/** One event a mod's listener saw. */
interface Seen {
  readonly name: string;
  readonly payload: Record<string, unknown>;
}

/** A car in the fixture module. */
interface FixtureCar {
  start(): void;
  setCarState(state: Record<string, unknown>, t: boolean): void;
  getNextCheckpointIndex(): number;
  hasFinished(): boolean;
}

interface FixtureExports {
  readonly ot: new (id: number | null, recording: object | null) => FixtureCar;
}

/**
 * The two patches under test: the ones targeting the car-controller module. Selected
 * by ANCHOR rather than by index — an index would quietly test the wrong patch the
 * next time one is inserted above.
 */
const PER_CAR_PATCHES = TIER1_BRIDGE_PATCHES.filter((p) =>
  CAR_CONTROLLER_LITERALS.every((lit) => p.target.anchor.literals.includes(lit)),
);

/**
 * Transform the fixture with the real patches, execute it, and return a live
 * module plus the event log a mod would have received.
 *
 * The bridge is a hand-rolled `window.__tspml` rather than the real `EventBus`:
 * `@tspml/api-bridge` is not a dependency of this package, and what is under test
 * is the INJECT's payload, not the bus's dispatch (which has its own suite).
 */
function runFixture(): { seen: Seen[]; mod: FixtureExports } {
  const result = transform(CAR_CONTROLLER_BUNDLE, PER_CAR_PATCHES);
  // A patch that failed to apply would make every assertion below vacuously pass.
  expect(result.failed, `patches failed: ${JSON.stringify(result.failed)}`).toHaveLength(0);
  expect(result.applied).toHaveLength(PER_CAR_PATCHES.length);
  expect(result.outputValid).toBe(true);

  const seen: Seen[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = {
    __tspml: {
      events: {
        emit: (name: string, payload: Record<string, unknown>) => {
          seen.push({ name, payload });
        },
      },
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(result.code)();
  return { seen, mod: g.__fixture as FixtureExports };
}

/** Drive a car through: start, one checkpoint, then the finish. */
function race(car: FixtureCar): void {
  car.start();
  car.setCarState({ frames: 10, hasStarted: true, finishFrames: null, nextCheckpointIndex: 1 }, false);
  car.setCarState({ frames: 20, hasStarted: true, finishFrames: 20, nextCheckpointIndex: 1 }, false);
}

/**
 * A FULL car state as the game ships it — the respawn edge-detect (#64) reads
 * `controls.reset` and `hasCheckpointToRespawnAt`, which the abbreviated states
 * in {@link race} deliberately omit (their absence must mean "no emit", and the
 * suite asserts exactly that below).
 */
function fullState(over: Record<string, unknown>): Record<string, unknown> {
  return {
    frames: 0,
    hasStarted: true,
    finishFrames: null,
    nextCheckpointIndex: 1,
    hasCheckpointToRespawnAt: true,
    controls: { up: false, right: false, down: false, left: false, reset: false },
    ...over,
  };
}

/** `fullState` with the reset control held. */
function resetState(over: Record<string, unknown>): Record<string, unknown> {
  return fullState({
    controls: { up: false, right: false, down: false, left: false, reset: true },
    ...over,
  });
}

describe("per-car race events (#10)", () => {
  let seen: Seen[];
  let mod: FixtureExports;

  beforeEach(() => {
    ({ seen, mod } = runFixture());
  });

  /**
   * The premise of the whole fix, made executable: the replay flag lives in a
   * module-scope `WeakMap`, so an inject spliced into a method body can read it.
   * Issue #10 states it is unreachable — if that were true, this is the test that
   * would fail.
   */
  it("reads the module-scope binding from inside a patched method", () => {
    const player = new mod.ot(7, null);
    player.start();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.payload).toEqual({ carId: 7, isReplay: false });
  });

  it("reports a ghost car as isReplay: true", () => {
    const ghost = new mod.ot(9, { frames: [] });
    ghost.start();
    expect(seen[0]?.payload).toEqual({ carId: 9, isReplay: true });
  });

  /**
   * The distinguishing test. Both cars run the same three transitions; every one of
   * the six events must be attributable. Before this fix all six were
   * indistinguishable, which is the bug: a lap-timer counted the ghost's
   * checkpoints as the player's.
   */
  it("distinguishes the player from a ghost across all three events", () => {
    race(new mod.ot(1, null));
    race(new mod.ot(2, { frames: [] }));

    expect(seen.map((s) => [s.name, s.payload.carId, s.payload.isReplay])).toEqual([
      ["race.started", 1, false],
      ["checkpoint.passed", 1, false],
      ["race.finished", 1, false],
      ["race.started", 2, true],
      ["checkpoint.passed", 2, true],
      ["race.finished", 2, true],
    ]);
  });

  /**
   * `ie` stores "is controlled", so `isReplay` is its NEGATION. Dropping the `!`
   * produces a payload that parses, emits, and is wrong on every car — the single
   * most likely way to break this silently. Asserting the player is `false` (not
   * merely "a boolean", and not merely different from the ghost's) is what catches
   * an inversion; a relative assertion would pass with both flipped.
   */
  it("does not invert the flag (the player is false, the ghost is true)", () => {
    new mod.ot(1, null).start();
    new mod.ot(2, { frames: [] }).start();
    expect(seen[0]?.payload.isReplay).toBe(false);
    expect(seen[1]?.payload.isReplay).toBe(true);
  });

  /** The payloads keep their original data alongside the new discriminator. */
  it("keeps the checkpoint index and the finish frames", () => {
    race(new mod.ot(3, null));
    const cp = seen.find((s) => s.name === "checkpoint.passed");
    const fin = seen.find((s) => s.name === "race.finished");
    // The index reported is the one just PASSED (the old state's), not the next.
    expect(cp?.payload).toEqual({ index: 0, carId: 3, isReplay: false });
    expect(fin?.payload).toEqual({ frames: 20, carId: 3, isReplay: false });
  });

  /**
   * A car with no physics car has no id. A mod keying a Map on `carId` must get
   * `null` rather than `undefined` (which stringifies into a bogus key) — hence
   * `toEqual` on the whole payload, so a missing property fails too.
   */
  it("reports carId: null when the car has no physics id", () => {
    new mod.ot(null, null).start();
    expect(seen[0]?.payload).toEqual({ carId: null, isReplay: false });
  });

  /**
   * The honesty requirement. If the game renames the binding, the read must degrade
   * to `null` — "unknown" — and must NOT throw into game code. Guessing `false`
   * would silently credit a ghost's lap to the player.
   *
   * Simulated by transforming a fixture whose binding is renamed, which is the
   * mutation a game update performs. Under the hash gate a real rename means the
   * transform applies nothing at all, so this is the belt to that braces.
   */
  it("degrades to isReplay: null if the binding is renamed, without throwing", () => {
    const renamed = CAR_CONTROLLER_BUNDLE.replaceAll(
      new RegExp(`\\b${CAR_CONTROLLER_BINDINGS.isControlled}\\b`, "g"),
      "__renamed_ie",
    );
    const result = transform(renamed, PER_CAR_PATCHES);
    expect(result.failed).toHaveLength(0);

    const seenHere: Seen[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = {
      __tspml: {
        events: {
          emit: (name: string, payload: Record<string, unknown>) => {
            seenHere.push({ name, payload });
          },
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(result.code)();
    const renamedMod = g.__fixture as FixtureExports;

    expect(() => new renamedMod.ot(5, null).start()).not.toThrow();
    expect(seenHere[0]?.payload).toEqual({ carId: 5, isReplay: null });
  });

  /**
   * `"use strict"` in the game module means `this` inside a plain
   * `(function(){…})()` is `undefined`. An earlier draft of this inject read `this`
   * inside its own IIFE, so every read threw, was caught, and degraded to `null` —
   * a total no-op that still looked correct in the payload and parsed fine. This is
   * the assertion that would have caught it, so it stays.
   */
  it("resolves the receiver under strict mode (a null payload would mean it did not)", () => {
    new mod.ot(4, null).start();
    expect(seen[0]?.payload.isReplay).not.toBeNull();
    expect(seen[0]?.payload.carId).toBe(4);
  });
});

describe("checkpoint.respawn (#64)", () => {
  let seen: Seen[];
  let mod: FixtureExports;

  beforeEach(() => {
    ({ seen, mod } = runFixture());
  });

  /** Only the respawn events, with the noise of the other emits filtered out. */
  const respawns = (): Seen[] => seen.filter((s) => s.name === "checkpoint.respawn");

  /**
   * The happy path: pass a checkpoint, then hold reset for several frames. The
   * emit is the RISING edge — exactly one event, not one per held frame, and
   * `index` is the checkpoint respawned AT (the one just passed), not the next.
   */
  it("emits once on the rising edge of controls.reset, at the passed checkpoint", () => {
    const car = new mod.ot(6, null);
    car.start();
    car.setCarState(fullState({ frames: 10 }), false); // passes checkpoint 0
    car.setCarState(resetState({ frames: 20 }), false); // reset pressed
    car.setCarState(resetState({ frames: 21 }), false); // still held
    car.setCarState(resetState({ frames: 22 }), false); // still held
    expect(respawns()).toHaveLength(1);
    expect(respawns()[0]?.payload).toEqual({ index: 0, carId: 6, isReplay: false });
  });

  /** Release + press again is a second respawn — a new edge, a new event. */
  it("emits again on a second press after release", () => {
    const car = new mod.ot(6, null);
    car.start();
    car.setCarState(fullState({ frames: 10 }), false);
    car.setCarState(resetState({ frames: 20 }), false);
    car.setCarState(fullState({ frames: 30 }), false); // released
    car.setCarState(resetState({ frames: 40 }), false); // pressed again
    expect(respawns()).toHaveLength(2);
  });

  /**
   * A reset before any checkpoint is a FULL restart in the game (the scene
   * recreates the car), so index-0 edges must not produce a respawn event.
   */
  it("does not emit before the first checkpoint", () => {
    const car = new mod.ot(6, null);
    car.start();
    car.setCarState(resetState({ nextCheckpointIndex: 0, hasCheckpointToRespawnAt: false }), false);
    expect(respawns()).toHaveLength(0);
  });

  /**
   * `t` (the hard-set flag) means "this state did not flow from the sim" —
   * replay scrubs and discontinuous jumps. The game suppresses its own reset
   * callbacks' edge semantics there and so do we.
   */
  it("does not emit on a hard state-set (t = true)", () => {
    const car = new mod.ot(6, null);
    car.start();
    car.setCarState(fullState({ frames: 10 }), false);
    car.setCarState(resetState({ frames: 20 }), true);
    expect(respawns()).toHaveLength(0);
  });

  /** The game's own respawn-availability flag gates the emit. */
  it("does not emit when the state says no checkpoint is available", () => {
    const car = new mod.ot(6, null);
    car.start();
    car.setCarState(fullState({ frames: 10 }), false);
    car.setCarState(resetState({ frames: 20, hasCheckpointToRespawnAt: false }), false);
    expect(respawns()).toHaveLength(0);
  });

  /**
   * Honesty over spam: if the OLD state's reset flag cannot be read as boolean
   * false (changed shape — here simulated by states with no `controls` at all),
   * the edge cannot be established, so nothing fires. Emitting on every
   * held-reset frame would be the failure mode this guard exists to prevent.
   */
  it("stays silent when the previous state's controls are unreadable", () => {
    const car = new mod.ot(6, null);
    car.start();
    // Old state lacks `controls` entirely (the abbreviated shape `race()` uses).
    car.setCarState({ frames: 10, hasStarted: true, finishFrames: null, nextCheckpointIndex: 1 }, false);
    car.setCarState(resetState({ frames: 20 }), false);
    expect(respawns()).toHaveLength(0);
  });

  /** Per-car like its siblings: a ghost's replayed reset is attributed to the ghost. */
  it("tags a ghost's respawn as isReplay: true", () => {
    const ghost = new mod.ot(9, { frames: [] });
    ghost.start();
    ghost.setCarState(fullState({ frames: 10 }), false);
    ghost.setCarState(resetState({ frames: 20 }), false);
    expect(respawns()[0]?.payload).toEqual({ index: 0, carId: 9, isReplay: true });
  });

  /** The abbreviated race() flow must be unaffected — no spurious respawns. */
  it("does not fire during a plain race", () => {
    race(new mod.ot(3, null));
    expect(respawns()).toHaveLength(0);
  });
});

describe("binding constants", () => {
  /**
   * The injects reference the bindings through {@link CAR_CONTROLLER_BINDINGS} so a
   * game rename is one edit. If a future change inlines a name instead, the constant
   * stops being the single source of truth and the rename-degradation tests above
   * silently stop covering it.
   *
   * Checked by REMOVAL: regenerate every possible {@link READ_BINDING}
   * instantiation (each binding × each receiver the injects use), strip them from
   * the joined inject text, and require the bare names to be gone. (The previous
   * version asserted equal use COUNTS per binding, which stopped holding when #64
   * added a binding that is read once per inject rather than once per CAR_REF.)
   */
  it("are the only place the minified names appear, always via READ_BINDING", () => {
    let injects = PER_CAR_PATCHES.map((p) => ("inject" in p ? p.inject : "")).join("\n");
    for (const name of Object.values(CAR_CONTROLLER_BINDINGS)) {
      // Present in the generated payload...
      expect(injects).toContain(`typeof ${name} !==`);
      // ...and removable by stripping helper instantiations alone.
      for (const receiver of ["__car", "this"]) {
        injects = injects.replaceAll(READ_BINDING(name, receiver), "");
      }
      expect(injects, `binding "${name}" referenced outside READ_BINDING`).not.toMatch(
        new RegExp(`\\b${name}\\b`),
      );
    }
  });
});
