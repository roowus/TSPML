# M3 transform spike — go/no-go report

> **Date:** 2026-07-30. **Decision: VIABLE — GO.** Babel AST transforms surgically modify the **real, minified PolyTrack 0.6.2 bundle** (1.78 MB) and reliably emit valid, structure-intact JS. The full JS-Mixin transform pipeline (technique [C]) is green-lit for M3.

## The question

The entire mixin system (Tier 2) rests on being able to take the real minified game bundle, apply declarative patches to *specific* internal functions/literals/call-sites, and regenerate valid JS without breaking the webpack structure. This had never been tried on PolyTrack's actual bundle. This spike proves it on three concrete operations.

## What was tested (all on REAL targets in the cached 0.6.2 bundle)

| Op | Fabric analog | Real target | Result |
|---|---|---|---|
| **(a)** `before` / @Inject-HEAD | `@Inject(HEAD)` | `ClassMethod#controlCar` in the Car-protocol module | marker statement inserted as first statement of the method body |
| **(b)** `modifyArg` / literal-rewrite | `@ModifyConstant` | `ObjectProperty#version` StringLiteral | `"0.6.2"` → `"0.6.2-tspml"` — **exactly 1 site** edited; 13 other `version:"0.6.2"` literals untouched |
| **(c)** module-load intercept (technique [B]) | classloader hook | the webpack factory for the Car module | HOF-wrapped: pre-log → original factory → post-log → return |

The three ops **compose** on the same module: (c)'s wrapper inlines the original factory, which already carries the (a)+(b) edits.

## Validation (independently re-verified)

- **parse-ok:** original bundle parsed with **0 errors**; regenerated output re-parsed with **0 errors**. Cross-checked with **`node --check`** (V8) on the full 1.79 MB output — passes (stronger than Babel's own re-parse).
- **injection-present:** all four markers found in the generated source.
- **structure-intact:** the webpack IIFE `(()=>{...})()` is preserved; the module-map entry count is **211 == 211** before/after (matches the webcrack unpack count).
- **size + timing:** 1,782,239 → 1,789,083 bytes (+6,844, ~0.4%); parse ~280 ms, transform ~130 ms, generate ~90 ms, re-parse ~160 ms — all well under interactive limits.

7 vitest tests assert these gates; all pass locally (they skip on CI since the real bundle is gitignored — see the test file header).

## Most robust selector strategy (the key M3 decision)

1. **Module anchor = TypeScript-enum string literals** (`CreateCar` ∧ `ControlCar` ∧ `TestDeterminism`). These survive minification, are globally unique to the Car module, and the M1 drift spike measured 0.94 Car/Physics precision with this technique.
2. **Method anchor = preserved class-method name** (`controlCar`). Method names are **not** mangled here (terser keeps object/class member names) — confirmed 5 occurrences, all in-subsystem.
3. **Literal anchor = the structural property KEY** (`version`), **not** the literal value. The value changes every release; the property-name anchor doesn't.
4. **AVOID webpack module ids** as anchors — empirically unstable (drift spike: `1223→5220`). Find the module by anchor; only *read* the id for reporting.

`@babel/parser` (`sourceType: "unambiguous"`, `errorRecovery: true`, `allowReturnOutsideFunction: true`) handles the 1.78 MB file fine.

## Fragilities / open questions for the full M3 pipeline

- **Call-site `@ModifyArg`/`@Redirect`** (vs literal): needs an INVOKE-style AST locator analogous to Fabric's `@At("INVOKE", target=...)`. Not built here — the drift spike flagged ~15% of modules need AST structural fingerprints (M9 / issue #1).
- **Module-load interception:** prefer the **module-map-entry wrap** demonstrated here over wrapping `__webpack_require__` (the global require is mangled + buried). Same reach, far less fragile.
- **HOF-wrap safety:** safe here because webpack factories are simple arrows that mutate `exports`/`t` and don't use `this`. A full wrap (call the original in place rather than inline) is the safer production form if a factory ever relies on lexically-scoped helpers outside its body.
- **Source maps:** not emitted by the spike (`compact:true`). M3 must emit source maps so game stack traces stay debuggable.
- **Chunk coverage:** only `main.bundle.js` was tested; 0.6.2 splits more into numbered chunks (issue #3) — the transform must run per-chunk.
- **Bundle hash / fail-closed:** the transform must refuse to apply when the live bundle hash ≠ the map's hash (the resolver already enforces this — see `source/mappings`).

## Reproduce

```bash
pnpm install --ignore-scripts          # root; Babel needs no native build
node source/transform/src/spike.mjs    # prints the verdict + validation table
pnpm --filter @tspml/transform test    # 7 tests (skip on CI without the cached bundle)
```

## Impact

Green-lights building the real `source/transform` pipeline: the mixin-op API (`before`/`after`/`around`/`replace`/`modifyArg`) resolved through the mappings file, symbol-level locators, source-map emission, and per-chunk transforms. Recorded as ADR-011.
