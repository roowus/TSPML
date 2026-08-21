# Hook system

> Two tiers: events for everyone, mixins for power users.

## Tier 1 — event bus + registries (preferred; ~90% of mods)

A stable `EventEmitter` wired by the loader-owned API bridge to real game functions. Mods do `api.events.on('physics.postStep', cb)` and never see minified code. Registration and unregistration rebuild an array-backed invoker, so dispatch walks a plain array with no allocation or locking on the hot path.

**Lifecycle:** `loader.preInit(api)` (before any game code; only place for global hooks), `loader.init(api)`, `loader.ready()` (main menu visible), `loader.onUnload()` (cleanup), `worker.init(api)`/`worker.message` (worker-context mods).

**Cleanup is implemented** (#17) — `LoadResult.unload()` disposes every loaded mod in **reverse** load order, isolated per mod, idempotent, and awaited. A class-form mod implements `onUnload(api)`; a factory-form mod returns a disposer. Note the split: the loader *calls* mod cleanup, but does not *emit* `loader.onUnload` — the mod-facing `TspmlApi.events` is typed `TspmlEventSubscriber` (`on`/`once`/`off`, no `emit`), so emitting is the host's job. That was prose-only until [#18](https://github.com/roowus/TSPML/issues/18): hosts handed mods the concrete emit-capable `EventBus` through `as unknown as ModApi`, and the double cast meant nothing checked it. The subscriber type is what makes the split real — a mod that calls `api.events.emit` now fails to compile. The portal does that job in `lib/teardown.ts`, on React unmount **and** `pagehide`, emitting `loader.onUnload` *before* anything is torn down so a handler still has a live bridge to release against; the portal smoke asserts a real page teardown actually runs a real mod's disposer. See [events-and-registries.md](../api/events-and-registries.md#cleanup-how-a-mod-actually-unloads).

**Events (grounded in real deobfuscated symbols):**
- `physics.preStep` / `physics.postStep` (wired into the sim-worker tick — **see physics model below**)
- `render.preRender` / `render.postRender` (Three.js render loop)
- `track.beforeLoad` / `track.afterLoad` / `track.unload`
- `car.created` / `car.stateUpdate` / `car.styleChanged`
- `checkpoint.passed` / `checkpoint.respawn` — **per-car**, payload `{ index, carId, isReplay }` (`respawn` fires once per reset press, at the checkpoint respawned **at** — [#64](https://github.com/roowus/TSPML/issues/64))
- `race.started` / `race.finished` — **per-car**, payload `{ carId, isReplay }` / `{ frames, carId, isReplay }`
- `input.keyDown` / `input.keyUp` (a clean, self-gated stream: one event per physical key transition, not one per matching binding)
- `ui.render`
- `network.message` / `network.connect` / `network.disconnect` (capability-gated)

**Per-car attribution ([#10](https://github.com/roowus/TSPML/issues/10), fixed).** The
three wired race events above are emitted by patches on methods of the car-controller class, so
they fire once per car — the player's *and* every ghost on the track. They now carry
`{ carId, isReplay }` (`CarRef`) so a mod can filter instead of guessing. The issue
recorded this as blocked on the controlled-car flag being "a private minified field";
that is wrong. The flag and the car id are module-scope `var` WeakMaps in the same
webpack module as the class, and a `before` inject is spliced lexically inside the
method body, so both are in its scope chain — no accessor patch, and nothing written to
a game object. The two minified names live in one exported constant
(`CAR_CONTROLLER_BINDINGS` in `@tspml/shared`) rather than being sprinkled through the
injects, which is the same rename-surface a stable accessor would have bought
([#24](https://github.com/roowus/TSPML/issues/24)). Note the sense: the game stores
*is-controlled*, so `isReplay` is its negation, and every read is guarded — a failed
read yields `null` ("unknown") rather than throwing inside game code. Because no smoke
can produce a ghost (a ghost needs a saved record; smokes launch a fresh profile), the
player-vs-ghost distinction is proven by running the real transform over a synthetic
two-car bundle in `source/shared/tests/per-car-events.test.ts`.

**Registries (stable, versioned):**
- `api.blocks` — custom track pieces (grounded in `PartObject`/`trackParts`)
- `api.cars` — car skins/styles (`getCarStyle`/`setCarStyle`/`carColors`/`VisualCar`)
- `api.audio` — `register({key,url})` / `unregister(key)` / `list()`: override any of the
  game's clips by URL, or add new ones (**implemented**, [#11](https://github.com/roowus/TSPML/issues/11);
  see *instance capture* below)
- `api.tracks` — register custom tracks by import code (**implemented**, [#12](https://github.com/roowus/TSPML/issues/12); see *instance capture* below)
- `api.editor` — read and write the open track, undo-integrated (**implemented**, [#87](https://github.com/roowus/TSPML/issues/87); see *reaching a chunk* below)
- `api.ui` — HUD widgets/panels
- `api.keybinds` / `api.settings` — where `getSetting` returns a **typed** value, so a numeric setting arrives as a number rather than a string you have to parse

### Instance capture — reaching past the bootstrap wall

Some of the game's most useful objects are **not in a locatable module**. The webpack
module map ends at a fixed bundle offset (v0.6.2: the map closes and bootstrap scope
begins ~330 lines before the audio manager's class expression); the code past it
constructs long-lived managers — the track store, the audio manager — that the module
locator cannot see.

The way through is to stop trying to locate the **class** and instead capture the live
**instance** from a caller that *is* a real module. A manager built in the bootstrap is
still *passed into* module-resident constructors, so a `before`-op patch on such a
constructor can read the parameter out into the bridge:

```
op: before, target: { anchor: <literals unique to the caller>, selector: { kind: 'method', name: 'constructor' } }
inject: capture(param_n)  →  window.__tspml.captureX(...)
```

This is how `api.tracks` gets the game's track store (constructor parameter of the
track-selection UI) and its codec (an export of the track-data module) — and how
`api.audio` gets the audio manager, which is **another parameter of the very same
constructor** (param 3 where the track store is param 5). Both captures therefore ride
**one** inject, and #11 needed no new anchor, no locator change, and no mappings edit.
Worth internalizing as a search habit: before assuming a bootstrap-scope object needs
new machinery, check the parameter lists of the constructors already patched.

Three properties make instance capture safe and worth generalizing:

- **Read-only.** The patch copies a reference out; it changes no game behavior, so a
  mis-target degrades to "capture never happens", not to corrupted state.
- **Late-binding by nature.** Capture happens when the game builds that UI, so the
  registry must start unbound and **queue** calls until `attach()`. `api.tracks` and
  `api.audio` both do this, which is why a mod can register at `init`.
- **Anchor discipline still applies.** Anchors must be literals *unique* to the target
  module. Verified the hard way for the codec: `"PolyTrack2"` alone also matches
  another module, so that target needs four literals with `minHits: 4`. See
  [mappings-system.md](./mappings-system.md).

Each capture in a shared inject gets its **own** `if (window.__tspml.captureX)` guard, so
a rename on one side of a future game version cannot take the other side down with it.
`source/shared/tests/bridge-patches.test.ts` enforces this.

#### Own the lookup, not the loader (the `addResource` trap)

Once you hold a manager instance, the tempting move is to call its own loading method.
For audio that is a **latent crash**, and it is the kind that only fires in production:
the manager's `load(key, urls)` begins by calling `addResource()` on the game's
loading-screen tracker, which throws `"Cannot add resources after loading is complete"`
once boot finishes. Instance capture is inherently late-binding — so *every* mod call
would land in exactly that window.

`api.audio` therefore **shadows the read path** instead. It installs an own-property
`getBuffer` on the captured instance that answers from the mod's map and delegates to the
bound prototype method otherwise. The game reads clips through `getBuffer` at *play* time
(`playUIClick()` does `this.getBuffer("click")`), so an override lands where the game
actually looks — and three things fall out for free:

- `unregister` restores the game's original clip exactly (`delete` the own property, or
  drop the map entry); no need to keep a copy.
- The game's resource tracker is never touched.
- Decoding goes through the game's *own* `AudioContext`, so a decoded buffer is
  guaranteed compatible with the graph that will play it.

Generalizing: **prefer shadowing the accessor the game reads through over invoking the
loader it read through at boot.** Boot-time paths carry boot-time assumptions.

#### The capture window opens before the bridge exists

A capture patch runs whenever *its* module runs, and that can be **earlier than the
surface's bridge**. The three captures shipped so far straddle this: the track store and
the audio manager are handed over late (when the game builds its menu, comfortably after
the host page's `load` handler), but the **codec's module factory runs during bundle
init** — before `window.__tspml` exists.

The consequence is a uniquely misleading failure. The late capture succeeds, the early
one hits an absent bridge and is dropped by its own `if (window.__tspml && …)` guard,
and the registry never attaches — so the symptom is "one of two captures silently
missing", not an error anywhere.

The fix is a **pre-bridge stub** injected ahead of the game's scripts, standing up a
minimal `window.__tspml` whose capture functions only record; the host replays what it
recorded when it installs the real bridge. Both live in
[`@tspml/shared`](../../source/shared) (`EARLY_CAPTURE_SCRIPT_TAG` / `readEarlyCaptures`)
so no surface can forget one. Generalizing: **any** new instance capture must ask where
its target module runs relative to the bridge, and if the answer is "possibly earlier",
it belongs in the stub too. `api.audio` asked and answered *no* — it shares the
track store's late-running constructor — so it needed no stub slot.

> The portal's committed smoke reports which captures arrived early
> (`scripts/smoke-tracks.mjs`); in practice it is the codec, empirically confirming the
> stub is load-bearing rather than defensive.

### Reaching a chunk — the track editor (#87)

The editor is the first thing TSPML hooks that is not in `main.bundle.js` at all. It
ships in a numbered webpack chunk the game fetches on demand (`i.e(112)` →
`<version>/112.bundle.js`), so before [#98](https://github.com/roowus/TSPML/issues/98)
gave every served file its own *transform surface* — its own hash pin, its own base
patch set, its own source-map filename — there was no way to anchor anything in it. The
chunk re-minifies on its own schedule, so sharing the main bundle's pin would either
trip on every unrelated main-bundle change or, worse, accept a re-minified chunk whose
anchors no longer fit.

Three things about the capture are worth recording, because each was a wrong turn first:

**The parts are not the editor's.** The editor mutates the *shared* `Track` instance the
race scene also uses, and every editor edit goes through that object's `setPart` /
`deleteSpecificPart`. Those live in the **main** bundle and the bridge already captures
the `Track`. So placement never needed the chunk; only the undo stack and the open flag
did.

Reading is one call further out, and getting that wrong cost a release: `forEachPart`
belongs to the **track-data** object `getTrackData()` builds, not to the `Track`. The
registry called `track.forEachPart` and the live game answered `"not a function"`,
which the guard against partial reads turned into an empty array — so a full track read
as an empty one and nothing reported a fault. Two lessons generalize past this bug.
Fail-soft guards convert a wrong shape into a plausible value, so a shape assumption
must be checked against the game rather than against the guard. And the unit tests all
passed throughout, because the fake `Track` had been given a `forEachPart` too: a fake
built from the same assumption as the code under test can never falsify it. Fakes for
captured game objects are now shaped from the deobfuscated source, not from the calls
the bridge happens to make.

**TypeScript `#private` fields are not private in the bundle.** They downlevel to
module-scope `WeakMap`s with a read helper (`(0,i.gn)(this, wn, "f")`), so the editor's
undo stack, redo stack, and open flag are all reachable — but only from *inside* the
chunk's module scope. That is what the capture patch is for: a `before`/`after` inject is
spliced lexically into the target's body, so it sits in that scope chain and can close
over the `WeakMap` bindings directly. What it hands the host is a set of **closures**,
not state.

**The instance arrives separately, and from the editor's own methods.** The capture runs
at module scope, which is before any editor exists, so it cannot supply one. `this`
inside the editor's `enable()` / `disable()` is the live editor, which supplies the
instance *and* makes `editor.opened` / `editor.closed` exact rather than polled: the
events and `api.editor.isOpen()` end up reading the same flag and cannot disagree. Note
what was rejected — `dispose` looked like the natural close signal, but the method
locator takes the **first** matching method in source order and the chunk's first
`dispose` belongs to an unrelated resource-cleanup class. An editor-closed signal built
on it would have attached to the wrong object silently, which is the same first-match
trap that rules out `constructor`.

Chunk 112 is also the first surface whose base patch set is neither the bridge patches
nor empty. Base patches are all-or-nothing per surface, so feeding a chunk the main
bundle's set would make every one of them miss and serve that chunk vanilla *for a
reason that is not drift* — the lookup is therefore keyed on the chunk id, not on
whether the surface is a chunk.

## Tier 2 — mixin surgery (escape hatch)

Declarative function surgery against **stable names**. Reach for the least invasive operation that does the job: the smaller the edit, the more likely it survives a game update and coexists with other mods.

| Op | Behavior |
|---|---|
| `before(target, handler)` | run before; `handler(args)` |
| `after(target, handler)` | run after; `handler(args, result)` |
| `around(target, handler)` | `handler(args, proceed)` → full control, can short-circuit |
| `modifyArg(target, callsite, i, fn)` | change one argument of an internal call (AST locator) |
| `modifyReturn(target, fn)` | transform return value |
| `replace(target, handler)` | full overwrite; **last resort, single-winner** |

A `target` is a stable path resolved through the mappings file, e.g. `{ symbol: "Car.controlCar", point: "HEAD" }` or `{ symbol: "Car.update", invoke: "Car.applyPhysics" }` for an INVOKE site.

## Conflict policy

- `before` / `after` / `around` / `modifyArg` / `modifyReturn` **chain** across mods (ordered by declared priority).
- `replace` is **single-winner** — two mods replacing the same target produce a **load-time CONFLICT ERROR**. Never a silent override, and never a first-one-wins race decided by load order.
- **`around` semantics (review correction):** defined as **nesting by priority** — `proceed()` invokes the next wrapper in the chain or the original; short-circuit propagation is documented. Because an `around` that short-circuits can suppress every wrapper beneath it, mods that may do so should declare `may-short-circuit` and others can detect the incompatibility at load.

## Physics model — execute INSIDE the worker (review correction)

Physics is the deepest, determinism-critical integration — **not** a trivial event. Two models were considered; only one is acceptable:

- ❌ **Main-thread round-trip** (worker → main each tick → run callback → post state back): adds a cross-thread round-trip to *every* tick, **destroys deterministic replay** (main-thread timing becomes input-dependent), and adds latency to a 60 fps sim.
- ✅ **Compile physics-context mods INTO the transformed sim-worker.** Physics mods are bundled into the worker (worker-safe, no DOM, deterministically replayable), auto-marked `vanillaSafe=false`, and **statically lint-rejected** if they call non-deterministic APIs (`Date.now`, `Math.random`, `performance.now`, `crypto.getRandomValues`, `fetch`). Main-thread mods may **observe** physics state but may not influence the tick without leaving ranked play.

The Bullet WASM core (`polytrack_physics.wasm`) is opaque to all JS techniques; physics is exposed only via the stable JS glue + worker message protocol (`getCarState`/`setCarState`/`wheel*`), never by patching WASM.

## HMR (honest scope — review correction)

Vite HMR applies to **Tier-1 event/registry mods** and to **runtime-rebindable mixin handler bodies**. It does **not** apply to AST **injection-point** edits (you cannot "un-insert" code already evaluated in the game's closures) — those need a transform+reload. Offer a "soft reload" (re-eval just the mod module + re-run hooks) for the common case, and a full transform-reload for structural mixin edits.
