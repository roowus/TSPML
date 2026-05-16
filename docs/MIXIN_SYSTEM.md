# Mixin System Documentation

## Overview

The mixin system is TS PML's "escape hatch" for advanced modding when the clean API doesn't provide enough functionality. It's an improved version of PML's mixin system with better error handling, validation, and debugging.

## When to Use Mixins

**Use the clean API when:**
- You want to change player speed/position
- You want to add UI buttons or menus
- You want to modify physics (gravity, friction)
- You want to add custom blocks

**Use mixins when:**
- You need to modify internal game logic
- The API doesn't expose what you need
- You need advanced code injection
- You're working on cutting-edge features

## Mixin Types

### 1. HEAD - Insert at beginning of function
```typescript
pml.mixins.registerFuncMixin('someFunction', {
  type: MixinType.HEAD,
  target: 'ClassName.prototype.methodName',
  func: 'console.log("Function called!");'
});
```

### 2. TAIL - Insert at end of function
```typescript
pml.mixins.registerFuncMixin('someFunction', {
  type: MixinType.TAIL,
  target: 'ClassName.prototype.methodName',
  func: 'console.log("Function finished!");'
});
```

### 3. OVERRIDE - Replace entire function
```typescript
pml.mixins.registerFuncMixin('someFunction', {
  type: MixinType.OVERRIDE,
  target: 'ClassName.prototype.methodName',
  func: 'return myCustomImplementation();'
});
```

### 4. INSERT - Insert after token
```typescript
pml.mixins.registerGlobalMixin({
  type: MixinType.INSERT,
  token: 'someVariable = 5;',
  func: 'console.log("After variable assignment");'
});
```

### 5. REPLACEBETWEEN - Replace code between tokens
```typescript
pml.mixins.registerGlobalMixin({
  type: MixinType.REPLACEBETWEEN,
  tokenStart: 'const x = 1;',
  tokenEnd: 'const y = 2;',
  func: 'const x = 10; const y = 20;'
});
```

### 6. REMOVEBETWEEN - Remove code between tokens
```typescript
pml.mixins.registerGlobalMixin({
  type: MixinType.REMOVEBETWEEN,
  tokenStart: '// Start removal',
  tokenEnd: '// End removal'
});
```

### 7. CLASSINSERT - Insert into class
```typescript
pml.mixins.registerClassMixin('ClassName', 'methodName', {
  type: MixinType.CLASSINSERT,
  func: 'myNewMethod() { return 42; }'
});
```

### 8. CLASSREMOVE - Remove method from class
```typescript
pml.mixins.registerClassMixin('ClassName', 'methodName', {
  type: MixinType.CLASSREMOVE
});
```

### 9. CLASSREPLACE - Replace entire class
```typescript
pml.mixins.registerClassMixin('ClassName', '', {
  type: MixinType.CLASSREPLACE,
  func: 'class NewClassName { /* ... */ }'
});
```

## Validation

The mixin system validates your mixins before applying them:

**Required fields:**
- `type`: MixinType enum value
- `func`: Code to insert/replace (for most types)
- `target`: Class/function path (for class/function mixins)
- `token`/`tokenStart`/`tokenEnd`: Search tokens (for global mixins)

**Syntax checking:**
- Code is parsed to check for syntax errors
- Clear error messages if validation fails

## Debugging

### Enable Debug Mode
```typescript
const pml = TSPML.initialize({
  polytrackVersion: '0.6.0',
  debugMode: true  // Enable mixin debugging
});
```

### Export Mixins
```typescript
// Export all registered mixins (for debugging)
const mixinData = pml.mixins.exportMixins();
console.log(JSON.stringify(mixinData, null, 2));
```

### Check Applied Mixins
```typescript
// Get all applied mixin IDs
const applied = pml.mixins.getAppliedMixins();
console.log('Applied mixins:', Array.from(applied));
```

## Comparison with PML Mixins

| Feature | PML | TS PML |
|---------|-----|--------|
| Validation | No | Yes (syntax + structure) |
| Error Messages | Generic | Specific and helpful |
| Debugging | Minimal | Extensive logging |
| Documentation | Sparse | Comprehensive |
| Type Safety | Partial | Full TypeScript |
| Removal | No | Yes (can remove mixins) |
| Export/Import | No | Yes (for debugging) |

## Best Practices

1. **Prefer API over mixins** - API is more stable and easier
2. **Use specific tokens** - Avoid ambiguous tokens that match multiple locations
3. **Test incrementally** - Apply one mixin at a time and test
4. **Document your mixins** - Use the `description` field
5. **Handle errors** - Check mixin results for errors/warnings

## Migration from PML

### PML Example:
```javascript
pml.registerGlobalMixin({
  type: MixinType.REPLACEBETWEEN,
  tokenStart: `i.gn)(this, T, "f").add(new r.dth(3891597, 11714755, 4.7))`,
  tokenEnd: `i.gn)(this, T, "f").add(new r.dth(3891597, 11714755, 4.7))`,
  func: `i.gn)(this, T, "f").add(new r.dth(3891597, 11714755, -10))`
});
```

### TS PML Equivalent:
```typescript
// Option 1: Use clean API (recommended)
pml.physics.setGravity(-10);

// Option 2: Use mixin (if API doesn't work)
pml.mixins.registerGlobalMixin({
  type: MixinType.REPLACEBETWEEN,
  tokenStart: `i.gn)(this, T, "f").add(new r.dth(3891597, 11714755, 4.7))`,
  tokenEnd: `i.gn)(this, T, "f").add(new r.dth(3891597, 11714755, 4.7))`,
  func: `i.gn)(this, T, "f").add(new r.dth(3891597, 11714755, -10))`,
  description: 'Set gravity to -10 (nighttime mode)'
});
```

## Limitations

1. **Requires obfuscated tokens** - Still needs knowledge of game internals
2. **Breaks on updates** - May break when PolyTrack updates
3. **Hard to debug** - Injected code is harder to debug than API calls
4. **No autocomplete** - Unlike API, mixins don't have type hints

## Future Improvements

- [ ] Semantic mixin targets (e.g., "player.update" instead of obfuscated paths)
- [ ] Mixin conflict detection
- [ ] Mixin priority system
- [ ] Rollback functionality
- [ ] Visual mixin editor
