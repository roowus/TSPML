# Roadmap

> Each milestone is independently useful. Status is tracked here and in [progress.md](./progress.md).

## Current status (2026-08-03)

The portal **plays a transformed, modded PolyTrack end-to-end** — a real mod loads, subscribes to 6 Tier-1 events, registers a keybind, declares a mappings-resolved mixin, and is safety-classified. All headlessly verified. The **M9 regen/diff/verify pipeline** turns a version bump into a one-command human-in-the-loop review, and the **M7 dev harness** turns mod iteration into edit → instant (scoped HMR against the live game). **Two content registries** now work on the flagship surface: `api.tracks` puts a mod's track in the player's real Custom tracks list ([#12](https://github.com/roowus/TSPML/issues/12)) **in the portal**, not just the harness ([#36](https://github.com/roowus/TSPML/issues/36)), and `api.audio` replaces the game's real sounds ([#11](https://github.com/roowus/TSPML/issues/11)) — both verified by committed headless smokes against the live game. Together they unblock M10. The two surfaces' injections come from one package, [`@tspml/shared`](../../source/shared) ([#34](https://github.com/roowus/TSPML/issues/34)), so they can no longer drift — and #11 rode the *same* capture patch as #12, needing no new anchor or locator work. 247 unit tests, CI green.

| Milestone | Status | Outcome |
|---|---|---|
| **M0 — Reset & docs-first foundation** | ✅ Done | Clean monorepo; full research/design/API/project docs. |
| **M1 — De-risk spike + loader core** | ✅ Done | **Spike: GO** (game-logic match 0.85, semi-automated — [report](../research/mappings-drift-spike.md)). **Loader core:** manifest/semver/topo-sort/entrypoint, 47→53 tests (incl. safety classifier). |
| **M2 — Mappings v1 + portal MVP** | ✅ Done | 56-entry 0.6.2 map + **fail-closed resolver** (20→25 tests). Portal: proxy + SW + gate neutralized — **plays end-to-end**. |
| **M3 — AST transform + resolver** | ✅ Done | All 7 mixin ops, fail-closed on hash, source maps, replace conflict, re-parse gate. 31→33 tests (chaining verified — spike [report](../research/transform-spike.md), ADR-011). |
| **M4 — Event bus + API bridge (Tier 1)** | ✅ Done | 6 Tier-1 events (car.control/created, race.started, track.afterLoad, checkpoint.passed, race.finished); keybinds registry; **real mod loading** (loader→mod→api→event). |
| **M5 — Mixin system (Tier 2)** | ✅ Done | **Mod-declared mixins** (mod.json → descriptor); chaining + `replace` single-winner conflict; **mappings-resolved stable-name targeting** (the moat pays off). |
| **M6 — Safety (warn-only) + determinism lint** | ✅ Classifier + surfaced | `classifySafety` (warn-only, 6 tests) + **surfaced in the portal** (sidebar safety indicator). Remaining: determinism lint (static analysis of mixin targets), capability consent prompts. |
| **M7 — Dev harness + scaffold + types** | ✅ Done | `create-tspml-mod` CLI (one-command scaffolding); `@tspml/api` publish-ready (types for modder autocomplete); **`@tspml/dev-harness`** — Vite dev server that proxies + transforms the real game in-process (no service worker) and **hot-swaps the mod entrypoint on save** while the game keeps running. Headlessly verified (game boots, gate clears, Tier-1 events fire, mod hot-reloads, game survives). |
| **M8 — Online/origin handling** | 🚧 Blocked | Root cause found: `vps.kodub.com` is **bot-protected** (bot/TLS-fingerprint drop, not just origin). The **extension path** (real browser on kodub.com origin) is the resilient fix. |
| **M9 — Auto-mappings pipeline** | ✅ Done | `regen.mjs` orchestrates **fetch → unpack → gen-map → diff → verify-targets**: a one-command candidate-map regen + human-review report (`*.candidate.json`, never clobbers committed). Pure `diff`/`verify-targets` logic unit-tested (26 tests); validated end-to-end on real 0.6.0/0.6.2 bundles. |
| **M10 — PML narrow importer + registry + polish** | 🚧 Unblocked | The importer needed at least one working **content** registry; it now has **two**: `api.tracks` ([#12](https://github.com/roowus/TSPML/issues/12) — custom tracks by import code) and `api.audio` ([#11](https://github.com/roowus/TSPML/issues/11) — sound overrides, superseding PML's `soundManager`), both verified against the live game. Car-styles/settings remain non-viable (frozen catalogs). |

## Open follow-up issues

| # | Title | Scope |
|---|---|---|
| [#10](https://github.com/roowus/TSPML/issues/10) | Player-only event filtering | race.started/checkpoint/finish fire per-car (player+ghosts); needs an isReplay accessor. |
| [#25](https://github.com/roowus/TSPML/issues/25) | CI doesn't run the headless smokes | Three committed smokes (`smoke`, `smoke:tracks`, `smoke:audio`) prove the registries against the real game, but only run locally. |

Closed since the last update: [#11](https://github.com/roowus/TSPML/issues/11) (`api.audio` —
sound overrides, shipped **not** via the game's `load()` as the issue proposed: that call
throws `"Cannot add resources after loading is complete"` post-boot, so the registry shadows
the manager's buffer lookup instead), [#36](https://github.com/roowus/TSPML/issues/36)
(`api.tracks` now attaches in the portal, verified by a committed smoke against the live
game) and [#34](https://github.com/roowus/TSPML/issues/34) (both injections live in
[`@tspml/shared`](../../source/shared); the extraction also fixed the drift it was about —
the portal had been missing the two track-capture patches entirely).

> Not exhaustive — the full backlog is in [GitHub issues](https://github.com/roowus/TSPML/issues)
> (18 open, mostly small docs/API-drift fixes). This table is the subset that gates a
> milestone.

## Go/no-go gate (M1) — PASSED

The "update-resilient mappings moat" thesis was validated: JS minified bundles CAN be structurally matched across versions (game-logic match **0.85** across 0.6.0→0.6.2). The auto-pipeline (M9) proceeds as **semi-automated, human-in-the-loop** (~85% auto, ~15% human review). The "fully automatic within hours" overclaim is retired.
