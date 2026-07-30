# `mod.json` spec

> The mod manifest schema (the Fabric `fabric.mod.json` analog). A mod is a git-hosted folder (or registry package) with a root `manifest.json` (global) plus one semver-named version folder per release containing `mod.json` (the version manifest) + the entry module. Status: **spec frozen for M0**; the loader implementation lands in M1.

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
  "id": "cool-cars",                       // globally unique, lowercase [a-z0-9-_]
  "name": "Cool Cars",
  "author": "alice",
  "latest": { "0.6.2": "1.0.0", "0.6.1": "1.0.0" }   // gameVersion -> modVersion
}
```

## VersionManifest (`mod.json`)

```jsonc
{
  "schemaVersion": 1,
  "id": "cool-cars",                       // lowercase [a-z0-9-_], globally unique
  "name": "Cool Cars",
  "version": "1.0.0",                      // semver
  "description": "...",
  "authors": ["alice"],                    // string | { name, contact }
  "license": "MIT",                        // SPDX
  "icon": "icon.png",
  "homepage": "https://...",

  "environment": "*",                      // "*" | "web" | "desktop" | "worker"

  "entrypoint": "main.js",                 // ES module; default export extends TspmlMod or is a factory (api, game) => {}

  "targets": [">=0.6.0 <0.7.0"],           // PolyTrack game-version ranges (semver)

  "depends":    { "tspml-api": "^1.0.0" },
  "recommends": {},
  "suggests":  {},
  "conflicts": {},
  "breaks":    { "cool-cars-old": "*" },
  "includes":  {},
  "provides":  [],

  "mixins":    [ { "config": "mixins/cars.json", "environment": "worker" } ],

  "capabilities": ["dom", "storage"],      // declared, surfaced as a consent prompt (consented-advisory)
  "vanillaSafe": true,                     // false if touches physics/multiplayer (warn-only label)

  "custom": {}                             // arbitrary tooling / inter-mod data
}
```

## Entrypoint contract

An ES module whose **default export** is a class extending `TspmlMod` (lifecycle: `preInit`/`init`/`ready`/`onUnload`) or a factory `default(api, game)`. The loader calls it with a capability-scoped `api`. Mixin descriptor files are JSON patches referencing **stable names** — only for the escape hatch, never required. (The export name is `default`, fixing PML's mandatory-magic-name `polyMod` wart.)

## Dependency semantics

Direct port of Fabric: `depends` (must be present & satisfied or the mod won't load), `recommends` (soft warn), `suggests` (informational), `conflicts` (both load but warn), `breaks` (refuse if present at a matching version), `includes` (nested/contained mod), `provides` (drop-in for another id). Special ids: `polytrack` (matched against `targets`), `tspml`, `tspml-api`. Predicates use npm `semver` ranges. Load order is an **automatic topological sort** with cycle detection + explicit conflict reporting; user `priority` hints layer on top.

> See [events-and-registries.md](./events-and-registries.md) and [mixin-reference.md](./mixin-reference.md) for the `api` surface.
