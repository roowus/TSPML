# Injection & delivery

> **Locked decision:** the flagship is a **Vercel-hosted portal website** (like `web.polymodloader.com`) that plays the modded game, using a **CORS proxy + origin handling** to load the real game. The browser extension and userscript are **secondary** resilient fallbacks.

## The hard problem (CSP + CORS)

A naive portal **cannot** run the real game:

- **`frame-ancestors`** in PolyTrack's CSP excludes `tspml.dev`, so the portal **cannot iframe** the game.
- Different origin → page-context `fetch()` of the bundles hits **CORS** (Kodub sends no `Access-Control-Allow-Origin`).
- The game's *runtime* requests (chunk loads, leaderboard/multiplayer XHR) originate from the portal origin, which the backend may reject.

So the portal works **only** via a **service worker + server-side proxy** that fetches Kodub's assets with the right headers and serves them to the page.

## Architecture (portal path)

```
  Browser (tspml.vercel.app)
   │
   ├── Service Worker (same origin) intercepts all requests to kodub.com/*
   │        │
   │        └── rewrites them to  /api/proxy?url=<kodub-url>
   │
   └── /api/proxy  (Vercel edge/serverless function)
            │
            ├── fetches the asset from kodub.com
            ├── sets Origin/Referer server-side (official desktop origin) ──▶ backend trusts it
            ├── caches aggressively (edge + IndexedDB by bundle hash)
            └── returns to the page  (CORS-open to tspml.vercel.app)
   │
   Loader: fetch proxied bundles → AST transform (mappings-resolved, in a helper Web Worker)
           → run transformed game in the page → mods bind via the API bridge
```

- The **service worker** is registered on the portal origin; it intercepts the game's own `kodub.com` fetches and routes them through `/api/proxy`, so the transformed game "thinks" it's talking to Kodub while all traffic is proxied and origin-corrected.
- **`/api/proxy`** (Vercel function) fetches server-side and forwards `Origin`/`Referer` to the official desktop origin (`app-polytrack-desktop.kodub.com`) for the leaderboard/multiplayer endpoints — the same trick PML's Electron uses, done server-side. This is the "figure out the origin" piece and an acknowledged **ToS gray area** (see [safety-and-fairness.md](./safety-and-fairness.md)).
- **No game bundle is ever committed to the repo** — everything is fetched live (or cached) through the proxy.

## Secondary paths (resilient fallback)

- **Browser extension** (`source/extension`, MV3 + `declarativeNetRequest`): rewrites the game's script responses at the **network layer**, *outside* page CSP, so it is immune to a `script-src` change and runs on the **real `kodub.com` origin** (multiplayer/leaderboards intact with no proxy). The review recommends treating this as the most *resilient* path; we keep it secondary for go-to-market but it is the fallback if the proxy gets blocked.
- **Userscript** (Tampermonkey): one-click, runs on real `kodub.com`. Fragilities: Chrome MV3 is progressively disabling userscripts, and a single `script-src` CSP change breaks it (the userscript must race the parser with a `MutationObserver` to strip `<script>` nodes, then re-inject transformed source — works only because there is no `script-src` today).

## Transform pipeline (performance)

A cold-start Babel AST parse+transform of ~5 MB of JS on the main thread is multi-second blocking work. Mitigations:

- Run the **entire AST pipeline inside a helper Web Worker** (`source/transform`).
- **Lazy-transform** numbered chunks — only when a loaded mod declares a hook resolved into them.
- **Cache transformed bundles in IndexedDB keyed by `bundleHash`**, so the pipeline runs once per game update, not per page load.
- Publish cold-start + per-tick input-latency budgets as release acceptance criteria ("no worse than +X ms vs vanilla").

## Offline-first

The loader must run with **zero network access** for already-installed mods (all code + map cached in IndexedDB by hash). Network is only required for discovery, publish, and map updates. Mirror the current map inside the extension/userscript bundle as a last-resort fallback.

## What a surface injects (the shared set)

