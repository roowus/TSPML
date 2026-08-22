# `mod.json` spec

> The mod manifest schema. A mod is a git-hosted folder (or registry package) with a root `manifest.json` (global) plus one semver-named version folder per release containing `mod.json` (the version manifest) + the entry module. Status: **spec frozen for M0**; the loader implementation lands in M1.

## Layout

```
my-mod/
  manifest.json          # GlobalManifest (root)
  1.0.0/
    mod.json             # VersionManifest (the schema below)
    main.js              # entrypoint ES module (or main.ts, built)
    icon.png             # optional, 128×128
    README.md            # optional, rendered in the portal
    mixins/              # optional, declarative patch descriptors (escape hatch)
      cars.json
```

## GlobalManifest (`manifest.json`)

```jsonc
{
  "id": "cool-cars",                       // globally unique, lowercase [a-z0-9-]
  "name": "Cool Cars",
  "author": "alice",
  "latest": { "0.6.2": "1.0.0", "0.6.1": "1.0.0" }   // gameVersion -> modVersion
}
```

## VersionManifest (`mod.json`)

```jsonc
{
  "schemaVersion": 1,
  "id": "cool-cars",                       // lowercase [a-z0-9-], globally unique
  "name": "Cool Cars",
  "version": "1.0.0",                      // semver
  "description": "...",
  "authors": ["alice"],                    // string | { name, contact }
  "license": "MIT",                        // SPDX
  "icon": "icon.png",                      // shown on the mod's portal card; http(s) URL, path relative to mod.json (URL imports), or data:image/* URI (pasted mods)
  "homepage": "https://...",               // the repo/project page; the portal shows it as a "site" link on the mod's card
  "docs": "https://...",                   // usage documentation for PLAYERS; the portal's "docs" button opens this (no fallback to homepage — a repo is not docs)

  "environment": "*",                      // "*" | "web" | "desktop" | "worker" — a mismatch with the host soft-disables the mod (#21)

  "entrypoint": "main.js",                 // ES module; default export extends TspmlMod or is a factory (api, game) => {}

  "targets": [">=0.6.0 <0.7.0"],           // PolyTrack game-version ranges (semver, OR'd together); no match soft-disables (#21)

  "depends":    { "tspml-api": "^0.5.0" },
  "recommends": {},
  "suggests":  {},
  "conflicts": {},
  "breaks":    { "cool-cars-old": "*" },
  "includes":  {},
  "provides":  [],

  "mixins":    [ { "config": "mixins/cars.json", "environment": "worker" } ],  // per-config environment is honored: a config for another host contributes nothing (#21)

  "physics":   "physics.json",             // f32 constant rewrites for the game's physics binary (#43); one path, not a per-environment list

  "capabilities": ["dom", "storage"],      // declared + surfaced as warn-only labels (M6-B); consent prompts / API scoping are reserved (#21)
  "vanillaSafe": true,                     // false if touches physics/multiplayer — warn-only label, shipped (M6-B); declaring `physics` sets the leaderboard-risk warning regardless of what this says

  "custom": {}                             // arbitrary tooling / inter-mod data
}
```

## Entrypoint contract

An ES module whose **default export** is a class extending `TspmlMod` (lifecycle: `preInit`/`init`/`ready`/`onUnload`) or a factory `default(api, game)`. The loader calls it with a capability-scoped `api`. Mixin descriptor files are JSON patches referencing **stable names** — only for the escape hatch, never required. The loader reads the module's `default` export, so there is no magic global or specially-named variable to declare.

## Dependency semantics

