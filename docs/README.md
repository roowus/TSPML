# TSPML documentation

**TSPML** — *The Second Poly Mod Loader* — a versatile-yet-simple mod loader for the online 3D racing game [PolyTrack](https://www.kodub.com/apps/polytrack), inspired by [Fabric](https://fabricmc.net/) for Minecraft.

> Start here: [why TSPML exists](./research/pml-shortcomings-and-tspml-improvements.md) → [the architecture](./design/architecture.md) → [the roadmap](./project/roadmap.md).

## Research

Background facts, all sourced.

- [PolyTrack — game internals](./research/polytrack-internals.md)
- [PolyModLoader (PML) — incumbent analysis](./research/polymodloader-analysis.md)
- [Deobfuscated bundles — the mappings substrate](./research/deobfuscated-bundles.md)
- [Fabric architecture & its JS translation](./research/fabric-architecture.md)
- [**PML shortcomings → TSPML improvements**](./research/pml-shortcomings-and-tspml-improvements.md) *(the "why TSPML" doc)*
- [M1 mappings drift spike — go/no-go](./research/mappings-drift-spike.md) *(result: GO, semi-automated)*

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
