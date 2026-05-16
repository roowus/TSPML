/**
 * Example mod using TS PML mixin system
 * This demonstrates advanced usage when API isn't enough
 */

import { PolyMod } from 'ts-pml';
import { MixinType } from 'ts-pml';

export class AdvancedExampleMod extends PolyMod {
  modName = 'Advanced Example Mod';
  modID = 'advanced-example';
  modVersion = '1.0.0';
  modAuthor = 'TS PML Team';
  description = 'Demonstrates advanced mixin usage';

  preInit = (pml) => {
    // Example 1: Inject code at the beginning of a function
    pml.mixins.registerFuncMixin('playerUpdate', {
      type: MixinType.HEAD,
      target: 'Player.prototype.update',
      func: 'console.log("[AdvancedMod] Player update called");',
      description: 'Log when player update runs'
    });

    // Example 2: Modify a specific value using REPLACEBETWEEN
    // This is similar to PML nighttime mod
    pml.mixins.registerGlobalMixin({
      type: MixinType.REPLACEBETWEEN,
      tokenStart: 'const gravity = 9.8;',
      tokenEnd: 'const gravity = 9.8;',
      func: 'const gravity = window.myCustomGravity || 9.8;',
      description: 'Make gravity configurable via global variable'
    });
  }

  init = (pml) => {
    // Set up custom gravity variable
    if (typeof window !== 'undefined') {
      (window as any).myCustomGravity = 5.0; // Low gravity mode
    }

    // Example 3: Register a keybind to toggle gravity
    pml.ui.registerKeybind({
      id: 'toggle-gravity',
      name: 'Toggle Gravity',
      defaultKey: 'G',
      onPressed: () => {
        const current = (window as any).myCustomGravity || 9.8;
        (window as any).myCustomGravity = current === 9.8 ? 5.0 : 9.8;
        console.log(`Gravity set to: ${(window as any).myCustomGravity}`);
      }
    });

    // Example 4: Insert UI button
    pml.ui.registerButton({
      id: 'advanced-menu',
      label: 'Advanced Mod',
      onClick: () => {
        alert('Advanced mod menu coming soon!');
      }
    });
  }

  postInit = () => {
    console.log('[AdvancedMod] Initialized!');

    // Log all registered mixins
    const mixins = this.pml.mixins.getRegisteredMixins();
    console.log('[AdvancedMod] Registered mixins:', mixins);
  }
}

// Export mod instance
export const polyMod = new AdvancedExampleMod();
