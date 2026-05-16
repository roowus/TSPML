/**
 * Example mod using TS PML Player API
 * Demonstrates clean, simple player manipulation
 */

import { PolyMod } from 'ts-pml';
import { Vector3 } from 'ts-pml';

export class SpeedBoostMod extends PolyMod {
  modName = 'Speed Boost Example';
  modID = 'speed-boost-example';
  modVersion = '1.0.0';
  modAuthor = 'TS PML Team';
  description = 'Demonstrates Player API with speed boost';

  init = (pml) => {
    this.pml = pml;

    // Example 1: Double speed on keybind
    pml.ui.registerKeybind({
      id: 'speed-boost',
      name: 'Speed Boost',
      defaultKey: 'Shift',
      onPressed: () => {
        const currentSpeed = pml.player.getSpeed();
        pml.player.setSpeed(currentSpeed * 2);
        console.log(`Speed boosted to: ${pml.player.getSpeed()}`);
      }
    });

    // Example 2: Teleport on keypress
    pml.ui.registerKeybind({
      id: 'teleport-forward',
      name: 'Teleport Forward',
      defaultKey: 'T',
      onPressed: () => {
        const pos = pml.player.getPosition();
        const newPos = pos.add(new Vector3(0, 0, 10)); // Forward 10 units
        pml.player.teleport(newPos, true);
        pml.ui.showNotification('Teleported forward!', 2000);
      }
    });

    // Example 3: Speed monitor
    pml.player.onSpeedChange((speed) => {
      if (speed > 100) {
        console.log('Going fast!', speed);
      }
    });

    // Example 4: Position logging
    pml.player.onMove((position) => {
      // Only log occasionally to avoid spam
      if (Math.random() < 0.01) {
        console.log('Position:', position.toString());
      }
    });

    // Example 5: Auto-steering assist
    pml.ui.registerKeybind({
      id: 'auto-center',
      name: 'Auto Center Steering',
      defaultKey: 'C',
      onPressed: () => {
        pml.player.setSteering(0);
        pml.ui.showNotification('Steering centered!', 1000);
      }
    });
  }

  postInit = () => {
    console.log('[SpeedBoostMod] Initialized!');
    console.log('Press Shift for speed boost');
    console.log('Press T to teleport forward');
    console.log('Press C to center steering');
  }
}

// Export mod instance
export const polyMod = new SpeedBoostMod();
