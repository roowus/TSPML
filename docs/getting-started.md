# Getting started — write your first TSPML mod

> This guide walks you through creating, building, and running a TSPML mod for PolyTrack. No prior modding experience needed.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/).
- The TSPML repo cloned: `git clone https://github.com/roowus/TSPML.git && cd TSPML && pnpm install --ignore-scripts`.

## 1. Scaffold a mod

```bash
npx create-tspml-mod my-first-mod
```

This creates `./my-first-mod/` with:

| File | Purpose |
|---|---|
| `mod.json` | The manifest (id, version, targets, mixins). The loader parses this. |
| `src/entrypoint.ts` | Your mod's code — a factory `(api) => {}` that subscribes to events + registers keybinds. |
| `mixins.json` | A starter Tier-2 mixin targeting the stable name `Car` (mappings-resolved, fail-closed). |
| `tsconfig.json` | TypeScript config (extends the repo's base). |

## 2. Write your mod

Open `src/entrypoint.ts`. The default scaffold subscribes to `car.control` + registers a `KeyH` keybind. Let's make it do something visible — log a message on every checkpoint:

```ts
import type { TspmlApi } from '@tspml/api';

export default function entrypoint(api: TspmlApi): void {
  // Fire on every checkpoint passed (during a race).
  api.events.on('checkpoint.passed', (index) => {
    api.logger.log(`[my-first-mod] checkpoint ${index} passed!`);
  });

  // Register a keybind.
  api.keybinds.register({
    id: 'my-first-mod.greet',
    key: 'KeyH',
    description: 'Say hello',
    onDown: () => api.logger.log('[my-first-mod] Hello from my mod!'),
  });

  api.logger.log('[my-first-mod] loaded');
}
```

### Available events (Tier 1)

| Event | Payload | Fires |
|---|---|---|
| `car.control` | `{ carId, up, right, down, left, reset }` | On input change (keydown/keyup) |
| `car.created` | `{ carId, isReplay }` | When a car is created (player + ghosts) |
| `race.started` | (none) | When a car's race starts (per-car; player on first throttle) |
| `track.afterLoad` | `trackId` | When a track finishes loading |
| `checkpoint.passed` | `index` | When a checkpoint is passed (per-car) |
| `race.finished` | `{ frames }` | When a race is finished (per-car) |

> ⚠️ **Per-car events:** `race.started`, `checkpoint.passed`, and `race.finished` fire for ALL cars (player + ghosts). Filter on `car.created`'s `isReplay` to identify the player's car ([#10](https://github.com/roowus/TSPML/issues/10)).

### Available registries

| Registry | Method | Notes |
|---|---|---|
| `api.keybinds` | `.register({ id, key, onDown, onUp })` | Bridge-owned parallel listener; doesn't appear in the game's Controls settings. |

## 3. Build

```bash
cd my-first-mod
pnpm install
pnpm build
```

This compiles `src/entrypoint.ts` → `dist/entrypoint.js`.

## 4. Run in the portal

From the repo root:

```bash
pnpm --filter @tspml/transform build
pnpm --filter @tspml/api-bridge build
TSPML_TRANSFORM=1 pnpm --filter @tspml/portal dev
```

Open **http://localhost:3000**. The game loads with the TSPML bridge active. Your mod's events fire during a race; your keybind fires on key press.

Watch the sidebar for:
- `bridge: car.control × N` — events firing.
- `mods: ✓ tspml-example-hud` — the demo mod loaded.
- `safety: ✓ vanillaSafe · 1 warn` — the safety classification.

To load YOUR mod (not just the demo-hud), add it to `source/portal/lib/mod-loader.ts` (the `descriptors` array) + rebuild.

## 5. Declare a mixin (Tier 2 — the escape hatch)

If events/registries aren't enough, your mod can declare **mixin patches** — surgical AST transforms targeting stable game functions. Edit `mixins.json`:

```json
{
  "patches": [
    {
      "op": "after",
      "symbol": "Car.controlCar",
      "inject": "console.log('[my-first-mod] controlCar called');"
    }
  ]
}
```

The `symbol` is resolved fail-closed via `@tspml/mappings` — your mod doesn't hardcode minified anchors. See [mixin-reference.md](./api/mixin-reference.md) for all ops (`before`, `after`, `around`, `replace`, `modifyArg`, `modifyReturn`, `modifyConstant`).

## Next steps

- [Events & registries reference](./api/events-and-registries.md)
- [Mixin reference (Tier 2)](./api/mixin-reference.md)
- [`mod.json` spec](./api/mod-json-spec.md)
- [Safety & fairness](./design/safety-and-fairness.md)
