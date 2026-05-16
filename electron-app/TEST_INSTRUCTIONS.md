# Clean API Testing Instructions

## Quick Start

1. **Run the app**:
   ```bash
   cd /Users/rewis/polytrack-dev/ts-pml/electron-app
   npm start
   ```

2. **Check the console** (DevTools opens automatically):
   - Look for: `✅ [Clean API Test] Player API is available!`
   - Look for: `✅ [Clean API Test] Car state detected after X checks!`
   - Look for: `✅ [Clean API Test] Press U to test speed increase!`

3. **Start a race** in PolyTrack (any track, any mode)

4. **Wait for car state detection**:
   - The mod polls for 5 seconds waiting for car state
   - You should see: `✅ [Clean API Test] Car state detected!`
   - With current speed and position

5. **Press U key**:
   - This increases speed by 50 km/h
   - Check console for: `🚀 [Clean API Test] Speed increase succeeded!`
   - Check console for: `📊 [Clean API Test] Speed after change: X km/h`
   - An alert will show old vs new speed

## The Big Test: Does It Actually Work?

**IMPORTANT**: The alert shows the speed value, but we need to verify if the **actual gameplay** is affected!

### What to Check:
1. Does the car actually go faster in the game?
2. Does the speedometer show the increased speed?
3. Does the car feel faster when driving?

### If It Works:
- You should notice the car suddenly going faster
- The speedometer should jump up
- Congratulations! The clean API actually affects gameplay! 🎉

### If It Doesn't Work:
- The alert shows the speed changed, but the car continues at normal speed
- This means the physics engine is overwriting our changes
- We'll need to intercept at a deeper level

## What I Implemented

### Research (Option A) ✅
I analyzed the deobfuscated PolyTrack code and discovered:

1. **VisualCar class**: Main car rendering/state class
2. **WeakMap 'ie'**: Stores carState (speedKmh, position, etc.)
3. **Physics callback**: `createCar()` callback updates state every frame
4. **State flow**: Physics → callback → setCarState() → WeakMap

### Solution ✅
Instead of fighting WeakMaps (impossible from global scope), I intercept the data flow:

1. **Mixin 1**: Intercept `createCar` callback to capture VisualCar reference
2. **Mixin 2**: Intercept `setCarState` to capture car state updates
3. **Clean API**: Read/write `window.__TS_PML_CAR_STATE__`
4. **Force updates**: Call `setCarState()` to apply changes

### Code Changes
- **TS_PML_LOADER.js**: Updated `_initCleanAPI()` with interception
- **clean-api-test-mod.js**: Added comprehensive testing and logging
- **CLEAN_API_RESEARCH.md**: Full technical documentation

## Next Steps

### If It Works:
1. 🎉 Celebrate! Clean API actually affects gameplay!
2. Create real mods using the clean API
3. Implement Physics API (forces, collisions, etc.)
4. Build UI API (HUD elements, menus)
5. Create mod manager UI

### If It Doesn't Work:
1. Analyze why physics engine overwrites our changes
2. Intercept at deeper level (physics engine callbacks)
3. Modify physics parameters instead of direct state
4. Research how the game prevents "speed hacking"

## Debug Tips

If something doesn't work:

1. **Check console errors**: Any red text?
2. **Check mixin application**: Look for `[DEBUG] Registering mixin...` messages
3. **Check car state**: Type `window.__TS_PML_CAR_STATE__` in console
4. **Check VisualCar**: Type `window.__TS_PML_VISUAL_CAR__` in console
5. **Manual testing**: Try running commands in console:
   ```javascript
   // Check if car state exists
   window.__TS_PML_CAR_STATE__

   // Get current speed
   window.__TS_PML_CAR_STATE__.speedKmh

   // Set speed to 100
   window.__TS_PML_CAR_STATE__.speedKmh = 100
   window.__TS_PML_VISUAL_CAR__.setCarState(window.__TS_PML_CAR_STATE__, false)
   ```

## Files Reference

- **CLEAN_API_RESEARCH.md**: Technical deep-dive into PolyTrack architecture
- **TS_PML_LOADER.js**: Lines 286-375 (clean API initialization)
- **clean-api-test-mod.js**: Test mod with comprehensive logging
- **main.js**: Electron app entry point

Good luck with the testing! 🚀
