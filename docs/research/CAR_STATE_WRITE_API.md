# Car State Write API

## Implementation Status: ✅ BOTH VISUAL AND PHYSICS WRITES (2026-05-08)

### Visual Override (Rendering Only)

Modifies what the game displays, not the physics simulation:
- `tspml.player.setPosition(x, y, z)` - Changes displayed position
- `tspml.player.setSpeed(km/h)` - Changes displayed speed
- `tspml.player.setRotation(x, y, z, w)` - Changes displayed rotation

### Physics Write (WASM Memory) ✅ NEW

Modifies the actual physics state in WASM memory:
- `tspml.player.setPositionPhysics(x, y, z)` - Sets physics position
- `tspml.player.setSpeedPhysics(km/h)` - Sets physics speed
- `tspml.player.setRotationPhysics(x, y, z, w)` - Sets physics rotation
- `tspml.player.teleportPhysics(x, y, z)` - Teleport using physics

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PHYSICS SIMULATION                          │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────────┐   │
│  │ malloc(227) │───▶│ WASM Buffer  │───▶│ Physics Update      │   │
│  │             │    │ (Authoritative)   │ (calculates new      │   │
│  └─────────────┘    └──────────────┘    │  state)             │   │
│                                           └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                │ UpdateResult (Message Type 10)
                                │ with carStateBuffers
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          MAIN THREAD                                 │
│  ┌──────────────────┐         ┌─────────────────────────────────┐  │
│  │ Visual Override  │         │ Physics Write                   │  │
│  │ Intercepts       │         │ Sends message to worker:        │  │
│  │ UpdateResult,    │         │ __TS_PML_APPLY_PHYSICS_WRITES__ │  │
│  │ modifies buffers │         └─────────────────────────────────┘  │
│  │ before game sees│                          │                    │
│  └──────────────────┘                          ▼                    │
│                                                 │                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                        Game Code                              │ │
│  │              Renders car state from buffers                   │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Physics Write Implementation

#### 1. Malloc Hook (Worker Side)

Intercepts `Module.ccall` to capture the car state buffer address:

```javascript
// In wasm-preload.js worker hooks
var moduleCheckInterval = setInterval(function() {
  if (self.Module && self.Module.ccall) {
    var originalCcall = self.Module.ccall.bind(self.Module);
    self.Module.ccall = function(name, returnType, argTypes, args) {
      var result = originalCcall(name, returnType, argTypes, args);

      // Capture malloc(227) - car state buffer allocation
      if (name === 'malloc' && args && args[0] === 227) {
        self.__TS_PML_CAR_STATE_BUFFER__ = result;
        console.log('🔧 Captured buffer address: 0x' + result.toString(16));
      }

      return result;
    };
  }
}, 100);
```

#### 2. Physics Write Handler (Worker Side)

Receives write requests and modifies WASM memory:

```javascript
// Handle __TS_PML_APPLY_PHYSICS_WRITES__ messages
if (data.type === '__TS_PML_APPLY_PHYSICS_WRITES__') {
  var bufferAddr = self.__TS_PML_CAR_STATE_BUFFER__;
  var writes = data.writes;

  // Apply position writes
  if (writes.position) {
    self.Module.HEAPF32[bufferAddr / 4 + 8] = writes.position.x;   // offset 35
    self.Module.HEAPF32[bufferAddr / 4 + 9] = writes.position.y;   // offset 39
    self.Module.HEAPF32[bufferAddr / 4 + 10] = writes.position.z;  // offset 43
  }

  // Apply speed write
  if (writes.speed !== undefined) {
    self.Module.HEAPF32[bufferAddr / 4 + 1] = writes.speed;  // offset 4
  }

  // Apply rotation writes
  if (writes.rotation) {
    self.Module.HEAPF32[bufferAddr / 4 + 11] = writes.rotation.x;  // offset 47
    self.Module.HEAPF32[bufferAddr / 4 + 12] = writes.rotation.y;  // offset 51
    self.Module.HEAPF32[bufferAddr / 4 + 13] = writes.rotation.z;  // offset 55
    self.Module.HEAPF32[bufferAddr / 4 + 14] = writes.rotation.w;  // offset 59
  }
}
```

