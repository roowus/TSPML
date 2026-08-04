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

/**
 * Minimal custom-track registry surface (#12). Unlike events/keybinds, `register`
 * is async and does NOT return an unsubscriber — it returns a result carrying the
 * registered name — so tracking records the NAME and disposes via `unregister`.
 */
export interface TrackRegistrable {
  register(track: { code: string; name?: string }): Promise<{ ok: boolean; name?: string }>;
  unregister(name: string): boolean;
}

/**
 * Minimal audio registry surface (#11). Same shape of problem as tracks — async
 * `register`, no unsubscriber — but keyed by `key`, and disposal matters more: an
 * overridden clip keeps playing in the game until it is unregistered, so a
 * hot-swap that skipped this would leave the previous mod's sounds audible.
 */
export interface AudioRegistrable {
  register(audio: { key: string; url: string }): Promise<{ ok: boolean; key?: string }>;
  unregister(key: string): boolean;
}

/** The api handed to a mod. */
export interface ModLikeApi {
  events: Subscribable;
  keybinds: Registrable;
  tracks?: TrackRegistrable;
  audio?: AudioRegistrable;
  readonly logger?: unknown;
  readonly version?: string;
}

/** A tracked api: the mod uses it as normal; the harness can disposeAll() on HMR. */
export interface TrackedModApi {
  events: Subscribable;
  keybinds: Registrable;
  tracks?: TrackRegistrable | undefined;
  audio?: AudioRegistrable | undefined;
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

  // Tracks the mod registered, so a hot-swap doesn't leave the previous mod's
  // tracks in the player's list. Recorded by name (register has no unsubscriber).
  const registeredTracks = new Set<string>();
  const inner = api.tracks;
  const tracks: TrackRegistrable | undefined = inner
    ? {
        register: async (t) => {
          const res = await inner.register(t);
          if (res.ok && res.name) registeredTracks.add(res.name);
          return res;
        },
        unregister: (name) => {
          registeredTracks.delete(name);
          return inner.unregister(name);
        },
      }
    : undefined;

  // Same for audio clips (#11): an override the previous mod installed stays in the
  // game's buffer lookup until unregistered, so HMR must drop it.
  const registeredAudio = new Set<string>();
  const innerAudio = api.audio;
  const audio: AudioRegistrable | undefined = innerAudio
    ? {
        register: async (a) => {
          const res = await innerAudio.register(a);
          // Fall back to the requested key: `register` echoes it on success, but a
          // shape change upstream must not silently drop the disposal record.
          if (res.ok) registeredAudio.add(res.key ?? a.key);
          return res;
        },
        unregister: (key) => {
          registeredAudio.delete(key);
          return innerAudio.unregister(key);
        },
      }
    : undefined;

  return {
    events,
    keybinds,
    tracks,
    audio,
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
      for (const name of [...registeredTracks]) {
        try {
          inner?.unregister(name);
        } catch {
          /* keep going */
        }
      }
      registeredTracks.clear();
      for (const key of [...registeredAudio]) {
        try {
          innerAudio?.unregister(key);
        } catch {
          /* keep going */
        }
      }
      registeredAudio.clear();
    },
  };
}
