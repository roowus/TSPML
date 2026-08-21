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
| **fetch** | `src/fetch.mjs` | Download the new build's `main.bundle.js` (+ sim worker) from `app-polytrack.kodub.com/<ver>/` into `.cache/`. Optional `--chunks` discovers the build's split chunks from the webpack runtime and fetches them (#3), which is also how their pins are re-derived (#98). Byte-exact + optional `--expect-hash` pin. |
| **unpack** | `src/unpack.mjs` | webcrack the bundle into per-module files (`.cache/webcrack/v<ver>-raw/`). Each chunk unpacks into its **own** dir (`v<ver>-chunk-<id>/`) — two surfaces can both contain a module named `112.js`, and a merged dir would silently drop one. |
| **gen-map** | `source/mappings/scripts/gen-map.mjs` | Re-match the **fixed** 0.6.0 renamed source → new target (IDF-weighted shared anchors), extract stable names, compute `bundleHash`, carry the `targets` section forward, decide the `chunks` pins (`src/chunk-pins.mjs`), write a candidate map. Env-var parameterized (M9-A). |
| **diff** | `src/diff.mjs` | Pure map-vs-map diff: what modules relocated, which stable names moved, which **mod-facing targets are at risk**, which chunk pins moved (#98), and a risk level. The human-review core. |
| **verify-targets** | `src/verify-targets.mjs` | Confirm each carried-forward target's anchor literals still resolve together in the unpacked new build — **routed to the target's own surface** (#98). The gate that makes carry-forward safe. |

`scripts/regen.mjs` runs all five and prints a combined review report.

## Node version — do not use `npx webcrack` (#5)

`webcrack@2.x` declares `engines: { node: ">=22 <23 || >=24 <25" }`. TSPML's local pin
is Node 25, which is outside that range. What this does and does *not* break was
measured rather than assumed:

| How you invoke it | Node 25 result |
|---|---|
| `npx webcrack …` | ❌ **exits 1, writes nothing**, after only an `npm warn EBADENGINE`. npm refuses to run the install/bin step; there is no error naming webcrack, so it reads like a silent no-op. |
| `pnpm exec webcrack …` (workspace-installed) | ✅ works — pnpm does not hard-fail on `engines`. |
| `node src/unpack.mjs <bundle> <outdir>` (library API) | ✅ works — **the supported path**. |

So the engine range is an **npm-packaging constraint, not a real runtime
incompatibility**: the webcrack *library* runs fine on Node 25. Only the npx route
fails, and it fails in the worst possible way — quietly, with an empty output
directory, which is easy to misread as "the bundle had no modules".

`src/unpack.mjs` therefore calls the programmatic API directly and is the entry point
the pipeline and `regen.mjs` use. **There is no reason to reach for the CLI**; if you
want it anyway, run the workspace copy via `pnpm exec`, never `npx`.

Contributors who prefer to stay in webcrack's declared range can pin Node 22 or 24
(`nvm use 22`); nothing in the pipeline requires it, and CI does not.

### The one real Node-25 incompatibility: `isolated-vm` (#2)

The claim above ("packaging constraint, not runtime") has exactly one exception, and
it is worth stating precisely because the rest of the section is so permissive.

webcrack's **deobfuscate** stage evaluates an obfuscator.io string-array decoder to
recover the literals it hides, and it runs that code inside `isolated-vm` — a native
addon. On Node 25 there is **no working build of isolated-vm by any route**, measured
on darwin-arm64:

| Route | Node 25 result |
|---|---|
| shipped prebuild | ❌ isolated-vm@6.1.2 ships **abi127/abi137** only (Node 22/24). Node 25 is **abi141** → `No native build was found for … abi=141`. |
| build from source | ❌ compiles and links cleanly (with a working python — brew python 3.14's `pyexpat` is broken, so `npm_config_python=/usr/bin/python3`), then **segfaults on `new ivm.Isolate()`**. Worse than absent: no JS error to catch. |
| newer isolated-vm | ❌ v7 ships **abi137/abi147** (Node 24/26) and declares `engines: >=26`. Node 25 falls in the gap on both sides. |

**This does not affect us, and that is a measured claim, not an assumption.** The
PolyTrack bundle is *minified*, not obfuscator.io-obfuscated, so webcrack never
reaches the decoder — and webcrack imports isolated-vm lazily, inside the sandbox
call, so the missing addon is never loaded. Unpacking the real 0.6.2 bundle on Node
25 yields **212 modules, byte-identical (`diff -rq`, no differences) to the same
unpack on Node 22**.

What `src/sandbox.mjs` adds is **legibility, not capability**. On an ABI with a
prebuild it passes no `sandbox` and webcrack uses its own. On any other ABI it
substitutes one that throws a named, catchable error instead of a raw
`No native build was found` — or, if a stale source build is sitting in the tree, a
bare `SIGSEGV` with no output whatsoever. If you ever see that error, the input is
genuinely obfuscated: re-run under Node 22 or 24.

It keys on the **ABI** (`process.versions.modules`), not the Node major, because the
ABI is what has to match — prebuilds are literally named `isolated-vm.abi<N>.node`.
Node 25 is excluded for being abi141, not for being 25.

Two consequences worth knowing:

- **`pnpm install` succeeds and the lockfile is committed.** #2 originally reported
  install exiting 1 with no lockfile; that is no longer true. pnpm 10 does not run
  dependency build scripts by default, so isolated-vm's failing `node-gyp` never
  runs at install time — it sits in `pendingBuilds` and install exits 0.
  **Do not `pnpm approve-builds` isolated-vm**: approving it buys nothing (the
  resulting addon segfaults) and reintroduces the install failure.
- **CI pins Node 22** (`.github/workflows/ci.yml`), which is inside every relevant
  range, so CI exercises the prebuilt-ABI branch. Both branches are unit-tested on
  either Node — the ABI is injected in `tests/sandbox.test.mjs` rather than read from
  the runtime, so neither branch depends on which Node happens to run the suite.

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
- **TARGET VERIFICATION** — per-target `pass` / `ambiguous` / `fail` / `skipped` against
  the real unpacked modules **of that target's own surface** (#98). Every line names the
  file it was checked in, because a wholesale mis-route otherwise renders as an ordinary
  green list.

If both are green, promote and commit:

```sh
cp source/mappings/maps/polytrack-0.7.0.candidate.json \
   source/mappings/maps/polytrack-0.7.0.json
git add -A && git commit -m "feat(mappings): add 0.7.0 map (regen-pipeline)"
```

`regen` exits non-zero on `HIGH` risk, any target `fail`, or any target `skipped`, so
it's CI-scriptable.

### Chunks (#98)

The game splits screens into lazily-loaded chunks (`112.bundle.js` is the track editor).
Each is its own **surface**: it carries its own pin in the map's `chunks` section and is
transformed independently, so a target anchored inside one is only meaningful when
checked against that chunk.

```sh
node scripts/regen.mjs 0.7.0 --chunks        # fetch, re-pin, unpack and verify every chunk
```

Opt-in rather than automatic: the 0.6.2 chunks are UI-only, so four extra downloads and
four extra webcrack runs on every regen buy nothing — but a release that moves game logic
into one shows up here rather than as an unexplained drop in match rate.

Three refusals are worth knowing before you hit them:

| Situation | What happens | Why |
|---|---|---|
| a chunk-scoped target with no unpacked chunk | reported **SKIPPED**, exit 1 | Not a pass and not a fail: nothing was checked. "Everything I looked at passed" is the exact shape of a false all-clear. |
| `--no-fetch --chunks` | hard error | A pin is a hash of bytes this run did not download. Carrying the old pins forward while the caller asked for a re-pin ships stale hashes that look verified. |
| candidate declares fewer chunks than the baseline | hard error, needs `--allow-chunk-drop` | A chunk *can* legitimately disappear from a build, but that is indistinguishable from the carry-forward bug, and the bug is both commoner and quieter. A human states they checked the new runtime. |

A chunk that is declared but never pinned correctly does not error at runtime — it serves
vanilla, and every mixin anchored in it stops applying with nothing logged. That is the
failure the whole section exists to make loud.

### Standalone modes

```sh
node scripts/regen.mjs --diff  <prev.json> <next.json>   # diff two existing maps
node scripts/regen.mjs --verify <map.json> <unpacked-main-dir> [<chunkId>=<unpacked-chunk-dir> ...]
```

The `<chunkId>=<dir>` pairs are explicit rather than inferred from a directory naming
convention, so a typo'd path is a hard error instead of a silent SKIPPED.

Convenience scripts (`package.json`): `pnpm fetch 0.7.0`, `pnpm gen`, `pnpm diff -- …`,
`pnpm verify -- …`, `pnpm regen 0.7.0`.

## Physics WASM location and patching (#43) — now in `@tspml/wasm`

Not part of the five-stage pipeline; it answers a separate question. The obvious way to
patch `polytrack_physics.wasm` is by **raw byte offset**, and that has the worst possible
failure mode — a stale offset doesn't miss, it writes a float into whatever now lives at
that address.

The locator and writer **used to live here** as `src/wasm-locate.mjs` and
`src/wasm-patch.mjs`. They now live in [`source/wasm`](../../source/wasm)
(`@tspml/wasm`), which this package depends on. The move was forced by where the code
needs to run: this workspace is dev-only (it pulls webcrack, whose optional native build
CI skips), so the portal could never import from it — and the portal is what has to serve
patched physics bytes at runtime. Keeping a second copy here would mean two
implementations of a fail-closed binary patcher, which is the kind of drift you find out
about by corrupting someone's physics sim. One implementation, two callers.

What stays here is `scripts/wasm-patch-validate.mjs`, which exercises the package against
the real cached binary in `.cache/` — a local-only check, since that binary is never
committed.

`fingerprint` identifies a function by the sorted multiset of its float constants plus an
opcode-byte histogram — no offsets, no indices, so relocation cannot change it. Measured
against the real 0.6.2 binary: **535 of 549 functions (97.4%) uniquely identified**, and a
real 4,096-byte shift re-derives the correct new address where a hardcoded offset points
at garbage.

`locateBySignature` **fails closed on ambiguity as well as absence** — same posture as
the `bundleHash` gate.

### The writer half

Built on the locator. A **patch plan** is data: a pinned `wasmHash` (sha256 of the exact
binary the plan was verified against) plus `{ name, signature, oldValue, newValue }`
entries. `applyF32Patches(buf, plan)` gates, in order, all fail-closed:

1. the binary's hash must equal the pin — a new PolyTrack release trips this by design;
   re-derive with the locator, verify by hand, pin the new hash;
2. the signature must locate **exactly one** function;
3. `oldValue` must match **exactly one** `f32.const` site in it (the ±clamp shape from
   the spike is refused, not guessed at);
4. values must be finite; two patches may not resolve to the same offset.

Application is **all-or-nothing** (one failing patch = vanilla bytes back), the input
buffer is never mutated, and the success report always carries
`leaderboardRisk: 'warn'` — physics tuning is exactly the category the warn-only
classifier exists to label. The player decides; nothing blocks.

What remains for M11 is the *plumbing*, not the mechanism: a mod-facing manifest
surface for physics plans and the portal serving the patched bytes.

Also found: the physics binary is **byte-identical across 0.6.0/0.6.1/0.6.2**, so
there is no second version to cross-validate against yet — the first real test is the
next PolyTrack release. Full write-up:
[`docs/research/wasm-structural-location.md`](../../docs/research/wasm-structural-location.md).

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

## Raising the match rate: structural fingerprints (#1)

`src/fingerprint.mjs` parses a module with `@babel/parser` and scores 34 **rename-invariant**
shape facts (function arity distribution, control-flow mix, nesting depth, computed-vs-static
member access), compared by cosine. It is a **tie-breaker for the matcher, not a matcher** —
it may only promote a candidate the lexical scorer already ranked, and never overrides a
decisive lexical win.

Measuring the residual retired #1's premise. The 10 unmatched game-logic modules are *all*
rejected by the **margin** gate, not by anchor scarcity — two have the correct target already
in first place, discarded for leading by 1.15× instead of 1.25×, and one has 67 anchors with
51 shared. Structure adjudicates the ties: **game-logic 0.848 → 0.939**, six promotions (all
hand-verified), zero regressions, ~540 ms for all 421 modules.

**Wired in** via `src/select.mjs`, the one place a source module's target is chosen. Both
this harness and `source/mappings/scripts/gen-map.mjs` call it, so the rate reported here is
the rate the map was built at *by construction* rather than by inspection — which matters
because #1's claim is a **delta** between two rates, and two drifting copies of the scorer
would make that number unfalsifiable.

```sh
node src/match.mjs <src> <tgt>                      # baseline, both OFF     -> 0.848
node src/match.mjs <src> <tgt> --structural         # tie-break ON           -> 0.939
node src/match.mjs <src> <tgt> --structural --edges # + edge pass            -> 0.97
GEN_STRUCTURAL=0 / GEN_EDGES=0 node ../../source/mappings/scripts/gen-map.mjs ...  # off in the generator
```

## Raising it again: call-graph edges (#1, second half)

For the four modules where **both** content signals saturate (tiny enum/table-shaped
modules fingerprint identically), `src/edges.mjs` uses the one signal minification
cannot touch: webpack's `require("./N.js")` edges, translated through the pass-1
matches. Unlike the structural tie-break it **generates** candidates from the graph —
the two rescuable modules' correct targets never surfaced lexically at all — so its
gates are stricter: exact forward+reverse agreement, no extra claimed edges, ≥ 2 edges,
a unique qualifying target, and no cross-source contest. Failing any gate records a
reason (`insufficient-edges` / `no-candidate` / `ambiguous` / `contested`) instead of
guessing. Measured: **game-logic 0.939 → 0.97**, two rescues (hand-verified), two
css-loader modules honestly refused with zero translatable neighbours.

Full write-up — including the rescues' edge evidence, the refusals, and the resolver
evidence ranking (`lexical > structural > edge` on stable-name collisions):
[`docs/research/structural-fingerprints.md`](../../docs/research/structural-fingerprints.md).

## Tests

```sh
pnpm test    # 148 unit tests — CI-runnable, no bundle needed
```

Covering `diff` (36, incl. the chunk-pin report + carry guard #98), `verify-targets`
(20, incl. per-surface routing #98), `chunk-pins` (15, #98), `fetch` (8, incl. chunk
discovery #3), the webcrack-library guard (2, #5), the isolated-vm ABI branches (5, #2),
`regen`'s Node-invocation helper (5, #25), `regen --verify` end-to-end (4, #98 —
spawns the real script, because the thing most likely to break is the exit code and an
exit code only exists in a process), `fingerprint` (20, #1), `select` (17, #1) and
`edges` (16, #1).

The #43 WASM tests moved out with the code they cover: 27 of them now run in
[`source/wasm`](../../source/wasm) via `pnpm --filter @tspml/wasm test`.
The pure logic is unit-tested with fixture maps and temp module directories. The
bundle-dependent stages (`fetch`, `unpack`, `gen-map`, the full `regen`) are local-only
(webcrack + the gitignored `.cache/`), like the M1 spike tests in `source/transform`.

## Legal posture

The PolyTrack bundle is proprietary. `fetch` downloads the user's own live game copy
into the **gitignored** `.cache/` for offline analysis; **the bundle is never
committed** — only mapping metadata (the JSON map) ships, never game code. `.cache/` is in
`.gitignore`; verify this before any commit.
