// Tier-1 event surface: event name -> listener argument tuple.
//
// This is the stable API most mods program against. Payloads are filled in as
// the @tspml/api-bridge wires each event to a real PolyTrack function (M4+).
// See docs/api/events-and-registries.md.

/**
 * Per-frame car control INPUT, emitted from the game's `controlCar` hook (which
 * posts the player's input to the physics worker each frame). Booleans reflect
 * the input state at that frame.
 */
export interface CarControlState {
  readonly carId: number;
  readonly up: boolean;
  readonly right: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly reset: boolean;
}

/** Emitted when a car is created (`createCar`). Fires once per car — player AND
 * ghost/replay cars; filter on `isReplay` for the player's car. */
export interface CarCreatedInfo {
  readonly carId: number;
  readonly isReplay: boolean;
}

/**
 * Which car a per-car race event came from ([#10]).
 *
 * `race.started`, `checkpoint.passed` and `race.finished` fire once per CAR, and a
 * track can hold the player's car plus any number of ghost/replay cars. Without a
 * discriminator a lap-timer mod counts the ghosts' checkpoints as the player's, so
 * every payload carries this.
 *
 * ```ts
 * api.events.on('checkpoint.passed', ({ index, isReplay }) => {
 *   if (isReplay !== false) return; // ghost, or unknown — only false is the player
 *   console.log('checkpoint', index);
 * });
 * ```
 *
 * [#10]: https://github.com/roowus/TSPML/issues/10
 */
export interface CarRef {
  /**
   * The physics-worker car id — the same value `car.created` and `car.control`
   * report, so a mod can correlate across all four events.
   *
   * `null` when the emitting car has no id yet: the game only assigns one if it
   * built a physics car (`createCar`), and a purely visual car never does. Rare,
   * but a mod keying a Map by `carId` must handle it rather than get `"null"`.
   */
  readonly carId: number | null;
  /**
   * `true` for a ghost/replay car, `false` for the car the player drives.
   *
   * `null` means TSPML could not determine it. That is not a normal outcome — it
   * only happens if the game's internal shape changed under a bundle we still
   * match — but it is reported honestly rather than guessed, because guessing
   * `false` would silently attribute a ghost's lap to the player. **Treat `null`
   * as unknown, not as the player.**
   */
  readonly isReplay: boolean | null;
}

/** Emitted when a race is finished (finish line crossed). */
export interface RaceFinishInfo extends CarRef {
  /** Finish time in physics-sim frames (the game's internal unit). */
  readonly frames: number;
}

/** Emitted when a car passes a checkpoint. Per-car — see {@link CarRef}. */
export interface CheckpointInfo extends CarRef {
  /** The index of the checkpoint just passed. */
  readonly index: number;
}

/**
 * The TSPML event map. Keys are the event names mods subscribe to; values are
 * the listener argument tuples (readonly so listeners can't mutate payloads).
 */
export interface TspmlEventMap {
  // ── loader lifecycle ────────────────────────────────────────────────────────
  /** Before any game code runs — the only place for global hooks. */
  'loader.preInit': readonly [api: unknown];
  'loader.init': readonly [api: unknown];
  /** The main menu is visible and the game is interactive. */
  'loader.ready': readonly [];
  /** Cleanup (mod was unloaded or the page is tearing down). */
  'loader.onUnload': readonly [];

  // ── physics (execute INSIDE the sim-worker; see hook-system.md) ──────────────
  'physics.preStep': readonly [dt: number];
  'physics.postStep': readonly [dt: number];

  // ── render (Three.js render loop) ───────────────────────────────────────────
  'render.preRender': readonly [];
  'render.postRender': readonly [];

  // ── tracks ──────────────────────────────────────────────────────────────────
  'track.beforeLoad': readonly [trackId: string];
  'track.afterLoad': readonly [trackId: string];
  'track.unload': readonly [trackId: string];

  // ── car ─────────────────────────────────────────────────────────────────────
  'car.created': readonly [car: CarCreatedInfo];
  /** Emitted every frame the game steps the car controller (M4 slice 1). */
  'car.control': readonly [state: CarControlState];
  'car.styleChanged': readonly [];

  // ── checkpoints / race ──────────────────────────────────────────────────────
  // All PER-CAR (player + ghosts): the payloads carry `CarRef` so a mod can tell
  // which car it heard from (#10).
  'checkpoint.passed': readonly [checkpoint: CheckpointInfo];
  /** Emitted when a car respawns at its last checkpoint (#64). `index` is the
   *  checkpoint respawned AT. Fires on the reset-press edge, once per press —
   *  not for full restarts (those recreate the car) and not before the first
   *  checkpoint. */
  'checkpoint.respawn': readonly [checkpoint: CheckpointInfo];
  'race.started': readonly [car: CarRef];
  'race.finished': readonly [result: RaceFinishInfo];
}

/** Listener for a given event. */
export type TspmlListener<K extends keyof TspmlEventMap> = (
  ...args: TspmlEventMap[K]
) => void;

/**
 * A type-safe, **error-isolated** event emitter. Implemented by
 * `@tspml/api-bridge` (`EventBus`). Error isolation: a listener that throws is
 * caught and logged — it never prevents sibling listeners or the game from
 * proceeding (a direct fix for PML's "one bad hook crashes everything").
 *
 * `on`/`once` return an unsubscribe function so mods can clean up without
 * keeping references for `off` (addresses PML's missing-cleanup bug).
 */
export interface TspmlEventEmitter {
  /** Subscribe. Returns an unsubscribe function. */
  on<K extends keyof TspmlEventMap>(event: K, listener: TspmlListener<K>): () => void;
  /** Subscribe for exactly one emission. Returns an unsubscribe function. */
  once<K extends keyof TspmlEventMap>(event: K, listener: TspmlListener<K>): () => void;
  /** Unsubscribe a specific listener. */
  off<K extends keyof TspmlEventMap>(event: K, listener: TspmlListener<K>): void;
  /** Emit to all listeners of `event` (errors are isolated per listener). */
  emit<K extends keyof TspmlEventMap>(event: K, ...args: TspmlEventMap[K]): void;
  /** Number of listeners currently subscribed to `event`. */
  listenerCount<K extends keyof TspmlEventMap>(event: K): number;
  /** Remove all listeners of `event`, or all listeners on the bus if omitted. */
  removeAllListeners<K extends keyof TspmlEventMap>(event?: K): void;
}

/**
 * The event surface a **mod** receives — subscribe-only.
 *
 * Emitting is the bridge's job and the host's: the bridge patches raise game
 * events from inside the game, and the host raises `loader.onUnload` around
 * teardown. A mod holding `emit` could forge `race.finished` or
 * `checkpoint.passed`, which every other mod would then act on as if the game
 * had said it — indistinguishable, at the receiving end, from the real thing.
 *
 * The docs have promised this ("`on`/`off` only, deliberately") since M1, but
 * the promise lived only in prose while `TspmlApi.events` was the full emitter
 * and hosts handed mods the concrete bus through a cast. This type is what
 * makes it check.
 *
 * `EventBus` implements the full {@link TspmlEventEmitter}, so it satisfies
 * this by superset — no separate object is needed at runtime.
 */
export type TspmlEventSubscriber = Pick<TspmlEventEmitter, 'on' | 'once' | 'off'>;
