# Conventions

## Living documentation & issue tracking (core practice)

- **Docs are living.** Update Markdown whenever you learn something — a new finding, a confirmed/denied assumption, a decision, a gotcha. **No update is too small.** Stale docs are treated as a bug.
- **Record discoveries where they belong:** research findings → `docs/research/`; design changes → `docs/design/` + an ADR in `docs/project/decision-log.md`; status changes → `docs/project/progress.md`.
- **Open a GitHub issue for anything worth tracking** — questions, risks, TODOs, bugs, follow-ups, ideas — no matter how big or small. Issues are the backlog; commits close them (`Closes #N`). Prefer an issue + a doc note over keeping context only in your head or in chat.
- **Link docs ↔ issues ↔ commits** so context is never lost: an ADR can reference an issue; a research doc can list open questions as issues; a commit can reference both.

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
- Work on a feature branch (not `main`); open a PR to merge.
- Keep history clean; no large binary blobs.

## Mappings maintenance

- The canonical stable namespace is human-curated; per-build locators come from the auto-pipeline (M9, gated on M1) and are human-reviewed via the diff tool.
- On a new PolyTrack release, regenerate the candidate map, review the diff, and commit a versioned map (metadata only).

## Documentation

- Every non-trivial decision gets an ADR in [../project/decision-log.md](../project/decision-log.md).
- Update [../project/progress.md](../project/progress.md) at each milestone and at any meaningful discovery.

## Momentum & autonomy (core practice)

- **Always carry on — never stop to checkpoint or ask for sub-decisions.** When you hit a fork (which approach, naming, file placement, test strategy, doc structure), **decide what's best yourself and execute.** The owner will redirect if wrong. Stopping to ask "should I do A or B?" or "want me to continue?" breaks flow — pick one (prefer the simpler), implement it, test it, document it, commit it.
- **Don't file issues as a substitute for doing the work.** Issues are for genuine deferred follow-ups (lower priority, blocked, or needs-the-owner). If you can decide + do it now, do it — don't issue it.
- **No breaks.** When a milestone finishes, immediately start the next one. Don't pause to summarize and wait — the progress doc is the summary. Pick the next piece, decide the approach, and carry on.
- **Commit + push + verify CI, then move on.** Don't block on CI — start the next piece while CI runs. If CI fails, fix it; otherwise keep going.

## Verification & CI

- **Run it yourself — don't claim something is untested if you can test it.** If a check is executable — a unit test, `curl`, a throwaway script, a headless browser — run it before asserting it works. Never leave "needs manual testing" on something you can verify; if you genuinely can't, say exactly why and file an issue. (Concrete example: the portal proxy was validated by `curl`-ing `/api/proxy/main.bundle.js?version=0.6.2` and confirming the byte-exact live 0.6.2 bundle returns with the right content-type — no browser required for the server-side path.)
- **Automate browser/UI checks with a headless browser (Playwright).** If a step would otherwise be "open it in a browser and look," script it FIRST: launch headless Chromium, capture console messages, uncaught `pageerror`s, and failed network requests; assert on the DOM (e.g. an injected marker exists, a `<canvas>` rendered); save a screenshot. Only hand the *subjective* parts to a human ("does it look/play right"). Do not offload automatable verification to the user. (See `source/portal/scripts/smoke.mjs`.)
  - **Assert on every frame the feature touches, not just the interesting one.** The portal is two frames — the game in the `/api/proxy` iframe, our own chrome in the main frame. Every assertion in `smoke.mjs` read the game frame, so the sidebar could break entirely and the smoke stayed green ([#41](https://github.com/roowus/TSPML/issues/41)).
  - **Hardcode what you expect, not just its shape.** "The mod list is non-empty" is satisfied by the *placeholder* row, so a regression to the placeholder passes. Naming the ids the portal actually loads is what makes it an assertion.
  - **Prove the assertion fails.** Inject the regression it exists to catch, rebuild, watch it go red, then restore. Two injections into `page.tsx` (dropping `setSafetyStatus`, dropping `setLoadedMods`) both compiled cleanly and both were caught — and the second revealed that the `mods:` summary row still read `✓ …` while the list itself was empty, because it is fed by different state. A check on the summary alone would have passed.
  - **Real input is fragile on a runner, and its failure is silent.** Playwright's actionability checks time out against a swiftshader canvas; the click that exists only to hand keyboard focus to the game frame then fails, the arrow keys go nowhere, and the input-driven events never fire while every other assertion stays green. Fall back (force-click → `focus()`), re-assert focus each round, and *report which path won* so a degraded-but-green run is visible.
- **Tests are first-class.** Every package with logic ships unit tests; `pnpm -r test` must be green before merge. Prefer dependency-injected, headless-runnable tests so CI (and you) can run them anywhere.
- **CI is mandatory and runs on GitHub Actions** (`.github/workflows/ci.yml`): on every push and pull request it installs deps and runs the full suite. Don't merge with red CI; watch the **Actions** tab and fix flakes immediately.
- **Make full use of GitHub:** Actions for CI/test/build, Issues for all tracking (no matter how small), and workflow runs for heavier jobs (e.g. the mappings drift experiment) as they're added.
