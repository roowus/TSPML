# Decision log (ADR-style)

> Architecture Decision Records. Newest context first within each group. Dates are absolute.

## Locked product decisions (from the project owner, 2026-07-30)

**ADR-001 — Delivery flagship: Vercel-hosted portal website.**
*Decision:* The primary way to play modded is a portal website (like `web.polymodloader.com`) hosted on Vercel, using a CORS proxy + origin handling to load the real game. The browser extension and userscript are secondary fallbacks.
*Rationale:* Owner preference for a zero-install web experience matching the incumbent.
*Tradeoff accepted:* This path inherits origin-trust + ToS gray areas (CSP blocks iframing/CORS; origin must be forwarded via proxy). Mitigations in [injection-and-delivery.md](../design/injection-and-delivery.md) and [safety-and-fairness.md](../design/safety-and-fairness.md). The extension remains the resilient fallback.

**ADR-002 — Online fairness: warn-only.**
*Decision:* Label physics/multiplayer mods and disclose risk; do **not** hard-disable leaderboard uploads.
*Rationale:* Owner preference (permissive). The classification machinery is built so a stricter policy can be adopted later by changing only the gating.

**ADR-003 — Language: TypeScript.**
*Decision:* TypeScript throughout (loader, bridge, tooling, portal) + a published `@tspml/api` types package. Mods may be plain JS.
*Rationale:* Type safety + typed mod-authoring autocomplete (the "Yarn dev names" DX win).

**ADR-004 — PML compatibility: narrow importer.**
*Decision:* Import car skins, audio, and custom blocks (covers most existing PML mods). Do **not** emulate PML's mixin engine.
*Rationale:* A full emulator would reintroduce the exact per-update fragility TSPML exists to eliminate (self-defeating, per the design review). Deep-mixin PML mods get a porting guide instead.

## Review-driven corrections (2026-07-30, from the adversarial design review)

**ADR-005 — Validate the mappings "moat" before building on it.** The auto-regeneration claim is unproven for minified JS bundles. M1 is a hard go/no-go drift experiment; until it passes, market as "better DX + better diagnostics," not "update-resilient." ([roadmap.md](./roadmap.md))
**UPDATE (2026-07-30, spike result): VALIDATED as semi-automated — GO.** Game-logic match rate **0.85** (0.71 conservative) across 0.6.0→0.6.2; every subsystem ≥0.80. Decision: proceed with the auto-pipeline (M9), repositioned as **semi-automated with human-in-the-loop** (~85% auto, ~15% human review; AST structural fingerprints not yet built). The "fully automatic within hours" overclaim is retired. See [mappings-drift-spike.md](../research/mappings-drift-spike.md).

**ADR-006 — Capabilities are consented-advisory, not "enforced."** Same-realm JS cannot enforce isolation without SES/membrane. Docs and the loader must say this plainly.

**ADR-007 — Physics events execute inside the worker.** No main-thread round-trip (it breaks deterministic replay + adds latency). Physics mods compile into the transformed sim-worker; main-thread mods observe but don't influence the tick.

**ADR-008 — Fail-closed on stale maps.** On `bundleHash` mismatch, never apply AST/physics/ranked locators from a non-matching map; only runtime-fallback event hooks may bind.

**ADR-009 — The portal cannot iframe/fetch the real game directly.** It works only via the service-worker + `/api/proxy` path. The "zero-install play on tspml.dev of the real game" is achieved through proxying, not embedding.

## Audit correction to the PML-shortcomings analysis (2026-07-30)

**ADR-010 — PML can reach physics.** The research draft's claim that "sim-worker mixins are unimplemented post-0.6.0 / physics mods are blocked" is **wrong** against the 0.6.1 source (`registerSimWorkerMixin` + `getSimURL()` are implemented). TSPML's physics advantage is **DX + determinism-quarantine + a stable event surface**, not "enabling what PML couldn't." Recorded in [pml-shortcomings-and-tspml-improvements.md](../research/pml-shortcomings-and-tspml-improvements.md).

## M3 transform spike result (2026-07-30)

**ADR-011 — JS-Mixin AST transform is viable on the real bundle (M3 green-lit).** A Babel spike injected a HEAD-hook into `controlCar`, rewrote a literal, and wrapped the Car module's webpack factory in the **real 0.6.2 bundle**; the regenerated output passes `node --check`, module-map 211==211, +0.4% size, sub-second. **Decision:** build the full `source/transform` mixin pipeline. **Selectors locked:** module = enum string-literal anchor; method = preserved name; literal = property key (not value); **avoid** webpack ids. Module-map-entry wrap (not `__webpack_require__`) for technique [B]. Source maps, per-chunk transforms, and INVOKE-style call-site locators remain open M3/M9 work. See [transform-spike.md](../research/transform-spike.md).

