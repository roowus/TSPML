/**
 * API type definitions
 * Extracted from APIInterface.ts to avoid circular dependencies
 */

import { Vector3 } from '../api/Vector3';

// ============================================================================
// PLAYER API TYPES
// ============================================================================

export interface Player {
  id: string;
  speed: number;
  position: Vector3;
  rotation: Vector3;
  isLocal: boolean;
}

// ============================================================================
// UI API TYPES
// ============================================================================

export interface ButtonConfig {
  id: string;
  label: string;
  icon?: string;
  onClick: () => void;
  position?: 'main-menu' | 'game-ui' | 'editor' | 'custom';
}

export interface MenuConfig {
  id: string;
  title: string;
  content: HTMLElement | string;
  onClose?: () => void;
}

export interface InputConfig {
  id: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  type?: 'text' | 'number' | 'password';
  onChange?: (value: string) => void;
}

export interface KeybindConfig {
  id: string;
  name: string;
  defaultKey: string;
  onPressed: () => void;
  onReleased?: () => void;
}

export interface SettingConfig {
  id: string;
  name: string;
  type: 'bool' | 'number' | 'string' | 'enum';
  defaultValue: any;
  options?: string[];
  onChange?: (value: any) => void;
}

// Placeholder interfaces for UI elements
export interface UIButton {}
export interface UIMenu {}
export interface UIInput {}

// ============================================================================
// PHYSICS API TYPES
// ============================================================================

export interface FrictionSettings {
  ice: number;
  grass: number;
  sand: number;
  road: number;
}

export interface CollisionEvent {
  objectId: string;
  position: Vector3;
  normal: Vector3;
  force: number;
}

// ============================================================================
// WORLD API TYPES
// ============================================================================

export interface TrackPart {
  id: string;
  type: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
}

export interface TrackPartConfig {
  type: string;
  position: Vector3;
  rotation?: Vector3;
  scale?: Vector3;
}

export interface BlockConfig {
  id: string;
  name: string;
  category: string;
  modelUrl: string;
  checksum: string;
  collisionType?: 'box' | 'mesh' | 'none';
  collisionData?: {
    center: Vector3;
    size: Vector3;
  };
}

export interface CategoryConfig {
  id: string;
  name: string;
  defaultBlock: string;
}

// ============================================================================
// GAME API TYPES
// ============================================================================

export type GameState =
  | 'menu'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'finished'
  | 'editing';

export type GameMode =
  | 'time-trial'
  | 'multiplayer'
  | 'local-multiplayer'
  | 'editor';

// ============================================================================
// PLAYER STATE TYPES (from PlayerAPI)
// ============================================================================

export interface CarState {
  frames: number;
  speedKmh: number;
  hasStarted: boolean;
  finishFrames: number | null;
  nextCheckpointIndex: number;
  hasCheckpointToRespawnAt: boolean;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  collisionImpulses: any[];
  wheelContact: [boolean, boolean, boolean, boolean];
  wheelSuspensionLength: [number, number, number, number];
  wheelSuspensionVelocity: [number, number, number, number];
  wheelDeltaRotation: [number, number, number, number];
  wheelSkidInfo: [number, number, number, number];
  steering: number;
  brakeLightEnabled: boolean;
  controls: {
    up: boolean;
    right: boolean;
    down: boolean;
    left: boolean;
    reset: boolean;
  };
}

export interface PlayerControls {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
  reset?: boolean;
}
