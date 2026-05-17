/**
 * Type definitions index
 * Central exports for all shared types
 */

// Core types (includes MixinType and MixinConfig re-exports)
export {
  ICoreContext,
  TSPMLConfig,
  PolyModMetadata,
  NameMapping,
  ClassMapping,
  MixinType,
  MixinConfig
} from './core-types';

// Mixin result type
export type { MixinResult } from './mixin-types';

// API types
export {
  Player,
  ButtonConfig,
  MenuConfig,
  InputConfig,
  KeybindConfig,
  SettingConfig,
  UIButton,
  UIMenu,
  UIInput,
  FrictionSettings,
  CollisionEvent,
  TrackPart,
  TrackPartConfig,
  BlockConfig,
  CategoryConfig,
  GameState,
  GameMode,
  CarState,
  PlayerControls
} from './api-types';