The relationship fields: `depends` (must be present & satisfied or the mod won't load), `recommends` (soft warn), `suggests` (informational), `conflicts` (both load but warn), `breaks` (if the named mod is installed at a matching version, the **declaring** mod is soft-disabled — excluded from the load order with a `breaks-disabled` warning — while the named mod and everything else load normally; a mod that `depends` on a disabled mod cascades to disabled, #6), `includes` (nested/contained mod — **not implemented, see below**), `provides` (drop-in for another id). Special ids resolve against the host's `ResolveContext`: `polytrack` (the running game version — also what `targets` is checked against), `tspml` (loader version), `tspml-api` (api version). **All three resolve in the portal and the dev harness** (#73); both report `tspml` and `tspml-api` at **0.5.0**, so `depends: { "tspml-api": "^0.5.0" }` is satisfied and a range naming a version TSPML does not have is refused with a reason rather than silently loaded. Both are pre-1.0 on purpose: the mod-facing surface is not frozen, and under 0.x semver a **minor** bump is the breaking one. Predicates use npm `semver` ranges. Load order is an **automatic topological sort** with cycle detection + explicit conflict reporting; user `priority` hints layer on top.

**Environment & targets enforcement (#21).** When the host states `hostEnvironment`, a mod declaring a *different concrete* `environment` is soft-disabled (excluded from the order, reported with an `environment-mismatch` warning) — `"*"` on either side means no constraint. When the host states its game version, a mod whose non-empty `targets` ranges (OR'd together) don't match is soft-disabled with an `incompatible-target` warning. Both cascade exactly like `breaks`: a mod depending on a disabled mod is disabled too, and everything unrelated still loads. A host that states neither fact filters nothing. Mixin-descriptor `environment` is enforced by the host applying the mixins: the web portal skips configs declared `desktop`/`worker` (and says so in the UI) rather than applying them anyway.

## `physics` (#43)

A path, relative to `mod.json`, to a `physics.json` that rewrites f32 constants inside the game's compiled physics binary:

```jsonc
{
  "wasmHash": "d4ef02676973d41afc34b23b5248f6950b35dc4cc7e3047e3a9c6bd88e4c180e",
  "patches": [
    {
      "name": "grip",                      // human label, shown in refusals and reports
      "signature": "d0d92e0ad4a721e9efa44a4930f3a21e93e5bfedb236243f65516379c2a8adca",
      "oldValue": 1.100000023841858,       // the f32 currently there; must occur exactly once in that function
      "newValue": 1.4
    }
  ]
}
```

One path, not a list of environment-scoped descriptors like `mixins`: there is one physics binary and one all-or-nothing apply, so a per-host variant would have nothing to vary. A host that cannot patch the binary skips the file entirely rather than applying part of it.

### Deriving one

You do not write `signature` or `wasmHash` by hand. `find-constant` searches a physics binary by value and prints every place that value occurs, with the fingerprint of the function holding it:

```
$ pnpm --filter @tspml/wasm build          # once; the command runs the compiled package
$ pnpm --filter @tspml/wasm find-constant 1.1

fetching https://app-polytrack.kodub.com/0.6.2/polytrack_physics.wasm
binary sha256: d4ef02676973d41afc34b23b5248f6950b35dc4cc7e3047e3a9c6bd88e4c180e
searching for f32 1.100000023841858

1 occurrence, 1 patchable:

✓ [0] function 234 — value 1.100000023841858
      signature d0d92e0ad4a721e9efa44a4930f3a21e93e5bfedb236243f65516379c2a8adca
      17 f32 constants in this function, payload at 0x2c2e6
```

It fetches the live binary by default (`--wasm <path>` reads a local copy, `--version` picks a build) and never writes those bytes to disk. Add `--emit <name>=<value>` to print a ready-to-paste file — stdout carries the JSON alone, so `--emit grip=1.4 > physics.json` writes a valid one:

```
$ pnpm --filter @tspml/wasm find-constant 1.1 --emit grip=1.4 > physics.json
```

Three things it will not do, each for the same reason — a guess here becomes a corrupted binary later:

- **It never picks for you.** Which constant governs grip is a question about the game's physics, not about the binary, so every hit is reported and none is ranked. `--emit` refuses when more than one candidate is patchable; identify the one you want and write the file from its signature.
- **It refuses what the loader would refuse**, at authoring time rather than mid-race: a value occurring twice inside its own function (`oldValue` cannot say which site), or a function whose fingerprint matches another function (no signature can name it). Both are common — around 2% of functions are structurally ambiguous, and the clamp idiom puts `-10` and `+10` in one body.
- **It reports the f32, not what you typed.** `1.05` is stored as `1.0499999523162842`. Copy the printed `value` into `oldValue`; a double literal that looks right will fail the exactly-once check.

If a search comes back empty for a value you can see in a disassembly, that rounding is usually why. Try neighbouring values, or search for a rounder constant nearby and work outwards.

### f32 only

`f32.const` is the whole of it — there is no integer, `f64`, or byte-sequence patching, and no plan to add any. A physics constant a mod would want to tune is a float in practice, and every additional payload type is another way to write the wrong bytes into a running binary. `#43` sketched an `i32` variant; it was not built. A patch is a float rewrite in place, which is the one edit that cannot change the size or structure of the binary around it.

Two independent gates stand between a patch and a write, and both fail closed. `wasmHash` pins the exact bytes the patches were derived against; if the served binary is not those bytes, nothing is applied and the host says so. Separately, each `signature` is re-derived structurally from the binary in hand — by the set of float constants and the histogram of opcodes in a function, never by an offset or index — and a signature matching zero functions or more than one is refused. A stale offset would otherwise mean writing a float into whatever now lives at that address.

Declaring `physics` marks the mod as a leaderboard risk whatever `vanillaSafe` claims: rewriting a constant changes how every lap time is produced. The label is warn-only, as everywhere else in TSPML — the player decides.

Limits: 16 patches per mod, 32 across all enabled mods. Two mods patching the same constant is a conflict, and the later one is dropped with a reason rather than both being refused.

> ⚠️ **`includes` is parsed but not implemented (#16).** It would let a mod package ship another mod nested inside it, and TSPML has no delivery mechanism for that — we cannot yet install a mod from a directory at all, let alone one nested inside another package. Declaring it validates cleanly and now emits an `unsupported-includes` warning; **the nested mod will not be loaded.** Ship it separately and use `depends` instead. The field stays in the schema (rejecting it would break manifests that are valid per this spec) and may be honoured later.

> See [events-and-registries.md](./events-and-registries.md) and [mixin-reference.md](./mixin-reference.md) for the `api` surface.
