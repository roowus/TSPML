/**
 * Mixin system type definitions
 * Extracted from MixinSystem to avoid circular dependencies
 */

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

  /** Target function name (for function mixins) */
  targetFunc?: string;

  /** Token/identifier to search for */
  token?: string;

  /** Start token for range operations */
  tokenStart?: string;

  /** End token for range operations */
  tokenEnd?: string;

  /** Code to insert/replace */
  code?: string;

  /** Description for debugging */
  description?: string;
}

export interface MixinResult {
  success: boolean;
  mixinId: string;
  errors: string[];
  warnings: string[];
}
