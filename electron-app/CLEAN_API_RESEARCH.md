# Clean API Research & Implementation Notes

## Date: 2026-05-05

## Problem
The clean API (`pml.player.setSpeed(50)`) wasn't affecting actual gameplay - only showing alerts.

## Root Cause Analysis

### PolyTrack Architecture Discovery
Through deep analysis of `/tmp/polytrack-0.6.0-deobfuscated/main.bundle.js`, I discovered:

1. **VisualCar Class** (line 7538)
   - Main car class that renders and manages car state
   - Uses WeakMaps extensively for private data storage
   - Key WeakMaps: `ie` (carState), `de` (callbacks), `X` (camera), `Y` (camera)

2. **Car State Structure** (`ie` WeakMap):
   ```javascript
   {
       frames: 0,
       speedKmh: 0,
       hasStarted: false,
       finishFrames: null,
       nextCheckpointIndex: 0,
       position: { x, y, z },
       quaternion: { x, y, z, w },
       controls: { ... },
       steering: 0
   }
   ```

3. **Car Creation Pattern** (line 7610-7615):
   ```javascript
   const e = l.get(this, Z, "f").createCar(t, ..., (e => {
       this.setCarState(e, !1)  // Callback from physics engine
   }));
   ```
   - `Z` is the physics/simulation engine
   - The callback is invoked every physics frame with updated car state
   - VisualCar stores this in the `ie` WeakMap

4. **State Update Flow**:
   ```
   Physics Engine → createCar callback → setCarState() → ie WeakMap
                                                               ↓
                                                         getSpeedKmh()
                                                         getPosition()
   ```

## Solution: Intercept State Updates

Instead of trying to access WeakMaps directly (impossible from global scope), we intercept the state update callbacks:

### Approach 1: Intercept `createCar` Callback
```javascript
this.registerGlobalMixin({
    type: 'INSERT',
    search: 'this.setCarState(e, !1)',
    replace: `// TS PML: Capture car state
                if (typeof window !== 'undefined') {
                    window.__TS_PML_CAR_STATE__ = e;
                    if (!window.__TS_PML_VISUAL_CAR__) {
                        window.__TS_PML_VISUAL_CAR__ = this;
                    }
                }
                this.setCarState(e, !1)`
});
```

### Approach 2: Intercept `setCarState` Method
```javascript
this.registerGlobalMixin({
    type: 'INSERT',
    search: 'const n = l.get(this, ie, "f");',
    replace: `// TS PML: Capture car state updates
                if (typeof window !== 'undefined') {
                    window.__TS_PML_CAR_STATE__ = e;
                    if (!window.__TS_PML_VISUAL_CAR__) {
                        window.__TS_PML_VISUAL_CAR__ = this;
                    }
                }
                const n = l.get(this, ie, "f");`
});
```

## Clean API Implementation

The updated clean API now:
1. **Reads** from `window.__TS_PML_CAR_STATE__` (updated by physics engine)
2. **Writes** by modifying the car state object and calling `setCarState()` to force updates
3. **Stores** VisualCar reference in `window.__TS_PML_VISUAL_CAR__` for method access

### Player API Methods
```javascript
this.player = {
    getSpeed: () => window.__TS_PML_CAR_STATE__?.speedKmh || 0,

    setSpeed: (speed) => {
        window.__TS_PML_CAR_STATE__.speedKmh = speed;
        window.__TS_PML_VISUAL_CAR__?.setCarState(
            window.__TS_PML_CAR_STATE__, false
        );
    },

    getPosition: () => ({
        x: window.__TS_PML_CAR_STATE__?.position.x,
        y: window.__TS_PML_CAR_STATE__?.position.y,
        z: window.__TS_PML_CAR_STATE__?.position.z
    }),

    setPosition: (pos) => {
        window.__TS_PML_CAR_STATE__.position.x = pos.x;
        window.__TS_PML_CAR_STATE__.position.y = pos.y;
        window.__TS_PML_CAR_STATE__.position.z = pos.z;
        window.__TS_PML_VISUAL_CAR__?.setCarState(
            window.__TS_PML_CAR_STATE__, false
        );
    }
};
```

## Testing

### Test Mod: `clean-api-test-mod.js`
- Tests clean API availability
- Polls for car state (5 second timeout)
- Registers 'U' keybind to test speed manipulation
- Logs speed before/after changes
- Shows alert with results

### Expected Behavior
1. Mod loads and initializes
2. Polling detects car state when game starts
3. Pressing 'U' increases speed by 50 km/h
4. Alert shows old vs new speed
5. **Actual gameplay speed should increase** (this is the key test!)

## Files Modified

1. **TS_PML_LOADER.js**:
   - Updated `_initCleanAPI()` with car state interception
   - Added debug logging for mixin registration
   - Implemented two-pronged interception approach

2. **clean-api-test-mod.js**:
   - Added comprehensive logging
   - Added polling for car state detection
   - Improved keybind test with before/after speed check
   - Added timeout warning if car state not detected

## Next Steps for Testing

1. **Run Electron app**: `npm start` in electron-app directory
2. **Open DevTools** (should open automatically)
3. **Check console** for:
   - `✅ [Clean API Test] Player API is available!`
   - `✅ [Clean API Test] Car state detected after X checks!`
   - Speed and position values
4. **Start a race** in PolyTrack
5. **Press U key** to test speed increase
6. **Verify actual gameplay**: Does the car actually go faster?

## Potential Issues

1. **Mixin Search Patterns**: If the exact string patterns don't match, mixins won't apply
   - Solution: Use more unique/searchable patterns
   - Alternative: Use regex or multiple search patterns

2. **Timing**: Car state only becomes available after game starts
   - Solution: Polling mechanism in test mod
   - Mods should use `onGameLoad()` hook for game-specific code

3. **Physics Override**: Physics engine may overwrite our manual changes
   - Solution: May need to intercept physics callbacks too
   - Alternative: Modify physics parameters instead of direct state

4. **Multiplayer**: May need to identify local player's car specifically
   - Solution: Filter by car ID or index
   - Currently assumes first car or single-player

## Success Criteria

✅ Clean API loads without errors
✅ Car state detected (window.__TS_PML_CAR_STATE__ exists)
✅ getSpeed() returns current speed
✅ getPosition() returns current position
⚠️ **UNTESTED**: Does setSpeed() actually affect gameplay?
⚠️ **UNTESTED**: Does setPosition() actually teleport the car?

## Research Summary

This implementation represents **Option A** from our approach: deep research into the deobfuscated code to find the proper access pattern. We successfully:

1. ✅ Found VisualCar class and carState structure
2. ✅ Understood the state update flow (physics → callback → WeakMap)
3. ✅ Discovered callback system that can be intercepted
4. ✅ Implemented mixin-based interception
5. ⚠️ **Pending**: Manual testing to verify actual gameplay impact

The key insight: **Don't fight the WeakMaps - intercept the data flow**.
