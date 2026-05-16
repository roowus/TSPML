# Major Discovery: WASM Runs in Worker Context

## The Problem

After extensive testing, we've discovered that **the physics WASM runs in a Web Worker**, not the main thread! This is why our hooks aren't catching it.

## Evidence

From the console logs, we can see:
```
🔧 Worker created: blob:https://app-polytrack.kodub.com/...
📨 Worker message: {type: 'decode', ...}
```

The game creates workers with blob URLs for:
- Geometry decoding (Draco)
- **Physics simulation** (this is where polytrack_physics.wasm loads!)

## Why Our Hooks Don't Work

### Main Thread Hooks (What We Tried)
```javascript
// These run in the MAIN thread only:
window.fetch = ...
window.WebAssembly.instantiate = ...
window.atob = ...
```

### Where Physics Actually Loads
```javascript
// In the WORKER context (isolated from main thread):
new Worker('simulation_worker.bundle.js')
  → Worker loads polytrack_physics.wasm
  → WebAssembly.instantiate() happens in worker
  → Worker's self.__TS_PML_WORKER_WASM__ = { instance, exports, memory }
```

## The Core Issue

Even if we successfully hook WASM in the worker, **we can't access it from the main thread**!

```javascript
// Main thread CANNOT access this:
self.__TS_PML_WORKER_WASM__  // Only available inside worker
```

Workers have isolated contexts for security.

## What This Means for Clean API

### Option 1: Worker Communication (Message Passing)
```javascript
// In main thread:
worker.postMessage({
    type: 'getCarSpeed'
});

// In worker (with WASM access):
const speed = view.getFloat32(SPEED_OFFSET, true);
self.postMessage({
    type: 'carSpeed',
    speed: speed
});
```

**Pros**: Clean, follows best practices
**Cons**: Complex, slow, async

### Option 2: Modify WASM Binary Directly
Edit `polytrack_physics.wasm` to export:
- A function to read car state
- A function to write car state
- Memory offsets as exports

**Pros**: Fast, synchronous access
**Cons**: Requires binary WASM editing, very difficult

### Option 3: Use Game's Existing Messages
The game already communicates with the worker. Find those message patterns and use them.

**Pros**: Uses existing infrastructure
**Cons**: Need to reverse-engineer the protocol

## The Reality

Creating a clean API like `pml.player.setSpeed(100)` is **much more complex** than expected because:

1. ✗ Car state is in WASM (not JavaScript)
2. ✗ WASM runs in worker (isolated context)
3. ✗ Need worker communication (message passing)
4. ✗ Need to find memory offsets (reverse engineering)
5. ✗ Need to understand physics engine (Bullet Physics)

## Recommended Approach

Given all these complexities, here's what I recommend:

### Phase 1: Worker Message Protocol
1. Monitor worker messages with our hooks
2. Identify messages related to car state
3. Document the message format

### Phase 2: Memory Offset Discovery
1. Send custom messages to worker
2. Have worker read WASM memory at different offsets
3. Find which offsets change when car moves

### Phase 3: Create Clean API Wrapper
```javascript
pml.player.setSpeed = (speed) => {
    worker.postMessage({
        type: 'TS_PML_SET_SPEED',
        value: speed
    });
};
```

## Conclusion

The clean API is **technically possible** but **much harder** than expected. We're not just reading a JavaScript object - we're:

1. Communicating across thread boundaries
2. Reading binary WASM memory
3. Reverse-engineering memory layouts
4. Working with compiled physics engine

This is a significant project that requires:
- Strong understanding of Web Workers
- Binary analysis skills
- Patience for testing/debugging

**The good news**: We've successfully intercepted the worker creation and can inject code. We just need to complete the worker-side hooks and message protocol.

**Next step**: Implement worker-side WASM hooks and message passing to find car state offsets.
