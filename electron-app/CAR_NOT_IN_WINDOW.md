# Critical Finding: Car Not Accessible from Window

**Date**: 2026-05-05
**Status**: ARCHITECTURE DISCOVERY

## The Problem

Debug output shows:
```
[DEBUG] Found car-related keys: visualViewport
[DEBUG] Found game-related keys: onpopstate
```

These are **browser defaults**, not game objects!

## The Real Issue

The car is **NOT stored in `window`** at all!

Looking at the deobfuscated code:
```javascript
// Cars are stored in Webpack's private scope
C.get(this, uf, "f")  // WeakMap lookup
```

**Key insight**: The game uses **Webpack modules with WeakMaps** for private storage. WeakMaps are:
- Not enumerable (can't be found with `for...in`)
- Not accessible from `window`
- Private to the module scope

## Why Our Search Failed

```javascript
// Our search
for (const key in window) {
    // This NEVER finds WeakMap properties!
}
```

WeakMaps are **designed** to be private and non-enumerable.

## Solution Options

### Option 1: Debug Tool (Immediate) ✅

**Use the debug tool** to find where the car actually is:

1. Open DevTools Console
2. Copy and paste `/Users/rewis/polytrack-dev/ts-pml/electron-app/debug-find-car.js`
3. Run it
4. Look for "✅ Found car at..."
5. That will show us the actual path!

**This will tell us**:
- Where the car is stored
- How to access it
- What the actual structure is

### Option 2: Webpack Module Access (Technical)

Try accessing Webpack's internal module cache:

```javascript
// In DevTools console
const cache = __webpack_require__.c;
for (const [id, module] of Object.entries(cache)) {
    console.log(id, module.exports);
}
```

**Challenge**: Need to find which module has the car.

### Option 3: Mixin Code Injection (Alternative)

Inject into the actual game code using mixins:

```javascript
pml.registerGlobalMixin({
    type: 'INSERT',
    search: 'class VisualCar',
    replace: `class VisualCar {
        constructor(...) {
            if (!window.__TS_PML_ALL_CARS__) {
                window.__TS_PML_ALL_CARS__ = [];
            }
            window.__TS_PML_ALL_CARS__.push(this);
        }
    `
});
```

**Challenge**: Need exact string matches in minified code.

### Option 4: Use Deobfuscated Code (Guaranteed)

Host the deobfuscated version locally:

```javascript
// main.js - change load URL
mainWindow.loadURL('file:///path/to/deobfuscated/index.html');
```

**Challenge**: Need to set up local hosting properly.

## Recommended Next Step

**Run the debug tool!**

```bash
# In DevTools Console, paste the contents of:
cat /Users/rewis/polytrack-dev/ts-pml/electron-app/debug-find-car.js
```

This will search:
- ✅ Webpack modules
- ✅ Common game object patterns
- ✅ Arrays that might contain cars
- ✅ Properties with "car" in the name
- ✅ THREE.js scene objects

**Expected output**:
```
🔍 Starting deep car search...
✅ Found car at: window.game.cars[0]
  Methods: getSpeedKmh, setCarState, getPosition...
```

## Once We Find the Car

We can update the clean API to use the correct path:

```javascript
// Old (doesn't work)
searchWindow();  // Can't find WeakMaps

// New (will work)
window.__TS_PML_VISUAL_CAR__ = window.game.cars[0];  // Actual path!
```

## Technical Summary

| Approach | Works? | Why? |
|----------|--------|------|
| Window property search | ❌ | Car in WeakMap, not enumerable |
| Webpack module access | ⚠️ | Possible, need right module ID |
| Mixin injection | ⚠️ | Need exact string matches |
| Debug tool | ✅ | Will find actual path |
| Deobfuscated code | ✅ | Known structure |

## Success Criteria

- [x] Identified why search fails (WeakMaps)
- [x] Created debug tool to find actual path
- [ ] Run debug tool to find car
- [ ] Update clean API with correct path
- [ ] Test clean API actually works

**Current blocker**: Need to run debug tool to find where car actually is!

## Files

- **debug-find-car.js**: Run this in DevTools Console
- **mixin-detection-example.js**: Alternative mixin approach
- **CAR_NOT_IN_WINDOW.md**: This file

**Next action**: Run debug-find-car.js in console when in a race!
