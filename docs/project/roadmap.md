# Roadmap

> Each milestone is independently useful. Status is tracked here and in [progress.md](./progress.md).

## Current status (2026-08-01)

The portal **plays a transformed, modded PolyTrack end-to-end** — a real mod loads, subscribes to 6 Tier-1 events, registers a keybind, declares a mappings-resolved mixin, and is safety-classified. All headlessly verified. The **M9 regen/diff/verify pipeline** turns a version bump into a one-command human-in-the-loop review. 185 unit tests, CI green.

| Milestone | Status | Outcome |
|---|---|---|
| **M0 — Reset & docs-first foundation** | ✅ Done | Clean monorepo; full research/design/API/project docs. |
| **M1 — De-risk spike + loader core** | ✅ Done | **Spike: GO** (game-logic match 0.85, semi-automated). **Loader core:** manifest/semver/topo-sort/entrypoint, 47→53 tests (incl. safety classifier). |
| **M2 — Mappings v1 + portal MVP** | ✅ Done | 56-entry 0.6.2 map + **fail-closed resolver** (20→25 tests). Portal: proxy + SW + gate neutralized — **plays end-to-end**. |
| **M3 — AST transform + resolver** | ✅ Done | All 7 mixin ops, fail-closed on hash, source maps, replace conflict, re-parse gate. 31→33 tests (chaining verified). |
| **M4 — Event bus + API bridge (Tier 1)** | ✅ Done | 6 Tier-1 events (car.control/created, race.started, track.afterLoad, checkpoint.passed, race.finished); keybinds registry; **real mod loading** (loader→mod→api→event). |
| **M5 — Mixin system (Tier 2)** | ✅ Done | **Mod-declared mixins** (mod.json → descriptor); chaining + `replace` single-winner conflict; **mappings-resolved stable-name targeting** (the moat pays off). |
| **M6 — Safety (warn-only) + determinism lint** | ✅ Classifier + surfaced | `classifySafety` (warn-only, 6 tests) + **surfaced in the portal** (sidebar safety indicator). Remaining: determinism lint (static analysis of mixin targets), capability consent prompts. |
| **M7 — Dev harness + scaffold + types** | 🚧 Scaffold + API done | `create-tspml-mod` CLI (one-command scaffolding); `@tspml/api` publish-ready (types for modder autocomplete). Remaining: Vite dev harness (fast mod HMR). |
| **M8 — Online/origin handling** | 🚧 Blocked | Root cause found: `vps.kodub.com` is **bot-protected** (bot/TLS-fingerprint drop, not just origin). The **extension path** (real browser on kodub.com origin) is the resilient fix. |
| **M9 — Auto-mappings pipeline** | ✅ Done | `regen.mjs` orchestrates **fetch → unpack → gen-map → diff → verify-targets**: a one-command candidate-map regen + human-review report (`*.candidate.json`, never clobbers committed). Pure `diff`/`verify-targets` logic unit-tested (26 tests); validated end-to-end on real 0.6.0/0.6.2 bundles. |
| **M10 — PML narrow importer + registry + polish** | ⏳ Blocked | Blocked on content registries (car-styles/settings not viable — frozen catalogs; audio #11, custom-tracks #12 pending). The importer depends on at least one working content registry. |

## Open follow-up issues

| # | Title | Scope |
|---|---|---|
| [#10](https://github.com/roowus/TSPML/issues/10) | Player-only event filtering | race.started/checkpoint/finish fire per-car (player+ghosts); needs an isReplay accessor. |
| [#11](https://github.com/roowus/TSPML/issues/11) | Audio registry | Override clips via the game's `load()`; needs an instance-capture transform. |
| [#12](https://github.com/roowus/TSPML/issues/12) | Custom-tracks registry | Re-investigate the import-by-code path. |
| [#13](https://github.com/roowus/TSPML/issues/13) | Priority-ordered chaining | The `priority` field is declared but unused; per-op runtime ordering is subtle. |

## Go/no-go gate (M1) — PASSED

The "update-resilient mappings moat" thesis was validated: JS minified bundles CAN be structurally matched across versions (game-logic match **0.85** across 0.6.0→0.6.2). The auto-pipeline (M9) proceeds as **semi-automated, human-in-the-loop** (~85% auto, ~15% human review). The "fully automatic within hours" overclaim is retired.
