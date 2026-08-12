# TSPML documentation

**TSPML** — *The Skibiti PolyModLoader* — a versatile-yet-simple mod loader for the online 3D racing game [PolyTrack](https://www.kodub.com/apps/polytrack): a stable API, declarative mixins, and mods that survive game updates.

> Start here: [getting started (write your first mod)](./getting-started.md) · [why TSPML exists](./research/pml-shortcomings-and-tspml-improvements.md) → [the architecture](./design/architecture.md) → [the roadmap](./project/roadmap.md).

## Research

Background facts, all sourced.

- [PolyTrack — game internals](./research/polytrack-internals.md)
- [PolyModLoader (PML) — incumbent analysis](./research/polymodloader-analysis.md)
- [Deobfuscated bundles — the mappings substrate](./research/deobfuscated-bundles.md)
- [Fabric architecture & its JS translation](./research/fabric-architecture.md)
- [**PML shortcomings → TSPML improvements**](./research/pml-shortcomings-and-tspml-improvements.md) *(the "why TSPML" doc — read with the re-scoring below)*
- [**PML's API story + an honest moat re-scoring**](./research/pml-api-and-moat-reassessment.md) *(2026-08-03, vs. `v0.6.2-2`: two of our claims corrected; they're ahead on physics)*
- [M1 mappings drift spike — go/no-go](./research/mappings-drift-spike.md) *(result: GO, semi-automated)*
- [M3 transform spike — go/no-go](./research/transform-spike.md) *(result: VIABLE — JS-Mixin works on the real bundle)*
- [Portal browser-test findings](./research/portal-browser-test-findings.md) *(transform run-validated in a browser; current blockers = game's own origin/online gates)*

## Design

The architecture and its rationale.

- [Architecture](./design/architecture.md)
- [Mappings system (the Yarn analog)](./design/mappings-system.md)
- [Injection & delivery](./design/injection-and-delivery.md)
- [Hook system](./design/hook-system.md)
- [Safety & fairness](./design/safety-and-fairness.md)

## API

The mod-facing surface.

- [`mod.json` spec](./api/mod-json-spec.md)
- [Events & registries (Tier 1)](./api/events-and-registries.md)
- [Mixin reference (Tier 2)](./api/mixin-reference.md)

## Project

- [Roadmap (M0–M10)](./project/roadmap.md)
- [Decision log (ADRs)](./project/decision-log.md)
- [Progress](./project/progress.md)

## Contributing

- [Setup](./contributing/setup.md)
- [Conventions](./contributing/conventions.md)
