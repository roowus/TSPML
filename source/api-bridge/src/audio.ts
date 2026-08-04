import type {
  AudioRegisterResult,
  AudioRegistration,
  AudioRegistry,
  RegisteredAudio,
} from '@tspml/api';

/**
 * The game's audio manager, captured from the live bundle by the loader-owned
 * bridge patches (see docs/design/hook-system.md).
 *
 * It reaches us as constructor param 3 of the track-selection UI module — the SAME
 * constructor that already yields the TrackManager for `api.tracks`, so the audio
 * capture costs no new anchor and no new module locator work. (Issue #11 assumed
 * the manager was an unreachable bootstrap local needing a new capture mechanism;
 * it is reachable, and the class it is handed to is already a committed target.)
 *
 * Structurally typed (not `any`) so a shape change from a game update fails at
 * this boundary instead of somewhere deep in a mod.
 */
export interface GameAudioManager {
  /**
   * The live `AudioContext`, or null when the game failed to create one (it
   * catches and logs). A public field on the game's class, so we can both read it
   * for decoding and check for the silent case.
   */
  context: AudioContext | null;
  /** The game's clip lookup: key → decoded buffer, or null if absent/failed. */
  getBuffer(key: string): AudioBuffer | null;
}

/** The captured game internals this registry needs. */
export interface AudioHost {
  readonly manager: GameAudioManager;
}

export interface AudioOptions {
  /** Called when a game call or fetch throws (default: console.error). */
  readonly onError?: (error: unknown, phase: string) => void;
  /**
   * Injectable fetch, for tests and for surfaces that must route through a proxy.
   * Defaults to the ambient `fetch`.
   */
  readonly fetchImpl?: typeof fetch;
}

interface Entry {
  readonly key: string;
  readonly duration: number;
  readonly replacedBuiltin: boolean;
  readonly buffer: AudioBuffer;
}

/**
 * The clip keys PolyTrack 0.6.2 loads at boot (bootstrap `l.load(...)` calls).
 * Used only to report `replacedBuiltin` — an unknown key is still registered.
 */
const BUILTIN_KEYS: ReadonlySet<string> = new Set([
  'music',
  'click',
  'engine',
  'suspension',
  'tires',
  'collision',
  'skidding',
  'editor_edit',
  'checkpoint',
  'record',
  'position_tick',
]);

/**
 * Tier-1 audio registry. A mod hands over a URL; the registry fetches it, decodes
 * it with the GAME's own `AudioContext`, and serves it from the GAME's own buffer
 * lookup — so the clip plays through the real mixer (master/SFX gain, mute,
 * app-inactive handling) with no parallel audio path.
 *
 * ## Why this SHADOWS getBuffer instead of calling the game's load()
 *
 * The obvious implementation — hand the URL to the manager's own `load(key, urls)`
 * — is a **latent crash**. `load()` starts by calling `addResource()` on the
 * game's loading-screen tracker, and that method throws
 * `"Cannot add resources after loading is complete"` once boot has finished. Since
 * this registry is reachable only AFTER the menu exists, every mod call would land
 * in exactly that window and take down the game's own load accounting.
 *
 * Instead the registry decodes the clip itself and installs one own-property
 * `getBuffer` on the captured instance, which answers from the mod map and
 * otherwise delegates to the prototype method. Consequences worth knowing:
 *
 *  - The game reads clips through `getBuffer` at PLAY time, not at load time
 *    (`playUIClick()` and the car-controller's per-frame sound code both call it),
 *    so an override takes effect immediately — no reload, no re-decode.
 *  - `unregister` restores the game's original clip for free: drop the key from
 *    the map and the delegate answers again.
 *  - The game's own resource tracker is untouched, so the loading screen keeps
 *    working and nothing throws.
 *
 * The host (audio manager) is captured from the running game, which does not happen
 * until the game builds its menu. So the registry starts UNBOUND: `register` calls
 * queue, and `attach()` drains the queue. Mods can therefore register at
 * `loader.init` without knowing about game lifecycle.
 */
export class Audio implements AudioRegistry {
  private host: AudioHost | null = null;
  private readonly entries = new Map<string, Entry>();
  private readonly pending: {
    audio: AudioRegistration;
    resolve: (r: AudioRegisterResult) => void;
  }[] = [];
  private readonly onError: (error: unknown, phase: string) => void;
  private readonly fetchImpl: typeof fetch | undefined;
  /** The instance we patched, and the method we shadowed — so we can undo it. */
  private patched: GameAudioManager | null = null;

  constructor(host: AudioHost | null = null, options: AudioOptions = {}) {
    this.onError = options.onError ?? defaultOnError;
    this.fetchImpl = options.fetchImpl;
    if (host) this.attach(host);
  }

  /** True once the game's audio manager has been captured. */
  get ready(): boolean {
    return this.host !== null;
  }

