# @tspml/api

TypeScript type definitions for the [TSPML](https://github.com/roowus/TSPML) stable mod surface — gives modders autocomplete + type-safety against stable names. **Zero runtime** (types only): mods `import type` from here; the loader supplies the runtime via `@tspml/api-bridge`.

## Install (for mod authors)

```bash
npm install -D @tspml/api
# or: pnpm add -D @tspml/api
```

## Use

```ts
import type { TspmlApi } from '@tspml/api';

export default async function myMod(api: TspmlApi) {
  // Typed events (Tier 1)
  api.events.on('car.control', (state) => {
    state.carId; state.up; // fully typed
  });
  // Typed keybind registry
  api.keybinds.register({ id: 'my-mod.toggle', key: 'KeyH', onDown: () => {} });

  // Content registries — put a track in the player's list, or replace a game sound.
  // Both return TYPED results rather than throwing, and both may be called here at
  // load time: they queue until the game hands the bridge its own objects.
  const track = await api.tracks.register({ code: 'PolyTrack2…' });
  const sound = await api.audio.register({ key: 'click', url: '/my-click.wav' });
  if (!track.ok) console.warn(track.reason); // 'invalid-code' | 'name-exists' | …
  if (!sound.ok) console.warn(sound.reason); // 'decode-failed' | 'key-exists' | …
}
```

See the [events & registries](https://github.com/roowus/TSPML/blob/main/docs/api/events-and-registries.md) + [mixin reference](https://github.com/roowus/TSPML/blob/main/docs/api/mixin-reference.md).

## Changes

### Unreleased — `TspmlApi.events` is subscribe-only (pre-1.0 narrowing)

`TspmlApi.events` is now `TspmlEventSubscriber` (`on` / `once` / `off`) rather
than the full `TspmlEventEmitter`. Emitting belongs to the bridge and the host: a
mod holding `emit` could forge `race.finished` or `checkpoint.passed`, and at the
receiving end no other mod could tell that from the real game event. The docs
promised this from M1; until [#18](https://github.com/roowus/TSPML/issues/18) it
was prose only.

**If your mod called `api.events.emit(…)`, it no longer compiles.** That is the
intended breakage and there is no replacement — mods are consumers of game
events. `TspmlEventEmitter` is still exported unchanged for hosts and bridges.

## Publishing (maintainers)

The package is publish-ready (publishConfig `access: public`, `prepublishOnly` builds). From the repo root:

```bash
cd packages/api
npm version patch     # 0.1.0 -> 0.1.1 (when the API changes)
npm publish           # requires `npm login` + org/package ownership
```

`npm pack --dry-run` shows exactly what ships (`dist/` type defs + this README — no source, no runtime).
