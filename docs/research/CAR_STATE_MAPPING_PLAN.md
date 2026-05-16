# Car State Structure Mapping Test Plan

## Goal: Identify remaining unknown fields in the 227-byte car state buffer

## Test Instructions

Run the app and perform each action below. Copy the console output for each test.

### Test 1: Stationary Car (Baseline)
1. Start the app with `cd electron-app && npm start`
2. Start a race but **don't press any keys**
3. Let the car sit for 2-3 seconds
4. Copy the `📊 CAR STATE ANALYSIS` lines (5-10 lines)

### Test 2: Accelerating
1. Press and hold **UP arrow** (accelerate)
2. Watch the speed increase
3. Copy the analysis lines as speed goes from 0 → ~100 km/h

### Test 3: Turning Left
1. While moving, hold **LEFT arrow**
2. Watch the car rotate
3. Copy analysis lines during the turn
4. Note: The heading value (at offset 51-54) should change

### Test 4: Turning Right
1. While moving, hold **RIGHT arrow**
2. Copy analysis lines during the turn

### Test 5: Braking
1. While moving fast, press **DOWN arrow**
2. Copy analysis lines as speed decreases

### Test 6: Airborne (Jump)
1. Drive off a ramp or edge
2. Copy analysis lines while in the air
3. Note: position.z should show altitude change

### Test 7: Respawn
1. Press **R** to reset/respawn
2. Copy analysis lines immediately after respawn

## What We're Looking For

By comparing these tests, we can identify:
- **Control inputs**: Which bytes change when you press keys (UP, LEFT, RIGHT, DOWN)
- **Velocity**: Separate from speed - direction of movement
- **Wheel states**: Contact, suspension, skid info
- **Checkpoint/progress**: Race position, lap, checkpoint index
- **Collision data**: Impact forces, impulses

## Known Fields (Already Mapped)

| Offset | Type | Field | Notes |
|--------|------|-------|-------|
| 0-3 | uint32 | frames | Always 0 (uncertain) |
| 4-7 | float32 | speedKmh | ✅ Confirmed |
| 43-46 | float32 | position.z | ✅ Altitude |
| 51-54 | float32 | quaternion.y | ✅ Heading |
| 59-62 | float32 | quaternion.w | ✅ Rotation marker |

## Expected New Output Format

```
📊 CAR STATE ANALYSIS [Car 3]:
  uint32: 0:0, 4:32, 8:2034045133, 12:1395851264, 16:1717781407, 20:16989...
  float32: 4:32.00, 43:317.30, 51:20.63, 59:1.00, 64:0.00, 68:0.00...
  bool: 0:0, 10:1, 11:1, 23:0, 24:1, 34:0...
```

## Files Being Tested

- `/Users/rewis/polytrack-dev/ts-pml/electron-app/wasm-preload.js` - Updated with detailed analysis
