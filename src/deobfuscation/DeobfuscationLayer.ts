/**
 * DeobfuscationLayer - Maps readable names to obfuscated game code
 * This is the core of TS PML's API system
 */

import { TSPML } from '../core/TSPML';

interface NameMapping {
  readableName: string;
  obfuscatedPath: string;
  category: 'player' | 'ui' | 'physics' | 'world' | 'audio' | 'unknown';
  description: string;
  valueType: 'class' | 'function' | 'variable' | 'enum';
  webpackModule?: number;  // If this comes from a specific webpack module
}

interface ClassMapping {
  className: string;
  obfuscatedName: string;
  methods: Map<string, string>;  // methodName → obfuscatedName
  properties: Map<string, string>;  // propertyName → obfuscatedName
}

export class DeobfuscationLayer {
  private pml: TSPML;

  // Name mappings (readable → obfuscated)
  private mappings: Map<string, NameMapping> = new Map();

  // Class structure mappings
  private classMappings: Map<string, ClassMapping> = new Map();

  // Reverse mappings (obfuscated → readable) for quick lookup
  private reverseMappings: Map<string, string> = new Map();

  constructor(pml: TSPML) {
    this.pml = pml;
    this.initializeDefaultMappings();
  }

  /**
   * Initialize default name mappings based on deobfuscated code analysis
   */
  private initializeDefaultMappings(): void {
    // TODO: Populate with actual mappings from deobfuscated PolyTrack code
    // These are placeholder examples based on PML API analysis

    // Enum mappings (from PML API ObfNames)
    this.addMapping({
      readableName: 'CategoriesEnum',
      obfuscatedPath: 'LA',
      category: 'unknown',
      description: 'Track part categories enum',
      valueType: 'enum'
    });

    this.addMapping({
      readableName: 'BlocksEnum',
      obfuscatedPath: 'Mb',
      category: 'unknown',
      description: 'Track blocks enum',
      valueType: 'enum'
    });

    this.addMapping({
      readableName: 'BlockRegister',
      obfuscatedPath: 'GA',
      category: 'unknown',
      description: 'Block registration array',
      valueType: 'variable'
    });

    this.addMapping({
      readableName: 'SoundClass',
      obfuscatedPath: 'gl',
      category: 'audio',
      description: 'Sound management class',
      valueType: 'class'
    });
  }

  /**
   * Add a name mapping
   */
  public addMapping(mapping: NameMapping): void {
    this.mappings.set(mapping.readableName, mapping);
    this.reverseMappings.set(mapping.obfuscatedPath, mapping.readableName);

    if (this.pml.debugMode) {
      console.log(`[DeobfuscationLayer] Added mapping: ${mapping.readableName} → ${mapping.obfuscatedPath}`);
    }
  }

  /**
   * Get an obfuscated value by its readable name
   * Example: getValue('CategoriesEnum') returns the LA object
   */
  public getValue(readableName: string): any {
    const mapping = this.mappings.get(readableName);
    if (!mapping) {
      if (this.pml.debugMode) {
        console.warn(`[DeobfuscationLayer] No mapping found for: ${readableName}`);
      }
      return undefined;
    }

    // Evaluate the obfuscated path
    try {
      // This is similar to PML's getFromPolyTrackGlobal
      // We'll need to integrate with the actual game context
      return this.evaluatePath(mapping.obfuscatedPath);
    } catch (error) {
      console.error(`[DeobfuscationLayer] Error evaluating path ${mapping.obfuscatedPath}:`, error);
      return undefined;
    }
  }

  /**
   * Get a readable name for an obfuscated path
   */
  public getReadableName(obfuscatedPath: string): string | undefined {
    return this.reverseMappings.get(obfuscatedPath);
  }

  /**
   * Evaluate an obfuscated path in the game context
   * This is similar to PML's eval() approach but safer
   */
  private evaluatePath(path: string): any {
    // TODO: Implement safe path evaluation
    // For now, this is a placeholder
    // In production, this will integrate with the actual game context

    if (typeof window !== 'undefined' && (window as any).polyModLoader) {
      // Use PML's getFromPolyTrackGlobal if available
      const pml = (window as any).polyModLoader;
      if (pml.getFromPolyTrackGlobal) {
        return pml.getFromPolyTrackGlobal(path);
      }
    }

    // Fallback to eval (not ideal, but matches current PML approach)
    // TODO: Make this safer
    try {
      return eval(path);
    } catch (error) {
      console.error(`[DeobfuscationLayer] eval failed for path: ${path}`, error);
      return undefined;
    }
  }

  /**
   * Add a class mapping with methods and properties
   */
  public addClassMapping(mapping: ClassMapping): void {
    this.classMappings.set(mapping.className, mapping);

    if (this.pml.debugMode) {
      console.log(`[DeobfuscationLayer] Added class mapping: ${mapping.className} → ${mapping.obfuscatedName}`);
    }
  }

  /**
   * Get class mapping
   */
  public getClassMapping(className: string): ClassMapping | undefined {
    return this.classMappings.get(className);
  }

  /**
   * Export all mappings as JSON (for saving/sharing)
   */
  public exportMappings(): object {
    return {
      mappings: Array.from(this.mappings.entries()),
      classMappings: Array.from(this.classMappings.entries())
    };
  }

  /**
   * Import mappings from JSON (for loading from file)
   */
  public importMappings(data: any): void {
    if (data.mappings) {
      for (const [name, mapping] of data.mappings) {
        this.mappings.set(name, mapping as NameMapping);
        this.reverseMappings.set((mapping as NameMapping).obfuscatedPath, name);
      }
    }

    if (data.classMappings) {
      for (const [name, mapping] of data.classMappings) {
        this.classMappings.set(name, mapping as ClassMapping);
      }
    }

    if (this.pml.debugMode) {
      console.log(`[DeobfuscationLayer] Imported ${data.mappings?.length || 0} mappings`);
    }
  }

  /**
   * Get all mappings in a category
   */
  public getMappingsByCategory(category: NameMapping['category']): NameMapping[] {
    return Array.from(this.mappings.values()).filter(m => m.category === category);
  }

  /**
   * Search mappings by description/name
   */
  public searchMappings(query: string): NameMapping[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.mappings.values()).filter(m =>
      m.readableName.toLowerCase().includes(lowerQuery) ||
      m.description.toLowerCase().includes(lowerQuery)
    );
  }
}
