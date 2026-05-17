/**
 * ControlsAPI - Inject control inputs into the game
 * Allows mods to simulate key presses (UP, DOWN, LEFT, RIGHT, RESET)
 */

import { ICoreContext } from '../types';

export interface ControlState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  reset: boolean;
}

export type ControlKey = keyof ControlState;

/**
 * ControlsAPI provides read/write access to player control inputs
 * Works by intercepting worker.postMessage calls and modifying Message Type 6
 */
export class ControlsAPI {
  private context: ICoreContext;
  private currentControls: ControlState = {
    up: false,
    down: false,
    left: false,
    right: false,
    reset: false
  };
  private overrideEnabled: boolean = false;
  private eventListeners: Map<string, Set<Function>> = new Map();

  constructor(context: ICoreContext) {
    this.context = context;
    this.initializeControlInjection();
  }

  /**
   * Initialize control injection by hooking worker.postMessage
   * This intercepts messages sent to the worker and can modify control inputs
   */
  private initializeControlInjection(): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (this.context.debugMode) {
      console.log('[ControlsAPI] Initializing control injection...');
    }

    // The worker.postMessage hook is already in wasm-preload.js
    // We just need to set up the communication bridge
    // The hook will call back to main thread for control overrides

    // Set up global control override state that the preload script can read
    if (!(window as any).__TS_PML_CONTROLS__) {
      (window as any).__TS_PML_CONTROLS__ = {
        getOverrides: () => this.overrideEnabled ? this.currentControls : null
      };
    }

    // Listen for control state updates from the game
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === '__TS_PML_CONTROL_STATE__') {
        this.currentControls = event.data.controls;
        this.emit('change', this.currentControls);
      }
    });
  }

  // ==========================================================================
  // PUBLIC API METHODS
  // ==========================================================================

  /**
   * Get the current control state
   */
  public getControls(): Readonly<ControlState> {
    return { ...this.currentControls };
  }

  /**
   * Check if a specific control is active
   */
  public isPressed(key: ControlKey): boolean {
    return this.currentControls[key] || false;
  }

  /**
   * Set control overrides (enables override mode)
   * When override is enabled, your controls replace the player's input
   *
   * @example
   * // Enable autopilot - always accelerate and turn left
   * tspml.controls.set({ up: true, left: true });
   */
  public set(controls: Partial<ControlState>): void {
    this.overrideEnabled = true;
    Object.assign(this.currentControls, controls);

    if (this.context.debugMode) {
      console.log('[ControlsAPI] Controls set:', this.currentControls);
    }

    // Notify the worker about control changes
    this.sendControlUpdate();
  }

  /**
   * Press a control temporarily (for one frame)
   *
   * @example
   * // Honk the horn (if mapped to a key)
   * tspml.controls.press('up');
   */
  public press(key: ControlKey): void {
    const previousState = this.currentControls[key];
    this.currentControls[key] = true;
    this.sendControlUpdate();

    // Reset after one frame (approximately 16ms)
    setTimeout(() => {
      this.currentControls[key] = previousState;
      this.sendControlUpdate();
    }, 16);
  }

  /**
   * Clear all control overrides and return to normal input
   */
  public clear(): void {
    this.overrideEnabled = false;
    this.currentControls = {
      up: false,
      down: false,
      left: false,
      right: false,
      reset: false
    };

    if (this.context.debugMode) {
      console.log('[ControlsAPI] Controls cleared');
    }

    this.sendControlUpdate();
  }

  /**
   * Enable or disable control override mode
   * When disabled, player input works normally
   */
  public setOverride(enabled: boolean): void {
    this.overrideEnabled = enabled;

    if (!enabled) {
      this.sendControlUpdate();
    }
  }

  /**
   * Check if override mode is active
   */
  public isOverrideActive(): boolean {
    return this.overrideEnabled;
  }

  // ==========================================================================
  // EVENT SYSTEM
  // ==========================================================================

  /**
   * Listen for control state changes
   *
   * @example
   * tspml.controls.on('change', (controls) => {
   *   if (controls.up) console.log('Accelerating!');
   * });
   */
  public on(event: 'change', callback: (controls: ControlState) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  /**
   * Remove an event listener
   */
  public off(event: 'change', callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  private emit(event: string, data: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[ControlsAPI] Error in ${event} listener:`, error);
        }
      });
    }
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private sendControlUpdate(): void {
    // This communicates with the worker.postMessage hook in wasm-preload.js
    // The hook checks __TS_PML_CONTROLS__ for overrides before sending messages

    if (this.context.debugMode) {
      console.log('[ControlsAPI] Sending control update:', this.currentControls);
    }

    // The actual injection happens in the preload script's worker.postMessage hook
    // We just update the global state that it reads from
  }

  /**
   * Helper to simulate key combinations
   *
   * @example
   * // Turn left while accelerating
   * tspml.controls.combo({ up: true, left: true });
   */
  public combo(controls: Partial<ControlState>): void {
    this.set(controls);
  }
}
