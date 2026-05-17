/**
 * Core type definitions for TS PML
 * These types are shared across all modules to avoid circular dependencies
 */

import { MixinType, MixinConfig } from './mixin-types';

// ============================================================================
// CORE CONTEXT INTERFACE
// ============================================================================

/**
 * ICoreContext - Minimal interface that subsystems depend on
 * This breaks circular dependencies by decoupling from the concrete TSPML class
 */
export interface ICoreContext {
  /** Debug mode flag for logging */
  readonly debugMode: boolean;

  /** Get a value from PolyTrack by obfuscated path */
  getFromPolyTrack(path: string): any;

  /** Mixin system interface */
  readonly mixins: {
    registerGlobalMixin(config: MixinConfig): string;
  };

  /** Controls system interface */
  readonly controls?: {
    set(controls: Partial<{ up: boolean; down: boolean; left: boolean; right: boolean; reset: boolean }>): void;
  };
}

// Re-export MixinType and MixinConfig for convenience
export { MixinType, MixinConfig };

// ============================================================================
// CONFIG TYPES
// ============================================================================

export interface TSPMLConfig {
  polytrackVersion: string;
  debugMode?: boolean;
  enableMixins?: boolean;
  enableAPI?: boolean;
}

// ============================================================================
// MOD TYPES
// ============================================================================

export interface PolyModMetadata {
  modName: string;
  modID: string;
  modVersion: string;
  modAuthor: string;
  description?: string;
  polytrackVersion?: string[];
}

// ============================================================================
// MAPPING TYPES (moved from DeobfuscationLayer)
// ============================================================================

export interface NameMapping {
  readableName: string;
  obfuscatedPath: string;
  category: 'player' | 'ui' | 'physics' | 'world' | 'audio' | 'unknown';
  description: string;
  valueType: 'class' | 'function' | 'variable' | 'enum';
  webpackModule?: number;
}

export interface ClassMapping {
  className: string;
  obfuscatedName: string;
  methods: Map<string, string>;
  properties: Map<string, string>;
}
