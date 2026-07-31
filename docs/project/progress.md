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

## Where we stand (2026-07-31)

- **Engines, all unit-tested in isolation:** loader (47) · mappings (20) · transform (31) · portal rewrite (17) — **115 tests green**, CI green.
- **Transform run-validated in a real browser** (the project's biggest risk, retired) — ADR-012.
- **Not yet playable end-to-end** — blocked by PolyTrack's own origin gate (#8, M4) and track-load/online network paths (#9/#7, M7/M8), *not* by the transform.
- **Next:** M4 — first task is neutralizing the unofficial-version gate via a transform.
