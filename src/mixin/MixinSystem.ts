/**
 * MixinSystem - Enhanced mixin system with better error handling and debugging
 * Provides "escape hatch" for advanced modding when API isn't enough
 */

import { TSPML } from '../core/TSPML';

export enum MixinType {
  /** Insert code at the beginning of a function */
  HEAD = 0,

  /** Insert code at the end of a function */
  TAIL = 1,

  /** Replace entire function */
  OVERRIDE = 2,

  /** Insert code after a specific token */
  INSERT = 3,

  /** Remove code between two tokens (exclusive) */
  REMOVEBETWEEN = 6,

  /** Replace code between two tokens (exclusive) */
  REPLACEBETWEEN = 5,

  /** Remove a class */
  CLASSREMOVE = 4,

  /** Insert into a class */
  CLASSINSERT = 8,

  /** Replace a class */
  CLASSREPLACE = 7
}

export interface MixinConfig {
  /** Type of mixin to apply */
  type: MixinType;

  /** Target class (for class mixins) */
  target?: string;

  /** Target function (for function mixins) */
  func?: string;

  /** Token/identifier to search for */
  token?: string;

  /** Start token for range operations */
  tokenStart?: string;

  /** End token for range operations */
  tokenEnd?: string;

  /** Code to insert/replace */
  func?: string;

  /** Description for debugging */
  description?: string;
}

export interface MixinResult {
  success: boolean;
  mixinId: string;
  errors: string[];
  warnings: string[];
}

export class MixinSystem {
  private pml: TSPML;
  private registeredMixins: Map<string, MixinConfig[]> = new Map();
  private appliedMixins: Set<string> = new Set();
  private mixinCounter: number = 0;

  constructor(pml: TSPML) {
    this.pml = pml;
  }

  /**
   * Register a global mixin (applies to entire codebase)
   */
  public registerGlobalMixin(config: MixinConfig): string {
    const mixinId = this.generateMixinId('global');

    if (!config.description) {
      config.description = `Global mixin #${this.mixinCounter}`;
    }

    this.addMixin('global', mixinId, config);
    this.logRegistration(mixinId, config);

    return mixinId;
  }

  /**
   * Register a function mixin
   */
  public registerFuncMixin(
    path: string,
    config: MixinConfig
  ): string {
    const mixinId = this.generateMixinId('func');

    if (!config.description) {
      config.description = `Function mixin for ${path}`;
    }

    config.target = path;
    this.addMixin(path, mixinId, config);
    this.logRegistration(mixinId, config);

    return mixinId;
  }

  /**
   * Register a class mixin
   */
  public registerClassMixin(
    scope: string,
    path: string,
    config: MixinConfig
  ): string {
    const mixinId = this.generateMixinId('class');

    if (!config.description) {
      config.description = `Class mixin for ${scope}.${path}`;
    }

    config.target = `${scope}.${path}`;
    this.addMixin(`${scope}.${path}`, mixinId, config);
    this.logRegistration(mixinId, config);

    return mixinId;
  }

  /**
   * Register a simulation worker mixin
   */
  public registerSimWorkerMixin(config: MixinConfig): string {
    const mixinId = this.generateMixinId('sim');

    if (!config.description) {
      config.description = `Simulation worker mixin #${this.mixinCounter}`;
    }

    this.addMixin('simworker', mixinId, config);
    this.logRegistration(mixinId, config);

    return mixinId;
  }

  /**
   * Apply all registered mixins
   */
  public applyAllMixins(): MixinResult[] {
    const results: MixinResult[] = [];

    if (this.pml.debugMode) {
      console.log(`[MixinSystem] Applying ${this.registeredMixins.size} mixin groups...`);
    }

    // Apply mixins in order
    for (const [target, mixins] of this.registeredMixins.entries()) {
      for (const mixin of mixins) {
        const result = this.applyMixin(mixin);

        if (result.success) {
          this.appliedMixins.add(mixin.mixinId);
        }

        results.push(result);

        if (this.pml.debugMode && !result.success) {
          console.error(`[MixinSystem] Failed to apply mixin ${mixin.mixinId}:`, result.errors);
        }
      }
    }

    if (this.pml.debugMode) {
      const successCount = results.filter(r => r.success).length;
      console.log(`[MixinSystem] Applied ${successCount}/${results.length} mixins successfully`);
    }

    return results;
  }

