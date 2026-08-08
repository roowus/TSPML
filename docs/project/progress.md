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

**Discovery fix during implementation:** the checkpoint anchor originally used method-name *identifiers* (`addCheckpointCallback`…) which the locator can't match (it keys off **string/numeric literals** only) → reused module 641's string-data anchor instead. **Adversarially reviewed** (3 lenses; 0 blockers, 1 major→fixed, nits→fixed): the major was that `race.started`/`checkpoint.passed`/`race.finished` fire **per-car** (player + ghosts), not player-only as comments claimed (the player flag is a private minified WeakMap field the inject can't read) → corrected the comments + filed **issue #10** (add an `isReplay` accessor for player-only filtering). [**Correction, 2026-08-04:** that parenthetical is wrong — the flag is a module-scope `var` WeakMap in the inject's scope chain, and #10 shipped with no accessor. See the #10 entry at the end of this file.] Also normalized `CAR_CREATED` minHits 2→3 and replaced a dead `trackPartData` identifier-anchor entry with a real string literal. `@tspml/api` gained `CarCreatedInfo`/`RaceFinishInfo` payload types.

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
`TspmlApi`, but the loader's `ModApi` still lacks `keybinds`/`version`. (Closed
2026-08-04; see the #18 entry at the end of this log.)

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

## Where we stand (2026-08-04)

- **Engines + bridge + scaffold + pipeline + dev harness, all unit-tested:** loader (65) · mappings (28) · transform (35) · portal (17) · api-bridge (41) · shared (24) · create-tspml-mod (9) · mappings-pipeline (107) · dev-harness (11) — **337 tests green**, CI green.
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
- **#16 / #17 / #30 ✅** — `includes` warns instead of silently ignoring; `onUnload` is actually called (idempotent, reverse order); the stub packages stopped overstating themselves.
- **#43 / #1 / #3 spikes ✅** — WASM constants are locatable *structurally* (fail-closed on ambiguity, 97.4% of 0.6.2's functions unique), AST fingerprints break match ties (**0.848 → 0.939**), and split chunks are *discovered from the webpack runtime* rather than probed. **#1 is now wired into `gen-map` via `select.mjs`** (see below); #43 and #3 remain measurement + mechanism, neither patches yet.
- **Open:** #10 (player-only). (#18 `ModApi` drift closed 2026-08-04.)
- **Next:** **M10** (PML narrow importer, unblocked) — with two working content registries (`tracks`, `audio`) for the importer to map PML mods onto. (Wiring `fingerprint.mjs` into `gen-map.mjs` is **done** — the 0.939 now comes from the pipeline, not an offline harness. What remains is the separate call of whether to *promote* the candidate map.)
- **Known paper cut — retired, and the first diagnosis was wrong.** `fingerprint.mjs` used to resolve `@babel/parser` through a hardcoded `.pnpm/webcrack@2.16.0/…` path, recorded here as "a webcrack bump breaks it". Measured: it does **not**. pnpm keeps a hoisted `.pnpm/node_modules/`, reachable from *any* path under `.pnpm/`, so `@babel/parser` still resolves with `webcrack@2.16.0` moved off disk entirely. The version string was **misleading, not load-bearing** — it looks like a pin and is not one. Now resolved via the version-agnostic symlink `realpathSync`'d first (pnpm lays a package's deps out as *siblings* in its store dir, and Node walks up from the **real** path, so requiring through the symlink itself fails). The guard that catches this is a **spawned plain-Node** test: vitest resolves bare specifiers through Vite, not Node, *and* exports `NODE_PATH` that children inherit — so the broken form stayed green under vitest both ways until the child's `NODE_PATH` was stripped.

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



## 2026-08-04 — #1 (structural fingerprints: 0.848 -> 0.939)

