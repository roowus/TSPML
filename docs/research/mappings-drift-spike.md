# M1 drift spike — go/no-go report

> **Date:** 2026-07-30. **Decision: QUALIFIED GO.** Anchor-based auto-matching is viable for ~85% of game-logic symbols across PolyTrack 0.6.0 → 0.6.2; the rest (~15%) need AST structural fingerprints (not yet built) + human-in-the-loop review. This **refines ADR-005**: the "auto-regenerate mappings within hours, fully automatic" claim is retired in favor of **semi-automated with human-in-the-loop** — still dramatically better than PML's 100%-manual per-token re-derivation, but honestly not hands-off.

## The question

TSPML's central moat is that a symbol map can be **auto-regenerated** on each PolyTrack release by structurally matching modules across builds using stable anchors. JS minified bundles have no JVM-style stable descriptors, so this was **unproven**. This spike measures it directly: given a build with **known names** (cwcinc's renamed 0.6.0), what fraction of game-logic modules can be **automatically relocated** in a different, freshly-minified build (the live 0.6.2)?

## Method

1. **Acquire bundles.** `cwcinc/polytrack-0.6.0-deobfuscated` `main.bundle.js` (3.13 MB, partially renamed — source of known names) and the live `https://app-polytrack.kodub.com/0.6.2/main.bundle.js` (1.78 MB, minified — target). Stored in a gitignored cache.
2. **Unpack.** Run **webcrack** (programmatic API — see issue/notes) on each → per-module files. 0.6.0-renamed: 210 modules; 0.6.2-raw: 211 modules (nearly identical counts — good for 1:1 matching).
3. **Match.** For each source module, extract **anchors** (string literals + distinctive numeric constants), weight by IDF (rare anchors dominate), and find the target module with the highest shared-anchor weight. Require a **margin** over the runner-up. Exclude webcrack's whole-bundle `deobfuscated.js` aggregate (a universal string sink that produced false matches).
4. **Metric.** Report the match rate on a **curated game-logic subset** — modules the rename gave real game names (`car`, `track`, `checkpoint`, `leaderboard`, `multiplayer`, `render`, …) — since broad buckets catch CSS/utility chaff.

Matcher: [`tooling/mappings-pipeline/src/match.mjs`](../../tooling/mappings-pipeline/src/match.mjs). Reproduce: `node tooling/mappings-pipeline/src/unpack.mjs <bundle> <outdir>` then `node tooling/mappings-pipeline/src/match.mjs <src> <tgt>`.

## Results

| Matcher config | Game-logic match rate | Notes |
|---|---|---|
| Contaminated (aggregate included) | ~0.40 overall | **Invalid** — the `deobfuscated.js` aggregate stole matches. Discarded. |
| Conservative (≥2 shared anchors + margin, strings+numbers) | **0.71** (47/66) | Floor. |
| Realistic (+ single globally-rare anchor) | **0.85** (56/66) | **Every subsystem ≥ 0.80.** Primary result. |

Per-subsystem (realistic): Car/Physics **0.94**, Track **0.89**, Checkpoint/Race **0.86**, Records **0.93**, Network **0.86**, Render **0.80**, UI **0.91**, Audio **1.00**.

### Worked example (verified real)

Source module `1223.js` (identifiers `controlCar`, `carState`, `createCar`, `carMassOffset`, `carCollisionShapeVertices`, … — the worker physics-protocol enum) matched target **`5220.js`** with 18 shared anchors (weight 104). High-confidence, correct. Several pairs also share **stable webpack module IDs** across versions (`1196→1196`, `1312→1312`, `1728→1728`, `3075→3075`) — a free secondary anchor (though not reliable: `1223→5220` shifted).

## What this means for the architecture

