# Mappings system

> The single most important component. PolyTrack ships as a minified bundle with no stable mod-facing API: every class and method arrives under a short generated name that can change on any rebuild. The mappings file is the translation layer that gives those moving targets fixed names, so a mod can say `Car.controlCar` and mean it across releases. **Caveat (review): the auto-regeneration pipeline has never been validated against a real version bump — the M1 spike is a hard go/no-go gate.**

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
> stands: the matcher relocates ~97% of game-logic modules automatically (0.848
> lexical-only, 0.939 with the #1 structural tie-break wired in via `select.mjs`,
> 0.97 with the #1 call-graph edge pass in `edges.mjs`);
> `diff.mjs` surfaces the rest for review and `verify-targets.mjs` is the fail-closed
> anchor gate that makes carrying `targets` forward safe across a version bump.
>
> When two modules genuinely share a stable name — sibling registries really do all
> declare `TrackPartRotationAxis` — the resolver ranks the collision by **evidence**
> (lexically-decided beats structurally-decided beats edge-decided, then higher
> `matchWeight`, then `moduleId`), never by position in the JSON. Ranking by map order
> let structural promotions steal 8 existing names purely by landing earlier in the
> file; see the 2026-08-04 entry in [progress.md](../project/progress.md).

On each new PolyTrack release:

1. Fetch the new `main.bundle.js` + chunks + `simulation_worker.bundle.js`.
2. Run **webcrack** (AST deobfuscator: unpacks webpack, unminifies) + **wakaru** (unminifier/unpacker) → split into per-module files.
3. **Structural diff** against the previous build's output, matching modules by **stable anchors — not mangled id or byte offset**. Proven-stable anchors: the physics worker's `postMessage` protocol string keys (`createCarModel`, `updateCarModel`, `deleteCarModel`, `initializeCarCollisionShape`, `testDeterminism`), SHA-256 round-constant tables, numeric enums, Three.js library nodes, CSS class names (`.speedometer`/`.checkpoint`/`.editor`), SVG asset filenames.
4. Propagate stable names to matched modules; flag unmatched as `unresolved`.
5. Emit a candidate map + diff report for human review; commit to a versioned registry.

**Target:** a candidate map within hours of a release. **Honest scope:** the bulk of *game-logic* modules (Car control, Track loading, checkpoint logic) have no stable string anchor and must be matched by fragile structural neighbor similarity — so "within hours" is aspirational until the M1 drift experiment proves a usable match rate. If game-logic match < ~80%, fall back to an **honestly-declared human-curated map**, accept the per-update hand-mapping cost, and drop the "auto within hours" claim.

## Graceful degradation

Every symbol resolution returns either a bound target or a typed `ResolutionFailure`. Each hook declares criticality `{ symbol, required: true|false }`:

- **required + unresolved** → that **one** mod is disabled with a specific error ("`Car.controlCar` not found in build 0.6.2; mod 'cool-cars' disabled") — **never** a boot-abort, **never** a silent skip.
- **optional + unresolved** → skip that hook, keep the rest of the mod.
- A **compatibility report** UI lists, per mod, what resolved / was skipped / failed.

Two outcomes are ruled out by construction: a hook that silently does nothing because its target could not be found, and one mod's resolution failure taking down the whole boot.

## Fail-closed on stale maps (review correction)

On `bundleHash` **mismatch**, **never** apply AST/physics/ranked locators from a non-matching map — a "nearest" map would resolve stable names to *wrong* concrete locators, patching whatever now happens to sit at that address. That silent mis-target is the single worst outcome available to a mod loader, which is why the hash gate exists. Permit **only** runtime-fallback event hooks whose target shape verifies at bind time. Treat "nearest map" as cosmetic-only. Physics/ranked paths stay disabled until an exact-match map is fetched.

## Surfaces: the main bundle is not the only served file (#98)

PolyTrack does not ship as one file. The main bundle loads numbered chunks lazily
(`112.bundle.js` is the track editor, `535.bundle.js` the track verifier UI,
`604.bundle.js` profile selection, `657.bundle.js` settings), and a symbol living in a
chunk is not reachable by anything that only ever looks at `main.bundle.js`. A
**surface** is one served filename, and it is the unit that owns its own hash pin and
its own transform.

The map therefore carries a `chunks` allowlist alongside the main `bundleHash`:

```jsonc
"chunks": {
  "112": { "id": "112", "hash": "sha256:...", "bytes": 108037, "role": "track editor" }
}
```

and a target may name the surface it was found in:

```jsonc
"Editor.draw": {
  "anchor": { "literals": ["How to use the editor"], "minHits": 1 },
  "selector": { "kind": "method", "name": "draw" },
  "surface": "112.bundle.js"        // absent means main.bundle.js
}
```

Three properties follow, and each exists because its absence fails quietly:

- **The allowlist is data, not code.** A chunk that the map does not declare is never
  transformed. Adding editor support is a map change, not a proxy change.
- **Each surface gates independently.** A chunk whose bytes no longer match its pin
  serves that chunk vanilla and says so; it does not block the main transform. The
  alternative — one pin for everything — would turn any chunk rebuild into a total
  loss of modding.
- **An anchor is only evidence about the file it was found in.** Verification routes
  each target to its own surface's unpacked modules. Checking a chunk-scoped target
  against main answers a different question, and answers it wrongly in both
  directions: a literal that happens to occur in main reports a pass for a target that
  will never resolve there, and one that does not reports a fail for a target that is
  fine inside its chunk.

### What the pipeline does about it

Chunks are opt-in per regen, because fetching and webcracking four extra files on every
run buys nothing while the chunks are UI-only — but a release that moves game logic into
one becomes visible here rather than as an unexplained drop in match rate.

```
node scripts/regen.mjs 0.7.0 --chunks    # fetch, re-pin, unpack and verify every chunk
node scripts/regen.mjs --verify map.json <main-dir> 112=<chunk-112-dir>
```

Three guards make the quiet failures loud:

- A target whose surface was not unpacked is reported **SKIPPED**, never `pass`, and
  exits non-zero. "Everything I looked at passed" is the exact shape of a false
  all-clear.
- `--chunks` without a fetch is refused outright: a pin is a hash of bytes, and
  carrying the previous build's hashes forward while the caller asked for a re-pin
  would ship stale pins that look freshly verified.
- A candidate that declares fewer chunks than the baseline is rejected. A chunk can
  legitimately disappear from a build, but that is indistinguishable from the
  carry-forward bug, so it takes an explicit `--allow-chunk-drop` from a reviewer who
  checked the new runtime.

A chunk pin that did **not** move while the main bundle did is called out in the diff
for the same reason: it is either a genuinely byte-identical chunk or a regen run
without `--chunks`, and in the second case that chunk silently never transforms again.

## Legal posture

Ship **only the map** (metadata) — never the deobfuscated source or the game bundle — applied against the user's own live game copy. Distributing mapping data rather than game code is the established shape for this kind of project in other modding ecosystems, but do **not** treat that as legal cover: those precedents involve different rightsholders who took their own positions, and Kodub has stated none. Keep a takedown-compliance plan (registry pull, map withdrawal). Produce the first map from an auto-pipeline run against the live bundle (not the no-license `cwcinc` dump) once the pipeline lands.