## Portal browser-test findings (2026-07-31)

## Gate neutralized + portal plays end-to-end (2026-07-31)

**ADR-013 — The unofficial-version gate is cleared via the game's own mod-loader hook (not a bundle transform); the portal now plays PolyTrack end-to-end.** Tracing the gate in the unpacked 0.6.2 bundle showed it reads `window.polytrackModConfiguration` (the same hook PML uses to identify a mod load). Supplying `{modName, author}` sets `Qo()=true`, which clears the gameplay gate and re-badges the banner "Unofficial TSPML mod by roowus". **Decision:** neutralize the gate by injecting `<script>window.polytrackModConfiguration=…</script>` into the proxied HTML `<head>` (before the deferred bundles), gated on `TSPML_TRANSFORM=1` — **delivery-layer HTML injection, not bundle surgery, and no origin-spoof.** This is both cleaner than a transform *and* the only viable option (the check lives outside the webpack module graph, so a module-anchor transform can't reach it). Outcome (headless-verified): the transformed game boots → gate clears → assets + a track load → a **real race on "Summer 1"** with full HUD renders, green `TSPML ✔ LIVE` badge live, 149× 200 / 0 failed requests. The earlier "Failed to load track" (#9) — hit by the user on a plain first visit — was the SW not yet *controlling* the page when the game fetched the track; **fixed by mounting the game iframe only after `navigator.serviceWorker` `controllerchange`** (no manual reload). Only an online `502` remains (#7, M8). The smoke test now PASSES on gate-clearance (`pastGate`) and runs without a reload. See [portal-browser-test-findings.md](../research/portal-browser-test-findings.md).

## M9 regen/diff/verify pipeline (2026-08-01)

**ADR-014 — The update-resilience moat is operationalized as a semi-automated, human-in-the-loop regen pipeline; cross-version module identity is `sourceModuleId`, and carrying `targets` forward is gated by anchor verification.** The pipeline (`tooling/mappings-pipeline`: `fetch` → `unpack` → `gen-map` → `diff` → `verify-targets`, orchestrated by `regen.mjs`) is the operational form of ADR-005's qualified-GO: the matcher auto-relocates ~85% of modules, and the new `diff` surfaces the residual for human review. Four decisions lock its soundness:

- **Cross-version identity = `sourceModuleId`.** A regen always re-matches the *same* fixed 0.6.0 renamed source against a new target, so every matched module's `sourceModuleId` (a 0.6.0 webcrack id) is identical across versions. The diff keys modules by it — **never** by the concept slug, which drifts with the scorer and would mis-pair modules. `moduleId` (the new build's id) is what relocates.
- **`targets` carry-forward is gated, not trusted.** `gen-map` carries the hand-curated `targets` section forward verbatim (it can't re-derive anchors). The diff correlates each target to its module by *max stable-name overlap* — a heuristic "what to re-verify". The **authoritative** check is `verify-targets.mjs`: it reads the unpacked new bundle and confirms all of a target's anchor literals resolve together. This extends ADR-008 (fail-closed on stale maps) from *runtime* to *review time* — a drifted anchor is caught before promotion, not at mod-load.
- **Candidate never clobbers committed.** `regen` writes `polytrack-<ver>.candidate.json` only; promotion is an explicit human `cp`. `*.candidate.json` is gitignored so the promote workflow stays clean. `regen` exits non-zero on `HIGH` risk or any target `fail`.
- **Honest scope.** The bundle-dependent stages are local-only (webcrack + the gitignored `.cache/`); only the pure `diff`/`verify-targets` logic runs in CI. "Candidate within hours" holds for the auto-matched ~85%; the rest is the human review this tooling surfaces. AST structural fingerprints remain the next match-rate lever.

Validated end-to-end on the real cached 0.6.0/0.6.2 bundles (reproducibility → 0 drift; real cross-version → 8 relocations / 49 stable-name moves; realistic direction → 3 targets `[UNRESOLVED]` → HIGH; verify-targets → all resolve to module 5220; fetch → sha256 matches the committed `bundleHash` byte-exact). See [progress.md](./progress.md) (M9) and the [mappings-pipeline README](../../tooling/mappings-pipeline/README.md).
