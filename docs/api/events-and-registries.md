# Events & registries (Tier 1)

> The stable API surface most mods use — an `EventEmitter` + namespaced registries wired by the loader-owned bridge. Status: **the typed event bus is implemented** (`@tspml/api` types + `@tspml/api-bridge` `EventBus`, M4 slice 1) with **per-listener error isolation** (a throwing listener is caught + logged, never blocking siblings or the game — a direct PML fix) and unsubscribe-returning `on`/`once`. Signatures below finalize as the bridge wires each event to a real game function. Grounded in real deobfuscated symbols (see [deobfuscated-bundles.md](../research/deobfuscated-bundles.md)).

## Lifecycle (on the `api` object)

```ts
api.events.on('loader.preInit',  (api) => {});   // before any game code; only place for global hooks
api.events.on('loader.init',     (api) => {});
api.events.on('loader.ready',    () => {});       // main menu visible
api.events.on('loader.onUnload', () => {});       // cleanup (fixes PML's missing-cleanup bug)
```

### Cleanup: how a mod actually unloads

Subscribing to `loader.onUnload` is for mods that want to *observe* teardown.
For your own cleanup, use the form matching your entrypoint — the loader calls
it directly, in **reverse load order**, isolated per mod (#17):

```ts
// Factory form — return a disposer. Same convention as on()/register().
export default function myMod(api: TspmlApi) {
  const off = api.events.on('car.control', handler);   // returns unsubscribe
  const unbind = api.keybinds.register({ /* ... */ }); // returns unregister
  return () => { off(); unbind(); };                   // ← called on unload
}

// Class form — implement onUnload. It receives the api, so you don't have to
// stash a reference at init time.
export default class MyMod extends TspmlMod {
  override onUnload(api: TspmlApi) { /* detach */ }
}
```

Returning nothing is fine — the mod is reported as `no-op` rather than
`unloaded`. Throwing is contained: your mod's failure is reported and every
other mod still tears down.

The **host** (portal / dev harness) drives this: it calls `LoadResult.unload()`
and emits `loader.onUnload` around it. Neither the loader nor a mod is *typed* to
emit: `TspmlApi.events` is `TspmlEventSubscriber` — `on`/`once`/`off`, no `emit`.
Since [#18](https://github.com/roowus/TSPML/issues/18) a compiled mod calling
`api.events.emit('race.finished', …)` fails to typecheck, instead of the promise
living only in prose. Know the limit of that guarantee, though: it is
**compile-time only**. The concrete `EventBus` a host holds implements the full
`TspmlEventEmitter` (one object serves both roles), so a *runtime user mod* —
pasted JavaScript no compiler ever sees ([#63]) — can reach `emit` and forge
events to other mods. That is consistent with the trust model user mods already
state in plain words: a mod is arbitrary code running unsandboxed in your
browser; only add code you trust. A runtime-enforced subscriber facade would be
the fix if that trade-off ever changes.

[#63]: https://github.com/roowus/TSPML/pull/63

In the portal that host logic is [`lib/teardown.ts`](../../source/portal/lib/teardown.ts),
triggered on React unmount **and** `pagehide` (tab close and real navigation run no React
lifecycle). The order it guarantees is what a mod can rely on:

1. `loader.onUnload` is emitted **first**, while the bus and registries are still live —
   so a handler can still call `keybinds.unregister`, `tracks.remove`, and so on;
2. mods unload (each mod's disposer / `onUnload`, reverse load order);
3. the bridge registries are disposed **last**.

So: do your releasing in the handler, and expect the bridge to work while you do. Every
stage is isolated — a mod that throws on the way out is reported, never fatal.

## Game events

```ts
// physics (execute INSIDE the sim-worker; see hook-system.md)
api.events.on('physics.preStep',  (dt) => {});
api.events.on('physics.postStep', (dt) => {});

// render (Three.js render loop)
api.events.on('render.preRender',  (scene, camera) => {});
api.events.on('render.postRender', (scene, camera) => {});

// tracks
api.events.on('track.beforeLoad', (trackId) => {});
api.events.on('track.afterLoad',  (trackId) => {});
api.events.on('track.unload',     (trackId) => {});

// car
api.events.on('car.created',     (car) => {});
api.events.on('car.stateUpdate',  (state) => {});
api.events.on('car.styleChanged', (car) => {});

// checkpoints / race — all PER-CAR, all carrying `{ carId, isReplay }` (#10)
api.events.on('checkpoint.passed',  ({ index, carId, isReplay }) => {});
api.events.on('checkpoint.respawn', ({ index, carId, isReplay }) => {}); // typed, NOT wired yet (#64)
api.events.on('race.started',       ({ carId, isReplay }) => {});
api.events.on('race.finished',      ({ frames, carId, isReplay }) => {});

// input
api.events.on('input.keyDown', (e) => {});
api.events.on('input.keyUp',   (e) => {});

// ui
api.events.on('ui.render', () => {});

// network (capability-gated)
api.events.on('network.message',    (msg) => {});
api.events.on('network.connect',    () => {});
api.events.on('network.disconnect', () => {});
```

`on/off` rebuild an array-backed invoker (Fabric `ArrayBackedEvent`) — lock-free, hot-path fast.

### Per-car race events (#10)

`race.started`, `checkpoint.passed`, and `race.finished` are emitted **once per
car**, not once per race. (`checkpoint.respawn` shares the payload type but has no
emit yet — [#64].) A track you have a saved record on spawns a ghost, and the ghost
is a car: it starts, passes checkpoints, and finishes exactly like yours does. A lap
timer that ignores this double-counts.

[#64]: https://github.com/roowus/TSPML/issues/64

Every one of those payloads therefore extends `CarRef`:

```ts
interface CarRef {
  readonly carId: number | null;     // physics-worker car id; matches car.created / car.control
  readonly isReplay: boolean | null; // true = ghost/replay, false = the player
}
```

```ts
api.events.on('race.finished', ({ frames, isReplay }) => {
  if (isReplay === true) return;     // a ghost finished, not the player
  showTime(frames);
});
```

Compare against `=== true`, not truthiness. Both fields are nullable and `null` means
**TSPML could not determine it**, which is not the same as "the player" — a mod that
treats `null` as falsy silently attributes unknown cars to the player. `carId` is `null`
for a car with no physics body; `isReplay` is `null` only if the bridge's read of the
game's own controlled-car flag fails (e.g. a game update moved it), which is the
fail-soft path rather than a throw inside game code.

Because `carId` is the same id `car.created` and `car.control` report, you can still
correlate across events if you need per-car state — but you no longer *have to* in
order to answer "was that me?".

## Registries (Fabric Registry analog)

```ts
api.blocks.registerCategory(id, defaultId);
api.blocks.registerModel(url);                 // .glb, solid colors first (textures on roadmap)
api.blocks.registerBlock(id, categoryId, opts);

api.cars.registerCarStyle(id, style);

api.audio.register({ key, url, overwrite? });  // ✅ implemented — see below
api.audio.unregister(key);
api.audio.list();

api.tracks.register({ code, name?, author?, overwrite?, persist? }); // ✅ implemented — see below
api.tracks.unregister(name);
api.tracks.list();

api.ui.addWidget(id, { render, mount, unmount });

api.keybinds.register(name, id, defaultBind, cb);
api.settings.registerCategory(name);
api.settings.register(name, id, type, defaultOption, options?); // type: 'boolean' | 'slider' | 'custom'
api.settings.getSetting(id);                   // returns TYPED value (fixes PML's always-string wart)
```

> **Viability in PolyTrack 0.6.2 (discovered M4-G):** the game's content catalogs
> are largely **frozen/closed**, so most *content* registries above are **not
> viable** as "add new content" — `cars` (styles) and `settings` have no add path
> (`Object.freeze` catalogs + init-time preloading into model Maps; late mutation
> throws "model not found"). What IS viable:
> - **`keybinds`** — bridge-owned parallel listener. ✅ **implemented** (M4-G/H; the one clean, fully-verifiable registry).
> - **`tracks`** — reuse the import-by-code path. ✅ **implemented** ([#12](https://github.com/roowus/TSPML/issues/12); see below).
> - **`audio`** — override existing clips (and add new ones) by shadowing the audio
>   manager's buffer lookup. ✅ **implemented** ([#11](https://github.com/roowus/TSPML/issues/11); see below).
>   Note this ships *differently* than originally scoped: calling the game's own `load()`
>   turned out to be a latent crash, so the registry owns the read path instead — see
>   [hook-system.md](../design/hook-system.md).
>
> The **mixin system (M5, Tier 2)** is the escape hatch for content/behavior the
> registries can't reach. See [pml-shortcomings-and-tspml-improvements.md](../research/pml-shortcomings-and-tspml-improvements.md).

### `api.tracks` — custom tracks (implemented)

A mod hands over a **PolyTrack import code** (the `PolyTrack2…` string the game's own
Export button produces). The registry parses it with the **game's codec** and saves it
through the **game's track store**, so the result is indistinguishable from a
hand-imported track and the game's track-selection UI refreshes itself — TSPML ships no
UI patch for this.

```ts
const res = await api.tracks.register({
  code: 'PolyTrack2…',        // required
  name: 'My Track',           // optional — defaults to the name in the code; also the store KEY
  author: 'you',              // optional — defaults to the author in the code
  overwrite: false,           // default false: refuse a name collision, never clobber
  persist: false,             // default false: session-scoped, removed on mod unload
});
if (!res.ok) console.warn(res.reason); // 'invalid-code' | 'name-exists' | 'save-failed' | 'not-ready'
else console.log(res.name, res.trackId);

api.tracks.unregister('My Track'); // true if it was ours and the game removed it
api.tracks.list();                 // RegisteredTrack[] — what THIS session registered
```

Three behaviors worth knowing:

- **Failures are typed, never thrown.** A bad code returns `{ ok: false, reason:
  'invalid-code' }`. Game calls that throw (e.g. storage quota) become `'save-failed'`
  with a `detail`.
- **A name collision is refused by default.** The colliding track may be the *player's
  own*; clobbering it silently would be data loss. Pass `overwrite: true` to mean it.
- **`persist` is opt-in.** The game's store writes to `localStorage`, so a persisted mod
  track outlives the mod. Session-scoped registrations are removed on unload, which
  keeps an uninstalled mod from littering the player's track list.

Registrations made **before** the game has built its menu are queued and drained on
capture, so a mod can call `register` at `init` without knowing game lifecycle.

> **How the game objects are reached.** The track store lives in the bundle's
> *bootstrap*, past the wall the module locator can see. Its **callers** are real modules,
> so the bridge captures the live instance from a constructor parameter instead of locating
> the class — see [hook-system.md](../design/hook-system.md). Both capture patches only
> read a value out; neither changes game behavior.

### `api.audio` — sound overrides (implemented)

A mod hands over a `key` and a `url`. The registry fetches the URL, decodes it with the
**game's own `AudioContext`**, and serves it wherever the game asks its audio manager for
that key — so overriding a builtin changes a real game sound, and an unknown key simply
adds a new one.

```ts
const res = await api.audio.register({
  key: 'click',                     // a builtin key to override, or any new key of your own
  url: 'https://example.com/x.wav', // fetched from the game frame; blob:/data: work too
  overwrite: false,                 // default false: refuse to clobber another mod's key
});
if (!res.ok) console.warn(res.reason); // 'fetch-failed' | 'decode-failed' | 'no-audio-context'
                                       // | 'key-exists' | 'not-ready'
else console.log(res.key, res.duration, res.replacedBuiltin);

api.audio.unregister('click'); // true if it was ours — the game's ORIGINAL clip comes back
api.audio.list();              // RegisteredAudio[] — what THIS session registered
```

The **builtin keys** (v0.6.2, read off the game's own boot sequence):
`music`, `click`, `engine`, `suspension`, `tires`, `collision`, `skidding`,
`editor_edit`, `checkpoint`, `record`, `position_tick`.

Four behaviors worth knowing:

- **Failures are typed, never thrown.** A 404 is `'fetch-failed'` with the status in
  `detail`; undecodable bytes are `'decode-failed'`. Nothing here throws into your mod.
- **A key collision is refused by default.** Two mods overriding `engine` is a real
  scenario, and the second silently winning is a support nightmare. Pass `overwrite: true`
  to mean it.
- **`unregister` restores the game's original**, it does not leave a hole — the registry
  shadows the lookup rather than replacing the game's buffer.
- **Autoplay policy is the browser's, not ours.** A clip can register successfully and
  still be inaudible until the player interacts with the page. That is the game's
  `AudioContext` being suspended, not a registry failure — `register` reporting
  `ok: true` with a real `duration` means the bytes decoded.

Registrations made **before** the game has built its menu are queued and drained on
capture, so a mod can call `register` at `init` without knowing game lifecycle.

> Proven headlessly against the real game: `scripts/smoke-audio.mjs` in
> [`@tspml/dev-harness`](../../environments/dev-harness) synthesizes a clip of a chosen
> length, registers it over `click`, and asserts the **game's own** buffer lookup returns
> it — then that `unregister` brings the original duration back.

## Capability scoping

The `api` object is scoped to the mod's declared `capabilities`. Calling a registry/event outside a declared capability throws a clear error at bind time. (Capability declarations are **consented-advisory** — see [safety-and-fairness.md](../design/safety-and-fairness.md).)

> Need deeper control than events/registries expose? Use the [mixin escape hatch](./mixin-reference.md).
