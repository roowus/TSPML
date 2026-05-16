# Car State Buffer Field Mapping Findings

## Test Summary

Tests performed to map the 227-byte car state buffer:

| Date | Test | Description |
|------|------|-------------|
| 2026-05-07 | Step 1 | Stationary/falling car (baseline) |
| 2026-05-07 | Step 2 | Accelerating (holding UP) |
| 2026-05-07 | Step 3 | Turning (holding LEFT/RIGHT) |
| 2026-05-07 | Step 4 | Drive → glide → checkpoint → airborne → fall |
| 2026-05-08 | Control A | Coasting (tapped forward, then no keys) |
| 2026-05-08 | Control B | Holding UP arrow |
| 2026-05-08 | Steering A | Driving straight |
| 2026-05-08 | Steering B | Holding UP + LEFT |
| 2026-05-08 | Steering C | Holding UP + RIGHT |

## Key Discoveries

### 1. Confirmed Fields (Already Known)
| Offset | Type | Field | Values | Status |
|--------|------|-------|--------|--------|
| 0-3 | uint32 | frames | Always 0 | ✅ Confirmed |
| 4-7 | float32 | speedKmh | 0-32+ km/h | ✅ Confirmed |
| 43-46 | float32 | position.z | 317 → 0 (altitude) | ✅ Confirmed |
| 51-54 | float32 | quaternion.y (heading) | -3 to +21 | ✅ Confirmed |
| 59-62 | float32 | quaternion.w | 0.0 or 1.0 | ✅ Confirmed |

### 2. ✅ Checkpoint Fields (Step 4)

| Offset | Type | Field | Values | Status |
|--------|------|-------|--------|--------|
| **101** | bool | **checkpointTrigger** | 0 → 1 (pulse) | ✅ CONFIRMED |
| **48** | float32 | **checkpointId** | 777.45 | ✅ Likely |

**Evidence**: Offset 101 shows `1` ONLY once in checkpoint test, exactly when checkpoint passed. One-shot trigger that pulses to 1 then resets. Offset 48 shows `777.45` at same moment.

### 3. ✅ Wheel Contact Fields (Step 4)

| Offset Range | Type | Field | Behavior | Status |
|--------------|------|-------|----------|--------|
| **115-183** | bool cluster | **wheelContactFlags** | Present when grounded, gone when airborne | ✅ CONFIRMED |
| **12** | bool | **isGrounded** | 1 = on ground, 0 = airborne | ✅ CONFIRMED |

**Evidence**: When airborne, wheel cluster booleans disappear. New airborne flags appear: `7:1`, `18:1`, `38:1`, `44:1`, `92:1`, `160:1`, `173:1`, `177:1`, `181:1`, `185:1`.

### 4. ✅ Control Inputs - NOT in Buffer! (2026-05-08 Discovery)

**KEY FINDING**: Control inputs are **NOT stored in the 227-byte car state buffer**.

| Test | Result |
|------|--------|
| Coasting vs UP pressed | No byte shows consistent 0 vs non-zero pattern |
| Straight vs LEFT steering | Only heading (offset 51-54) changes, not control bytes |
| All control tests | All differences are physics effects, not input state |

**Where controls ARE**: Passed to worker via **Message Type 6** protocol:

```javascript
{
  messageType: 6,
  carId: 0,
  up: boolean,      // UP arrow / W key
  right: boolean,   // RIGHT arrow / D key
  down: boolean,    // DOWN arrow / S key
  left: boolean,    // LEFT arrow / A key
  reset: boolean    // Reset key
}
```

See [`CONTROL_INPUTS.md`](CONTROL_INPUTS.md) for full protocol documentation.

### 5. Additional Field Discoveries

| Offset | Type | Field | Values | Status |
|--------|------|-------|--------|--------|
| 207 | bool | hasStarted | 1 in active samples | ✅ Confirmed |
| 87 | bool | stateFlag | 0 or 1 | 🟡 Partial |
| 180 | bool | stateFlag | 0 or 1 | 🟡 Partial |
| 96 | float32 | trackValue | 48.27, 3109.80, 194.36 | 🟡 Hypothesis |
| 136 | float32 | suspensionLength | 2.00, 2.81, 2.96 | 🟡 Hypothesis |
| 168 | float32 | positionComponent | 93.99, -3016.03 | 🟡 Hypothesis |
| 172 | float32 | velocityOrRotation | -11.89, 0.19, -187.88 | 🟡 Hypothesis |
| 184 | float32 | worldPosition | 3044.81 | 🟡 Hypothesis |

### 6. Float32 Values by Offset (Step 4)

| Offset | Values | Hypothesis |
|--------|--------|------------|
| 24 | -3156.10, 336.00, 31.75, 0.55 | Track segment/position |
| 28 | -1053.76 | Large coordinate |
| 96 | 194.36 | Track-related |
| 152 | -189.61 | Position component |
| 172 | -187.88, 11.90, -11.89 | Velocity or lateral position |
| 188 | -0.19 | Small rotation value |
| 180 | -187.94, -3008.11 | Altitude during fall |

### 7. Buffer Structure Notes

1. **Format changes** between game states - different boolean sets appear
2. **Many fields are consistently 0** - likely unused/reserved
3. **4-byte aligned** for float32/uint32 fields
4. **Non-aligned offsets** for some boolean flags

## Completed Tests

| Test | Status | Finding |
|------|--------|---------|
| Wheel contact detection | ✅ Complete | Offsets 115-183, 12 |
| Checkpoint detection | ✅ Complete | Offsets 101, 48 |
| Control input location | ✅ Complete | **NOT in buffer** - use Message Type 6 |
| Steering effect | ✅ Complete | Heading at offset 51-54 |

## Remaining Work

1. **Velocity vector** - likely offset 172 or nearby
2. **Full boolean mapping** - document all 227 bytes
3. **Write API** - implement physics modification

## Related Files

- [`CONTROL_INPUTS.md`](CONTROL_INPUTS.md) - Control input protocol (Message Type 6)
- [`logs/README.md`](logs/README.md) - Test log descriptions
