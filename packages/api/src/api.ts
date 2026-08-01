import type { TspmlEventEmitter } from './events.js';
import type { KeybindsRegistry } from './keybinds.js';

/**
 * The `api` object every TSPML mod receives. The Tier-1 event bus is the first
 * member (M4); registries (keybinds now; blocks/cars/audio/tracks later) and
 * the mixin escape hatch follow.
 */
/** Console-shaped logger handed to every mod (matches the loader's ModApi). */
export type TspmlLogger = Pick<Console, 'log' | 'error' | 'warn' | 'info' | 'debug'>;

export interface TspmlApi {
  /** Stable, error-isolated event bus (Tier 1). */
  readonly events: TspmlEventEmitter;
  /** Keybind registry (Tier 1). */
  readonly keybinds: KeybindsRegistry;
  /** Console-shaped logger for mod diagnostics. */
  readonly logger: TspmlLogger;
  /** The TSPML loader's semantic version. */
  readonly version: string;
}
