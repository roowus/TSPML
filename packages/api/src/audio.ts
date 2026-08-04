// Tier-1 audio registry: a mod overrides one of the game's sound effects (or
// supplies a new clip the game will ask for) by URL. See
// docs/api/events-and-registries.md.
//
// Like `tracks`, this reuses the game's OWN machinery — the clip is decoded with
// the game's live AudioContext and served from the game's own buffer lookup, so a
// registered sound plays through the game's real mixer (master/SFX gain, mute,
// app-inactive handling) with no parallel audio path.

/** Why an `audio.register` call did not produce a usable clip. */
export type AudioRegisterFailure =
  /** The URL could not be fetched (network error, 404, blocked by CSP). */
  | 'fetch-failed'
  /** Fetched, but the bytes are not audio the browser can decode. */
  | 'decode-failed'
  /**
   * The game has no AudioContext — construction threw, or the browser refused
   * one. The game itself is silent in this state, so an override is meaningless.
   */
  | 'no-audio-context'
  /** A clip is already registered under this key and `overwrite` was not set. */
  | 'key-exists'
  /** The registry is not wired yet — the game has not built its menu. */
  | 'not-ready';

/** Outcome of an `audio.register` call. */
export type AudioRegisterResult =
  | {
      readonly ok: true;
      readonly key: string;
      /** Decoded clip length in seconds, as the game's decoder reported it. */
      readonly duration: number;
      /** True if this replaced one of the game's built-in clips (see `BuiltinAudioKey`). */
      readonly replacedBuiltin: boolean;
    }
  | { readonly ok: false; readonly reason: AudioRegisterFailure; readonly detail?: string };

/**
 * The clip keys PolyTrack 0.6.2 loads at boot. Registering one of these REPLACES
 * that sound everywhere the game plays it; any other key is additive (stored, and
 * returned if the game or another mod later asks for it).
 *
 * Typed as a union plus `(string & {})` so autocomplete offers the built-ins
 * without rejecting a custom key.
 */
export type BuiltinAudioKey =
  | 'music'
  | 'click'
  | 'engine'
  | 'suspension'
  | 'tires'
  | 'collision'
  | 'skidding'
  | 'editor_edit'
  | 'checkpoint'
  | 'record'
  | 'position_tick';

/** A clip a mod wants the game to use. */
export interface AudioRegistration {
  /**
   * Which sound to serve. One of {@link BuiltinAudioKey} to override a game
   * sound, or any other string to add a clip under a new key.
   */
  // eslint-disable-next-line @typescript-eslint/ban-types
  readonly key: BuiltinAudioKey | (string & {});
  /**
   * Where to fetch the clip. Any URL the page may load — a `blob:`/`data:` URL
   * from mod-bundled bytes works and avoids a network round trip. Fetched by the
   * REGISTRY (not the game's loader), so it is safe after boot.
   */
  readonly url: string;
  /**
   * Replace an existing registration under this key. Default `false`. Note this
   * guards mod-vs-mod collisions only: overriding a GAME built-in is the point of
   * the registry and never needs `overwrite`.
   */
  readonly overwrite?: boolean;
}

/** A clip currently registered by mods through this registry. */
export interface RegisteredAudio {
  readonly key: string;
  readonly duration: number;
  readonly replacedBuiltin: boolean;
}

/**
 * Audio registry. Implemented by `@tspml/api-bridge` (`Audio`).
 *
 * TIMING: the registry needs the game's live audio manager, which TSPML captures
 * when the game builds its track-selection UI (roughly, the main menu). `register`
 * called before that is QUEUED and applied when the manager appears — so a mod can
 * register at `loader.init` without waiting. `list()` reflects queued entries too.
 *
 * AUTOPLAY: browsers start an AudioContext suspended until a user gesture. The
 * game already installs listeners to resume it, so a registered clip may decode
 * successfully and stay inaudible until the player clicks. That is the game's
 * normal behaviour, not a registry failure.
 */
export interface AudioRegistry {
  /** Register a clip by URL. Async: fetch + decode, and may wait for the game. */
  register(audio: AudioRegistration): Promise<AudioRegisterResult>;
  /**
   * Drop a mod registration. If it had overridden a game built-in, the game's
   * ORIGINAL clip is restored. Returns false if the key wasn't registered here.
   */
  unregister(key: string): boolean;
  /** The clips registered through this registry (not the game's own). */
  list(): readonly RegisteredAudio[];
}
