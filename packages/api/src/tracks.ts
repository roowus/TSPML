// Tier-1 custom-track registry: a mod registers a PolyTrack track IMPORT CODE and
// the track appears under "Custom tracks". See docs/api/events-and-registries.md.
//
// This reuses the game's OWN track format and its OWN store — the registry parses
// the code with the game's codec and saves through the game's TrackManager, so a
// registered track is indistinguishable from one the player imported by hand
// (and the game's own list UI refreshes itself). No custom data structures.

/** Why a `tracks.register` call did not produce a track. */
export type TrackRegisterFailure =
  /** The game's codec rejected the code (`fromExportString` returned null). */
  | 'invalid-code'
  /** A track with this name already exists and `overwrite` was not set. */
  | 'name-exists'
  /** The game's store refused the save (quota, storage error). */
  | 'save-failed'
  /** The registry is not wired yet — the game has not reached the menu. */
  | 'not-ready';

/** Outcome of a `tracks.register` call. */
export type TrackRegisterResult =
  | { readonly ok: true; readonly name: string; readonly trackId: string }
  | { readonly ok: false; readonly reason: TrackRegisterFailure; readonly detail?: string };

/** A track a mod wants to appear in the player's "Custom tracks" list. */
export interface TrackRegistration {
  /**
   * A PolyTrack track import code — the same `PolyTrack2…` string the game's own
   * "Paste track data here…" import box accepts. Whitespace is ignored.
   */
  readonly code: string;
  /**
   * Display name. Defaults to the name embedded in the code. This is also the
   * store KEY — two tracks cannot share a name (see `overwrite`).
   */
  readonly name?: string;
  /** Author shown in the list. Defaults to the author embedded in the code. */
  readonly author?: string;
  /**
   * Replace an existing track of the same name. Default `false` — the registry
   * refuses rather than clobbering a track the PLAYER may have made.
   */
  readonly overwrite?: boolean;
  /**
   * Write the track to the game's persistent storage, so it survives a reload —
   * and outlives the mod. Default `false`: registered tracks are session-scoped
   * and removed on unload, so an uninstalled mod does not litter the track list.
   */
  readonly persist?: boolean;
}

/** A track currently registered by mods through this registry. */
export interface RegisteredTrack {
  readonly name: string;
  readonly trackId: string;
  readonly author: string | null;
  readonly persist: boolean;
}

/**
 * Custom-track registry. Implemented by `@tspml/api-bridge` (`Tracks`).
 *
 * TIMING: the registry can only reach the game's track store once the game has
 * built its track-selection UI (roughly, the main menu). `register` called before
 * that is QUEUED and applied when the store appears — so a mod can register at
 * `loader.init` without waiting. `list()` reflects queued entries too.
 */
export interface TracksRegistry {
  /** Register a track from an import code. Async: may wait for the game's store. */
  register(track: TrackRegistration): Promise<TrackRegisterResult>;
  /** Remove a track this registry added. Returns false if it wasn't registered here. */
  unregister(name: string): boolean;
  /** The tracks registered through this registry (not the player's own). */
  list(): readonly RegisteredTrack[];
}
