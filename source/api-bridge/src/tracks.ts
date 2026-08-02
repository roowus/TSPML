import type {
  RegisteredTrack,
  TrackRegisterResult,
  TrackRegistration,
  TracksRegistry,
} from '@tspml/api';

/**
 * The two game objects this registry drives, captured from the live bundle by the
 * loader-owned bridge patches (see docs/design/hook-system.md):
 *
 *  - `trackManager` — the game's own track store (constructor param 5 of the
 *    track-selection UI module). Its `saveCustomTrack` writes to the same place the
 *    game's "Import" button does, and its change listeners make the list refresh.
 *  - `trackData` — the game's track codec class; `fromExportString` parses a
 *    `PolyTrack2…` import code and returns null for anything invalid.
 *
 * Both are structurally typed here (not `any`) so a shape change from a game update
 * fails at the boundary instead of somewhere deep in a mod.
 */
export interface GameTrackManager {
  saveCustomTrack(metadata: unknown, data: unknown): boolean;
  deleteCustomTrack(name: string): boolean;
  checkCustomTrackNameExists(name: string): boolean;
  forEachCustomTrack(fn: (id: string, metadata: TrackMetadataLike, data: unknown) => void): void;
}

export interface TrackMetadataLike {
  name: string;
  author: string | null;
  lastModified: Date | null;
}

export interface ParsedTrack {
  readonly trackMetadata: TrackMetadataLike;
  readonly trackData: { getId(): string };
}

export interface GameTrackCodec {
  fromExportString(code: string): ParsedTrack | null;
}

/** The captured game internals this registry needs. */
export interface TrackHost {
  readonly manager: GameTrackManager;
  readonly codec: GameTrackCodec;
}

export interface TracksOptions {
  /** Called when a game call throws (default: console.error). */
  readonly onError?: (error: unknown, phase: string) => void;
}

interface Entry {
  readonly name: string;
  readonly trackId: string;
  readonly author: string | null;
  readonly persist: boolean;
}

/**
 * Tier-1 custom-track registry. A mod hands over a PolyTrack import code; the
 * registry parses it with the GAME's codec and saves it through the GAME's store,
 * so the result is indistinguishable from a hand-imported track and the game's own
 * track-selection UI refreshes itself.
 *
 * The host (track store + codec) is captured from the running game, which does not
 * happen until the game builds its menu. So the registry starts UNBOUND: `register`
 * calls queue, and `attach()` drains the queue. Mods can therefore register at
 * `loader.init` without knowing about game lifecycle.
 *
 * `persist` is opt-out by default: the game's store writes to localStorage, so a
 * persisted mod track outlives the mod. Session-scoped registrations are removed by
 * `dispose()` (loader unload), which keeps an uninstalled mod from littering the
 * player's track list.
 */
export class Tracks implements TracksRegistry {
  private host: TrackHost | null = null;
  private readonly entries = new Map<string, Entry>();
  private readonly pending: {
    track: TrackRegistration;
    resolve: (r: TrackRegisterResult) => void;
  }[] = [];
  private readonly onError: (error: unknown, phase: string) => void;

  constructor(host: TrackHost | null = null, options: TracksOptions = {}) {
    this.host = host;
    this.onError = options.onError ?? defaultOnError;
  }

  /** True once the game's track store has been captured. */
  get ready(): boolean {
    return this.host !== null;
  }

  /** Number of queued registrations awaiting the game's store (testability). */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Bind the captured game internals and drain anything registered early. Called
   * by the bridge when the capture patch fires; safe to call once.
   */
  attach(host: TrackHost): void {
    if (this.host) return;
    this.host = host;
    const queued = this.pending.splice(0, this.pending.length);
    for (const { track, resolve } of queued) resolve(this.apply(track));
  }

  async register(track: TrackRegistration): Promise<TrackRegisterResult> {
    if (!this.host) {
      // Queue until the game's store exists, so mods can register at loader.init.
      return new Promise<TrackRegisterResult>((resolve) => {
        this.pending.push({ track, resolve });
      });
    }
    return this.apply(track);
  }

  unregister(name: string): boolean {
    const entry = this.entries.get(name);
    if (!entry) return false;
    this.entries.delete(name);
    if (!this.host) return true;
    try {
      this.host.manager.deleteCustomTrack(name);
    } catch (err) {
      this.onError(err, `deleteCustomTrack(${name})`);
    }
    return true;
  }

  list(): readonly RegisteredTrack[] {
    const live: RegisteredTrack[] = [...this.entries.values()].map((e) => ({ ...e }));
    // Queued-but-not-yet-applied registrations are part of the mod's view too.
    for (const { track } of this.pending) {
      live.push({
        name: track.name ?? '(pending)',
        trackId: '',
        author: track.author ?? null,
        persist: track.persist === true,
      });
    }
    return live;
  }

  /**
   * Remove every SESSION-scoped track this registry added (loader unload). Tracks
   * registered with `persist: true` are intentionally left in place — the mod asked
   * for them to survive.
   */
  dispose(): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.persist) continue;
      this.entries.delete(entry.name);
      try {
        this.host?.manager.deleteCustomTrack(entry.name);
      } catch (err) {
        this.onError(err, `dispose/deleteCustomTrack(${entry.name})`);
      }
    }
  }

  /** The real work, once a host exists. */
  private apply(track: TrackRegistration): TrackRegisterResult {
    const host = this.host;
    if (!host) return { ok: false, reason: 'not-ready' };

    let parsed: ParsedTrack | null;
    try {
      parsed = host.codec.fromExportString(track.code);
    } catch (err) {
      this.onError(err, 'fromExportString');
      return { ok: false, reason: 'invalid-code', detail: describe(err) };
    }
    if (!parsed) return { ok: false, reason: 'invalid-code' };

    // The mod's name/author override what the code carries; the store keys on name.
    const metadata: TrackMetadataLike = {
      name: track.name ?? parsed.trackMetadata.name,
      author: track.author ?? parsed.trackMetadata.author ?? null,
      lastModified: parsed.trackMetadata.lastModified ?? null,
    };

    let exists: boolean;
    try {
      exists = host.manager.checkCustomTrackNameExists(metadata.name);
    } catch (err) {
      this.onError(err, 'checkCustomTrackNameExists');
      return { ok: false, reason: 'save-failed', detail: describe(err) };
    }
    // Refuse rather than clobber: the colliding track may be the PLAYER's own.
    if (exists && track.overwrite !== true) {
      return { ok: false, reason: 'name-exists', detail: metadata.name };
    }

    let saved: boolean;
    try {
      saved = host.manager.saveCustomTrack(metadata, parsed.trackData);
    } catch (err) {
      this.onError(err, 'saveCustomTrack');
      return { ok: false, reason: 'save-failed', detail: describe(err) };
    }
    if (!saved) return { ok: false, reason: 'save-failed' };

    let trackId = '';
    try {
      trackId = parsed.trackData.getId();
    } catch (err) {
      this.onError(err, 'getId');
    }

    this.entries.set(metadata.name, {
      name: metadata.name,
      trackId,
      author: metadata.author,
      persist: track.persist === true,
    });
    return { ok: true, name: metadata.name, trackId };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultOnError(error: unknown, phase: string): void {
  // eslint-disable-next-line no-console
  console.error(`[TSPML] tracks registry: ${phase} threw:`, error);
}
