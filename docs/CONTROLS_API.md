# ControlsAPI - Control Injection Reference

Inject control inputs into the game for autopilot, assisted driving, and other mods.

## Overview

The ControlsAPI allows mods to simulate key presses (UP, DOWN, LEFT, RIGHT, RESET) by intercepting and modifying control messages sent to the physics worker.

## Quick Start

```javascript
// Auto-accelerate mod
export class AutoAccelerateMod {
  modID = 'auto-accelerate';
  modName = 'Auto Accelerate';
  modVersion = '1.0.0';
  modAuthor = 'YourName';

  init(tspml) {
    // Always hold UP key
    tspml.controls.set({ up: true });

    // Listen for manual changes
    tspml.controls.on('change', (controls) => {
      console.log('Controls:', controls);
    });
  }
}
```

## API Reference

### `tspml.controls.set(controls)`

Set control overrides. When override is enabled, your controls replace the player's input.

```javascript
tspml.controls.set({
  up: true,     // Accelerate
  left: true    // Turn left
});

// You can set any combination:
tspml.controls.set({ up: true, right: true });  // Accelerate + turn right
tspml.controls.set({ reset: true });            // Trigger reset
```

### `tspml.controls.getControls()`

Get the current control state (read-only).

```javascript
const controls = tspml.controls.getControls();
// Returns: { up: boolean, down: boolean, left: boolean, right: boolean, reset: boolean }
```

### `tspml.controls.isPressed(key)`

Check if a specific control is active.

```javascript
if (tspml.controls.isPressed('up')) {
  console.log('Accelerating!');
}
```

**Valid keys**: `'up'`, `'down'`, `'left'`, `'right'`, `'reset'`

### `tspml.controls.press(key)`

Press a control temporarily (for one frame, ~16ms).

```javascript
// Honk a horn (if mapped to a key)
tspml.controls.press('up');
```

### `tspml.controls.clear()`

Clear all control overrides and return to normal input.

```javascript
tspml.controls.clear();  // Disable all overrides
```

### `tspml.controls.setOverride(enabled)`

Enable or disable override mode without changing the control values.

```javascript
tspml.controls.setOverride(false);  // Disable overrides (player input works normally)
tspml.controls.setOverride(true);   // Re-enable overrides
```

### `tspml.controls.isOverrideActive()`

Check if override mode is active.

```javascript
if (tspml.controls.isOverrideActive()) {
  console.log('Override mode is on');
}
```

## Events

### `'change'`

Emitted when control state changes.

```javascript
tspml.controls.on('change', (controls) => {
  console.log('Controls changed:', controls);
  // controls: { up: boolean, down: boolean, left: boolean, right: boolean, reset: boolean }
});
```

## Example Mods

### Autopilot (Always Accelerate)

```javascript
export class AutopilotMod {
  modID = 'autopilot';
  modName = 'Autopilot';
  modVersion = '1.0.0';

  init(tspml) {
    tspml.controls.set({ up: true });
  }
}
```

### Assisted Steering (Auto-correct)

```javascript
export class SteeringAssistMod {
  modID = 'steering-assist';
  modName = 'Steering Assist';

  init(tspml) {
    // Check steering every 100ms and auto-correct
    setInterval(() => {
      const controls = tspml.controls.getControls();
      const position = tspml.player.getPosition();

      // Simple logic: if going left, steer right
      if (position.x < -10) {
        tspml.controls.set({ up: true, right: true });
      } else if (position.x > 10) {
        tspml.controls.set({ up: true, left: true });
      }
    }, 100);
  }
}
```

### Key Remapper

```javascript
export class KeyRemapperMod {
  modID = 'key-remapper';
  modName = 'WASD Controls';

  init(tspml) {
    // This example shows how you might remap keys
    // (requires additional keyboard event handling)

    document.addEventListener('keydown', (e) => {
      switch(e.key.toLowerCase()) {
        case 'w': tspml.controls.set({ up: true }); break;
        case 's': tspml.controls.set({ down: true }); break;
        case 'a': tspml.controls.set({ left: true }); break;
        case 'd': tspml.controls.set({ right: true }); break;
      }
    });

    document.addEventListener('keyup', () => {
      tspml.controls.clear();
    });
  }
}
```

## Implementation Notes

- Controls are sent via **Message Type 6** to the simulation worker
- The worker.postMessage hook in `wasm-preload.js` applies overrides before sending
- Override state is stored in `window.__TS_PML_CONTROLS__` global
- All control changes are logged to console when debug mode is enabled

## See Also

- [Control Input Protocol](research/CONTROL_INPUTS.md) - Technical details
- [PlayerAPI](PLAYER_API.md) - Player state manipulation
