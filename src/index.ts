/**
 * TS PML - The Second Poly Mod Loader
 * Main entry point for the mod loader
 */

export { TSPML } from './core/TSPML';
export { PolyMod } from './core/PolyMod';
export { MixinSystem } from './mixin/MixinSystem';
export { DeobfuscationLayer } from './deobfuscation/DeobfuscationLayer';

// API exports
export { PlayerAPI } from './api/PlayerAPI';
export { UIAPI } from './api/UIAPI';
export { PhysicsAPI } from './api/PhysicsAPI';
export { ControlsAPI } from './api/ControlsAPI';

// Vector3 utility
export { Vector3 } from './api/Vector3';

// Types
export type { TSPMLConfig, ICoreContext } from './types';
export type { PolyModMetadata } from './types';
export type { MixinConfig, MixinResult, MixinType } from './types';
