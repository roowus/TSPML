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

  // Track editor — undo-integrated, so one Ctrl+Z removes the whole insert. Unlike
  // the two above this does NOT queue: it is live only while the editor is open.
  api.events.on('editor.opened', async () => {
    const placed = api.editor.getParts();
    await api.editor.insertParts([{ ...placed[0]!, x: placed[0]!.x + 1 }]);
  });
}
```

See the [events & registries](https://github.com/roowus/TSPML/blob/main/docs/api/events-and-registries.md) + [mixin reference](https://github.com/roowus/TSPML/blob/main/docs/api/mixin-reference.md).

## Changes

### Unreleased — `api.editor`, the track editor registry (#87)

New registry plus two new events, `editor.opened` and `editor.closed`. Additive:
nothing existing changed shape.

```ts
interface EditorRegistry {
  readonly available: boolean;
  isOpen(): boolean | null;
  getParts(): readonly EditorPart[];
  insertParts(parts: readonly EditorPart[]): Promise<EditorInsertResult>;
}
```

Two things to know before writing against it. `isOpen()` is `boolean | null` and
`null` means **could not determine**, not "closed" — compare against `=== true` or
`=== false` rather than for truthiness. And unlike `api.tracks` / `api.audio`,
early calls are **not queued**: the editor ships in a chunk the game fetches on
demand, so `available` is `false` for most sessions and calls before capture
answer `{ ok: false, reason: 'not-available' }`. Queueing would be wrong here —
"place these parts" is meaningless once the session it referred to is gone. Drive
it from `editor.opened` instead.

Inserts are all-or-nothing and land on the editor's undo stack as one batch, so a
single Ctrl+Z removes an insert of any size. A part the game refuses rolls the
whole run back through the game's own delete path
([#87](https://github.com/roowus/TSPML/issues/87)).

New exported types: `EditorPart`, `EditorRegistry`, `EditorInsertResult`,
`EditorInsertSuccess`, `EditorFailure`, `EditorFailureReason`.

### Unreleased — `checkpoint.respawn` is now emitted (#64)

The event was typed from the start but nothing fired it — a subscriber waited
forever. The bridge now emits it on the reset-press **edge** (once per press),
per-car like its siblings, with `index` = the checkpoint respawned **at**. It
does not fire for full restarts (the game recreates the car) or before the
first checkpoint ([#64](https://github.com/roowus/TSPML/issues/64)). No shape
change — `CheckpointInfo`, as always documented.

### Unreleased — per-car race events carry `{ carId, isReplay }` (breaking)

`race.started`, `checkpoint.passed`, and `race.finished` are emitted **once per
car** — the player's *and* every ghost/replay car on the track. That was always
true; there was no way to tell the cars apart
([#10](https://github.com/roowus/TSPML/issues/10)). Each payload now extends
`CarRef`, a new exported type (`checkpoint.respawn` shares `CheckpointInfo`;
its emit landed separately — see the entry above):

```ts
interface CarRef {
  readonly carId: number | null;
  readonly isReplay: boolean | null;
}
```

Three payloads changed shape, so listeners must be updated:

| Event | Was | Now |
|---|---|---|
| `race.started` | `()` | `({ carId, isReplay })` |
| `checkpoint.passed` / `.respawn` | `(index: number)` | `({ index, carId, isReplay })` |
| `race.finished` | `(frames: number)` | `({ frames, carId, isReplay })` (`RaceFinishInfo` gained the two fields) |

`CarRef` and `CheckpointInfo` are new exports.

Compare with `isReplay === true`, not truthiness: `null` means TSPML could not
determine which car it was, which is *unknown* rather than *the player*. Treating
`null` as falsy silently attributes unknown cars to the user, which for a lap timer
is the exact bug this change exists to prevent.

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
