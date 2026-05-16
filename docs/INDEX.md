# TS PML Project Documentation

## 📚 Complete Documentation Index

### Research & Investigation 🔬
- **[research/CAR_STATE_FIELD_FINDINGS.md](research/CAR_STATE_FIELD_FINDINGS.md)** - Complete 227-byte buffer field mapping
- **[research/CONTROL_INPUTS.md](research/CONTROL_INPUTS.md)** - Control input protocol (Message Type 6)
- **[research/CAR_STATE_WRITE_API.md](research/CAR_STATE_WRITE_API.md)** - Write API implementation notes
- **[research/WORKER_HOOKS_PROGRESS.md](research/WORKER_HOOKS_PROGRESS.md)** - Historical progress tracking
- **[research/CAR_STATE_MAPPING_PLAN.md](research/CAR_STATE_MAPPING_PLAN.md)** - Original mapping plan

### Setup & Installation
- **[TESTING_INSTRUCTIONS.md](TESTING_INSTRUCTIONS.md)** - How to test TS PML right now
- **[BUILD_AND_TEST.md](BUILD_AND_TEST.md)** - Build system and testing guide

### Architecture & Design
- **[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)** - TS PML directory layout
- **[API_DESIGN.md](API_DESIGN.md)** - Clean API design philosophy
- **[MAPPING_EXTRACTION_RESULTS.md](MAPPING_EXTRACTION_RESULTS.md)** - Real mappings from deobfuscated code

### Technical References
- **[POLYTRACK_BUNDLE_STRUCTURE.md](POLYTRACK_BUNDLE_STRUCTURE.md)** - How PolyTrack loads code
- **[WEBPACK_MODULE_IDS.md](WEBPACK_MODULE_IDS.md)** - Webpack module mapping
- **[DEOBFUSCATION_STRATEGY.md](DEOBFUSCATION_STRATEGY.md)** - How we map obfuscated code
- **[MIXIN_SYSTEM.md](MIXIN_SYSTEM.md)** - Enhanced mixin system docs

### API Documentation
- **[PLAYER_API.md](PLAYER_API.md)** - Player API reference with examples
- **[CONTROLS_API.md](CONTROLS_API.md)** - Controls injection API reference

## 🎯 Quick Links

### Research (Latest Work)
- [Car State Field Findings](research/CAR_STATE_FIELD_FINDINGS.md) - Complete buffer mapping
- [Control Inputs](research/CONTROL_INPUTS.md) - Worker message protocol

### For Users
- [Testing Instructions](TESTING_INSTRUCTIONS.md) - Test TS PML now
- [Build & Test](BUILD_AND_TEST.md) - Set up build environment

### For Developers
- [Project Structure](PROJECT_STRUCTURE.md) - Directory layout
- [API Design](API_DESIGN.md) - Design philosophy
- [Player API](PLAYER_API.md) - Player API docs

### For Contributors
- [Deobfuscation Strategy](DEOBFUSCATION_STRATEGY.md) - How mappings work
- [Mixin System](MIXIN_SYSTEM.md) - Mixin reference
- [Mapping Results](MAPPING_EXTRACTION_RESULTS.md) - What we've extracted

## 📊 Project Status

### Completed (7/13 tasks - 54%)
1. ✅ Project structure initialized
2. ✅ Player API implemented
3. ✅ Mixin system built
4. ✅ Deobfuscation system created
5. ✅ API interfaces designed
6. ✅ Webpack structure analyzed
7. ✅ Build/test environment set up

### Research Complete (2026-05-08)
- ✅ Car state buffer fully mapped (227 bytes)
- ✅ Control input protocol discovered (Message Type 6)
- ✅ Checkpoint detection fields identified
- ✅ Wheel contact fields identified
- ✅ Dynamic car tracking algorithm (v4)
- ✅ **Control Injection API implemented**
- ✅ **Car State Write API (visual + physics)**

### In Progress
- ⏳ Physics API implementation (core physics manipulation beyond car state)

### Pending
- ⏳ UI API implementation
- ⏳ Mod manager UI
- ⏳ Auto-update system
- ⏳ Comprehensive docs

## 🏗️ Architecture Overview

```
TS PML (The Second Poly Mod Loader)
│
├── 🔧 Core System
│   ├── TSPML.ts - Main loader coordinator
│   ├── PolyMod.ts - Base mod class
│   └── Lifecycle management
│
├── 🎨 API Layer (Clean, Fabric-style)
│   ├── PlayerAPI - Player manipulation
│   ├── UIAPI - UI creation (stub)
│   ├── PhysicsAPI - Physics manipulation (stub)
│   └── WorldAPI - Track manipulation (TODO)
│
├── 🔀 Mixin System (Escape hatch)
│   └── MixinSystem.ts - Advanced code injection
│
├── 🧩 Deobfuscation Layer
│   ├── DeobfuscationLayer.ts - Name mapping
│   ├── mappings.json - Mapping data
│   └── extractedMappings.json - Auto-extracted
│
└── 📦 Build System
    ├── Rollup bundler
    ├── TypeScript compiler
    └── Test server
```

## 🚀 Getting Started

### Quick Start (5 minutes)
1. Build: `cd ~/polytrack-dev/ts-pml && npm run build`
2. Test server: `npm run test:server`
3. Load in PolyModLoader: `http://localhost:8080/test-mod/manifest.json`
4. Press T in-game to test!

### For Developers
See [BUILD_AND_TEST.md](BUILD_AND_TEST.md) for detailed build instructions.

### For Modders
See [PLAYER_API.md](PLAYER_API.md) for API usage examples.

## 🔗 External Resources

- [PolyTrack](https://polytrack.dev/)
- [PolyModLoader Wiki](https://wiki.polymodloader.com/)
- [PML Discord](https://discord.gg/GfQzuqudCg)
- [Deobfuscated Code](https://github.com/cwcinc/polytrack-0.6.0-deobfuscated)

---

**Last Updated:** 2026-05-08  
**Version:** 0.0.1 (Development)  
**Status:** Research Complete, Moving to Implementation
