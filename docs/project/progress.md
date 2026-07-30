# Progress

> Running changelog. Update at each milestone.

## 2026-07-30 — M0: Reset & docs-first foundation ✅

- **Reset:** wiped all prior ("bad") contents of `github.com/roowus/TSPML` without reading/reusing any of it; committed a clean foundation (git history preserved for reversibility — orphan-branch purge available on request).
- **Structure:** stood up a clean TypeScript monorepo — `docs/`, `source/{loader,api-bridge,transform,mappings,portal,extension,shared}`, `tooling/{mappings-pipeline,create-tspml-mod,cli}`, `environments/{dev-harness,demo-mods}`, `packages/api`, `scripts/`, `tests/` — with 12 workspace packages scaffolded.
- **Docs:** wrote the full documentation set — research (PolyTrack internals, PML analysis, deobfuscated bundles, Fabric architecture + JS translation, PML-shortcomings→TSPML-improvements), design (architecture, mappings system, injection & delivery, hook system, safety & fairness), API specs (mod.json, events & registries, mixin reference), project (roadmap, decision log, this progress log), and contributing guides.
- **Research basis:** a multi-agent research run (game internals, PML ×3, Fabric, two deobfuscated bundles) + an adversarial design review; the review's corrections are folded into the design and recorded as ADRs 005–010.

**Next:** M1 — de-risk spike (0.6.0↔0.6.2 mappings drift experiment, go/no-go gate) + the clean loader core with unit tests.
