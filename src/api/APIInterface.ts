/**
 * Core API Interface Definitions
 * These are the stable, documented APIs that modders will use
 */

import { Vector3 } from './Vector3';
import type { UIButton, UIMenu, UIInput } from '../types/api-types';

// ============================================================================
// PLAYER API
// ============================================================================

export interface PlayerAPI {
  /**
   * Get the player's current speed
   */
  getSpeed(): number;

  /**
   * Set the player's speed
   * @param value Speed value (game units)
   */
  setSpeed(value: number): void;

  /**
   * Get the player's position
   */
  getPosition(): Vector3;

  /**
   * Set the player's position
   * @param position New position
   */
  setPosition(position: Vector3): void;

  /**
   * Get the player's rotation
   */
  getRotation(): Vector3;

  /**
   * Set the player's rotation
   * @param rotation New rotation (pitch, yaw, roll)
   */
  setRotation(rotation: Vector3): void;

  /**
   * Teleport the player to a position
   * @param position Target position
   * @param preserveSpeed Whether to maintain current speed
   */
  teleport(position: Vector3, preserveSpeed?: boolean): void;

  /**
   * Register a callback for when player spawns
   * @param callback Function to call when player spawns
   */
  onSpawn(callback: (player: Player) => void): void;

  /**
   * Register a callback for when player dies
   * @param callback Function to call when player dies
   */
  onDeath(callback: (player: Player) => void): void;

  /**
   * Register a callback for player updates (every frame)
   * @param callback Function to call each frame
   */
  onUpdate(callback: (player: Player) => void): void;
}

export interface Player {
  id: string;
  speed: number;
  position: Vector3;
  rotation: Vector3;
  isLocal: boolean;
}

// ============================================================================
// UI API
// ============================================================================

export interface UIAPI {
  /**
   * Register a new button in the UI
   * @param config Button configuration
   */
  registerButton(config: ButtonConfig): UIButton;

  /**
   * Register a new menu/panel
   * @param config Menu configuration
   */
  registerMenu(config: MenuConfig): UIMenu;

  /**
   * Register a text input field
   * @param config Input configuration
   */
  registerInput(config: InputConfig): UIInput;

  /**
   * Show a notification/toast message
   * @param message Message to display
   * @param duration How long to show (ms)
   */
  showNotification(message: string, duration?: number): void;

  /**
   * Register a keybind
   * @param config Keybind configuration
   */
  registerKeybind(config: KeybindConfig): void;

  /**
   * Register a settings category
   * @param name Category name
   */
  registerSettingsCategory(name: string): void;

  /**
   * Register a setting within a category
   * @param config Setting configuration
   */
  registerSetting(config: SettingConfig): void;
}

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
  options?: string[];  // For enum type
  onChange?: (value: any) => void;
}

// ============================================================================
// PHYSICS API
// ============================================================================

export interface PhysicsAPI {
  /**
   * Get current gravity
   */
  getGravity(): number;

  /**
   * Set gravity
   * @param value Gravity value
   */
  setGravity(value: number): void;

  /**
   * Get friction settings
   */
  getFriction(): FrictionSettings;

  /**
   * Set friction settings
   * @param settings Friction configuration
   */
  setFriction(settings: Partial<FrictionSettings>): void;

  /**
   * Register a collision callback
   * @param callback Function called on collision
   */
  onCollision(callback: (collision: CollisionEvent) => void): void;

  /**
   * Apply force to an object
   * @param objectId Object ID
   * @param force Force vector
   */
  applyForce(objectId: string, force: Vector3): void;

  /**
   * Set velocity of an object
   * @param objectId Object ID
   * @param velocity Velocity vector
   */
  setVelocity(objectId: string, velocity: Vector3): void;
}

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
// WORLD API
// ============================================================================

export interface WorldAPI {
  /**
   * Get all track parts
   */
  getTrackParts(): TrackPart[];

  /**
   * Get a specific track part by ID
   */
  getTrackPart(id: string): TrackPart | undefined;

  /**
   * Add a new track part
   * @param part Track part configuration
   */
  addTrackPart(part: TrackPartConfig): TrackPart;

  /**
   * Remove a track part
   * @param id Part ID
   */
  removeTrackPart(id: string): void;

  /**
   * Register a custom block type
   * @param config Block configuration
   */
  registerBlock(config: BlockConfig): void;

  /**
   * Register a custom category
   * @param config Category configuration
   */
  registerCategory(config: CategoryConfig): void;
}

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
// AUDIO API
// ============================================================================

export interface AudioAPI {
  /**
   * Play a sound
   * @param soundId Sound identifier
   * @param volume Volume (0-1)
   */
  playSound(soundId: string, volume?: number): void;

  /**
   * Register a custom sound
   * @param id Sound identifier
   * @param url URL to sound file
   */
  registerSound(id: string, url: string): void;

  /**
   * Override a game sound
   * @param soundId Original sound ID
   * @param url New sound URL
   */
  overrideSound(soundId: string, url: string): void;

  /**
   * Stop all sounds
   */
  stopAllSounds(): void;
}

// ============================================================================
// GAME API
// ============================================================================

export interface GameAPI {
  /**
   * Get current game state
   */
  getState(): GameState;

  /**
   * Check if game is in specific state
   * @param state State to check
   */
  isInState(state: GameState): boolean;

  /**
   * Register callback for state changes
   * @param callback Function called on state change
   */
  onStateChange(callback: (newState: GameState, oldState: GameState) => void): void;

  /**
   * Get current game mode
   */
  getGameMode(): GameMode;

  /**
   * Restart the current track
   */
  restartTrack(): void;

  /**
   * Load a track
   * @param trackId Track identifier
   */
  loadTrack(trackId: string): void;
}

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
// MAIN TSPML API (Combines all above)
// ============================================================================

export interface TSPMLAPI {
  readonly player: PlayerAPI;
  readonly ui: UIAPI;
  readonly physics: PhysicsAPI;
  readonly world: WorldAPI;
  readonly audio: AudioAPI;
  readonly game: GameAPI;
}
