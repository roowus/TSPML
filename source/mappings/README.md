# @tspml/mappings

Versioned symbol map for PolyTrack plus a **fail-closed** resolver that binds
stable names to concrete minified locators — the Yarn analog. Mods target stable
names only; this package maps stable → concrete at bind time. Status: **M2**,
module-level granularity, bootstrapped from the [M1 drift
spike](../../docs/research/mappings-drift-spike.md) (0.6.0-renamed → 0.6.2,
~85% game-logic match rate).

See [`docs/design/mappings-system.md`](../../docs/design/mappings-system.md) for
the map format, the stable namespace, and the auto-regeneration pipeline.

## v1 scope

A map pins **modules**, not individual symbols: each entry binds a stable concept
(`Car Collision Shape Vertices`, `Wall Track`, …) plus a few representative stable
names to the webcrack module id that contains it (`"5220"`, `"8043"`, …). This is
because the drift spike matched whole modules. **Symbol-level locators**
(`exportRef` / `prototypeFn` / `callExpression`) land in **M3**; until then
`resolve()` returns the containing module, and an M3 resolver will narrow further.

## The fail-closed resolver

`createResolver(map).resolve(stableName, { bundleHash })` returns either a bound
locator or a typed failure. The **critical rule**:

> If `ctx.bundleHash` (the sha256 of the LIVE bundle about to load) does **not**
> match `map.bundleHash`, the resolver returns `{ ok: false, reason: 'stale-map' }`
> and **never** returns a locator.

A stale map would resolve stable names to *wrong* concrete code — the exact
silent mis-target the design accuses PML of. So a stale map fails closed; the
caller must fetch an exact-match map before binding any AST/physics/ranked hook.
The hash comparison normalizes an optional `sha256:` prefix (a caller may pass
bare hex); this cannot cause a false match — two different bundles differ in at
least one hex digit.

| Outcome     | When                                   | Action                                |
| ----------- | -------------------------------------- | ------------------------------------- |
| `ok: true`  | hashes match + stable name is known    | use `locator.moduleId`                |
| `stale-map` | hashes differ                          | fetch exact-match map; bind nothing   |
| `not-found` | hashes match but name unknown          | treat per hook criticality (M4)       |

### Stable-name collisions rank by evidence, not map order

One stable name can name several modules — sibling track-block registries genuinely
all declare `TrackPartRotationAxis`. The generator prefers module-unique names, which
keeps this rare, but the resolver still has to choose. It ranks, strongest evidence
first: `decidedBy: 'lexical'` beats `'structural'` (anchors are direct evidence about a
module's own literals; shape similarity is circumstantial), then higher `matchWeight`,
then `moduleId` for determinism.

This is load-bearing, not cosmetic. The index used to be first-wins over
`Object.values(map.modules)` — i.e. over JSON key order — so the #1 structural
promotions took **8 pre-existing stable names** off lexically-matched modules purely by
landing earlier in the file. Adding modules to a map has to be additive. An absent
`decidedBy` means lexical, so pre-#1 maps rank exactly as they always did.

## Build & test

```sh
pnpm --filter @tspml/mappings build   # tsc -p tsconfig.json  -> dist/
pnpm --filter @tspml/mappings test    # vitest run
pnpm --filter @tspml/mappings gen     # regenerate maps/polytrack-0.6.2.json from the spike cache
```

Tests do not require a build — vitest runs the TS sources directly.

## Public surface

- `loadMap(path)` / `loadDefaultMap()` / `validateMap(obj)` — load + strictly
  validate map JSON (throws `MapParseError` naming the offending field).
- `createResolver(map)` → `{ resolve(stableName, ctx): ResolveResult }` and the
  stateless `resolve(map, stableName, ctx)`.
- The `GameMap` / `ModuleEntry` / `Locator` / `ResolveResult` types and
  `MAP_FORMAT_VERSION`.
- The bundled `maps/polytrack-0.6.2.json` (64 modules, 2 unresolved — 56/10 on lexical
  anchors alone, +6 from the #1 structural tie-break, +2 from the #1 call-graph edge
  pass; both promotions re-pointed **0** existing stable names).

## Regenerating the map

`scripts/gen-map.mjs` reproduces the spike matcher (no sample caps) against the
webcrack cache under `tooling/mappings-pipeline/.cache/`, extracts representative
stable names from each renamed 0.6.0 module, and writes
`maps/polytrack-0.6.2.json`. The matcher is pure Node built-ins (no install
needed). webcrack's unpack step (already cached) does *not* require Node 22/24
either: only `npx webcrack` fails outside that range — the library API that
`tooling/mappings-pipeline/src/unpack.mjs` calls runs fine on Node 25 (#5).
