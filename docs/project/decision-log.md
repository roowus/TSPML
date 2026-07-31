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
