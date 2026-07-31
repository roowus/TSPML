# Roadmap

> Each milestone is independently useful. Status is tracked here and in [progress.md](./progress.md).

| Milestone | Status | Outcome |
|---|---|---|
| **M0 — Reset & docs-first foundation** | ✅ Done | Clean monorepo; full research/design/API/project docs. |
| **M1 — De-risk spike + loader core** | ✅ Done | **Spike: GO** (game-logic match 0.85, semi-automated — [report](../research/mappings-drift-spike.md)). **Loader core:** manifest parse/validate + semver + topo-sort/cycle/conflict + entrypoint invocation with error isolation, **47 tests passing**. `breaks` refinement tracked in issue #6. |
| **M2 — Mappings v1 (manual) + portal injection MVP** | Planned | Hand-curated symbol map (cwcinc seed); Vercel portal shell + `/api/proxy` + service worker that fetches the **live** game and runs it (no transforms yet) — a "plays the real game modded" proof of concept. |
| **M3 — AST transform + resolver** | Planned | Babel transforms resolved via mappings; **fail-closed** on hash mismatch; runtime-fallback locator tiers; per-mod compatibility report; IndexedDB bundle-hash caching. |
| **M4 — Event bus + API bridge (Tier 1)** | Planned | physics (in-worker)/render/track/input/checkpoint/network events; registries (blocks/cars/audio/tracks/ui/settings/keybinds). |
| **M5 — Mixin system (Tier 2)** | Planned | `before/after/around/replace/modifyArg` with defined chaining + single-winner `replace` + load-time conflict errors. |
| **M6 — Safety (warn-only) + determinism lint** | Planned | vanillaSafe classification + labels + risk warnings; determinism lint (warnings); consented-advisory capability prompts. |
| **M7 — Dev harness + scaffold + types** | Planned | Vite dev server with **scoped** HMR; `npx create-tspml-mod`; `@tspml/api`; VS Code extension. |
| **M8 — Online/origin handling** | Planned | Proxy Origin/Referer forwarding for leaderboard/multiplayer; validate online features from the portal origin; extension/userscript fallback if blocked. |
| **M9 — Auto-mappings pipeline** | Planned *(gated on M1 success)* | webcrack+wakaru+structural-diff+anchor matching; regen candidate map per release; human-review diff tool. |
| **M10 — PML narrow importer + registry + polish** | Planned | skins/audio/blocks importer; registry (Cloudflare Workers + D1) + `tspml publish`; docs completion; 1.0. |

## Go/no-go gate (M1)

The entire "update-resilient mappings moat" rests on whether JS minified bundles can be structurally matched across versions. **Before building M2+ on it**, M1 runs a controlled experiment (webcrack/wakaru on 0.6.0 vs 0.6.2, match modules by stable anchors) and publishes per-class match rates:

- **≥ ~80% game-logic match** → proceed with the auto-pipeline (M9) and the "resilient" positioning.
- **< ~80%** → fall back to an **honestly-declared human-curated map** (per-update cost ≈ PML) and reposition TSPML as "better DX + better failure diagnostics, same per-update map cost as PML" until a better identity scheme (call-graph fingerprinting, string-literal co-occurrence) is found.
