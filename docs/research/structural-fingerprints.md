# Structural fingerprints — raising the auto-map match rate (#1)

> **Date:** 2026-08-04. **Result: game-logic match rate 0.848 → 0.939** on the real
> 0.6.0 → 0.6.2 pair, six modules promoted, zero regressions, all six hand-verified.
> **This corrects [#1](https://github.com/roowus/TSPML/issues/1)'s stated diagnosis** and,
> with it, a claim in [`mappings-drift-spike.md`](mappings-drift-spike.md).

## The premise was wrong

The M1 spike attributed the residual ~15% to *"low-anchor modules (1–2 string literals)"*
and concluded that AST structural matching was needed to reach them **at all**. Measuring
the residual directly says otherwise. All 10 unmatched game-logic modules are rejected by
the **margin** gate (`best.w >= 1.25 * second.w`) — none by anchor scarcity:

| src | anchors | best | weight | second | weight | ratio | |
|---|---|---|---|---|---|---|---|
| `1066.js` | 9 | `3339.js` | 34.9 | `641.js` | 29.4 | 1.18 | |
| `2247.js` | 2 | `2600.js` | 10.2 | `3080.js` | 10.2 | 1.00 | exact tie |
| `2387.js` | 6 | `2522.js` | 10.2 | `5492.js` | 10.2 | 1.00 | exact tie |
| `3025.js` | 10 | `3025.js` | 29.9 | `8353.js` | 25.9 | 1.15 | **correct, rejected** |
| `5343.js` | 20 | `1648.js` | 18.5 | `8063.js` | 18.5 | 1.00 | exact tie |
| `666.js` | 18 | `2849.js` | 10.6 | `9437.js` | 9.4 | 1.13 | |
| `6979.js` | 9 | `6979.js` | 25.4 | `6252.js` | 21.4 | 1.19 | **correct, rejected** |
| `7129.js` | 4 | `1507.js` | 6.7 | `1754.js` | 6.7 | 1.00 | exact tie |
| `8739.js` | 2 | `1507.js` | 7.0 | `1566.js` | 7.0 | 1.00 | exact tie |
| `8928.js` | 67 | `8063.js` | 267.5 | `494.js` | 243.1 | 1.10 | |

Two of them (`3025`, `6979`) already have the **right** target in first place — the same
webpack id across both versions — and are discarded purely for leading by 1.15×/1.19×
instead of 1.25×. And `8928.js` has 67 anchors with 51 shared: the exact opposite of
anchor-starved.

So the useful job for structure is **not** "find matches anchors cannot see". It is
"adjudicate between the top candidates anchors already surfaced". That is a much smaller
and much more testable claim.

Note what this rules out. **Lowering the margin alone is not the fix**: it would also admit
the five exact-1.00 ties on coin-flip evidence, where lexical scoring genuinely cannot
choose. Structure is what makes admitting them defensible.

## What a fingerprint is

[`src/fingerprint.mjs`](../../tooling/mappings-pipeline/src/fingerprint.mjs) parses a
module with `@babel/parser` and counts 34 **rename-invariant** structural facts — function
count and arity distribution, arrow/async/generator kinds, control-flow constructs,
class/object/array/call/member shape, computed vs static member access, and function
nesting depth bucketed 1/2/3/4+. Counts are `log1p`-compressed and compared by cosine.

Deliberately **excluded**:

- **identifier names** — the thing minification destroys; that is what anchors are for;
- **string/number literal values** — already covered, and covered better, by the anchor
  scorer. Including them here would double-count the same evidence and hide disagreement
  between the two signals, which is precisely the signal we need;
- **source positions and byte offsets** — formatting-dependent. Same lesson as
  [`wasm-structural-location.md`](wasm-structural-location.md) learned on the WASM side.

`log1p` is not cosmetic: a module with 4,000 member expressions and one with 40 are both
"member-heavy", and uncompressed that single bucket would swamp every other feature.

## The adjudication contract

`adjudicate()` may only ever **promote a candidate the lexical scorer already ranked**, and
only when lexical evidence was too close to call. It can never invent a match and never
override a decisive lexical win — anchors are direct evidence about a module's content,
structure is only ever circumstantial.

Two design points that measurement forced:

**Only candidates inside the lexical tie band get a vote.** Scoring the whole top-K was the
first implementation and it silently vetoed a correct decision. For `8928.js`, structure
separates the two tied heavyweights decisively (`8063.js` 0.99898 vs `494.js` 0.71643) —
but `1648.js`, an order of magnitude behind lexically at weight 18.5, scored 0.98159 on
shape and collapsed the gap to 0.017, below threshold. A candidate already rejected on
direct evidence must not get a structural veto. Fixing this alone took the rate from 0.909
to 0.939.

**A near-tie in *both* signals returns `null`.** This is the honest "unresolved" that
belongs in front of a human, not a shortfall. It is also unavoidable: tiny enum-shaped
modules fingerprint **identically**. `3025.js` scores an exact `1.00000` against `3025.js`,
`1196.js` and `6830.js` alike — a 34-bucket histogram does not carry enough bits to
separate a two-member enum from another two-member enum. A gap of 0 is the fingerprint
correctly reporting that it cannot tell.

## Results

| | game-logic matched | rate |
|---|---|---|
| baseline (lexical anchors only) | 56 / 66 | 0.848 |
| top-K scored (first attempt) | 60 / 66 | 0.909 |
| **tie-band scored (shipped)** | **62 / 66** | **0.939** |

**Zero regressions** — no module the baseline matched is lost. Fingerprinting all 421
modules costs **~540 ms**, and 0 of 421 failed to parse.

### All six promotions, hand-verified

Each was checked by reading both module bodies, not by trusting the score:

| src | → | evidence |
|---|---|---|
| `2247.js` | `3080.js` | **byte-identical** (124 B both) — a `Checkpoint`/`Finish` enum |
| `2387.js` | `5492.js` | same class, 518 vs 519 B; identical constructor signature |
| `1066.js` | `3339.js` | identical private-field constructor, `Vector3(0,1,0)` → `Pq0(0,1,0)` |
| `5343.js` | `1648.js` | source's `Math.ceil(i / 3 * 4)` present in `1648`, **absent** in `8063` |
| `666.js` | `2849.js` | identical `decodeURIComponent` + `substring(5, 5+r)` body |
| `8928.js` | `8063.js` | identical `TextDecoder("utf-8")` + `substring(4+i)` metadata body |

In `2247` and `2387` the lexical "best" was a much larger module that merely **imports**
the correct one — the failure mode a size-blind anchor score is prone to, and one structure
catches cleanly.

### The four still open

`3025.js`, `6979.js`, `7129.js`, `8739.js`. All are small and enum//table-shaped, where the
histogram saturates. `3025` and `6979` are the frustrating ones: their correct target is
lexically first *and* structurally 1.00000, but so are two or three other candidates.
Separating these needs a signal that survives minification and carries more bits than a
shape histogram — call-graph edges between already-matched modules is the obvious next
step, since a module's *neighbours* are far more distinctive than its shape.

## Status: wired in

**Retraction.** An earlier revision of this section said `fingerprint.mjs` was "standalone
and not yet wired into `gen-map.mjs`". It is now wired in, through a new
`src/select.mjs` that both `match.mjs` and `source/mappings/scripts/gen-map.mjs` call.

The scorer had been written twice, verbatim — once in the measurement harness that reports
the rate and once in the generator that writes the map a mod actually resolves against.
That was tolerable while both were a frozen copy of the M1 spike; it stopped being
tolerable the moment the claim became a *delta between two rates*. If the two copies could
drift, `0.848 → 0.939` would be a statement about `match.mjs` and not about the map, and
the number in the README would be unfalsifiable. Both now share one decision function, so
the rate the harness reports is the rate the map was built at by construction.

`match.mjs --structural` turns the tie-break on (default **off**, so the same command
produces the baseline); `GEN_STRUCTURAL=0` turns it off in the generator (default **on**).
Reproduced through the wired pipeline: **0.848 → 0.939 game-logic, 0 regressions,
0 changed targets**, `gen-map` 56 → 62 modules, ~0.585 s total.

### Two findings the integration turned up

**30 promotions, not 6.** The harness reports 30 structural promotions across the whole
corpus; the six in the table above are the *game-logic* ones. The other 24 were verified
with `cmp -s` rather than assumed: every one is a byte-identical source→target pair, mostly
`module.exports = require.p + "images/*.svg"` asset stubs. They raise the overall rate
(0.82 → 0.966) and are uninteresting individually.

**A real defect in the resolver, which this change would otherwise have shipped.**
`regen --diff` reported `stableNames: 8 relocated`. Root cause was not in the fingerprints
at all: `buildIndex` in `source/mappings/src/resolver.ts` was first-wins over
`Object.values(map.modules)` — i.e. over JSON key order. Structural promotions land earlier
in the regenerated file, so they took **8 pre-existing stable names** off lexically-matched
modules purely by file position, inverting the very evidence ordering `adjudicate()`
enforces inside a single module's decision. The index now ranks collisions by evidence
(lexical beats structural, then higher `matchWeight`, then `moduleId` for determinism).
Measured directly: **insertion-order re-points 19 pre-existing names; evidence-ordered
re-points 0**, and adds 14 newly-resolvable ones. The change is now purely additive, which
is what adding modules to a map is supposed to be.

**A second defect, and one that attacked this very document.** The first version of the
integration read `bestShared` — the diagnostic recorded for each *unresolved* module — off
`chooseTarget`'s return value. That function returns `null` exactly when it declines to
pick, so every unresolved module was written down as sharing **0** anchors. The table at the
top of this page is why that matters: it says all 10 residual modules are rejected by the
**margin gate**, not by anchor scarcity, and that `3025.js` shares 9 of its 10 anchors. A
map reading `0/10` asserts the opposite, and would send the next reader hunting for missing
anchors instead of a too-tight margin. `bestShared` now comes from `topCandidates(..., 1)`,
which reports the lexical leader whether or not the gate accepted it — restored to
`9/10, 8/9, 2/4, 2/2`, matching the committed map.

It surfaced from reading the regenerated map's `unresolved` section against the committed
one. Every automated gate was green: tests passed, the diff came back LOW RISK, targets
verified 5/5. Verifying the parts is not verifying the whole.

`decidedBy` and `structuralSimilarity` are now emitted per module and validated on load —
an *unrecognised* `decidedBy` is rejected rather than tolerated, because a typo'd value read
as "not structural" would quietly win a collision it should lose. Absent means lexical, so
pre-#1 maps keep resolving exactly as before.

Still deliberately out of scope: **promoting the committed `polytrack-0.6.2.json`**. The
candidate map verifies LOW RISK with 5/5 targets passing, but regenerating it changes what
shipped mods resolve against and is a separate call.

## Reproducing

```bash
cd tooling/mappings-pipeline
pnpm test                        # 107 unit tests, no bundle needed (20 fingerprint, 17 select)
# the measured rate needs the gitignored cached bundles. Both rates, one command each:
node src/match.mjs .cache/webcrack/v060-renamed .cache/webcrack/v062-raw              # 0.848
node src/match.mjs .cache/webcrack/v060-renamed .cache/webcrack/v062-raw --structural # 0.939
```

Every guard in `fingerprint.mjs` was mutation-checked before being trusted — the defect
each test describes was reintroduced and the test watched go red. (Counts are as measured
at the time, against a 55-test suite; the suite is 106 now.)

| mutation | result |
|---|---|
| track `fnDepth` as mutable state instead of passing it down | 1 failed / 54 passed |
| return a zero vector instead of `null` on a parse failure | 1 failed / 54 passed |
| drop `log1p` compression | 1 failed / 54 passed |
| let structure override a decisive lexical win | 2 failed / 53 passed |
| score the whole top-K instead of the lexical tie band | 1 failed / 54 passed |
| accept a hairline structural gap (`minStructural` removed) | 2 failed / 53 passed |
| stop distinguishing computed from static member access | 1 failed / 54 passed |
| restored | 55 passed |

The guards added by the integration were checked the same way — `select.mjs` against its own
16 tests, `resolver.ts` against `source/mappings`' 28:

| mutation | result |
|---|---|
| apply the evidence floor to the lexical leader, not the chosen candidate | 1 failed / 15 passed |
| default `structural` on without an `fpOf` to get shapes from | red |
| drop the name tie-break in `topCandidates` (regen stops being reproducible) | red |
| revert `buildIndex` to first-wins (`if (held === undefined)`) | 3 failed / 25 passed |
| read `bestShared` off `chooseTarget` rather than the lexical leader | map reports `0/10` where the committed map says `9/10` |
| restored | 17 and 28 passed |

**One of those mutations initially stayed green, and the test was the thing at fault.**
Rewriting the floor to read the lexical leader did not fail the test meant to catch it: the
fixture used weights 7 and 6, both *under* the floor (`count >= 2 && w >= 8`), so neither
reading could accept and the assertion could not distinguish them. The fixture now straddles
the floor — leader 8 clears it, promoted candidate 7 does not — and asserts the promoted
candidate's own weight and `accepted: false`. It goes red as intended. A mutation that
survives is as often a weak test as a redundant guard, and the two are worth telling apart
before writing either off.
