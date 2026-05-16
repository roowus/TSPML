/**
 * Mapping Extractor - Analyzes deobfuscated code to generate mappings
 * Run this to extract name mappings from cwc/polytrack-0.6.0-deobfuscated
 */

import * as fs from 'fs';
import * as path from 'path';

interface ClassMapping {
  name: string;
  exports?: string[];
  methods?: string[];
  properties?: string[];
}

interface MappingData {
  classes: Map<string, ClassMapping>;
  exports: Map<string, string>;  // moduleId -> exported name
}

export class MappingExtractor {
  private deobfPath: string;

  constructor(deobfPath: string) {
    this.deobfPath = deobfPath;
  }

  /**
   * Extract all class definitions from deobfuscated code
   */
  public extractClasses(bundleName: string): Map<string, ClassMapping> {
    const bundlePath = path.join(this.deobfPath, bundleName);
    const content = fs.readFileSync(bundlePath, 'utf-8');
    const classes = new Map<string, ClassMapping>();

    // Extract class definitions
    const classRegex = /class\s+([A-Za-z0-9_]+)\s*{/g;
    let match;

    while ((match = classRegex.exec(content)) !== null) {
      const className = match[1];

      // Find methods and properties for this class
      const classContent = this.extractClassContent(content, className);
      const methods = this.extractMethods(classContent);
      const properties = this.extractProperties(classContent);

      classes.set(className, {
        name: className,
        methods,
        properties
      });
    }

    console.log(`Extracted ${classes.size} classes from ${bundleName}`);
    return classes;
  }

  /**
   * Extract webpack module exports
   */
  public extractWebpackExports(bundleName: string): Map<string, string> {
    const bundlePath = path.join(this.deobfPath, bundleName);
    const content = fs.readFileSync(bundlePath, 'utf-8');
    const exports = new Map<string, string>();

    // Match webpack module definitions like:
    // 405: (module, exports, __webpack_require__) => {
    //     __webpack_require__.d(exports, { getPart: () => f, ... });
    // }
    const moduleRegex = /(\d+):\s*\(module,\s*exports,\s*__webpack_require__\)\s*=>\s*\{[^}]*__webpack_require__\.d\(exports,\s*\{([^}]+)\}\)/gs;

    let match;
    while ((match = moduleRegex.exec(content)) !== null) {
      const moduleId = match[1];
      const exportsContent = match[2];

      // Extract individual exports
      const exportRegex = /([A-Za-z0-9_]+):\s*\(\)\s*=>\s*([A-Za-z0-9_]+)/g;
      let exportMatch;

      while ((exportMatch = exportRegex.exec(exportsContent)) !== null) {
        const exportName = exportMatch[1];
        const targetName = exportMatch[2];
        exports.set(`${moduleId}.${exportName}`, targetName);
      }
    }

    console.log(`Extracted ${exports.size} exports from ${bundleName}`);
    return exports;
  }

  /**
   * Find specific patterns in deobfuscated code
   */
  public findPatterns(bundleName: string, patterns: string[]): Map<string, string[]> {
    const bundlePath = path.join(this.deobfPath, bundleName);
    const content = fs.readFileSync(bundlePath, 'utf-8');
    const results = new Map<string, string[]>();

    for (const pattern of patterns) {
      const regex = new RegExp(pattern, 'g');
      const matches = content.match(regex);

      if (matches) {
        results.set(pattern, matches);
        console.log(`Pattern "${pattern}": ${matches.length} matches`);
      }
    }

    return results;
  }

  /**
   * Generate mappings file from analysis
   */
  public generateMappingsFile(outputPath: string): void {
    const mappings: any = {
      version: '0.6.0',
      generatedAt: new Date().toISOString(),
      classes: {},
      exports: {},
      functions: {}
    };

    // Analyze main.bundle.js
    console.log('\n=== Analyzing main.bundle.js ===');
    const mainClasses = this.extractClasses('main.bundle.js');

    for (const [name, data] of mainClasses.entries()) {
      mappings.classes[name] = {
        methods: data.methods || [],
        properties: data.properties || []
      };
    }

    const mainExports = this.extractWebpackExports('main.bundle.js');
    for (const [key, value] of mainExports.entries()) {
      mappings.exports[key] = value;
    }

    // Find specific patterns
    console.log('\n=== Searching for key patterns ===');
    const patterns = [
      'speedKmh',
      'position\\.x',
      'getPart',
      'checkpoint',
      'Player'
    ];

    const patternResults = this.findPatterns('main.bundle.js', patterns);
    mappings.patterns = Object.fromEntries(patternResults);

    // Write to file
    fs.writeFileSync(outputPath, JSON.stringify(mappings, null, 2), 'utf-8');
    console.log(`\nMappings written to: ${outputPath}`);
  }

  /**
   * Extract content within a class definition
   */
  private extractClassContent(content: string, className: string): string {
    const classStartRegex = new RegExp(`class\\s+${className}\\s*\\{`);
    const classStartMatch = content.match(classStartRegex);

    if (!classStartMatch) {
      return '';
    }

    const startIndex = content.indexOf(classStartMatch[0], classStartMatch.index);
    let braceCount = 0;
    let endIndex = startIndex;

    // Find matching closing brace
    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }
    }

    return content.substring(startIndex, endIndex + 1);
  }

  /**
   * Extract method names from class content
   */
  private extractMethods(classContent: string): string[] {
    const methods: string[] = [];

    // Match method definitions: methodName(...) { or methodName = function(...) {
    const methodRegex = /([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g;
    let match;

    while ((match = methodRegex.exec(classContent)) !== null) {
      const methodName = match[1];

      // Filter out common non-method keywords
      if (!['if', 'for', 'while', 'switch', 'catch'].includes(methodName)) {
        methods.push(methodName);
      }
    }

    return methods;
  }

  /**
   * Extract property names from class content
   */
  private extractProperties(classContent: string): string[] {
    const properties: string[] = [];

    // Match property assignments: this.propertyName =
    const propertyRegex = /this\.([A-Za-z0-9_]+)\s*=/g;
    let match;

    while ((match = propertyRegex.exec(classContent)) !== null) {
      const propName = match[1];
      if (!properties.includes(propName)) {
        properties.push(propName);
      }
    }

    return properties;
  }
}

// Run the extractor
const deobfPath = '/tmp/polytrack-0.6.0-deobfuscated';
const outputPath = '/Users/rewis/ts-pml/src/deobfuscation/extractedMappings.json';

console.log('Extracting mappings from deobfuscated code...');
const extractor = new MappingExtractor(deobfPath);
extractor.generateMappingsFile(outputPath);
