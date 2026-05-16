/**
 * PolyMod - Base class for all mods
 * Mods should extend this class and export an instance
 */

import type { TSPML } from './TSPML';

export interface PolyModMetadata {
  modName: string;
  modID: string;
  modVersion: string;
  modAuthor: string;
  description?: string;
  polytrackVersion?: string[];
}

export abstract class PolyMod {
  // Required metadata (set by mod)
  public abstract modName: string;
  public abstract modID: string;
  public abstract modVersion: string;
  public abstract modAuthor: string;
  public description?: string;

  // Lifecycle hooks (mods override these)
  public preInit?: (pml: TSPML) => void | Promise<void>;
  public init?: (pml: TSPML) => void | Promise<void>;
  public postInit?: () => void | Promise<void>;
  public onGameLoad?: () => void | Promise<void>;
  public onGameTick?: () => void | Promise<void>;
  public onDestroy?: () => void | Promise<void>;

  // Internal state
  protected pml?: TSPML;
  protected enabled: boolean = true;

  /**
   * Enable this mod
   */
  public enable(): void {
    this.enabled = true;
  }

  /**
   * Disable this mod
   */
  public disable(): void {
    this.enabled = false;
  }

  /**
   * Check if mod is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }
}
