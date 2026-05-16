# PolyTrack 0.6.0 Bundle Structure Analysis

## Overview

PolyTrack 0.6.0 uses **Webpack** to bundle its JavaScript code into multiple files. Understanding this structure is crucial for building TS PML's deobfuscation layer.

## Bundle Files

| Bundle | Size | Purpose |
|--------|------|---------|
| **main.bundle.js** | 2.9MB | Main game code (UI, track editor, game logic) |
| **simulation_worker.bundle.js** | 631KB | Physics simulation Web Worker |
| **polytrack_physics.wasm** | 396KB | WebAssembly physics engine |
| 124.bundle.js | 192KB | Unknown (likely graphics/rendering) |
| 280.bundle.js | 121KB | Unknown |
| 142.bundle.js | 25KB | Unknown |
| 57.bundle.js | 15KB | Unknown |
| 982.bundle.js | 10KB | Unknown |
| error_screen.bundle.js | 11KB | Error handling UI |
| 789.bundle.js | 1.3KB | Unknown (small utility) |
| 168.bundle.js | 1.3KB | Unknown (small utility) |

## Webpack Module Format

Bundles use standard webpack module format:

```javascript
{
  77: (e, t, n) => {
    // Module code
    "use strict";
    e.exports = n.p + "images/rotation_axis_x_positive.svg";
  },
  202: (e, t, n) => {
    // Another module
  }
}
```

- Numbers (77, 202, etc.) are module IDs
- Each module exports functionality
- Modules reference each other via `n()` calls

## Global Objects

Key global objects exposed:
- `window.pmlversion` - PolyTrack version
- `window.polyModLoader` - PML instance (when using PML)
- `window.electron` - Electron API bridge
- `window.addEventListener/removeEventListener` - Event system

## Loading Order

Based on analysis, bundles load in this order:

1. **main.bundle.js** - Initializes core game
2. **simulation_worker.bundle.js** - Spawns Web Worker for physics
3. **polytrack_physics.wasm** - Loads WASM module
4. **Numbered bundles** - Lazy-loaded as needed

## Module Categories (Inferred)

Based on size and naming patterns:

### UI & Rendering
- main.bundle.js (contains UI classes, button handlers, etc.)
- 124.bundle.js (192KB - likely Three.js/rendering)

### Physics
- simulation_worker.bundle.js (physics calculations)
- polytrack_physics.wasm (WASM-optimized physics)

### Utilities
- 789.bundle.js, 168.bundle.js (small utilities)

## Obfuscation Patterns

Code is heavily minified:
- Short variable names: `e`, `t`, `n`, `r`, `a`, `s`, `o`, `l`
- No comments (except library code)
- No meaningful function names
- Webpack module IDs (numbers) instead of names

## Deobfuscation Strategy

To build TS PML's deobfuscation layer:

1. **Map Module IDs → Features**
   - Analyze each bundle to identify what it contains
   - Create human-readable names for modules

2. **Map Obfuscated Names → Readable Names**
   - Track variable usage patterns
   - Use deobfuscated repo as reference
   - Build mapping database

3. **Identify Key Classes/Functions**
   - Player-related code
   - UI components
   - Physics calculations
   - Track data structures

## Next Steps for TS PML

1. ✅ Document bundle structure (this file)
2. ⏳ Analyze main.bundle.js for game classes
3. ⏳ Analyze simulation_worker.bundle.js for physics
4. ⏳ Map module IDs to functionality
5. ⏳ Create initial name mappings
6. ⏳ Test accessing game internals

## Example: Accessing Game Code

Current PML approach (mixin):
```javascript
pml.registerGlobalMixin({
  type: MixinType.REPLACEBETWEEN,
  tokenStart: `i.gn)(this, T, "f").add(new r.dth(3891597, 11714755, 4.7))`,
  tokenEnd: `i.gn)(this, T, "f").add(new r.dth(3891597, 11714755, 4.7))`,
  func: `i.gn)(this, T, "f").add(new r.dth(3891597, 11714755, -10))`
});
```

TS PML approach (API):
```javascript
pml.physics.setGravity(-10);  // Clean API, no obfuscated tokens!
```

## File Location

PolyTrack files are located at:
- macOS: `/Users/rewis/PolyTrack/PolyModLoader-darwin-x64/PolyModLoader.app/Contents/Resources/app.asar`
- Extracted: `/tmp/polymodloader-extracted/`

Use `asar extract` to extract app.asar for analysis.
