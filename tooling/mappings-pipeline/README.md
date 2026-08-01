# @tspml/mappings-pipeline

The update-resilience pipeline that regenerates a candidate symbol map per PolyTrack
release, plus the M1 go/no-go drift experiment and the **M9 regen / diff / verify**
review tooling. This is the operational half of TSPML's moat: it is what lets a
maintainer recover from a PolyTrack version bump in (mostly) minutes instead of
re-deriving the whole map by hand.

> **Status: M9 regen/diff/verify pipeline implemented.** The matcher (`match.mjs`) and
> map generator (`gen-map.mjs`) date to M1/M2; the `fetch` + `diff` + `verify-targets`
> + `regen` review workflow is M9. Validated end-to-end against the real cached 0.6.0
> and 0.6.2 bundles (see `docs/project/progress.md`, M9).

## Why this exists

Every PolyTrack release re-minifies and re-splits the webpack bundle, so the concrete
locators (`moduleId`, anchor positions) shift. TSPML pins a per-build map
(`source/mappings/maps/polytrack-<ver>.json`) with a `bundleHash` integrity pin; on a
hash mismatch the resolver **fails closed** (serves vanilla, no mods — never silently
mis-targets). So when PolyTrack ships, TSPML goes dark until a new map is produced.
This pipeline produces that map — semi-automatically, with a human in the loop.

The M1 drift spike proved minified JS bundles CAN be structurally re-matched across
versions (game-logic match rate **0.85**, 0.6.0→0.6.2); the ~15% residual is the human
review this tooling surfaces. See `docs/research/mappings-drift-spike.md` and ADR-005.

## The pipeline (5 stages)

```
  fetch  →  unpack  →  gen-map  →  diff  →  verify-targets
 (CDN)    (webcrack)  (matcher)   (drift)   (anchor gate)
```

| Stage | Script | What it does |
|---|---|---|
| **fetch** | `src/fetch.mjs` | Download the new build's `main.bundle.js` (+ sim worker) from `app-polytrack.kodub.com/<ver>/` into `.cache/`. Byte-exact + optional `--expect-hash` pin. |
| **unpack** | `src/unpack.mjs` | webcrack the bundle into per-module files (`.cache/webcrack/v<ver>-raw/`). |
| **gen-map** | `source/mappings/scripts/gen-map.mjs` | Re-match the **fixed** 0.6.0 renamed source → new target (IDF-weighted shared anchors), extract stable names, compute `bundleHash`, carry the `targets` section forward, write a candidate map. Env-var parameterized (M9-A). |
| **diff** | `src/diff.mjs` | Pure map-vs-map diff: what modules relocated, which stable names moved, which **mod-facing targets are at risk**, and a risk level. The human-review core. |
| **verify-targets** | `src/verify-targets.mjs` | Confirm each carried-forward target's anchor literals still resolve together in the unpacked new bundle — the gate that makes carry-forward safe. |

`scripts/regen.mjs` runs all five and prints a combined review report.

## Regenerating on a new PolyTrack release

```sh
cd tooling/mappings-pipeline

# Full regen from the live CDN (fetches the new main bundle, unpacks, gens, reviews):
node scripts/regen.mjs 0.7.0

# If you already cached the 0.7.0 bundle (or the CDN is unreachable):
node scripts/regen.mjs 0.7.0 --no-fetch

# Force re-webcrack an already-unpacked version:
node scripts/regen.mjs 0.7.0 --reunpack
```

`regen` writes **`source/mappings/maps/polytrack-0.7.0.candidate.json`** — it never
clobbers a committed map. It then prints:

- **MAP DIFF** — relocated modules, moved stable names, targets at risk, confidence
  drops, and a verdict: `NO DRIFT` / `LOW RISK` / `HIGH RISK`.
- **TARGET VERIFICATION** — per-target `pass` / `ambiguous` / `fail` against the real
  unpacked modules.

If both are green, promote and commit:

```sh
cp source/mappings/maps/polytrack-0.7.0.candidate.json \
   source/mappings/maps/polytrack-0.7.0.json
git add -A && git commit -m "feat(mappings): add 0.7.0 map (regen-pipeline)"
```

`regen` exits non-zero on `HIGH` risk or any target `fail`, so it's CI-scriptable.

### Standalone modes

```sh
node scripts/regen.mjs --diff  <prev.json> <next.json>   # diff two existing maps
node scripts/regen.mjs --verify <map.json> <unpacked-dir> # verify targets vs unpacked code
```

Convenience scripts (`package.json`): `pnpm fetch 0.7.0`, `pnpm gen`, `pnpm diff -- …`,
`pnpm verify -- …`, `pnpm regen 0.7.0`.

## Cross-version identity (why the diff keys by `sourceModuleId`)

A regen always matches the **same source** (the fixed `v060-renamed` 0.6.0 bundle)
against a new target, so every matched module carries a stable `sourceModuleId` (a
0.6.0 webcrack id) that is **identical across versions**. The diff therefore keys
modules by `sourceModuleId`, NOT by the concept slug — the slug is derived from the
scorer's chosen stable names and drifts between regens; keying by it would mis-pair
modules. `moduleId` (the new build's webcrack id) is the thing that *relocates*.

The `targets` section is carried forward verbatim by `gen-map`, so the diff **cannot**
diff targets directly. Instead:

- `diff.mjs` correlates each target to its module by **maximum stable-name overlap**
  (a heuristic) and flags `relocated` / `orphaned` / `unresolved` targets — the
  "what moved / what to re-verify" signal.
- `verify-targets.mjs` is the **authoritative** check: it reads the unpacked new
  bundle and confirms all of a target's anchor literals appear together in a module.

Both are needed: the diff tells you what to look at; verify-targets tells you whether
it still works.

## Tests

```sh
pnpm test    # 26 unit tests (diff + verify-targets) — CI-runnable, no bundle needed
```

The pure `diff` and `verify-targets` logic is fully unit-tested with fixture maps and
temp module directories. The bundle-dependent stages (`fetch`, `unpack`, `gen-map`,
the full `regen`) are local-only (webcrack + the gitignored `.cache/`), like the M1
spike tests in `source/transform`.

## Legal posture

The PolyTrack bundle is proprietary. `fetch` downloads the user's own live game copy
into the **gitignored** `.cache/` for offline analysis; **the bundle is never
committed** — only mapping metadata (the JSON map) ships, mirroring how Minecraft
mapping projects (Yarn/Mojang) distribute mapping data, not the game. `.cache/` is in
`.gitignore`; verify this before any commit.
