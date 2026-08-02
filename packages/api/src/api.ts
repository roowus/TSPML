import type { TspmlEventEmitter } from './events.js';
import type { KeybindsRegistry } from './keybinds.js';
import type { TracksRegistry } from './tracks.js';

/**
 * The `api` object every TSPML mod receives. The Tier-1 event bus is the first
 * member (M4); registries (keybinds + tracks now; blocks/cars/audio later — see
 * events-and-registries.md for which are viable in 0.6.2) and the mixin escape
 * hatch follow.
 */
export interface TspmlApi {
  /** Stable, error-isolated event bus (Tier 1). */
  readonly events: TspmlEventEmitter;
  /** Keybind registry (Tier 1). */
  readonly keybinds: KeybindsRegistry;
  /** Custom-track registry (Tier 1) — register a track by import code. */
  readonly tracks: TracksRegistry;
  /** The TSPML loader's semantic version. */
  readonly version: string;
}
