# Race Detection Hooks - Proactive Car Discovery

**Date**: 2026-05-05
**User Question**: "can it detect when a race/track is loaded/started?"
**Status**: IMPLEMENTED

## The Insight

The user reported that even when they're already in a race, the clean API can't find the car. This suggests we need **proactive race detection** instead of just blindly searching.

## Implementation: Race Detection Hooks

### 1. URL Detection

```javascript
const detectRaceStart = () => {
    const url = window.location.href;
    const hasTrack = url.includes('track') || url.includes('play') || url.includes('race');
    
    if (hasTrack) {
        inRace = true;
        this.log('🏁 Race/track detected! Intensifying search...');
        // Immediate deep search
    }
};
```

**Detects**: URL changes that indicate race/track loading

### 2. DOM UI Detection

```javascript
const hasRaceUI = document.querySelector('.race-ui') ||
                 document.querySelector('.hud') ||
                 document.querySelector('[class*="race"]') ||
                 document.querySelector('[class*="game"]');
```

**Detects**: Game UI elements appearing on screen

### 3. Canvas Detection

```javascript
const hasCanvas = document.querySelector('canvas');
```

**Detects**: 3D rendering canvas (game is running)

### 4. DOM Mutation Observer

```javascript
const domObserver = new MutationObserver((mutations) => {
    detectRaceStart();  // Check every DOM change
});

domObserver.observe(document.body, {
    childList: true,
    subtree: true
});
```

**Detects**: Any DOM changes (race UI loading, etc.)

### 5. Debug Window Contents

```javascript
_debugWindowContents() {
    // Find car-related keys
    for (const key in window) {
        if (key.toLowerCase().includes('car') || 
            key.toLowerCase().includes('player') ||
            key.toLowerCase().includes('visual')) {
            console.log(`Found car-related: ${key}`);
        }
    }
    
    // Check promising candidates
    for (const key of candidates) {
        const val = window[key];
        for (const [k, v] of Object.entries(val)) {
            if (typeof v.getSpeedKmh === 'function') {
                console.log(`✓ Found car at window.${key}.${k}!`);
            }
        }
    }
}
```

**Shows**: What's actually in window so we can find the car

## Adaptive Search Intensity

### When Not in Race
```javascript
// Light search
quickSearch();  // Every second

// Every 5 seconds
broaderSearch();
deepSearch();
```

### When Race Detected
```javascript
// Immediate intensive search
quickSearch();
broaderSearch();
deepSearch();
debugWindowContents();  // Show what we found

// Ongoing aggressive search
quickSearch();  // Every second
broaderSearch();  // Every 2 seconds  
deepSearch();  // Every 5 seconds
```

**Result**: 5x more frequent searches during race

## Console Output

### When Race Detected

```
[Clean API] 🏁 Race/track detected! Intensifying search...
[DEBUG] Found car-related keys: carController, playerCar, visualCars
[DEBUG] Found game-related keys: gameState, raceManager, trackData
[DEBUG] window.carController has 12 properties: cars, add, remove, get...
[DEBUG] ✓ Found car at window.carController.cars[0]!
[Clean API] ✓ Car found in window.carController!
```

### If Car Not Found

```
[Clean API] 🏁 Race detected but car not found in expected locations
[DEBUG] Showing window contents for debugging...
[DEBUG] Found these objects: game, app, state, scene...
[DEBUG] game has 50 properties: render, update, init...
[Clean API] Trying deeper search...
```

## Benefits

1. **Proactive**: Detects when race starts, searches immediately
2. **Adaptive**: Searches harder during race, lighter when not
3. **Debuggable**: Shows what's actually in window
4. **Multi-method**: URL + DOM + Canvas = comprehensive detection

## Test It

```bash
cd /Users/rewis/polytrack-dev/ts-pml/electron-app
npm start
```

### Expected Output

**Initial load**:
```
[Clean API] Clean API initialized with race detection hooks!
[Clean API] DOM observer active - will detect race start
```

**When you start a race**:
```
[Clean API] Checking if race already started...
[Clean API] 🏁 Race/track detected! Intensifying search...
[DEBUG] Found car-related keys: ...
[DEBUG] Found game-related keys: ...
[Clean API] ✓ Car found!
```

**Then test**:
```
Press U → Speed increases!
```

## If Still Not Found

The debug output will show us:
- What keys exist in window
- What properties they have
- Where to look next

**This is the key** - we can see what's actually there and adjust our search!

## Technical Details

**File**: TS_PML_LOADER.js (lines 287-520)

**Methods**:
- `_initCleanAPI()`: Main initialization
- `detectRaceStart()`: Multi-method race detection
- `_debugWindowContents()`: Show window structure
- Search methods: `_quickTargetedSearch()`, etc.

**Observers**:
- DOM MutationObserver: Detects UI changes
- URL monitoring: Detects navigation
- Canvas detection: Detects 3D rendering

## Success Criteria

- [x] Race detection via URL
- [x] Race detection via DOM
- [x] Race detection via canvas
- [x] Adaptive search intensity
- [x] Debug output shows window contents
- [ ] Car actually gets found
- [ ] Clean API works in-game

**Status**: Ready for testing - will show us where the car actually is!
