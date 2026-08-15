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
  "homepage": "https://...",               // http(s) URL; the portal shows it as a "docs" link on the mod's card

  "environment": "*",                      // "*" | "web" | "desktop" | "worker" — a mismatch with the host soft-disables the mod (#21)

  "entrypoint": "main.js",                 // ES module; default export extends TspmlMod or is a factory (api, game) => {}

  "targets": [">=0.6.0 <0.7.0"],           // PolyTrack game-version ranges (semver, OR'd together); no match soft-disables (#21)

  "depends":    { "tspml-api": "^1.0.0" },
  "recommends": {},
  "suggests":  {},
  "conflicts": {},
  "breaks":    { "cool-cars-old": "*" },
  "includes":  {},
  "provides":  [],

  "mixins":    [ { "config": "mixins/cars.json", "environment": "worker" } ],  // per-config environment is honored: a config for another host contributes nothing (#21)

  "capabilities": ["dom", "storage"],      // declared + surfaced as warn-only labels (M6-B); consent prompts / API scoping are reserved (#21)
  "vanillaSafe": true,                     // false if touches physics/multiplayer — warn-only label, shipped (M6-B)

  "custom": {}                             // arbitrary tooling / inter-mod data
}
```

## Entrypoint contract

An ES module whose **default export** is a class extending `TspmlMod` (lifecycle: `preInit`/`init`/`ready`/`onUnload`) or a factory `default(api, game)`. The loader calls it with a capability-scoped `api`. Mixin descriptor files are JSON patches referencing **stable names** — only for the escape hatch, never required. (The export name is `default`, fixing PML's mandatory-magic-name `polyMod` wart.)

## Dependency semantics

Direct port of Fabric: `depends` (must be present & satisfied or the mod won't load), `recommends` (soft warn), `suggests` (informational), `conflicts` (both load but warn), `breaks` (if the named mod is installed at a matching version, the **declaring** mod is soft-disabled — excluded from the load order with a `breaks-disabled` warning — while the named mod and everything else load normally; a mod that `depends` on a disabled mod cascades to disabled, #6), `includes` (nested/contained mod — **not implemented, see below**), `provides` (drop-in for another id). Special ids resolve against the host's `ResolveContext`: `polytrack` (the running game version — also what `targets` is checked against), `tspml` (loader version), `tspml-api` (api version). The portal currently states only `polytrack` — `tspml`/`tspml-api` stay unresolved until the packages carry honest versions (#73), so `depends` on them fails as "not installed" there. Predicates use npm `semver` ranges. Load order is an **automatic topological sort** with cycle detection + explicit conflict reporting; user `priority` hints layer on top.

**Environment & targets enforcement (#21).** When the host states `hostEnvironment`, a mod declaring a *different concrete* `environment` is soft-disabled (excluded from the order, reported with an `environment-mismatch` warning) — `"*"` on either side means no constraint. When the host states its game version, a mod whose non-empty `targets` ranges (OR'd together) don't match is soft-disabled with an `incompatible-target` warning. Both cascade exactly like `breaks`: a mod depending on a disabled mod is disabled too, and everything unrelated still loads. A host that states neither fact filters nothing. Mixin-descriptor `environment` is enforced by the host applying the mixins: the web portal skips configs declared `desktop`/`worker` (and says so in the UI) rather than applying them anyway.

> ⚠️ **`includes` is parsed but not implemented (#16).** It is Fabric's JAR-in-JAR analog, and TSPML has no delivery mechanism for it — we cannot yet install a mod from a directory at all, let alone one nested inside another package. Declaring it validates cleanly and now emits an `unsupported-includes` warning; **the nested mod will not be loaded.** Ship it separately and use `depends` instead. The field stays in the schema (rejecting it would break manifests that are valid per this spec) and may be honoured later.

> See [events-and-registries.md](./events-and-registries.md) and [mixin-reference.md](./mixin-reference.md) for the `api` surface.
