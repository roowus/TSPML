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

## 2026-07-31 — M4-D/E/F: five more Tier-1 events wired + 4 verified firing ✅

Ran a **discovery workflow** (5 agents, one per event) to find clean hook points in the deobfuscated 0.6.2 bundle, then wired 5 more Tier-1 events as transform patches (all hash-gated via `applyDemoTransform`):

- **`car.created`** — `modifyReturn` on `createCar` (module 5220); carId is in the return value, so the wrap emits `{carId, isReplay}` then returns it unchanged.
- **`race.started`** — `before` on `start` (module 641, anchor = its audio/material string literals).
- **`track.afterLoad`** — `after` on `loadTrackData` (module 6762).
- **`checkpoint.passed` + `race.finished`** — combined `before` on `setCarState` (module 641) with diff guards (`e.nextCheckpointIndex > this.getNextCheckpointIndex()` / `e.finishFrames != null && !this.hasFinished()`), turning the per-frame method into once-per-transition emits.

**Headless-verified** (smoke subscribes to ALL events the moment the bridge is exposed — before race setup — since `car.created`/`track.afterLoad` fire early): `car.created=1`, `race.started=1`, `track.afterLoad=2` (menu bg + race), `car.control=5`; `checkpoint.passed`/`race.finished=0` (need real race progress; wired but not asserted).

**Discovery fix during implementation:** the checkpoint anchor originally used method-name *identifiers* (`addCheckpointCallback`…) which the locator can't match (it keys off **string/numeric literals** only) → reused module 641's string-data anchor instead. **Adversarially reviewed** (3 lenses; 0 blockers, 1 major→fixed, nits→fixed): the major was that `race.started`/`checkpoint.passed`/`race.finished` fire **per-car** (player + ghosts), not player-only as comments claimed (the player flag is a private minified WeakMap field the inject can't read) → corrected the comments + filed **issue #10** (add an `isReplay` accessor for player-only filtering). Also normalized `CAR_CREATED` minHits 2→3 and replaced a dead `trackPartData` identifier-anchor entry with a real string literal. `@tspml/api` gained `CarCreatedInfo`/`RaceFinishInfo` payload types.

## 2026-07-31 — M4-G/H: first registry (keybinds) + `window.__tspml` → api object ✅

Ran a **discovery workflow** (5 agents, 4 returned — custom-tracks hit a rate-limit) to find the most tractable registry. **Honest finding:** most *content* registries aren't viable in 0.6.2 — **car-styles** and **settings** use **frozen/closed catalogs** (no add path; static-mutation throws "model not found"); **audio** is viable (the game's own `load()` on a captured manager) but needs a fiddly bootstrap-instance capture (follow-up). The one clean, fully-verifiable, low-risk registry — well-precedented (Fabric has `KeyBindingRegistry`) — is **keybinds**: a bridge-owned parallel input layer.

Implemented **`api.keybinds`**:
- `@tspml/api`: `KeybindBinding` + `KeybindsRegistry` interfaces; added `keybinds` to `TspmlApi`.
- `@tspml/api-bridge`: `Keybinds` class (per-binding error isolation, `register` returns unsubscribe, `dispose`), taking the **target window** as a param so it attaches to the *game iframe* (where keydown fires) and is node-testable with a mock. **5 unit tests**.
- **Refactored `window.__tspml` from the bare EventBus to the full `api` object** `{events, keybinds, version}` — the correct foundation for all registries. All 6 event patches now emit via `window.__tspml.events.emit`. The portal builds the api on iframe load (with the iframe window for keybinds) + registers a visible demo keybind (**KeyF** → sidebar counter).
- **Headless-verified**: the smoke registers a keybind (`KeyP`), dispatches it on the game frame, and asserts `onDown` fired exactly once (`keybindFired=1`); all 6 events still fire. **129 unit tests green.**

Caveat (documented for modders + the `Keybinds` doc): bridge keybinds run as a *parallel* listener — they don't appear in the game's Controls settings and don't consult its conflict rules (the game's action set is a closed enum it polls itself). Future: audio registry (needs the instance-capture transform) + re-investigate custom-tracks (the natural "content appears in a list" target).

## 2026-07-31 — M4-I: real mod loading (loader → mod package → api) ✅

The "it's a mod loader, not just an event emitter" proof. Wired `@tspml/loader` into the portal so a **real mod package** is discovered, parsed, resolved/ordered, and invoked — its entrypoint receiving the bridge `api` and subscribing.

- **New mod package `@tspml/demo-hud`** (`environments/demo-mods/example-hud/`): `mod.json` (schemaVersion 1, id `tspml-example-hud`, targets `>=0.6.0 <0.7.0`) + an entrypoint factory `(api) => { api.events.on('car.control', …); api.keybinds.register({key:'KeyG', …}); }`.
- **`source/portal/lib/mod-loader.ts`**: statically imports the demo mod + runs `@tspml/loader`'s `load()` against the bridge api (per-mod failure isolation). The portal builds the full `api` object (`{events, keybinds, logger, version}`) on iframe load, exposes it as `window.__tspml`, and loads mods against it; a sidebar "mods: ✓ tspml-example-hud" line shows load status.
- **Plumbing fixes surfaced:** added `main`/`types`/`exports`/`files` to `@tspml/loader`'s package.json (it was self-contained in M1, never imported cross-package before) + `environments/demo-mods/*` to `pnpm-workspace.yaml`.
- **Headless-verified:** the smoke asserts the loaded mod's handlers fire — `modLoaded=true`, `modControl=5` (its `car.control` listener rides the same bus), `modKey=1` (its `KeyG` keybind on dispatch). All 6 events + the keybind registry still pass. **129 unit tests green.**

This closes the loop end-to-end: **transform → game event → bridge `EventBus` → a real mod package's listener** (and a mod-registered keybind). TSPML now actually loads a mod.

## 2026-07-31 — M5-A: mod-declared mixins (Tier-2 escape hatch is mod-authorable) ✅

Started **M5** (the mixin / Tier-2 system). First slice: a **mod authors** transform patches via its manifest, instead of the loader hardcoding them.

