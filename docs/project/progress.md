# Progress

> Running changelog. Update at each milestone.

## 2026-07-30 — M0: Reset & docs-first foundation ✅

- **Reset:** wiped all prior ("bad") contents of `github.com/roowus/TSPML` without reading/reusing any of it; committed a clean foundation (git history preserved for reversibility — orphan-branch purge available on request).
- **Structure:** stood up a clean TypeScript monorepo — `docs/`, `source/{loader,api-bridge,transform,mappings,portal,extension,shared}`, `tooling/{mappings-pipeline,create-tspml-mod,cli}`, `environments/{dev-harness,demo-mods}`, `packages/api`, `scripts/`, `tests/` — with 12 workspace packages scaffolded.
- **Docs:** wrote the full documentation set — research (PolyTrack internals, PML analysis, deobfuscated bundles, Fabric architecture + JS translation, PML-shortcomings→TSPML-improvements), design (architecture, mappings system, injection & delivery, hook system, safety & fairness), API specs (mod.json, events & registries, mixin reference), project (roadmap, decision log, this progress log), and contributing guides.
- **Research basis:** a multi-agent research run (game internals, PML ×3, Fabric, two deobfuscated bundles) + an adversarial design review; the review's corrections are folded into the design and recorded as ADRs 005–010.

## 2026-07-30 — M1 drift spike: QUALIFIED GO ✅

Ran the mappings go/no-go experiment (0.6.0-renamed → 0.6.2-raw via webcrack + IDF-weighted anchor matching). Result: **game-logic match rate 0.85** (floor 0.71 conservative), every subsystem ≥0.80; residual ~15% needs AST fingerprints + human review. **Decision: proceed with the auto-pipeline (M9) as semi-automated, human-in-the-loop** — the "fully automatic within hours" claim is retired (refines ADR-005). Built `tooling/mappings-pipeline` (`unpack.mjs`, `match.mjs`); full report at [mappings-drift-spike.md](../research/mappings-drift-spike.md). Bonus discoveries: game origin is `app-polytrack.kodub.com/<version>/` (iframed by kodub.com); 0.6.2 splits more into chunks; webpack module IDs are partially stable across versions. Opened follow-up issues.

## 2026-07-30 — M1 loader core: complete ✅

Implemented the clean loader core (`source/loader`, TypeScript, strict): manifest parse/validate (`manifest.ts`), semver predicates (`semver.ts`), dependency resolution with topological sort + cycle detection + version-conflict / missing-dep / `breaks` errors + `conflicts` / `recommends` / `suggests` warnings + `provides` aliases (`dependency.ts`), and orchestration with per-mod error isolation + dependency-injected entrypoint loading (`loader.ts`). **47 unit tests passing** (vitest). Known refinement: `breaks` currently refuses the whole set (hard error) — Fabric-accurate soft-disable tracked in issue #6.

**M1 complete.** Next: **M2** — mappings v1 (manual, cwcinc-seeded) + portal injection MVP (Vercel + `/api/proxy` + service worker that fetches the live game from `app-polytrack.kodub.com/<version>/`).

## 2026-07-30 — M2: mappings v1 + portal MVP ✅

- **Mappings v1** (`source/mappings`): a versioned 0.6.2 symbol map (56 module entries, real `bundleHash` `sha256:8495…`) generated from the spike's match data, plus a **fail-closed resolver** (returns no locators on a `bundleHash` mismatch — never silently mis-targets) and a `map.ts` loader/validator. Module-level granularity; symbol-level locators (`exportRef`/`prototypeFn`/`callExpression`) are M3. 20 tests passing.
- **Portal MVP** (`source/portal`): Next.js App Router app + `/api/proxy` (fetches `app-polytrack.kodub.com/<version>/`, forwards `Origin`/`Referer` to the desktop origin, SSRF-guarded to kodub hosts, CORS, cache policy, drops CSP/encoding for iframe-ability) + a service worker that intercepts kodub fetches and rewrites them to the proxy (no-loop, inline copy of the unit-tested rewriter) + a Play page. 17 tests passing (the rewrite lib).

**All 84 tests green** (loader 47 + mappings 20 + portal 17). The portal's rewrite/proxy logic is unit-tested; full "game actually runs through the proxy" validation still needs a browser (manual test plan in `source/portal/README.md`).

**Next:** M3 — the Babel AST transform pipeline resolved via the mappings file; narrow resolution from module → exact symbol locators; runtime-fallback tiers; per-mod compatibility report; IndexedDB bundle-hash caching.
