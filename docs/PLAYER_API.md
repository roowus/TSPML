# Player API Documentation

## Overview

The Player API provides clean, simple access to player state without dealing with obfuscated code or mixins.

## Basic Usage

```typescript
class MyMod extends PolyMod {
  init = (pml) => {
    // Get player speed
    const speed = pml.player.getSpeed();
    console.log('Current speed:', speed);

    // Set player speed
    pml.player.setSpeed(50);

    // Get position
    const pos = pml.player.getPosition();

    // Teleport
    pml.player.teleport(new Vector3(100, 0, 50));

    // Set steering
    pml.player.setSteering(0.5); // Turn right
  }
}
```

## API Methods

### Speed

```typescript
// Get current speed in km/h
const speed = pml.player.getSpeed(): number

// Set speed in km/h
pml.player.setSpeed(value: number): void
```

### Position

```typescript
// Get current position
const pos = pml.player.getPosition(): Vector3

// Set position
pml.player.setPosition(position: Vector3): void

// Teleport (optional: preserve speed)
pml.player.teleport(position: Vector3, preserveSpeed?: boolean): void
```

### Rotation

```typescript
// Get rotation (quaternion)
const rotation = pml.player.getRotation(): { x, y, z, w }

// Set rotation (quaternion)
pml.player.setRotation({ x, y, z, w }): void
```

### Controls

```typescript
// Get current control states
const controls = pml.player.getControls(): PlayerControls

// Set controls
pml.player.setControls({
  up: true,
  left: false,
  right: true,
  down: false,
  reset: false
})
```

### Steering

```typescript
// Get steering value (-1 to 1)
const steering = pml.player.getSteering(): number

// Set steering
pml.player.setSteering(value: number): void
```

### Game State

```typescript
// Check if player has started
const started = pml.player.hasStarted(): boolean

// Get current checkpoint index
const checkpoint = pml.player.getCheckpointIndex(): number
```

## Events

### onSpawn
Called when player spawns:
```typescript
pml.player.onSpawn(() => {
  console.log('Player spawned!');
})
```

### onReset
Called when player resets:
```typescript
pml.player.onReset(() => {
  console.log('Player reset!');
})
```

### onMove
Called when player position changes:
```typescript
pml.player.onMove((position) => {
  console.log('Moved to:', position.toString());
})
```

### onSpeedChange
Called when player speed changes:
```typescript
pml.player.onSpeedChange((speed) => {
  console.log('Speed changed to:', speed);
})
```

## Examples

### Speed Boost Mod
```typescript
pml.ui.registerKeybind({
  id: 'speed-boost',
  name: 'Speed Boost',
  defaultKey: 'Shift',
  onPressed: () => {
    const currentSpeed = pml.player.getSpeed();
    pml.player.setSpeed(currentSpeed * 2);
  }
});
```

### Teleport Mod
```typescript
pml.ui.registerKeybind({
  id: 'teleport-up',
  name: 'Teleport Up',
  defaultKey: 'U',
  onPressed: () => {
    const pos = pml.player.getPosition();
    const newPos = new Vector3(pos.x, pos.y + 10, pos.z);
    pml.player.teleport(newPos);
  }
});
```

### Auto-Steer Mod
```typescript
pml.player.onMove((pos) => {
  // Automatically center steering when going fast
  if (pml.player.getSpeed() > 50) {
    pml.player.setSteering(0);
  }
});
```

### Speed Monitor
```typescript
pml.player.onSpeedChange((speed) => {
  if (speed > 100) {
    pml.ui.showNotification('Going fast!', 1000);
  }
});
```

## Implementation Notes

The Player API currently uses:
- **Mixins** for state modification (temporary)
- **Polling** for state updates (temporary)
- **Caching** for performance

Future improvements:
- Direct access to player instance
- Event-driven updates instead of polling
- Better integration with game state

## Limitations

1. **Read-only in some cases** - Certain properties may not be modifiable
2. **Updates may be delayed** - State polling means slight delays
3. **Requires game to be running** - Cannot access state outside gameplay

## Migration from PML

### PML (Mixin-based):
```javascript
pml.registerGlobalMixin({
  type: MixinType.REPLACEBETWEEN,
  tokenStart: 'speedKmh: 0,',
  tokenEnd: 'hasStarted:',
  func: 'speedKmh: 50, hasStarted:'
});
```

### TS PML (API-based):
```typescript
pml.player.setSpeed(50);
```

Much simpler! 🎉
