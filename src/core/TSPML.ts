/**
 * TSPML - Main loader class
 * Coordinates all subsystems
 * Implements ICoreContext to break circular dependencies
 */

import { ICoreContext, TSPMLConfig } from '../types';
import { DeobfuscationLayer } from '../deobfuscation/DeobfuscationLayer';
import { MixinSystem } from '../mixin/MixinSystem';
import { PlayerAPI } from '../api/PlayerAPI';
import { ControlsAPI } from '../api/ControlsAPI';
import { UIAPI } from '../api/UIAPI';
import { PhysicsAPI } from '../api/PhysicsAPI';

export class TSPML implements ICoreContext {
  private static instance: TSPML;

  public readonly version: string = '0.0.1';
  public readonly polytrackVersion: string;

  // Core subsystems (these don't depend on TSPML directly anymore)
  public deobfuscation: DeobfuscationLayer;
  public mixins: MixinSystem;

  // API layers (these don't depend on TSPML directly anymore)
  public player: PlayerAPI;
  public controls: ControlsAPI;
  public ui: UIAPI;
  public physics: PhysicsAPI;

  // Mod management
  private mods: Map<string, any> = new Map();

  // ICoreContext implementation
  public readonly debugMode: boolean;

  private constructor(config: TSPMLConfig) {
    this.polytrackVersion = config.polytrackVersion;
    this.debugMode = config.debugMode ?? false;

    // Initialize subsystems with 'this' as ICoreContext
    // This breaks circular dependencies - subsystems only know about ICoreContext interface
    this.deobfuscation = new DeobfuscationLayer(this);
    this.mixins = new MixinSystem(this);

    // Initialize controls first (PlayerAPI depends on it)
    this.controls = new ControlsAPI(this);

    // Initialize player with controls dependency
    this.player = new PlayerAPI(this, this.controls);
    this.ui = new UIAPI(this);
    this.physics = new PhysicsAPI(this);

    if (this.debugMode) {
      console.log(`[TS PML] Initialized v${this.version} for PolyTrack ${this.polytrackVersion}`);
    }
  }

  public static initialize(config: TSPMLConfig): TSPML {
    if (!TSPML.instance) {
      TSPML.instance = new TSPML(config);
    }
    return TSPML.instance;
  }

  public static getInstance(): TSPML {
    if (!TSPML.instance) {
      throw new Error('[TS PML] Not initialized. Call TSPML.initialize() first.');
    }
    return TSPML.instance;
  }

  // ==========================================================================
  // ICORECONTEXT IMPLEMENTATION
  // ==========================================================================

  /**
   * Get an obfuscated value by its mapped name
   * Part of ICoreContext interface
   */
  public getFromPolyTrack(path: string): any {
    return this.deobfuscation.getValue(path);
  }

  // ==========================================================================
  // MOD MANAGEMENT
  // ==========================================================================

  /**
   * Register a mod
   */
  public registerMod(mod: any): void {
    this.mods.set(mod.modID, mod);

    if (this.debugMode) {
      console.log(`[TS PML] Registered mod: ${mod.modName} v${mod.modVersion} by ${mod.modAuthor}`);
    }
  }

  /**
   * Get a registered mod
   */
  public getMod(modID: string): any | undefined {
    return this.mods.get(modID);
  }

  /**
   * Get all registered mods
   */
  public getAllMods(): any[] {
    return Array.from(this.mods.values());
  }

  /**
   * Initialize all mods (call their lifecycle hooks)
   */
  public async initMods(): Promise<void> {
    if (this.debugMode) {
      console.log(`[TS PML] Initializing ${this.mods.size} mods...`);
    }

    for (const mod of this.mods.values()) {
      try {
        // Pre-init phase
        if (mod.preInit) {
          await mod.preInit(this);
        }
      } catch (error) {
        console.error(`[TS PML] Error in ${mod.modID}.preInit():`, error);
      }
    }

    for (const mod of this.mods.values()) {
      try {
        // Init phase
        if (mod.init) {
          await mod.init(this);
        }
      } catch (error) {
        console.error(`[TS PML] Error in ${mod.modID}.init():`, error);
      }
    }

    for (const mod of this.mods.values()) {
      try {
        // Post-init phase
        if (mod.postInit) {
          await mod.postInit();
        }
      } catch (error) {
        console.error(`[TS PML] Error in ${mod.modID}.postInit():`, error);
      }
    }

    if (this.debugMode) {
      console.log(`[TS PML] All mods initialized!`);
    }
  }
}
