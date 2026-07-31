# @tspml/loader

Clean loader core for TSPML (milestone M1). Discovers mod packages, parses and
validates `mod.json` / `manifest.json`, semver-resolves the Fabric-style
dependency graph (`depends` / `recommends` / `suggests` / `conflicts` / `breaks`
/ `includes` / `provides`), topologically orders mods with cycle detection and
explicit conflict reporting, and invokes entrypoints (`default(api, game)`) in
order — with per-mod error isolation so one bad mod never aborts the rest. This
package has **zero coupling** to minified PolyTrack internals; the real API
bridge lands later in `@tspml/api-bridge`.

## Build & test

```sh
pnpm --filter @tspml/loader build   # tsc -p tsconfig.json  -> dist/
pnpm --filter @tspml/loader test    # vitest run            -> 47 tests
```

## Public surface

`parseVersionManifest` / `parseGlobalManifest` (with typed `ManifestError`s that
name the offending field), the `semver` predicate wrappers, `resolveDependencies`
(throws `DependencyError` for cycles / missing deps / version conflicts / `breaks`,
returns `{ order, warnings }` with `conflicts`/`missing-recommendation` warnings),
and `load()` orchestration with dependency-injectable entrypoint loading for tests.
See `src/index.ts` for the full export list.
