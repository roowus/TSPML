/**
 * PlayerAPI - Clean API for player manipulation
 * Provides easy access to player state without dealing with obfuscated code
 */

import { ICoreContext, MixinType, CarState, PlayerControls } from '../types';
import { Vector3 } from './Vector3';
import type { ControlsAPI } from './ControlsAPI';

export class PlayerAPI {
  private context: ICoreContext;
  private controlsApi?: ControlsAPI;
  private playerStateAccessPattern: string = '';
  private eventListeners: Map<string, Set<Function>> = new Map();
  private currentState: CarState | null = null;
  private updateInterval: number | null = null;

  constructor(context: ICoreContext, controlsApi?: ControlsAPI) {
    this.context = context;
    this.controlsApi = controlsApi;
    this.initializePlayerAccess();
  }

  /**
   * Set the controls API reference (for dependency injection)
   */
  public setControlsAPI(controlsApi: ControlsAPI): void {
    this.controlsApi = controlsApi;
  }

  /**
   * Initialize player state access using mixins
   * This intercepts player state updates to track current state
   */
  private initializePlayerAccess(): void {
    if (this.context.debugMode) {
      console.log('[PlayerAPI] Initializing player state access...');
    }

    // Register mixin to intercept player state updates
    // This captures carState when it's being updated/serialized
    this.context.mixins.registerGlobalMixin({
      type: MixinType.INSERT,
      token: 'speedKmh:',
      code: `
        // Capture player state when we see this pattern
        if (typeof window !== 'undefined' && !window.__tsPMLPlayerState__) {
          window.__tsPMLPlayerState__ = (function() {
            // Try to extract the carState object from context
            // This is a heuristic that works with the deobfuscated code structure
            try {
              // The speedKmh property appears in carState objects
              // We'll capture the containing object
              return null; // Placeholder - will be set by actual interception
            } catch (e) {
              return null;
            }
          })();
        }
      `,
      description: 'Initialize player state capture'
    });

    // TODO: Add more sophisticated mixin to actually capture player state
    // For now, we'll use a polling mechanism to check for player state
    this.startStatePolling();
  }

  /**
   * Start polling for player state updates
   * This is a temporary solution until we find the exact access pattern
   */
  private startStatePolling(): void {
    if (typeof window === 'undefined') {
      return;
    }

    // Poll every 100ms to update player state
    this.updateInterval = window.setInterval(() => {
      this.updatePlayerState();
    }, 100) as unknown as number;
  }

  /**
   * Update cached player state from game
   */
  private updatePlayerState(): void {
    // TODO: Implement actual player state extraction
    // For now, this is a placeholder
    // We need to find the exact pattern to access the local player's carState

    // This will be implemented once we analyze more of the deobfuscated code
    // or through testing with the actual game
  }

  // ==========================================================================
  // PUBLIC API METHODS
  // ==========================================================================

  /**
   * Get the player's current speed in km/h
   */
  public getSpeed(): number {
    if (this.currentState) {
      return this.currentState.speedKmh;
    }

    // Fallback: Try to access via mixin/eval
    try {
      // This is a temporary approach using PML-style access
      const result = this.context.getFromPolyTrack(
        // TODO: Find the exact path to player's speedKmh
        'speedKmh'
      );
      return result || 0;
    } catch (error) {
      if (this.context.debugMode) {
        console.warn('[PlayerAPI] Could not get speed:', error);
      }
      return 0;
    }
  }

  /**
   * Set the player's displayed speed (visual only - does NOT affect physics)
   * For actual physics modification, use setSpeedPhysics()
   * @param value Speed in km/h to display
   */
  public setDisplaySpeed(value: number): void {
    if (this.currentState) {
      this.currentState.speedKmh = value;
    }

    // Apply via worker message interception (wasm-preload.js)
    if (typeof window !== 'undefined') {
      const writes = (window as any).__TS_PML_PENDING_WRITES__;
      if (writes) {
        writes.speed = value;
        writes.oneShot = true;  // Apply once, then clear

        if (this.context.debugMode) {
          console.log('[PlayerAPI] Display speed write queued:', value);
        }
      }
    }
  }

  /**
   * @deprecated Use setDisplaySpeed() for visual-only changes, or setSpeedPhysics() for physics
   */
  public setSpeed(value: number): void {
    this.setDisplaySpeed(value);
  }

