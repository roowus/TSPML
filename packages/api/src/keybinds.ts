// Tier-1 keybind registry: a mod registers a hotkey + callbacks; the bridge
// owns the listener. See docs/api/events-and-registries.md.

/** A single keybind registration. */
export interface KeybindBinding {
  /** Stable id (unregister / dedupe). Convention: `<modid>.<action>`. */
  readonly id: string;
  /**
   * A `KeyboardEvent.code` value (e.g. "KeyF", "ArrowUp", "ShiftLeft") — the
   * same vocabulary the game uses for its own bindings.
   */
  readonly key: string;
  /** Fired on keydown (when `key` matches). */
  readonly onDown?: (event: KeyboardEvent) => void;
  /** Fired on keyup (when `key` matches). */
  readonly onUp?: (event: KeyboardEvent) => void;
  /** Call `event.preventDefault()` before the callbacks (default false). */
  readonly preventDefault?: boolean;
  /**
   * When true, `onDown` also fires on browser auto-repeat while the key is held
   * (`KeyboardEvent.repeat === true`). Default **false** — edge-triggered only
   * so toggle-style binds do not multi-fire (#23).
   */
  readonly allowRepeat?: boolean;
  /** Human label (for future UI / conflict reporting). */
  readonly description?: string;
}

/**
 * Keybind registry. Implemented by `@tspml/api-bridge` (`KeybindsRegistry`).
 *
 * CAVEAT (PolyTrack 0.6.2): the game's action set is a closed enum it polls
 * itself; bridge keybinds run as a PARALLEL listener, so they do NOT appear in
 * the game's Controls settings and do NOT consult the game's conflict rules. A
 * mod binding a key the game also uses will fire alongside the game — choose
 * unbound keys (documented for modders).
 *
 * Keydown is **edge-triggered by default** (`event.repeat` is ignored unless
 * `allowRepeat: true` on the binding).
 */
export interface KeybindsRegistry {
  /** Register a binding. Returns an unregister function. */
  register(binding: KeybindBinding): () => void;
  /** Unregister by id. */
  unregister(id: string): void;
}
