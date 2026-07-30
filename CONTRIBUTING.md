# Contributing to TSPML

Thanks for your interest! TSPML is a fan-made mod loader for PolyTrack — please read the [disclaimers](./README.md#-disclaimers) first.

➡️ **Full guides live in [`docs/contributing/`](./docs/contributing/):**

- [Setup](./docs/contributing/setup.md) — cloning and prerequisites.
- [Conventions](./docs/contributing/conventions.md) — code style, repo layout, commits, mappings maintenance.

## Quick rules

- **Never commit the PolyTrack game**, its WASM, or deobfuscated source. Ship only our code + mappings metadata. (Build artifacts are gitignored.)
- **Docs-first:** every non-trivial decision gets an ADR in [`docs/project/decision-log.md`](./docs/project/decision-log.md); update [`docs/project/progress.md`](./docs/project/progress.md) per milestone.
- **TypeScript**, strict, ESM. Conventional Commits.
- When code lands (M1+), `pnpm install && pnpm -r build && pnpm -r test` should pass before pushing.

## Where help is most useful (post-M0)

- M1: the mappings drift experiment + loader core.
- M9: the auto-mappings pipeline (the update-speed moat) — gated on M1.
- Docs, examples, and the PML resource-override importer.

See [`docs/project/roadmap.md`](./docs/project/roadmap.md).
