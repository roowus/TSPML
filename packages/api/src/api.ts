import type { TspmlEventEmitter } from './events.js';
import type { KeybindsRegistry } from './keybinds.js';

/**
 * The `api` object every TSPML mod receives. The Tier-1 event bus is the first
 * member (M4); registries (keybinds now; blocks/cars/audio/tracks later) and
 * the mixin escape hatch follow.
 */
export interface TspmlApi {
  /** Stable, error-isolated event bus (Tier 1). */
  readonly events: TspmlEventEmitter;
  /** Keybind registry (Tier 1). */
  readonly keybinds: KeybindsRegistry;
  /** The TSPML loader's semantic version. */
  readonly version: string;
}