  /** Number of queued registrations awaiting the game (testability). */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Bind the captured game internals and drain anything registered early. Called
   * by the bridge when the capture patch fires; safe to call more than once.
   */
  attach(host: AudioHost): void {
    if (this.host) return;
    this.host = host;
    this.installShadow(host.manager);
    const queued = this.pending.splice(0, this.pending.length);
    // Each queued clip still needs its own fetch+decode, so this is async; the
    // promise each mod is holding resolves as its own clip lands.
    for (const { audio, resolve } of queued) {
      this.apply(audio).then(resolve, (err: unknown) => {
        this.onError(err, `drain(${audio.key})`);
        resolve({ ok: false, reason: 'decode-failed', detail: describe(err) });
      });
    }
  }

  async register(audio: AudioRegistration): Promise<AudioRegisterResult> {
    if (!this.host) {
      // Queue until the game's manager exists, so mods can register at loader.init.
      return new Promise<AudioRegisterResult>((resolve) => {
        this.pending.push({ audio, resolve });
      });
    }
    return this.apply(audio);
  }

  unregister(key: string): boolean {
    // Dropping the key is all it takes: the shadow delegates unknown keys to the
    // game's own method, so a replaced built-in comes back on its own.
    return this.entries.delete(key);
  }

  list(): readonly RegisteredAudio[] {
    const live: RegisteredAudio[] = [...this.entries.values()].map((e) => ({
      key: e.key,
      duration: e.duration,
      replacedBuiltin: e.replacedBuiltin,
    }));
    // Queued-but-not-yet-decoded registrations are part of the mod's view too.
    for (const { audio } of this.pending) {
      live.push({ key: audio.key, duration: 0, replacedBuiltin: BUILTIN_KEYS.has(audio.key) });
    }
    return live;
  }

  /**
   * Drop every mod clip and remove the shadow, restoring the game's own lookup
   * exactly (loader unload). Unlike `tracks`, nothing here persists: clips live in
   * memory only, so there is no `persist` opt-out to honour.
   */
  dispose(): void {
    this.entries.clear();
    const manager = this.patched;
    this.patched = null;
    if (!manager) return;
    try {
      // Delete the OWN property so the prototype method is reachable again. We
      // only ever added one, so this cannot clobber a game-owned own-property.
      delete (manager as { getBuffer?: unknown }).getBuffer;
    } catch (err) {
      this.onError(err, 'dispose/restoreGetBuffer');
    }
  }

  /**
   * Install the mod-aware `getBuffer` as an own property of the captured instance.
   * Idempotent, and a no-op if we somehow already patched this object.
   */
  private installShadow(manager: GameAudioManager): void {
    if (this.patched === manager) return;
    const original = manager.getBuffer.bind(manager);
    const entries = this.entries;
    try {
      Object.defineProperty(manager, 'getBuffer', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: function getBuffer(key: string): AudioBuffer | null {
          const entry = entries.get(key);
          if (entry) return entry.buffer;
          return original(key);
        },
      });
      this.patched = manager;
    } catch (err) {
      // A frozen instance would land here. The registry then still "works" in the
      // sense that nothing throws, but overrides cannot take effect — so say so
      // loudly rather than failing silently later.
      this.onError(err, 'installShadow');
    }
  }

  /** The real work, once a host exists. */
  private async apply(audio: AudioRegistration): Promise<AudioRegisterResult> {
    const host = this.host;
    if (!host) return { ok: false, reason: 'not-ready' };

    if (this.entries.has(audio.key) && audio.overwrite !== true) {
      return { ok: false, reason: 'key-exists', detail: audio.key };
    }

    // The game caught its own AudioContext failure and set null; it is silent in
    // that state, so an override has nothing to play through.
    const context = host.manager.context;
    if (!context) return { ok: false, reason: 'no-audio-context' };

    let bytes: ArrayBuffer;
    try {
      const doFetch = this.fetchImpl ?? fetch;
      const response = await doFetch(audio.url);
      if (!response.ok) {
        return {
          ok: false,
          reason: 'fetch-failed',
          detail: `${String(response.status)} ${response.statusText}`,
        };
      }
      bytes = await response.arrayBuffer();
    } catch (err) {
      this.onError(err, `fetch(${audio.url})`);
      return { ok: false, reason: 'fetch-failed', detail: describe(err) };
    }

    let buffer: AudioBuffer;
    try {
      buffer = await context.decodeAudioData(bytes);
    } catch (err) {
      // Not an error worth shouting about: a mod shipping a bad file is its bug,
      // and the typed failure already tells it so.
      return { ok: false, reason: 'decode-failed', detail: describe(err) };
    }

    const replacedBuiltin = BUILTIN_KEYS.has(audio.key);
    this.entries.set(audio.key, {
      key: audio.key,
      duration: buffer.duration,
      replacedBuiltin,
      buffer,
    });
    return { ok: true, key: audio.key, duration: buffer.duration, replacedBuiltin };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultOnError(error: unknown, phase: string): void {
  // eslint-disable-next-line no-console
  console.error(`[TSPML] audio registry: ${phase} threw:`, error);
}
