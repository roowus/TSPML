import type { TspmlEventEmitter } from './events.js';

/**
 * The `api` object every TSPML mod receives. The Tier-1 event bus is the first
 * member (M4); registries (blocks/cars/audio/tracks/ui/settings/keybinds) and
 * the mixin escape hatch are added in M4–M5.
 */
export interface TspmlApi {
  /** Stable, error-isolated event bus (Tier 1). */
  readonly events: TspmlEventEmitter;
  /** The TSPML loader's semantic version. */
  readonly version: string;
}
