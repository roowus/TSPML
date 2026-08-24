# Decision log (ADR-style)

> Architecture Decision Records. Newest context first within each group. Dates are absolute.

## Locked product decisions (from the project owner, 2026-07-30)

**ADR-001 — Delivery flagship: Vercel-hosted portal website.**
*Decision:* The primary way to play modded is a portal website hosted on Vercel, using a CORS proxy + origin handling to load the real game. The browser extension and userscript are secondary fallbacks.
*Rationale:* Owner preference for a zero-install web experience — open a URL and play, with nothing to download.
*Tradeoff accepted:* This path inherits origin-trust + ToS gray areas (CSP blocks iframing/CORS; origin must be forwarded via proxy). Mitigations in [injection-and-delivery.md](../design/injection-and-delivery.md) and [safety-and-fairness.md](../design/safety-and-fairness.md). The extension remains the resilient fallback.

**ADR-002 — Online fairness: warn-only.**
*Decision:* Label physics/multiplayer mods and disclose risk; do **not** hard-disable leaderboard uploads.
*Rationale:* Owner preference (permissive). The classification machinery is built so a stricter policy can be adopted later by changing only the gating.

**ADR-003 — Language: TypeScript.**
*Decision:* TypeScript throughout (loader, bridge, tooling, portal) + a published `@tspml/api` types package. Mods may be plain JS.
*Rationale:* Type safety, and autocomplete on stable names while authoring a mod — the editor can tell you what `Car` exposes because the API declares it.

**ADR-004 — Importing mods from other loaders: narrow importer.**
*Decision:* Import car skins, audio, and custom blocks. Do **not** emulate another loader's mixin engine.
*Rationale:* An emulator would have to reproduce whatever the other engine patches, which reintroduces the exact per-update fragility TSPML exists to eliminate (self-defeating, per the design review). Mods that rely on deep mixins get a porting guide instead.

## Review-driven corrections (2026-07-30, from the adversarial design review)

**ADR-005 — Validate the mappings "moat" before building on it.** The auto-regeneration claim is unproven for minified JS bundles. M1 is a hard go/no-go drift experiment; until it passes, market as "better DX + better diagnostics," not "update-resilient." ([roadmap.md](./roadmap.md))
**UPDATE (2026-07-30, spike result): VALIDATED as semi-automated — GO.** Game-logic match rate **0.85** (0.71 conservative) across 0.6.0→0.6.2; every subsystem ≥0.80. Decision: proceed with the auto-pipeline (M9), repositioned as **semi-automated with human-in-the-loop** (~85% auto, ~15% human review; AST structural fingerprints not yet built). The "fully automatic within hours" overclaim is retired. See [mappings-drift-spike.md](../research/mappings-drift-spike.md).

**ADR-006 — Capabilities are consented-advisory, not "enforced."** Same-realm JS cannot enforce isolation without SES/membrane. Docs and the loader must say this plainly.

**ADR-007 — Physics events execute inside the worker.** No main-thread round-trip (it breaks deterministic replay + adds latency). Physics mods compile into the transformed sim-worker; main-thread mods observe but don't influence the tick.

**ADR-008 — Fail-closed on stale maps.** On `bundleHash` mismatch, never apply AST/physics/ranked locators from a non-matching map; only runtime-fallback event hooks may bind.

**ADR-009 — The portal cannot iframe/fetch the real game directly.** It works only via the service-worker + `/api/proxy` path. The "zero-install play on tspml.dev of the real game" is achieved through proxying, not embedding.

## Audit correction to the early scope analysis (2026-07-30)

**ADR-010 — Physics modding is not new ground, so don't claim it as one.** An early research draft asserted that reaching the physics sim worker was an open problem no existing tool had solved. Reading the 0.6.1 sources showed that is **wrong** — sim-worker patching is implemented and shipping elsewhere. What TSPML actually offers for physics is a **stable event surface, determinism quarantine, and the authoring experience around them**, not access that was previously unavailable. Corrected in [pml-shortcomings-and-tspml-improvements.md](../research/pml-shortcomings-and-tspml-improvements.md).

## M3 transform spike result (2026-07-30)

**ADR-011 — JS-Mixin AST transform is viable on the real bundle (M3 green-lit).** A Babel spike injected a HEAD-hook into `controlCar`, rewrote a literal, and wrapped the Car module's webpack factory in the **real 0.6.2 bundle**; the regenerated output passes `node --check`, module-map 211==211, +0.4% size, sub-second. **Decision:** build the full `source/transform` mixin pipeline. **Selectors locked:** module = enum string-literal anchor; method = preserved name; literal = property key (not value); **avoid** webpack ids. Module-map-entry wrap (not `__webpack_require__`) for technique [B]. Source maps, per-chunk transforms, and INVOKE-style call-site locators remain open M3/M9 work. See [transform-spike.md](../research/transform-spike.md).

## Portal browser-test findings (2026-07-31)

## Gate neutralized + portal plays end-to-end (2026-07-31)

