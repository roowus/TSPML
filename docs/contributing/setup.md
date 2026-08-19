# Setup

> M0 ships the docs-first foundation only — there is no runnable code yet (implementation starts at M1). This page covers cloning the repo and what to expect at each stage.

## Prerequisites (when code lands)

- Node.js ≥ 20 and **pnpm** (workspaces) — `corepack enable && corepack prepare pnpm@latest --activate`.
- Git, and a GitHub account with push access to `roowus/TSPML` for contributors.

## Clone

```bash
git clone https://github.com/roowus/TSPML.git
cd TSPML
```

## Workspace layout

This is a pnpm monorepo. Packages live under `source/`, `tooling/`, `environments/`, and `packages/`. See the root `README.md` for the map.

## Once code exists (M1+)

```bash
pnpm install            # install + link workspaces
pnpm -r build           # build all packages
pnpm -r test            # run all unit tests
```

Per-package dev loops will be documented in each package's `README.md` as they land.

## Where to start reading

1. [../design/architecture.md](../design/architecture.md) — the layered design, and the best single explanation of why TSPML is built this way.
2. [../project/roadmap.md](../project/roadmap.md) — what lands when.
3. [../project/decision-log.md](../project/decision-log.md) — the locked decisions + review corrections.
