# Deobfuscation Strategy

## Overview

The deobfuscation layer is the core of TS PML's API system. It maps readable names to obfuscated PolyTrack code, enabling clean APIs like `player.setSpeed()` instead of mixin token replacement.

## Mapping Data Structure

```typescript
interface NameMapping {
  readableName: string;        // e.g., "CategoriesEnum"
  obfuscatedPath: string;      // e.g., "LA"
  category: 'player' | 'ui' | 'physics' | 'world' | 'audio' | 'unknown';
  description: string;         // Human-readable description
  valueType: 'class' | 'function' | 'variable' | 'enum';
  webpackModule?: number;      // If from specific webpack module
}
```

## Mapping Sources

1. **Deobfuscated Repo** (cwc/polytrack-0.6.0-deobfuscated)
   - Primary source for mappings
   - Contains readable names for most game code
   - Generate mappings by comparing with obfuscated code

2. **PML API ObfNames**
   - Existing mappings from current PML API
   - Already documented some enums and classes
   - Good starting point

3. **Manual Analysis**
   - For code not covered by deobfuscated repo
   - Requires reverse engineering skills

## Mapping Process

### Step 1: Identify Code in Deobfuscated Repo
```javascript
// Deobfuscated code:
class Player {
  constructor() {
    this.speed = 0;
    this.position = { x: 0, y: 0, z: 0 };
  }

  setSpeed(value) {
    this.speed = value;
  }
}
```

### Step 2: Find Corresponding Obfuscated Code
```javascript
// Obfuscated code (from main.bundle.js):
class LA {
  constructor() {
    this.a = 0;
    this.b = { c: 0, d: 0, e: 0 };
  }

  f(value) {
    this.a = value;
  }
}
```

### Step 3: Create Mapping
```json
{
  "Player": {
    "obfuscated": "LA",
    "description": "Player class",
    "valueType": "class",
    "methods": {
      "setSpeed": "f"
    },
    "properties": {
      "speed": "a",
      "position": "b"
    }
  }
}
```

### Step 4: Use in API
```typescript
// TS PML Player API
public setSpeed(value: number): void {
  const playerClass = this.deobfuscation.getValue('Player');
  const player = this.getPlayerInstance();
  player.setSpeed(value);  // Transforms to: player.f(value)
}
```

## Automated Mapping Generation

Tools to help generate mappings:

### 1. Structure Comparison
- Compare AST (Abstract Syntax Tree) of both codebases
- Match similar structures
- Suggest mappings based on confidence score

### 2. String Analysis
- Find unique strings in deobfuscated code
- Locate same strings in obfuscated code
- Map surrounding code

### 3. Import Analysis
- Analyze import statements in deobfuscated code
- Match with webpack module references
- Map module IDs to functionality

## Current Mappings

Based on PML API analysis:

| Readable Name | Obfuscated | Category | Type |
|--------------|-------------|----------|------|
| CategoriesEnum | LA | unknown | enum |
| BlocksEnum | Mb | unknown | enum |
| BlockRegister | GA | unknown | variable |
| SimCategories | pv | unknown | enum |
| SimBlocks | dd | unknown | enum |
| SimBlockRegister | bv | unknown | variable |
| SoundClass | gl | audio | class |
| BlockMap | _box | unknown | variable |
| SimBlockMap | _box | unknown | variable |

## Next Steps

- [ ] Clone cwc/polytrack-0.6.0-deobfuscated
- [ ] Build automated mapping generator
- [ ] Generate initial mappings for player-related code
- [ ] Generate initial mappings for UI-related code
- [ ] Generate initial mappings for physics-related code
- [ ] Create mapping validation tool
- [ ] Set up continuous mapping updates

## Validation

Once mappings are created, validate them:

1. **Runtime Testing** - Try accessing mapped values
2. **Type Checking** - Ensure types match expectations
3. **Behavior Verification** - Test that methods work correctly

## Community Contributions

Mappings can be crowdsourced:
- Submit PRs with new mappings
- Vote on mapping confidence
- Report broken mappings
