# Progress

> Running changelog. Update at each milestone.

## 2026-07-30 — M0: Reset & docs-first foundation ✅

- **Reset:** wiped all prior ("bad") contents of `github.com/roowus/TSPML` without reading/reusing any of it; committed a clean foundation (git history preserved for reversibility — orphan-branch purge available on request).
- **Structure:** stood up a clean TypeScript monorepo — `docs/`, `source/{loader,api-bridge,transform,mappings,portal,extension,shared}`, `tooling/{mappings-pipeline,create-tspml-mod,cli}`, `environments/{dev-harness,demo-mods}`, `packages/api`, `scripts/`, `tests/` — with 12 workspace packages scaffolded.
- **Docs:** wrote the full documentation set — research (PolyTrack internals, PML analysis, deobfuscated bundles, Fabric architecture + JS translation, PML-shortcomings→TSPML-improvements), design (architecture, mappings system, injection & delivery, hook system, safety & fairness), API specs (mod.json, events & registries, mixin reference), project (roadmap, decision log, this progress log), and contributing guides.
- **Research basis:** a multi-agent research run (game internals, PML ×3, Fabric, two deobfuscated bundles) + an adversarial design review; the review's corrections are folded into the design and recorded as ADRs 005–010.

## 2026-07-30 — M1 drift spike: QUALIFIED GO ✅

Ran the mappings go/no-go experiment (0.6.0-renamed → 0.6.2-raw via webcrack + IDF-weighted anchor matching). Result: **game-logic match rate 0.85** (floor 0.71 conservative), every subsystem ≥0.80; residual ~15% needs AST fingerprints + human review. **Decision: proceed with the auto-pipeline (M9) as semi-automated, human-in-the-loop** — the "fully automatic within hours" claim is retired (refines ADR-005). Built `tooling/mappings-pipeline` (`unpack.mjs`, `match.mjs`); full report at [mappings-drift-spike.md](../research/mappings-drift-spike.md). Bonus discoveries: game origin is `app-polytrack.kodub.com/<version>/` (iframed by kodub.com); 0.6.2 splits more into chunks; webpack module IDs are partially stable across versions. Opened follow-up issues.

## 2026-07-30 — M1 loader core: complete ✅

Implemented the clean loader core (`source/loader`, TypeScript, strict): manifest parse/validate (`manifest.ts`), semver predicates (`semver.ts`), dependency resolution with topological sort + cycle detection + version-conflict / missing-dep / `breaks` errors + `conflicts` / `recommends` / `suggests` warnings + `provides` aliases (`dependency.ts`), and orchestration with per-mod error isolation + dependency-injected entrypoint loading (`loader.ts`). **47 unit tests passing** (vitest). Known refinement: `breaks` currently refuses the whole set (hard error) — Fabric-accurate soft-disable tracked in issue #6.

**M1 complete.** Next: **M2** — mappings v1 (manual, cwcinc-seeded) + portal injection MVP (Vercel + `/api/proxy` + service worker that fetches the live game from `app-polytrack.kodub.com/<version>/`).

## 2026-07-30 — M2: mappings v1 + portal MVP ✅

- **Mappings v1** (`source/mappings`): a versioned 0.6.2 symbol map (56 module entries, real `bundleHash` `sha256:8495…`) generated from the spike's match data, plus a **fail-closed resolver** (returns no locators on a `bundleHash` mismatch — never silently mis-targets) and a `map.ts` loader/validator. Module-level granularity; symbol-level locators (`exportRef`/`prototypeFn`/`callExpression`) are M3. 20 tests passing.
- **Portal MVP** (`source/portal`): Next.js App Router app + `/api/proxy` (fetches `app-polytrack.kodub.com/<version>/`, forwards `Origin`/`Referer` to the desktop origin, SSRF-guarded to kodub hosts, CORS, cache policy, drops CSP/encoding for iframe-ability) + a service worker that intercepts kodub fetches and rewrites them to the proxy (no-loop, inline copy of the unit-tested rewriter) + a Play page. 17 tests passing (the rewrite lib).

**All 84 tests green** (loader 47 + mappings 20 + portal 17). The portal's rewrite/proxy logic is unit-tested; full "game actually runs through the proxy" validation still needs a browser (manual test plan in `source/portal/README.md`).

**Next:** M3 — the Babel AST transform pipeline resolved via the mappings file; narrow resolution from module → exact symbol locators; runtime-fallback tiers; per-mod compatibility report; IndexedDB bundle-hash caching.

## 2026-07-30 — practices: self-test + CI ✅

