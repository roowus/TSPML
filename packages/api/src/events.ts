// Tier-1 event surface: event name -> listener argument tuple.
//
// This is the stable API most mods program against. Payloads are filled in as
// the @tspml/api-bridge wires each event to a real PolyTrack function (M4+).
// See docs/api/events-and-registries.md.

/** Per-frame car-control state, emitted from the game's `controlCar` hook. */
export interface CarControlState {
  /** Milliseconds simulated for this frame (clamped by the game). */
  readonly dt: number;
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
  'car.created': readonly [];
  /** Emitted every frame the game steps the car controller (M4 slice 1). */
  'car.control': readonly [state: CarControlState];
  'car.styleChanged': readonly [];

  // ── checkpoints / race ──────────────────────────────────────────────────────
  'checkpoint.passed': readonly [index: number];
  'checkpoint.respawn': readonly [index: number];
  'race.started': readonly [];
  'race.finished': readonly [time: number];
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
