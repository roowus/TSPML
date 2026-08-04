# Hook system

> Two tiers, exactly mirroring Fabric's "events for everyone, mixins for power users" split.

## Tier 1 — event bus + registries (preferred; ~90% of mods)

A stable `EventEmitter` wired by the loader-owned API bridge to real game functions. Mods do `api.events.on('physics.postStep', cb)` and never see minified code. Registration/unregistration rebuilds an array-backed invoker (Fabric's `ArrayBackedEvent`) so dispatch is lock-free and hot-path fast.

**Lifecycle:** `loader.preInit(api)` (before any game code; only place for global hooks), `loader.init(api)`, `loader.ready()` (main menu visible), `loader.onUnload()` (cleanup — fixes PML's missing-cleanup bug), `worker.init(api)`/`worker.message` (worker-context mods).

**Events (grounded in real deobfuscated symbols):**
- `physics.preStep` / `physics.postStep` (wired into the sim-worker tick — **see physics model below**)
- `render.preRender` / `render.postRender` (Three.js render loop)
- `track.beforeLoad` / `track.afterLoad` / `track.unload`
- `car.created` / `car.stateUpdate` / `car.styleChanged`
- `checkpoint.passed` / `checkpoint.respawn`
- `race.started` / `race.finished`
- `input.keyDown` / `input.keyUp` (clean stream, self-gated — replaces PML's fires-on-every-match keybind surface)
- `ui.render`
- `network.message` / `network.connect` / `network.disconnect` (capability-gated)

**Registries (Fabric Registry analog; stable, versioned):**
- `api.blocks` — custom track pieces (supersedes `pmlapi.editorExtras`; grounded in `PartObject`/`trackParts`)
- `api.cars` — car skins/styles (`getCarStyle`/`setCarStyle`/`carColors`/`VisualCar`)
- `api.audio` — `registerSound(name,[url])` / `playSound(name,vol)` (supersedes `pmlapi.soundManager`)
- `api.tracks` — register custom tracks by import code (**implemented**, [#12](https://github.com/roowus/TSPML/issues/12); see *instance capture* below)
- `api.ui` — HUD widgets/panels
- `api.keybinds` / `api.settings` — where `getSetting` returns **typed** values (fixes PML's always-string wart)

### Instance capture — reaching past the bootstrap wall

Some of the game's most useful objects are **not in a locatable module**. The webpack
module map ends at a fixed bundle offset; the code past it (the bootstrap) constructs
long-lived managers — the track store, the audio manager — that the module locator
cannot see. That wall is why [#11](https://github.com/roowus/TSPML/issues/11) (audio)
is hard.

The way through is to stop trying to locate the **class** and instead capture the live
**instance** from a caller that *is* a real module. A manager built in the bootstrap is
still *passed into* module-resident constructors, so a `before`-op patch on such a
constructor can read the parameter out into the bridge:

```
op: before, target: { anchor: <literals unique to the caller>, selector: { kind: 'method', name: 'constructor' } }
inject: capture(param_n)  →  window.__tspml.captureX(...)
```

This is how `api.tracks` gets the game's track store (constructor parameter of the
track-selection UI) and its codec (an export of the track-data module). Three
properties make it safe and worth generalizing:

- **Read-only.** The patch copies a reference out; it changes no game behavior, so a
  mis-target degrades to "capture never happens", not to corrupted state.
- **Late-binding by nature.** Capture happens when the game builds that UI, so the
  registry must start unbound and **queue** calls until `attach()`. `api.tracks` does
  exactly this, which is why a mod can register at `init`.
- **Anchor discipline still applies.** Anchors must be literals *unique* to the target
  module. Verified the hard way for the codec: `"PolyTrack2"` alone also matches
  another module, so that target needs four literals with `minHits: 4`. See
  [mappings-system.md](./mappings-system.md).

#### The capture window opens before the bridge exists

A capture patch runs whenever *its* module runs, and that can be **earlier than the
surface's bridge**. The two `api.tracks` captures straddle this: the track store is
handed over late (when the game builds its menu, comfortably after the host page's
`load` handler), but the **codec's module factory runs during bundle init** — before
`window.__tspml` exists.

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
it belongs in the stub too.

> The portal's committed smoke reports which captures arrived early
> (`scripts/smoke-tracks.mjs`); in practice it is the codec, empirically confirming the
> stub is load-bearing rather than defensive.

## Tier 2 — mixin surgery (escape hatch)

Declarative function surgery against **stable names**. Operations (most → least surgical — Fabric's guiding rule):

| Op | Fabric analog | Behavior |
|---|---|---|
| `before(target, handler)` | `@Inject` HEAD | run before; `handler(args)` |
| `after(target, handler)` | `@Inject` RETURN | run after; `handler(args, result)` |
| `around(target, handler)` | wrap | `handler(args, proceed)` → full control, can short-circuit |
| `modifyArg(target, callsite, i, fn)` | `@ModifyArg` | change one argument of an internal call (AST locator) |
| `modifyReturn(target, fn)` | — | transform return value |
| `replace(target, handler)` | `@Overwrite` | full overwrite; **last resort, single-winner** |

A `target` is a stable path resolved through the mappings file, e.g. `{ symbol: "Car.controlCar", point: "HEAD" }` or `{ symbol: "Car.update", invoke: "Car.applyPhysics" }` for an INVOKE site.

## Conflict policy (mirrors Fabric explicitly)

- `before` / `after` / `around` / `modifyArg` / `modifyReturn` **chain** across mods (ordered by declared priority).
- `replace` is **single-winner** — two mods replacing the same target produce a **load-time CONFLICT ERROR** (never a silent override, never PML's ambiguous-first-match).
- **`around` semantics (review correction):** defined as **nesting by priority** — `proceed()` invokes the next wrapper in the chain or the original; short-circuit propagation is documented. A short-circuitable `around` is more permissive than Fabric's single-winner redirects, so mods that may short-circuit should declare it (`may-short-circuit`) so others can detect incompatibility at load.

## Physics model — execute INSIDE the worker (review correction)

Physics is the deepest, determinism-critical integration — **not** a trivial event. Two models were considered; only one is acceptable:

- ❌ **Main-thread round-trip** (worker → main each tick → run callback → post state back): adds a cross-thread round-trip to *every* tick, **destroys deterministic replay** (main-thread timing becomes input-dependent), and adds latency to a 60 fps sim.
- ✅ **Compile physics-context mods INTO the transformed sim-worker.** Physics mods are bundled into the worker (worker-safe, no DOM, deterministically replayable), auto-marked `vanillaSafe=false`, and **statically lint-rejected** if they call non-deterministic APIs (`Date.now`, `Math.random`, `performance.now`, `crypto.getRandomValues`, `fetch`). Main-thread mods may **observe** physics state but may not influence the tick without leaving ranked play.

The Bullet WASM core (`polytrack_physics.wasm`) is opaque to all JS techniques; physics is exposed only via the stable JS glue + worker message protocol (`getCarState`/`setCarState`/`wheel*`), never by patching WASM.

## HMR (honest scope — review correction)

Vite HMR applies to **Tier-1 event/registry mods** and to **runtime-rebindable mixin handler bodies**. It does **not** apply to AST **injection-point** edits (you cannot "un-insert" code already evaluated in the game's closures) — those need a transform+reload. Offer a "soft reload" (re-eval just the mod module + re-run hooks) for the common case, and a full transform-reload for structural mixin edits.
