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

**ADR-012 — The transformed bundle is run-validated in a browser; the remaining blockers are the game's own origin/online gates, not the transform.** A headless Playwright run + manual browser load proved a **transformed** `main.bundle.js` actually **boots**: the green `TSPML ✔ LIVE` badge (injected via `after` on the Car-module factory) appears in the DOM + console, the WebGL canvas inits to 804×452 (not the empty 300×150 default), with **0 JS errors and 0 failed asset requests**. This retires the project's biggest residual risk (parse-valid ≠ run-valid). **But** the portal does not yet reach playable gameplay because PolyTrack itself raises two server/origin gates: an **"unofficial version" warning** (origin allowlist — `localhost` is not on it) and a **"Failed to load track"** unhandled rejection (track data fetch fails via proxy/SW). **Decision:** these are delivery/network/origin work (M4 neutralizes the origin gate via a transform; M7/M8 carry track data + online through the SW+proxy), **not** transform work — the transform pipeline, loader, and mappings are validated and are not the blockers. Full findings + reproduce steps: [portal-browser-test-findings.md](../research/portal-browser-test-findings.md). Issues #7, #8, #9.
