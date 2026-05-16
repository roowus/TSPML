# TS PML Clean API - Complete Documentation

**Version**: 0.0.1
**Last Updated**: 2026-05-05
**Status**: Experimental - Runtime Interception Approach

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Security Configuration](#security-configuration)
4. [Clean API Implementation](#clean-api-implementation)
5. [Testing Guide](#testing-guide)
6. [Troubleshooting](#troubleshooting)
7. [API Reference](#api-reference)
8. [Development Roadmap](#development-roadmap)

---

## Overview

The TS PML Clean API provides a simple, Minecraft Fabric-like interface for modding PolyTrack:

```javascript
// Instead of complex mixins:
pml.player.setSpeed(100);
pml.player.teleport(0, 10, 0);
const speed = pml.player.getSpeed();
```

### Design Philosophy

- **90% Simple**: Most mods use clean API
- **10% Advanced**: Complex mods still have access to mixins
- **Fabric-inspired**: Similar to Minecraft's Fabric mod loader
- **Runtime Interception**: Hooks into live game objects without code injection

---

## Architecture

### PolyTrack Code Structure

```
┌─────────────────────────────────────────────────────────────┐
│                    PolyTrack Game                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────┐ │
│  │   Physics    │────▶│    Visual    │────▶│   Render   │ │
│  │   Engine     │     │     Car      │     │            │ │
│  └──────────────┘     └──────────────┘     └────────────┘ │
│         │                     │                              │
│         │ callback            │ WeakMap 'ie'                │
│         │                     │ (carState)                  │
│         ▼                     ▼                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              TS PML Runtime Interception              │  │
│  │  • Hook Array.prototype.push                          │  │
│  │  • Search window object tree                          │  │
│  │  • Poll requestAnimationFrame                         │  │
│  └──────────────────────────────────────────────────────┘  │
│         │                                                     │
│         │ Exposes                                            │
│         ▼                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              window.__TS_PML_VISUAL_CAR__            │   │
│  │              window.__TS_PML_CAR_STATE__             │   │
│  └─────────────────────────────────────────────────────┘   │
│         │                                                     │
│         ▼                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Clean API                            │   │
│  │  pml.player.getSpeed()                              │   │
│  │  pml.player.setSpeed(100)                           │   │
│  │  pml.player.teleport(x, y, z)                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### Car State Object

```javascript
{
    frames: 0,              // Frame counter
    speedKmh: 0,           // Speed in km/h
    hasStarted: false,     // Has the car started?
    finishFrames: null,    // Frame when finished
    nextCheckpointIndex: 0,// Next checkpoint
    hasCheckpointToRespawnAt: false,
    position: {            // 3D position
        x: 0,
        y: 0,
        z: 0
    },
    quaternion: {          // Rotation
        x: 0,
        y: 0,
        z: 0,
        w: 1
    },
    controls: {            // Input state
        forward: false,
        backward: false,
        left: false,
        right: false,
        reset: false,
        brake: false
    },
    steering: 0            // Steering value
}
```

---

## Security Configuration

### Current Development Setup

The Electron app uses these security settings (intentional for development):

```javascript
// main.js
webPreferences: {
    nodeIntegration: true,
    contextIsolation: false,
    webSecurity: false,
    devTools: true
}
```

### Security Warnings (Expected)

You will see these warnings in the console - **this is normal for development**:

```
Electron Security Warning (Node.js Integration with Remote Content)
Electron Security Warning (Disabled webSecurity)
Electron Security Warning (allowRunningInsecureContent)
Electron Security Warning (Insecure Content-Security-Policy)
```

### Why This is OK for Development

- Loading from `https://app-polytrack.kodub.com/0.6.0/` (trusted source)
- Only for development/testing
- Will be fixed when packaging the app
- Mods run in same context as game (by design)

### Production Security (Future)

For production builds, we will:

1. **Local hosting**: Serve PolyTrack from local files
2. **Content Security Policy**: Add proper CSP headers
3. **Context Isolation**: Use preload scripts
4. **Code signing**: Sign the Electron app
5. **Mod sandboxing**: Validate mod code before loading

---

## Clean API Implementation

### Approach: Runtime Interception

Instead of code injection (which fails on minified code), we use **runtime interception**:

#### 1. Array.prototype.push Hook

```javascript
const originalPush = Array.prototype.push;
Array.prototype.push = function(...args) {
    const result = originalPush.apply(this, args);

    // Detect when cars are added to arrays
    for (const arg of args) {
        if (arg?.car?.setCarState) {
            window.__TS_PML_VISUAL_CAR__ = arg.car;
        }
        if (arg?.setCarState && arg?.getSpeedKmh) {
            window.__TS_PML_VISUAL_CAR__ = arg;
        }
    }
    return result;
};
```

**Why this works**:
- PolyTrack stores cars in arrays
- When cars are created, they're pushed to arrays
- We intercept this to get references

#### 2. Window Object Tree Search

```javascript
const searchWindow = (obj, path = 'window') => {
    if (obj?.setCarState && obj?.getSpeedKmh) {
        window.__TS_PML_VISUAL_CAR__ = obj;
        return true;
    }
    for (const key in obj) {
        if (searchWindow(obj[key], `${path}.${key}`)) return true;
    }
    return false;
};
```

**Why this works**:
- VisualCar instance exists somewhere in window
- We recursively search the object tree
- Finds objects with both `setCarState` and `getSpeedKmh` methods

#### 3. RequestAnimationFrame Polling

```javascript
const checkForCar = (timestamp) => {
    // Every 100ms, try to find car and get state
    if (window.__TS_PML_VISUAL_CAR__) {
        const speed = window.__TS_PML_VISUAL_CAR__.getSpeedKmh();
        window.__TS_PML_CAR_STATE__ = {
            speedKmh: speed,
            position: window.__TS_PML_VISUAL_CAR__.getPosition()
        };
    }
    requestAnimationFrame(checkForCar);
};
```

**Why this works**:
- Continuously polls for car state
- Updates every frame (synced with render loop)
- Provides real-time speed/position data

### Why Code Injection Failed

**Initial approach**: Mixin-based code injection
```javascript
this.registerGlobalMixin({
    search: 'this.setCarState(e, !1)',
    replace: '...'
});
```

**Problem**:
- Deobfuscated code ≠ Live site code
- Live code is minified/obfuscated
- Search patterns don't match
- Mixins are registered but never applied

**Solution**: Runtime interception
- Works with minified code
- Doesn't rely on code patterns
- Hooks into JavaScript runtime itself

---

## Testing Guide

### Quick Start

```bash
cd /Users/rewis/polytrack-dev/ts-pml/electron-app
npm start
```

### Expected Console Output

```
✅ [Clean API Test] init called!
✅ [Clean API Test] pml.player exists: true
✅ [Clean API Test] Player API is available!
✅ [Clean API Test] Press U to test speed increase!
[Clean API] Found car at window.<some path>
✅ [Clean API Test] Car state detected after X checks!
📊 [Clean API Test] Speed: X km/h, Position: (x, y, z)
```

### Testing Steps

#### Step 1: Verify Clean API Loads
1. Open DevTools Console
2. Check for: "Player API is available!"
3. No errors = success

#### Step 2: Wait for Car Detection
1. Start a race in PolyTrack
2. Wait up to 5 seconds
3. Check for: "Car state detected!"
4. Note speed/position values

#### Step 3: Test Speed Manipulation
1. Press **U** key
2. Check console output:
   ```
   🔑 [Clean API Test] U key pressed!
   📊 [Clean API Test] Current speed: X km/h
   🚀 [Clean API Test] Speed increase succeeded!
   📊 [Clean API Test] Speed after change: Y km/h
   ```
3. **Critical**: Does the car actually go faster in-game?

#### Step 4: Manual Testing
In DevTools Console:

```javascript
// Check if car is detected
window.__TS_PML_VISUAL_CAR__
window.__TS_PML_CAR_STATE__

// Get current speed
pml.player.getSpeed()

// Set speed to 100 km/h
pml.player.setSpeed(100)

// Get position
pml.player.getPosition()

// Teleport
pml.player.teleport(0, 10, 0)
```

### Success Criteria

✅ Clean API loads without errors
✅ Car detected (window.__TS_PML_VISUAL_CAR__ exists)
✅ getSpeed() returns non-zero value
⚠️ **UNTESTED**: Does setSpeed() affect gameplay?
⚠️ **UNTESTED**: Does teleport work?

---

## Troubleshooting

### Issue: "Car state not detected after 5 seconds"

**Cause**: Runtime interception didn't find the car

**Solutions**:

1. **Check if car exists**:
   ```javascript
   // In DevTools console
   window.__TS_PML_VISUAL_CAR__
   ```

2. **Manual search**:
   ```javascript
   // Run debug-find-patterns.js
   const debug = window.__TS_PML_DEBUG__;
   debug.findSetCarState();
   ```

3. **Start a race first**:
   - Car only spawns during gameplay
   - Wait until you see your car

4. **Check for errors**:
   - Look for red text in console
   - Note any exception messages

### Issue: "Speed increase failed!"

**Cause**: VisualCar not found or setCarState unavailable

**Solutions**:

1. **Verify VisualCar exists**:
   ```javascript
   window.__TS_PML_VISUAL_CAR__
   typeof window.__TS_PML_VISUAL_CAR__.setCarState  // Should be "function"
   ```

2. **Check car state**:
   ```javascript
   window.__TS_PML_CAR_STATE__
   ```

3. **Try manual call**:
   ```javascript
   const car = window.__TS_PML_VISUAL_CAR__;
   car.setCarState({ speedKmh: 100, position: {x:0,y:0,z:0} }, false);
   ```

### Issue: Security Warnings

**Status**: **Normal for development** - ignore these warnings

These will be fixed in production builds.

### Issue: "Mod doesn't load"

**Checklist**:

- [ ] Mod has modID, modName, modVersion
- [ ] Mod exported as `window.polyMod` or `export const polyMod`
- [ ] `pml.registerMod()` called
- [ ] `pml.initMods()` called
- [ ] No JavaScript errors

---

## API Reference

### Player API

#### `pml.player.getSpeed()`

Returns current speed in km/h.

```javascript
const speed = pml.player.getSpeed();
console.log(`Going ${speed} km/h`);
```

**Returns**: `number` (speed in km/h)

#### `pml.player.setSpeed(speed)`

Sets the car's speed.

```javascript
pml.player.setSpeed(100);  // Set to 100 km/h
```

**Parameters**:
- `speed` (number): Speed in km/h

**Returns**: `boolean` (true if successful)

**Note**: May not work if physics engine overwrites value

#### `pml.player.getPosition()`

Returns current position.

```javascript
const pos = pml.player.getPosition();
console.log(`At (${pos.x}, ${pos.y}, ${pos.z})`);
```

**Returns**: `{x: number, y: number, z: number}`

#### `pml.player.setPosition(pos)`

Sets the car's position.

```javascript
pml.player.setPosition({ x: 0, y: 10, z: 0 });
```

**Parameters**:
- `pos` (object): `{x, y, z}` coordinates

**Returns**: `boolean` (true if successful)

**Note**: May not work if physics engine overwrites value

#### `pml.player.teleport(x, y, z)`

Shortcut for setPosition.

```javascript
pml.player.teleport(0, 10, 0);  // Teleport up
```

**Parameters**:
- `x` (number): X coordinate
- `y` (number): Y coordinate
- `z` (number): Z coordinate

**Returns**: `boolean`

---

## Development Roadmap

### Phase 1: Core Functionality (Current)

- [x] Basic mod loading system
- [x] Keybind system
- [x] Settings system
- [x] Mixin system (for advanced use)
- [x] Clean API design
- [ ] **Clean API runtime interception** (in progress)
- [ ] Validate clean API actually affects gameplay

### Phase 2: Testing & Validation

- [ ] Manual testing of all clean API methods
- [ ] Physics override investigation
- [ ] Multiplayer testing (local player detection)
- [ ] Edge case testing

### Phase 3: Advanced Features

- [ ] Physics API (forces, gravity, collisions)
- [ ] UI API (custom HUD, menus, overlays)
- [ ] Input API (keyboard, mouse, gamepad)
- [ ] Network API (multiplayer modifications)

### Phase 4: Tooling

- [ ] Mod manager UI
- [ ] Auto-update system
- [ ] Mod packaging/format
- [ ] Developer documentation

### Phase 5: Production

- [ ] Security hardening
- [ ] Performance optimization
- [ ] Error handling & logging
- [ ] Public release

---

## Contributing

### Code Structure

```
/Users/rewis/polytrack-dev/ts-pml/electron-app/
├── main.js                    # Electron app entry
├── TS_PML_LOADER.js          # Core TS PML implementation
├── clean-api-test-mod.js     # Test mod for clean API
├── automated-tests.js        # Automated test suite
├── debug-find-patterns.js    # Debug helper tool
├── CLEAN_API_RESEARCH.md     # Technical deep-dive
├── TEST_INSTRUCTIONS.md      # Testing guide
└── CLEAN_API_DOCS.md         # This file
```

### Memory System

Project memories stored in:
```
/Users/rewis/.claude/projects/-Users-rewis/memory/
├── MEMORY.md                              # Index
├── milestone_tspml_working.md             # Initial milestone
└── milestone_clean_api_research.md        # Clean API research
```

---

## License

TS PML - The Second Poly Mod Loader
Created by the TS PML Team

---

## Changelog

### 2026-05-05 - v0.0.1

- ✅ Core TS PML system working
- ✅ Replaced PolyModLoader completely
- ✅ Clean API designed and implemented
- ✅ Runtime interception approach
- ⚠️ Awaiting manual testing for gameplay impact

---

**Last Updated**: 2026-05-05
**Next Review**: After manual testing completion
