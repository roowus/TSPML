# TS PML Project Structure

## Directory Layout

```
ts-pml/
├── src/                    # Source code
│   ├── core/              # Core loader functionality
│   │   ├── TSPML.ts       # Main loader class
│   │   └── PolyMod.ts     # Base mod class
│   ├── api/               # Clean API layer (Player, UI, etc.)
│   │   ├── PlayerAPI.ts
│   │   ├── UIAPI.ts
│   │   └── PhysicsAPI.ts
│   ├── mixin/             # Mixin system (escape hatch)
│   │   └── MixinSystem.ts
│   ├── deobfuscation/     # Deobfuscation layer
│   │   └── DeobfuscationLayer.ts
│   ├── ui/                # Mod manager UI
│   ├── utils/             # Utility functions
│   └── index.ts           # Main entry point
├── dist/                  # Compiled JavaScript output
├── docs/                  # Documentation
├── tests/                 # Test files
├── examples/              # Example mods
├── package.json
├── tsconfig.json
└── README.md
```

## Module Responsibilities

### Core (`src/core/`)
- **TSPML.ts**: Main loader that coordinates everything
- **PolyMod.ts**: Base class all mods extend

### API (`src/api/`)
- Clean, Fabric-style interfaces for modders
- **PlayerAPI.ts**: Player manipulation (speed, position, etc.)
- **UIAPI.ts**: UI creation (buttons, menus, etc.)
- **PhysicsAPI.ts**: Physics manipulation (gravity, collision, etc.)

### Mixin (`src/mixin/`)
- Advanced mixin system for edge cases
- Direct code injection when API isn't enough

### Deobfuscation (`src/deobfuscation/`)
- Maps readable names to obfuscated game code
- Applies transformations to access game internals

### UI (`src/ui/`)
- Mod manager interface
- Library browser
- Settings panels

## Build Process

1. TypeScript compiler (`tsc`) compiles `src/` → `dist/`
2. Type definitions generated alongside JS
3. Mods import from `dist/` in development
4. For production, bundle with a bundler (TBD)
