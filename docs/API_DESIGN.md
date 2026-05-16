# TS PML API Design

## Philosophy

TS PML's API is designed to be:
- **Intuitive** - Names that make sense to game developers
- **Stable** - Survives PolyTrack updates
- **Type-Safe** - Full TypeScript definitions
- **Documented** - Every function has clear documentation
- **Consistent** - Similar patterns across all APIs

## API Categories

### 1. Player API (`pml.player`)
Everything related to the player character:
- Position, rotation, speed
- Spawn/death events
- Frame-by-frame updates

**Example:**
```typescript
pml.player.setSpeed(2.0);
pml.player.teleport(new Vector3(100, 0, 50));
pml.player.onSpawn((player) => {
  console.log('Player spawned!', player.position);
});
```

### 2. UI API (`pml.ui`)
Create and manage UI elements:
- Buttons, menus, inputs
- Keybinds
- Settings
- Notifications

**Example:**
```typescript
pml.ui.registerButton({
  id: 'my-button',
  label: 'Click Me',
  onClick: () => console.log('Clicked!')
});

pml.ui.registerKeybind({
  id: 'speed-boost',
  name: 'Speed Boost',
  defaultKey: 'Shift',
  onPressed: () => pml.player.setSpeed(3.0)
});
```

### 3. Physics API (`pml.physics`)
Manipulate game physics:
- Gravity, friction
- Collision events
- Forces and velocities

**Example:**
```typescript
pml.physics.setGravity(-5.0);  // Low gravity mode

pml.physics.onCollision((collision) => {
  console.log('Collision at', collision.position);
});
```

### 4. World API (`pml.world`)
Manipulate track and environment:
- Track parts
- Custom blocks
- Categories

**Example:**
```typescript
pml.world.registerBlock({
  id: 'my-block',
  name: 'Custom Block',
  category: 'Custom',
  modelUrl: 'https://example.com/model.glb',
  checksum: 'abc123'
});

const part = pml.world.addTrackPart({
  type: 'my-block',
  position: new Vector3(0, 0, 0)
});
```

### 5. Audio API (`pml.audio`)
Sound management:
- Play sounds
- Custom sounds
- Override game sounds

**Example:**
```typescript
pml.audio.registerSound('my-sound', 'https://example.com/sound.mp3');
pml.audio.playSound('my-sound', 0.5);  // 50% volume
```

### 6. Game API (`pml.game`)
Game state and flow:
- State checking
- Track loading
- Game mode

**Example:**
```typescript
if (pml.game.isInState('playing')) {
  console.log('Game is running!');
}

pml.game.onStateChange((newState, oldState) => {
  console.log(`State changed: ${oldState} -> ${newState}`);
});
```

## Design Principles

### 1. Naming Conventions

- **Functions**: camelCase, verb-first
  - ✅ `getSpeed()`, `setRotation()`, `registerButton()`
  - ❌ `speed()`, `rotation()`, `button()`

- **Events**: `on` prefix
  - ✅ `onSpawn()`, `onCollision()`, `onStateChange()`
  - ❌ `spawn()`, `collision()`, `stateChange()`

- **Types**: PascalCase
  - ✅ `Player`, `Vector3`, `GameState`
  - ❌ `player`, `vector3`, `gameState`

### 2. Parameter Ordering

1. Required parameters first
2. Optional parameters last
3. Callbacks last (if other optional params exist)

```typescript
// ✅ Good
setSpeed(value: number): void
teleport(position: Vector3, preserveSpeed?: boolean): void
onSpawn(callback: (player: Player) => void): void

// ❌ Bad
setSpeed(value?: number): void
teleport(preserveSpeed?: boolean, position: Vector3): void
```

### 3. Return Values

- **Setters**: Return `void` (chain via API, not return values)
- **Getters**: Return the value
- **Creators**: Return the created object

```typescript
// ✅ Good
setSpeed(value: number): void
getSpeed(): number
registerButton(config: ButtonConfig): UIButton

// ❌ Bad
setSpeed(value: number): PlayerAPI  // Unnecessary chaining
getSpeed(): void  // Getter should return value
```

### 4. Type Safety

- Use specific types, not `any`
- Provide type definitions for all callbacks
- Use enums for fixed sets of values

```typescript
// ✅ Good
type GameState = 'menu' | 'loading' | 'playing' | 'paused';
getState(): GameState

// ❌ Bad
getState(): string  // What strings are valid?
```

## Backward Compatibility

### Versioning Strategy

- **Major versions** (1.0 → 2.0): Breaking changes
- **Minor versions** (1.0 → 1.1): New features, no breaking changes
- **Patch versions** (1.0.0 → 1.0.1): Bug fixes

### Deprecation Process

1. Mark function as `@deprecated` in documentation
2. Keep function working for 2 major versions
3. Remove function in major version bump

```typescript
/**
 * @deprecated Use `player.setSpeed()` instead
 * Will be removed in TS PML 2.0
 */
setPlayerSpeed(value: number): void {
  this.player.setSpeed(value);
}
```

## Extensibility

### Adding New APIs

New APIs should:
1. Follow existing patterns
2. Use TypeScript for type safety
3. Include documentation
4. Have examples
5. Be versioned

### Custom Mods

Mods can extend TS PML by:
1. Using provided APIs
2. Using mixins for advanced cases
3. Contributing back to core API

## Comparison with PML

| Aspect | PML (Mixin-based) | TS PML (API-based) |
|--------|-------------------|-------------------|
| Ease of use | Hard (obfuscated tokens) | Easy (named functions) |
| Update resilience | Low (breaks on updates) | High (API abstraction) |
| Documentation | Minimal | Comprehensive |
| Type safety | Partial (TypeScript) | Full TypeScript |
| Learning curve | Steep | Gentle |
| Advanced use | Mixins only | Mixins + API |

## Next Steps

- [ ] Implement PlayerAPI
- [ ] Implement UIAPI
- [ ] Implement PhysicsAPI
- [ ] Implement WorldAPI
- [ ] Implement AudioAPI
- [ ] Implement GameAPI
- [ ] Write usage examples
- [ ] Create migration guide from PML