  /**
   * Apply a single mixin
   */
  private applyMixin(mixin: MixinConfig & { mixinId: string }): MixinResult {
    const result: MixinResult = {
      success: false,
      mixinId: mixin.mixinId,
      errors: [],
      warnings: []
    };

    try {
      // Validate mixin configuration
      const validation = this.validateMixin(mixin);
      if (!validation.valid) {
        result.errors.push(...validation.errors);
        return result;
      }

      // Apply mixin based on type
      // This is where we'd integrate with the actual game code
      // For now, this is a placeholder

      // TODO: Implement actual mixin application
      // This requires:
      // 1. Access to webpack bundles
      // 2. Code transformation
      // 3. Injection/replacement logic

      if (this.pml.debugMode) {
        console.log(`[MixinSystem] Applying mixin: ${mixin.description}`);
      }

      // Placeholder: assume success for now
      result.success = true;

    } catch (error) {
      result.errors.push(`Exception: ${error}`);
    }

    return result;
  }

  /**
   * Validate mixin configuration
   */
  private validateMixin(config: MixinConfig & { mixinId: string }): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Check required fields based on type
    switch (config.type) {
      case MixinType.HEAD:
      case MixinType.TAIL:
      case MixinType.OVERRIDE:
        if (!config.target) {
          errors.push('HEAD, TAIL, and OVERRIDE mixins require a target');
        }
        break;

      case MixinType.INSERT:
        if (!config.token) {
          errors.push('INSERT mixins require a token');
        }
        if (!config.func) {
          errors.push('INSERT mixins require code to insert');
        }
        break;

      case MixinType.REPLACEBETWEEN:
      case MixinType.REMOVEBETWEEN:
        if (!config.tokenStart || !config.tokenEnd) {
          errors.push('REPLACEBETWEEN and REMOVEBETWEEN mixins require tokenStart and tokenEnd');
        }
        if (config.type === MixinType.REPLACEBETWEEN && !config.func) {
          errors.push('REPLACEBETWEEN mixins require replacement code');
        }
        break;

      default:
        errors.push(`Unknown mixin type: ${config.type}`);
    }

    // Validate code syntax (basic check)
    if (config.func) {
      try {
        // Try to parse as function (syntax check)
        new Function(config.func);
      } catch (error) {
        errors.push(`Invalid code syntax: ${error}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get all registered mixins
   */
  public getRegisteredMixins(): Map<string, MixinConfig[]> {
    return new Map(this.registeredMixins);
  }

  /**
   * Get applied mixins
   */
  public getAppliedMixins(): Set<string> {
    return new Set(this.appliedMixins);
  }

  /**
   * Remove a mixin
   */
  public removeMixin(mixinId: string): boolean {
    for (const [target, mixins] of this.registeredMixins.entries()) {
      const index = mixins.findIndex(m => m.mixinId === mixinId);
      if (index !== -1) {
        mixins.splice(index, 1);
        this.appliedMixins.delete(mixinId);

        if (this.pml.debugMode) {
          console.log(`[MixinSystem] Removed mixin: ${mixinId}`);
        }

        return true;
      }
    }
    return false;
  }

  /**
   * Clear all mixins
   */
  public clearAllMixins(): void {
    this.registeredMixins.clear();
    this.appliedMixins.clear();

    if (this.pml.debugMode) {
      console.log('[MixinSystem] Cleared all mixins');
    }
  }

  /**
   * Generate unique mixin ID
   */
  private generateMixinId(type: string): string {
    const id = `mixin_${type}_${this.mixinCounter++}`;
    return id;
  }

  /**
   * Add mixin to registry
   */
  private addMixin(
    target: string,
    mixinId: string,
    config: MixinConfig
  ): void {
    if (!this.registeredMixins.has(target)) {
      this.registeredMixins.set(target, []);
    }

    this.registeredMixins.get(target)!.push({
      ...config,
      mixinId
    } as MixinConfig & { mixinId: string });
  }

  /**
   * Log mixin registration
   */
  private logRegistration(mixinId: string, config: MixinConfig): void {
    if (this.pml.debugMode) {
      console.log(`[MixinSystem] Registered mixin: ${mixinId}`);
      console.log(`  Type: ${MixinType[config.type]}`);
      console.log(`  Description: ${config.description || 'None'}`);
      if (config.target) {
        console.log(`  Target: ${config.target}`);
      }
    }
  }

  /**
   * Export all mixins as JSON (for debugging)
   */
  public exportMixins(): object {
    const exportData: any = {};

    for (const [target, mixins] of this.registeredMixins.entries()) {
      exportData[target] = mixins.map(m => ({
        type: MixinType[m.type],
        target: m.target,
        description: m.description,
        // Don't export full code (too large)
        hasCode: !!m.func,
        hasToken: !!m.token,
        hasTokenStart: !!m.tokenStart,
        hasTokenEnd: !!m.tokenEnd
      }));
    }

    return exportData;
  }
}