  /**
   * Get the player's current position
   */
  public getPosition(): Vector3 {
    if (this.currentState) {
      return new Vector3(
        this.currentState.position.x,
        this.currentState.position.y,
        this.currentState.position.z
      );
    }

    // Fallback
    try {
      const pos = this.context.getFromPolyTrack('position');
      if (pos && typeof pos === 'object') {
        return new Vector3(pos.x || 0, pos.y || 0, pos.z || 0);
      }
    } catch (error) {
      // Ignore
    }

    return Vector3.zero;
  }

  /**
   * Set the player's displayed position (visual only - does NOT affect physics)
   * For actual physics modification, use setPositionPhysics()
   * @param position Position to display
   */
  public setDisplayPosition(position: Vector3): void {
    if (this.currentState) {
      this.currentState.position.x = position.x;
      this.currentState.position.y = position.y;
      this.currentState.position.z = position.z;
    }

    // Apply via worker message interception (wasm-preload.js)
    if (typeof window !== 'undefined') {
      const writes = (window as any).__TS_PML_PENDING_WRITES__;
      if (writes) {
        writes.position = { x: position.x, y: position.y, z: position.z };
        writes.oneShot = true;  // Apply once, then clear

        if (this.context.debugMode) {
          console.log('[PlayerAPI] Display position write queued:', position);
        }
      }
    }
  }

  /**
   * @deprecated Use setDisplayPosition() for visual-only changes, or setPositionPhysics() for physics
   */
  public setPosition(position: Vector3): void {
    this.setDisplayPosition(position);
  }

  /**
   * Get the player's rotation (quaternion)
   * @returns Quaternion as Vector4 (x, y, z, w)
   */
  public getRotation(): { x: number; y: number; z: number; w: number } {
    if (this.currentState) {
      return { ...this.currentState.quaternion };
    }

    return { x: 0, y: 0, z: 0, w: 1 };
  }

  /**
   * Set the player's displayed rotation (visual only - does NOT affect physics)
   * For actual physics modification, use setRotationPhysics()
   * @param rotation Quaternion (x, y, z, w) to display
   */
  public setDisplayRotation(rotation: { x: number; y: number; z: number; w: number }): void {
    if (this.currentState) {
      this.currentState.quaternion = { ...rotation };
    }

    // Apply via worker message interception (wasm-preload.js)
    if (typeof window !== 'undefined') {
      const writes = (window as any).__TS_PML_PENDING_WRITES__;
      if (writes) {
        writes.rotation = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
        writes.oneShot = true;  // Apply once, then clear

        if (this.context.debugMode) {
          console.log('[PlayerAPI] Display rotation write queued:', rotation);
        }
      }
    }
  }

  /**
   * @deprecated Use setDisplayRotation() for visual-only changes, or setRotationPhysics() for physics
   */
  public setRotation(rotation: { x: number; y: number; z: number; w: number }): void {
    this.setDisplayRotation(rotation);
  }

  // ==========================================================================
  // PHYSICS WRITE API (Actual WASM memory modification)
  // These modify the physics simulation, not just rendering
  // ==========================================================================

  /**
   * Queue a physics write to be applied to WASM memory
   * @param writes Object with fields to write (position, speed, rotation)
   */
  private queuePhysicsWrite(writes: { position?: { x: number; y: number; z: number }, speed?: number, rotation?: { x: number; y: number; z: number; w: number } }): void {
    if (typeof window !== 'undefined') {
      const worker = (window as any).__TS_PML_SIMULATION_WORKER__;
      if (worker) {
        worker.postMessage({
          type: '__TS_PML_APPLY_PHYSICS_WRITES__',
          writes: writes
        });
      }
    }
  }

  /**
   * Set the player's speed in physics (WASM memory)
   * This affects the actual physics simulation, not just rendering
   * @param value Speed in km/h
   */
  public setSpeedPhysics(value: number): void {
    if (this.currentState) {
      this.currentState.speedKmh = value;
    }
    this.queuePhysicsWrite({ speed: value });
    if (this.context.debugMode) console.log('[PlayerAPI] Speed physics write queued:', value);
  }

  /**
   * Set the player's position in physics (WASM memory)
   * This affects the actual physics simulation, not just rendering
   * @param position New position
   */
  public setPositionPhysics(position: Vector3): void {
    if (this.currentState) {
      this.currentState.position.x = position.x;
      this.currentState.position.y = position.y;
      this.currentState.position.z = position.z;
    }
    this.queuePhysicsWrite({ position: { x: position.x, y: position.y, z: position.z } });
    if (this.context.debugMode) console.log('[PlayerAPI] Position physics write queued:', position);
  }

