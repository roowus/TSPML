# Conventions

## Language & style

- **TypeScript** everywhere (`strict`). ESM (`"type": "module"`). Target modern browsers/Vercel Edge.
- Mods may be plain JS — the published `@tspml/api` types are opt-in.
- Match the surrounding code; prefer small, focused modules.

## Repo layout

- `source/` — runtime packages (loader, api-bridge, transform, mappings, portal, extension, shared).
- `tooling/` — build-time/offline tools (mappings-pipeline, create-tspml-mod, cli).
- `environments/` — dev harness + demo mods.
- `packages/` — publishable packages (`@tspml/api`).
- `docs/` — all documentation (docs-first: docs must not drift from code; generate API reference from type defs where possible).
- `scripts/`, `tests/` — helpers and cross-package tests.

## Never commit

- The PolyTrack game bundle, WASM, or deobfuscated source (legal posture — ship only our code + mappings metadata).
- Build output (`dist/`, compiled JS/`.d.ts`), `node_modules`, `.vercel`, secrets. (Build artifacts are gitignored — no CI-bot-committed compiled output, unlike PML.)

## Commits

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- Keep history clean; no large binary blobs.

## Mappings maintenance

- The canonical stable namespace is human-curated; per-build locators come from the auto-pipeline (M9, gated on M1) and are human-reviewed via the diff tool.
- On a new PolyTrack release, regenerate the candidate map, review the diff, and commit a versioned map (metadata only).

## Documentation

- Every non-trivial decision gets an ADR in [../project/decision-log.md](../project/decision-log.md).
- Update [../project/progress.md](../project/progress.md) at each milestone.
