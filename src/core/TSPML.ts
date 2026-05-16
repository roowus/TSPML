/**
 * TSPML - Main loader class
 * Coordinates all subsystems
 */

import { DeobfuscationLayer } from '../deobfuscation/DeobfuscationLayer';
import { MixinSystem } from '../mixin/MixinSystem';
import { PlayerAPI } from '../api/PlayerAPI';
import { ControlsAPI } from '../api/ControlsAPI';
import { UIAPI } from '../api/UIAPI';
import { PhysicsAPI } from '../api/PhysicsAPI';

export interface TSPMLConfig {
  polytrackVersion: string;
  debugMode?: boolean;
  enableMixins?: boolean;
  enableAPI?: boolean;
}

export class TSPML {
  private static instance: TSPML;

  public readonly version: string = '0.0.1';
  public readonly polytrackVersion: string;
  public readonly debugMode: boolean;

  // Core subsystems
  public deobfuscation: DeobfuscationLayer;
  public mixins: MixinSystem;

  // API layers
  public player: PlayerAPI;
  public controls: ControlsAPI;
  public ui: UIAPI;
  public physics: PhysicsAPI;

  // Mod management
  private mods: Map<string, any> = new Map();

  private constructor(config: TSPMLConfig) {
    this.polytrackVersion = config.polytrackVersion;
    this.debugMode = config.debugMode ?? false;

    // Initialize subsystems
    this.deobfuscation = new DeobfuscationLayer(this);
    this.mixins = new MixinSystem(this);

    // Initialize APIs
    this.player = new PlayerAPI(this);
    this.controls = new ControlsAPI(this);
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
   * Get an obfuscated value by its mapped name
   */
  public getFromPolyTrack(path: string): any {
    return this.deobfuscation.getValue(path);
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
