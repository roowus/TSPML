# TSPML — The Second Poly Mod Loader

A versatile-yet-simple mod loader for **[PolyTrack](https://www.kodub.com/apps/polytrack)**, the online 3D racing game — inspired by [Fabric](https://fabricmc.net/) for Minecraft. An incumbent loader ([PolyModLoader](https://polymodloader.com/)) already exists; TSPML aims to be what Fabric is to Minecraft modding.

> **Status: M3 complete — transform run-validated in a browser.** The loader, mappings, AST-transform pipeline, and portal (proxy + service worker) are all built and unit-tested (**115 tests**, CI green); a transformed PolyTrack bundle is proven to actually boot in headless Chromium. The portal does **not yet reach playable gameplay** — PolyTrack's own "unofficial version" origin gate and a track-load network path still block it (issues #7–#9). Next: **M4** (neutralize the origin gate + event bus + API bridge). See [`docs/project/progress.md`](./docs/project/progress.md) and [`docs/research/portal-browser-test-findings.md`](./docs/research/portal-browser-test-findings.md).

## Why TSPML?

PolyModLoader (PML) is brittle: it redistributes the whole copyrighted game, hooks via `Function.toString()` + literal-substring token matching + `eval()`, hardcodes webpack-mangled identifiers, has no sandboxing, no tests, and breaks on every PolyTrack release. TSPML copies **Fabric's layering** instead — concentrating all version-coupling in two maintained artifacts (a **mappings file** + an **API bridge**) so ordinary mods target stable names and survive game updates. Full breakdown: [`docs/research/pml-shortcomings-and-tspml-improvements.md`](./docs/research/pml-shortcomings-and-tspml-improvements.md).

## How it works (in one diagram)

```
MODS ──▶ stable API (events + registries) / mixin escape hatch
            │  target STABLE names only
       Loader core (clean TS) + dependency resolution
            │  resolves stable → concrete via:
       API bridge (version-coupled) + MAPPINGS FILE (per build)
            │  AST transform + runtime patch
       PolyTrack (fetched live, never redistributed)
```

See [`docs/design/architecture.md`](./docs/design/architecture.md).

## Key decisions

- **Delivery:** a Vercel-hosted portal website (like `web.polymodloader.com`) that plays the modded game via a CORS proxy; browser extension + userscript as resilient fallbacks.
- **Fairness:** warn-only (label physics/multiplayer mods; disclose ban risk).
- **Language:** TypeScript + a published `@tspml/api` types package.
- **PML compat:** narrow importer (skins/audio/blocks) — no mixin emulator.

See [`docs/project/decision-log.md`](./docs/project/decision-log.md).

## Repository layout

```
docs/        research, design, API specs, project, contributing (docs-first)
source/      loader, api-bridge, transform, mappings, portal, extension, shared
tooling/     mappings-pipeline, create-tspml-mod, cli
environments/  dev-harness, demo-mods
packages/    @tspml/api types
scripts/  tests/
```

## Documentation

➡️ **Start at [`docs/README.md`](./docs/README.md).**

## ⚠️ Disclaimers

- **Not affiliated with, endorsed by, or associated with Kodub or PolyTrack.** PolyTrack is © its developer.
- TSPML is a fan-made modding tool. It fetches the user's own live game copy and ships **only** loader + mappings metadata — it never redistributes the game. Running a modified client and forwarding origin headers are **Terms-of-Service gray areas**; TSPML keeps a takedown-compliance posture. See [`docs/design/safety-and-fairness.md`](./docs/design/safety-and-fairness.md).
- **Anti-cheat is server-side and still maturing.** Physics/speed mods can break deterministic-replay leaderboards; using them risks leaderboard bans. TSPML labels these mods but (by design) does not hard-block uploads.

## License

MIT (our code). The PolyTrack game and its assets are **not** ours and are not covered by this license.