Delivery is two injections, not one, and **both** are owned by
[`@tspml/shared`](../../source/shared) rather than by any surface — the portal and the
dev harness each carried a private copy until [#34](https://github.com/roowus/TSPML/issues/34),
and had already drifted apart:

| Injection | Where | Why it must be shared |
|---|---|---|
| `BRIDGE_PATCHES` | into `main.bundle.js`, via `@tspml/transform` | The badge, the 6 Tier-1 emits, and the 2 track-capture patches. A surface that misses one silently lacks a feature — which is exactly what happened: the portal had no capture patches, so `api.tracks` could not work there. |
| `EARLY_CAPTURE_SCRIPT_TAG` | into the game's `<head>`, ahead of its deferred bundles | The codec capture fires during **bundle init**, before the host installs `window.__tspml`. Without the stub that capture is dropped and `api.tracks` never attaches — see [hook-system.md](./hook-system.md). |

What stays surface-specific: the portal's mappings `{symbol}` resolution + sha256
hash-gate (`lib/demo-transform.ts`), the harness's Vite middleware (`src/game-proxy.ts`),
the extension's content-script plumbing. The test is whether the code would be
byte-identical across all three.

Both surfaces then converge on the same host-side shape: install the real bridge on the
frame's window, expose `captureTrackManager` / `captureTrackCodec`, call
`readEarlyCaptures` to replay what the stub caught, and attach the registry once **both**
objects are in hand — in either order, since neither capture can attach alone.

## Current implementation status (verified by browser tests)

The portal + SW + proxy + transform pipeline is implemented and **run-validated end to
end** — the portal's headless smokes (`pnpm --filter @tspml/portal smoke` and
`smoke:tracks`) drive the real game and assert on it (full detail:
[portal-browser-test-findings.md](../research/portal-browser-test-findings.md)):

```
portal loads → /api/proxy serves the real live bundle (byte-exact) ✅
  → TSPML_TRANSFORM=1: main.bundle.js is AST-rewritten → transformed bundle RUNS ✅
     (green "TSPML ✔ LIVE" badge in DOM+console, WebGL canvas, 0 JS errors)
  → past the "unofficial version" gate, into gameplay ✅ (was issue #8 — closed)
  → track loads; the 4 race-setup Tier-1 events fire ✅ (was issue #9 — closed)
  → mods load, mixins apply, api.tracks attaches and reaches the game's list ✅
  → a PASTED user mod's mixins.json applies too (#62): the page parks a patch
     plan in the Cache API, the SW replays the bundle GET as a POST carrying it,
     the route composes base+user patches in one pass and rides a per-mod report
     back inside the bundle ✅ (base all-or-nothing, user per-mod isolated)
  → online/leaderboard requests still fail 🚧 issue #7 / M8 (bot-protected upstream)
```

Notes on the pieces that were hard to get right:

- **`<base href="/api/proxy/">` HTML rewrite is required.** The proxied document lives at `/api/proxy` (no trailing slash), so the browser treats `proxy` as a filename and resolves the game's relative `<script src="main.bundle.js">` to `/api/main.bundle.js` (404). Injecting `<base>` fixes every relative ref at once. *This was only caught by a real browser load — `curl` always used the full path.* Related trap: `curl` of `/api/proxy/?version=…` 308-redirects to the slashless form, so without `-L` you see an empty body and may wrongly conclude the `<head>` injections are missing.
- **PolyTrack's "unofficial version" gate is cleared via the game's OWN path** (closed #8): setting `window.polytrackModConfiguration = {modName, author}` in `<head>` — PolyTrack's first-class mod-loader signal — rather than by bundle surgery (ADR-013).
- **The service worker must CONTROL the page before the game mounts** (closed #9). It is registered on `/` and calls `skipWaiting()`/`clients.claim()`; the portal mounts the iframe only on `controllerchange`, because a runtime kodub fetch that escapes the SW CORS-fails ("Failed to load track"). The smokes reload once for the same reason.
- **Online 400/502** (issue #7): leaderboard/multiplayer calls still fail through the proxy. Root-caused as **bot / TLS-fingerprint protection** on `vps.kodub.com`, not merely an untrusted origin — which is why the extension path (a real browser on the real origin) is the resilient fix rather than more proxy tuning. **M8.**
