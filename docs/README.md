# TSPML documentation

**TSPML** — *The Skibiti PolyModLoader* — a mod loader for the online 3D racing game [PolyTrack](https://www.kodub.com/apps/polytrack): a stable API, declarative mixins, and mods that survive game updates.

> Start here: [getting started (write your first mod)](./getting-started.md) → [the architecture](./design/architecture.md) → [the roadmap](./project/roadmap.md).

## Research

Background facts, all sourced.

- [PolyTrack — game internals](./research/polytrack-internals.md)
- [Deobfuscated bundles — the mappings substrate](./research/deobfuscated-bundles.md)
- [M1 mappings drift spike — go/no-go](./research/mappings-drift-spike.md) *(result: GO, semi-automated)*
- [M3 transform spike — go/no-go](./research/transform-spike.md) *(result: VIABLE — mixin transforms work on the real bundle)*
- [Portal browser-test findings](./research/portal-browser-test-findings.md) *(transform run-validated in a browser)*
- [Editor internals — scavenging notes](./research/editor-api-scavenging.md)
- [Structural fingerprints](./research/structural-fingerprints.md) · [WASM structural location](./research/wasm-structural-location.md)

### Background reading (historical)

Early design notes written while surveying the modding landscape, including tools
for other games. They are kept for provenance and are **not** required to
understand or use TSPML — the docs above stand on their own.

- [Layered loader architectures in other ecosystems](./research/fabric-architecture.md)
- [M3 transform spike — go/no-go](./research/transform-spike.md) *(result: VIABLE — JS-Mixin works on the real bundle)*
- [Portal browser-test findings](./research/portal-browser-test-findings.md) *(transform run-validated in a browser; current blockers = game's own origin/online gates)*

## Concepts

- [PML compatibility](./concepts/pml-compatibility.md) — what carries across from
  PolyModLoader mods, what is refused, and why.

## Design

The architecture and its rationale.

- [Architecture](./design/architecture.md)
- [Mappings system](./design/mappings-system.md)
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