[#1](https://github.com/roowus/TSPML/issues/1) asked for AST structural fingerprints to
raise the auto-map match rate past ~85%, on the theory that the residual was
*"low-anchor modules (1-2 string literals)"* that lexical anchors could not reach at all.
Measuring the residual first retired that theory and changed what the fix had to be.

**All 10 unmatched game-logic modules are rejected by the margin gate, not by anchor
scarcity.** Two (`3025`, `6979`) have the *correct* target already in first place -- same
webpack id across versions -- and are discarded purely for leading by 1.15x/1.19x instead
of 1.25x. Five are exact 1.00 ties. And `8928.js` has 67 anchors with 51 shared: the
opposite of anchor-starved.

So structure's job is **adjudicating ties anchors already surfaced**, not finding matches
anchors cannot see -- a much smaller and much more testable claim. It also rules out the
cheap alternative: lowering the margin alone would admit the five exact ties on coin-flip
evidence. Structure is what makes admitting them defensible.

`src/fingerprint.mjs` counts 34 rename-invariant shape facts (arity distribution,
control-flow mix, nesting depth bucketed 1/2/3/4+, computed-vs-static member access),
log1p-compresses them and compares by cosine. Identifier names, literal values and source
positions are deliberately excluded -- names are what minification destroys, literals are
already covered better by the anchor scorer (double-counting them would hide disagreement
between the two signals), and offsets are formatting-dependent, the same lesson #43 learned
on the WASM side.

**Result: game-logic 0.848 -> 0.939.** Six promotions, zero regressions, ~540 ms for all
421 modules, 0 parse failures. Every promotion was hand-verified by reading both bodies
rather than trusting the score -- `2247 -> 3080` is byte-identical; `5343 -> 1648` is
confirmed by the source's `Math.ceil(i / 3 * 4)` being present in `1648` and absent in the
runner-up. In two cases the lexical "best" was a much larger module that merely *imports*
the right one, which is the failure mode a size-blind anchor score is prone to.

**One design point measurement forced.** Scoring the whole top-K was the first
implementation and it silently vetoed a correct decision: for `8928.js` structure separates
the two tied heavyweights cleanly (0.99898 vs 0.71643), but a candidate an order of
magnitude behind lexically scored 0.98159 on shape and collapsed the gap below threshold. A
candidate already rejected on direct evidence must not get a structural veto. Restricting
the vote to the lexical tie band took 0.909 -> 0.939.

The four still open (`3025`, `6979`, `7129`, `8739`) are small enum-shaped modules where a
34-bucket histogram **saturates** -- `3025.js` scores an exact 1.00000 against three
different targets. That is the fingerprint correctly reporting it cannot tell, and
`adjudicate` returns null rather than guessing. Separating them needs call-graph edges
between already-matched modules: a module's neighbours are far more distinctive than its
shape. That is the open remainder of #1.

Not yet wired into `gen-map.mjs` -- doing so changes which targets a candidate map proposes,
so it wants its own PR with a full regen diff. *(Done — see the 2026-08-04 integration entry
below.)*

18 new tests (55 in the pipeline suite). Each guard mutation-checked:

| mutation | result |
|---|---|
| track `fnDepth` as mutable state instead of passing it down | 1 failed / 54 passed |
| return a zero vector instead of `null` on a parse failure | 1 failed / 54 passed |
| drop `log1p` compression | 1 failed / 54 passed |
| let structure override a decisive lexical win | 2 failed / 53 passed |
| score the whole top-K instead of the lexical tie band | 1 failed / 54 passed |
| accept a hairline structural gap (`minStructural` removed) | 2 failed / 53 passed |
| stop distinguishing computed from static member access | 1 failed / 54 passed |
| restored | 55 passed |

## 2026-08-04 — #1 wired into the generator, and the defect that surfaced ✅

The 0.939 above was measured by a harness. The map a mod actually resolves against was
still built by `gen-map.mjs`, which held its **own verbatim copy** of the scorer. That
duplication was survivable while both were a frozen copy of the M1 spike, and stopped being
survivable the moment the claim became a *delta between two rates*: if the copies could
drift, `0.848 -> 0.939` would be a fact about `match.mjs` and not about the map, and the
number in the README would be unfalsifiable.

New `tooling/mappings-pipeline/src/select.mjs` is now the single place a source module's
target is chosen (`topCandidates`, `chooseTarget`, `makeFpCache`); `match.mjs` and
`gen-map.mjs` both call it. `--structural` on the harness (default **off**, so one command
still yields the baseline) and `GEN_STRUCTURAL=0` in the generator (default **on**).

**Behaviour-preservation proved before trusting the new number.** The post-refactor lexical
baseline matches the pre-refactor report on every metric including `perSubsystem identical`,
and the lexical-only regenerated map is **byte-identical to the committed
`polytrack-0.6.2.json`** — same bundleHash, same 5 targets. Only then was the tie-break
switched on: 0.848 -> 0.939 reproduced exactly, **0 regressions, 0 changed targets**,
`gen-map` 56 -> 62 modules, ~0.585 s.

**30 promotions, not 6.** The 6 in the #1 table are the game-logic ones. The other 24 were
checked with `cmp -s` rather than assumed: every one byte-identical source→target, mostly
`module.exports = require.p + "images/*.svg"` asset stubs. Overall rate 0.82 -> 0.966.

### The defect this would otherwise have shipped

`regen --diff` came back LOW RISK but reported `stableNames: 8 relocated`. Additive changes
should relocate nothing, so that number was the interesting part of an otherwise clean run.

Root cause was not in the fingerprints. `buildIndex` in `source/mappings/src/resolver.ts`
was first-wins over `Object.values(map.modules)` — **JSON key order**. Structural promotions
land earlier in the regenerated file, so they took 8 pre-existing stable names off
lexically-matched modules purely by file position (`trackpartrotationaxis` 11 -> 1648,
`checkpoint` 3571 -> 3080, `carstyle` 2522 -> 5492, and five more). That inverts the exact
evidence ordering `adjudicate()` enforces *within* one module's decision: anchors are direct
evidence about a module's own literals, structure is circumstantial. The index enforced the
opposite *across* modules, by accident of serialization.

Collisions are unavoidable and real — sibling track-block registries genuinely all declare
`TrackPartRotationAxis` — so the fix is to rank them, not to forbid them. `beatsForIndex`
now orders by kind of evidence (lexical beats structural), then `matchWeight`, then
`moduleId` for determinism. Measured: **insertion-order re-points 19 pre-existing names;
evidence-ordered re-points 0**, and adds 14 newly-resolvable. Now genuinely additive.

`decidedBy` / `structuralSimilarity` are emitted per module and validated on load. An
*unrecognised* `decidedBy` is **rejected**, not tolerated: read as "not structural" it would
quietly win a collision it should lose. Absent means lexical, so every already-committed map
resolves exactly as before — reading absent as "unknown, therefore weaker" would demote
every pre-#1 module below any structural newcomer.

**Deliberately not done in this PR:** promoting the committed `polytrack-0.6.2.json`. The
candidate verifies LOW RISK with 5/5 targets passing, but regenerating it changes what
shipped mods resolve against, and that is a separate call. *(Made, and promoted, in the
next entry.)*

### A second defect, caught in review of this PR

The first version of the integration read `bestShared` — the diagnostic gen-map records for
every *unresolved* module — off `chooseTarget`'s return value. But `chooseTarget` returns
`null` precisely when it refuses to pick, so every unresolved module was reported as having
**0** shared anchors. The committed pre-#1 map says `3025` has **9/10**.

That is worse than a cosmetic slip: it inverts the central finding of #1. "All 10 unmatched
modules are rejected by the **margin gate**, not by anchor scarcity" is the measurement the
whole design rests on, and a map reading `0/10` tells the next person the exact opposite —
sending them to look for missing anchors instead of a too-tight margin. `bestShared` now
comes from `topCandidates(..., 1)`, which reports the lexical leader whether or not the
gate accepted it. Restored to `9/10, 8/9, 2/4, 2/2`, matching the committed map exactly.

Worth noting how it surfaced: every gate was green. Tests passed, the diff was LOW RISK,
targets verified 5/5. It showed up only from reading the regenerated map's `unresolved`
section against the committed one — the artifact, not the pipeline. Verifying the parts is
not verifying the whole.

20 new tests (**337 workspace green**; pipeline 90 -> 107, mappings 25 -> 28). Guards
mutation-checked:

| mutation | result |
|---|---|
| apply the evidence floor to the lexical leader, not the chosen candidate | 1 failed / 15 passed |
| default `structural` on with no `fpOf` to get shapes from | red |
| drop the name tie-break in `topCandidates` (regen stops being reproducible) | red |
| revert `buildIndex` to first-wins (`if (held === undefined)`) | 3 failed / 25 passed |
| read `bestShared` off `chooseTarget` instead of the lexical leader | map reports `0/10` where the committed map says `9/10` |
| restored | 17 and 28 passed |

**The first of those stayed green, and the test was at fault, not the guard.** The fixture
used weights 7 and 6 — both *under* the evidence floor (`count >= 2 && w >= 8`) — so neither
reading of the floor could accept, and the assertion could not tell them apart. Rewritten to
straddle it (leader 8 clears, promoted candidate 7 does not), it goes red as intended. Worth
recording because a surviving mutation reads identically whether the guard is redundant or
the test is weak, and the two want opposite responses.

## 2026-08-04 — #17 closed: the unload trigger, and what "implemented" was hiding ✅

#17 was marked ✅ on 2026-08-03 with a caveat at the bottom: no unload *trigger* was
wired, deferred behind two unmerged PRs that touched `page.tsx`. Those landed, so this
finishes it — and the finishing is the interesting part.

Everything was already built. `load()` returned an idempotent, reverse-order, per-mod
isolated `unload()`. Every bridge registry had `dispose()`. `loadMods` exposed the
closure. demo-hud returned a disposer that sets an `unloaded` flag *specifically so a
smoke could prove cleanup ran*. 61 loader tests covered it. **Nothing called any of it.**
`page.tsx` dropped the closure `loadMods` handed back, so every `onUnload` in the system
was unreachable no matter how well the loader implemented it.

That is the same shape as the `bestShared` defect two entries up, and worth naming as a
pattern: a capability nothing invokes passes every test written *about the capability*.
The suite was green, the docs were accurate about each part, and the feature did not
exist. Verifying the parts is not verifying the whole.

**What landed.** `lib/teardown.ts` — a pure function, in `lib/` rather than inline
because the portal's vitest environment is `node` and anything inside the component is
untestable. Teardown is the last code path that should be verified by eyeballing it: it
runs while the page is going away, where a thrown error is invisible. Two triggers,
because neither subsumes the other: React unmount (in-app navigation, dev remount) and
`pagehide` (tab close, real navigation), where no React lifecycle runs at all. `pagehide`
rather than `unload` — the latter never fires on mobile Safari and disables the bfcache.

**Ordering is the design, not an implementation detail.** `loader.onUnload` is emitted
*first*, while the bus and registries are still live, because a mod's handler is its last
chance to release something; emitting after disposal hands every listener a dead bridge
and silently drops whatever they do in response — indistinguishable from "no mod cared".
Mods unload before registries for the same reason: a mod's `onUnload` routinely calls
`keybinds.unregister`, and disposing first turns that into a throw during cleanup. Every
stage is isolated, since an exception escaping here abandons the steps after it and leaks
the whole bridge, window listeners included.

**The assertion that actually matters is the browser one.** 7 unit tests cover the
ordering and isolation, all four mutations checked red (emit moved last, registry
isolation dropped, early-return when mods never loaded, stages reordered). But unit tests
were never what #17 was missing — it was missing a caller, and only a real teardown can
tell "wired" from "present". The portal smoke now fires a real `pagehide` on the main
frame and polls demo-hud's `unloaded` flag: **`before: false → after: true`**, PASS.

Mutation-checked at that level too, which is the result worth recording: removing the
`pagehide` wiring drops the smoke to `unloadOk: false`, exit 1 — while `modLoaded`,
`sidebarOk`, `keybindFired` and every event count stay green. That green-everywhere-else
is exactly why this sat open under a ✅ for a day.

344 workspace tests (7 new), lint clean, smoke PASS.

## 2026-08-04 — the 0.6.2 map promoted: 56 -> 62 modules ✅

The separate call from the entry above, now made. `maps/polytrack-0.6.2.json` is regenerated
through the wired pipeline: **56 -> 62 modules, 10 -> 4 unresolved**, `bundleHash` unchanged.

What made it safe to promote was not the LOW RISK verdict — that verdict was equally green
while the `bestShared` defect was live. It was checking the thing mods actually depend on.
A map diff is the wrong unit: two module *keys* changed owner (`trackpartrotationaxis`,
`checkpoint`, both to `decidedBy: structural`), which looks like exactly the silent
re-pointing the resolver ordering fix exists to prevent. So resolution itself was compared,
every stable name before against after:

| | count |
|---|---|
| unchanged | 232 |
| newly resolvable | 14 |
| **re-pointed** | **0** |
| lost | 0 |

Purely additive, which is what adding modules to a map is supposed to be. The two changed
keys are collisions the evidence ranking now adjudicates, and it hands both to the same
module as before. `verifyTargets` against the 0.6.2 corpus: **5 pass, 0 ambiguous, 0 fail**.

The four still unresolved are a strict subset of the ten, carrying byte-identical `reason`
strings — `3025` 9/10, `6979` 8/9, `7129` 2/4, `8739` 2/2. That subset relation is the
check worth keeping: it says the promotion only ever removed modules from the unresolved
list, and it is the artifact-level assertion that would have caught the `bestShared`
inversion on its own, since a regressed diagnostic would read 0/10 here.

`map.test.ts` asserts the exact counts and that `modules + unresolved == 66`, the corpus
size. Exact rather than a floor deliberately: the assertion's job is to make an unreviewed
regeneration fail loudly, and a regeneration that silently changes what a shipped mod binds
to is the one failure this package exists to prevent.

## 2026-08-03 — #43 spike: WASM constants can be located structurally

#43 is the one capability gap in PML's favour (they ship `registerPhysicsMixin`,
byte-offset patching of `polytrack_physics.wasm`) and it gates M11. It poses an open
question: can we locate constants *structurally*, so the map stays re-derivable,
rather than copying their offset table? Spiked it. **Answer: yes, 97.4%.**

