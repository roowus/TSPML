# Architecture

> TSPML copies **Fabric's layering**, not PML's mechanics. The thesis: concentrate *all* version-coupling in two maintained artifacts (the **mappings file** + the **API bridge**) so ordinary mods target stable names and ride through PolyTrack updates without recompilation.

> **Implementation status (M4-M5 ✅, M6-M9 🚧):** the layered design below is now **proven end-to-end** — 6 Tier-1 events fire inside the running game, mods load + subscribe, mod-declared mixins target stable names resolved fail-closed via the mappings, and a warn-only safety classifier labels mods. The portal plays a transformed, modded PolyTrack headlessly verified. See [progress.md](../project/progress.md) + [roadmap.md](../project/roadmap.md).

## Layered design

```
                       ┌─────────────────────────────────────────────┐
   MODS  ────────────▶ │  Tier 1: stable API (events + registries)    │  ~90% of mods live here
                       │  Tier 2: declarative mixins (escape hatch)   │  power-user / deep mods
                       └──────────────────────┬──────────────────────┘
                                              │  target STABLE names only
                       ┌──────────────────────▼──────────────────────┐
                       │  Loader core (clean TS, zero game coupling)  │  discover / parse mod.json
                       │  + dependency resolution (semver, topo-sort) │  / resolve / order / entrypoints
                       └──────────────────────┬──────────────────────┘
                                              │  resolves stable → concrete via:
                       ┌──────────────────────▼──────────────────────┐
                       │  API bridge (loader-owned, version-coupled)  │  wires events/registries to
                       │        +        MAPPINGS FILE (per build)    │  real game functions
                       └──────────────────────┬──────────────────────┘
                                              │  AST transform + runtime patch
                       ┌──────────────────────▼──────────────────────┐
                       │  PolyTrack (minified webpack bundles + WASM) │  fetched live, never redistributed
                       └─────────────────────────────────────────────┘
```

## The three layers

1. **Loader core** (`source/loader`) — clean TS, no minification coupling. Discovers mod packages, parses `mod.json`, resolves semver dependencies (`depends`/`recommends`/`suggests`/`conflicts`/`breaks` — `breaks` soft-disables the declaring mod rather than aborting, #6), topologically orders mods (cycle detection + explicit conflict errors), and invokes entrypoints `mod.default(api, game)`. This is a near 1:1 port of Fabric Loader and is the most transferable part.

2. **Mappings file** (`source/mappings`) — the Yarn/Intermediary analog and TSPML's moat. A versioned JSON, one per PolyTrack build, mapping stable names (`Car.controlCar`, `Track.afterLoad`, `physics.postStep`) → concrete locators (`exportRef` / `prototypeFn` / `callExpression` anchor). Mods target **stable names only**; the resolver maps stable → concrete at bind time. See [mappings-system.md](./mappings-system.md).

3. **API bridge** (`source/api-bridge`) — the loader-owned, *version-coupled* layer. A small set of maintained patches wiring the stable EventEmitter + registry surface to real game functions. **When PolyTrack updates, only this layer + the mappings file change; mods keep working.** This is exactly Fabric API's "one internal mixin per concern" principle.

## Hook system (two tiers)

- **Tier 1 — event bus + registries:** `api.events.on('physics.postStep', cb)`, `api.blocks.register(...)`, etc. Wired by the bridge; mods never see minified code. ~90% of mods.
- **Tier 2 — declarative mixin surgery (escape hatch):** JSON mixin descriptors (`before`/`after`/`around`/`replace`/`modifyArg`/…) targeting **stable names**, applied at transform time (not a runtime `api.mixin` object). Chaining is priority-ordered (`sortPatchesByPriority`, stable within equal priority); `replace` is single-winner with a load-time conflict error.

See [hook-system.md](./hook-system.md).

## Delivery surfaces

- **Flagship:** a Vercel-hosted **portal** (`source/portal`) — browse/curate mods, "Play" loads the modded game through a service worker + `/api/proxy` that fetches the live game and forwards Origin/Referer server-side.
- **Secondary (resilient fallback):** an MV3 **browser extension** (`declarativeNetRequest`, network-layer rewrite, CSP-immune) and a **userscript**, both running on the real `kodub.com` origin.

See [injection-and-delivery.md](./injection-and-delivery.md).

## Guiding principles (from Fabric)

- **Concentrate fragility.** Only the bridge + mappings are version-coupled; everything else rides through updates.
- **Events for everyone, mixins for power users.** Route ~90% of mods to the stable API; reserve surgical edits for the few that need them.
- **Fail loudly, fail small.** Per-hook `required` flags + typed `ResolutionFailure` + a per-mod compatibility report. Never a boot-abort (PML's "Token not found"), never a silent no-op (PML's ambiguous-token mis-target). **Fail-closed** on stale maps.
- **Ship metadata, not the game.** Fetch the user's live copy; transform in place; never redistribute the bundle.
- **Keep the core tiny and modular.** Resist hand-modding every internal — that is the Forge-ism that slows updates.
