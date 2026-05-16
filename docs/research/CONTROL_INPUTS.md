# Control Input Protocol

## Discovery (2026-05-08)

Control inputs are **NOT stored in the 227-byte car state buffer**. They are sent to the worker via message protocol.

## Worker Message Protocol

The main thread sends control inputs to the simulation worker via `postMessage()`:

### Message Type 6: Control Inputs

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

### Example Messages

```
[6] messageType=6.00, carId=0.00, up=F, right=F, down=F, left=F, reset=F  (no keys)
[6] messageType=6.00, carId=0.00, up=T, right=F, down=F, left=F, reset=F  (UP pressed)
[6] messageType=6.00, carId=0.00, up=T, right=T, down=F, left=F, reset=F  (UP+RIGHT)
[6] messageType=6.00, carId=0.00, up=T, right=F, down=F, left=T, reset=F  (UP+LEFT)
```

### Other Message Types

| Type | Purpose | Key Fields |
|------|---------|------------|
| 0 | Initialization | version, isRealtime, trackParts, carCollisionShapeVertices, carMassOffset |
| 2 | Memory read | type, id, offset, length |
| 3 | Track data | mountainVertices, mountainOffset, trackData, carId, carRecording |
| 4 | State request | messageType, carId |
| 5 | Time sync | messageType, carId, targetSimulationTimeFrames |
| 6 | **Control inputs** | messageType, carId, up, right, down, left, reset |
| 10 | UpdateResult | carStateBuffers (response) |

## Interception Implementation

### Worker-Side Hook (wasm-preload.js)

```javascript
// In preload script - intercept messages sent to worker
var workerPostMessage = worker.postMessage.bind(worker);
worker.postMessage = function(message, transfer) {
  if (message && message.messageType === 6) {
    console.log('📤 [6] up=' + message.up + ' right=' + message.right +
                ' down=' + message.down + ' left=' + message.left);
  }
  return workerPostMessage(message, transfer);
};
```

## Mod API Implications

To implement control modification in mods:

1. **Intercept outgoing messages** - Hook `worker.postMessage()` in preload script
2. **Modify control fields** - Change `up`, `right`, `down`, `left` booleans before sending
3. **Inject custom inputs** - Send synthetic control messages for autopilot, etc.

```javascript
// Example: Force UP key always pressed
worker.postMessage = function(message, transfer) {
  if (message && message.messageType === 6) {
    message.up = true;  // Always accelerate
  }
  return originalPostMessage.call(this, message, transfer);
};
```

## ✅ IMPLEMENTED: ControlsAPI (2026-05-08)

The control injection API is now fully implemented in `src/api/ControlsAPI.ts`.

### API Usage

```javascript
// Get current controls
const controls = tspml.controls.getControls();
// { up: false, down: false, left: false, right: false, reset: false }

// Check if a key is pressed
if (tspml.controls.isPressed('up')) {
  console.log('Player is accelerating!');
}

// Set control overrides (autopilot)
tspml.controls.set({ up: true, left: true });  // Always accelerate and turn left

// Press a key temporarily (one frame)
tspml.controls.press('reset');  // Trigger reset once

// Clear all overrides
tspml.controls.clear();

// Listen for control changes
tspml.controls.on('change', (controls) => {
  if (controls.up) console.log('Accelerating!');
});
```

### Implementation Details

1. **Global State Bridge**: `window.__TS_PML_CONTROLS__` holds override state
2. **Worker Hook**: Modified `wasm-preload.js` worker.postMessage hook to check overrides
3. **Event System**: Emits 'change' events when controls are modified

The hook in `wasm-preload.js` (lines 956-995) now:
- Checks `window.__TS_PML_CONTROLS__.getOverrides()` before each Message Type 6
- Applies overrides to `message.up`, `message.right`, etc.
- Logs when overrides are active

## Test Files

| Date | File | Description |
|------|------|-------------|
| 2026-05-08 | `worker-2026-05-08-input-messages.rtf` | First worker message interception |
| 2026-05-08 | `worker-2026-05-08-controls-final.rtf` | Control input discovery (type 6) |
| 2026-05-08 | `worker-2026-05-08-controls-type6.txt` | Extracted type 6 messages |