- The `@tspml/demo-hud` mod now declares a mixin: `mod.json` → `"mixins": [{"config":"mixins.json","environment":"web"}]` → `mixins.json` (a descriptor of inline `Patch`es). Its mixin injects a visible "demo-hud mixin" marker (purple, top-right) via `after` on the Car factory.
- `source/portal/lib/demo-mods.ts` collects the bundled mods' declared mixin patches; `demo-transform.ts` applies them alongside the loader-owned bridge patches (7 patches total). All still hash-gated.
- **Headless-verified:** `modMixinApplied=true` (the mod's declared patch ran + injected its marker), alongside the still-passing events/registries/mod-load. **129 unit tests green.**

Inline anchors for now; **mappings-resolved** stable-name targeting (`Car.controlCar` via `@tspml/mappings`, fail-closed) is M5-C — that's where the mappings moat pays off for the escape hatch. Remaining M5: chaining semantics (priority-ordered `before`/`after`) + `replace` single-winner → load-time conflict error (M5-B).

## 2026-07-31 — M5-B: mixin chaining + conflict — verified + documented ✅

Confirmed the engine **already implements** both M5-B concerns (from M3) and filled the test/doc gaps:

- **`replace` single-winner conflict** — two mods replacing the same target → both fail `conflict-replace-single-winner`, neither applied (load-time error). Already implemented + tested.
- **Chaining** — multiple patches on one target compose in array order. Added tests: two `before` patches on the same target both apply (chain composes), and a per-target miss doesn't block a hit (per-patch isolation). **Transform suite now 33 tests.**

Filed **[#13](https://github.com/roowus/TSPML/issues/13)**: the `PatchBase.priority` field is declared but unused — priority-*ordered* chaining is subtle (the runtime order differs per op: `around` wants DESC, `before`-unshift wants ASC) and no mod needs it yet, so it's a tracked refinement, not a blocker. Corrected `docs/api/mixin-reference.md` (it had overclaimed "ordered by priority").

## 2026-07-31 — M5-C: mappings-resolved mixins (mods target stable names) ✅

The mappings moat now pays off for the Tier-2 escape hatch. A mod authors a mixin targeting a **stable name** (`{ symbol: "Car", op, inject }`) instead of a hardcoded minified anchor; the portal resolves it fail-closed via `@tspml/mappings` → a concrete `TargetSpec` → the transform applies it.

- **`@tspml/mappings`**: added a `targets` section to the map (stable name → `TargetSpec`: anchor+selector) for the proven symbols (`Car`, `Car.controlCar`, `Car.createCar`); `TargetSpec`/`ModuleAnchor`/`TargetSelector` types; `resolveTarget(map, name, ctx)` — **fail-closed** on hash mismatch (returns no target on stale-map); `validateMap` validates the `targets` section. **5 new resolver tests** (found / case-insensitive / stale-map / not-found).
- **Portal**: `demo-transform` resolves `{symbol}` patches via the map (drops unresolvable ones) before transforming; the hash gate now uses `map.bundleHash` (single source of truth). The demo-hud mod's mixin now targets `symbol: "Car"` (was an inline anchor).
- **Gotcha fixed:** `loadDefaultMap()` uses `import.meta.url`, which Next rewrites to a web asset path (broke `readFile` in the bundle) → switched to a direct JSON import + `validateMap` (sync).

**Headless-verified:** `modMixinApplied=true` — the stable-name-targeted mixin ran and injected its marker. **136 unit tests green.** This closes [#14](https://github.com/roowus/TSPML/issues/14); **M5 is complete** (mod-declared mixins + chaining/conflict + mappings-resolved targeting).

## 2026-07-31 — M7-A: `create-tspml-mod` scaffold CLI ✅

Started **M7 (modder DX)**. First slice: a one-command mod scaffold — the "simple to use" half of the goal.

- `tooling/create-tspml-mod`: `scaffoldMod(id, dir)` generates a **working starter mod** mirroring the proven `@tspml/demo-hud` structure — `mod.json` (schemaVersion 1, valid `[a-z0-9-]` id, targets, mixins), `src/entrypoint.ts` (factory subscribing to `car.control` + a `KeyH` keybind), `mixins.json` (a starter Tier-2 mixin targeting the stable name `Car`), `tsconfig.json`, `README.md`.
- `bin/create-tspml-mod.mjs` → `npx create-tspml-mod <name>` (or `node bin/...`).
- **4 unit tests** + verified end-to-end: scaffolding `tspml-test-mod` produces 6 valid files with a loader-valid manifest.

**140 unit tests green.** (M7 continues: dev harness + a publishable `@tspml/api`.)

## 2026-07-31 — M7-B: `@tspml/api` publish-ready ✅

Made the types package publishable so modders get autocomplete via `npm i -D @tspml/api`:
- Dropped `private`, set `version: 0.1.0`, added `publishConfig: { access: public }` (scoped packages need this), `repository`, `keywords`, `sideEffects: false`, + `prepublishOnly` build.
- Verified `npm pack --dry-run` ships exactly `dist/` type defs + README (zero runtime, no source).
- Documented install/usage + the maintainer publish steps in `packages/api/README.md`.

The actual `npm publish` is the one maintainer step (`npm login` + ownership); everything else is done.

## 2026-08-01 — M9: regen / diff / verify pipeline (the moat, operationalized) ✅

Built the missing half of the update-resilience story — the tooling that turns a
PolyTrack version bump from a manual scramble into a one-command, human-in-the-loop
review. Four new modules in `tooling/mappings-pipeline` (plain `.mjs`, matching the
sibling `unpack`/`match`/`gen-map` scripts):

- **`src/diff.mjs`** — the human-review core. Pure map-vs-map diff keyed by
  `sourceModuleId` (the cross-version-stable id; see insight below). Reports module
  relocations, stable-name moves, added/removed modules, confidence drops, newly
  resolved/unresolved, a **target-impact** correlation, a risk level (`none`/`low`/
  `high`), and a `formatDiff()` reviewer report.
- **`src/verify-targets.mjs`** — the fail-closed anchor gate. Reads the unpacked new
  bundle and confirms each carried-forward target's anchor literals still resolve
  together in a module (`pass`/`ambiguous`/`fail`). This is what makes carrying the
  `targets` section forward across a version bump *safe* — without it, a drifted
  target would silently fail-closed at mod-load time.
- **`src/fetch.mjs`** — downloads the new build's `main.bundle.js` (+ sim worker) from
  the `app-polytrack.kodub.com` CDN into the gitignored `.cache/`, with an optional
  `--expect-hash` pin that rejects a silent version swap.
- **`scripts/regen.mjs`** — the orchestrator: `fetch → unpack → gen-map → diff →
  verify`, printing a combined review report. Writes `*.candidate.json` (**never**
  clobbers a committed map); exits non-zero on `HIGH` risk or any target `fail`.
  Standalone `--diff` / `--verify` modes for reviewing an already-generated map.

**Key insight — cross-version module identity.** A regen always matches the *same*
fixed 0.6.0 renamed source against a new target, so every matched module carries a
`sourceModuleId` (a 0.6.0 webcrack id) identical across versions. The diff keys
modules by `sourceModuleId`, **not** the concept slug (which drifts with the scorer).
`moduleId` is the thing that *relocates*. The `targets` section is carried forward
verbatim, so it can't be diffed directly — `diff` correlates each target to its module
by **max stable-name overlap** (a heuristic), while `verify-targets` is the
**authoritative** all-literals check against the unpacked bundle.

**Verified end-to-end against the real cached bundles** (the project's "run it
yourself" practice):
- *Reproducibility* — regenerating the 0.6.2 map and diffing vs committed: **56
  matched, 0 relocated, risk NONE** (gen-map is deterministic; the diff correctly
  reports zero drift).
- *Real cross-version drift* — a 0.6.0-target candidate vs the 0.6.2 map: bundleHash
  changed, **8 modules relocated, 49 stable names moved module**.
- *Realistic HIGH-risk path* — when the Car module is unresolved in the candidate, all
  3 targets flag `[UNRESOLVED]` → risk **HIGH** ("do not promote until re-verified").
- *verify-targets on the real `v062-raw`* — all 3 targets (`Car`, `Car.controlCar`,
  `Car.createCar`) resolve to module `5220`.
- *fetch* — downloads 0.6.2 main, sha256 `8495…` **exactly matches the committed
  bundleHash**, byte-for-byte identical to the cache; a wrong `--expect-hash` aborts.

**37 unit tests** (diff + verify-targets + fetch-version-validation, CI-runnable —
fixture maps + temp module dirs; no bundle needed). **185 tests green** total, build
green. Pipeline README rewritten; `mappings-system.md` marked implemented;
`*.candidate.json` gitignored so the promote workflow (`cp candidate → committed`)
stays clean. ADR-014.

**Adversarially reviewed (4-lens workflow: diff / verify-targets / fetch-legal /
regen, each finding adversarially verified).** The review earned its keep: it caught a
**blocker** — on the first regen of a new version, `gen-map` read carry-forward
`targets` from `OUT` (the not-yet-written candidate) → ENOENT → silent catch → a
**target-less candidate**, so `verify-targets` checked 0 targets and printed a
misleading **"ALL TARGETS RESOLVE" + GREEN**; promoting would have dropped every
mod-facing target. **Fixed at the root:** `gen-map` now reads targets from an explicit
`GEN_PREV_MAP` baseline (passed by `regen`); `regen` additionally asserts
(`assertTargetsCarried`) that the candidate keeps ≥ the baseline's targets — refusing
to emit a target-less candidate; and `formatVerifications` no longer claims green on 0
targets. Other confirmed findings fixed: `fetch` version-path traversal guard
(`assertVersion`) + HTML/tiny-body rejection; `regen` `--out` clobber-committed guard;
`diff` confidence-drop made scale-invariant (relative-only — weights span ~6–14000);
the `verify-targets` 'ambiguous' note corrected (the locator picks the *first* module,
not selector-disambiguated between modules); `modulesContaining` documented as
intentionally conservative (distinct-literal count — a pass guarantees the runtime
locator finds the anchor). Re-verified end-to-end on the real bundles: a full `regen`
now reports `3 pass (of 3)` targets, not a vacuous 0.

Honest scope retained: the bundle-dependent stages (`fetch`/`unpack`/`gen-map`/full
`regen`) are local-only (webcrack + gitignored cache), like the M1 spike — they don't
run in CI. The "candidate within hours" goal is now real for the ~85% the matcher
auto-relocates; the residual still needs the human review this tooling surfaces. AST
structural fingerprints (the next match-rate lever) remain future work.

## 2026-08-01 — M7-C: Vite dev harness with scoped mod HMR ✅

Completed **M7** (modder DX). Built `@tspml/dev-harness` — a Vite dev server that runs
the real transformed game plus your mod with **scoped mod hot-reload**: save the mod's
entrypoint and it hot-swaps in place while the game keeps running (no reload, no
rebuild). Cuts the edit→see loop from "rebuild transform+api-bridge + full browser
reload (game reboots)" to "save → instant".

- **`game-proxy.ts`** — a Vite `configureServer` middleware serving the real game under
  `/game/*`: fetches the CDN with the desktop origin forwarded, injects the
  `polytrackModConfiguration` gate + `<base>` into the HTML, and AST-rewrites
  `main.bundle.js` (hash-gated). This is the harness analog of the portal's `/api/proxy`
  + service worker — but **simpler: no service worker** (Vite intercepts `/game/*`
  in-process).
- **`tracking-api.ts`** (the HMR enabler) — wraps the bridge `api` so every
  `events.on`/`once` + `keybinds.register` the mod makes is recorded; `disposeAll()`
  tears them down. Enables scoped mod HMR with **no change to the mod API** — the mod
  uses `api` normally; the harness cleans up after it. Unit-tested (5 tests).
- **`main.ts`** — boots the game iframe, exposes `window.__tspml`, runs the mod against a
  tracked api, wires `import.meta.hot.accept` to swap the entrypoint on save.
- The dev mod is aliased to its **source** (not dist) so Vite HMRs edits; point
  `TSPML_DEV_MOD` at your own mod.

**Headless-verified (`pnpm smoke`):** the transformed game boots → gate clears → a real
race ("Summer 1", `0/3`, `00:00.000`) → bridge wired → dev mod loaded → `car.control`
fires (×3) → **editing the mod source hot-swaps it (`modLoadCount++`) with the game
un-reloaded** (`gameSurvivedHmr: true`). Vite's own log confirms the swap path:
`[vite] hot updated: .../entrypoint.ts via /src/main.ts`.

**Honest scope:** entrypoint logic (events/keybinds) hot-swaps; a mod-declared **mixin**
change alters the bundle transform and needs a full reload (documented). The bridge
patches are an intentional attributed copy of the portal's (extract to `@tspml/shared` so
portal + harness share one source — [#34](https://github.com/roowus/TSPML/issues/34)).
**190 tests green** (5 new).

## 2026-08-01 — #12: the custom-tracks registry works ✅ (first content registry)

`api.tracks` lets a mod hand over a PolyTrack import code and get a real entry in the
player's **Custom tracks** list. It was the last plausible *content* registry (car
styles and settings are frozen catalogs; audio is [#11](https://github.com/roowus/TSPML/issues/11)),
so it is what **unblocks M10** — the PML importer needed at least one to exist.

**How it reaches the game.** The registry drives two game objects the module locator
cannot find, because they live past the **bootstrap wall** (the same wall #11 hits):

- **track store** — captured as a constructor parameter of the track-selection UI
  (module 8185). You can't locate the class, but you *can* catch the instance being
  handed to a caller that is a real module.
- **track codec** — an export of the track-data module (9117), used to parse the
  import code and to reject a bad one.

Both patches only read a reference out; neither changes game behaviour. Generalized as
**instance capture** in [hook-system.md](../design/hook-system.md) — the technique is
the reusable result here, and it is the most promising route for #11.

**Two gotchas worth remembering.**

1. **Anchor uniqueness is not optional.** The codec's first anchor set matched the
   *wrong* module: `"PolyTrack2"` also appears in 6582 and `"Checkpoint has no
   checkpoint order"` in 6762, so `fromExportString` was simply not a function. Fixed
   with four literals at `minHits: 4` (`"Part id is out of range"` /
   `"Failed to get canvas context"` are unique to 9117). `verify-targets` now passes
   **5/5** targets, both new ones unambiguous.
2. **Capture timing differs per target.** The store is captured late (menu build), but
   the codec's module factory runs during **bundle init** — before the parent frame's
   `load` handler installs `window.__tspml`. The codec capture was therefore hitting an
   absent bridge and being dropped silently, and the registry never attached: half the
   captures worked, which made it look like an anchor problem rather than a timing one.
   Fixed with a **pre-bridge stub** injected ahead of the game's scripts that records
   early captures into `window.__tspmlEarly` for `main.ts` to replay. The portal needs
   the same stub before it can ship this — [#36](https://github.com/roowus/TSPML/issues/36).

**Design calls** (all encoded in tests): a name collision is **refused** by default —
the colliding track may be the player's own, so clobbering it is data loss; `overwrite`
must be explicit. `persist` is **opt-in**, because the game's store writes to
localStorage and a persisted mod track would outlive the mod. Registrations made before
capture are **queued and drained on attach**, so a mod can register at `init`. Every
game call is isolated into a typed failure — a bad code is `{ ok: false, reason:
'invalid-code' }`, never a throw.

**Headlessly verified against the live game** (`pnpm --filter @tspml/dev-harness
smoke:tracks`, new): registry attached → a real code minted via the game's own codec →
`api.tracks.register()` → track present in the **game's own** custom-track list →
invalid code rejected as `invalid-code` → collision refused as `name-exists` →
`overwrite: true` succeeds → `unregister` removes it from the game's list. The M7-C
smoke still passes (HMR intact, `gameSurvivedHmr: true`), which matters because the
tracking-api now also disposes a hot-swapped mod's tracks.

**201 tests green** (11 new).

## 2026-08-02 — the M9/M7-C/#12 stack landed on `main` (+ the review-bugs PR)

Four open PRs merged, `main` linear: [#33](https://github.com/roowus/TSPML/pull/33) (M9
pipeline) → [#35](https://github.com/roowus/TSPML/pull/35) (M7-C dev harness) →
[#37](https://github.com/roowus/TSPML/pull/37) (`api.tracks`, #12) →
[#32](https://github.com/roowus/TSPML/pull/32) (review bugs). Closes
[#20](https://github.com/roowus/TSPML/issues/20),
[#22](https://github.com/roowus/TSPML/issues/22),
[#23](https://github.com/roowus/TSPML/issues/23),
[#29](https://github.com/roowus/TSPML/issues/29),
[#31](https://github.com/roowus/TSPML/issues/31).
[#18](https://github.com/roowus/TSPML/issues/18) stays open — #32 added `logger` to
`TspmlApi`, but the loader's `ModApi` still lacks `keybinds`/`version`.

**Merging a stack is not four independent merges.** Two things worth writing down:

1. **Squash-merging the bottom of a stack strands the ones above it.** Each squash
   rewrites its commits under a new SHA, so the next branch up still carries the *old*
   copies and conflicts against `main`. Each PR needs replaying onto `main` after the one
   below lands. And `--delete-branch` on the bottom PR deletes the branch the next PR is
   *based on* — GitHub responds by **closing** that PR, not retargeting it. Retarget the
   whole stack to `main` **before** merging anything.
2. **`git add -A` during a conflict resolution will stage conflict markers.** It happened
   on one file that had conflicted but wasn't in the set being fixed — `<<<<<<<` markers
   committed into a doc. Caught only by diffing the merge result against an
   independently-rebased tree and expecting *zero* differing files. Stage conflicted
   paths by name, and grep the tree for markers before committing.

**#32's conflict was semantic, not textual.** `main` had put the M6-B safety indicator in
the same `useState` cluster and the same `loadMods().then()` block that #32 rewrote to
replace the placeholder mod list. Both features were wanted, so both were kept — verified
in a real browser rather than by typecheck, because a dropped `setSafetyStatus` compiles
fine: the sidebar shows `tspml-checkpoint-counter` + `tspml-example-hud` as `loaded`, the
placeholder gone, `safety: ✓ vanillaSafe · 1 warn` intact, zero page errors. (The portal
smoke only asserts on the game canvas — it would not have caught a broken sidebar.
Widening it is part of [#25](https://github.com/roowus/TSPML/issues/25).)

**#32 also carried three stale doc claims** that would have regressed `main`, ironic for a
PR whose purpose was doc accuracy — it was authored before M6/M7/M9 landed. Its roadmap
rows would have flipped M4 back to *In progress* and M9 back to *Planned*; and it cited
[#13](https://github.com/roowus/TSPML/issues/13) as open for mixin priority chaining in
two files, though `sortPatchesByPriority` shipped in `fe9e926`. Rewriting those from the
implementation surfaced that the honest description is narrower than "priority chaining
works": it is an **opt-in helper** callers pass patches through, and the ordering inverts
per op — for `around` the highest priority wraps outermost, but for `before` (which
unshifts at the method head) the highest-priority patch is applied first and so ends up
*furthest* from the head. Short-circuit propagation across nested `around` hooks is still
unspecified. `mixin-reference.md` now says exactly that.

**203 tests green** (2 new: keybind auto-repeat), `pnpm -r build` clean including the
portal.

## 2026-08-02 — #34 + #36: one copy of the injections, and `api.tracks` in the portal ✅

These two were done together on purpose. `api.tracks` worked only in the **dev harness** —
a tool for mod authors — and not in the **portal**, which is the product. Porting it meant
copying the bridge patches a third time, which is exactly the drift
[#34](https://github.com/roowus/TSPML/issues/34) existed to stop. So #34 first, then #36
fell out of it.

**The duplication had already caused the bug.** The two copies were not merely at risk of
diverging; they had diverged. The portal's copy had **no track-capture patches at all**, so
`api.tracks` could not have worked there even with the host wiring in place. Extracting to
[`@tspml/shared`](../../source/shared) fixed the defect as a side effect of removing the
duplication — the strongest argument for doing it.

The package owns **both** injections, because a surface can forget either one:

| Export | Injected into | Forgetting it costs |
|---|---|---|
| `BRIDGE_PATCHES` | `main.bundle.js`, via `@tspml/transform` | a silently missing feature (what happened) |
| `EARLY_CAPTURE_SCRIPT_TAG` / `readEarlyCaptures` | the game's `<head>`, ahead of its bundles | `api.tracks` never attaches, with no error anywhere |

**The stub is load-bearing, and now we have evidence rather than an argument.** The portal
smoke reports which captures arrived pre-bridge: `earlyCodec: true, earlyManager: false`.
The codec really is handed over during bundle init, before the frame-`load` handler installs
`window.__tspml` — so without the recording stub it is dropped, the late TrackManager
capture succeeds, and the registry waits forever on a half-complete pair. Generalized in
[hook-system.md](../design/hook-system.md): any new instance capture must ask where its
target module runs *relative to the bridge*.

**Tests that could not previously exist.** While the payloads were duplicated inline in two
surfaces, a broken inject only surfaced when someone ran the transform against the real
(gitignored, machine-local) bundle in a browser. 22 tests now hold them to their contracts:
every inject/wrap **parses** (`new Function`, wraps evaluated as expressions since the
engine emits `return (wrap)(X)`), every payload is try/catch-wrapped so a throw cannot
escape into game code, every payload that *touches* the bridge guards it, `minHits` never
exceeds `literals.length` (a typo there would silently disable a hook), and the codec's
four-literal anchor is pinned against the regression that made it resolve to the wrong
module.

One of those tests failed first and was right to: the badge inject touches no bridge (it
guards `typeof document`), so an "every payload guards `window.__tspml`" invariant was
over-broad. Split into three narrower tests instead of loosened.

**Verified against the live game, not just typechecked.** The portal now has its own
committed `smoke:tracks` — the harness twin, minus the harness's dev-only `window.__tspmlDev`
inspection hook, which the portal deliberately does not ship (it reads the captured objects
off `api.tracks`'s own host instead; documented in the script). It drives only what a mod
can: register a real code → the track appears in the **game's own** Custom tracks list → an
invalid code is a typed `invalid-code` failure, not a throw → unregister → gone. `PASS`.
Both pre-existing smokes still pass, so the extraction changed no behaviour.

**A trap worth writing down:** `curl` of `/api/proxy/?version=…` **308-redirects** to the
slashless form, so without `-L` you get an empty body and can wrongly conclude the `<head>`
injections never landed. Same trailing-slash asymmetry the `<base href>` rewrite exists to
fix.

**225 tests green** (22 new, all in the new `source/shared`), `pnpm -r build` clean.

## 2026-08-03 — #11: the audio registry, and the blocker that wasn't ✅

`api.audio` overrides the game's real sounds. A mod passes a `key` and a `url`; the game's
own `getBuffer("click")` then returns the mod's clip, and `unregister` brings the original
back. Headlessly proven against the live game — the load-bearing number in
`smoke:audio`'s output is the game's own lookup going **0.032s → 0.37s → 0.032s**.

**The issue's premise was wrong, and finding that out was most of the work.** #11 was
filed as "the audio manager is a bootstrap-scope local the module locator can't see", and
the previous session's plan was a locator disambiguator: module 641 has four constructors,
the locator takes `matched[0]`, so capturing from there needed new machinery. All true —
and all unnecessary. Reading the bundle again with a different question ("who *receives*
this object?" instead of "where is it *built*?") found the audio manager sitting at
**parameter 3 of the track-selection UI's constructor** — parameter 5 of which is the
TrackManager we already patch for #12. Same module (8185), same constructor, same inject.

So #11 shipped with **no locator change, no new anchor, no mappings edit, and no
disambiguator** — a background workflow designing that disambiguator was stopped rather
than allowed to finish solving a problem that had evaporated. Confirmed three independent
ways before writing code: the constructor's own field assignments (`w ← n`), all three
`new Sr.A(...)` call sites, and whole-bundle uniqueness of the `getBuffer` / `playUIClick`
/ `load` definitions. The habit worth keeping: **before building new capture machinery for
a bootstrap object, read the parameter lists of the constructors already patched.**

**The obvious implementation was a latent crash.** #11 and every doc referencing it said
"override clips via the game's own `load()`". That would have shipped a guaranteed
production failure: `load()` starts with `addResource()` on the loading-screen tracker,
which throws `"Cannot add resources after loading is complete"` once boot finishes — and
instance capture is late-binding by nature, so *every* mod call lands in exactly that
window. Unit tests would have passed happily against a mock `load`.

The registry **shadows the read path** instead: an own-property `getBuffer` on the captured
instance that answers from the mod's map and delegates to the bound prototype method
otherwise. Better on three counts beyond not crashing — `unregister` restores the original
exactly (`delete` the own property), the game's resource tracker is untouched, and decoding
runs through the game's *own* `AudioContext` so the buffer is guaranteed compatible with
the graph that will play it. Generalized in
[hook-system.md](../design/hook-system.md): prefer shadowing the accessor the game reads
through over invoking the loader it read through at boot.

**A mock that would have hidden the bug it was written to catch.** The api-bridge test's
fake manager puts `getBuffer` on a **class prototype**, not an instance arrow property.
With an instance property, `dispose()`'s `delete` would appear to restore correctly in
tests while doing nothing against the real game — the mock's shape *is* the assertion.
Paired with a test that asserts a throwing `load` spy is **never called**, so the
`addResource` trap can't be walked back into.

**One existing test failed and was right to be rewritten, not loosened.** The shared-package
invariant "every payload that touches the bridge guards it" was pinned to the literal string
`window.__tspml &&`; the combined track+audio capture spells its guard `window.__tspml)` as
the head of a nested `if`. The assertion now matches the *property check* (`/window\.__tspml\s*(&&|\))/`)
rather than one spelling of it. The two captures are also guarded **independently**, so an
audio-side rename in a future game version cannot take the tracks capture down with it —
enforced by a test.

**HMR discipline matters more for audio than for tracks.** An overridden clip stays in the
game's buffer lookup until unregistered, so a hot-swap that forgot would leave the previous
mod's sounds playing with nothing owning them. The harness's tracking wrapper now records
audio keys alongside track names, with a `res.key ?? a.key` fallback so an upstream shape
change can't silently drop a disposal record.

**The smoke synthesizes its own clip** — an 8 kHz mono WAV blob built in-page at a chosen
0.37 s. No committed binary, no network, and a duration we picked, which is what makes
"did the override land" checkable *by value* rather than by vibe. It needs
`--autoplay-policy=no-user-gesture-required`: `decodeAudioData` wants a running context and
a headless page never clicks anything. That browser-policy caveat is now documented on the
public type — a clip can register successfully and stay inaudible until the player
interacts, which is the game's suspended `AudioContext`, not a registry failure.

**247 tests green** (22 new: 14 api-bridge · 6 dev-harness · 2 shared), `pnpm -r build` clean.



## 2026-08-03 — #25: CI runs the smokes, and the first typecheck of the unchecked ✅

Two gaps, both of the same shape: **code nothing was reading.**

**The smokes never ran in CI.** They are the only end-to-end proof a transformed game
boots — the injects reference the bundle's minified parameter names and only ever meet
a parser when a real bundle is transformed, so this whole failure class is invisible to
`pnpm -r test`. Now `.github/workflows/smoke.yml` runs all three portal smokes per-PR
and daily.

**It is deliberately advisory, not a required check.** The job fetches the live game at
run time, so it can go red for reasons that have nothing to do with the commit: the CDN
is down, or Kodub shipped 0.6.3 and the pinned hash no longer matches. A required check
that goes red on someone else's release teaches people to ignore red. What earns its
keep is the **daily** schedule — it finds a game update the day it lands, not the next
time somebody opens a PR.

**A canary job makes a red smoke interpretable.** It compares the live
`main.bundle.js` against the map's `bundleHash` *before* the smokes run. Canary red
means the game shipped a new build, every surface has fail-closed to vanilla, and the
downstream failures are expected fallout. Canary green + smoke red means the commit
broke something. Without that split, "smoke is red" is two very different messages
wearing the same colour.

Verified the CI-critical unknown first, rather than writing the workflow and hoping:
**does the smoke pass against `next start`?** CI should exercise the path the product
ships, and nobody had ever run the smoke against a production build. It does —
1,791,279 B served vs 1,782,239 B upstream, all Tier-1 events, `PASS: true`.

**The canary's first real run failed — and it was the canary that was broken.** It read
`version` from the map; the field is `gameVersion`. `node -p` printed the string
`"undefined"`, the URL 404'd, `curl -f` failed, and the job reported *"the game shipped a
new build"* on a day the live bundle hashed **exactly** to the pin.

That is the worst failure available to a job whose entire purpose is telling you which
kind of red you are looking at. A canary that cries wolf is worse than no canary: it
launders a defect in our own CI into "not our problem, Kodub shipped something." Two
guards now make the confusion impossible — an explicit check that the map fields
actually read, and a fetch separated from the hash. The second matters more than it
looks: piping `curl` straight into `shasum` **hashes the empty string on a 404** and
produces a perfectly plausible wrong hash. Both paths now say *"canary is broken, not
the game."*

It took a live CI run to find, because locally every piece had been verified
individually — the hash matched, the URL worked — just never through the script that
would run them. **Verifying the parts is not verifying the whole.**

### The lint half found a real bug in the highest-consequence code

`pnpm lint` existed at the root and matched **no package at all**. Rather than adding a
linter for style, [`@tspml/typecheck`](../../tooling/typecheck) typechecks the two
bodies of `.mjs` that nothing read: the five headless smokes, and the mappings
pipeline. Neither is covered by `pnpm -r build` (per-package `tsc -p` plus
next/vite build — none of which see a loose `.mjs`) and neither is imported by vitest.

The pipeline is the code that regenerates the symbol map on a game release. A mistake
there does not fail loudly; it produces a *plausible but wrong candidate map*, and the
map is what every surface hash-gates against. First run, four findings, one real:

**`regen.mjs` passed `stdio: "inherit"` to `execFile`, which has no `stdio` option.**
Node ignored it, so gen-map's report — the thing a maintainer reads to decide whether
to promote a candidate map — was buffered into a string the callback discarded instead
of being printed. `execFile` would also have truncated it at the 1 MB default
`maxBuffer` had anything read it. Fixed to `spawn`.

**Why that survived every run and every test:** the symptom is *"the regen is oddly
quiet."* Silence reads as normal. There is no error, no crash, no wrong value — just an
absent report, and absence is exactly what a human does not notice. This is the second
time in two days that a bug hid in something that *looks like nothing happening* (the
first was the early-capture stub, where a dropped capture left the registry waiting
forever with no error anywhere). Worth naming as a class: **when a failure mode is
silence, no amount of running the thing will find it — only a checker that reads the
code, or a test that asserts the output exists.**

The other three were type hygiene: a `readonly` array passed to a mutable parameter, a
`let status` widened to `string` where a three-value union was meant, and a mixed-element
array needing a tuple annotation before `re.test()` typechecked.

### Two decisions worth recording

**Non-strict, deliberately.** Under `strict` the smokes alone produce **231**
diagnostics — nearly all `noImplicitAny` on inline callback params, plus complaints
about result objects built up field by field. That is a large diff that makes the
smokes harder to read and catches no defect. Non-strict `checkJs` still catches what
these scripts actually get wrong, which I verified by injecting each kind and
confirming a non-zero exit: `page.waitForTimeut` → *"Did you mean 'waitForTimeout'?"*,
`page.frames().nope()`, `browser.closeNow()`. A checker earns `strict` by letting a
real defect through, not by being available.

**The bridge globals are typed `any` on purpose.** The smokes read `window.__tspml`
inside `page.evaluate()`, whose callbacks run in the *game frame's realm* — the value
does not exist in the Node process doing the checking, so there is nothing to import.
Typing it properly would make five smokes compile-time consumers of the bridge's
internals, so refactoring `__tspml` would break the typecheck of scripts that do not
care about it. `api.audio`/`api.tracks` already have real types in `@tspml/api`.

### The test had to spawn real processes

`tests/regen-runnode.test.mjs` (5 tests) guards the fix, and both obvious shortcuts
would have been worthless:

- **Mocking `child_process` would have passed against the broken code.** The bug was
  that Node *ignored an option we correctly passed*. A mock asserting "we passed
  `stdio: "inherit"`" is true of both versions. Only real inherited stdio distinguishes
  them — the assertion has to be that the parent's own fd receives the child's bytes.
- **Re-declaring `runNode` in the test would also have passed.** So `regen.mjs` now
  *exports* it, behind a `process.argv[1] === fileURLToPath(import.meta.url)` guard so
  importing the module does not kick off a regen (mirroring `fetch.mjs`). The test
  drives the real function.

Confirmed by reverting to the `execFile` form: **4 of the 5 fail.** A regression test
that never fails against the bug it describes is decoration.

**252 tests green** (5 new), `pnpm -r build` + `pnpm -r lint` clean.

## Where we stand (2026-08-03)

- **Engines + bridge + scaffold + pipeline + dev harness, all unit-tested:** loader (53) · mappings (25) · transform (35) · portal (17) · api-bridge (41) · shared (24) · create-tspml-mod (4) · mappings-pipeline (42) · dev-harness (11) — **252 tests green**, CI green.
- **M4 ✅** — 6 Tier-1 events + keybinds registry + **real mod loading** (two demo mods load simultaneously).
- **M5 ✅** — mod-declared mixins + chaining/conflict + **mappings-resolved stable-name targeting** (fail-closed).
- **M6 ✅** — warn-only `classifySafety` + **surfaced in the portal** (sidebar safety indicator).
- **M7 ✅** — `create-tspml-mod` CLI + `@tspml/api` publish-ready + **Vite dev harness with scoped mod HMR**.
- **M8 first slice ✅** — MV3 browser extension (gate fix on kodub.com — the resilient online path).
- **M9 ✅** — full regen/diff/verify pipeline (fetch + unpack + gen-map + diff + verify-targets; `regen.mjs` orchestrator).
- **#12 ✅** — custom-tracks registry, the first working content registry (**M10 unblocked**). **#13/#14 closed.**
- **#34 + #36 ✅** — both injections live in one package (`@tspml/shared`), and `api.tracks` now works **in the portal**, not just the harness. Verified by a committed portal smoke against the live game.
- **#11 ✅** — audio registry: a mod's clip replaces a real game sound in **both** surfaces, via the *same* capture as `api.tracks`. Two content registries now work.
- **#25 ✅** — CI runs the three portal smokes (advisory per-PR + daily, with a bundle-hash canary so a red smoke is interpretable), and `pnpm -r lint` is real: [`@tspml/typecheck`](../../tooling/typecheck) checks the `.mjs` no build reads. Found a live defect in `regen.mjs`.
- **Open:** #10 (player-only), #18 (`ModApi` drift, partially fixed).
- **Next:** **M10** (PML narrow importer, unblocked) — with two working content registries (`tracks`, `audio`) for the importer to map PML mods onto.

## 2026-08-03 — #19: the scaffold was unusable outside this monorepo ✅

`create-tspml-mod` printed two commands. The first one died:

```
ERR_PNPM_WORKSPACE_PKG_NOT_FOUND  "@tspml/api@workspace:*" is in the
dependencies but no package named "@tspml/api" is present in the workspace
```

and `mod.json` pointed `entrypoint` at `entrypoint.js`, a path no build has ever
emitted. So the advertised getting-started path was broken end to end, from the
first command to the artifact the loader would look for.

**Every scaffold test passed the entire time.** This is the same shape as #25 and
worth stating as a rule: those four tests assert on the *contents* of generated
files, and the contents were correct. What was broken was what happened when you
ran them. **Asserting that generated text is right is not asserting that the
generated project works** — the only check that would have caught this is one
that runs the real compiler against a real scaffold on disk, which the suite now
does.

The fix is broader than the issue title. Dropping `workspace:` is not enough:
`@tspml/api` is unpublished, so depending on it by **any** range breaks install
for an external author. The scaffold therefore ships `types/tspml-api.d.ts`, a
hand-written stand-in covering only the members the starter uses. A stand-in can
rot silently, which would be worse than no types at all — so a test pins its
member *names* to the real `TspmlApi`, subset-wise (it may omit `tracks`/`audio`;
it may never declare something the real API lacks). A rename upstream now fails
CI here instead of shipping a broken scaffold.

`rootDir` is `"."` rather than `"src"` because `types/` sits beside it. That
moves emission to `dist/src/entrypoint.js`, and the manifest now says so — with
the expected path *derived from* the generated tsconfig's `outDir`/`rootDir` in
the test, so the compiler and the manifest cannot drift apart.

**Five guards, each verified to fail when its defect is reintroduced.** Mutation-
checking these was not ceremony: two of them were quietly broken. A naive
`/readonly (\w+):/` over the stand-in also matches `readonly id` in
`KeybindBinding` and reports a false drift alarm; `\bapi\.` matches inside
`'../types/tspml-api.js'` (the hyphen is a word boundary) and yields a phantom
member `js`. Both were found by mutating, not by the tests going green.

**`npx create-tspml-mod` was a false claim in the README.** `npm view
create-tspml-mod` → E404; the package is `private` and unpublished, so that
command 404s for every reader. Three docs advertised it. All three now give the
working invocation (`node .../bin/create-tspml-mod.mjs`) and say why. Two further
staleness bugs surfaced next to it in `getting-started.md`: the sample imported
`@tspml/api`, which the scaffold no longer provides, and it documented
`dist/entrypoint.js`.

I did not publish the package. It is outward-facing and irreversible, so it is
the owner's call; the package is otherwise publish-ready (scoped `files`,
repository metadata) and carries a `//publish` note with the remaining steps.

Two of #19's four premises were already fixed and were not re-fixed: the tsconfig
was already self-contained, and `api.logger` was already on `TspmlApi`. Verifying
the issue text against the code before acting on it saved doing both twice.

**257 tests green** (252 + 5), build and lint clean. PR #45, branched off `main`.

## 2026-08-03 — #5 webcrack on Node 25: the claim was half wrong

#5 recorded that `webcrack@2.x` "silently no-ops" on Node 25 because its `engines`
range is `>=22 <23 || >=24 <25`. Measured it before documenting it, and the premise
is only partly right:

| Invocation | Node 25 |
|---|---|
| `npx webcrack` | ❌ exits 1, writes nothing, after only `npm warn EBADENGINE` |
| `pnpm exec webcrack` (workspace copy) | ✅ works |
| library API (`src/unpack.mjs`) | ✅ works |

So it is an **npm-packaging constraint, not a runtime incompatibility** — the
webcrack library itself is fine on 25, and even its CLI is fine when pnpm installs
it. Only npm's engine enforcement blocks the install/bin step, and it does so in the
worst way: no error names webcrack, so you get an empty output directory that reads
like "the bundle had no modules".

`source/mappings/README.md` had inherited the wrong version of this ("webcrack's
unpack step required Node 22/24") — corrected.

**Kept a guard rather than only prose.** The README's claim is true of webcrack 2.16
today and is exactly the kind of thing that silently stops being true on a bump. Two
tests: one unpacks a two-line string and asserts *files were written* (the #5 symptom
is silence, so asserting "didn't throw" would miss it); one pins `src/unpack.mjs` to
the library import so nobody "simplifies" it back to spawning npx. No `.cache/`, no
network, no proprietary input, ~15ms — CI-runnable.

The second guard initially failed against a *correct* file: `unpack.mjs`'s own header
explains the npx hazard by name, and the regex matched the prose. Same false-alarm
class as #19's stand-in drift test — strip comments before scanning code. Both guards
mutation-checked.

Also corrected a stale count in the pipeline README (26 → 39 tests).

## 2026-08-03 — #2 (isolated-vm on Node 25)

Closed #2. The issue's diagnosis was right about the symptom and wrong about the
consequences, so both got corrected.

**What is true:** `isolated-vm` has no working build on Node 25 (darwin-arm64), by
any route. No prebuild — 6.1.2 ships abi127/abi137 (Node 22/24), Node 25 is abi141.
No source build — with a working python (brew python 3.14's `pyexpat` is broken;
`npm_config_python=/usr/bin/python3` gets past it) node-gyp compiles and links, and
the addon then **segfaults on `new ivm.Isolate()`**, reproducibly. No newer version —
isolated-vm@7 ships abi137/abi147 and declares `engines: >=26`; Node 25 sits in the
gap on both sides.

**What is no longer true:** the issue said install exits 1 and no lockfile is
generated. pnpm 10 does not run dependency build scripts by default, so the failing
`node-gyp` never runs at install time. Verified in a fresh clone: plain `pnpm install`
exits 0, `pnpm install --frozen-lockfile` exits 0, and `pnpm-lock.yaml` is committed
and unchanged. Also: isolated-vm is a **required** webcrack dependency, not an
optional one — that misreading is what made "optional dep fails to build" sound
harmless.

**What it actually costs:** only webcrack's obfuscator.io deobfuscation, which the
*minified* PolyTrack bundle never triggers. webcrack imports isolated-vm lazily
inside the sandbox call, so the missing addon is never loaded. Measured: unpacking
the real 0.6.2 bundle on Node 25 yields 212 modules, **byte-identical (`diff -rq`) to
the same unpack on Node 22**. So M3 is not blocked, which was the open worry.

**The fix is legibility, not capability.** New `src/sandbox.mjs`: on an ABI with a
prebuild it passes no `sandbox` and webcrack uses its own; on any other ABI it
substitutes one throwing a named, catchable error. Without it the failure is a raw
`No native build was found`, or — if a stale source build is in the tree — a bare
SIGSEGV with no output at all. Keyed on the **ABI**, not the Node major: prebuilds are
named `isolated-vm.abi<N>.node`, and Node 25 is excluded for being abi141, not 25.

5 tests, ABI injected rather than read from the runtime so both branches are covered
whichever Node runs the suite (CI is 22, local is 25 — a test that only exercises its
own runtime's branch is half a test). Suite green on **both** Node 22 and Node 25.

Mutations verified before trusting the guards:

```
M1 always substitute (ignore prebuilt ABIs)  -> 1 failed | 43 passed
M2 generic error message                     -> 1 failed | 43 passed
M3 key on node major instead of ABI          -> 2 failed | 42 passed
restored                                     -> 44 passed
```

Docs corrected where they had inherited the wrong story: `TESTING.md` no longer tells
contributors to `pnpm install --ignore-scripts`, and the drift-spike's "optional dep
fails to build" bullet now says what it does and does not block.

Stacked on `docs/webcrack-node-25` (#5/PR #48) rather than branched off `main` — the
fix lands in `unpack.mjs` and the pipeline README, which that PR already owns.
