# Webpack Module ID Mapping

## Known Module IDs

### Main Bundle (main.bundle.js)

Based on deobfuscated code analysis and module imports:

| Module ID | Category | Description | Status |
|-----------|----------|-------------|--------|
| 77 | Images | rotation_axis_x_positive.svg | ✅ Known |
| 202 | UI | Copy button component | ✅ Known |
| 228 | Images | pattern_diamonds.svg | ✅ Known |

### Pattern Observations

1. **Image exports** follow pattern: `e.exports = n.p + "images/..."`
2. **UI components** use class syntax with private fields
3. **Webpack helpers**: `n.d()` for exports, `n.p` for public path

## Mapping Template

```typescript
interface ModuleMapping {
  moduleId: number;
  category: 'ui' | 'player' | 'physics' | 'rendering' | 'audio' | 'unknown';
  name: string;  // Human-readable name
  obfuscatedName?: string;  // If known
  description: string;
  exportedClasses?: string[];  // Classes this module exports
  dependencies?: number[];  // Module IDs this depends on
}
```

## Next Steps

- [ ] Map all module IDs in main.bundle.js
- [ ] Map all module IDs in simulation_worker.bundle.js
- [ ] Identify player-related modules
- [ ] Identify UI-related modules
- [ ] Identify physics-related modules
- [ ] Create automated mapping tool