**ADR-013 — The unofficial-version gate is cleared via the game's own mod-loader hook (not a bundle transform); the portal now plays PolyTrack end-to-end.** Tracing the gate in the unpacked 0.6.2 bundle showed it reads `window.polytrackModConfiguration` — a global the game itself checks so a mod loader can announce itself. Supplying `{modName, author}` sets `Qo()=true`, which clears the gameplay gate and re-badges the banner "Unofficial TSPML mod by roowus". **Decision:** neutralize the gate by injecting `<script>window.polytrackModConfiguration=…</script>` into the proxied HTML `<head>` (before the deferred bundles), gated on `TSPML_TRANSFORM=1` — **delivery-layer HTML injection, not bundle surgery, and no origin-spoof.** This is both cleaner than a transform *and* the only viable option (the check lives outside the webpack module graph, so a module-anchor transform can't reach it). Outcome (headless-verified): the transformed game boots → gate clears → assets + a track load → a **real race on "Summer 1"** with full HUD renders, green `TSPML ✔ LIVE` badge live, 149× 200 / 0 failed requests. The earlier "Failed to load track" (#9) — hit by the user on a plain first visit — was the SW not yet *controlling* the page when the game fetched the track; **fixed by mounting the game iframe only after `navigator.serviceWorker` `controllerchange`** (no manual reload). Only an online `502` remains (#7, M8). The smoke test now PASSES on gate-clearance (`pastGate`) and runs without a reload. See [portal-browser-test-findings.md](../research/portal-browser-test-findings.md).

## M9 regen/diff/verify pipeline (2026-08-01)

**ADR-014 — The update-resilience moat is operationalized as a semi-automated, human-in-the-loop regen pipeline; cross-version module identity is `sourceModuleId`, and carrying `targets` forward is gated by anchor verification.** The pipeline (`tooling/mappings-pipeline`: `fetch` → `unpack` → `gen-map` → `diff` → `verify-targets`, orchestrated by `regen.mjs`) is the operational form of ADR-005's qualified-GO: the matcher auto-relocates ~85% of modules, and the new `diff` surfaces the residual for human review. Four decisions lock its soundness:

- **Cross-version identity = `sourceModuleId`.** A regen always re-matches the *same* fixed 0.6.0 renamed source against a new target, so every matched module's `sourceModuleId` (a 0.6.0 webcrack id) is identical across versions. The diff keys modules by it — **never** by the concept slug, which drifts with the scorer and would mis-pair modules. `moduleId` (the new build's id) is what relocates.
- **`targets` carry-forward is gated, not trusted.** `gen-map` carries the hand-curated `targets` section forward verbatim (it can't re-derive anchors). The diff correlates each target to its module by *max stable-name overlap* — a heuristic "what to re-verify". The **authoritative** check is `verify-targets.mjs`: it reads the unpacked new bundle and confirms all of a target's anchor literals resolve together. This extends ADR-008 (fail-closed on stale maps) from *runtime* to *review time* — a drifted anchor is caught before promotion, not at mod-load.
- **Candidate never clobbers committed.** `regen` writes `polytrack-<ver>.candidate.json` only; promotion is an explicit human `cp`. `*.candidate.json` is gitignored so the promote workflow stays clean. `regen` exits non-zero on `HIGH` risk or any target `fail`.
- **Honest scope.** The bundle-dependent stages are local-only (webcrack + the gitignored `.cache/`); only the pure `diff`/`verify-targets` logic runs in CI. "Candidate within hours" holds for the auto-matched ~85%; the rest is the human review this tooling surfaces. AST structural fingerprints remain the next match-rate lever.

Validated end-to-end on the real cached 0.6.0/0.6.2 bundles (reproducibility → 0 drift; real cross-version → 8 relocations / 49 stable-name moves; realistic direction → 3 targets `[UNRESOLVED]` → HIGH; verify-targets → all resolve to module 5220; fetch → sha256 matches the committed `bundleHash` byte-exact). See [progress.md](./progress.md) (M9) and the [mappings-pipeline README](../../tooling/mappings-pipeline/README.md).

## Portal launcher shell (2026-08-24)

The portal was one route: a game stage and a mod sidebar, with every feature stacked into that sidebar as it was built. It now has a launcher in front of it. These four decisions are the ones that were not obvious, and each was made against a real constraint rather than a preference.

**ADR-015 — The launcher lives at `/` and the game at `/play`, as real routes; the iframe is deliberately NOT hoisted into a layout.**
*Decision:* Split the portal into a launcher shell (`/`, `/browse`, `/browse/[id]`, `/instance/[id]`) and one route that mounts the game (`/play?instance=<id>`). Launching is a navigation to `/play`; closing is navigating away, which unmounts the iframe and stops the game.
*Rationale:* Deep links are the affordance that makes a catalog worth having — `/browse/<id>` has to be shareable. Real routes also make "navigating away stops the game" true rather than simulated, which matches how a launcher is expected to behave.
*The rejected alternative is the interesting one.* Mounting the iframe in `app/layout.tsx` so it survives navigation looks like the obvious way to keep a run alive while browsing, and it is wrong rather than merely inelegant: the frame's mount is gated on `swState === 'active' && planReady` because the mixin and physics plans must be parked in the Cache API **before the frame's first bundle fetch**. A layout-level iframe boots the game while the user is still on the launcher picking mods, so every plan parks too late and the modded surfaces silently serve vanilla. The gate is load-bearing, and it only holds if the frame mounts inside the route that owns the session.
*Tradeoff accepted:* Browsing while a game runs cannot be a route. It is an overlay instead (ADR-018).
*Migration note, worth keeping:* the move was done in two commits — first `app/page.tsx` → `app/play/page.tsx` with `/` becoming a query-preserving `redirect()`, so the riskiest structural change was proven by an **unmodified** smoke suite; then `/` became the launcher and the six smoke URL constants changed. A failure in the second step could only be routing, because the first had already proven the component. The redirect stayed, which is what keeps old `?mods=…` share links working.

**ADR-016 — Instances are an overlay over one shared mod pool, never a copy of it.**
*Decision:* `tspml.userMods.v1` remains the single canonical mod library. An instance (`tspml.instances.v1`) stores a name, a game version, and `disabledModIds` — a list of ids it switches off. `applyInstanceOverlay` flattens that into `record.enabled` before any runtime consumer sees it, and the projection is never written back.
*Rationale:* The hard reason is quota. `IMPORT_LIMITS.maxCodeChars` is 2 MB against a roughly 5 MB localStorage budget, so three instances holding two mods each can exceed it — and `saveUserMods` returns `false` rather than throwing, so the failure is **quiet**. A model that copies records would degrade into silent data loss at exactly the point a user found the feature useful.
*Consequence made visible:* the UI says instances share one mod library and differ in which mods are on. Adding a mod in one makes it available to all of them; deleting an instance deletes no mods. A user who expects MultiMC-style isolation should find that out from the interface, not from a surprise.
*Note for later:* `record.enabled` stays the **global** switch. Effective state is `record.enabled && !instance.disabledModIds.includes(id)`, which is why the per-instance buttons read "skip in this instance" rather than "disable".

**ADR-017 — The registry is a curated JSON file behind a seam, with a `format` discriminator reserved from day one.**
*Decision:* `public/registry/index.json`, fetched at runtime through `lib/registry.ts`. Entries carry `kind: "mod" | "modpack"` and `format: "tspml" | "pml"`. `SUPPORTED_FORMATS` is `['tspml']` today; a `pml` entry renders a named refusal instead of being installed wrong.
*Rationale:* There is no backend, and the honest surface for tens of entries is a curated list filtered in the browser — labelled as a curated list, not dressed as a search index. Fetching at runtime rather than importing statically keeps the JSON out of the bundle and makes swapping in a real backend a one-constant change with the UI untouched.
*The discriminator is the part that matters.* The project intends to run PML-format mods eventually, natively or through an adapter. Reserving `format` in the registry schema and on `UserModRecord` costs nothing now and is what tells the importer how to **execute** the code later: TSPML expects a default-export factory receiving `api`; PML exports a named `polyMod` binding against a `pml` global. Storage schemas are much harder to retrofit than JSON files. `lib/mod-formats/` exists for the same reason, with the PML branch currently containing one refusal that names its reason.
*Stated limit, so nobody over-promises:* **PML mixins are not translatable in general.** PML patches by `toString()` + `indexOf(token)` + `eval()` against mangled identifiers; TSPML patches structurally through the mappings file and an AST. An adapter can plausibly carry lifecycle hooks, settings, keybinds, and `editorExtras` model registration, and must refuse or degrade `registerMixin`-family calls **per call** rather than aborting boot. Partial compatibility, honestly labelled, is the achievable target.
*Curation is not a trust upgrade:* a registry install still goes through `checkImportUrl` and the same host rules as a pasted manifest, and the unsandboxed-code disclosure appears at the install click.

**ADR-018 — Browsing during a run is an overlay, and its only real proof is a stamped iframe.**
*Decision:* The in-play catalog is a drawer mounted as a sibling of `section.stage` inside `div.content`, rendering the same `Catalog` component as `/browse` with `linkEntries={false}`. It never navigates.
*Rationale:* This follows from ADR-015 — a client-side route change to `/browse` unmounts the iframe and re-runs the whole boot, so the run is lost and every mod reloads. An entry title that linked to `/browse/<id>` would be that same navigation, which is why the card's title is a `<span>` here and a `<Link>` there.
*The testing decision is the substantive one.* Every cheap assertion available — the mod is in storage, the mod is listed, the sidebar says loaded, the iframe exists — stays green while the product silently re-boots the game on every install, which is the exact failure the drawer was built to prevent. `smoke-drawer.mjs` therefore writes a value onto `iframe.contentWindow` before installing and reads it back after (the frame is same-origin via `/api/proxy`, so this is reachable), making "same document" distinguishable from "remounted". This was falsified before it was trusted: adding a `key` that changes on open turned that one leg red with **every other verdict still green**.
*Related seam:* where an install lands genuinely differs by surface, so `InstallTarget` is a parameter rather than a flag. The launcher writes to the pool and says "it loads next time you play"; the drawer re-parks plans and reloads the mod set and says "installed and loaded". Each message is true where it is shown and false in the other place, which is precisely why the ending is pluggable and not a boolean.
