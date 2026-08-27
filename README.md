# TSPML — The Skibiti PolyModLoader

A mod loader for **[PolyTrack](https://www.kodub.com/apps/polytrack)**, the online 3D racing game. Write a mod, paste it into the portal, and play the game with it running.

Mods are written against a stable API and declarative mixins rather than against the minified game bundle. A mod refers to `Car` and `Car.controlCar`, not to whatever one-letter name the minifier picked this week. Those stable names are resolved through a per-build mappings file that is pinned to a bundle hash, so when PolyTrack updates one of two things happens: the mappings still match and mods keep working, or they do not match and every affected surface degrades to vanilla. There is no third case where a mod quietly patches the wrong function. That failure mode is the whole design.

> **Status: live.** The portal at [tspml.vercel.app](https://tspml.vercel.app) is a launcher — an instance grid, a curated registry, and the play surface behind it — that plays a transformed, modded PolyTrack end to end; docs at [tspml-docs.vercel.app](https://tspml-docs.vercel.app).
>
> - **Launcher:** named instances (a name, a picture, a game version, which mods are switched on) over ONE shared mod library; `/browse` for the curated registry; `/play?instance=<id>` mounts the game.
> - All 7 Tier-1 events fire inside the running game (`car.control`, `car.created`, `race.started`, `checkpoint.passed`, `checkpoint.respawn`, `race.finished`, `track.afterLoad`).
> - Keybinds, tracks, and audio registries (keybinds survive game-frame reloads).
> - Real mod loading: paste a mod, import it by URL, or import a modpack (a `.txt` of links) from the play page's Mods menu; in-play Browse installs into the running game without ending your run.
> - Mod-declared mixins: Tier-2 patches (`before`/`after`/`around`/`replace`/`modifyArg`/`modifyReturn`/`modifyConstant`) targeting **stable names** resolved fail-closed via `@tspml/mappings`, with `__TSPML_PARAMn__` param-ordinal placeholders so injects survive re-minification.
> - Physics patching (#43): a mod's `physics.json` rewrites constants in the compiled wasm binary, verified per-load by the service worker.
> - **PolyModLoader (PML) mods install and run** through a compatibility adapter: lifecycle hooks, keybinds, settings and `getMod` work; mixins are **refused per call with a reason** and the mod keeps running. See [PML compatibility](./docs/concepts/pml-compatibility.md).
> - **`/browse` lists all 20 mods from PML's own registry** alongside the native ones, each tagged with the loader that runs it (`tspml`/`pml`) — a derived chip that is also a real filter. Summaries were written from each mod's source (PML's registry carries none), and the thirteen with no 0.6.2 build carry a derived "no build for this version" advisory (never a gate — semver ranges honoured).
> - Reload re-fetches URL-imported mods; share links carry mod URLs (never code) behind a confirm-first prompt.
> - Warn-only safety classifier (`classifySafety`); `create-tspml-mod` scaffold CLI; `@tspml/api` types package.
>
> **1,301 unit tests + 12 CI smokes, all green.** Headlessly verified against the real game via Playwright — including a fixture PML mod imported from its own CDN layout and run end to end. See [`docs/project/progress.md`](./docs/project/progress.md).

## Quick start (create a mod)

```bash
git clone https://github.com/roowus/TSPML.git
node TSPML/tooling/create-tspml-mod/bin/create-tspml-mod.mjs my-cool-mod
cd my-cool-mod
pnpm install && pnpm build
```

This scaffolds a working starter mod (mod.json + entrypoint + mixin) that builds
with nothing but `typescript` — the generated project has no dependency on this
repo or on any unpublished package. See [`tooling/create-tspml-mod/`](./tooling/create-tspml-mod/).

> **Not `npx create-tspml-mod` yet.** The CLI is not published to npm, so that
> command 404s — the clone above is the working equivalent (#19). The one-liner
> lands when the package ships.

## How it works

```
MODS ──▶ stable API (events + keybinds) / mixin escape hatch
            │  target STABLE names only (resolved via @tspml/mappings, fail-closed)
       Loader core (@tspml/loader) + dependency resolution + safety classification
            │  resolves stable → concrete locators via:
       API bridge (@tspml/api-bridge: EventBus + Keybinds) + MAPPINGS FILE (per build)
            │  AST transform (@tspml/transform: before/after/around/replace/...)
       PolyTrack (fetched live through the portal proxy, never redistributed)
```

**Three layers:**
1. **Loader core** (clean TS) — discovers mod packages, parses `mod.json`, semver-resolves, topo-sorts, invokes entrypoints with per-mod error isolation. Includes the warn-only safety classifier.
2. **Mappings file** — versioned JSON, one per PolyTrack build, mapping stable names (`Car`, `Car.controlCar`) → concrete `TargetSpec` (anchor + selector). Fail-closed on bundle-hash mismatch.
3. **API bridge** (loader-owned) — the runtime `EventBus` + `Keybinds` registry, exposed to mods as `api.events` + `api.keybinds`.

See [`docs/design/architecture.md`](./docs/design/architecture.md).

## Key decisions

- **Delivery:** a Vercel-hosted portal website that plays the modded game via a CORS proxy + service worker; browser extension as the resilient fallback (for online features blocked by `vps.kodub.com`'s bot protection).
- **Fairness:** warn-only (`classifySafety` classifies + surfaces risks; never hard-blocks).
- **Language:** TypeScript + a publishable `@tspml/api` types package.
- **Importing mods from other loaders:** a PML compatibility adapter that carries lifecycle hooks, keybinds, settings and `getMod` across. Mixins are **not** emulated — they are refused per call, by name, and the rest of the mod keeps running.

See [`docs/project/decision-log.md`](./docs/project/decision-log.md) (ADR-001 through ADR-018).

## Repository layout

```
docs/          research, design, API specs, project, contributing (docs-first)
source/        loader, api-bridge, transform, mappings, portal, shared,
               extension (gate-clear slice only — bundle rewriting not implemented)
tooling/       mappings-pipeline, create-tspml-mod, typecheck,
               cli (reserved name, NOT implemented)
environments/  dev-harness (Vite dev server + smokes), demo-mods (@tspml/demo-hud, …)
packages/      @tspml/api (publishable types)
tests/ scripts/  empty on purpose — see their READMEs (#30)
```

## Documentation

➡️ **Start at [`docs/README.md`](./docs/README.md).**

## ⚠️ Disclaimers

- **Not affiliated with, endorsed by, or associated with Kodub or PolyTrack.** PolyTrack is © its developer.
- TSPML is a fan-made modding tool. It fetches the user's own live game copy and ships **only** loader + mappings metadata — it never redistributes the game. Running a modified client and forwarding origin headers are **Terms-of-Service gray areas**; TSPML keeps a takedown-compliance posture. See [`docs/design/safety-and-fairness.md`](./docs/design/safety-and-fairness.md).
- **Anti-cheat is server-side and still maturing.** Physics/speed mods can break deterministic-replay leaderboards; using them risks leaderboard bans. TSPML labels these mods but (by design) does not hard-block uploads.

## License

MIT (our code). The PolyTrack game and its assets are **not** ours and are not covered by this license.