#### 3. PlayerAPI Methods

```typescript
// Queue physics writes
private queuePhysicsWrite(writes): void {
  const worker = window.__TS_PML_SIMULATION_WORKER__;
  worker.postMessage({
    type: '__TS_PML_APPLY_PHYSICS_WRITES__',
    writes: writes
  });
}

// Public API methods
public setSpeedPhysics(value: number): void {
  this.queuePhysicsWrite({ speed: value });
}

public setPositionPhysics(position: Vector3): void {
  this.queuePhysicsWrite({ position: { x, y, z } });
}

public setRotationPhysics(rotation): void {
  this.queuePhysicsWrite({ rotation });
}

public teleportPhysics(position, preserveSpeed = false): void {
  if (!preserveSpeed) this.setSpeedPhysics(0);
  this.setPositionPhysics(position);
}
```

## API Usage

### Visual Override (Rendering Only)

```javascript
// Changes what's displayed, physics continues with real values
tspml.player.setPosition(new tspml.Vector3(100, 0, 200));
tspml.player.setSpeed(50);
tspml.player.setRotation({ x: 0, y: Math.PI, z: 0, w: 1 });
```

### Physics Write (Affects Simulation)

```javascript
// Actually changes physics state
tspml.player.setPositionPhysics(new tspml.Vector3(100, 0, 200));
tspml.player.setSpeedPhysics(50);
tspml.player.setRotationPhysics({ x: 0, y: Math.PI, z: 0, w: 1 });

// Teleport using physics
tspml.player.teleportPhysics(new tspml.Vector3(100, 0, 200));
tspml.player.teleportPhysics(new tspml.Vector3(100, 0, 200), true);  // Preserve speed
```

## Known Buffer Offsets

| Word Offset | Byte Offset | Field | Type | Notes |
|-------------|-------------|-------|------|-------|
| 1 | 4 | speedKmh | float32 | Speed in km/h |
| 8 | 35 | position.x | float32 | May have garbage in some states |
| 9 | 39 | position.y | float32 | Usually 0 (flat track) |
| 10 | 43 | position.z | float32 | Altitude (reliable) |
| 11 | 47 | quaternion.x | float32 | May not be actual quat |
| 12 | 51 | quaternion.y | float32 | Heading (reliable) |
| 13 | 55 | quaternion.z | float32 | - |
| 14 | 59 | quaternion.w | float32 | Usually 1.0 |

Note: `HEAPF32[bufferAddr / 4 + wordOffset]` is used because HEAPF32 is word-indexed.

## When to Use Each

| Use Case | Method | Why |
|----------|--------|-----|
| Visual effects only | `setPosition()`, `setSpeed()` | Simpler, no timing issues |
| Actual teleportation | `setPositionPhysics()`, `teleportPhysics()` | Affects physics simulation |
| Speed hacks | `setSpeedPhysics()` | Changes actual movement speed |
| Ghost mode / noclip | `setPositionPhysics()` | Car moves through walls |

## Testing

1. Start the app: `cd electron-app && npm start`
2. Look for malloc hook confirmation: `🔧 Captured buffer address: 0x...`
3. Test physics write:
   ```javascript
   tspml.player.setPositionPhysics(new tspml.Vector3(100, 0, 200));
   // Look for: 📝 [TS-PML] Position physics write:
   ```
4. The car should actually move in the physics simulation, not just visually

## Limitations

1. **Buffer Address Required** - Physics writes only work after malloc(227) is intercepted
2. **Module Required** - Worker must have Module object with ccall
3. **Timing** - Writes apply immediately; may conflict with simultaneous physics updates
4. **Single Player** - Currently finds first valid car; multiplayer needs player identification
