# Mappings system (the Yarn analog)

> The single most important component and TSPML's moat. The PolyTrack modding ecosystem has **no stable mod-facing API surface** today — PML codes against mangled names + raw substring tokens, and the "deobfuscated" bundles are manual and non-auto-regenerable. TSPML fills exactly this gap. **Caveat (review): the auto-regeneration pipeline has never been validated against a real version bump — the M1 spike is a hard go/no-go gate.**

## What it is

A **versioned JSON, one file per PolyTrack build**, mapping stable semantic names → concrete locators in the current build's minified bundles. Mods target **stable names only**; the resolver maps stable → concrete at bind time.

## Map format

```jsonc
{
  "formatVersion": 1,
  "gameVersion": "0.6.2",
  "bundleHash": "sha256:...",                 // integrity pin (main.bundle.js)
  "symbols": {
    "Car":                       { "kind": "class",      "module": "main", "locator": { "type": "exportRef", "key": "VisualCar" } },
    "Car.controlCar":            { "kind": "method",     "class": "Car",   "locator": { "type": "prototypeFn", "name": "controlCar" }, "signature": "(state,input)=>void" },
    "Car.getCarState":           { "kind": "method",     "class": "Car",   "locator": { "type": "prototypeFn", "name": "getCarState" } },
    "Track.afterLoad":           { "kind": "eventSink",  "locator": { "type": "callExpression", "anchor": "...", "ordinal": 0 } },
    "Car.update.invokePhysics":  { "kind": "callSite",   "locator": { "type": "callExpression", "anchor": "...", "ordinal": 0 } }
  },
  "unresolved": ["PhysicsEngine.step"]         // symbols not matched this build (graceful)
}
```

**Locator types (tried in fallback order):** `exportRef` → `prototypeFn` → `callExpression` (AST anchor + ordinal) → `string` anchor. The resolver tries each tier before declaring failure.

## Stable namespace

A human-curated **canonical** namespace (`Car`, `Track`, `Checkpoint`, `Race`, `Wheel`, `Profile`, …) **seeded** from `cwcinc/polytrack-0.6.0-deobfuscated`'s partial rename (~100 names: `VisualCar`, `PartObject`, `createCar`, `controlCar`, `wheelSuspensionLength`, `checkpointOrder`, `getLeaderboard`, `createMultiplayerHostWebSocket`…). **Treat `cwcinc` as a one-time bootstrap only** — fork/mirror it internally, and commit to owning the canonical namespace via the auto-pipeline against the *current* live build from day one.

## Authoring & maintenance

The canonical stable namespace is human-curated; per-build concrete locators are produced by the auto-pipeline (below) and human-reviewed via a diff tool. The **API bridge** is the small layer that consumes the map to wire events/registries.

## Auto-regeneration pipeline (gated on the M1 spike)

> **Status: IMPLEMENTED (M9).** The full fetch → unpack → match/gen → diff → verify
> pipeline lives in [`tooling/mappings-pipeline`](../../tooling/mappings-pipeline/).
> One command regenerates a candidate map and prints a human-review report:
> `node tooling/mappings-pipeline/scripts/regen.mjs <version>` (writes a
> `*.candidate.json` — never clobbers a committed map). See that package's README for
> the maintainer workflow. The semi-automated, human-in-the-loop scope (ADR-005)
> stands: the matcher relocates ~94% of game-logic modules automatically (0.848
> lexical-only, 0.939 with the #1 structural tie-break wired in via `select.mjs`);
> `diff.mjs` surfaces the rest for review and `verify-targets.mjs` is the fail-closed
> anchor gate that makes carrying `targets` forward safe across a version bump.
>
> When two modules genuinely share a stable name — sibling registries really do all
> declare `TrackPartRotationAxis` — the resolver ranks the collision by **evidence**
> (lexically-decided beats structurally-decided, then higher `matchWeight`, then
> `moduleId`), never by position in the JSON. Ranking by map order let structural
> promotions steal 8 existing names purely by landing earlier in the file; see the
> 2026-08-04 entry in [progress.md](../project/progress.md).

On each new PolyTrack release:

1. Fetch the new `main.bundle.js` + chunks + `simulation_worker.bundle.js`.
2. Run **webcrack** (AST deobfuscator: unpacks webpack, unminifies) + **wakaru** (unminifier/unpacker) → split into per-module files.
3. **Structural diff** against the previous build's output, matching modules by **stable anchors — not mangled id or byte offset**. Proven-stable anchors: the physics worker's `postMessage` protocol string keys (`createCarModel`, `updateCarModel`, `deleteCarModel`, `initializeCarCollisionShape`, `testDeterminism`), SHA-256 round-constant tables, numeric enums, Three.js library nodes, CSS class names (`.speedometer`/`.checkpoint`/`.editor`), SVG asset filenames.
4. Propagate stable names to matched modules; flag unmatched as `unresolved`.
5. Emit a candidate map + diff report for human review; commit to a versioned registry.

**Target:** a candidate map within hours of a release (Fabric's ~24–48 h goal). **Honest scope:** the bulk of *game-logic* modules (Car control, Track loading, checkpoint logic) have no stable string anchor and must be matched by fragile structural neighbor similarity — so "within hours" is aspirational until the M1 drift experiment proves a usable match rate. If game-logic match < ~80%, fall back to an **honestly-declared human-curated map** (per-update cost ≈ PML) and drop the "auto within hours" claim.

## Graceful degradation (fixes PML's two failure modes)

Every symbol resolution returns either a bound target or a typed `ResolutionFailure`. Each hook declares criticality `{ symbol, required: true|false }`:

- **required + unresolved** → that **one** mod is disabled with a specific error ("`Car.controlCar` not found in build 0.6.2; mod 'cool-cars' disabled") — **never** a boot-abort, **never** a silent skip.
- **optional + unresolved** → skip that hook, keep the rest of the mod.
- A **compatibility report** UI lists, per mod, what resolved / was skipped / failed.

The loader **never** silently no-ops (PML's ambiguous-token bug) and **never** aborts all mods on one failure (PML's boot-throw).

## Fail-closed on stale maps (review correction)

On `bundleHash` **mismatch**, **never** apply AST/physics/ranked locators from a non-matching map — a "nearest" map would resolve stable names to *wrong* concrete locators (silent mis-target, the exact failure the design accuses PML of). Permit **only** runtime-fallback event hooks whose target shape verifies at bind time. Treat "nearest map" as cosmetic-only. Physics/ranked paths stay disabled until an exact-match map is fetched.

## Legal posture

Ship **only the map** (metadata) — never the deobfuscated source or the game bundle — applied against the user's own live game copy. This mirrors how Minecraft mapping projects (Yarn/Mojang mappings) distribute mapping data, not the game. Do **not** lean on the Mojang-tolerates-Yarn analogy as legal cover: Kodub has stated no position. Keep a takedown-compliance plan (registry pull, map withdrawal). Produce the first map from an auto-pipeline run against the live bundle (not the no-license `cwcinc` dump) once the pipeline lands.
