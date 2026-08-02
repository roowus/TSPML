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

## Where we stand (2026-08-01)

- **Engines + bridge + scaffold + pipeline + dev harness, all unit-tested:** loader (53) · mappings (25) · transform (35) · portal (17) · api-bridge (14) · create-tspml-mod (4) · mappings-pipeline (37) · dev-harness (5) — **190 tests green**, CI green.
- **M4 ✅** — 6 Tier-1 events + keybinds registry + **real mod loading** (two demo mods load simultaneously).
- **M5 ✅** — mod-declared mixins + chaining/conflict + **mappings-resolved stable-name targeting** (fail-closed).
- **M6 ✅** — warn-only `classifySafety` + **surfaced in the portal** (sidebar safety indicator).
- **M7 ✅** — `create-tspml-mod` CLI + `@tspml/api` publish-ready + **Vite dev harness with scoped mod HMR**.
- **M8 first slice ✅** — MV3 browser extension (gate fix on kodub.com — the resilient online path).
- **M9 ✅** — full regen/diff/verify pipeline (fetch + unpack + gen-map + diff + verify-targets; `regen.mjs` orchestrator).
- **#13/#14 closed.** Open: #10 (player-only), #11 (audio — locator can't reach bootstrap), #12 (custom-tracks).
- **Next:** M7-C (dev harness), M8 continues (api + transforms in extension), or polish.