  /**
   * Set the player's rotation in physics (WASM memory)
   * @param rotation Quaternion (x, y, z, w)
   */
  public setRotationPhysics(rotation: { x: number; y: number; z: number; w: number }): void {
    if (this.currentState) {
      this.currentState.quaternion = { ...rotation };
    }
    this.queuePhysicsWrite({ rotation });
    if (this.context.debugMode) console.log('[PlayerAPI] Rotation physics write queued:', rotation);
  }

  /**
   * Teleport the player using physics modification
   * @param position Target position
   * @param preserveSpeed Whether to maintain current speed (default: false)
   */
  public teleportPhysics(position: Vector3, preserveSpeed: boolean = false): void {
    if (!preserveSpeed) {
      this.setSpeedPhysics(0);
    }
    this.setPositionPhysics(position);
    this.emit('teleport', { position, preserveSpeed, physics: true });
  }

  /**
   * Teleport the player visually (display only - does NOT affect physics)
   * For actual physics teleportation, use teleportPhysics()
   * @param position Target position to display
   * @param preserveSpeed Whether to maintain current displayed speed (default: false)
   */
  public teleport(position: Vector3, preserveSpeed: boolean = false): void {
    if (!preserveSpeed) {
      this.setDisplaySpeed(0);
    }
    this.setDisplayPosition(position);
    this.emit('teleport', { position, preserveSpeed, physics: false });
  }

  /**
   * Get the player's current steering value
   * @returns Steering value (typically -1 to 1)
   */
  public getSteering(): number {
    if (this.currentState) {
      return this.currentState.steering;
    }
    return 0;
  }

  /**
   * Set the player's steering
   * @param value Steering value (-1 = left, 1 = right)
   */
  public setSteering(value: number): void {
    if (this.currentState) {
      this.currentState.steering = Math.max(-1, Math.min(1, value));
    }

    this.context.mixins.registerGlobalMixin({
      type: MixinType.REPLACEBETWEEN,
      tokenStart: 'steering: ',
      tokenEnd: ',',
      code: `steering: ${value},`,
      description: `Set steering to ${value}`
    });
  }

  /**
   * Get the player's controls state
   */
  public getControls(): PlayerControls {
    if (this.currentState) {
      return { ...this.currentState.controls };
    }
    return {
      up: false,
      down: false,
      left: false,
      right: false,
      reset: false
    };
  }

  /**
   * Set the player's controls
   * @param controls Control states to set
   */
  public setControls(controls: PlayerControls): void {
    if (this.currentState) {
      Object.assign(this.currentState.controls, controls);
    }

    // Use ControlsAPI for actual control injection (dependency injection)
    if (this.controlsApi) {
      this.controlsApi.set(controls);
    }

    this.emit('controlsChanged', controls);
  }

  /**
   * Check if player has started
   */
  public hasStarted(): boolean {
    if (this.currentState) {
      return this.currentState.hasStarted;
    }
    return false;
  }

  /**
   * Get current checkpoint index
   */
  public getCheckpointIndex(): number {
    if (this.currentState) {
      return this.currentState.nextCheckpointIndex;
    }
    return 0;
  }

  // ==========================================================================
  // EVENT SYSTEM
  // ==========================================================================

  /**
   * Register callback for player spawn event
   */
  public onSpawn(callback: () => void): void {
    this.on('spawn', callback);
  }

  /**
   * Register callback for player death/reset
   */
  public onReset(callback: () => void): void {
    this.on('reset', callback);
  }

  /**
   * Register callback for position updates (called frequently)
   */
  public onMove(callback: (position: Vector3) => void): void {
    this.on('move', callback);
  }

  /**
   * Register callback for speed changes
   */
  public onSpeedChange(callback: (speed: number) => void): void {
    this.on('speedChange', callback);
  }

  /**
   * Register a custom event listener
   */
  public on(event: string, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Remove an event listener
   */
  public off(event: string, callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Emit an event
   */
  private emit(event: string, data?: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data);
        } catch (error) {
          console.error(`[PlayerAPI] Error in ${event} listener:`, error);
        }
      }
    }
  }

  /**
   * Cleanup when API is destroyed
   */
  public destroy(): void {
    if (this.updateInterval !== null && typeof window !== 'undefined') {
      window.clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.eventListeners.clear();
  }
}
