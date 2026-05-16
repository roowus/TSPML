# TS PML - The Second Poly Mod Loader

A modern, powerful mod loader for PolyTrack 0.6.0+ with both clean API and mixin support.

## Vision

TS PML aims to make PolyTrack modding accessible and maintainable by providing:

- **Clean, Fabric-style API** - Easy to use named functions like `player.setSpeed(2.0)`
- **Mixin Escape Hatch** - Advanced users can still use mixins for edge cases
- **Deobfuscated Code** - No more hunting for obfuscated tokens
- **Update Resilient** - APIs survive game updates
- **Full TypeScript Support** - Autocomplete and type safety
- **Auto-Updating Mod Manager** - Built-in mod library and updates

## Project Status

🚧 **In Development** - This is the initial project setup phase.

## Architecture

```
Mod Developer Code
       │
   ┌───┴───┐
   │       │
API Layer  Mixin System (escape hatch)
   │       │
   └───┬───┘
       │
Deobfuscation Layer (maps names → obfuscated)
       │
PolyTrack Game Code (Webpack + WASM)
```

## Key Features

- ✅ Both API and mixin support
- ✅ PolyTrack 0.6.0 support
- ✅ Easy version migration
- ✅ TypeScript definitions
- ✅ Mod manager UI
- ✅ Auto-update system

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for detailed progress.

## Contributing

This project is just starting. Stay tuned for contribution guidelines!

## License

MIT

---

**Note**: This is a complete rewrite of PolyModLoader, built from the ground up with better architectural decisions.
