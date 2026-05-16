/**
 * TS PML - The Second Poly Mod Loader
 * Main entry point for the mod loader
 */

export { TSPML } from './core/TSPML';
export { PolyMod } from './core/PolyMod';
export { MixinSystem, MixinType } from './mixin/MixinSystem';
export { DeobfuscationLayer } from './deobfuscation/DeobfuscationLayer';

// API exports
export { PlayerAPI } from './api/PlayerAPI';
export { UIAPI } from './api/UIAPI';
export { PhysicsAPI } from './api/PhysicsAPI';

// Types
export type { TSPMLConfig } from './core/TSPML';
export type { PolyModMetadata } from './core/PolyMod';
export type { MixinConfig } from './mixin/MixinSystem';
export type { APIInterface } from './api/APIInterface';
