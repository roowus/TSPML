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
| **M6 — Safety (warn-only) + determinism lint** | ✅ Classifier + surfaced | `classifySafety` (warn-only) + `summarizeSafety` (the sidebar row reports the **whole enabled set** — risk is a maximum, not a sample) + **surfaced in the portal** (sidebar safety indicator). Remaining: determinism lint (static analysis of mixin targets), capability consent prompts. |
| **M7 — Dev harness + scaffold + types** | ✅ Done | `create-tspml-mod` CLI (one-command scaffolding); `@tspml/api` publish-ready (types for modder autocomplete); **`@tspml/dev-harness`** — Vite dev server that proxies + transforms the real game in-process (no service worker) and **hot-swaps the mod entrypoint on save** while the game keeps running. Headlessly verified (game boots, gate clears, Tier-1 events fire, mod hot-reloads, game survives). |
| **M8 — Online/origin handling** | 🚧 Blocked | Root cause found: `vps.kodub.com` is **bot-protected** (bot/TLS-fingerprint drop, not just origin). The **extension path** (real browser on kodub.com origin) is the resilient fix. |
| **M9 — Auto-mappings pipeline** | ✅ Done | `regen.mjs` orchestrates **fetch → unpack → gen-map → diff → verify-targets**: a one-command candidate-map regen + human-review report (`*.candidate.json`, never clobbers committed). Pure `diff`/`verify-targets` logic unit-tested (26 tests); validated end-to-end on real 0.6.0/0.6.2 bundles. |
| **M10 — Narrow importer + registry + polish** | 🚧 Unblocked | The importer needed at least one working **content** registry; it now has **two**: `api.tracks` ([#12](https://github.com/roowus/TSPML/issues/12) — custom tracks by import code) and `api.audio` ([#11](https://github.com/roowus/TSPML/issues/11) — sound overrides), both verified against the live game. Car-styles/settings remain non-viable (frozen catalogs). |
| **M11 — Physics WASM patching** | 🆕 Planned | **Capability gap ([#43](https://github.com/roowus/TSPML/issues/43)).** Physics tuning is a headline mod category, and anchor discipline cannot reach constants baked into `polytrack_physics.wasm` — those live in a compiled binary with no names to anchor to. The locator and writer now exist (see the mappings-pipeline README); what remains is the mod-facing plumbing. See [pml-api-and-moat-reassessment.md](../research/pml-api-and-moat-reassessment.md). |

## Strategy correction (2026-08-03)

Reading the prior art at source level revised two claims this roadmap had been built on.
Full detail in
[pml-api-and-moat-reassessment.md](../research/pml-api-and-moat-reassessment.md):

1. **"Hardcoded identifiers break every release" is an overclaim.** Measured across real
   PolyTrack versions, mangled identifiers were **byte-identical** 0.6.1 → 0.6.2, and the
   0.6.0 → 0.6.1 delta was four string constants. So the argument for mappings is the
   **failure mode**, not the frequency: a mismatch is detected and fails closed, rather than
   being discovered by breakage and possibly not at all. Do not claim updates are frequent.
2. **Physics patching is not new ground.** It is a real capability TSPML lacks until M11.

**Consequences for direction:**

- **The mappings pipeline's *automation* is the load-bearing investment**, not the mappings
  idea by itself. If release-day cost is not decisively lower than editing a handful of
  constants by hand, the whole map is a thin story. Measure it honestly on the first real
  0.6.3.
- **Do not sell the API as differentiated in kind.** "Shipped, typed, and tested" is the
  honest claim, and it is a good one on its own without a comparison attached.
- **Keep the API in-tree.** An API package that lives outside the loader rots — this is the
  observed failure of every prior attempt. Ours is imported by the portal and the harness
  and covered by the same CI run, which is a concrete argument for the layering rather than
  an abstract one.

## Open follow-up issues

| # | Title | Scope |
|---|---|---|
| [#43](https://github.com/roowus/TSPML/issues/43) | No physics WASM patching | Constants compiled into `polytrack_physics.wasm` are unreachable from bundle anchors. Gates M11. |
| [#80](https://github.com/roowus/TSPML/issues/80) | Modpack IDs (last slice) | Distribution UX on top of #62's runtime user mods. Shipped: one-URL mod install, and whole-pack install from a plain-text list of mod URLs (pasted or linked). Remaining: resolving a short modpack ID against a registry — a links-only DB, client-side fetch, per-mod validation, never a server-side store of user code. Blocked on that backend. |

Closed since the last update: [#21](https://github.com/roowus/TSPML/issues/21)
(`environment` and `targets` are now enforced: mismatches **soft-disable** the mod via
the #6 machinery — excluded from the order with `environment-mismatch` /
`incompatible-target` warnings, dependents cascading — when the host states
`hostEnvironment` / `polytrackVersion` in the new `ResolveContext` fields; the portal
states both, honors mixin-descriptor `environment` in the patch plan and demo mixins,
and the spec now tells the truth about capabilities/vanillaSafe/special ids),
[#67](https://github.com/roowus/TSPML/issues/67)
(mod keybinds now survive game-frame reloads — `Keybinds.retarget(window)` moves the
listeners to the new frame window while keeping every registered binding; previously
only the FIRST frame's window ever got listeners, so any in-place iframe reload or
React remount silently killed every mod keybind), [#6](https://github.com/roowus/TSPML/issues/6)
(`breaks` now soft-disables rather than aborting: the declaring mod is excluded
from the load order with a `breaks-disabled` warning and a per-mod `'disabled'`
status, dependents cascading — instead of one incompatibility declaration aborting
the entire load), [#64](https://github.com/roowus/TSPML/issues/64)
(`checkpoint.respawn` is now emitted — on the reset-press **edge** read from the
car controller's old-state WeakMap at `setCarState` HEAD, per-car with
`{ carId, isReplay }`, silent rather than guessing when the state shape drifts;
full restarts and pre-first-checkpoint presses correctly don't fire because the
game's own scene code routes those down the recreate-the-car path),
[#62](https://github.com/roowus/TSPML/issues/62) (runtime
user mods' pasted `mixins.json` now reaches the bundle transform via a request-carried
patch plan — Cache API → service-worker POST replay → one-pass compose, base
all-or-nothing, user per-mod isolated, with an in-bundle per-mod report),
[#25](https://github.com/roowus/TSPML/issues/25) (all four
portal smokes now run in CI — advisory on PRs + daily schedule, with a pinned-bundle canary,
`.github/workflows/smoke.yml`), [#10](https://github.com/roowus/TSPML/issues/10) (per-car race
events now carry `{ carId, isReplay }`; the issue's premise — that the controlled-car flag is
an unreadable private field — was disproved, it is a module-scope `var` in the inject's scope
chain), [#11](https://github.com/roowus/TSPML/issues/11) (`api.audio` —
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
