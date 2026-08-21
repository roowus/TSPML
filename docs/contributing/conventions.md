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
- **Prose is for humans, not for protocols.** Diagnostic strings are written in the
  house style, which uses em-dashes, `≠`, and `…`. An HTTP header value is a
  ByteString: `Headers.set` and Node's `res.setHeader` both throw above U+00FF, and
  inside a request handler that throw is an empty-bodied 500 on a request that had
  otherwise succeeded. Never put a message straight into a header, a filename, or any
  other byte-oriented slot. Route it through `headerDetail` from `@tspml/shared`, or
  the equivalent boundary for that slot. Sanitize at the boundary rather than
  ASCII-fying the message, so it stays readable everywhere else and so the next
  message written cannot reintroduce the failure by containing an apostrophe.

## Repo layout

- `source/` — runtime packages (loader, api-bridge, transform, mappings, portal, extension, shared).
- `tooling/` — build-time/offline tools (mappings-pipeline, create-tspml-mod, cli).
- `environments/` — dev harness + demo mods.
- `packages/` — publishable packages (`@tspml/api`).
- `docs/` — all documentation (docs-first: docs must not drift from code; generate API reference from type defs where possible).
- `scripts/`, `tests/` — helpers and cross-package tests.

## Never commit

- The PolyTrack game bundle, WASM, or deobfuscated source (legal posture — ship only our code + mappings metadata).
- Build output (`dist/`, compiled JS/`.d.ts`), `node_modules`, `.vercel`, secrets. Build artifacts are gitignored; nothing commits compiled output back into the repo.

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
- **AI-assistant safeguard flags are environmental, not project judgments.** Sessions
  working on this repo occasionally trip real-time safety classifiers (message-level
  "safeguards flagged this message" API errors, or per-command blocks on compound
  shell invocations). Root cause: TSPML's legitimate vocabulary — *inject into the
  minified bundle*, *hook `setCarState`*, *patch plan*, *service worker intercepts
  requests*, *bypass the version gate* — pattern-matches exploit development out of
  context, even though it is standard game-modding terminology. Handling: a flagged **message** is transient (nothing rolled back —
  re-verify in-flight edits and continue); a blocked **command** should be retried
  once as-is, then rewritten in a simpler form (e.g. `pnpm --filter <pkg> exec …`
  instead of `cd <dir> && ENV=1 pnpm …`). Neither is a verdict on the work. Tracked
  in [#70](https://github.com/roowus/TSPML/issues/70).

## Asking the owner a question (when one is genuinely warranted)

The bar for asking is high (see above) — but when a decision really is the
owner's, **explain it as if to someone who has never seen this code.** The owner
is deciding, not guessing at your shorthand. A question that assumes context the
owner does not have is worse than not asking: it produces a coin-flip answer that
reads as approval.

Every question must give:

- **Plain-language framing.** Say what the thing *is* before asking which one to
  pick. Spell out jargon and minified identifiers on first use — "`ie`, the
  module-scoped WeakMap the game uses to mark which car is the player's" beats
  "`ie`". Never make the owner grep to understand the question.
- **What each option actually means, mechanically.** Not the label — the
  behaviour. What changes in the code, what a mod author would write differently,
  what a player would see.
- **How it works.** The mechanism, in a sentence or two. If an option depends on
  something not yet built, say so explicitly — that is usually the deciding fact.
- **Pros AND cons for each, including the recommended one.** An option presented
  with only upsides is not a real choice. Name what it costs and what it forecloses.
- **A concrete before/after** where the difference is visible in code — a snippet
  of what a mod author writes under each option beats any amount of description.
- **Why you are asking at all** rather than deciding: what makes this the owner's
  call (a breaking change, a product trade-off, an irreversible action) instead of
  a fork you should have taken yourself.

State your recommendation and the reasoning for it. "Recommended" without a
because-clause is an unsupported assertion.

Also **report what you found that changes the question.** If investigation
contradicts the issue text, a doc, or something you said earlier, lead with that —
the owner may be about to decide on a premise that is no longer true. (Real case:
[#10](https://github.com/roowus/TSPML/issues/10) claimed the player flag was
unreachable from an inject; it is reachable, which changed the whole option set —
so the issue text was corrected before the owner chose.)

## Verification & CI

- **Run it yourself — don't claim something is untested if you can test it.** If a check is executable — a unit test, `curl`, a throwaway script, a headless browser — run it before asserting it works. Never leave "needs manual testing" on something you can verify; if you genuinely can't, say exactly why and file an issue. (Concrete example: the portal proxy was validated by `curl`-ing `/api/proxy/main.bundle.js?version=0.6.2` and confirming the byte-exact live 0.6.2 bundle returns with the right content-type — no browser required for the server-side path.)
- **Automate browser/UI checks with a headless browser (Playwright).** If a step would otherwise be "open it in a browser and look," script it FIRST: launch headless Chromium, capture console messages, uncaught `pageerror`s, and failed network requests; assert on the DOM (e.g. an injected marker exists, a `<canvas>` rendered); save a screenshot. Only hand the *subjective* parts to a human ("does it look/play right"). Do not offload automatable verification to the user. (See `source/portal/scripts/smoke.mjs`.)
  - **Assert on every frame the feature touches, not just the interesting one.** The portal is two frames — the game in the `/api/proxy` iframe, our own chrome in the main frame. Every assertion in `smoke.mjs` read the game frame, so the sidebar could break entirely and the smoke stayed green ([#41](https://github.com/roowus/TSPML/issues/41)).
  - **Hardcode what you expect, not just its shape.** "The mod list is non-empty" is satisfied by the *placeholder* row, so a regression to the placeholder passes. Naming the ids the portal actually loads is what makes it an assertion.
  - **Real input is fragile on a runner, and its failure is silent.** Playwright's actionability checks time out against a swiftshader canvas; the click that exists only to hand keyboard focus to the game frame then fails, the arrow keys go nowhere, and the input-driven events never fire while every other assertion stays green. Fall back (force-click → `focus()`), re-assert focus each round, and *report which path won* so a degraded-but-green run is visible.
- **Verifying the parts is not verifying the whole.** This has now cost us three
  times (#25's canary, #41's sidebar, #19's scaffold), so treat it as a rule: if
  the deliverable is a *sequence* — generate then build, read a field then fetch
  a URL, load the game then render the chrome — one test must run the whole
  sequence. In every case each individual piece had been checked and worked; the
  seam between them was what broke. Corollaries:
  - **Asserting on generated text is not asserting the generated thing works.**
    #19 shipped a scaffold whose `pnpm install` died on the first command while
    four tests asserting its file contents stayed green. Run the real compiler
    against the real output.
  - **When the failure mode is silence, running the thing never finds it.** Only
    a checker that reads the code, or a test that asserts the output *exists*,
    will. Absence throws no error.
- **A branch nothing has ever taken is untested no matter how green the suite is.**
  #98 made lazily-loaded chunks transform surfaces, and in doing so made one existing
  line reachable for the first time: the "no patches target this file" detail, which
  only a surface with no base patches produces. Until chunks existed, every proxied
  surface was `main.bundle.js`, which always has patches. That line crashed on its
  first ever execution, in production, on merged `main`. 690 tests were green and the
  PR had five passing smokes. When a change widens what can reach existing code, the
  new work is not the only thing to test — enumerate the branches the change *newly
  makes reachable* and drive each one. The tell is a code path whose preconditions
  you can only satisfy because of the change you just made.
- **Prove a new assertion fails.** Reintroduce the defect it describes and watch
  it go red before you trust it. This is cheap and it keeps catching things: two
  of #19's five guards were themselves broken (regexes matching the wrong
  interface and the import path), and mutation is what surfaced it — they were
  green either way. Same for UI: two injections into the portal's `page.tsx`
  (dropping `setSafetyStatus`, dropping `setLoadedMods`) both compiled cleanly
  and both were caught — and the second revealed that the `mods:` summary row
  still read `✓ …` while the list itself was empty, because it is fed by
  different state. A check on the summary alone would have passed.
- **Tests are first-class.** Every package with logic ships unit tests; `pnpm -r test` must be green before merge. Prefer dependency-injected, headless-runnable tests so CI (and you) can run them anywhere.
- **CI is mandatory and runs on GitHub Actions** (`.github/workflows/ci.yml`): on every push and pull request it installs deps, then runs `pnpm -r test`, `pnpm -r build`, and `pnpm -r lint`. Don't merge with red CI; watch the **Actions** tab and fix flakes immediately.
- **`pnpm -r lint` typechecks the code no build reads** ([`@tspml/typecheck`](../../tooling/typecheck), [#25](https://github.com/roowus/TSPML/issues/25)): the headless smokes and the mappings-pipeline `.mjs`. Both are loose `.mjs`, so per-package `tsc -p` never saw them and vitest never imported them — the pipeline had been silently discarding gen-map's report for exactly that reason. It runs **after** `build` because it checks scripts importing workspace declarations. Non-strict on purpose; the reasoning is in that package's README.
- **A second workflow runs the smokes against the live game** (`.github/workflows/smoke.yml`) — per-PR **advisory** plus a daily schedule, with a canary job that compares the live `main.bundle.js` against the map's pinned `bundleHash` first, so a red smoke is interpretable: canary red means the game shipped a new build and every downstream failure is expected fallout, not a regression. Deliberately **not** a required check — a required job that goes red on someone else's release trains people to ignore red.
- **Make full use of GitHub:** Actions for CI/test/build, Issues for all tracking (no matter how small), and workflow runs for heavier jobs (e.g. the mappings drift experiment) as they're added.
