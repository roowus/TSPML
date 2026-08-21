import type { AudioRegistry } from './audio.js';
import type { EditorRegistry } from './editor.js';
import type { TspmlEventSubscriber } from './events.js';
import type { KeybindsRegistry } from './keybinds.js';
import type { TracksRegistry } from './tracks.js';

/** Console-shaped logger handed to every mod (the loader's `ModApi` aliases this type). */
export type TspmlLogger = Pick<Console, 'log' | 'error' | 'warn' | 'info' | 'debug'>;

/**
 * The `api` object every TSPML mod receives. The Tier-1 event bus is the first
 * member (M4); registries (keybinds, tracks and audio now; blocks/cars later —
 * see events-and-registries.md for which are viable in 0.6.2) and the mixin
 * escape hatch follow.
 */
export interface TspmlApi {
  /**
   * Stable, error-isolated event bus (Tier 1) — **subscribe-only**. Emitting
   * belongs to the bridge and the host; see {@link TspmlEventSubscriber}.
   */
  readonly events: TspmlEventSubscriber;
  /** Keybind registry (Tier 1). */
  readonly keybinds: KeybindsRegistry;
  /** Custom-track registry (Tier 1) — register a track by import code. */
  readonly tracks: TracksRegistry;
  /** Audio registry (Tier 1) — override or add a game sound by URL. */
  readonly audio: AudioRegistry;
  /**
   * Track-editor registry (Tier 1) — read and place parts in the open editor
   * session. Always present; unavailable until the player opens the editor,
   * which the individual calls report (#87).
   */
  readonly editor: EditorRegistry;
  /** Console-shaped logger for mod diagnostics. */
  readonly logger: TspmlLogger;
  /** The TSPML loader's semantic version. */
  readonly version: string;
}