**Finding 1 — the physics binary is byte-identical across 0.6.0/0.6.1/0.6.2.**
396,005 B, sha256 `d4ef0267…4c180e`, all three. The JS bundle re-minifies every
release; this artifact has not moved once. So offset patching works *today* and
breaks *silently* on the next recompile — and a wasm-specific hash pin is cheap right
now because there is exactly one hash to pin. (It lives at
`<ver>/polytrack_physics.wasm`, not under `lib/` as the glue's `importScripts` hints.)

**Finding 2 — no name section.** 14 exports, all single letters. Structural matching
isn't the better option, it's the only one.

**Finding 3 — constants alone don't locate.** 36 f64 constants (all math-library: π,
trig coefficients) and 98 f32 (physics runs in f32 — a patcher must compare through
`Math.fround` or find nothing). No gravity constant exists in the 9–10.5 range, so
that knob is probably a runtime parameter, not a baked-in value. And a symmetric-clamp
idiom for ±10 matches 3 sites — the same ambiguity as the `"PolyTrack2"` anchor.

**Finding 4 — fingerprint the containing function, then index within it.** Sorted
multiset of float constants + opcode-byte histogram, no offsets or indices:
**535/549 functions (97.4%) uniquely identified**; constants alone got 151/188. Four
residual collision groups are near-certainly byte-identical template instantiations.