- **Self-tested the portal proxy** (practice: don't claim "untested" if you can test it). Via `curl` through the dev server: `/api/proxy/main.bundle.js?version=0.6.2` returns the **byte-exact live 0.6.2 bundle** (1,782,239 B, correct `content-type`); the game index (702 B, `src="main.bundle.js"`); `simulation_worker.bundle.js` (322,808 B); and the SSRF guard returns **400** for a non-kodub host. Proxy verified end-to-end server-side — no browser needed for that path.
- **Added GitHub Actions CI** (`.github/workflows/ci.yml`): `pnpm install --ignore-scripts` + `pnpm -r test` + `pnpm -r build` on every push to `main` and every PR.
- **Caught + fixed a real bug by running the build**: `NextResponse.json(body, {status}, {headers})` passed two init objects (type error, `route.ts:144`). The unit tests missed it (the route isn't imported by tests); `pnpm -r build` caught it. Fixed to a single init object.
- **New convention:** "Verification & CI" — run it yourself; CI is mandatory.

All 84 tests + full build green locally.

## 2026-07-30 — M3 transform spike: VIABLE ✅ (GO)

De-risked the riskiest assumption of the whole project: a Babel spike surgically modified the **real 0.6.2 bundle** — HEAD-inject into `controlCar`, a literal rewrite, and a module-factory wrap — and the regenerated 1.79 MB output passes `node --check` (V8), keeps the webpack module-map at 211==211, +0.4% size, sub-second. 7 tests passing (skip on CI since the real bundle is gitignored). Robust selectors locked in: enum-string module anchors, preserved method names, property-key literal anchors, avoid webpack ids; module-map-entry wrap for technique [B]. Full report: [transform-spike.md](../research/transform-spike.md) (ADR-011).

**Next:** build the real `source/transform` pipeline on the validated approach — the mixin-op API (`before`/`after`/`around`/`replace`/`modifyArg`) resolved via mappings, symbol-level locators, source-map emission, per-chunk transforms.

## 2026-07-30 — M3 transform pipeline: complete ✅

Built the real `source/transform` pipeline on the validated spike: `transform(bundle, patches, options)` with **all 7 mixin ops** (`before`/`after`/`around`/`replace`/`modifyArg`/`modifyReturn`/`modifyConstant`), stable-name target resolution via locators (module-by-anchor → method/property/call-site), **fail-closed** on `bundleHash` mismatch (type-only `@tspml/mappings` integration, zero runtime coupling), source-map emission, replace single-winner conflict detection, and a re-parse gate (the `node --check`-equivalent). **31 tests** (24 CI-runnable fixture tests + 7 real-bundle spike); `tsc` clean under strict. Deferred to M9: INVOKE-style cross-module call-site locators, per-chunk transforms, IndexedDB caching, full compat-report UI.

**All 115 tests green** (loader 47 + mappings 20 + portal 17 + transform 31).

**Next:** M4 — event bus + API bridge (Tier 1): wire physics/render/track/input/checkpoint events through the bridge; implement registries (blocks/cars/audio/settings/keybinds).

## 2026-07-30 — transform demo + browser test harness ✅

Wired the portal (`source/portal/lib/demo-transform.ts` + a gated branch in the proxy route) to serve a **transformed** `main.bundle.js` when `TSPML_TRANSFORM=1`: a visible green **`TSPML transform ✔ LIVE`** badge injected via `after` on the Car-module factory (module 5220). Verified myself: the demo patch applies on the real bundle (`node --check` passes, +6.8 KB compact), and the wired route returns `x-tspml-transformed: 1` with the marker present (curl). Purpose: let a browser load prove a transformed bundle actually *runs* — the parse-valid ≠ run-valid gap headless tests can't close. How-to: [`source/portal/TESTING.md`](../../source/portal/TESTING.md).

## 2026-07-30 — headless browser smoke test: PASS ✅ (transformed game *runs*)

Added a Playwright headless-browser smoke test (`source/portal/scripts/smoke.mjs` → `pnpm --filter @tspml/portal smoke`) and made "automate browser checks with a headless browser, don't offload them" a written practice (`docs/contributing/conventions.md`). **Result: PASS.** Loading the portal with `TSPML_TRANSFORM=1` in headless Chromium: the transformed bundle **booted**, the WebGL canvas **rendered (804×452, not the empty 300×150 default)**, the injected `TSPML transform ✔ LIVE` badge appeared in the DOM **and** console, with **0 JS errors and 0 failed asset requests**. This closes the parse-valid ≠ run-valid gap — the JS-Mixin transform is proven to produce *working* JS in a real browser.

The smoke test **caught a real bug on its first run**: the proxied game's relative `<script src="main.bundle.js">` resolved to `/api/main.bundle.js` (404) because the document URL `/api/proxy` treats `proxy` as a filename. Fixed by injecting `<base href="/api/proxy/">` into the proxied HTML. (The earlier `curl` tests missed this — they always used the full path; only a real browser load exposed it.)

Known, **not** transform-related: the game's online XHR (leaderboard/multiplayer) returns 400 / "Failed to connect to server" through the proxy — online/origin handling is M8 (issue #7).

### Follow-up: the smoke probe found PolyTrack's "unofficial version" gate

Extended the smoke with a gameplay probe (try to click past the menu). It revealed that the screen we'd been calling the menu is actually PolyTrack's **"unofficial version detected" warning**: the game checks its origin and, served from `localhost` (not an allowed host — kodub / crazygames / webgamer / kongregate), it refuses to load gameplay (no Play button; only the warning + footer controls). So: the transform is proven working (bundle executes, badge fires, WebGL canvas inits to 804×452), **but the game's own anti-unofficial gate blocks actual play** through the portal. The check lives in the webpack bootstrap (runs before the module graph), so locating it needs AST/browser tracing. This is solvable — PML does it via Origin-spoofing; for TSPML it's a transform job (find + neutralize the check) and becomes the **first M4 task**. Issue #8.

## 2026-07-31 — docs: detailed portal browser-test findings ✅

Updated the docs in depth to capture the current end-to-end state (the user asked for a detailed doc pass). Wrote a consolidated [portal-browser-test-findings.md](../research/portal-browser-test-findings.md) (current status, what's proven vs blocked, reproduce steps) and propagated the findings into the design + research + decision docs:

- [injection-and-delivery.md](../design/injection-and-delivery.md): a new "Current implementation status (verified by browser tests)" section — the `<base href>` HTML rewrite, the unofficial gate, the track-load error, online 400s, and the SW-active-before-fetch detail.
- [polytrack-internals.md](../research/polytrack-internals.md): documented the runtime **"unofficial version" gate** as a discovered PolyTrack behavior distinct from the CSP allowlist.
- [decision-log.md](./decision-log.md): **ADR-012** — transform run-validated in a browser; remaining blockers are the game's own origin/online gates, not the transform.

## 2026-07-31 — browser test found "Failed to load track" 🚧 (issue #9)

Manual browser run (past the unofficial gate): the game throws an error screen — *"PolyTrack encountered an unexpected error! Unhandled Rejection: Failed to load track"* (with stack trace + Reload/Close/Reset Settings). The TSPML badge is still present, so the transformed bundle is running fine — this is a **network/path** issue, not a transform issue. Track data is fetched from a kodub backend endpoint that either 400s through the proxy (Origin not trusted — related to #7) or bypassed the service worker on first load (SW still "registering", not `active` → the fetch went direct to `kodub.com` → CORS-failed). Filed **issue #9**; scoped to M7/M8 (delivery/network/origin: SW-active-before-fetch + correct track-endpoint forwarding).

## 2026-07-31 — ★ M4 task 1: unofficial-version gate NEUTRALIZED → portal PLAYS end-to-end ✅

User chose "gate first". I traced the gate in the unpacked 0.6.2 bundle (`Yo()`/`Xo()`/`Qo()` predicates in `deobfuscated.js`) and found that PolyTrack exposes a **first-class mod-loader hook** — `window.polytrackModConfiguration` (the exact mechanism PML uses to identify itself). Supplying `{modName:"TSPML", author:"roowus"}` sets `Qo()=true`, which clears the gameplay gate. **Fix:** the proxy injects `<script>window.polytrackModConfiguration=…</script>` into the proxied HTML `<head>` *before* the deferred bundles run (gated on `TSPML_TRANSFORM=1`, `x-tspml-unblocked` header for observability). This is **delivery-layer HTML injection, not bundle surgery, and no origin-spoof** — and the only viable option, since the check lives outside the webpack module graph (a module-anchor transform can't reach it).

**Headless-verified outcome — the portal now plays PolyTrack END-TO-END:** transformed bundle boots → gate clears → assets + a track load → a **real race on "Summer 1"** with full HUD (speedometer `0 km/h`, timer `00:00.000`, `0/3` checkpoints), green `TSPML ✔ LIVE` badge live over it, 149× 200 / 0 failed requests.

**"Failed to load track" (#9) — properly fixed after the user hit it on a plain first visit.** Root cause: on a first visit the SW wasn't yet *controlling* the page when the game fetched the track → fetch bypassed the SW → direct to kodub → CORS-fail. My headless runs had masked it by reloading once. **Fix (`app/page.tsx`):** mount the game iframe only after `navigator.serviceWorker` `controllerchange` (or immediately if already controlled), so the game never boots before its fetches are intercepted — no manual reload. Headless-verified on a true first visit (no reload): `reachedGameplay=true`, 0 errors. Only one online `502` remains (#7, M8, non-blocking).

Updated the smoke test (`scripts/smoke.mjs`) to **PASS on gate-clearance** (`pastGate`) and to run **without a reload** (it now tests the real first-visit flow that previously failed); `reachedGameplay` is the stronger signal. ADR-013; findings in [portal-browser-test-findings.md](../research/portal-browser-test-findings.md). **Issues #8 + #9 closed.**

## 2026-07-31 — M4-A: event bus + `@tspml/api` type surface ✅

Started the API bridge. Built the **Tier-1 event bus foundation** (`source/api-bridge`, `packages/api`), fully unit-tested, no game coupling:

- `@tspml/api` (types-only, zero runtime): the `TspmlEventMap` (loader lifecycle / physics / render / track / car / checkpoint / race event → payload tuple), `TspmlEventEmitter` + `TspmlListener` interfaces, and the `TspmlApi` object mods receive.
- `@tspml/api-bridge`: `EventBus` implementing `TspmlEventEmitter` with **per-listener error isolation** (a throwing listener is caught + reported via `onError`, never blocking siblings or the game tick — a direct fix for PML's "one bad hook crashes everything"), `on`/`once` returning an unsubscribe fn (cleanup DX), mid-emit snapshot for safe subscribe/unsubscribe, `listenerCount`/`removeAllListeners`. **9 unit tests passing**.

Next slice (M4-B): wire the real `controlCar` (Car module 5220, already our badge anchor) → emit `car.control` each frame via a fail-closed transform patch + mapping locator, then headless-verify it fires during a race.

## 2026-07-31 — M4-B/C: first real mod event (`car.control`) firing in the running game ✅

Wired `controlCar` → `car.control` end-to-end and **verified headlessly** — the first event a mod can hook inside the live PolyTrack.

- **Transform** (`source/portal/lib/demo-transform.ts`): a 2nd patch, `op:"before"` on `controlCar` (Car module, anchored by `[CreateCar,ControlCar,TestDeterminism]`), injects `window.__tspml.emit("car.control", {carId,up,right,down,left,reset})` at the method HEAD. **Now genuinely HASH-GATED** — `applyDemoTransform` computes the live bundle's sha256 and passes `bundleHash` + the pinned 0.6.2 `expectedBundleHash`; on mismatch the engine fail-closes and the demo serves vanilla (so the minified-param inject can never run against a drifted bundle).
- **Bridge** (`app/page.tsx`): the portal creates the Tier-1 `EventBus` (`@tspml/api-bridge`) and exposes it to the same-origin game iframe as `window.__tspml`; subscribes + shows a throttled live counter in the sidebar.
- **Discovery**: `controlCar` is **input-change-driven** — the bundle calls it via the input-state change callback (keydown/keyup), *not* every frame. So a passive observer gets zero events; the smoke now simulates driving (focus canvas + key presses).
- **Verified** (`scripts/smoke.mjs`): subscribing + pressing 2 keys → **4 `car.control` events** (2 keys × down/up), 0 errors. The smoke **hard-requires** `bridgeWired && carControlEvents > 0` (no vacuous pass).

**Adversarially reviewed** (4-lens workflow: behavior / safety / realm / test; 0 blockers, 6 major, 6 minor, 2 nit). Fixes applied: engaged the hash gate (the "hash-gated" claim was previously false), made the smoke assertion non-vacuous, corrected the call-rate comment, doc'd the cross-realm payload caveat. Declined one minor (`applyBefore` directive-prologue) after **verifying** babel stores function directives in a separate `directives` field, so `unshift` into `body` already preserves them. `@tspml/api` `CarControlState` corrected to the control-input shape; api-bridge test moved to `tests/` (matches repo convention, keeps `dist` clean). **124 unit tests green.**

## Where we stand (2026-07-31)

- **Engines + bridge, all unit-tested in isolation:** loader (47) · mappings (20) · transform (31) · portal rewrite (17) · api-bridge (9) — **124 tests green**, CI green.
- **The portal plays PolyTrack end-to-end** (ADR-012/013) — a transformed, modded game reaches an actual race.
- **The mod-loader loop is proven** (M4-B/C): the first real mod event (`car.control`) fires inside the running game, flowing through the Tier-1 `EventBus` to a subscriber, hash-gated + headlessly verified.
- **Remaining delivery gap:** online (leaderboard/multiplayer) `502` through the proxy — issue #7, M8 (bot-protected `vps.kodub.com`; the extension is the resilient path). Non-blocking for local gameplay.
- **Next:** finish M4 — more Tier-1 events (render/track/checkpoint) + registries (cars/blocks/audio) via the same transform+mappings path, then wire real mod loading into the portal.
