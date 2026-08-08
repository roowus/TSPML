# Getting started — write your first TSPML mod

> This guide walks you through creating, building, and running a TSPML mod for PolyTrack. No prior modding experience needed.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/).
- The TSPML repo cloned: `git clone https://github.com/roowus/TSPML.git && cd TSPML && pnpm install --ignore-scripts`.

## 1. Scaffold a mod

```bash
node TSPML/tooling/create-tspml-mod/bin/create-tspml-mod.mjs my-first-mod
```

> **Why not `npx create-tspml-mod`?** The CLI is not on npm yet, so `npx` 404s
> (#19). Run it from the clone you made above; the one-liner lands when the
> package ships. The mod it generates is fully standalone either way.

This creates `./my-first-mod/` with:

| File | Purpose |
|---|---|
| `mod.json` | The manifest (id, version, targets, mixins). The loader parses this. |
| `src/entrypoint.ts` | Your mod's code — a factory `(api) => {}` that subscribes to events + registers keybinds. |
| `mixins.json` | A starter Tier-2 mixin targeting the stable name `Car` (mappings-resolved, fail-closed). |
| `types/tspml-api.d.ts` | A local stand-in for `@tspml/api` (also unpublished), covering the members the starter uses. Delete it and import from `@tspml/api` once that ships. |
| `tsconfig.json` | Self-contained TypeScript config — it does **not** extend the repo's base, so the mod builds at any path outside this repo. |

Then `cd my-first-mod && pnpm install && pnpm build`. The only dependency is
`typescript`; the build emits `dist/src/entrypoint.js`, which is what `mod.json`'s
`entrypoint` points at.

## 2. Write your mod

Open `src/entrypoint.ts`. The default scaffold subscribes to `car.control` + registers a `KeyH` keybind. Let's make it do something visible — log a message on every checkpoint:

```ts
// The scaffold imports the local stand-in, not '@tspml/api' — that package is
// not published yet. Swap the path when it is.
import type { TspmlApi } from '../types/tspml-api.js';

export default function entrypoint(api: TspmlApi): void {
  // Fire on every checkpoint passed (during a race). The event is PER-CAR, so
  // skip the ghosts — see the per-car note under the event table.
  api.events.on('checkpoint.passed', ({ index, isReplay }) => {
    if (isReplay === true) return;
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
| `race.started` | `{ carId, isReplay }` | When a car's race starts (per-car; player on first throttle) |
| `track.afterLoad` | `trackId` | When a track finishes loading |
| `checkpoint.passed` | `{ index, carId, isReplay }` | When a checkpoint is passed (per-car) |
| `race.finished` | `{ frames, carId, isReplay }` | When a race is finished (per-car) |

> ⚠️ **Per-car events:** `race.started`, `checkpoint.passed`, and `race.finished` fire
> for ALL cars — the player's *and* every ghost/replay car on the track. Each payload
> carries `isReplay` so you can tell them apart ([#10](https://github.com/roowus/TSPML/issues/10)):
>
> ```ts
> api.events.on('race.finished', ({ frames, isReplay }) => {
>   if (isReplay === true) return;   // a ghost finished, not the player
>   showTime(frames);
> });
> ```
>
> Check `isReplay === true` rather than truthiness. It is `boolean | null`, and `null`
> means TSPML could not determine which car it was — treat that as *unknown*, not as
> the player. (`carId` matches the id `car.created` and `car.control` report, so you
> can correlate across events; it is `null` for a car with no physics body.)

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

This compiles `src/entrypoint.ts` → `dist/src/entrypoint.js` (under `dist/src`,
not `dist`, because `rootDir` is `.` so that `types/` is inside it). That path is
exactly what `mod.json`'s `entrypoint` field points at — a test in the scaffold
package derives one from the other so they cannot drift.

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