- **The moat is real but partial.** Auto-matching relocates the large majority of game-logic symbols from strings/numbers alone. This justifies the mappings-centric design — **proceed with the auto-pipeline (M9)**.
- **"Fully automatic within hours" is retired.** The honest model is **semi-automated**: the pipeline proposes ~85% of matches; a human reviews/fixes the residual ~15% via the diff tool. Update the marketing accordingly ("better DX + better diagnostics + **semi-automated** map updates").
- ~~**The residual ~15% are low-anchor modules** (1–2 string literals).~~ **Corrected
  2026-08-04 — this diagnosis was wrong.** Measuring the residual directly (see
  [`structural-fingerprints.md`](structural-fingerprints.md)) shows all 10 unmatched
  game-logic modules are rejected by the **margin** gate, not by anchor scarcity: two have
  the *correct* target already in first place and are discarded for leading by 1.15×/1.19×
  instead of 1.25×, five are exact ties, and one has 67 anchors with 51 shared. So AST
  structure's job is **adjudicating ties anchors already surfaced**, not reaching modules
  anchors cannot see. Built and measured: **0.848 → 0.939**, six promotions, zero
  regressions. Note that simply lowering the margin is *not* the fix — it would admit the
  exact ties on coin-flip evidence. The four still-unresolved cases are small enum-shaped
  modules where a shape histogram saturates; separating them needs call-graph edges between
  already-matched modules, which is the open remainder of #1.

## Caveats / what was NOT tested

- **AST/structural matching not implemented** — the ~85% is from lexical anchors only. The improvement from structural fingerprints is projected, not measured.
- **Chunk coverage.** The 0.6.2 main bundle is ~1.78 MB vs 0.6.0's ~3.4–3.7 MB — 0.6.2 splits more code into numbered chunks. Some game logic lives in chunks, not `main.bundle.js`; full coverage requires fetching + unpacking the chunks too (see issue).
- **No clean same-version control.** The polytrackmods "raw 0.6.0" build unpacked to only 120 modules (vs 211) — a structurally different build, so it's not a valid control. The matcher's precision (false-positive rate) is therefore eyeball-verified on samples, not measured against ground truth.
- **One version pair.** 0.6.0→0.6.2 is a 2-point-release gap. A larger gap (e.g., 0.5.x→0.6.2) or a 0.7.0 with a re-chunk would stress the matcher more.

## Bonus discoveries (recorded as issues)

1. **Game origin:** PolyTrack is served from `https://app-polytrack.kodub.com/<version>/`, **iframed** by `kodub.com/apps/polytrack`. The portal proxy must fetch from `app-polytrack.kodub.com`, not `kodub.com`. Confirms the portal can't iframe (CSP `frame-ancestors`).
2. **0.6.2 is more chunked** (smaller `main.bundle.js`) — chunk fetching is required for full symbol coverage.
3. **webcrack Node engine** requires 22/24 (not 25); use the programmatic API, not the CLI.
4. **`isolated-vm`** (webcrack dep, for sandboxed eval) has no working build on Node 25 — no prebuild for abi141, and a source build segfaults. Two corrections to how this was first recorded: it is a **required** dependency of webcrack, not an optional one, and it does **not** block install (pnpm 10 skips dependency build scripts, so the lockfile is committed). It only disables webcrack's obfuscator.io deobfuscation, which the minified PolyTrack bundle never triggers — unpacking on Node 25 is byte-identical to Node 22. See #2 and `tooling/mappings-pipeline/README.md`.
5. **Partial webpack module-ID stability** across versions — a cheap secondary matching signal.

## Reproducibility

```bash
# bundles cached (gitignored) under tooling/mappings-pipeline/.cache/
pnpm install
node tooling/mappings-pipeline/src/unpack.mjs .cache/pt-0.6.0-renamed-main.js .cache/webcrack/v060-renamed
node tooling/mappings-pipeline/src/unpack.mjs .cache/pt-0.6.2-raw-main.js     .cache/webcrack/v062-raw
node tooling/mappings-pipeline/src/match.mjs .cache/webcrack/v060-renamed .cache/webcrack/v062-raw
```