Relocation was tested for real rather than asserted: inserting 4,096 bytes before the
code section leaves the stale offset pointing at garbage while the signature
re-derives the exact new address, uniquely.

`locateBySignature` **fails closed on ambiguity as well as absence**. For JS a
mis-target is a patch that does nothing; here it would write a float into an
unidentified function, so anything short of a unique match must refuse.

Shipped as `tooling/mappings-pipeline/src/wasm-locate.mjs` + 14 tests that build
synthetic wasm byte by byte, so CI never needs the proprietary binary. Three guards
mutation-checked (ambiguity→pick-first, dropped tiling check, offset in fingerprint).
Write-up: `docs/research/wasm-structural-location.md`.

**Locating only — no patcher, deliberately.** That is a separate decision gated on the
hash pin, and physics mods must feed the warn-only `classifySafety` labelling.
Cross-version validation is impossible until PolyTrack ships a *different* binary;
that release is the first real test.

## 2026-08-04 — #3 (webpack split chunks: discovered, not probed)

[#3](https://github.com/roowus/TSPML/issues/3) asked for chunk fetching because "0.6.2
splits more game code into webpack chunks" and full symbol coverage needs them. Measuring
first retired the premise and changed the shape of the fix.

**The size drop was pretty-printing, not chunking.** The cached `pt-0.6.0-raw-main.js` is
3.76 MB across 71,457 lines (59.4% whitespace); 0.6.2 is 1.78 MB across 25 lines (3.3%).
Whitespace-collapsed: 1,762,889 B vs 1,727,783 B — the same code volume. The four real
chunks total 202,074 B, nowhere near the ~2 MB the issue's reasoning implied.

**The chunks are UI-only.** 112 (108,037 B), 535 (13,182 B), 604 (74,464 B), 657 (6,391 B)
hold the editor toolbar, track verifier, profile selection and settings panels. Of the 11
distinct mod-facing target literals, only `PolyTrack2` appears in a chunk at all, plus 1 of
TrackCodec's 4 — which `minHits: 4` correctly rejects. So `gen-map` matching `main` alone
is *complete*, and `--chunks` ships **off by default** as a review signal: it makes a future
release that moves game logic into a chunk visible at regen time instead of showing up as an
unexplained drop in match rate.

**Discovery, not probing.** `parseChunkIds` reads webpack's own `i.e(<id>)` call sites out
of the runtime. A probe loop is wrong twice over: the CDN 404s with a 355-byte HTML page (a
naive "did it download" check banks the error page as a chunk), and it still serves stale
chunks from earlier builds — `0.6.2/57.bundle.js` returns 200 with real code that 0.6.2
never loads. Anything the runtime does not reference is not part of the build, whatever the
CDN says.

Verified end-to-end: `parseChunkIds` yields `["112","535","604","657"]` for 0.6.2 and `[]`
for 0.6.0 (unchunked — a legitimate no-op, not a throw); `fetch --chunks` downloaded all six
files with per-file sha256; `regen.mjs 0.6.2 --chunks` printed
`chunks: 112, 535, 604, 657 (fetched for review; not matched)` then `risk : NONE`.

Guards mutation-checked before being trusted:

| mutation | result |
|---|---|
| lexical sort instead of numeric | 1 failed / 41 passed |
| no dedupe (array not Set) | 1 failed / 41 passed |
| chunk-id validation removed | 1 failed / 41 passed |
| chunk `cacheName` collides with `main` | 1 failed / 41 passed |
| restored | 42 passed |

That last collision case is the one worth keeping: a chunk overwriting
`pt-<ver>-raw-main.js` would silently replace the bundle `gen-map` matches against.

## 2026-08-03 — #30 (partial) stub packages stop overstating themselves

#30 lists five places where the repo claims more than it has. Took the three that
are disjoint from the open PR stack; `source/shared` is excluded because #38 is
actively implementing it (it now has real `bridge-patches` / `early-capture`
sources), and the root README layout block is owned by #40/#44.

**The root `workspaces` field was inert *and* wrong.** It listed four globs, omitted
`environments/demo-mods/*` that `pnpm-workspace.yaml` includes, and pnpm never reads
it — pnpm uses the yaml exclusively. So it was a second, disagreeing source of truth
that could only ever mislead. Deleted rather than corrected: keeping it in sync buys
nothing, since nothing consumes it. Verified by enumerating members before and after
— 15 both times, identical list.

**`tooling/cli` said "scaffolded".** It has no source, no bin, no tests — two
metadata files. "Scaffolded" implies something to fill in; this is a reserved name.
Both the README and the `package.json` description now say NOT IMPLEMENTED and point
at `@tspml/mappings-pipeline` for the workflow people actually want.

**`tests/` and `scripts/`** advertised a "shared test harness", "cross-package
integration tests", and "repo and build helper scripts". None exist. Both READMEs now
say empty-on-purpose and table where the real thing lives — plus why co-location is
deliberate (pipeline scripts sit next to webcrack and `.cache/`; smokes next to the
app they load), so the next person doesn't "fix" it by centralizing.

No guard test for this one. It would need a new workspace package to hold a single
assertion about README prose, which is disproportionate and would immediately
contradict the "empty on purpose" note it lives next to.

Still open on #30: the duplicated `TargetSpec`/`ModuleAnchor` TODOs in
`source/loader/src/types.ts` and `source/transform/src/types.ts` — both wait on #38.

## 2026-08-03 — #16 `includes` is now honest

`includes` was parsed, typed, validated, stored on `Mod` — and then never read by
the resolver. A manifest declaring it loaded cleanly and the nested mod simply was
not there. Same shape as #17: a field can be complete on every surface an author
touches and still be structurally inert.

**Decision: warn loudly, don't implement.** `includes` is Fabric's JAR-in-JAR
analog, and TSPML has no delivery mechanism for it — we cannot install a mod from
a directory *at all*, let alone one nested inside another package. Implementing it
would mean inventing that mechanism first. Rejecting the field instead was also
wrong: it is valid per the published spec, so rejecting would break conforming
manifests, and the field may be honoured later.

So `resolveDependencies` emits one `unsupported-includes` warning per included id,
saying plainly that **the nested mod will NOT be loaded** and pointing at `depends`
as the working alternative. The failure moves from silent-at-runtime to loud-at-
authoring-time. `docs/api/mod-json-spec.md` says the same thing in both the
semantics list and a ⚠️ callout.

4 new tests (57 loader tests green). The guard was mutation-checked — neutering the
loop turns 2 of them red.

## 2026-08-03 — #17: `onUnload` was declared, documented, and never called ✅

`TspmlMod.onUnload` was on the base class. `loader.onUnload` was in the published
event map. Three docs called it *"fixes PML's missing-cleanup bug."* Nothing ever
called it.

The reason is worth recording, because it is not "we forgot to wire it up." In
`invokeMod`, the class instance was a **local variable** — constructed, run
through `preInit`/`init`/`ready`, and then dropped on the floor when the function
returned. The hook was unreachable *by construction*. No amount of wiring at the
host level could have reached it; the object holding the method no longer existed.

**A feature can be declared, typed, exported, and documented while being
structurally impossible to invoke.** Nothing in the type system objects: the
declaration is well-formed and the method is legitimately optional. The tests
didn't object either — they asserted load behaviour, and load behaviour was
correct. This is the third variant of the same failure this week (#25's silence,
#19's contents-not-behaviour, this one's unreachability), and the shared root is
that we verified the piece rather than the path through it.

`LoadResult.unload()` now tears down what loaded. Four properties, each chosen
against a specific way cleanup goes wrong, and each **mutation-checked** — I
reintroduced the defect and watched the test go red before trusting it:

- **Reverse load order.** A dependent must dispose before its dependency, or it
  cleans up against state already released. (Un-reversing it also broke the
  isolation test, which tells me the two are entangled in a way worth knowing.)
- **Per-mod isolation.** A leaky mod throwing on the way out must not strand the
  cleanup of every mod after it — the same fail-small rule as loading.
- **Idempotent.** A page teardown and an explicit disable can race, and running
  cleanup twice is precisely the double-free that cleanup exists to prevent.
- **Awaited.** An async `onUnload` finishes before `unload()` resolves, so a host
  emitting `loader.onUnload` afterwards can trust cleanup actually completed.

Two entrypoint forms, each disposed the way it naturally can be. The class form
has an instance, so `onUnload(api)` is called on it — and it now *receives* the
api, so a mod can `events.off(...)` without having stashed a reference at init.
The factory form has no instance at all, so it opts in by **returning** a
disposer: the same convention `api.events.on` and `api.keybinds.register` already
follow, rather than a third mechanism to learn.

A mod that loads but exposes no cleanup reports `no-op`, distinct from
`unloaded`. "Nothing to clean up" is a different claim from "cleanup ran," and an
*absent* entry would read as "we lost track of this mod" — the wrong signal for a
host surfacing results.

**Deliberate split: the loader calls cleanup but does not emit the event.**
`TspmlApi.events` is `on`/`once`/`off` only — enforced by the type since #18,
prose before it — so the loader has no emit capability by design, and giving it one to fire a single event would widen the capability
surface handed to every mod. The host that owns the bus emits `loader.onUnload`
around the call; `loadMods` exposes `unload()` for exactly that.

demo-hud turned out to be the proof case: it was discarding the disposers that
`on` and `register` already returned — leaking exactly what #17 describes, in our
own example mod. It now returns a disposer that detaches both.

61 loader tests green (8 new), build and lint clean. PR off `main`.

**Still open on #17:** the portal has no unload *trigger* wired (`pagehide` /
iframe reload), because that lives in `page.tsx`, which unmerged #38 and #39 both
modify. Deferred rather than conflicted — the capability and its host entry point
are in place, so the trigger is a small follow-up once the stack lands.
*(Wired, with a browser-level assertion — see the 2026-08-04 entry below.)*

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

## 2026-08-04 — #18: `ModApi` unified with `TspmlApi`, and a documented guarantee made true ✅

`ModApi` (`source/loader/src/types.ts`) was an M1-era stub — `events` (`on`/`off`)
plus `logger`, nothing else — still carrying `TODO: move to @tspml/api once that
package exists`. That package exists, publishes the canonical six-member
`TspmlApi`, and the two diverged. `ModApi` is now an alias of `TspmlApi`; the
loader gained the `@tspml/api` dependency (no cycle — that package has none), and
`stubApi` grew the missing `keybinds`/`tracks`/`audio`/`version` members,
answering the typed `'not-ready'` failure both result unions already define.

**The scope in the issue text was stale — two of its three symptoms were already
fixed.** #32 added `logger` to `TspmlApi`, demo-hud dropped its local logger type,
and the scaffold has a drift test (`tooling/create-tspml-mod/tests/scaffold.test.mjs:139`).
A scaffolded project compiled fine before this change; the live problem was only
the stub type and two casts. The issue body was corrected rather than worked
around silently.

**What the casts were hiding.** Both hosts reached the loader through
`loadMods(api as unknown as ModApi)`. A double cast suppresses *every* check, so
mods were typed against a surface missing three of its six real members while the
runtime object had all six. Worse, three docs and a code comment promised
`ModApi.events` was `on`/`off` only *by design* — meaning a mod cannot forge
`race.finished` — while `page.tsx` assigned the full emit-capable `EventBus`. The
guarantee was fiction, and the cast is why nobody noticed. It is now **true**:
`TspmlApi.events` is `TspmlEventSubscriber` (`Pick<TspmlEventEmitter, 'on'|'once'|'off'>`),
a pre-1.0 narrowing of a published type. `EventBus` still implements the full
emitter, so hosts and bridge patches are unaffected and one object serves both
roles at runtime.

**A repo-wide typecheck blind spot, found while verifying.** Every emitting
package's tsconfig is `include: ["src"]` with `rootDir: src` — so it *cannot* also
include `tests`, and no package's tests were ever typechecked. vitest's esbuild
transform strips types without checking them, so a test file could name a type
that no longer exists and `build`, `test` and `lint` would all stay green. That is
not hypothetical: the stale two-member `ModApi` literal in `loader.test.ts` would
have survived this very change. Fixed for the loader with `tsconfig.tests.json`
wired into its `lint` script. **The other packages still have the gap** — noted
here rather than fixed, since widening it is not #18.

**Mutations (each verified red, then restored green):**

```
revert loader.test.ts to the 2-member ModApi literal -> TS2322 (invisible before)
drop `version` from the portal's api literal         -> TS2741 (silent before)
add api.events.emit('race.finished', …) to demo-hud  -> TS2339 'emit' does not exist
```

The second is the regression being fixed, so it had to be demonstrated rather
than asserted. The third proves `TspmlEventSubscriber` is load-bearing.

The dev-harness `TrackedModApi` was a hand-rolled structural mirror with
`logger?: unknown` and no `off` — the harness lying to the very mods it exists to
test. It now `extends TspmlApi`. Its INPUT (`ModLikeApi`) stays structural so the
tests drive it with plain `vi.fn()` mocks. **One cast survives, documented in
place:** `TspmlEventMap` gives each event a different readonly tuple, so a
listener generic over `K` has no single loose supertype — TS reduces the
intersection to `never`. The wrapper never inspects an argument, only records the
unsubscriber, so erasing the parameters is sound in a way the type system cannot
express. It is confined to three lines rather than applied to a whole api object,
which is the difference between a defect and a note.

Both smokes re-run because the portal `api` literal and the tracking wrapper were
touched: portal `PASS: true` with `unloadOk` and every event count unchanged;
harness `gameSurvivedHmr: true`.

## 2026-08-04 — #10: per-car race events tagged, and the issue's premise disproved ✅

`race.started`, `checkpoint.passed`, `checkpoint.respawn`, and `race.finished` are
patched onto methods of the car-controller class, so they fire **once per car** —
the player's *and* every ghost. A lap timer subscribing to `checkpoint.passed`
double-counts on any track the user has a record on. Chosen fix shape (owner's
call): **tag the payload** rather than filter at the source, so a mod that *wants*
ghost data keeps it.

**The blocker in the issue text was wrong.** #10 recorded the controlled-car flag
as "a private minified WeakMap field the inject can't read" — that claim came from
the M4-D/E/F review above and it stood unexamined for four days. It is false. The
flag (`ie`) and the physics car id (`ee`) are module-scope `var` WeakMaps in the
same webpack module (641) as the class, and a `before` inject is spliced lexically
*inside* the target method's block — so both are in its scope chain alongside
`this` and the params. No accessor patch, and nothing is ever written to a game
object (which would have been a first for this repo). Verified against the real
bundle, not inferred.

The sense matters and is easy to get backwards: the game stores *is-controlled*
(`ie.set(this, recording == null)` in the constructor), so `isReplay` is its
**negation**. Every read is guarded and yields `null` on failure — `null` means
*unknown*, explicitly not *the player*, and the docs now say so at every mention,
because a mod checking truthiness instead of `=== true` would silently attribute
unknown cars to the user. Failing soft rather than throwing is non-negotiable
here: this code runs inside game code, and one of the two sites is a per-frame
method. In that site the payload is built **lazily inside each transition
branch**, not once up front — both branches are false on almost every frame for
every car, and two WeakMap reads per car per frame for a value nothing reads is a
real cost at 60fps.

The two minified names live in one exported constant (`CAR_CONTROLLER_BINDINGS`)
interpolated into the injects, which buys the same one-place-to-fix-on-rename
surface the rejected accessor option would have, without the write
([#24](https://github.com/roowus/TSPML/issues/24)). A test asserts each name
appears an equal number of times, so a future inline re-scatters nothing quietly.

**A bug I made and caught before it shipped:** the first payload helper read
`this` inside its own IIFE. The game module is `"use strict"`, so `this` there is
`undefined` — every read would have thrown, been swallowed by the guard, and
degraded to `null`. The fix would have parsed, applied, emitted, and been a total
no-op. The receiver is now passed explicitly, and a dedicated test pins it.

**Verification (owner's call: synthetic bundle + tighten the live smoke).** No
smoke can produce a ghost — a ghost needs a saved lap record and every smoke
launches a fresh headless profile — so the player-vs-ghost distinction was
untestable in this repo by construction. `source/shared/tests/per-car-events.test.ts`
builds a synthetic webpack bundle mirroring module 641 (two cars, one driven, one
recording; plus a decoy module carrying none of the anchor literals), runs the
**real** transform over it, executes the output, and asserts the exact payload
tuples. It asserts `failed` is empty and `applied` has the expected length first,
so a patch that stops matching fails loudly instead of making every later
assertion vacuous, and it selects patches by anchor literal rather than array
index. Three mutations proven red then green: dropping the `!` (6 failures),
reintroducing the strict-mode `this` (7 failures, everything `null`), inlining a
binding (2 failures incl. `uneven binding use`). The portal smoke's `race.started`
gate went from `> 0` to `=== 1` **plus** attribution — one payload,
`isReplay === false`, numeric `carId` — since `> 0` would have passed on a payload
of ghosts.

**Second gap closed on the way.** Updating the api-bridge event-bus tests to the
new payloads revealed that `bus.emit('checkpoint.passed', 0)` had become
type-invalid and **nothing in CI could see it**: every emitting package is
`include: ["src"]` with `rootDir: src`, so the suites were only ever compiled by
vitest's esbuild transform, which strips types without checking them. A suite that
is not typechecked is a poor guard for a type change. `source/shared` and
`source/api-bridge` gained the `tsconfig.tests.json` + `lint` pattern #18
introduced for the loader; reverting one emit proved it red. `transform`,
`mappings`, and `portal` still do not typecheck their tests (task #25).

Also avoided repeating #18's CI failure: `pnpm -r test` runs **before**
`pnpm -r build`, so the new test importing `@tspml/transform` would have resolved
a `dist/` that does not exist yet on CI while passing locally off a stale one. A
vitest `resolve.alias` points at the dependency's source instead.

## 2026-08-07 — runtime user mods: the portal is usable without forking ✅

The portal could load real mod packages — but only the two demo mods statically
imported at build time. For the audience the portal exists for (a PolyTrack modder
with a built mod in hand), that made it a demo, not a tool: running your own mod
meant editing `source/portal/lib/mod-loader.ts` and rebuilding, which the
getting-started guide actually instructed. That instruction is now deleted.

**The feature.** A "+ Add a mod" form in the sidebar takes a pasted `mod.json` +
BUILT entrypoint JS. The record persists in `localStorage`
(`tspml.userMods.v1`), and on load the stored code becomes a live ES module via a
Blob-URL `import()` (revoked after import — module namespaces outlive their URL,
and leaking one per reload pins every old mod version for the tab's lifetime).
Enable/disable/remove per mod; re-adding the same id replaces the stored copy,
which is the iteration loop while developing. Every mutation funnels through one
serialized unload-everything/load-everything chain — the loader owns dependency
resolution over the *full* set, so incremental add would be a lie, and an
unserialized toggle spam would interleave unload/load pairs.

**One loader path, not a parallel one.** User mods enter the same `load()` call
as the bundled mods, via the `importEntry` hook and a namespaced `user:<id>`
entry specifier: manifest validation, dependency resolution, per-mod failure
isolation, safety classification, and unload all apply unchanged. Two deliberate
edges: a user mod whose id collides (with a bundled mod or another user mod) is
pre-failed *before* `load()` — the loader rightly treats duplicate ids as
abortive for the whole set, and one bad paste must not take the demo mods down —
and a record with no usable id goes to the loader anyway so
`parseVersionManifest` owns the error message.

**Honesty over silence (the PML failure mode this repo exists to fix).** A user
mod's declared `mixins` are NOT applied: the mixin transform runs server-side in
the proxy when the bundle is fetched, and the server cannot see this browser's
localStorage. Instead of silently ignoring the field, `ModLoadSummary` gained
`mixinsSkipped` and the sidebar says exactly which mod's mixins were skipped and
why. Applying them for real needs the patch set to reach the proxy — filed as
#62 with the three candidate routes (session-scoped patch POST, client-side
transform in the SW, or riding the M8 extension). The Add form also states the
other contract in plain words: mod code runs unsandboxed in the portal page, in
your browser — that is what a mod loader does; only add code you trust.

**Verification.** 14 new unit tests (`source/portal/tests/user-mods.test.ts`):
storage round-trip, corruption degrading to `[]` without a boot loop, malformed
entries dropped individually, and the loader path — load-alongside-bundled,
disabled-skipped, manifest/import failures isolated, both duplicate-id shapes,
`mixinsSkipped`, unload through the standard disposer. The Blob-URL import
itself is browser-only (node's `import()` cannot eat a Blob URL — the tests
inject `importUserMod`), so a fourth headless smoke (`smoke:usermods`) drives
the real form in a real browser: paste → entrypoint runs (stamps a global) →
mixin-skipped warning names the mod → reload restores it from storage → disable
runs its disposer while the bundled mods stay up → remove clears the record.
PASS on all 13 gates, and the three existing smokes re-run green (page.tsx
changed; regression is the point). Portal vitest config gained the
source-aliasing trick from #10's entry (the mod-loader test imports
`@tspml/loader` + both demo mods at runtime; CI tests before build).

All 368 tests green (`pnpm -r test`), full build + lint green.
