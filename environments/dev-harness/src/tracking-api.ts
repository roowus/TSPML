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

import type {
  AudioRegisterResult,
  AudioRegistration,
  AudioRegistry,
  KeybindsRegistry,
  RegisteredAudio,
  RegisteredTrack,
  TrackRegisterResult,
  TrackRegistration,
  TracksRegistry,
  TspmlApi,
  TspmlEventSubscriber,
} from "@tspml/api";

/**
 * What the required-but-unattached members answer with.
 *
 * `@tspml/loader` exports an equivalent `stubApi`, but importing it here would be
 * a RUNTIME import: CI runs `pnpm -r test` before `pnpm -r build`, so the loader's
 * `dist/` does not exist yet and vite cannot resolve the package entry. A local
 * literal keeps the harness's tests independent of build order — the type imports
 * above are erased and cost nothing.
 */
const NOT_READY = { ok: false, reason: "not-ready" } as const;

/**
 * Minimal event-emitter surface a mod subscribes through.
 *
 * Deliberately `string`-keyed and loosely typed, unlike the published
 * `TspmlEventSubscriber`: this is the shape the wrapper accepts as INPUT, and
 * keeping it structural is what lets the tests drive it with plain `vi.fn()`
 * mocks instead of a real bus. The wrapper's OUTPUT is the strict published
 * type — see {@link TrackedModApi}.
 */
export interface Subscribable {
  on(event: string, fn: (...args: unknown[]) => void): () => void;
  once(event: string, fn: (...args: unknown[]) => void): () => void;
  /** Optional so test mocks need not implement it; a real `EventBus` has it. */
  off?(event: string, fn: (...args: unknown[]) => void): void;
}

/** Minimal registry surface a mod registers keybinds through. */
export interface Registrable {
  register(binding: { id: string }): () => void;
  /** Optional for the same reason as {@link Subscribable.off}. */
  unregister?(id: string): void;
}

/**
 * Minimal custom-track registry surface (#12). Unlike events/keybinds, `register`
 * is async and does NOT return an unsubscriber — it returns a result carrying the
 * registered name — so tracking records the NAME and disposes via `unregister`.
 */
export interface TrackRegistrable {
  register(track: TrackRegistration): Promise<TrackRegisterResult>;
  unregister(name: string): boolean;
  /** Optional so test mocks need not implement it. */
  list?(): readonly RegisteredTrack[];
}

/**
 * Minimal audio registry surface (#11). Same shape of problem as tracks — async
 * `register`, no unsubscriber — but keyed by `key`, and disposal matters more: an
 * overridden clip keeps playing in the game until it is unregistered, so a
 * hot-swap that skipped this would leave the previous mod's sounds audible.
 */
export interface AudioRegistrable {
  register(audio: AudioRegistration): Promise<AudioRegisterResult>;
  unregister(key: string): boolean;
  /** Optional so test mocks need not implement it. */
  list?(): readonly RegisteredAudio[];
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

/**
 * A tracked api: the mod uses it as normal; the harness can disposeAll() on HMR.
 *
 * Extends the published {@link TspmlApi} rather than mirroring it structurally
 * (#18). The mirror used to be missing `off`, typed `logger` as `unknown`, and
 * made `tracks`/`audio` optional — so handing it to a mod needed
 * `as unknown as ModApi`, and a mod that called `api.off(...)` type-checked
 * against a surface that had no such method. The harness was lying to the very
 * mods it exists to test.
 *
 * The INPUT ({@link ModLikeApi}) stays structural so tests can pass mocks; only
 * what the mod receives is strict.
 */
export interface TrackedModApi extends TspmlApi {
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

  // The published `TspmlEventSubscriber` is generic over the event map, while the
  // input `Subscribable` is `string`-keyed with `unknown[]` listener args. The
  // wrapper is genuinely event-agnostic — it only records the unsubscriber — so
  // the parameters are erased on the way in and the strict signature restored on
  // the way out. `off` delegates when the input has it (a real bus always does)
  // and is a no-op otherwise, which is the honest answer for a mock that never
  // recorded the subscription in the first place.
  // The one unavoidable cast in this file, and the reason it is unavoidable:
  // `TspmlEventMap` gives each event a DIFFERENT readonly-tuple argument list, so
  // a listener generic over `K` has no single loose supertype — TS reduces the
  // intersection of every event's tuple to `never`. The wrapper never inspects an
  // argument; it only records the unsubscriber, so erasing the parameters here is
  // sound in a way the type system cannot express. Confined to these three lines
  // rather than applied to the whole api object, which is what #18 removed.
  type LooseListener = (...args: unknown[]) => void;
  const loose = (listener: unknown): LooseListener => listener as LooseListener;
  const events: TspmlEventSubscriber = {
    on: (event, listener) => track(api.events.on(event, loose(listener))),
    once: (event, listener) => track(api.events.once(event, loose(listener))),
    off: (event, listener) => {
      api.events.off?.(event, loose(listener));
    },
  };
  const keybinds: KeybindsRegistry = {
    register: (binding) => track(api.keybinds.register(binding)),
    unregister: (id) => {
      api.keybinds.unregister?.(id);
    },
  };

  // Tracks the mod registered, so a hot-swap doesn't leave the previous mod's
  // tracks in the player's list. Recorded by name (register has no unsubscriber).
  const registeredTracks = new Set<string>();
  const inner = api.tracks;
  const tracks: TracksRegistry | undefined = inner
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
        list: () => inner.list?.() ?? [],
      }
    : undefined;

  // Same for audio clips (#11): an override the previous mod installed stays in the
  // game's buffer lookup until unregistered, so HMR must drop it.
  const registeredAudio = new Set<string>();
  const innerAudio = api.audio;
  const audio: AudioRegistry | undefined = innerAudio
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
        list: () => innerAudio.list?.() ?? [],
      }
    : undefined;

  return {
    events,
    keybinds,
    // `TspmlApi` requires these; the harness may not have them yet (the registries
    // need the game frame). Until then they answer `'not-ready'`, which is
    // precisely true here — and is what a mod would get calling too early against
    // a real bridge, so the harness stays representative rather than special.
    tracks: tracks ?? {
      register: () => Promise.resolve(NOT_READY),
      unregister: () => false,
      list: () => [],
    },
    audio: audio ?? {
      register: () => Promise.resolve(NOT_READY),
      unregister: () => false,
      list: () => [],
    },
    logger: (api.logger as TspmlApi['logger'] | undefined) ?? console,
    version: api.version ?? "0.0.0-stub",
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
