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
- `api.tracks` — register/override community tracks
- `api.ui` — HUD widgets/panels
- `api.keybinds` / `api.settings` — where `getSetting` returns **typed** values (fixes PML's always-string wart)

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
