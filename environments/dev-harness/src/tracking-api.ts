/**
 * @tspml/dev-harness — tracking api wrapper for scoped mod hot-reload.
 *
 * A mod's entrypoint subscribes to events + registers keybinds via the `api` it
 * receives. To hot-swap the mod on source edit (Vite HMR) WITHOUT reloading the
 * game, we must tear down the OLD mod's subscriptions before running the NEW
 * factory. This wrapper records the unsubscribe handle returned by every `on`/
 * `once`/`register` the mod makes, so `disposeAll()` can clean them up — with no
 * change to the mod API or the mod's code (the mod just uses `api` normally).
 *
 * Deliberately decoupled from the concrete bridge classes (structural interfaces)
 * so it is unit-testable with plain mocks.
 */

/** Minimal event-emitter surface a mod subscribes through. */
export interface Subscribable {
  on(event: string, fn: (...args: unknown[]) => void): () => void;
  once(event: string, fn: (...args: unknown[]) => void): () => void;
}

/** Minimal registry surface a mod registers keybinds through. */
export interface Registrable {
  register(binding: { id: string }): () => void;
}

/** The api handed to a mod. */
export interface ModLikeApi {
  events: Subscribable;
  keybinds: Registrable;
  readonly logger?: unknown;
  readonly version?: string;
}

/** A tracked api: the mod uses it as normal; the harness can disposeAll() on HMR. */
export interface TrackedModApi {
  events: Subscribable;
  keybinds: Registrable;
  readonly logger?: unknown;
  readonly version?: string | undefined;
  /** Tear down every subscription the mod made through this tracked api. */
  disposeAll(): void;
}

/**
 * Wrap a mod api so every subscription is recorded for later disposal.
 * @param api the real api (bridge EventBus + Keybinds)
 */
export function trackModApi(api: ModLikeApi): TrackedModApi {
  const offs = new Set<() => void>();
  const track = (off: () => void): (() => void) => {
    offs.add(off);
    return () => {
      if (offs.delete(off)) {
        try {
          off();
        } catch {
          /* a disposal error must not break the mod's own cleanup */
        }
      }
    };
  };

  const events: Subscribable = {
    on: (event, fn) => track(api.events.on(event, fn)),
    once: (event, fn) => track(api.events.once(event, fn)),
  };
  const keybinds: Registrable = {
    register: (binding) => track(api.keybinds.register(binding)),
  };

  return {
    events,
    keybinds,
    logger: api.logger,
    version: api.version,
    disposeAll: () => {
      // Snapshot first: an unsubscribe that throws shouldn't skip the rest.
      for (const off of [...offs]) {
        try {
          off();
        } catch {
          /* keep going */
        }
      }
      offs.clear();
    },
  };
}
