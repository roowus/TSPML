# tests

> **Status: empty on purpose — there is no shared harness here yet (#30).**

This directory previously advertised a "shared test harness and cross-package
integration tests". Neither exists. Everything that actually runs lives elsewhere:

| What | Where |
|---|---|
| Unit tests | Alongside each package — `source/*/tests/`, `tooling/*/tests/`, `environments/dev-harness/tests/` |
| Headless browser smokes | `source/portal/scripts/smoke*.mjs`, `environments/dev-harness/scripts/smoke*.mjs` |
| Bundle-dependent checks | `tooling/mappings-pipeline/` (local-only; needs the gitignored `.cache/`) |

Run the whole suite with `pnpm -r test` from the repo root.

**If you are adding a cross-package integration test**, this is the right home for
it — but check first whether it belongs next to one of the packages instead. The
per-package layout is deliberate: it keeps a test runnable by
`pnpm --filter <pkg> test`, which is what CI and the day-to-day loop both use.
