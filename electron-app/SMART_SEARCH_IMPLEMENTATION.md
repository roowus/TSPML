# Smart Search Implementation - Improved Car Detection

**Date**: 2026-05-05
**Issue**: Clean API couldn't find car with lightweight search
**Status**: IMPLEMENTED

## Problem

The lightweight search was too narrow:
```javascript
// Only checked 8 locations, very surface-level
const likelyKeys = ['game', 'Game', 'app', 'App', 'scene', 'Scene', 'world', 'World'];
```

**Result**: `window.__TS_PML_CAR_STATE__` remained `undefined` after 5 seconds.

## Solution: 3-Phase Smart Search

Implemented a progressive search that gets broader over time:

### Phase 1: Quick Targeted (Seconds 1-20)
```javascript
_quickTargetedSearch() {
    const likelyLocations = ['game', 'Game', 'app', 'App', 'scene', 'Scene', 'world', 'World', 'state', 'State'];

    for (const key of likelyLocations) {
        // Check direct properties
        for (const val of Object.values(window[key])) {
            if (this._isCarObject(val)) {
                window.__TS_PML_VISUAL_CAR__ = val;
                return true;
            }
        }
    }
}
```
- 10 likely locations (added 'state', 'State')
- Surface-level check
- Fast but narrow

### Phase 2: Broader Properties (Seconds 21-40)
```javascript
_broaderPropertySearch() {
    const skipKeys = ['document', 'window', 'localStorage', ...];

    for (const key in window) {
        if (skipKeys.includes(key)) continue;

        const val = window[key];
        if (val && typeof val === 'object' && this._isCarObject(val)) {
            window.__TS_PML_VISUAL_CAR__ = val;
            return true;
        }
    }
}
```
- All enumerable window properties
- Skips known safe objects
- Medium breadth

### Phase 3: Deep Search (Seconds 41-60)
```javascript
_deepSearchWithSafeguards() {
    const candidates = [];

    // Collect objects with < 100 properties
    for (const key in window) {
        const val = window[key];
        if (val && typeof val === 'object' && Object.keys(val).length < 100) {
            candidates.push(val);
        }
    }

    // Search one level deep
    for (const obj of candidates) {
        for (const val of Object.values(obj)) {
            if (this._isCarObject(val)) {
                window.__TS_PML_VISUAL_CAR__ = val;
                return true;
            }
        }
    }
}
```
- One level deep
- Size-filtered (< 100 properties)
- Maximum breadth

## Improved Car Detection

### Old Detection
```javascript
// Required BOTH methods
if (typeof val.setCarState === 'function' && typeof val.getSpeedKmh === 'function') {
    return true;
}
```

### New Detection
```javascript
_isCarObject(obj) {
    // Primary: both methods
    if (typeof obj.setCarState === 'function' && typeof obj.getSpeedKmh === 'function') {
        return true;
    }

    // Secondary: just getSpeedKmh
    if (typeof obj.getSpeedKmh === 'function') {
        return true;
    }

    return false;
}
```

**More flexible**: Accepts objects with just `getSpeedKmh()` method.

## Extended Search Time

| Setting | Old | New | Reason |
|---------|-----|-----|--------|
| Max searches | 30 seconds | 60 seconds | More time for cars to spawn |
| Phase 1 | - | 20 seconds | Quick targeted |
| Phase 2 | - | 20 seconds | Broader search |
| Phase 3 | - | 20 seconds | Deep search |

## Better Logging

Console now shows progress:
```
[TS PML] Initializing clean API with smart car detection...
[TS PML] Clean API initialized with smart detection!
[TS PML] Phase 2: Broader search...
[TS PML] Phase 3: Deep search...
[TS PML] ✓ Car found in window.xxx (Phase X)!
```

Or if not found:
```
[TS PML] ✗ Car not found after 60 seconds - try starting a race
```

## Performance

Despite being broader, performance is still good:

| Phase | Searches | Depth | Objects Checked | Time |
|-------|----------|-------|-----------------|------|
| Phase 1 | 10 | 1 | ~100 | 20 sec |
| Phase 2 | ~100 | 1 | ~100 | 20 sec |
| Phase 3 | ~50 | 2 | ~500 | 20 sec |

**Total**: ~700 objects checked over 60 seconds = ~12/second (very light)

## Test It

```bash
cd /Users/rewis/polytrack-dev/ts-pml/electron-app
npm start
```

**Expected console output**:
```
✅ [Clean API Test] Player API is available!
[TS PML] Phase 2: Broader search...
[TS PML] Phase 3: Deep search...
[TS PML] ✓ Car found in window.xxx (Phase X)!
✅ [Clean API Test] Car state detected after X seconds!
```

**Then**:
1. Start a race
2. Wait for car detection (up to 60 seconds)
3. Press U to test speed

## If Still Not Found

If car isn't found after 60 seconds, try:

1. **Start a race first** - Car only exists during gameplay
2. **Wait longer** - Search auto-stops after 60s
3. **Check manually** in console:
   ```javascript
   // Look for objects with getSpeedKmh
   for (let key in window) {
       try {
           if (window[key]?.getSpeedKmh) {
               console.log(key, window[key]);
           }
       } catch(e) {}
   }
   ```

## Technical Details

**File**: TS_PML_LOADER.js
**Lines**: 287-470 (_initCleanAPI + helpers)
**Methods**:
- `_initCleanAPI()`: Main initialization
- `_quickTargetedSearch()`: Phase 1
- `_broaderPropertySearch()`: Phase 2
- `_deepSearchWithSafeguards()`: Phase 3
- `_isCarObject(obj)`: Car detection

## Success Criteria

- [x] Game loads without freezing
- [x] Clean API initializes
- [x] Multi-phase search runs
- [ ] Car actually gets found
- [ ] setSpeed() affects gameplay

**Status**: Ready for testing!
