import type { KeybindBinding, KeybindsRegistry } from '@tspml/api';

export interface KeybindsOptions {
  /** Called when a binding's onDown/onUp throws (default: console.error). */
  readonly onError?: (error: unknown, bindingId: string, phase: 'down' | 'up') => void;
}

/**
 * Tier-1 keybind registry implementation. Attaches a single `keydown`/`keyup`
 * listener to `target` (the game iframe's window at runtime) and dispatches to
 * matching bindings. Per-binding error isolation: a throwing `onDown`/`onUp` is
 * caught + reported and never blocks sibling bindings or the game.
 *
 * `target` is passed in (not captured from a global) so the registry attaches to
 * the GAME's window (where keyboard focus + keydown events live), and so it is
 * unit-testable with a mock target in the node test environment.
 */
export class Keybinds implements KeybindsRegistry {
  private target: Window;
  private readonly bindings = new Map<string, KeybindBinding>();
  private readonly onError: (error: unknown, id: string, phase: 'down' | 'up') => void;
  private readonly handleKeyDown: (e: KeyboardEvent) => void;
  private readonly handleKeyUp: (e: KeyboardEvent) => void;
  private attached = false;

  constructor(target: Window, options: KeybindsOptions = {}) {
    this.target = target;
    this.onError = options.onError ?? defaultOnError;
    this.handleKeyDown = (e) => this.dispatch(e, 'down');
    this.handleKeyUp = (e) => this.dispatch(e, 'up');
    target.addEventListener('keydown', this.handleKeyDown);
    target.addEventListener('keyup', this.handleKeyUp);
    this.attached = true;
  }

  register(binding: KeybindBinding): () => void {
    this.bindings.set(binding.id, binding);
    return () => this.unregister(binding.id);
  }

  unregister(id: string): void {
    this.bindings.delete(id);
  }

  /** Number of registered bindings (testability). */
  get size(): number {
    return this.bindings.size;
  }

  /**
   * Move the listeners to a new window, keeping every registered binding (#67).
   *
   * The game iframe gets a NEW document (and window) whenever it reloads
   * in place or React remounts the element — but mods register keybinds once
   * at mod-load, not per frame-load. Recreating the registry would silently
   * drop their bindings; leaving it alone leaves the listeners on a dead
   * window. Retargeting is the only option that keeps both invariants.
   *
   * Detaching from the old window is best-effort: if its document is already
   * gone, the proxy may throw, and there is nothing to detach from anyway.
   */
  retarget(next: Window): void {
    if (next === this.target && this.attached) return;
    if (this.attached) {
      try {
        this.target.removeEventListener('keydown', this.handleKeyDown);
        this.target.removeEventListener('keyup', this.handleKeyUp);
      } catch {
        /* old realm already torn down — nothing to detach from */
      }
    }
    this.target = next;
    next.addEventListener('keydown', this.handleKeyDown);
    next.addEventListener('keyup', this.handleKeyUp);
    this.attached = true;
  }

  /** Detach the window listeners + clear bindings (cleanup / unload). */
  dispose(): void {
    if (!this.attached) return;
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
    this.attached = false;
    this.bindings.clear();
  }

  private dispatch(e: KeyboardEvent, phase: 'down' | 'up'): void {
    for (const binding of this.bindings.values()) {
      if (binding.key !== e.code) continue;
      // Edge-trigger by default: browser auto-repeat would multi-fire toggles.
      if (phase === 'down' && e.repeat && !binding.allowRepeat) continue;
      if (binding.preventDefault) {
        try {
          e.preventDefault();
        } catch {
          /* ignore */
        }
      }
      const fn = phase === 'down' ? binding.onDown : binding.onUp;
      if (fn) {
        try {
          fn(e);
        } catch (err) {
          this.onError(err, binding.id, phase);
        }
      }
    }
  }
}

function defaultOnError(error: unknown, id: string, phase: 'down' | 'up'): void {
  // eslint-disable-next-line no-console
  console.error(`[TSPML] keybind "${id}" ${phase} handler threw:`, error);
}
