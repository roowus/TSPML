# TSPML — The Second Poly Mod Loader

A versatile-yet-simple mod loader for **[PolyTrack](https://www.kodub.com/apps/polytrack)**, the online 3D racing game — inspired by [Fabric](https://fabricmc.net/) for Minecraft. An incumbent loader ([PolyModLoader](https://polymodloader.com/)) already exists; TSPML aims to be what Fabric is to Minecraft modding.

**What's actually different:** mods target **stable names**, not the minified bundle, and a
`bundleHash` gate **fails closed** — when the game updates, every surface degrades to vanilla
rather than silently patching the wrong code. That failure mode is the point. PML is a capable,
actively-maintained loader with users, mods, and mobile support, and it is **ahead of us on
physics** ([#43](https://github.com/roowus/TSPML/issues/43)). An honest comparison, verified
against their source at `v0.6.2-2`, is in
[`docs/research/pml-api-and-moat-reassessment.md`](./docs/research/pml-api-and-moat-reassessment.md).

> **Status: M5 complete + M6/M7 started — the portal plays a transformed, modded PolyTrack with a real mod loaded.**
>
> ✅ 6 Tier-1 events fire inside the running game (`car.control`, `car.created`, `race.started`, `track.afterLoad` + `checkpoint.passed`/`race.finished` wired).
> ✅ Keybinds registry (`api.keybinds.register`).
> ✅ **Real mod loading** — `@tspml/loader` loads a mod package whose entrypoint subscribes to events + registers keybinds.
> ✅ **Mod-declared mixins** — mods author Tier-2 patches (`before`/`after`/`around`/`replace`) targeting **stable names** resolved fail-closed via `@tspml/mappings`.
> ✅ Warn-only safety classifier (`classifySafety`).
> ✅ `create-tspml-mod` scaffold CLI.
> ✅ `@tspml/api` publish-ready (types for modder autocomplete).
>
> **148 unit tests, CI green.** All headlessly verified via Playwright. See [`docs/project/progress.md`](./docs/project/progress.md) + [`docs/research/portal-browser-test-findings.md`](./docs/research/portal-browser-test-findings.md).

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

**Three layers (Fabric analog):**
1. **Loader core** (clean TS) — discovers mod packages, parses `mod.json`, semver-resolves, topo-sorts, invokes entrypoints with per-mod error isolation. Includes the warn-only safety classifier.
2. **Mappings file** (the Yarn analog) — versioned JSON, one per PolyTrack build, mapping stable names (`Car`, `Car.controlCar`) → concrete `TargetSpec` (anchor + selector). Fail-closed on bundle-hash mismatch.
3. **API bridge** (loader-owned) — the runtime `EventBus` + `Keybinds` registry, exposed to mods as `api.events` + `api.keybinds`.

See [`docs/design/architecture.md`](./docs/design/architecture.md).

## Key decisions

- **Delivery:** a Vercel-hosted portal website that plays the modded game via a CORS proxy + service worker; browser extension as the resilient fallback (for online features blocked by `vps.kodub.com`'s bot protection).
- **Fairness:** warn-only (`classifySafety` classifies + surfaces risks; never hard-blocks).
- **Language:** TypeScript + a publishable `@tspml/api` types package.
- **PML compat:** narrow importer (skins/audio/blocks) — no mixin emulator.

See [`docs/project/decision-log.md`](./docs/project/decision-log.md) (ADR-001 through ADR-013).

## Repository layout

```
docs/          research, design, API specs, project, contributing (docs-first)
source/        loader, api-bridge, transform, mappings, portal, extension, shared
tooling/       mappings-pipeline, create-tspml-mod, typecheck, cli
environments/  dev-harness, demo-mods (@tspml/demo-hud)
packages/      @tspml/api (publishable types)
```

## Documentation

➡️ **Start at [`docs/README.md`](./docs/README.md).**

## ⚠️ Disclaimers

- **Not affiliated with, endorsed by, or associated with Kodub or PolyTrack.** PolyTrack is © its developer.
- TSPML is a fan-made modding tool. It fetches the user's own live game copy and ships **only** loader + mappings metadata — it never redistributes the game. Running a modified client and forwarding origin headers are **Terms-of-Service gray areas**; TSPML keeps a takedown-compliance posture. See [`docs/design/safety-and-fairness.md`](./docs/design/safety-and-fairness.md).
- **Anti-cheat is server-side and still maturing.** Physics/speed mods can break deterministic-replay leaderboards; using them risks leaderboard bans. TSPML labels these mods but (by design) does not hard-block uploads.

## License

MIT (our code). The PolyTrack game and its assets are **not** ours and are not covered by this license.
